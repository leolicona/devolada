import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { gateReading, resetShapeRules } from "../../src/consta/extraction";
import { compareReadings, type OurReading, type ProviderReading } from "../../src/consta/extraction/compare";
import { deriveShapeRules } from "../../src/consta/extraction/shape";
import type { Reading } from "../../src/consta/extraction/reader";
import { consta, ConstaError, type ConstaRequest } from "../../src/consta";
import type { Bindings } from "../../src/env";
import {
  aiReturning,
  db,
  engineEnv,
  extractions,
  JPEG,
  NOT_A_FILE,
  PDF,
  PNG,
  putProof,
  RECEIPT_TEXT,
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

  /* two-eyes-receipt US1, D12 — rewritten from "US-V06, scenario 13: an
     unreadable receipt names the missing fields, and never rides a
     schedule". The provider's own OCR failure used to *throw* on every
     path; the lifecycle recorded a code, rode the schedule, and nothing
     ever learned that the provider had been blind. On a provider-first
     call it is now a `not_found` verdict with a blind classification.
     The failure itself, with its `missingFields`, survives on the legacy
     `providerOcr` cross, which the scenario below keeps. */
  it("two-eyes-receipt US1: the provider's unreadable answer is a blind verdict, and the call is still billed", async () => {
    const { id: keyId, key } = await seedOwner();
    const missing = ["fecha de la operación", "clave de rastreo o número de referencia"];
    mockApiCep({
      validationId: "prov-uuid-ocr",
      status: "error",
      error: "El OCR no pudo extraer los siguientes datos obligatorios",
      missingFields: missing,
    });

    /* No AI binding either, so neither side read anything: blind on both */
    const res = await postValidate(key, receiptRequest, { AI: undefined });
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.status).toBe("invalid");
    expect(data.reason).toBe("not_found");
    expect(data.readingCheck).toBe("blind");
    expect(data.blindSide).toBe("both");
    expect(data.accepted).toBeNull();
    expect(data.ourReading).toBeNull();

    /* The OCR ran, so the call was billed and belongs in the log (D15) */
    const rows = await db().select().from(validations).where(eq(validations.businessId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBeNull();
    expect(rows[0].mode).toBe("receipt");

    /* D19: a paid call always leaves a reading record, even one that
       read nothing — and it says why */
    const [row] = await db().select().from(extractions);
    expect(row.source).toBe("provider-ocr");
    expect(row.rawOutput).toBe("no-binding");
    expect(row.readingCheck).toBe("blind");
    expect(row.validationId).toBe(rows[0].id);
  });

  it("two-eyes-receipt US1: our complete reading survives the provider going blind (D12, FR-013)", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");
    mockApiCep({
      validationId: "prov-uuid-ocr2",
      status: "error",
      error: "El OCR no pudo extraer los siguientes datos obligatorios",
      missingFields: ["clave de rastreo"],
    });

    const res = await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING) });
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.readingCheck).toBe("blind");
    expect(data.blindSide).toBe("provider");
    expect(data.acceptedFrom).toBe("reader");
    /* The next attempt takes the transfer door with this, and the payer
       is never asked to retype what we already read */
    expect(data.accepted).toEqual({
      trackingKey: "MBAN01002508150012345678",
      senderBank: "BBVA MEXICO",
      amountCents: 51400,
      date: "2026-08-15",
    });
  });

  it("US-V06, scenario 13: the legacy cross still gets the named missing fields, and never rides a schedule", async () => {
    const { key } = await seedOwner();
    const missing = ["fecha de la operación", "clave de rastreo o número de referencia"];
    mockApiCep({
      validationId: "prov-uuid-ocr3",
      status: "error",
      error: "El OCR no pudo extraer los siguientes datos obligatorios",
      missingFields: missing,
    });

    /* D16: `providerOcr` is the minute-two cross of a payment born
       before the cut-over. Its caller holds a reading of its own and
       classifies for itself, so the failure still travels as a failure. */
    const res = await postValidate(key, { ...receiptRequest, providerOcr: true }, { AI: undefined });
    expect(res.ok).toBe(false);
    const error = res.error!;
    expect(error.code).toBe("RECEIPT_UNREADABLE");
    expect(error.retryable).toBe(false);
    /* Verbatim: this is the one OCR failure apiCEP names out loud, and
       the difference between "Verificando tu pago" for six hours and
       "falta la fecha en tu comprobante" in seconds */
    expect(error.missingFields).toEqual(missing);
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
  /* two-eyes-receipt US1, D3 — rewritten from "scenario 1, 8: an image
     is read here and validated through direct mode". The image used to
     become a clave and buy a transfer-door lookup; the provider's own
     eyes arrived only on a second credit. Now the file itself goes to
     the image door on the first credit with our reading beside it. */
  it("two-eyes-receipt US1: the file goes to the provider's image door, and our reading rides beside it", async () => {
    const { key } = await seedOwner();
    const aiCalls: unknown[] = [];
    await mockProof(PNG(), "image/png");
    mockApiCep(settledResponse, (body) => {
      /* The provider reads the file itself, through the short-lived link
         the engine signed for it (D12, consta-api-merge D7) */
      expectSignedProofUrl(body.imageUrl);
      expect(body.sender).toBeUndefined();
    });

    const res = await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING, aiCalls) });
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.status).toBe("valid");
    /* The credit went to the provider's image door, so that is the
       source; what *we* read travels separately (D3) */
    expect(data.source).toBe("provider-ocr");
    expect(data.extractionId).toEqual(expect.any(String));
    /* One reading, one model call — and it is the same one the page's
       draft would have made (D14 covers the reuse) */
    expect(aiCalls).toHaveLength(1);

    /* D8: the reading is tied to the paid call it bought. It is written
       after the answer now, so it can carry the comparison too (D19). */
    const [row] = await db().select().from(extractions);
    expect(row.source).toBe("reader");
    expect(row.outcome).toBe("passed");
    expect(row.validationId).toBe(data.validationId);
    /* `valid` needs no second opinion: the CEP decided (D5) */
    expect(row.readingCheck).toBeNull();
  });

  it("two-eyes-receipt US1: `not_found` carries the classification and the accepted data", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");
    mockApiCep({
      validationId: "prov-uuid-nf",
      status: "invalid",
      validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
      /* The provider read the same receipt we did — the case the whole
         feature turns on (measured 2026-08-26: `extracted` survives a
         faceless `invalid`) */
      extracted: {
        trackingKey: "MBAN01002508150012345678",
        amount: 514.0,
        date: "2026-08-15",
        senderBank: "BBVA MEXICO",
      },
    });

    const res = await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING) });
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.status).toBe("invalid");
    expect(data.reason).toBe("not_found");
    expect(data.readingCheck).toBe("agreed");
    expect(data.acceptedFrom).toBe("agreed");
    expect(data.disputedFields).toEqual([]);
    expect(data.accepted).toEqual({
      trackingKey: "MBAN01002508150012345678",
      senderBank: "BBVA MEXICO",
      amountCents: 51400,
      date: "2026-08-15",
    });
    expect(data.ourReading).toEqual({
      trackingKey: "MBAN01002508150012345678",
      senderBank: "BBVA MEXICO",
      amountCents: 51400,
      date: "2026-08-15",
      legibility: null,
    });

    /* D19: one row carries both readings and what they settled, for a
       business payment and a platform top-up alike */
    const [row] = await db().select().from(extractions);
    expect(row.readingCheck).toBe("agreed");
    expect(row.acceptedFrom).toBe("agreed");
    expect(row.disputedFields).toBeNull();
    expect(row.providerTrackingKey).toBe("MBAN01002508150012345678");
    expect(row.providerAmountCents).toBe(51400);
  });

  it("two-eyes-receipt US1: the draft's reading is reused within 15 minutes, and re-read after (D14)", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");
    const calls: unknown[] = [];
    const ai = aiReturning(GOOD_READING, calls);

    /* The page's draft: `/read` reads the file and records it */
    const draft = await postExtract(key, PROOF_KEY, { AI: ai });
    expect(draft.ok).toBe(true);
    expect(calls).toHaveLength(1);

    /* The paid attempt carries only the file (D13), so without reuse the
       engine would read the same bytes a second time, ~2.7 s later */
    mockApiCep(settledResponse);
    const paid = await postValidate(key, receiptRequest, { AI: ai });
    expect(paid.ok).toBe(true);
    expect(calls).toHaveLength(1);

    const rows = await db().select().from(extractions);
    expect(rows).toHaveLength(2);
    const reused = rows.find((r) => r.validationId !== null)!;
    /* The row says which draft it came from, rather than copying a raw
       answer that was never produced for this call */
    expect(reused.rawOutput).toContain("reused from extraction");
    expect(reused.trackingKey).toBe("MBAN01002508150012345678");
    expect(reused.amountCents).toBe(51400);
  });

  it("two-eyes-receipt US1: with no AI binding the file still goes to the provider, and a not_found is blind on our side", async () => {
    const { key } = await seedOwner();
    mockApiCep(
      {
        validationId: "prov-uuid-blindus",
        status: "invalid",
        validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
        extracted: {
          trackingKey: "MBAN01002508150012345678",
          amount: 514.0,
          date: "2026-08-15",
          senderBank: "BBVA MEXICO",
        },
      },
      (body) => expectSignedProofUrl(body.imageUrl),
    );

    /* No bytes are fetched at all on this path — a door that still works
       beats a door that 502s when the reader is missing (constitution
       VIII). The payer never blocks, and the provider's reading alone
       carries the payment forward (FR-005). */
    const res = await postValidate(key, receiptRequest, { AI: undefined });
    expect(res.ok).toBe(true);
    const { data } = res;
    expect(data.ourReading).toBeNull();
    expect(data.readingCheck).toBe("blind");
    expect(data.blindSide).toBe("reader");
    expect(data.acceptedFrom).toBe("provider");
  });

  it("scenario 3: routing follows magic bytes, not the caller's content type", async () => {
    const { key } = await seedOwner();
    /* A PDF served as image/png must still take the PDF route: the route
       decides *how* the file is read, and a vision model handed a PDF
       produces confident nonsense. two-eyes-receipt D1: the PDF route is
       text-then-read now rather than hand-it-over, so the assertion that
       changed is the outcome — a reader row, with the media type the
       bytes actually are — and the magic-byte point is unchanged. */
    await mockProof(PDF(), "image/png");
    mockApiCep(settledResponse, (body) => expectSignedProofUrl(body.imageUrl));

    const res = await postValidate(key, receiptRequest, {
      AI: aiReturning(GOOD_READING, undefined, { pdfText: RECEIPT_TEXT }),
    });
    expect(res.ok).toBe(true);
    const [row] = await db().select().from(extractions);
    expect(row.mediaType).toBe("application/pdf");
    expect(row.source).toBe("reader");
    /* The text prompt read it, not the vision prompt */
    expect(row.rawOutput).toContain("claveDeRastreo");
  });

  it("scenario 4: the gate catches a clave's shape — and cannot catch a plausible misread", async () => {
    const { id: keyId, key } = await seedOwner();

    /* Caught: BUG-006's live string, 29 characters with a space and a
       Cyrillic З where a 3 belongs. This is the failure that actually
       happens — receipts print the clave across two lines. */
    await mockProof(PNG(), "image/png");
    /* two-eyes-receipt D3/FR-005: a hole no longer refuses. It used to
       throw `RECEIPT_INCOMPLETE` and send the payer to a form before
       anybody had been asked anything; now it rides to the provider,
       whose own reading may fill it for free. What the gate said is
       still recorded, and it is what keeps this misread from arguing
       with the provider's reading later (D5). */
    mockApiCep(
      {
        validationId: "prov-uuid-gated",
        status: "invalid",
        validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
      },
      (body) => expectSignedProofUrl(body.imageUrl),
    );
    const bad = await postValidate(key, receiptRequest, {
      AI: aiReturning({ ...GOOD_READING, claveDeRastreo: "NU3AGKK16AH58LTOVUQH55PE З0AA" }),
    });
    expect(bad.ok).toBe(true);
    /* The malformed clave is a hole on our side, never a reading: the
       verdict carries null where the gate refused (D5) */
    expect((bad.data.ourReading as Record<string, unknown>).trackingKey).toBeNull();
    expect(bad.data.readingCheck).toBe("blind");
    expect((await db().select().from(extractions))[0].gateTrackingKey).toBe("malformed");

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
       (validation.spec.md D11, direct-payment D17).

       A different file, deliberately: two readings of the *same* bytes
       by the same owner inside fifteen minutes are one reading now
       (D14), so seeding a second stub against the first file would
       silently re-test the first. Two different receipts have different
       bytes in life; they need different bytes here too. */
    await mockProof(PNG(80), "image/png");
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

    /* Both were recorded and both were billed now (D3): the difference
       worth measuring moved from "refused vs billed" to what the two
       readings said about each other, which lives on the same rows. */
    const rows = await db().select().from(extractions).where(eq(extractions.businessId, keyId));
    expect(rows.map((r) => r.outcome).sort()).toEqual(["gated", "passed"]);
    expect(await db().select().from(validations)).toHaveLength(2);
  });

  it("scenario 5: a bank that does not map is never guessed — and since D3 it goes to the provider anyway", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");
    mockApiCep(
      {
        validationId: "prov-uuid-nobank",
        status: "invalid",
        validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
        /* And the provider's own reading names the bank ours could not,
           which is exactly the hole it can fill for free (FR-005) */
        extracted: {
          trackingKey: "MBAN01002508150012345678",
          amount: 514.0,
          date: "2026-08-15",
          senderBank: "BBVA MEXICO",
        },
      },
      (body) => expectSignedProofUrl(body.imageUrl),
    );

    const res = await postValidate(key, receiptRequest, {
      AI: aiReturning({ ...GOOD_READING, banco: "Banco Inventado" }),
    });
    expect(res.ok).toBe(true);
    const { data } = res;
    /* Never a guess: apiCEP answers a wrong bank `invalid` with no
       cepDetails, which is indistinguishable from a transfer that never
       happened (validation.spec.md D12). So an unmappable name is null
       on our side, and the *other* reading supplies it. */
    expect((data.ourReading as Record<string, unknown>).senderBank).toBeNull();
    expect((await db().select().from(extractions))[0].gateSenderBank).toBe("unknown");
    expect(data.readingCheck).toBe("agreed");
    expect((data.accepted as Record<string, unknown>).senderBank).toBe("BBVA MEXICO");
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
       carry Banxico's number — this is the `$1-receipt` hole, and a
       reading is a search key, never evidence (D3). Since
       two-eyes-receipt D3 the search key is the file itself: the
       provider reads it and looks the record up, so the $1 no longer
       travels as `sender.amount` and the principle is unchanged. */
    mockApiCep(settledResponse, (body) => {
      expectSignedProofUrl(body.imageUrl);
      expect(body.sender).toBeUndefined();
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
    /* two-eyes-receipt D5: the provider read nothing off this image, so
       the verdict is blind on its side — and our flawless reading is
       what the next attempt carries (FR-013) */
    expect(data.readingCheck).toBe("blind");
    expect(data.blindSide).toBe("provider");
    expect(data.acceptedFrom).toBe("reader");
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

    /* Image door: the mismatch rides into the paid call as a field and
       stops nothing (D15). Since two-eyes-receipt D3 what travels is the
       file, not the clave — so the assertion moved from the request body
       to the verdict, where the shape verdict always was. */
    await mockProof(PNG(), "image/png");
    mockApiCep(settledResponse, (body) => {
      expectSignedProofUrl(body.imageUrl);
      expect(body.sender).toBeUndefined();
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

/* two-eyes-receipt US1 — the comparison itself, row by row.

   `compareReadings` is a pure function over (our gated reading, the
   provider's reading, the shape rules), so these scenarios need no
   database and no provider: the rules are built from the same ten
   confirmed claves `loadShapeRules` would derive them from, through the
   same `deriveShapeRules` it calls. What is under test is the decision
   table of research R3, not the loading. */
describe("two-eyes-receipt US1: the comparison", () => {
  /* Azteca as measured 2026-08-30: 18 digits and a literal trailing I.
     Ten of one length is what graduates a rule (GRADUATION_SAMPLES). */
  const aztecaClave = (i: number) => `260831070865${String(690000 + i * 137).padStart(6, "0")}I`;
  const AZTECA_RULES = deriveShapeRules(
    Array.from({ length: 10 }, (_, i) => ({ senderBank: "AZTECA", trackingKey: aztecaClave(i) })),
  );
  /* Fits the graduated shape; the other one has a digit where the rule
     wants the literal I — the live misread of 2026-08-30. */
  const FITS = "260831070865999999I";
  const MISFITS = "2608310708659999991";

  /* Our side goes through the real gate, so "present" here means exactly
     what it means in the engine: the field passed (D5). */
  const ourReading = (over: Partial<Reading> = {}): OurReading => {
    const reading: Reading = {
      isReceipt: true,
      legibility: "full",
      trackingKey: FITS,
      senderBank: "AZTECA",
      amount: 514.0,
      date: "2026-08-30",
      status: "Aceptada",
      raw: "",
      model: "test",
      ...over,
    };
    return { ...gateReading(reading), date: reading.date, legibility: reading.legibility };
  };

  const theirReading = (over: Partial<ProviderReading> = {}): ProviderReading => ({
    trackingKey: FITS,
    amountCents: 51400,
    date: "2026-08-30",
    senderBank: "AZTECA",
    ...over,
  });

  it("both read the same clave and the same cents: agreed, and the data is accepted", () => {
    const c = compareReadings(ourReading(), theirReading(), AZTECA_RULES);
    expect(c.readingCheck).toBe("agreed");
    expect(c.disputedFields).toEqual([]);
    expect(c.blindSide).toBeNull();
    expect(c.acceptedFrom).toBe("agreed");
    expect(c.accepted).toEqual({
      trackingKey: FITS,
      senderBank: "AZTECA",
      amountCents: 51400,
      date: "2026-08-30",
    });
  });

  it("they differ and only our clave fits the bank's shape: ours is taken, nobody is asked", () => {
    const c = compareReadings(
      ourReading(),
      theirReading({ trackingKey: MISFITS }),
      AZTECA_RULES,
    );
    expect(c.readingCheck).toBe("disputed");
    expect(c.acceptedFrom).toBe("reader");
    expect(c.accepted?.trackingKey).toBe(FITS);
    expect(c.disputedFields).toEqual([]);
  });

  it("they differ and only theirs fits: theirs is taken, and no field is asked for", () => {
    const c = compareReadings(
      ourReading({ trackingKey: MISFITS }),
      theirReading(),
      AZTECA_RULES,
    );
    expect(c.readingCheck).toBe("disputed");
    expect(c.acceptedFrom).toBe("provider");
    expect(c.accepted?.trackingKey).toBe(FITS);
    expect(c.disputedFields).toEqual([]);
  });

  it("they differ and the bank has no rule yet: the payer is asked for the clave alone", () => {
    /* Cold start is the common case (GRADUATION_SAMPLES per bank), and
       D8 says the ask names the field in doubt and nothing else. */
    const c = compareReadings(ourReading(), theirReading({ trackingKey: MISFITS }), []);
    expect(c.readingCheck).toBe("disputed");
    expect(c.accepted).toBeNull();
    expect(c.acceptedFrom).toBeNull();
    expect(c.disputedFields).toEqual(["trackingKey"]);
  });

  it("they differ and both claves fit the shape: no tiebreak, the payer decides", () => {
    /* A shape is not a fingerprint — two real claves of one bank fit it
       by construction, so fitting cannot single one out. */
    const c = compareReadings(
      ourReading(),
      theirReading({ trackingKey: aztecaClave(3) }),
      AZTECA_RULES,
    );
    expect(c.readingCheck).toBe("disputed");
    expect(c.accepted).toBeNull();
    expect(c.disputedFields).toEqual(["trackingKey"]);
  });

  it("they differ and neither clave fits: no tiebreak either", () => {
    const c = compareReadings(
      ourReading({ trackingKey: MISFITS }),
      theirReading({ trackingKey: "2608310708659999992" }),
      AZTECA_RULES,
    );
    expect(c.readingCheck).toBe("disputed");
    expect(c.accepted).toBeNull();
    expect(c.disputedFields).toEqual(["trackingKey"]);
  });

  it("the amount differs while the clave agrees: only the amount is asked for", () => {
    const c = compareReadings(ourReading(), theirReading({ amountCents: 9900 }), AZTECA_RULES);
    expect(c.readingCheck).toBe("disputed");
    expect(c.disputedFields).toEqual(["amount"]);
  });

  it("the provider read no clave and ours is complete: blind on their side, ours goes on", () => {
    const c = compareReadings(
      ourReading(),
      theirReading({ trackingKey: null, amountCents: null, senderBank: null, date: null }),
      AZTECA_RULES,
    );
    expect(c.readingCheck).toBe("blind");
    expect(c.blindSide).toBe("provider");
    expect(c.acceptedFrom).toBe("reader");
    expect(c.accepted?.trackingKey).toBe(FITS);
    expect(c.disputedFields).toEqual([]);
  });

  it("the provider read no clave and ours has a hole: blind on both sides, the payer is asked", () => {
    const c = compareReadings(
      ourReading({ amount: null }),
      theirReading({ trackingKey: null, amountCents: null, senderBank: null, date: null }),
      AZTECA_RULES,
    );
    expect(c.readingCheck).toBe("blind");
    expect(c.blindSide).toBe("both");
    expect(c.accepted).toBeNull();
    expect(c.disputedFields).toEqual(["amount"]);
  });

  it("we read nothing and their clave fits: blind on ours, theirs goes on", () => {
    const c = compareReadings(null, theirReading(), AZTECA_RULES);
    expect(c.readingCheck).toBe("blind");
    expect(c.blindSide).toBe("reader");
    expect(c.acceptedFrom).toBe("provider");
    expect(c.accepted?.trackingKey).toBe(FITS);
  });

  it("we read nothing and their clave contradicts the bank's shape: the payer is asked", () => {
    const c = compareReadings(null, theirReading({ trackingKey: MISFITS }), AZTECA_RULES);
    expect(c.readingCheck).toBe("blind");
    expect(c.blindSide).toBe("reader");
    expect(c.accepted).toBeNull();
    expect(c.disputedFields).toContain("trackingKey");
  });

  it("we read nothing and the bank has no rule: theirs is taken — cold start is not suspicion", () => {
    const c = compareReadings(null, theirReading(), []);
    expect(c.readingCheck).toBe("blind");
    expect(c.blindSide).toBe("reader");
    expect(c.acceptedFrom).toBe("provider");
    expect(c.accepted?.trackingKey).toBe(FITS);
  });

  it("neither side read a clave: blind on both, and nothing was accepted", () => {
    const c = compareReadings(null, null, AZTECA_RULES);
    expect(c.readingCheck).toBe("blind");
    expect(c.blindSide).toBe("both");
    expect(c.accepted).toBeNull();
    expect(c.disputedFields).toEqual(["trackingKey", "amount"]);
  });

  it("a bank-name or date difference never disputes (reading-check D2, kept)", () => {
    /* Banks spell their own name a dozen ways and print the date in as
       many formats; neither decides which Banxico record is asked about. */
    const c = compareReadings(
      ourReading(),
      theirReading({ senderBank: "Banco Azteca", date: "30/08/2026" }),
      AZTECA_RULES,
    );
    expect(c.readingCheck).toBe("agreed");
    expect(c.disputedFields).toEqual([]);
  });

  it("a malformed clave on our side raises no dispute — it is a hole, not a second opinion (D5)", () => {
    /* Four characters cannot be a clave (the gate's range is 6–30), so
       the gate calls it malformed and this side simply has no vote. */
    const c = compareReadings(ourReading({ trackingKey: "AB12" }), theirReading(), AZTECA_RULES);
    expect(c.readingCheck).toBe("blind");
    expect(c.blindSide).toBe("reader");
    expect(c.acceptedFrom).toBe("provider");
    expect(c.accepted?.trackingKey).toBe(FITS);
  });

  it("D20: agreement with no date on either side is still agreed, and asks for the date alone", () => {
    /* The transfer door is never called with a date nobody read, and an
       agreed reading still retires the clock — so the ask is one field. */
    const c = compareReadings(
      ourReading({ date: null }),
      theirReading({ date: null }),
      AZTECA_RULES,
    );
    expect(c.readingCheck).toBe("agreed");
    expect(c.acceptedFrom).toBe("agreed");
    expect(c.accepted?.date).toBeNull();
    expect(c.disputedFields).toEqual(["date"]);
  });

  it("D20: the date comes from whichever side read one — ours first", () => {
    expect(compareReadings(ourReading({ date: null }), theirReading(), AZTECA_RULES).accepted?.date).toBe(
      "2026-08-30",
    );
    expect(
      compareReadings(ourReading({ date: "2026-08-29" }), theirReading(), AZTECA_RULES).accepted?.date,
    ).toBe("2026-08-29");
  });

  it("a hole on our side is filled by theirs rather than asked about (D5)", () => {
    /* We read the clave but not the amount: nothing disagrees, so the
       amount simply comes from the reading that has one. */
    const c = compareReadings(ourReading({ amount: null }), theirReading(), AZTECA_RULES);
    expect(c.readingCheck).toBe("agreed");
    expect(c.accepted?.amountCents).toBe(51400);
    expect(c.disputedFields).toEqual([]);
  });
});

/* two-eyes-receipt US2 — the gate before spending.

   Exactly two readings refuse a file before a provider credit is spent:
   it is not a receipt, and nothing on it can be read. Everything else
   goes through with its hole (FR-005), because a wrongly blocked photo
   costs the payer a step while a wrongly passed one costs a credit the
   comparison with the provider may still salvage.

   None of the refusal scenarios registers a provider interceptor. That
   is the assertion: `fetchMock` runs with net connect disabled, so a
   request that reached the provider could not answer at all. */
describe("two-eyes-receipt US2: the gate before spending", () => {
  it("an image that is not a receipt spends nothing, and the row says which refusal it was", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");

    const res = await postValidate(key, receiptRequest, {
      AI: aiReturning({ esComprobante: false, claveDeRastreo: null, banco: null, monto: null }),
    });
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe("RECEIPT_UNREADABLE");
    expect(res.error!.retryable).toBe(false);

    expect(await db().select().from(validations)).toHaveLength(0);
    const [row] = await db().select().from(extractions);
    expect(row.outcome).toBe("not_a_receipt");
    /* D10: `validation_id IS NULL` on every refusal row is what makes
       "refused, and no credit spent" one query */
    expect(row.validationId).toBeNull();
  });

  it("a photo nothing can be read from is its own refusal, and costs nothing either", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");

    const res = await postValidate(key, receiptRequest, {
      AI: aiReturning({
        esComprobante: true,
        legibilidad: "nula",
        claveDeRastreo: null,
        banco: null,
        monto: null,
      }),
    });
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe("RECEIPT_UNREADABLE");

    expect(await db().select().from(validations)).toHaveLength(0);
    const [row] = await db().select().from(extractions);
    /* Countable apart from `not_a_receipt`: the two ask the payer for
       different things — a different file, or a better photo */
    expect(row.outcome).toBe("illegible");
    expect(row.legibility).toBe("none");
    expect(row.validationId).toBeNull();
  });

  it("a partly legible photo with a hole in it still buys the paid call (FR-005)", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");
    mockApiCep(settledResponse, (body) => {
      expectSignedProofUrl(body.imageUrl);
      expect(body.sender).toBeUndefined();
    });

    const res = await postValidate(key, receiptRequest, {
      AI: aiReturning({ ...GOOD_READING, legibilidad: "parcial", claveDeRastreo: null }),
    });
    expect(res.ok).toBe(true);
    expect(res.data.status).toBe("valid");
    const [row] = await db().select().from(extractions);
    expect(row.legibility).toBe("partial");
    expect(row.outcome).toBe("gated");
    expect(row.validationId).toBe(res.data.validationId);
  });

  it("a model answer with no JSON in it is our problem, never the payer's", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");
    mockApiCep(
      {
        validationId: "prov-uuid-unparseable",
        status: "invalid",
        validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
      },
      (body) => expectSignedProofUrl(body.imageUrl),
    );

    /* This used to throw READER_UNREADABLE and the file never reached
       the provider at all (D15, FR-005) */
    const res = await postValidate(key, receiptRequest, { AI: aiReturning("I am terribly sorry") });
    expect(res.ok).toBe(true);
    expect(res.data.ourReading).toBeNull();
    expect(res.data.readingCheck).toBe("blind");
    const [row] = await db().select().from(extractions);
    expect(row.source).toBe("provider-ocr");
    expect(row.rawOutput).toBe("unreadable");
  });

  it("the reading door reports legibility and refuses nobody", async () => {
    const { key } = await seedOwner();
    await mockProof(PNG(), "image/png");

    const partial = await postExtract(key, PROOF_KEY, {
      AI: aiReturning({ ...GOOD_READING, legibilidad: "parcial" }),
    });
    expect(partial.ok).toBe(true);
    expect(partial.data.legibility).toBe("partial");

    /* Even `none` is reported, not thrown: this endpoint cannot reject
       anybody (FR-004) — the *page* is what refuses on it */
    await mockProof(JPEG(), "image/jpeg");
    const none = await postExtract(key, PROOF_KEY, {
      AI: aiReturning({ esComprobante: true, legibilidad: "nula", claveDeRastreo: null, banco: null, monto: null }),
    });
    expect(none.ok).toBe(true);
    expect(none.data.legibility).toBe("none");
    expect(await db().select().from(validations)).toHaveLength(0);
  });
});

/* two-eyes-receipt US3 — a PDF read at the edge.

   `toMarkdown` is stubbed on the same binding `run` is: the binding is
   the one thing a test stands in for (constitution IV), and that covers
   both of its doors. `pdfText` seeds what the conversion would return —
   receipt text for a text PDF, the empty string for a scanned one. */
describe("two-eyes-receipt US3: a PDF read at the edge", () => {
  it("a text PDF produces the same draft a picture does, and takes the same flow", async () => {
    const { key } = await seedOwner();
    await mockProof(PDF(), "application/pdf");
    const calls: unknown[] = [];
    const ai = aiReturning(GOOD_READING, calls, { pdfText: RECEIPT_TEXT });

    const draft = await postExtract(key, PROOF_KEY, { AI: ai });
    expect(draft.ok).toBe(true);
    /* D1: `reader`, not `provider-ocr` — the payer sees a draft */
    expect(draft.data.source).toBe("reader");
    expect(draft.data.trackingKey).toBe("MBAN01002508150012345678");
    expect(draft.data.senderBank).toBe("BBVA MEXICO");
    expect(draft.data.amountCents).toBe(51400);
    /* D15: no photograph to judge */
    expect(draft.data.legibility).toBeNull();

    const [row] = await db().select().from(extractions);
    expect(row.source).toBe("reader");
    expect(row.mediaType).toBe("application/pdf");
    expect(row.outcome).toBe("passed");

    /* One conversion and one reading, and the reading was of the text:
       no image part travelled to the model */
    expect(calls).toHaveLength(2);
    expect(calls[0]).toHaveProperty("toMarkdown");
    expect(JSON.stringify(calls[1])).toContain("text extracted from a Mexican bank transfer receipt PDF");
    expect(JSON.stringify(calls[1])).not.toContain("image_url");
  });

  it("a text PDF goes provider-first with our reading beside it, like any other receipt", async () => {
    const { key } = await seedOwner();
    await mockProof(PDF(), "application/pdf");
    mockApiCep(
      {
        validationId: "prov-uuid-pdf",
        status: "invalid",
        validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
      },
      (body) => expectSignedProofUrl(body.imageUrl),
    );

    const res = await postValidate(key, receiptRequest, {
      AI: aiReturning(GOOD_READING, undefined, { pdfText: RECEIPT_TEXT }),
    });
    expect(res.ok).toBe(true);
    expect(res.data.ourReading).not.toBeNull();
    /* The provider read nothing off it, we read all of it: the payment
       carries our reading to the transfer door next (FR-013) */
    expect(res.data.readingCheck).toBe("blind");
    expect(res.data.blindSide).toBe("provider");
    expect(res.data.acceptedFrom).toBe("reader");
  });

  /* Retired by name: "US-V02, scenario 2: a PDF keeps the provider's OCR
     door, untouched". Its behaviour is gone by D1 — a PDF is read here
     now. What was worth keeping from it is below: a PDF with nothing to
     read still reaches the provider, silently. */
  it("a scanned PDF continues with an empty reading, and nobody is told (D15)", async () => {
    const { key } = await seedOwner();
    await mockProof(PDF(), "application/pdf");
    /* An empty conversion: the file has no text in it */
    const ai = aiReturning(GOOD_READING, undefined, { pdfText: "" });

    const draft = await postExtract(key, PROOF_KEY, { AI: ai });
    expect(draft.ok).toBe(true);
    expect(draft.data.source).toBe("provider-ocr");
    expect(draft.data.trackingKey).toBeNull();
    expect(draft.data.isReceipt).toBeNull();
    expect(draft.data.legibility).toBeNull();
    const [routed] = await db().select().from(extractions);
    expect(routed.outcome).toBe("routed");
    expect(routed.rawOutput).toBe("no-text");

    mockApiCep(
      {
        validationId: "prov-uuid-scan",
        status: "invalid",
        validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
      },
      (body) => expectSignedProofUrl(body.imageUrl),
    );
    const res = await postValidate(key, receiptRequest, { AI: ai });
    expect(res.ok).toBe(true);
    /* Never a legibility refusal: legibility is a verdict on a picture
       the model saw, and it saw none (D15) */
    expect(res.data.ourReading).toBeNull();
    expect(res.data.readingCheck).toBe("blind");
    expect(res.data.blindSide).toBe("both");
  });

  it("a conversion that throws is the same as one that yields nothing", async () => {
    const { key } = await seedOwner();
    await mockProof(PDF(), "application/pdf");
    const ai = {
      run: async () => ({ response: "" }),
      toMarkdown: async () => {
        throw new Error("conversion exploded");
      },
    } as unknown as Ai;

    const draft = await postExtract(key, PROOF_KEY, { AI: ai });
    expect(draft.ok).toBe(true);
    expect(draft.data.source).toBe("provider-ocr");
    const [row] = await db().select().from(extractions);
    expect(row.outcome).toBe("routed");
  });

  it("a top-up PDF takes the same path under the platform's NULL owner", async () => {
    await mockProof(PDF(), "application/pdf");
    const reading = await consta(
      testEnv({ AI: aiReturning(GOOD_READING, undefined, { pdfText: RECEIPT_TEXT }) }),
      db(),
      { platform: true },
    ).extract({ proofKey: PROOF_KEY });
    expect(reading.source).toBe("reader");

    const [row] = await db().select().from(extractions);
    /* prepaid-credit D6 / consta-api-merge D3: the platform's own
       transaction owns its rows, and NULL is how that is written */
    expect(row.businessId).toBeNull();
    expect(row.mediaType).toBe("application/pdf");
  });
});

/* two-eyes-receipt US5 — the record answers the questions.

   D10 asks for a ratio the creator can read a week after the feature
   ships: how often do the two machines agree, and how often is a payer
   still asked? A number nobody records is a number nobody has, so the
   columns were designed for it (D19) and the queries live in
   `data-model.md` and in `scripts/reading-check-report.mjs`.

   These drive real scenarios through the engine and then run those very
   queries against the test D1 — so a query that stops matching the
   record breaks here, and not a month later on a dashboard nobody
   checked. */
describe("two-eyes-receipt US5: the record answers the questions", () => {
  const providerRead = (over: Record<string, unknown> = {}) => ({
    trackingKey: "MBAN01002508150012345678",
    amount: 514.0,
    date: "2026-08-15",
    senderBank: "BBVA MEXICO",
    ...over,
  });
  const notFound = (extracted?: Record<string, unknown>) => ({
    validationId: `prov-${crypto.randomUUID().slice(0, 8)}`,
    status: "invalid",
    validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
    ...(extracted ? { extracted } : {}),
  });

  it("the five counts of data-model.md come back right after a mixed day", async () => {
    const { key } = await seedOwner();
    resetShapeRules();

    /* Each scenario is a different receipt, so each file is different
       bytes: the same bytes by the same owner inside fifteen minutes are
       one reading, not two (D14). */
    /* 1. agreed — both read the same clave and the same cents */
    await mockProof(PNG(64), "image/png");
    mockApiCep(notFound(providerRead()), (b) => expectSignedProofUrl(b.imageUrl));
    expect((await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING) })).ok).toBe(true);

    /* 2. disputed — different claves, no graduated rule to break the tie */
    await mockProof(PNG(65), "image/png");
    mockApiCep(notFound(providerRead({ trackingKey: "MBAN01002508150099999999" })));
    expect((await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING) })).ok).toBe(true);

    /* 3. blind on the provider's side, with a complete reading of ours */
    await mockProof(PNG(66), "image/png");
    mockApiCep(notFound());
    expect((await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING) })).ok).toBe(true);

    /* 4 and 5. the two refusals, which spend nothing */
    await mockProof(PNG(67), "image/png");
    expect(
      (await postValidate(key, receiptRequest, { AI: aiReturning({ esComprobante: false }) })).ok,
    ).toBe(false);
    await mockProof(PNG(68), "image/png");
    expect(
      (
        await postValidate(key, receiptRequest, {
          AI: aiReturning({ esComprobante: true, legibilidad: "nula", claveDeRastreo: null }),
        })
      ).ok,
    ).toBe(false);

    /* And a PDF nothing could read, handed to the provider unread */
    await mockProof(PDF(), "application/pdf");
    mockApiCep(notFound());
    expect(
      (await postValidate(key, receiptRequest, { AI: aiReturning(GOOD_READING, undefined, { pdfText: "" }) }))
        .ok,
    ).toBe(true);

    const sql = (q: string) => env.DB.prepare(q).all<Record<string, unknown>>();

    /* Q1: agreed / disputed / blind on first calls */
    const byCheck = await sql(
      `SELECT reading_check, blind_side, COUNT(*) AS n FROM extractions
       WHERE validation_id IS NOT NULL AND reading_check IS NOT NULL GROUP BY 1, 2`,
    );
    expect(
      Object.fromEntries(byCheck.results.map((r) => [`${r.reading_check}/${r.blind_side ?? "-"}`, r.n])),
    ).toEqual({ "agreed/-": 1, "disputed/-": 1, "blind/provider": 1, "blind/both": 1 });

    /* Q2: no legacy cross exists — every row here was born the new way,
       and the shape is what says so (D16), never the attempt number */
    const legacy = await sql(
      `SELECT COUNT(*) AS n FROM payments
       WHERE proof_mode = 'transfer' AND proof_key IS NOT NULL
         AND supersedes_id IS NULL AND reading_check IS NOT NULL`,
    );
    expect(legacy.results[0].n).toBe(0);

    /* Q3: provider blind while we read fully */
    const blindFully = await sql(
      `SELECT COUNT(*) AS n FROM extractions
       WHERE blind_side = 'provider' AND gate_tracking_key = 'ok' AND amount_cents IS NOT NULL`,
    );
    expect(blindFully.results[0].n).toBe(1);

    /* Q4: the refusals, and the zero that is the whole point of them */
    const refusals = await sql(
      `SELECT outcome, COUNT(*) AS n, SUM(validation_id IS NOT NULL) AS billed FROM extractions
       WHERE outcome IN ('not_a_receipt', 'illegible') GROUP BY 1`,
    );
    expect(Object.fromEntries(refusals.results.map((r) => [r.outcome, r.n]))).toEqual({
      not_a_receipt: 1,
      illegible: 1,
    });
    expect(refusals.results.every((r) => r.billed === 0)).toBe(true);

    /* Q5: PDFs read here vs handed over unread */
    const pdfs = await sql(
      `SELECT source, outcome, COUNT(*) AS n FROM extractions
       WHERE media_type = 'application/pdf' GROUP BY 1, 2`,
    );
    expect(pdfs.results).toEqual([{ source: "provider-ocr", outcome: "routed", n: 1 }]);
  });
});
