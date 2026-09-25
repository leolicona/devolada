import {
  ProviderFailure,
  type ProviderTelemetry,
  type ProviderVerdict,
  type ReceiptInput,
  type TransferInput,
  type ValidationProvider,
} from "./types";
import { amountToCents } from "../../wisphub/money";

/* apiCEP adapter (docs read 2026-08-17 at apicep.cloud/documentacion).
   One endpoint, POST /validate-transfer, Bearer auth. Our transfer door is
   their Direct Mode; our receipt door is their OCR modes. */

const DEFAULT_BASE_URL = "https://api.apicep.cloud";

/* D16 — Consta owns a deadline, strictly under its caller's 30 s
   (CONSTA_TIMEOUT_MS in apps/api). Measured worst case for a healthy
   validation is ~19 s end to end; without this, the caller cuts first,
   retries, and the original call completes anyway — billing a credit and
   setting `cepPreviouslyValidated` where nobody can see it. Overridable
   only so tests do not wait 25 s for a mock to hang.
   consta-api-merge D10: the caller's 30 s left with the HTTP client —
   engine and caller are one process now, so this is the one deadline a
   provider call carries, and no call can complete after its caller gave
   up. */
const DEFAULT_DEADLINE_MS = 25_000;

type ApiCepResponse = {
  validationId?: string;
  status?: string;
  error?: string;
  missingFields?: string[];
  /* What the provider's OCR read off the image (proof-extraction D11).
     Measured 2026-08-26: present and complete even on a faceless
     `invalid`. The other fields it carries (names, concept) are dropped
     on purpose — they invite trust-the-pixels integrations. */
  extracted?: {
    trackingKey?: string;
    amount?: number;
    date?: string;
    senderBank?: string;
    referenceNumber?: string;
  };
  validation?: {
    cepStatus?: string;
    cepPreviouslyValidated?: boolean | null;
    cepDetails?: {
      trackingKey?: string;
      amount?: number;
      operationDate?: string;
      senderBank?: string;
      senderName?: string;
      receiverBank?: string;
      beneficiaryName?: string;
      digitalSignature?: string;
      /* receipt-triage D22: documented by the provider; kept now */
      beneficiaryAccount?: string;
      beneficiaryAccountType?: string;
    };
  };
  downloads?: { cepXml?: string; cepPdf?: string };
};

function requestBody(input: TransferInput | ReceiptInput): Record<string, unknown> {
  if (input.mode === "transfer") {
    return {
      system: "SPEI",
      beneficiary: input.beneficiary,
      sender: {
        date: input.date,
        /* Cents at our edge, decimal pesos at theirs (spec D7). The one
           outbound conversion stays a division (consta-api-merge D18):
           apiCEP takes a JSON number, and an integer divided by 100
           serialises to exactly the two decimals it means. */
        amount: input.amountCents / 100,
        bank: input.senderBank,
        /* receipt-triage D1: exactly one key travels — the clave when
           there is one, the reference only when there is none — and the
           absent one is left out rather than sent as null */
        ...(input.trackingKey
          ? { trackingKey: input.trackingKey }
          : input.referenceNumber
            ? { referenceNumber: input.referenceNumber }
            : {}),
      },
    };
  }
  return {
    system: "SPEI",
    imageUrl: input.receiptUrl,
    ...(input.beneficiary ? { beneficiary: input.beneficiary } : {}),
    ...(input.potentialBeneficiaries ? { potentialBeneficiaries: input.potentialBeneficiaries } : {}),
  };
}

/* D14 — the headers ride 200s only (measured 2026-08-19: a 400 carries
   none), so every field except the status can be absent without the call
   having failed. `X-Processing-Time` arrives as "2550ms". */
function readTelemetry(res: Response): ProviderTelemetry {
  const ms = res.headers.get("X-Processing-Time");
  const quota = res.headers.get("X-RateLimit-Remaining");
  const parsed = ms ? Number.parseInt(ms, 10) : Number.NaN;
  return {
    httpStatus: res.status,
    providerMs: Number.isNaN(parsed) ? null : parsed,
    quotaRemaining: quota != null && /^\d+$/.test(quota) ? Number.parseInt(quota, 10) : null,
  };
}

/* D9 — the non-2xx taxonomy. The body decides as much as the status:
   apiCEP hides five different situations under 401 alone, and one of
   them cleared on retry against a token that was never revoked
   (docs/legacy/integrations/apicep.md, Auth). Everything unrecognised fails
   toward "we do not know", never toward "the request was wrong". */
function classifyHttpFailure(
  res: Response,
  body: ApiCepResponse | null,
  telemetry: ProviderTelemetry,
): ProviderFailure {
  const detail = body?.error ?? `apiCEP responded ${res.status}`;
  const shared = { telemetry, providerValidationId: body?.validationId ?? null };

  if (res.status === 401) {
    /* The one transient 401: apiCEP dropping a header we always send.
       Measured to clear on retry, so it is their outage, not our secret. */
    if (body?.error === "Missing or invalid Authorization header") {
      return new ProviderFailure(`apiCEP 401 (transient): ${detail}`, "PROVIDER_UNAVAILABLE", true, shared);
    }
    return new ProviderFailure(`apiCEP 401: ${detail}`, "PROVIDER_AUTH_FAILED", false, shared);
  }
  if (res.status === 429) {
    return new ProviderFailure(`apiCEP 429: ${detail}`, "PROVIDER_RATE_LIMITED", true, {
      ...shared,
      retryAfter: res.headers.get("X-RateLimit-Reset"),
    });
  }
  if (res.status === 400 || res.status === 405 || res.status === 422) {
    return new ProviderFailure(`apiCEP ${res.status}: ${detail}`, "REQUEST_REJECTED", false, {
      ...shared,
      /* 422 = "referencia duplicada en Banxico (requiere clave de
         rastreo)": the reference matches more than one transfer, and the
         one remedy is resending with the tracking key. Published,
         unverified. Devolada can hit it since receipt-triage D1 — a
         search by reference alone — and receipt-triage D17 is what the
         caller does with it: ask the payer for the clave and stop calling. */
      hint: res.status === 422 ? "provide_tracking_key" : null,
    });
  }
  /* 500 and anything unrecognised: the only genuinely transient rows */
  return new ProviderFailure(`apiCEP ${res.status}: ${detail}`, "PROVIDER_UNAVAILABLE", true, shared);
}

/* The trap measured in the spike (spec D3): a CEP can take hours to exist.
   Both their explicit "pending" and an "invalid" whose cepStatus is still
   EN PROCESO mean "ask again later", never "the transfer is fake".

   D11: past that, an `invalid` still says two different things. When a
   CEP came back, the provider is contradicting the claim with evidence.
   When nothing came back — no cepDetails and no cepStatus — there is
   nothing to contradict it with, and that answer covers a transfer that
   never happened, a misread clave, a wrong sender bank and a CEP Banxico
   has not published yet, all byte-identical (measured 2026-08-19: a real
   settled transfer sent with the wrong `sender.bank` returned exactly the
   shape a nonexistent one returns). The caller cannot tell them apart
   either, but it can at least be told that it cannot.

   D10: a status we do not recognise is not a verdict. The old fallback
   was `invalid` — the harshest reading available — so a value apiCEP
   adds tomorrow would tell a paying customer their transfer is fake.
   Fail toward "we do not know". */
function mapVerdict(
  body: ApiCepResponse,
  telemetry: ProviderTelemetry,
): Pick<ProviderVerdict, "status" | "reason"> {
  const cepStatus = body.validation?.cepStatus ?? null;
  if (body.status === "valid") return { status: "valid", reason: null };
  if (body.status === "pending" || cepStatus === "EN PROCESO") {
    return { status: "pending", reason: null };
  }
  if (body.status === "invalid") {
    /* D11 amended 2026-08-26: "not yet" wears two masks. EN PROCESO —
       the CEP exists, the transfer has not settled. And the mirror,
       measured live: `invalid` WITH cepStatus LIQUIDADO — the transfer
       settled, the provider has not assimilated it (T+63s: invalid +
       LIQUIDADO in 2.1s, the gave-up-early band; T+103s: the same
       request came back valid in 9.3s). A settled CEP cannot contradict
       the claim it settles, so this is never a verdict — it is "ask
       again", and the schedule does exactly that. A *real* mismatch
       that keeps answering this way rides to an honest expiry instead
       of dying as a false "your bank says it failed". `contradicted`
       stays reserved for evidence that resolves: DEVUELTO, CANCELADA. */
    if (cepStatus === "LIQUIDADO") return { status: "pending", reason: null };
    const evidence = Boolean(body.validation?.cepDetails) || cepStatus !== null;
    return { status: "invalid", reason: evidence ? "contradicted" : "not_found" };
  }
  throw new ProviderFailure(
    `apiCEP returned an unrecognised status: ${String(body.status)}`,
    "PROVIDER_UNAVAILABLE",
    true,
    { telemetry, providerValidationId: body.validationId ?? null },
  );
}

export function apiCepProvider(env: {
  APICEP_TOKEN?: string;
  APICEP_BASE_URL?: string;
  APICEP_DEADLINE_MS?: string;
}): ValidationProvider {
  return {
    async validate(input) {
      if (!env.APICEP_TOKEN) {
        /* Never reached the provider: retryable, because the fix is a
           redeploy with the secret in place, and nothing was billed */
        throw new ProviderFailure("APICEP_TOKEN is not configured", "PROVIDER_UNAVAILABLE", true);
      }
      const deadlineMs = Number(env.APICEP_DEADLINE_MS ?? DEFAULT_DEADLINE_MS);
      let res: Response;
      try {
        res = await fetch(`${env.APICEP_BASE_URL ?? DEFAULT_BASE_URL}/validate-transfer`, {
          method: "POST",
          signal: AbortSignal.timeout(deadlineMs),
          headers: {
            Authorization: `Bearer ${env.APICEP_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody(input)),
        });
      } catch (e) {
        const name = (e as { name?: string })?.name;
        const detail =
          name === "TimeoutError" || name === "AbortError"
            ? `apiCEP did not answer within ${deadlineMs}ms (D16)`
            : `network error reaching apiCEP: ${String(e)}`;
        /* No response came back — nothing to log as billed (D15) */
        throw new ProviderFailure(detail, "PROVIDER_UNAVAILABLE", true);
      }

      const telemetry = readTelemetry(res);
      /* Read the body even on a non-2xx: the envelope-shaped 400 carries
         the validationId of a call we were billed for (D15), and a 401's
         body is the only thing that says whether it is fatal (D9). */
      const body = (await res.json().catch(() => null)) as ApiCepResponse | null;
      if (!res.ok) throw classifyHttpFailure(res, body, telemetry);
      if (body === null) {
        throw new ProviderFailure("apiCEP answered 200 with an unreadable body", "PROVIDER_UNAVAILABLE", true, {
          telemetry,
        });
      }

      if (body.status === "error") {
        if (input.mode === "receipt") {
          /* Scenario 13 — the one OCR failure apiCEP names out loud.
             Passing `missingFields` through is what turns "Verificando tu
             pago" for six hours into "falta la fecha en tu comprobante"
             in seconds. Never retryable: the same image reads the same. */
          throw new ProviderFailure(body.error ?? "apiCEP status: error", "RECEIPT_UNREADABLE", false, {
            telemetry,
            missingFields: body.missingFields ?? null,
            providerValidationId: body.validationId ?? null,
          });
        }
        /* A 200-with-error on the transfer door has never been observed
           (the measured business-rule rejections wear a 400). Unknown →
           "we do not know", the D10 rule. */
        throw new ProviderFailure(body.error ?? "apiCEP status: error", "PROVIDER_UNAVAILABLE", true, {
          telemetry,
          providerValidationId: body.validationId ?? null,
        });
      }

      const details = body.validation?.cepDetails;
      return {
        providerValidationId: body.validationId ?? null,
        ...mapVerdict(body, telemetry),
        alreadyValidated: body.validation?.cepPreviouslyValidated === true,
        /* receipt-triage FR-006: the tri-state, for the no-clave guard */
        previouslyValidated:
          typeof body.validation?.cepPreviouslyValidated === "boolean"
            ? body.validation.cepPreviouslyValidated
            : null,
        cepStatus: body.validation?.cepStatus ?? null,
        telemetry,
        cep: details
          ? {
              trackingKey: details.trackingKey ?? null,
              /* Pesos at the provider's edge, cents at ours (spec D7) — by
                 string parsing, never `× 100` (constitution II,
                 consta-api-merge D18) */
              amountCents: details.amount != null ? amountToCents(details.amount) : null,
              date: details.operationDate ?? null,
              senderBank: details.senderBank ?? null,
              senderName: details.senderName ?? null,
              receiverBank: details.receiverBank ?? null,
              beneficiaryName: details.beneficiaryName ?? null,
              digitalSignature: details.digitalSignature ?? null,
              beneficiaryAccount: details.beneficiaryAccount ?? null,
              beneficiaryAccountType: details.beneficiaryAccountType ?? null,
            }
          : null,
        downloads: body.downloads ?? null,
        /* D11: only the OCR door produces a reading — on the transfer
           door `extracted` merely echoes the caller's own input, and an
           echo is not a second opinion */
        reading:
          input.mode === "receipt" && body.extracted
            ? {
                trackingKey: body.extracted.trackingKey ?? null,
                amountCents: body.extracted.amount != null ? amountToCents(body.extracted.amount) : null,
                date: body.extracted.date ?? null,
                senderBank: body.extracted.senderBank ?? null,
                referenceNumber: body.extracted.referenceNumber ?? null,
              }
            : null,
      } satisfies ProviderVerdict;
    },
  };
}
