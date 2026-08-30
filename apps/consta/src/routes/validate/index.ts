import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { validations } from "../../db/schema";
import { requireApiKey } from "../../auth/api-key";
import { apiCepProvider } from "../../provider/apicep";
import { ProviderFailure, type ReceiptInput, type TransferInput } from "../../provider/types";
import type { Bindings, Variables } from "../../env";
import { BANKS } from "../../provider/banks";
import { extractions } from "../../db/schema";
import { extractProof, type ExtractionResult } from "../../extraction";
import { extractionFailure, readingPayload, recordExtraction, shapeSignals } from "../extract";
import { checkShape, loadShapeRules, type ShapeVerdict } from "../../extraction";
import type { Bank } from "../../provider/banks";
import { trustBlock } from "../../trust/history";
import { suggestRetryAfter } from "../../retry/suggest";
import { validateRequestSchema } from "./schema";

export const validateRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

validateRoute.post(
  "/",
  requireApiKey,
  zValidator("json", validateRequestSchema, (result, c) => {
    if (result.success) return;
    /* D12/D13: refusing here is the point — a bank name or a tracking key
       that cannot possibly validate must cost a 400, not a credit and a
       faceless `invalid`. The issues say which field; a bank error also
       carries the vocabulary, because it is the one value a caller cannot
       guess and should not need a second round trip to learn. */
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const bankIssue = result.error.issues.some((i) => {
      const field = i.path[i.path.length - 1];
      return field === "bank" || field === "senderBank";
    });
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          /* D19: every error says whether waiting can help — envelope law */
          retryable: false,
          issues,
          ...(bankIssue ? { acceptedBanks: BANKS } : {}),
        },
      },
      400,
    );
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const apiKeyId = c.get("apiKey").id;

    let input: TransferInput | ReceiptInput = body.transfer
      ? { mode: "transfer", ...body.transfer }
      : {
          mode: "receipt",
          receiptUrl: body.receiptUrl!,
          beneficiary: body.beneficiary,
          potentialBeneficiaries: body.potentialBeneficiaries,
        };

    /* proof-extraction D1/D2: an image is read here and validated through
       the direct door; a PDF goes to the provider's OCR untouched. Every
       refusal below spends no credit, which is the entire point — apiCEP
       cannot tell a caller which field was wrong, because a malformed
       clave, an unknown bank and a transfer that never happened are the
       same faceless `invalid` (D11). Here we can, before paying.

       If the reader is unavailable the image falls through to the OCR
       door rather than failing: a door that still works beats a 502. */
    let extractionId: string | null = null;
    /* Which door actually read the file (D2). The transfer door has no
       file and no source; the receipt door always has one, and the PDF
       route has an extraction row *and* still belongs to the provider. */
    let source: "reader" | "provider-ocr" | null = input.mode === "receipt" ? "provider-ocr" : null;
    /* D15: the shape verdict on whatever clave is about to be spent —
       the reader's on the image door, the caller's on the transfer door.
       Null when nothing here read a clave (the provider's OCR route). */
    let shape: ShapeVerdict | null = null;
    /* `potentialBeneficiaries` is an OCR-mode feature: apiCEP matches the
       image against a list of candidate accounts, and a direct-mode call
       takes exactly one beneficiary. So a caller using it keeps the OCR
       door — that is this spec's answer to its own open question, rather
       than quietly dropping a field from the contract. */
    /* D11: `providerOcr` keeps the image on the OCR door on purpose — a
       caller that already holds a reading wants the provider's eyes, not
       a second pass of the same model. */
    const readable = input.mode === "receipt" && Boolean(body.beneficiary) && !body.providerOcr;
    if (readable && input.mode === "receipt" && c.env.AI) {
      let extracted: ExtractionResult;
      try {
        extracted = await extractProof(c.env, input.receiptUrl);
      } catch (err) {
        const failure = extractionFailure(err);
        if (!failure) throw err;
        if (failure.code === "READER_UNAVAILABLE") {
          console.error("reader unavailable, falling back to provider OCR");
          extracted = null as unknown as ExtractionResult;
        } else {
          await recordExtraction(
            db,
            apiKeyId,
            failure.code === "READER_UNREADABLE" ? "unreadable" : "refused",
            null,
            { note: `${failure.code}: ${String((err as Error).message)}` },
          );
          return c.json(
            { success: false, error: { code: failure.code, retryable: failure.status === 502 } },
            failure.status,
          );
        }
      }

      if (extracted && extracted.route === "reader") {
        const { reading, gated } = extracted;
        /* D15/D16: computed once, recorded on every outcome, and blocking
           none of them — a mismatch rides into the paid call below */
        const signals = await shapeSignals(db, extracted);
        shape = signals.shape;
        /* The lead case: measured live, an image with no receipt in it
           makes apiCEP answer `error`, which is retryable, so the payment
           rides Devolada's whole six-hour schedule at up to seven paid
           calls. It stops here for the price of one Workers AI call. */
        if (!reading.isReceipt) {
          await recordExtraction(db, apiKeyId, "not_a_receipt", extracted, { signals });
          return c.json(
            {
              success: false,
              error: { code: "RECEIPT_UNREADABLE", retryable: false, ...readingPayload(extracted, signals) },
            },
            422,
          );
        }
        if (!gated.passes) {
          await recordExtraction(db, apiKeyId, "gated", extracted, { signals });
          return c.json(
            {
              success: false,
              error: { code: "RECEIPT_INCOMPLETE", retryable: false, ...readingPayload(extracted, signals) },
            },
            422,
          );
        }
        extractionId = await recordExtraction(db, apiKeyId, "passed", extracted, { signals });
        source = "reader";
        /* D3: the reading chose *which* Banxico record to ask about. It
           never decides whether that record pays a debt — amount and date
           still come from `cepDetails` alone. */
        input = {
          mode: "transfer",
          date: reading.date ?? new Date().toISOString().slice(0, 10),
          /* The amount apiCEP needs is a *search criterion*, and the one
             printed on the receipt is the right one to search with: it is
             what makes a $1 receipt against a $514 debt come back with a
             real CEP for $1, which the caller then refuses (direct-payment
             D11). Sending the caller's expected amount instead would turn
             that into a faceless `not_found` and a six-hour wait. */
          amountCents: gated.amountCents!,
          senderBank: gated.senderBank!,
          trackingKey: gated.trackingKey!,
          beneficiary: body.beneficiary!,
        };
      } else if (extracted) {
        extractionId = await recordExtraction(db, apiKeyId, "routed", extracted);
      }
    }

    /* The transfer door is where Azteca's credits were actually lost
       (2026-08-30: the dropped trailing I, the I typed as 1 — all
       hand-typed). The verdict rides the response; the call still spends. */
    if (shape === null && input.mode === "transfer" && source === null) {
      shape = checkShape(await loadShapeRules(db), input.senderBank as Bank, input.trackingKey ?? null);
    }

    /* learned-retry D2: the receiving side of the transfer, recorded at
       last — the request always carried it and the log dropped it. A
       receipt matched against a candidate list has no single receiver. */
    const beneficiaryBank =
      input.mode === "transfer" ? input.beneficiary.bank : (body.beneficiary?.bank ?? null);

    let verdict;
    try {
      verdict = await apiCepProvider(c.env).validate(input);
    } catch (err) {
      if (err instanceof ProviderFailure) {
        console.error(`provider failure [${err.code}]:`, err.message);
        /* D15 — the log records billed calls, not successful ones. A
           response came back, so apiCEP (probably) charged for it; a row
           with `status: null` is how the invoice stays a SUM over this
           table. No response (network, deadline) → nothing was measured
           → no row. */
        if (err.extra.telemetry) {
          const [row] = await db
            .insert(validations)
            .values({
              apiKeyId,
              mode: input.mode,
              status: null,
              trackingKey: (input.mode === "transfer" ? input.trackingKey : null) ?? null,
              senderBank: input.mode === "transfer" ? input.senderBank : null,
              referenceNumber: input.mode === "transfer" ? (input.referenceNumber ?? null) : null,
              amountCents: input.mode === "transfer" ? input.amountCents : null,
              transferDate: input.mode === "transfer" ? input.date : null,
              beneficiaryBank,
              /* Scenario 12: the envelope-shaped 400 carries the id of a
                 call we were billed for — recorded even though it failed */
              providerValidationId: err.extra.providerValidationId ?? null,
              providerHttpStatus: err.extra.telemetry.httpStatus,
              providerMs: err.extra.telemetry.providerMs,
              quotaRemaining: err.extra.telemetry.quotaRemaining,
              /* trust-layer D1: failed rows keep their refs too — a chain
                 whose attempts vanish on failure would lie about itself */
              customerRef: body.customerRef ?? null,
              paymentRef: body.paymentRef ?? null,
            })
            .returning({ id: validations.id });
          if (extractionId) {
            await db.update(extractions).set({ validationId: row.id }).where(eq(extractions.id, extractionId));
          }
        }
        /* D9 — the envelope says whether waiting can help, so the caller
           stops guessing. Our HTTP status mirrors the taxonomy: 503 when
           the provider is rate-limited (with Retry-After), 422 when the
           request itself must change, 502 for everything Consta cannot
           promise anything about. */
        const httpStatus =
          err.code === "PROVIDER_RATE_LIMITED" ? 503
          : err.code === "REQUEST_REJECTED" || err.code === "RECEIPT_UNREADABLE" ? 422
          : 502;
        if (err.code === "PROVIDER_RATE_LIMITED" && err.extra.retryAfter) {
          c.header("Retry-After", err.extra.retryAfter);
        }
        return c.json(
          {
            success: false,
            error: {
              code: err.code,
              retryable: err.retryable,
              ...(err.extra.retryAfter ? { retryAfter: err.extra.retryAfter } : {}),
              ...(err.extra.hint ? { hint: err.extra.hint } : {}),
              ...(err.extra.missingFields ? { missingFields: err.extra.missingFields } : {}),
            },
          },
          httpStatus,
        );
      }
      throw err;
    }

    /* Append-only log (spec D6): the row is the billable event */
    const [row] = await db
      .insert(validations)
      .values({
        apiKeyId,
        mode: input.mode,
        status: verdict.status,
        reason: verdict.reason,
        alreadyValidated: verdict.alreadyValidated,
        trackingKey: (input.mode === "transfer" ? input.trackingKey : verdict.cep?.trackingKey) ?? null,
        /* proof-extraction D13: the pair (bank, clave) is what per-bank
           clave shape is derived from, and only `valid` rows count */
        senderBank: (input.mode === "transfer" ? input.senderBank : verdict.cep?.senderBank) ?? null,
        referenceNumber: input.mode === "transfer" ? (input.referenceNumber ?? null) : null,
        amountCents: (input.mode === "transfer" ? input.amountCents : verdict.cep?.amountCents) ?? null,
        transferDate: (input.mode === "transfer" ? input.date : verdict.cep?.date) ?? null,
        beneficiaryBank,
        providerValidationId: verdict.providerValidationId,
        cepStatus: verdict.cepStatus,
        /* D14: cost and latency ride every row. `providerMs` on a
           faceless `invalid` is the one clue whether Banxico was ever
           asked (1–2 s early fail vs 6–7 s real lookup). */
        providerHttpStatus: verdict.telemetry.httpStatus,
        providerMs: verdict.telemetry.providerMs,
        quotaRemaining: verdict.telemetry.quotaRemaining,
        /* trust-layer D1: the opt-in refs, stored verbatim and opaque */
        customerRef: body.customerRef ?? null,
        paymentRef: body.paymentRef ?? null,
      })
      .returning({ id: validations.id });

    /* D8: tie the reading to the paid call it bought, so the audit trail
       runs both ways — from a verdict back to what was read, and from a
       reading forward to what it cost. */
    if (extractionId) {
      await db
        .update(extractions)
        .set({ validationId: row.id })
        .where(eq(extractions.id, extractionId));
    }

    /* trust-layer D5: the payer's measured history rides the verdicts
       where the caller is deciding whether to wait — pending and the
       faceless not_found — and only when the caller named the payer.
       Never on valid (redundant) or contradicted (a real DEVUELTO is
       not bridged by history). The row just written belongs to the
       chain in flight, which D3 excludes from its own evidence. */
    const wantsTrust =
      body.customerRef &&
      (verdict.status === "pending" ||
        (verdict.status === "invalid" && verdict.reason === "not_found"));
    const trust = wantsTrust
      ? await trustBlock(
          db,
          apiKeyId,
          body.customerRef!,
          {
            paymentRef: body.paymentRef ?? null,
            trackingKey:
              (input.mode === "transfer" ? input.trackingKey : verdict.cep?.trackingKey) ?? null,
          },
          new Date(),
        )
      : null;

    /* learned-retry D1/D3: the moment when asking again stops being
       spending in vain, on exactly the verdicts where the caller is
       deciding when to ask again. Omitted in cold start and past the
       learned range — silence, never a guess (D5). Rides the same
       verdicts as the trust block, and for the same reason. */
    const retryAfter =
      verdict.status === "pending" ||
      (verdict.status === "invalid" && verdict.reason === "not_found")
        ? await suggestRetryAfter(db, {
            trackingKey:
              (input.mode === "transfer" ? input.trackingKey : verdict.cep?.trackingKey) ?? null,
            senderBank:
              (input.mode === "transfer" ? input.senderBank : verdict.cep?.senderBank) ?? null,
            beneficiaryBank,
            /* D4 rule 2: the elapsed anchor counts only attempts that
               asked with these same inputs */
            amountCents: input.mode === "transfer" ? input.amountCents : null,
            transferDate: input.mode === "transfer" ? input.date : null,
            now: new Date(),
          })
        : null;

    return c.json({
      success: true,
      data: {
        validationId: row.id,
        /* D2, so a caller can see which door actually read the file */
        ...(source ? { source } : {}),
        ...(extractionId ? { extractionId } : {}),
        /* D15: a field, never a refusal */
        ...(shape ? { shape } : {}),
        status: verdict.status,
        /* D11: `invalid` alone is not enough for the caller to act on.
           `not_found` is ambiguous by construction, so it travels with
           the only advice that is always true for it — and never with a
           licence to tell a customer their transfer does not exist. */
        ...(verdict.reason ? { reason: verdict.reason } : {}),
        ...(verdict.reason === "not_found" ? { hint: "verify_inputs" } : {}),
        /* learned-retry D1: a suggestion, never a promise — the caller's
           own schedule remains the floor and the tail */
        ...(retryAfter ? { retryAfter } : {}),
        /* D18: `contradicted` says which way when Banxico said it —
           "DEVUELTO" lets a caller tell its customer "your bank returned
           the transfer" instead of a generic mismatch. Banxico's word
           about the payer's own transfer, so nothing foreign leaks. */
        ...(verdict.reason === "contradicted" && verdict.cepStatus ? { cepStatus: verdict.cepStatus } : {}),
        alreadyValidated: verdict.alreadyValidated,
        ...(verdict.cep ? { cep: verdict.cep } : {}),
        /* D11: the provider's reading — a reading, never a verdict. It
           survives failure (measured 2026-08-26), which is exactly when a
           caller comparing readings needs it. */
        ...(verdict.reading ? { reading: verdict.reading } : {}),
        ...(verdict.downloads ? { downloads: verdict.downloads } : {}),
        ...(trust ? { trust } : {}),
      },
    });
  },
);
