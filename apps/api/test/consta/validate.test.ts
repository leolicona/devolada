import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { resetShapeRules } from "../../src/consta/extraction";
import { consta, ConstaError, type ConstaRequest } from "../../src/consta";
import type { Bindings } from "../../src/env";
import {
  aiReturning,
  db,
  engineEnv,
  extractions,
  NOT_A_FILE,
  PDF,
  PNG,
  putProof,
  seedOwner,
  validations,
} from "./helpers";

/* docs/legacy/consta/validation.spec.md scenarios 1–5, 7, and 16–17/19–20.
   apiCEP is mocked with the shapes read from its documentation (2026-08-17)
   and measured against the live API (2026-08-19).

   Moved in-process with the engine (consta-api-merge D12): every test
   here called `POST /validate` on the standalone Worker and asserted an
   HTTP status and an envelope; it now calls the engine's facade and
   asserts the `ConstaError` — its code and whether waiting can help —
   where the status and the envelope were. Titles, citations and every
   other assertion are the ones the standalone suite carried. */

const APICEP_ORIGIN = "https://api.apicep.cloud";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const directRequest = {
  transfer: {
    date: "2026-08-15",
    amountCents: 51400,
    senderBank: "BBVA MEXICO",
    trackingKey: "MBAN01002508150012345678",
    beneficiary: { bank: "BANORTE", clabe: "072180001234567895" },
  },
};

const settledResponse = {
  validationId: "prov-uuid-1",
  status: "valid",
  validation: {
    banxicoConfirmed: true,
    cepStatus: "LIQUIDADO",
    cepPreviouslyValidated: false,
    cepDetails: {
      trackingKey: "MBAN01002508150012345678",
      amount: 514.0,
      operationDate: "2026-08-15",
      senderBank: "BBVA MEXICO",
      senderName: "VALENTINA PEREZ",
      receiverBank: "BANORTE",
      beneficiaryName: "WIFIPLUS SA DE CV",
      digitalSignature: "abc123==",
    },
  },
  downloads: { cepXml: "https://storage.apicep.cloud/x.xml", cepPdf: "https://storage.apicep.cloud/x.pdf" },
};

function mockApiCep(
  reply: unknown,
  expectBody?: (body: Record<string, unknown>) => void,
  opts: { status?: number; headers?: Record<string, string> } = {},
) {
  fetchMock
    .get(APICEP_ORIGIN)
    .intercept({
      method: "POST",
      path: "/validate-transfer",
      body: (raw) => {
        expectBody?.(JSON.parse(raw as string));
        return true;
      },
    })
    .reply(opts.status ?? 200, JSON.stringify(reply), {
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    });
}

/* One bucket for the whole file: the proof a test puts is the proof the
   engine reads (consta-api-merge D7) */
const PROOFS = engineEnv().PROOFS;
const testEnv = (overrides: Partial<Bindings> = {}) => engineEnv({ PROOFS, ...overrides });

/* The engine's answer, or its failure — `ok` is what the HTTP status
   said, the `ConstaError` is what the envelope carried */
type Outcome = { ok: boolean; data: Record<string, unknown>; error: ConstaError | null };

async function postValidate(businessId: string, body: unknown, overrides: Partial<Bindings> = {}): Promise<Outcome> {
  try {
    const data = await consta(testEnv(overrides), db(), { businessId }).validate(body as ConstaRequest);
    return { ok: true, data: data as unknown as Record<string, unknown>, error: null };
  } catch (e) {
    if (e instanceof ConstaError) return { ok: false, data: {}, error: e };
    throw e;
  }
}

async function postExtract(businessId: string, proofKey: string, overrides: Partial<Bindings> = {}): Promise<Outcome> {
  try {
    const data = await consta(testEnv(overrides), db(), { businessId }).extract({ proofKey });
    return { ok: true, data: data as unknown as Record<string, unknown>, error: null };
  } catch (e) {
    if (e instanceof ConstaError) return { ok: false, data: {}, error: e };
    throw e;
  }
}

/* consta-api-merge D7: the engine reads the bytes from the product's own
   bucket, so the bytes have to be put there in tests too. */
const PROOF_KEY = "link-1/receipt";
const mockProof = (bytes: Uint8Array, contentType = "application/octet-stream") =>
  putProof(PROOFS, PROOF_KEY, bytes, contentType);
/* What the provider fetches, when it must read the file itself: the
   signed link the engine built for it (direct-payment D12) */
const expectSignedProofUrl = (imageUrl: unknown) => {
  expect(String(imageUrl)).toContain(`/direct-payments/proofs/${PROOF_KEY}`);
  expect(String(imageUrl)).toContain("sig=");
};

/* What the model returns for a clean Nubank receipt of $514.00 */
const GOOD_READING = {
  esComprobante: true,
  claveDeRastreo: "MBAN01002508150012345678",
  banco: "BBVA MEXICO",
  monto: 514.0,
  fecha: "2026-08-15",
  estatus: "Aceptada",
};

const receiptRequest = {
  receipt: { proofKey: PROOF_KEY },
  beneficiary: { bank: "BANORTE", clabe: "072180001234567895" },
};

describe("validate — transfer door", () => {
  it("US-V01, US-V05: a settled transfer comes back valid, mapped to cents, and logged under the key", async () => {
    const { id: keyId, key } = await seedOwner();
    mockApiCep(settledResponse, (body) => {
      const sender = body.sender as Record<string, unknown>;
      expect(sender.amount).toBe(514); // cents → provider pesos (D7)
      expect(body.system).toBe("SPEI");
    });

    const res = await postValidate(key, directRequest);
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.status).toBe("valid");
    expect(data.alreadyValidated).toBe(false);
    expect((data.cep as Record<string, unknown>).amountCents).toBe(51400);
    expect((data.cep as Record<string, unknown>).senderName).toBe("VALENTINA PEREZ");

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("valid");
    expect(rows[0].mode).toBe("transfer");
    expect(rows[0].providerValidationId).toBe("prov-uuid-1");
  });

  it("US-V03: a CEP still EN PROCESO reads as pending, never invalid", async () => {
    const { key } = await seedOwner();
    mockApiCep({
      validationId: "prov-uuid-2",
      status: "invalid",
      validation: { banxicoConfirmed: false, cepStatus: "EN PROCESO", cepPreviouslyValidated: null },
    });

    const res = await postValidate(key, directRequest);
    const { data } = res;
    expect(data.status).toBe("pending");
  });

  it("US-V04: a previously validated CEP is flagged but keeps its verdict", async () => {
    const { key } = await seedOwner();
    mockApiCep({
      ...settledResponse,
      validation: { ...settledResponse.validation, cepPreviouslyValidated: true },
    });

    const res = await postValidate(key, directRequest);
    const { data } = res;
    expect(data.status).toBe("valid");
    expect(data.alreadyValidated).toBe(true);
  });

  it("scenario 7 (amended by D15): a provider outage is retryable, and the billed call is logged", async () => {
    const { id: keyId, key } = await seedOwner();
    mockApiCep({ error: "Service temporarily unavailable" }, undefined, { status: 503 });

    const res = await postValidate(key, directRequest);
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.retryable).toBe(true);

    /* D15: a response came back, so the row is written — with no verdict.
       Verdict-bearing rows stay selectable with `status IS NOT NULL`. */
    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBeNull();
    expect(rows[0].providerHttpStatus).toBe(503);
  });

  /* Scenarios 24, 25 and 14 (D11, D10) — the shapes behind BUG-003. */

  it("US-V06: an `invalid` with nothing behind it says `not_found`, and says to check the inputs", async () => {
    const { id: keyId, key } = await seedOwner();
    /* Measured 2026-08-19: this is what a real settled transfer sent
       with the wrong `sender.bank` returns — and it is byte-identical
       to what a transfer that never happened returns. */
    mockApiCep({
      validationId: "prov-uuid-9",
      status: "invalid",
      validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
    });

    const res = await postValidate(key, directRequest);
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.status).toBe("invalid");
    expect(data.reason).toBe("not_found");
    expect(data.hint).toBe("verify_inputs");
    expect(data.cep).toBeUndefined();

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows[0].reason).toBe("not_found");
  });

  it("US-V06: a returned CEP that disagrees says `contradicted`, and carries no hint", async () => {
    const { key } = await seedOwner();
    mockApiCep({
      validationId: "prov-uuid-10",
      status: "invalid",
      validation: { banxicoConfirmed: false, cepStatus: "DEVUELTO", cepPreviouslyValidated: null },
    });

    const res = await postValidate(key, directRequest);
    const { data } = res;
    expect(data.status).toBe("invalid");
    expect(data.reason).toBe("contradicted");
    expect(data.hint).toBeUndefined();
    /* D18, scenario 27: Banxico's word travels — the caller can say "tu
       banco devolvió la transferencia" instead of a generic mismatch */
    expect(data.cepStatus).toBe("DEVUELTO");
  });

  it("US-V03: `invalid` with a settled cepStatus is 'ask again', never a contradiction", async () => {
    const { id: keyId, key } = await seedOwner();
    /* Measured live 2026-08-26: a real BBVA transfer at T+63s answered
       `invalid` WITH cepStatus LIQUIDADO in 2.1s (the gave-up-early
       band); the identical request at T+103s answered `valid` in 9.3s.
       A settled CEP cannot contradict the claim it settles — trusting
       it as evidence killed a real payment, and only the payer's manual
       retry saved it. */
    mockApiCep({
      validationId: "prov-uuid-liq",
      status: "invalid",
      validation: { banxicoConfirmed: false, cepStatus: "LIQUIDADO", cepPreviouslyValidated: null },
    });

    const res = await postValidate(key, directRequest);
    const { data } = res;
    expect(data.status).toBe("pending");
    expect(data.reason).toBeUndefined();

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows[0].status).toBe("pending");
    expect(rows[0].cepStatus).toBe("LIQUIDADO");
  });

  it("US-V06, scenario 27: `not_found` carries no cepStatus — there is no word of Banxico's to relay", async () => {
    const { key } = await seedOwner();
    mockApiCep({
      validationId: "prov-uuid-14",
      status: "invalid",
      validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
    });

    const res = await postValidate(key, directRequest);
    const { data } = res;
    expect(data.reason).toBe("not_found");
    expect(data.cepStatus).toBeUndefined();
  });

  it("US-V06, scenario 14: a status apiCEP has not published yet is a retryable failure, never a verdict (D10, D9)", async () => {
    const { id: keyId, key } = await seedOwner();
    mockApiCep({ validationId: "prov-uuid-11", status: "under_review", validation: {} });

    const res = await postValidate(key, directRequest);
    expect(res.ok).toBe(false);
    const error = res.error!;
    /* The regression that guards D10's whole point: never `invalid` */
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.retryable).toBe(true);

    /* Fail toward "we do not know": no verdict was reached, so no
       verdict is logged and nobody is told their transfer is fake. The
       call still reached the provider, so its billed row exists (D15) —
       with `status: null` and the provider's id. */
    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBeNull();
    expect(rows[0].providerValidationId).toBe("prov-uuid-11");
  });
});

/* Scenarios 8–15 and 21–23: the failure taxonomy (D9) and what every call
   records (D14, D15, D16). Each mock serves one row of the D9 table —
   together they are the regression suite for "no permanent failure ever
   becomes a long silence". The 4xx/5xx shapes come from the 2026-08-19
   probe where measured, and from apiCEP's published reference where not
   (405, 422, 429, 500 — marked published-unverified in
   docs/legacy/integrations/apicep.md). */
describe("The failure taxonomy (D9, D14–D16)", () => {
  it("US-V06, scenario 8: a 500 is retryable, with no promise about when", async () => {
    const { key } = await seedOwner();
    mockApiCep({ error: "Internal server error" }, undefined, { status: 500 });

    const res = await postValidate(key, directRequest);
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.retryAfter).toBeNull();
  });

  it("US-V06, scenario 9: a 429 says when to come back, in the response and in the header (the header went with the wire)", async () => {
    const { key } = await seedOwner();
    const reset = "2026-09-16T17:59:12.203+00:00";
    mockApiCep({ error: "Rate limit exceeded" }, undefined, {
      status: 429,
      headers: { "X-RateLimit-Reset": reset },
    });

    const res = await postValidate(key, directRequest);
    expect(res.ok).toBe(false);
        const error = res.error!;
    expect(error.code).toBe("PROVIDER_RATE_LIMITED");
    expect(error.retryable).toBe(true);
    /* Echoed verbatim: retrying before this moment deepens the outage.
       (The Retry-After header the service also sent went with the
       service — there is no wire; the field is the whole answer.) */
    expect(error.retryAfter).toBe(reset);
  });

  it("US-V06, scenario 10: a revoked token is never the caller's to retry — apiCEP's own transient 401 is", async () => {
    const { key } = await seedOwner();
    /* The failure that cost six hours on 2026-08-18 (BUG-002): the body,
       not the status, says whether an operator must act. */
    mockApiCep({ error: "Invalid or revoked API token" }, undefined, { status: 401 });
    const revoked = await postValidate(key, directRequest);
    expect(revoked.ok).toBe(false);
    const revokedError = revoked.error!;
    expect(revokedError.code).toBe("PROVIDER_AUTH_FAILED");
    expect(revokedError.retryable).toBe(false);

    /* Measured once against a good token, gone on retry: Consta always
       sends the header, so this 401 is apiCEP's outage, not our secret */
    mockApiCep({ error: "Missing or invalid Authorization header" }, undefined, { status: 401 });
    const transient = await postValidate(key, directRequest);
    expect(transient.ok).toBe(false);
    const transientError = transient.error!;
    expect(transientError.code).toBe("PROVIDER_UNAVAILABLE");
    expect(transientError.retryable).toBe(true);
  });

  it("US-V06, scenarios 11+23: a bare 400 means the request must change — and its headerless row still logs", async () => {
    const { id: keyId, key } = await seedOwner();
    mockApiCep({ error: "system must be either 'SPEI' or 'SPID'" }, undefined, { status: 400 });

    const res = await postValidate(key, directRequest);
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("REQUEST_REJECTED");
    expect(error.retryable).toBe(false);
    expect(error.hint).toBeNull();

    /* D15: apiCEP charges a credit for a request it rejects with 400
       (measured), so the row exists — and scenario 23: a 400 carries no
       rate-limit headers, which must read as nulls, never as a failure */
    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBeNull();
    expect(rows[0].providerHttpStatus).toBe(400);
    expect(rows[0].quotaRemaining).toBeNull();
    expect(rows[0].providerMs).toBeNull();
  });

  it("US-V06, scenario 12: the envelope-shaped 400 is rejected the same way, and its billed validationId is recorded", async () => {
    const { id: keyId, key } = await seedOwner();
    /* Measured 2026-08-19 (same institution both sides): a full response
       envelope wearing a 400. The old adapter threw before parsing it,
       discarding the id of a call it was charged for. */
    mockApiCep(
      {
        validationId: "prov-uuid-e400",
        status: "error",
        error: "El banco emisor y el banco receptor no pueden ser la misma institución.",
        confidence: 1,
        validation: { banxicoConfirmed: false },
      },
      undefined,
      { status: 400 },
    );

    const res = await postValidate(key, directRequest);
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("REQUEST_REJECTED");
    expect(error.retryable).toBe(false);

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].providerValidationId).toBe("prov-uuid-e400");
  });

  it("US-V06: a duplicated reference says how to fix itself (422 → provide_tracking_key)", async () => {
    const { key } = await seedOwner();
    /* Published, unverified: Devolada always sends the tracking key, so
       only an integrator searching by reference alone can land here. */
    mockApiCep({ error: "Referencia duplicada en Banxico" }, undefined, { status: 422 });

    const res = await postValidate(key, directRequest);
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("REQUEST_REJECTED");
    expect(error.retryable).toBe(false);
    expect(error.hint).toBe("provide_tracking_key");
  });

  it("US-V06, scenario 13: an unreadable receipt names the missing fields, and never rides a schedule", async () => {
    const { id: keyId, key } = await seedOwner();
    const missing = ["fecha de la operación", "clave de rastreo o número de referencia"];
    mockApiCep({
      validationId: "prov-uuid-ocr",
      status: "error",
      error: "El OCR no pudo extraer los siguientes datos obligatorios",
      missingFields: missing,
    });

    /* No AI binding: the image goes straight to the provider's OCR door,
       so the provider's own "I could not read this" is what comes back */
    const res = await postValidate(key, receiptRequest, { AI: undefined });
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("RECEIPT_UNREADABLE");
    expect(error.retryable).toBe(false);
    /* Verbatim: this is the one OCR failure apiCEP names out loud, and
       the difference between "Verificando tu pago" for six hours and
       "falta la fecha en tu comprobante" in seconds */
    expect(error.missingFields).toEqual(missing);

    /* The OCR ran, so the call was billed and belongs in the log (D15) */
    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBeNull();
    expect(rows[0].mode).toBe("receipt");
  });

  it("US-V06, scenario 15: a hung provider is Consta's deadline to report, and an unanswered call is not logged", async () => {
    const { id: keyId, key } = await seedOwner();
    fetchMock
      .get(APICEP_ORIGIN)
      .intercept({ method: "POST", path: "/validate-transfer" })
      .reply(200, JSON.stringify(settledResponse), { headers: { "Content-Type": "application/json" } })
      .delay(500);

    /* The deadline exists so Consta answers before its caller's 30 s
       cuts first (D16); tests shrink it rather than wait 25 s */
    const res = await postValidate(key, directRequest, { APICEP_DEADLINE_MS: "50" });
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.retryable).toBe(true);

    /* No response came back, so nothing was measured and no row is
       written — the one failure D15 cannot price is the one it must not
       invent a row for */
    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(0);
  });

  it("US-V08, scenario 21: a valid verdict records what it cost, how long it took, and what is left", async () => {
    const { id: keyId, key } = await seedOwner();
    mockApiCep(settledResponse, undefined, {
      headers: { "X-Processing-Time": "6500ms", "X-RateLimit-Remaining": "767" },
    });

    const res = await postValidate(key, directRequest);
    expect(res.ok).toBe(true);

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows[0].providerHttpStatus).toBe(200);
    expect(rows[0].providerMs).toBe(6500);
    expect(rows[0].quotaRemaining).toBe(767);
  });
});

describe("validate — receipt door", () => {
  it("US-V02, scenario 2: a PDF keeps the provider's OCR door, untouched", async () => {
    const { key } = await seedOwner();
    await mockProof(PDF(), "application/pdf");
    mockApiCep(settledResponse, (body) => {
      expectSignedProofUrl(body.imageUrl);
      expect(body.sender).toBeUndefined();
    });

    const res = await postValidate(key, receiptRequest, {
      AI: aiReturning(GOOD_READING) /* bound, and deliberately not used */,
    });
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.status).toBe("valid");
    expect(data.source).toBe("provider-ocr");

    /* Several Mexican banks issue the comprobante as a PDF and vision
       models take images, so this door stays alive on purpose (D2) */
    const [row] = await db().select().from(extractions);
    expect(row.source).toBe("provider-ocr");
    expect(row.outcome).toBe("routed");
    expect(row.model).toBeNull();
  });

  it("US-V02: with no AI binding the image route degrades to the provider's OCR", async () => {
    const { key } = await seedOwner();
    mockApiCep(settledResponse, (body) => {
      expectSignedProofUrl(body.imageUrl);
    });

    /* No bytes are fetched at all on this path — a door that still works
       beats a door that 502s when the reader is missing */
    const res = await postValidate(key, receiptRequest, { AI: undefined });
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.status).toBe("valid");
    expect(data.source).toBe("provider-ocr");
  });

  it("REQUEST_REJECTED: both doors at once is rejected before any provider call", async () => {
    const { key } = await seedOwner();
    const res = await postValidate(key, {
      ...directRequest,
      receipt: { proofKey: PROOF_KEY },
      beneficiary: { bank: "BANORTE", clabe: "072180001234567895" },
    });
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe("REQUEST_REJECTED");
  });
});

/* "API keys (D5)" — scenario 5, "a bad key and a revoked key both 401
   without touching the provider" — retired with the door
   (consta-api-merge D12, research R11): the engine has no key to present
   and no caller outside the API. */

/* Scenarios 16–20: refused at the edge, before a credit is spent.

   None of these register an interceptor. That is the assertion: `fetchMock`
   runs with net connect disabled, so a request that reached the provider
   could not answer 400 — it would surface as a 502 PROVIDER_ERROR instead. */
describe("Refused before a credit is spent (D12, D13)", () => {
  it("US-V07: a bank name off the vocabulary is refused with the vocabulary attached", async () => {
    /* consta-api-merge: the refusal stays; the `acceptedBanks` payload
       that rode it was a door feature for integrators, and the one
       caller left imports the same constant. */
    const { id: keyId, key } = await seedOwner();
    const res = await postValidate(key, {
      transfer: { ...directRequest.transfer, senderBank: "Nu" },
    });

    /* Measured 2026-08-19: apiCEP accepts "Nu", aliases it, and validates.
       We refuse it anyway — the tolerance is undocumented and its failure
       mode, a different real bank, is a silent `invalid` (D12). */
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("REQUEST_REJECTED");
    expect(error.issues!.some((i) => i.path === "transfer.senderBank")).toBe(true);
    /* D19: the envelope law — every error says whether waiting helps */
    expect(error.retryable).toBe(false);

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(0);
  });

  it("US-V07: the beneficiary's bank is held to the same vocabulary", async () => {
    const { key } = await seedOwner();
    const res = await postValidate(key, {
      transfer: {
        ...directRequest.transfer,
        beneficiary: { bank: "Banorte", clabe: "072180001234567895" },
      },
    });
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("REQUEST_REJECTED");
    expect(error.issues!.some((i) => i.path === "transfer.beneficiary.bank")).toBe(true);
  });

  it("US-V07: a tracking key carrying the line break a two-line receipt prints is refused", async () => {
    const { id: keyId, key } = await seedOwner();
    for (const bad of ["NU3AGIFAMA9D9CNQ V487MGAVDE2C", "NU3AGIFAMA9D9CNQ\nV487MGAVDE2C", "SHORT"]) {
      const res = await postValidate(key, {
        transfer: { ...directRequest.transfer, trackingKey: bad },
      });
      expect(res.ok).toBe(false);
    }
    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(0);
  });

  it("US-V07: surrounding whitespace is trimmed, not rejected — only the middle is meaningful", async () => {
    const { key } = await seedOwner();
    mockApiCep(settledResponse, (body) => {
      const sender = body.sender as Record<string, unknown>;
      expect(sender.trackingKey).toBe("MBAN01002508150012345678");
    });
    const res = await postValidate(key, {
      transfer: { ...directRequest.transfer, trackingKey: "  MBAN01002508150012345678\n" },
    });
    expect(res.ok).toBe(true);
  });

  it("US-V07, scenario 26: the same institution on both sides is refused free, with the real reason (D17)", async () => {
    const { id: keyId, key } = await seedOwner();
    /* Measured 2026-08-19: apiCEP rejects this with an envelope-shaped
       400 — and bills a credit for it. An intra-bank transfer never
       produces a SPEI CEP (Banxico's limit), so no retry, no rewording
       and no amount of waiting can ever validate it. */
    const res = await postValidate(key, {
      transfer: {
        ...directRequest.transfer,
        senderBank: "BANORTE",
        beneficiary: { bank: "BANORTE", clabe: "072180001234567895" },
      },
    });
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("REQUEST_REJECTED");
    expect(error.retryable).toBe(false);
    expect(error.issues!.some((i) => i.message.includes("same institution"))).toBe(true);

    /* No interceptor was registered: the whole point is that this never
       reaches the provider and never spends the credit it used to */
    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(0);
  });

  it("US-V07: a 10-character key is accepted — the check is a range, not Nu's 28", async () => {
    const { key } = await seedOwner();
    mockApiCep(settledResponse);
    /* apiCEP's own example key. A fixed 28 would lock out every bank that
       issues a shorter one, which is why that belongs in Devolada's schema
       and not in a product validating every Mexican bank (D13). */
    const res = await postValidate(key, {
      transfer: { ...directRequest.transfer, senderBank: "HSBC", trackingKey: "HSBC712057" },
    });
    expect(res.ok).toBe(true);
  });
});

/* docs/legacy/consta/proof-extraction.spec.md scenarios 1, 3–12. The reader is
   stubbed with the shapes the real model was measured producing on
   2026-08-19 — fenced JSON, and `esComprobante: false` on an image that
   is not a receipt (5/5). */
describe("The receipt is read at our edge (proof-extraction)", () => {
  it("scenario 1, 8: an image is read here and validated through direct mode", async () => {
    const { key } = await seedOwner();
    const aiCalls: unknown[] = [];
    await mockProof(PNG(), "image/png");
    mockApiCep(settledResponse, (body) => {
      /* The image never leaves Consta: what reaches apiCEP is a clave */
      expect(body.imageUrl).toBeUndefined();
      const sender = body.sender as Record<string, unknown>;
      expect(sender.trackingKey).toBe("MBAN01002508150012345678");
      expect(sender.bank).toBe("BBVA MEXICO");
      expect(sender.amount).toBe(514);
    });

    const res = await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING, aiCalls) });
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.status).toBe("valid");
    expect(data.source).toBe("reader");
    expect(data.extractionId).toEqual(expect.any(String));
    expect(aiCalls).toHaveLength(1);

    /* D8: the reading is tied to the paid call it bought */
    const [row] = await db().select().from(extractions);
    expect(row.outcome).toBe("passed");
    expect(row.validationId).toBe(data.validationId);
  });

  it("scenario 3: routing follows magic bytes, not the caller's content type", async () => {
    const { key } = await seedOwner();
    /* A PDF served as image/png must still take the PDF route: the route
       decides which reader sees the file, and a vision model handed a PDF
       produces confident nonsense. */
    await mockProof(PDF(), "image/png");
    mockApiCep(settledResponse, (body) => expectSignedProofUrl(body.imageUrl));

    const res = await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING) });
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.source).toBe("provider-ocr");
    const [row] = await db().select().from(extractions);
    expect(row.mediaType).toBe("application/pdf");
  });

  it("scenario 4: the gate catches a clave's shape — and cannot catch a plausible misread", async () => {
    const { id: keyId, key } = await seedOwner();

    /* Caught: BUG-006's live string, 29 characters with a space and a
       Cyrillic З where a 3 belongs. This is the failure that actually
       happens — receipts print the clave across two lines. */
    await mockProof(PNG(), "image/png");
    const bad = await postValidate(key, receiptRequest, {
      AI: aiReturning({ ...GOOD_READING, claveDeRastreo: "NU3AGKK16AH58LTOVUQH55PE З0AA" }),
    });
    expect(bad.ok).toBe(false);
    const error = bad.error!;
    expect(error.code).toBe("RECEIPT_INCOMPLETE");
    expect((error.reading!.gate as Record<string, string>).trackingKey).toBe("malformed");
    expect(error.retryable).toBe(false);

    /* NOT caught, and this test exists to keep us honest about it.
       llama's measured misread of `NU3AGKMP3ASP8QQQ4U8J8F0K1E4K` was
       `NU3AGKMP3ASP8QQ4U8J8F0K1E4K` — one Q short, 27 characters, every
       one of them alphanumeric. It passes `^[A-Za-z0-9]{6,30}$` because
       that check is a **range** on purpose (BUG-006: apiCEP's own example
       carries ten characters and a fixed 28 would lock out every bank
       that is not Nu). The gate checks shape; only the choice of model
       (D5) checks content, and a misread that survives here comes back
       from apiCEP as `not_found` — which now rides the schedule and
       carries `verify_inputs` rather than calling the payer a liar
       (validation.spec.md D11, direct-payment D17). */
    await mockProof(PNG(), "image/png");
    mockApiCep({
      validationId: "prov-uuid-13",
      status: "invalid",
      validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
    });
    const misread = await postValidate(key, receiptRequest, {
      AI: aiReturning({ ...GOOD_READING, claveDeRastreo: "NU3AGKMP3ASP8QQ4U8J8F0K1E4K" }),
    });
    expect(misread.ok).toBe(true);
    const { data } = misread;
    expect(data.status).toBe("invalid");
    expect(data.reason).toBe("not_found");
    expect(data.hint).toBe("verify_inputs");

    /* D9: the refusal is recorded and unbilled; the misread is recorded
       and billed, which is exactly the difference worth measuring */
    const rows = await db().select().from(extractions).where(eq(extractions.businessId, keyId));
    expect(rows.map((r) => r.outcome).sort()).toEqual(["gated", "passed"]);
    expect(await db().select().from(validations)).toHaveLength(1);
  });

  it("scenario 5: a bank that does not map is asked about, never guessed", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");

    const res = await postValidate(key, receiptRequest, {
      AI: aiReturning({ ...GOOD_READING, banco: "Banco Inventado" }),
    });
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("RECEIPT_INCOMPLETE");
    expect((error.reading!.gate as Record<string, string>).senderBank).toBe("unknown");
    /* Never a guess: apiCEP answers a wrong bank `invalid` with no
       cepDetails, which is indistinguishable from a transfer that never
       happened (validation.spec.md D12) */
    expect(error.reading!.senderBank).toBeNull();
    expect(await db().select().from(validations)).toHaveLength(0);
  });

  it("scenario 6: an image with no receipt in it costs one AI call, not seven paid ones", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");

    const res = await postValidate(key, receiptRequest, {
      AI: aiReturning({ esComprobante: false, claveDeRastreo: null, banco: null, monto: null }),
    });
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("RECEIPT_UNREADABLE");
    expect(error.retryable).toBe(false);

    /* The measured cost of this image today: apiCEP answers `error`,
       which is retryable, so the payment rides Devolada's whole six-hour
       schedule at up to seven paid calls and ends `expired`. */
    expect(await db().select().from(validations)).toHaveLength(0);
    const [row] = await db().select().from(extractions);
    expect(row.outcome).toBe("not_a_receipt");
  });

  it("scenario 7: /extract spends no apiCEP quota at all", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");

    const res = await postExtract(key, PROOF_KEY, { AI: aiReturning(GOOD_READING) });
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.source).toBe("reader");
    expect(data.trackingKey).toBe("MBAN01002508150012345678");
    expect(data.senderBank).toBe("BBVA MEXICO");
    expect(data.amountCents).toBe(51400);
    expect(data.receiptStatus).toBe("Aceptada");
    /* D15: `unknown` — BBVA has no graduated rule in this test's log */
    expect(data.gate).toEqual({ trackingKey: "ok", senderBank: "ok", amount: "ok", shape: "unknown" });

    /* No provider interceptor was registered, and none was needed: the
       whole promise of this door is that a caller can show a customer
       what was read before money moves (D6) */
    expect(await db().select().from(validations)).toHaveLength(0);
  });

  /* consta-api-merge US1 — rewritten from "scenario 9: http, a private
     address and an oversized file are refused before any reading". The
     two URL halves left with the URL door (D7): the engine reads the
     product's own bucket, so there is no address to refuse. What is a
     property of the bytes stays, and a key with no object behind it is
     the new refusal. */
  it("scenario 9: an oversized file, unrecognised bytes and a missing proof are refused before any reading", async () => {
    const { key } = await seedOwner();
    const ai = aiReturning(GOOD_READING);

    await mockProof(PNG(2 * 1024 * 1024), "image/png");
    const big = await postExtract(key, PROOF_KEY, { AI: ai });
    expect(big.ok).toBe(false);
    expect(big.error!.code).toBe("PROOF_TOO_LARGE");
    expect(big.error!.retryable).toBe(false);

    await mockProof(NOT_A_FILE(), "image/png");
    const junk = await postExtract(key, PROOF_KEY, { AI: ai });
    expect(junk.ok).toBe(false);
    expect(junk.error!.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    const missing = await postExtract(key, "link-1/never-uploaded", { AI: ai });
    expect(missing.ok).toBe(false);
    expect(missing.error!.code).toBe("PROOF_NOT_FOUND");
    expect(missing.error!.retryable).toBe(false);

    /* Every refusal is recorded — the rate this feature exists to drive
       down is not a rate if nobody writes it down (D9) */
    const rows = await db().select().from(extractions);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.outcome === "refused")).toBe(true);
  });

  it("scenario 10: the row carries the model, the raw output and a hash — never the image", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");

    await postExtract(key, PROOF_KEY, { AI: aiReturning(GOOD_READING) });

    const [row] = await db().select().from(extractions);
    expect(row.model).toBe("@cf/mistralai/mistral-small-3.1-24b-instruct");
    expect(row.proofSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.byteSize).toBe(64);
    expect(row.rawOutput).toContain("claveDeRastreo");
    /* D8: names, partial CLABEs and amounts on a receipt are the
       integrator's data under the integrator's retention policy */
    expect(JSON.stringify(row)).not.toContain("iVBOR");
    expect(Object.keys(row)).not.toContain("bytes");
  });

  it("scenario 11: the reading finds the CEP; only the CEP decides money", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");
    /* The reader says $1.00 and Banxico says $514.00. The response must
       carry Banxico's number — this is the `$1-receipt` hole, and the
       reading is a search key, never evidence (D3). */
    mockApiCep(settledResponse, (body) => {
      expect((body.sender as Record<string, unknown>).amount).toBe(1);
    });

    const res = await postValidate(key, receiptRequest, {
      AI: aiReturning({ ...GOOD_READING, monto: 1.0, fecha: "2020-01-01" }),
    });
    const data = res.data as Record<string, Record<string, unknown>>;
    expect(data.cep.amountCents).toBe(51400);
    expect(data.cep.date).toBe("2026-08-15");
  });

  it("scenario 12: a perfect reading and no CEP is still `not_found`, never a verdict of ours", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");
    mockApiCep({
      validationId: "prov-uuid-12",
      status: "invalid",
      validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
    });

    const res = await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING) });
    const { data } = res;
    /* The reading was flawless and it changes nothing: what Banxico did
       not say, we do not say either (D10, validation.spec.md D11) */
    expect(data.status).toBe("invalid");
    expect(data.reason).toBe("not_found");
    expect(data.hint).toBe("verify_inputs");
  });

  it("US-V10, scenario 13: every row records the sender bank on both doors (D13)", async () => {
    const { id: keyId, key } = await seedOwner();
    /* The transfer door used to record the clave and drop the bank, so
       the Banxico-confirmed (bank, clave) pair D13 derives shape from
       had to be reconstructed by prefix. Now it accumulates on its own. */
    mockApiCep(settledResponse);
    await postValidate(key, directRequest);
    await mockProof(PNG(), "image/png");
    mockApiCep(settledResponse);
    await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING) });

    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("valid");
      expect(row.senderBank).toBe("BBVA MEXICO");
    }
  });
});

describe("US-V11: the provider's reading is exposed (proof-extraction D11)", () => {
  /* The faceless invalid the measurement of 2026-08-26 captured: no
     cepDetails, no cepStatus — and the full `extracted` riding along. */
  const facelessWithExtracted = {
    validationId: "prov-uuid-v11",
    status: "invalid",
    confidence: 1,
    extracted: {
      senderBank: "Nubank",
      receiverBank: "KLAR",
      trackingKey: "NU3AHQZW04X9V7B2K5M8P1R6T3YC",
      referenceNumber: "260826",
      amount: 3.5,
      date: "2026-08-26",
      senderName: "PRUEBA QA",
      beneficiaryName: "CUENTA DE PRUEBA",
      paymentConcept: "Transferencia",
    },
    validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
  };

  it("providerOcr keeps the image on the OCR door and the reading survives failure", async () => {
    const { key } = await seedOwner();
    mockApiCep(facelessWithExtracted, (body) => {
      expectSignedProofUrl(body.imageUrl);
      expect(body.sender).toBeUndefined();
    });

    /* AI bound and deliberately unused: the caller asked for the
       provider's eyes, not a second pass of the same model */
    const res = await postValidate(
      key,
      { ...receiptRequest, providerOcr: true },
      { AI: aiReturning(GOOD_READING) },
    );
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.status).toBe("invalid");
    expect(data.reason).toBe("not_found");
    expect(data.source).toBe("provider-ocr");
    /* A reading, never a verdict: cents at our edge, names dropped */
    expect(data.reading).toEqual({
      trackingKey: "NU3AHQZW04X9V7B2K5M8P1R6T3YC",
      amountCents: 350,
      date: "2026-08-26",
      senderBank: "Nubank",
      referenceNumber: "260826",
    });
  });

  it("no extracted in the provider's answer → no reading in ours", async () => {
    const { key } = await seedOwner();
    mockApiCep({
      validationId: "prov-uuid-v11b",
      status: "invalid",
      validation: { banxicoConfirmed: false },
    });

    const res = await postValidate(key, { ...receiptRequest, providerOcr: true }, { AI: undefined });
    const { data } = res;
    expect(data.status).toBe("invalid");
    expect("reading" in data).toBe(false);
  });

  it("the transfer door never carries a reading — an echo is not a second opinion", async () => {
    const { key } = await seedOwner();
    /* apiCEP echoes `extracted` on direct mode too (measured on a
       business-rule 400 in apicep.md) — it must not surface as a reading */
    mockApiCep({ ...settledResponse, extracted: { trackingKey: "MBAN01002508150012345678" } });

    const res = await postValidate(key, directRequest);
    const { data } = res;
    expect(data.status).toBe("valid");
    expect("reading" in data).toBe(false);
  });

  it("providerOcr on the transfer door is refused before any credit", async () => {
    const { key } = await seedOwner();
    const res = await postValidate(key, { ...directRequest, providerOcr: true });
    expect(res.ok).toBe(false);
  });
});

/* docs/legacy/consta/proof-extraction.spec.md scenarios 14–17 (US-V17). The
   rules are derived from rows seeded straight into the log — the query
   is the feature, so nothing here is stubbed except the reader. */
describe("US-V17: the shape rules act (proof-extraction D14–D16)", () => {
  beforeEach(() => resetShapeRules());

  /* Azteca as measured 2026-08-30: 18 digits and a literal trailing I */
  const aztecaClave = (i: number) => `260831070865${String(690000 + i * 137).padStart(6, "0")}I`;
  /* The live pair: both alphanumeric, both inside D4's range, both spent */
  const DROPPED_I = "260831070865708465";
  const I_AS_ONE = "2608310708661202861";

  async function seedConfirmed(businessId: string, bank: string, claves: string[]) {
    await db()
      .insert(validations)
      .values(
        claves.map((trackingKey) => ({
          businessId,
          mode: "transfer" as const,
          status: "valid" as const,
          senderBank: bank,
          trackingKey,
          amountCents: 100,
          transferDate: "2026-08-30",
        })),
      );
    resetShapeRules();
  }

  const aztecaReading = (claveDeRastreo: string, banco: string | null = "AZTECA") => ({
    esComprobante: true,
    claveDeRastreo,
    banco,
    monto: 1.0,
    fecha: "2026-08-30",
    estatus: "Aceptada",
  });

  type Extracted = { data: { gate: Record<string, string>; suggestedBank?: string } };

  async function extractWith(key: string, reading: ReturnType<typeof aztecaReading>) {
    await mockProof(PNG(), "image/png");
    const res = await postExtract(key, PROOF_KEY, { AI: aiReturning(reading) });
    expect(res.ok).toBe(true);
    return res.data as unknown as Extracted["data"];
  }

  it("scenario 14: nine confirmed claves derive nothing; the tenth graduates with no deploy and no write", async () => {
    const { id: keyId, key } = await seedOwner();
    await seedConfirmed(keyId, "AZTECA", Array.from({ length: 9 }, (_, i) => aztecaClave(i)));
    expect((await extractWith(key, aztecaReading(DROPPED_I))).gate.shape).toBe("unknown");

    await seedConfirmed(keyId, "AZTECA", [aztecaClave(9)]);
    expect((await extractWith(key, aztecaReading(DROPPED_I))).gate.shape).toBe("mismatch");
  });

  it("scenario 15: a mismatch is a field on both doors — and /validate still proceeds and spends", async () => {
    const { id: keyId, key } = await seedOwner();
    await seedConfirmed(keyId, "AZTECA", Array.from({ length: 10 }, (_, i) => aztecaClave(i)));

    /* The I read as a 1: nineteen characters, every one alphanumeric */
    const data = await extractWith(key, aztecaReading(I_AS_ONE));
    expect(data.gate.trackingKey).toBe("ok");
    expect(data.gate.shape).toBe("mismatch");
    const [extraction] = await db().select().from(extractions);
    expect(extraction.shape).toBe("mismatch");

    /* Image door: the reading rides into the paid call unchanged */
    await mockProof(PNG(), "image/png");
    mockApiCep(settledResponse, (body) => {
      expect((body.sender as Record<string, unknown>).trackingKey).toBe(I_AS_ONE);
    });
    let res = await postValidate(key, receiptRequest, { AI: aiReturning(aztecaReading(I_AS_ONE)) });
    expect(res.ok).toBe(true);
    expect(res.data.shape).toBe("mismatch");

    /* Transfer door: where Azteca's credits were actually lost */
    mockApiCep(settledResponse);
    res = await postValidate(key, {
      transfer: { ...directRequest.transfer, senderBank: "AZTECA", trackingKey: DROPPED_I },
    });
    expect(res.ok).toBe(true);
    expect(res.data.shape).toBe("mismatch");

    const spent = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(spent).toHaveLength(12); // 10 seeds + 2 calls that spent
  });

  it("scenario 16: a bank with no graduated rule meets silence, not suspicion", async () => {
    const { id: keyId, key } = await seedOwner();
    await seedConfirmed(keyId, "AZTECA", Array.from({ length: 10 }, (_, i) => aztecaClave(i)));
    /* BBVA has no rule here; its clave is checked by the range alone */
    const data = await extractWith(key, { ...GOOD_READING, banco: "BBVA MEXICO" });
    expect(data.gate.shape).toBe("unknown");
    expect(data.suggestedBank).toBeUndefined();
  });

  it("scenario 17: a reading with no bank suggests the one bank its shape fits — and none when two fit", async () => {
    const { id: keyId, key } = await seedOwner();
    await seedConfirmed(keyId, "AZTECA", Array.from({ length: 10 }, (_, i) => aztecaClave(i)));

    /* Azteca's receipts print no bank name (measured 2026-08-30) */
    let data = await extractWith(key, aztecaReading(aztecaClave(3), null));
    expect(data.gate.senderBank).toBe("missing");
    expect(data.gate.shape).toBe("unknown");
    expect(data.suggestedBank).toBe("AZTECA");
    const [extraction] = await db().select().from(extractions);
    expect(extraction.suggestedBank).toBe("AZTECA");

    /* A reading that names its bank is never second-guessed by shape */
    data = await extractWith(key, aztecaReading(aztecaClave(3)));
    expect(data.suggestedBank).toBeUndefined();

    /* A second bank with the same shape: shape is not a fingerprint */
    await seedConfirmed(keyId, "KLAR", Array.from({ length: 10 }, (_, i) => aztecaClave(100 + i)));
    data = await extractWith(key, aztecaReading(aztecaClave(3), null));
    expect(data.gate.senderBank).toBe("missing");
    expect(data.suggestedBank).toBeUndefined();
  });
});
