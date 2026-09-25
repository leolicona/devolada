import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { asc, eq } from "drizzle-orm";
import { businesses, extractions, payments, paymentLinks, proofRejections } from "../src/db/schema";
import { runValidation, sweepDirectPayments } from "../src/direct-payments/validation";
import { integrationOf } from "../src/integrations/store";
import { nextValidationSlot, suggestedSlot } from "../src/direct-payments/schedule";
import { sweepReconnections } from "../src/reconnection/queue";
import { signedProofUrl, UPLOAD_HOURLY_BUDGET } from "../src/direct-payments/proofs";
import { historyVouches } from "../src/direct-payments/provisional";
import type { Bindings } from "../src/env";
import { app, fakeProofs, seedBusiness } from "./helpers";
import { resetShapeRules, sha256Hex } from "../src/consta/extraction";
import { aiReturning, PNG, RECEIPT_1_READING, RECEIPT_2_READING, seedValidations } from "./consta/helpers";

/* business-and-memberships D6: a payment that confirmed carries its folio
   on the same row — "the charge" of the old two-table world. */
async function confirmedRows(db: ReturnType<typeof drizzle>) {
  return (await db.select().from(payments)).filter((p) => p.folio !== null);
}

/* docs/legacy/direct-payment/direct-payment.spec.md scenarios 1–12, 16–24
   (US-D01–US-D04). apiCEP and WispHub are fetch-mocked respecting
   their contracts (docs/legacy/integrations/apicep.md,
   docs/legacy/integrations/wisphub.md).

   consta-api-merge D12: until the merge this suite intercepted the
   standalone Consta Worker at a test origin of its own and answered with
   the engine's verdict envelope. The engine is product code now, and product code is not
   mocked (constitution IV) — the provider behind it is, at its real
   origin. `mockApiCep` keeps the verdict vocabulary the scenarios were
   written in and answers with what apiCEP would have said to produce
   it, so the engine's own mapping is what turns the wire into the
   verdict every assertion names. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const APICEP_ORIGIN = "https://api.apicep.cloud";

/* The provider credential and origin come pinned from vitest.config.ts
   (constitution IV); the proof bucket is the in-memory double the
   engine reads from too (consta-api-merge D7). */
const testEnv = {
  ...env,
  PROOFS: fakeProofs(),
} as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const apicep = () => fetchMock.get(APICEP_ORIGIN);
const json = (body: unknown) => [
  200,
  JSON.stringify(body),
  { headers: { "Content-Type": "application/json" } },
] as const;

const wisphubCustomer = (estado = "Suspendido") => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  estado,
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
});

function mockCustomerLookup(results: unknown[], times = 1) {
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario="),
    })
    .reply(...json({ count: results.length, results }))
    .times(times);
}

function mockPendingInvoices(
  results: { id_factura: number; cliente: { usuario: string }; total: number }[] = [
    { id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
  ],
  times = 1,
) {
  wh()
    .intercept({
      method: "GET",
      path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1"),
    })
    .reply(...json({ next: null, count: results.length, results }))
    .times(times);
}

/* The reconnection the confirmed payment triggers (D6): auto-activate →
   payment methods → pay the resolved invoice → verify. */
/* `verify: false` is the partial-payment D5 path: with `accion: 0` there
   is no router work and nothing to verify, so no second customer read
   happens — and the response carries `task_id: null` rather than an id. */
function mockReconnection(verifyEstado = "Activo", invoiceId = 42, verify = true) {
  const captured: { accion?: number; totalCobrado?: number } = {};
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  wh()
    .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
    .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  wh()
    .intercept({
      method: "POST",
      path: `/api/facturas/${invoiceId}/registrar-pago/`,
      body: (raw) => {
        const b = JSON.parse(String(raw));
        captured.accion = b.accion;
        captured.totalCobrado = b.total_cobrado;
        return true;
      },
    })
    .reply(
      ...json({
        messages: ["Se agrego correctamente el pago"],
        task_id: verify ? "t-1" : null,
      }),
    );
  if (verify) mockCustomerLookup([wisphubCustomer(verifyEstado)]);
  return captured;
}

type VerdictData = {
  status?: "valid" | "pending" | "invalid";
  reason?: "contradicted" | "not_found";
  alreadyValidated?: boolean;
  cep?: Record<string, unknown> | undefined;
  /* proof-extraction D11: what the provider's OCR read, in the engine's
     cents; travels as apiCEP's `extracted` in pesos */
  reading?: Record<string, unknown>;
  /* receipt-triage FR-006: the provider's replay flag as it answers it,
     `null` included — `alreadyValidated` above only says true or false */
  previouslyValidated?: boolean | null;
};

/* trust-layer US-V15: the block exactly as the engine ships it — the D8
   wire example. Since the merge it is the fixture of the pure
   `historyVouches` unit test alone: the shadow tests below seed the
   log and assert the block the engine computed (consta-api-merge D12). */
const TRUST_BLOCK = {
  customerRef: "a".repeat(64),
  sample: { chains: 14, effectiveN: 11.2, halfLifeDays: 90 },
  eventualValidRate: 1,
  raw: { resolvedValid: 14, abandoned: 0, contradicted: 0, alreadyUsedAttempts: 0 },
  lastIncidentAt: null as string | null,
  medianMinutesToValid: 4,
  tenantBaseline: { eventualValidRate: 0.96, chains: 410, effectiveN: 236.5 },
};

const DEFAULT_CEP = {
  trackingKey: "TRACK001XYZ",
  amountCents: 51400,
  date: new Date().toISOString().slice(0, 10),
  senderBank: "NUBANK",
  senderName: "JANELY REYES",
  receiverBank: "STP",
  beneficiaryName: "WifiPlus SA de CV",
};

/* The engine's verdict vocabulary in, apiCEP's wire out (research R11):
     valid            → status "valid" + cepDetails, LIQUIDADO
     pending          → status "pending"
     not_found        → status "invalid" with nothing behind it
     contradicted     → status "invalid" + cepStatus DEVUELTO
     alreadyValidated → cepPreviouslyValidated true
   Amounts cross the wire as decimal pesos; the engine turns them back
   into cents (validation spec D7). */
function apiCepWire(data: VerdictData): Record<string, unknown> {
  const cep = "cep" in data ? data.cep : DEFAULT_CEP;
  const status = data.status ?? "valid";
  const cepDetails = cep
    ? {
        trackingKey: cep.trackingKey,
        amount: typeof cep.amountCents === "number" ? cep.amountCents / 100 : undefined,
        operationDate: cep.date,
        senderBank: cep.senderBank,
        senderName: cep.senderName,
        receiverBank: cep.receiverBank,
        beneficiaryName: cep.beneficiaryName,
        /* receipt-triage D22 */
        ...(cep.beneficiaryAccount !== undefined ? { beneficiaryAccount: cep.beneficiaryAccount } : {}),
      }
    : undefined;
  const cepStatus =
    status === "valid" ? "LIQUIDADO" : status === "invalid" && data.reason === "contradicted" ? "DEVUELTO" : undefined;
  const extracted = data.reading
    ? {
        trackingKey: data.reading.trackingKey,
        amount: typeof data.reading.amountCents === "number" ? data.reading.amountCents / 100 : undefined,
        date: data.reading.date,
        senderBank: data.reading.senderBank,
        referenceNumber: data.reading.referenceNumber ?? undefined,
      }
    : undefined;
  return {
    validationId: "v-1",
    status,
    validation: {
      banxicoConfirmed: status === "valid",
      cepPreviouslyValidated:
        "previouslyValidated" in data ? data.previouslyValidated : (data.alreadyValidated ?? false),
      ...(cepStatus ? { cepStatus } : {}),
      ...(cepDetails ? { cepDetails } : {}),
    },
    ...(extracted ? { extracted } : {}),
  };
}

/* Intercepts apiCEP's POST /validate-transfer and captures the request
   body for the assertions on what actually traveled to the provider. */
function mockApiCep(data: VerdictData = {}) {
  const captured: { body?: Record<string, unknown> } = {};
  apicep()
    .intercept({
      method: "POST",
      path: "/validate-transfer",
      body: (raw) => {
        captured.body = JSON.parse(String(raw));
        return true;
      },
    })
    .reply(...json(apiCepWire(data)));
  return captured;
}

const SPEI_CONFIG = {
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
};

async function seedLinkedBusiness(overrides: Parameters<typeof seedBusiness>[0] = {}) {
  const business = await seedBusiness({
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 1500,
    storeCommissionCents: 900,
    ...SPEI_CONFIG,
    ...overrides,
  });
  const [link] = await drizzle(env.DB)
    .insert(paymentLinks)
    .values({
      businessId: business.id,
      token: "tok2345abcdefgh2",
      wisphubCustomerId: "6",
      customerUsuario: "greyes@wifiplus",
    })
    .returning();
  return { business, link };
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const TRANSFER = {
  transfer: { trackingKey: "TRACK001XYZ", senderBank: "NUBANK", date: "2026-08-17" },
};

async function payTransfer(token = "tok2345abcdefgh2", body: unknown = TRANSFER) {
  return (await app()).request(`/direct-payments/links/${token}/pay`, post(body), testEnv);
}

describe("US-D01: the link answers with the live debt", () => {
  it("scenario 1: debt → total, SPEI instructions with the ISP's account", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();

    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    expect(data.customerName).toBe("Janely");
    expect(data.invoiceCents).toBe(49900);
    expect(data.serviceFeeCents).toBe(1500);
    expect(data.totalCents).toBe(51400);
    expect(data.speiClabe).toBe(SPEI_CONFIG.speiClabe);
    expect(data.speiBeneficiaryName).toBe(SPEI_CONFIG.speiBeneficiaryName);
  });

  it("uses the SPEI fee when configured (D3)", async () => {
    await seedLinkedBusiness({ speiServiceFeeCents: 800 });
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();

    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.serviceFeeCents).toBe(800);
    expect(data.totalCents).toBe(50700);
  });

  it("scenario 2 (debt-truth US-C08): a carried balance is a debt the page can see", async () => {
    /* The state a short payment leaves behind: the invoice closed as
       "Pagada", the pending list is empty, and the remainder lives in
       `saldo`. Before debt-truth D7 this page answered "Sin adeudo" to
       somebody who owed money and could not pay it. */
    await seedLinkedBusiness();
    mockCustomerLookup([
      { ...wisphubCustomer(), estado_facturas: "Pagadas", saldo: "150.00" },
    ]);
    mockPendingInvoices([]);

    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    expect(data.invoiceCents).toBe(0);
    expect(data.carriedBalanceCents).toBe(15000);
    expect(data.totalCents).toBe(15000 + 1500);
  });

  it("scenario 2: no debt → sin adeudo, no SPEI data", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices([]);

    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("no_debt");
    expect(data.speiClabe).toBeUndefined();
    expect(data.totalCents).toBeUndefined();
  });

  it("scenario 3: unknown token → 404", async () => {
    await seedLinkedBusiness();
    const res = await (await app()).request("/direct-payments/links/nope", {}, testEnv);
    expect(res.status).toBe(404);
  });

  /* bug: links-refused-key — the panel now hears WISPHUB_AUTH_FAILED;
     the payer must not. Whose gap it is is not the customer's business,
     and the audience default in `wisphubFailure` is what keeps it that
     way. The refusal sits on the invoice door: the two reads fire
     together (provider-latency D2) and the page answers on the first
     rejection, so a refused customer lookup would leave the invoice read
     mid-flight in the display cache when this test ends — which the
     runner's isolated storage rightly refuses. */
  it("bug links-refused-key: a refused key reads as WISPHUB_UNAVAILABLE on the payer's page, never as the ISP's setup gap", async () => {
    await seedLinkedBusiness({ wisphubApiKey: "wh-key-io" });
    mockCustomerLookup([wisphubCustomer()]);
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/") })
      .reply(403, JSON.stringify({ detail: "Invalid API key" }), {
        headers: { "Content-Type": "application/json" },
      });

    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: { code: "WISPHUB_UNAVAILABLE" } });
    expect(JSON.stringify(body)).not.toContain("AUTH");
    expect(JSON.stringify(body)).not.toContain("wh-key-io");
  });

  it("scenario 23: ISP without SPEI → unavailable, no WispHub call", async () => {
    await seedLinkedBusiness({ speiClabe: null, speiBank: null, speiBeneficiaryName: null });
    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("unavailable");
  });

  it("scenario 35: an ISP whose bank is outside the vocabulary is unavailable too (BUG-008)", async () => {
    /* Found live on dev 2026-08-19: an ISP held `Klar` where apiCEP's list
       says `KLAR`. Every field was set, so the channel looked configured and
       took money it could never validate — and failed *retryably*, which is
       the six-hour silence rather than an honest refusal. D16 fixed the form;
       nothing checked the value already in the database. */
    await seedLinkedBusiness({ speiBank: "Klar" });
    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("unavailable");
    /* No WispHub call: D4 decides before the lookup */
  });

  it("scenario 35: the exact spelling keeps the channel open", async () => {
    await seedLinkedBusiness({ speiBank: "KLAR" });
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    expect(data.speiBank).toBe("KLAR");
  });
});

describe("US-D02: submitting proof", () => {
  it("scenario 4: ISP without SPEI → SPEI_NOT_CONFIGURED on pay", async () => {
    await seedLinkedBusiness({ speiClabe: null });
    const res = await payTransfer();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("SPEI_NOT_CONFIGURED");
  });

  it("scenario 6: transfer door — amount and beneficiary are server-supplied", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockApiCep({ status: "pending", cep: undefined });

    const res = await payTransfer();
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("validating");

    const sent = captured.body!.sender as Record<string, unknown>;
    expect(sent.trackingKey).toBe("TRACK001XYZ");
    /* cents at our edge, decimal pesos at the provider's (Consta D7) */
    expect(sent.amount).toBe(514);
    expect(captured.body!.beneficiary).toEqual({
      bank: "STP",
      clabe: SPEI_CONFIG.speiClabe,
      name: SPEI_CONFIG.speiBeneficiaryName,
    });

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.proofMode).toBe("transfer");
  });

  it("scenario 5: receipt door — upload lands in R2, the provider gets a signed URL", async () => {
    const { link } = await seedLinkedBusiness();

    const form = new FormData();
    form.append("file", new File([new Uint8Array(1024)], "cep.png", { type: "image/png" }));
    const up = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/proof",
      { method: "POST", body: form },
      testEnv,
    );
    expect(up.status).toBe(200);
    const { data: upload } = await up.json();
    expect(upload.proofId.startsWith(`${link.id}/`)).toBe(true);
    expect(await testEnv.PROOFS.head(upload.proofId)).not.toBeNull();

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockApiCep({ status: "pending", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", { proofId: upload.proofId });
    expect(res.status).toBe(201);
    /* No reader is bound in this suite, so the image takes the
       provider's own OCR door — through the short-lived link the engine
       signed for it (D12, consta-api-merge D7) */
    expect(String(captured.body!.imageUrl)).toContain(
      `/direct-payments/proofs/${upload.proofId}`,
    );

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.proofMode).toBe("receipt");
    expect(row.proofKey).toBe(upload.proofId);
  });

  it("rejects oversized and unreadable proofs (D12)", async () => {
    await seedLinkedBusiness();
    const big = new FormData();
    big.append("file", new File([new Uint8Array(1_000_001)], "cep.png", { type: "image/png" }));
    const tooBig = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/proof",
      { method: "POST", body: big },
      testEnv,
    );
    expect(tooBig.status).toBe(413);

    /* Not "not an image": the door is what the provider can read, and a
       zip is not it */
    const zip = new FormData();
    zip.append("file", new File([new Uint8Array(10)], "cep.zip", { type: "application/zip" }));
    const unsupported = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/proof",
      { method: "POST", body: zip },
      testEnv,
    );
    expect(unsupported.status).toBe(415);
    expect((await unsupported.json()).error.code).toBe("PROOF_UNSUPPORTED_TYPE");
  });

  it("accepts a PDF comprobante — apiCEP reads them and banks issue them (D12)", async () => {
    const { link } = await seedLinkedBusiness();
    const form = new FormData();
    form.append("file", new File([new Uint8Array(64)], "cep.pdf", { type: "application/pdf" }));
    const up = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/proof",
      { method: "POST", body: form },
      testEnv,
    );
    expect(up.status).toBe(200);
    const { data } = await up.json();
    expect(data.proofId.startsWith(`${link.id}/`)).toBe(true);

    /* And it survives the whole way: the pay path must not re-filter on
       image types and strand a proof it already accepted */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", { proofId: data.proofId });
    expect(res.status).toBe(201);
  });

  it("scenario 22: the sixth submission in an hour → 429, no provider call", async () => {
    const { business, link } = await seedLinkedBusiness();
    const db = drizzle(env.DB);
    for (let i = 0; i < 5; i++) {
      await db.insert(payments).values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        status: "invalid",
        proofMode: "transfer",
      });
    }
    const res = await payTransfer();
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("TOO_MANY_ATTEMPTS");

    /* an exhausted pay budget also closes the upload door (D13) */
    const form = new FormData();
    form.append("file", new File([new Uint8Array(10)], "cep.png", { type: "image/png" }));
    const up = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/proof",
      { method: "POST", body: form },
      testEnv,
    );
    expect(up.status).toBe(429);
  });

  it("D13: uploads have their own hourly cap, with no submission behind them", async () => {
    await seedLinkedBusiness();
    const upload = async () => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(10)], "cep.png", { type: "image/png" }));
      return (await app()).request(
        "/direct-payments/links/tok2345abcdefgh2/proof",
        { method: "POST", body: form },
        testEnv,
      );
    };

    /* Never submitting is the whole point: the pay budget counts
       `direct_payments` rows, and an upload creates none — so before
       this cap existed, a leaked link could fill R2 forever. */
    for (let i = 0; i < UPLOAD_HOURLY_BUDGET; i++) {
      expect((await upload()).status).toBe(200);
    }
    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(0);

    const overBudget = await upload();
    expect(overBudget.status).toBe(429);
    expect((await overBudget.json()).error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("NOTHING_DUE when the customer owes nothing at submission", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices([], 1);
    const res = await payTransfer();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("NOTHING_DUE");
  });
});

describe("D16: what cannot validate never reaches the paid provider", () => {
  /* Measured 2026-08-19: apiCEP does not reject an unknown bank name — it
     answers `invalid` with no cepDetails, byte-identical to a transfer that
     never happened. A payer who really paid was told their transfer could not
     be verified, and nothing on the wire said why (BUG-007). The form now
     offers a list; these are the guards behind it.

     The refusals register no WispHub or Consta mock on purpose: with net
     connect disabled, a request that got past validation could not have
     answered 400, so "no paid call" is asserted by the absence itself. */

  it("US-D02: a bank name outside the vocabulary is refused, before WispHub or the provider", async () => {
    await seedLinkedBusiness();

    /* The three names the old placeholder taught the payer to type. apiCEP
       spells them NUBANK, BBVA MEXICO and BANORTE. */
    for (const senderBank of ["Nu", "BBVA", "Banorte"]) {
      const res = await payTransfer("tok2345abcdefgh2", {
        transfer: { ...TRANSFER.transfer, senderBank },
      });
      expect(res.status).toBe(400);
    }

    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(0);
  });

  it("US-D02: the exact spelling apiCEP accepts does get through", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });

    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, senderBank: "BBVA MEXICO" },
    });
    expect(res.status).toBe(201);
    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.senderBank).toBe("BBVA MEXICO");
  });

  it("BUG-006: a tracking key carrying a receipt's two-line wrap is refused", async () => {
    await seedLinkedBusiness();

    /* The first one is the live failure: 29 characters, a space, and a
       Cyrillic З where a 3 belongs. It used to pass, spend $0.25 and land
       `invalid`. */
    for (const trackingKey of [
      "NU3AGKK16AH58LTOVUQH55PE З0AA",
      "NU3AGIFAMA9D9CNQ V487MGAVDE2C",
      "NU3AGIFAMA9D9CNQ\nV487MGAVDE2C",
      "SHORT",
    ]) {
      const res = await payTransfer("tok2345abcdefgh2", {
        transfer: { ...TRANSFER.transfer, trackingKey },
      });
      expect(res.status).toBe(400);
    }

    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(0);
  });

  it("BUG-006: a ten-character key is accepted — the bound is a range, not Nu's 28", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });

    /* apiCEP's own documented example. A fixed 28 would lock out every bank
       that issues a shorter clave. */
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, senderBank: "HSBC", trackingKey: "HSBC712057" },
    });
    expect(res.status).toBe(201);
  });
});

describe("US-D03: a valid transfer becomes a charge and reconnects", () => {
  it("scenario 7: confirmed → spei charge, no store, no ledger entries", async () => {
    const { business } = await seedLinkedBusiness();
    /* pay pre-check + validation debt re-check + reconnection verify */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep();
    mockReconnection("Activo");

    const res = await payTransfer();
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");
    expect(data.error).toBeNull();

    const db = drizzle(env.DB);
    const [payment] = await db.select().from(payments);
    expect(payment.status).toBe("confirmed");
    expect(payment.folio).not.toBeNull();

    const [charge] = await confirmedRows(db);
    expect(charge.channel).toBe("spei");
    expect(charge.receivedCents).toBe(51400);
    expect(charge.actionOutcome).toBe("done");
  });

  it("scenario 12: a queued spei charge rides the reconnection sweep", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep();
    /* WispHub pays but the service has not flipped yet */
    mockReconnection("Suspendido");

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");
    const db = drizzle(env.DB);
    let [charge] = await confirmedRows(db);
    expect(charge.actionOutcome).toBe("queued");
    expect(charge.nextAttemptAt).not.toBeNull();

    /* the sweep re-verifies: payment already registered, service now up */
    mockCustomerLookup([wisphubCustomer("Activo")], 1);
    await sweepReconnections(testEnv, new Date(Date.now() + 5 * 60 * 1000));
    [charge] = await confirmedRows(db);
    expect(charge.actionOutcome).toBe("done");
  });

  it("scenario 24: two months due → one debt, one payment, nothing left (D21)", async () => {
    await seedLinkedBusiness();
    const twoInvoices = [
      { id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
      { id_factura: 41, cliente: { usuario: "greyes@wifiplus" }, total: 499 },
    ];
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(twoInvoices, 2);
    /* D21 replaces D15: WispHub applies a payment to the customer, not to
       the invoice, so the page asks for both months at once — 998 + the
       15.00 fee. Asking for one of them would have asked for a number
       that reconnects nobody. */
    mockApiCep({
      cep: {
        trackingKey: "TRACK001XYZ",
        amountCents: 101300,
        date: new Date().toISOString().slice(0, 10),
        senderBank: "NUBANK",
        senderName: "JANELY REYES",
        receiverBank: "STP",
        beneficiaryName: "WifiPlus SA de CV",
      },
    });
    /* The payment is registered against the oldest invoice and settles the
       whole running account (debt-truth D15) */
    mockReconnection("Activo", 41);

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");

    const [charge] = await confirmedRows(drizzle(env.DB));
    expect(charge.registeredCents).toBe(99800);
    expect(charge.receivedCents).toBe(101300);

    /* both months settled: the page now says there is nothing to pay */
    mockCustomerLookup([wisphubCustomer("Activo")], 1);
    mockPendingInvoices([], 1);
    const again = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data: link } = await again.json();
    expect(link.status).toBe("no_debt");
  });
});

describe("US-D04: pending CEPs re-validate, never a false rejection", () => {
  it("scenario 8: pending → validating, first D7 slot (+2 min)", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("validating");

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.status).toBe("validating");
    expect(row.constaStatus).toBe("pending");
    expect(row.validationAttempts).toBe(1);
    expect(row.nextValidationAt!.getTime() - row.createdAt.getTime()).toBe(2 * 60 * 1000);
  });

  it("scenario 9: the sweep picks it up and Consta now says valid", async () => {
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        constaStatus: "pending",
        validationAttempts: 1,
        /* consta-api-merge FR-020 (spec US1 scenario 6): a row the old
           standalone service validated once — its id is foreign to the
           `validations` table this API now writes. Nothing follows it;
           the attempt counter on the row is what makes the next attempt
           a retry, so the replay carve-out (D8) applies without a data
           step. */
        constaValidationId: "v-old-service-0f3a9c",
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 2 * 60 * 1000),
      })
      .returning();

    /* the provider's replay flag set by the old service's own call: a
       retry must not read it as a stranger's validation (D8) */
    mockApiCep({ alreadyValidated: true });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");

    const report = await sweepDirectPayments(testEnv, now);
    expect(report).toMatchObject({ claimed: 1, confirmed: 1 });
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("confirmed");
    /* the new attempt wrote its own local row and the payment now
       points at it; the foreign id is history, not a join */
    expect(row.constaValidationId).not.toBe("v-old-service-0f3a9c");
    expect(row.validationAttempts).toBe(2);
    expect(row.folio).not.toBeNull();

    /* US-D03: the page polls the status and sees the green moment */
    const status = await (await app()).request(`/direct-payments/${payment.id}/status`, {}, testEnv);
    const { data } = await status.json();
    expect(data.status).toBe("confirmed");
    expect(data.actionOutcome).toBe("done");
    expect(data.folio).toMatch(/^DV-[0-9A-Z]{6}$/);
  });

  it("scenario 10: still pending past 6 h → expired", async () => {
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        constaStatus: "pending",
        validationAttempts: 6,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
      })
      .returning();

    mockApiCep({ status: "pending", cep: undefined });
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.expired).toBe(1);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("expired");
    expect(row.nextValidationAt).toBeNull();
  });
});

/* BUG-003 / D17: what happens when Consta cannot find the transfer.
   Found live on dev across two customers and three receipts: a real
   payment, exact amount, declared `invalid` and dead on the first try. */
describe("D17: a not-found is not a refusal", () => {
  it("scenario 36: `invalid` with reason not_found keeps the payment alive on the schedule", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("validating");
    expect(data.error).toBe("TRANSFER_NOT_FOUND");

    const db = drizzle(env.DB);
    const [row] = await db.select().from(payments);
    expect(row.status).toBe("validating");
    expect(row.lastError).toBe("TRANSFER_NOT_FOUND");
    /* The point of the fix: another attempt is booked, not skipped */
    expect(row.nextValidationAt).not.toBeNull();
    expect(await confirmedRows(db)).toHaveLength(0);
  });

  it("scenario 37: the CEP that appears late is caught by the very next sweep", async () => {
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        constaStatus: "invalid",
        lastError: "TRANSFER_NOT_FOUND",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 8 * 60 * 1000),
      })
      .returning();

    mockApiCep();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");

    const report = await sweepDirectPayments(testEnv, now);
    expect(report).toMatchObject({ claimed: 1, confirmed: 1 });
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("confirmed");
    expect(row.lastError).toBeNull();
  });

  it("scenario 38 (US-D12): not_found at the end of the schedule earns the late slot, not expiry", async () => {
    /* validation-status-ux D4 amends this scenario: the 6-hour wall now
       buys one last attempt at T+12h before the payment expires — one
       credit for the bank that releases a held transfer next morning. */
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        constaStatus: "invalid",
        validationAttempts: 6,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
      })
      .returning();

    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.stillValidating).toBe(1);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("validating");
    expect(row.lastError).toBe("TRANSFER_NOT_FOUND");
    expect(row.nextValidationAt?.getTime()).toBe(
      payment.createdAt.getTime() + 720 * 60 * 1000,
    );

    /* US-D12 D5: the page is told WHEN the late attempt runs, so it can
       promise an hour instead of news on a channel that does not exist */
    const status = await (await app()).request(`/direct-payments/${payment.id}/status`, {}, testEnv);
    const { data } = await status.json();
    expect(data.status).toBe("validating");
    expect(data.error).toBe("TRANSFER_NOT_FOUND");
    expect(data.nextValidationAt).toBe(row.nextValidationAt?.getTime());
  });

  it("scenario 39: `invalid` with reason contradicted is still terminal, on the first attempt", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "invalid", reason: "contradicted", cep: undefined });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("invalid");
    expect(data.error).toBe("TRANSFER_CONTRADICTED");

    const db = drizzle(env.DB);
    const [row] = await db.select().from(payments);
    expect(row.nextValidationAt).toBeNull();
    expect(await confirmedRows(db)).toHaveLength(0);
  });

  /* "scenario 40: an `invalid` with no reason at all is read as
     not_found, not as a refusal" — retired (consta-api-merge, research
     R11): its subject was a Consta predating D11 on the other end of a
     wire, and there is no wire. The engine's own D11 mapping is proven
     in test/consta/validate.test.ts (US-V06). */
});

/* docs/legacy/direct-payment/validation-status-ux.spec.md (US-D12): the late
   slot (D4/D5) and the own-attempt carve-out across supersede (D8). */
describe("US-D12: the late slot and the own-attempt carve-out", () => {
  type Seed = Partial<typeof payments.$inferInsert>;
  const BASE_ROW = {
    amountCents: 51400,
    invoiceCents: 49900,
    serviceFeeCents: 1500,
    proofMode: "transfer",
    trackingKey: "TRACK001XYZ",
    senderBank: "NUBANK",
  } as const;
  async function insertPayment(
    link: { id: string },
    business: { id: string },
    now: Date,
    over: Seed = {},
  ) {
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        ...BASE_ROW,
        transferDate: new Date().toISOString().slice(0, 10),
        nextValidationAt: new Date(now.getTime() - 1000),
        ...over,
      })
      .returning();
    return payment;
  }

  it("scenario 5: the late attempt still not_found → expired at last; found → the normal confirmation", async () => {
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);

    /* half one: T+12.5h, the 720 slot already ran out too */
    const first = await insertPayment(link, business, now, {
      constaStatus: "invalid",
      lastError: "TRANSFER_NOT_FOUND",
      validationAttempts: 7,
      createdAt: new Date(now.getTime() - 12.5 * 60 * 60 * 1000),
    });
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    let report = await sweepDirectPayments(testEnv, now);
    expect(report.expired).toBe(1);
    let [row] = await db.select().from(payments).where(eq(payments.id, first.id));
    expect(row.status).toBe("expired");
    expect(row.lastError).toBe("TRANSFER_NOT_FOUND");

    /* D5: once terminal, the promised hour is gone from the status */
    const status = await (await app()).request(
      `/direct-payments/${first.id}/status`,
      {},
      testEnv,
    );
    const { data } = await status.json();
    expect(data.nextValidationAt).toBeNull();

    /* half two: the CEP the bank released overnight is found at T+12h
       and confirms like any other valid — the slot exists for exactly
       this payment. Same link: the expired row released its claim. */
    await db.delete(payments).where(eq(payments.id, first.id));
    const second = await insertPayment(link, business, now, {
      constaStatus: "invalid",
      lastError: "TRANSFER_NOT_FOUND",
      validationAttempts: 7,
      createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000 - 30 * 1000),
    });
    mockApiCep();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    report = await sweepDirectPayments(testEnv, now);
    expect(report).toMatchObject({ claimed: 1, confirmed: 1 });
    [row] = await db.select().from(payments).where(eq(payments.id, second.id));
    expect(row.status).toBe("confirmed");
  });

  it("scenario 6: a channel failure at the end of the schedule gets no late slot", async () => {
    /* D4: the T+12h attempt is for the transfer Banxico may still
       publish, never for our own outages */
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const payment = await insertPayment(link, business, now, {
      constaStatus: "pending",
      lastError: "PROVIDER_UNAVAILABLE",
      validationAttempts: 6,
      createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000 - 1000),
    });
    apicep().intercept({ method: "POST", path: "/validate-transfer" }).reply(
      503,
      JSON.stringify({ error: "Service temporarily unavailable" }),
      { headers: { "Content-Type": "application/json" } },
    );
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.expired).toBe(1);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("expired");
    /* consta-api-merge D6: the engine's own code on the row, never the
       transport's */
    expect(row.lastError).toBe("PROVIDER_UNAVAILABLE");
  });

  it("scenario 11: the replay flag traced through `supersedesId` is the payer's own retry, not a stranger", async () => {
    /* D8: a valid that reached the provider but died locally, then a
       corrected re-submission — the fresh row has zero attempts, and
       the flag must resolve on the verdict's merits anyway */
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const [prior] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        status: "superseded",
        constaStatus: "valid",
        validationAttempts: 2,
        nextValidationAt: null,
      })
      .returning();
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        supersedesId: prior.id,
        nextValidationAt: new Date(now.getTime() - 1000),
      })
      .returning();

    mockApiCep({ alreadyValidated: true });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.confirmed).toBe(1);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("confirmed");
    expect(row.lastError).toBeNull();
  });

  it("scenario 11b: on the receipt door the trace is the same link holding the same revealed key", async () => {
    /* D8: no supersedesId survives a terminal prior, but the tracking
       key the CEP reveals matches the payer's own dead attempt */
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    await db.insert(payments).values({
      paymentLinkId: link.id,
      businessId: business.id,
      amountCents: 51400,
      invoiceCents: 49900,
      serviceFeeCents: 1500,
      proofMode: "transfer",
      trackingKey: "TRACK001XYZ",
      senderBank: "NUBANK",
      transferDate: new Date().toISOString().slice(0, 10),
      status: "expired",
      constaStatus: "valid",
      validationAttempts: 7,
      nextValidationAt: null,
    });
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "receipt",
        proofKey: `${link.id}/proof-r1`,
        nextValidationAt: new Date(now.getTime() - 1000),
      })
      .returning();

    mockApiCep({ alreadyValidated: true });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.confirmed).toBe(1);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("confirmed");
  });

  it("scenario 12: a chain that never reached the provider does not soften the flag", async () => {
    /* D8 stands: the ancestor was superseded before any call landed, so
       the flag can only mean a validation outside this payment */
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const [prior] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACKOLD9999",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        status: "superseded",
        validationAttempts: 0,
        nextValidationAt: null,
      })
      .returning();
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        supersedesId: prior.id,
        nextValidationAt: new Date(now.getTime() - 1000),
      })
      .returning();

    mockApiCep({ alreadyValidated: true });
    const report = await sweepDirectPayments(testEnv, now);
    expect(report.invalid).toBe(1);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("invalid");
    expect(row.lastError).toBe("TRANSFER_ALREADY_USED");
    expect(await confirmedRows(db)).toHaveLength(0);
  });
});

describe("D8: one transfer pays once", () => {
  it("scenario 11: alreadyValidated with no local record → rejected, no charge", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ alreadyValidated: true });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("invalid");
    expect(data.error).toBe("TRANSFER_ALREADY_USED");
    expect(await confirmedRows(drizzle(env.DB))).toHaveLength(0);
  });

  it("scenario 18: resubmitting your own live transfer attaches to it (US-D12, D9)", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const first = await payTransfer();
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.directPaymentId;

    /* Same clave while the first row is still validating: a deterministic
       misread re-uploaded, the payer racing only themselves. No second
       row, no Consta call — the answer is the row they already own.
       bug: one-open-attempt — and no WispHub read either: the identical
       submission is recognised before anything is asked of anyone. */
    const second = await payTransfer();
    expect(second.status).toBe(200);
    const { data } = await second.json();
    expect(data.directPaymentId).toBe(firstId);
    expect(data.status).toBe("validating");
    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(1);
  });

  it("scenario 18b: another customer's live clave still refuses at the index (US-D12, D9)", async () => {
    const { business } = await seedLinkedBusiness();
    await drizzle(env.DB)
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: "tok9876zyxwvut99",
        wisphubCustomerId: "7",
        customerUsuario: "otro@wifiplus",
      });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    expect((await payTransfer()).status).toBe(201);

    /* The same clave from a different payment link: the collision pool
       D18 warns about — same ISP, same day, another customer. Refused. */
    mockCustomerLookup([{ ...wisphubCustomer(), id_servicio: 7, usuario: "otro@wifiplus" }], 1);
    mockPendingInvoices([{ id_factura: 43, cliente: { usuario: "otro@wifiplus" }, total: 499 }], 1);
    const second = await payTransfer("tok9876zyxwvut99");
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("TRANSFER_ALREADY_USED");
    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(1);
  });

  it("scenario 18d (US-D12 scenario 15): the same clave with different data supersedes the owning row", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const first = await payTransfer();
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.directPaymentId;

    /* Same clave, corrected date: the payer is fixing the row they
       already own — attaching would discard the correction (found live
       2026-08-26: a stale row kept asking Banxico with the wrong data
       while the payer read "no los actualiza"). */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const corrected = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, date: "2026-08-18" },
    });
    expect(corrected.status).toBe(201);
    const rows = await drizzle(env.DB).select().from(payments);
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.id === firstId)!;
    expect(old.status).toBe("superseded");
    const fresh = rows.find((r) => r.id !== firstId)!;
    expect(fresh.transferDate).toBe("2026-08-18");
    /* The chain survives, so D8's own-attempt carve-out still traces */
    expect(fresh.supersedesId).toBe(firstId);
  });

  it("scenario 18e (US-D12 scenario 16): a cross-link refusal restores the prior it had released", async () => {
    const { business } = await seedLinkedBusiness();
    await drizzle(env.DB)
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: "tok9876zyxwvut99",
        wisphubCustomerId: "7",
        customerUsuario: "otro@wifiplus",
      });
    /* Another customer's live payment owns clave TRACK002ABC */
    mockCustomerLookup([{ ...wisphubCustomer(), id_servicio: 7, usuario: "otro@wifiplus" }], 1);
    mockPendingInvoices([{ id_factura: 43, cliente: { usuario: "otro@wifiplus" }, total: 499 }], 1);
    mockApiCep({ status: "pending", cep: undefined });
    expect(
      (
        await payTransfer("tok9876zyxwvut99", {
          transfer: { ...TRANSFER.transfer, trackingKey: "TRACK002ABC" },
        })
      ).status,
    ).toBe(201);

    /* The payer's own payment, about to be corrected */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const first = await payTransfer();
    const firstId = (await first.json()).data.directPaymentId;

    /* The correction lands on the other customer's clave: refused — and
       the prior it had released must come back, schedule included */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const collided = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, trackingKey: "TRACK002ABC" },
      supersedes: firstId,
    });
    expect(collided.status).toBe(409);
    const db = drizzle(env.DB);
    const [prior] = await db.select().from(payments).where(eq(payments.id, firstId));
    expect(prior.status).toBe("validating");
    expect(prior.nextValidationAt).not.toBeNull();
  });

  it("scenario 18c: a terminal owner on the payer's own link still refuses (US-D12, D9)", async () => {
    const { business, link } = await seedLinkedBusiness();
    await drizzle(env.DB)
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        status: "confirmed",
      });

    /* The transfer already bought something: attaching would show a live
       "Verificando" over a consumed clave. The refusal is honest here.
       bug: one-open-attempt — and it comes before any read: the same
       data as a paid attempt of this link asks WispHub nothing. */
    const res = await payTransfer();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("TRANSFER_ALREADY_USED");
    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(1);
  });

  it("scenario 19: a re-validation of the same row ignores the replay flag", async () => {
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        /* our own earlier attempt got a verdict — carve-out (a) */
        constaStatus: "pending",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 8 * 60 * 1000),
      })
      .returning();

    mockApiCep({ alreadyValidated: true });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("confirmed");
  });

  /* The 2026-08-18 spike found this live: apiCEP validated the CEP, the
     worker died before recording the verdict, and the honest retry was
     told TRANSFER_ALREADY_USED — for a transfer the customer had really
     made, with the money already in the ISP's account. */
  it("D7: the row is born owned by the sweep, before any verdict exists", async () => {
    const { link } = await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    /* The row has to be inspected while the provider is still thinking —
       once a verdict lands, every path writes a slot and the bug becomes
       invisible. A real validation takes ~15 s, so this window is the
       normal state of things, not an edge case. */
    apicep()
      .intercept({ method: "POST", path: "/validate-transfer" })
      .reply(...json(apiCepWire({ status: "pending", cep: undefined })))
      .delay(300);

    const inFlight = payTransfer();

    let row;
    for (let i = 0; i < 60 && !row; i++) {
      await new Promise((r) => setTimeout(r, 10));
      [row] = await drizzle(env.DB).select().from(payments);
    }
    expect(row, "the payment row should exist while the provider is still thinking").toBeDefined();
    expect(row!.paymentLinkId).toBe(link.id);
    expect(row!.constaStatus, "no verdict yet — that is the point").toBeNull();
    /* NULL here is what stranded the row live on 2026-08-18:
       sweepDirectPayments selects on isNotNull(nextValidationAt), so a
       row without a slot is invisible to it — never retried, and never
       expired either, because D7's 6-hour window only exists inside the
       sweep. The customer's money had moved and nothing would ever look
       at the payment again. */
    expect(row!.nextValidationAt, "born without a slot: the sweep can never see it").not.toBeNull();

    expect((await inFlight).status).toBe(201);
  });

  it("D8 carve-out (a): a call that never returned still counts as our own attempt", async () => {
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        /* Exactly the stranded row the spike produced: the attempt was
           recorded, the provider answered, and nothing came back to
           write `constaStatus`. Keying the carve-out on the verdict
           instead of the attempt is what made this a false rejection. */
        constaStatus: null,
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 8 * 60 * 1000),
      })
      .returning();

    mockApiCep({ alreadyValidated: true });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("confirmed");
    expect(row.lastError).toBeNull();
  });

  it("the attempt is recorded before the call, so a lost response leaves a trace", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    /* A provider that fails is the closest a test can get to one that
       never answers; both leave through the same catch. */
    apicep().intercept({ path: "/validate-transfer", method: "POST" }).reply(502, "{}");

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.status).toBe("validating");
    expect(row.constaStatus).toBeNull();
    /* The counter is the marker: written before the call, it is what
       tells the next attempt that a validation may already have landed. */
    expect(row.validationAttempts).toBe(1);
    expect(row.nextValidationAt).not.toBeNull();
  });
});

describe("D11: valid is necessary, not sufficient", () => {
  it("scenario 16 (partial-payment D1): a real $1 transfer is a real $1 payment, not a refusal", async () => {
    /* This asserted AMOUNT_MISMATCH and no charge. The money was already
       in the ISP's account, so the refusal discarded the only record it
       arrived. Now it settles $1 of the debt, earns no reconnection at
       the default threshold, and the ISP can see it. */
    const { link } = await seedLinkedBusiness();
    await testEnv.PROOFS.put(`${link.id}/proof-1`, new Uint8Array(10));
    /* twice: the submission checks the debt, and the validation reads it
       again fresh before deciding what the money settles */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep({
      cep: {
        trackingKey: "OTHERKEY99",
        amountCents: 100,
        date: new Date().toISOString().slice(0, 10),
      },
    });
    /* accion 0: the money is registered and the cut stays (D5) */
    const sent = mockReconnection("Suspendido", 42, false);

    const res = await payTransfer("tok2345abcdefgh2", { proofId: `${link.id}/proof-1` });
    const { data } = await res.json();
    expect(data.status).toBe("partial");

    expect(sent.accion).toBe(0);
    expect(sent.totalCobrado).toBe(1);

    const [charge] = await confirmedRows(drizzle(env.DB));
    expect(charge.receivedCents).toBe(100);
    expect(charge.actionOutcome).toBe("withheld");
  });

  it("scenario 17: a CEP older than 30 days → STALE_TRANSFER", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    mockApiCep({ cep: { trackingKey: "TRACK001XYZ", amountCents: 51400, date: old } });

    const res = await payTransfer();
    const { data } = await res.json();
    expect(data.status).toBe("invalid");
    expect(data.error).toBe("STALE_TRANSFER");
  });
});

describe("D14: a validated transfer with nothing left to pay", () => {
  it("scenario 20: paid at a store meanwhile → unapplied, no charge", async () => {
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        constaStatus: "pending",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 2 * 60 * 1000),
      })
      .returning();

    mockApiCep();
    /* debt settled at a store while the CEP was pending */
    mockCustomerLookup([{ ...wisphubCustomer(), estado_facturas: "Pagadas" }], 1);
    mockPendingInvoices([], 1);

    const report = await sweepDirectPayments(testEnv, now);
    expect(report.unapplied).toBe(1);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("unapplied");
    expect(row.folio).toBeNull();
    expect(await confirmedRows(db)).toHaveLength(0);
  });
});

describe("D12: proofs are private", () => {
  it("serves a proof only under a live signature", async () => {
    const { link } = await seedLinkedBusiness();
    const key = `${link.id}/proof-1`;
    await testEnv.PROOFS.put(key, new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: "image/png" },
    });

    const bare = await (await app()).request(`/direct-payments/proofs/${key}`, {}, testEnv);
    expect(bare.status).toBe(404);

    const signed = await signedProofUrl(testEnv, key, new Date());
    const path = signed.slice(signed.indexOf("/direct-payments"));
    const ok = await (await app()).request(path, {}, testEnv);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/png");
  });
});

/* D18: the machine reads, the human confirms, the direct door validates.
   docs/legacy/direct-payment/direct-payment.spec.md scenarios 46–49. */
describe("D18: reading a proof so a human can confirm it", () => {
  /* consta-api-merge D7/D12: the reader runs in-process on the bytes in
     the bucket, so the proof is a real PNG header and the model is
     stubbed at the binding with what it was measured returning
     (constitution IV). `/extract` on a Consta origin is gone. */
  const GOOD_READING = {
    esComprobante: true,
    claveDeRastreo: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
    banco: "NUBANK",
    monto: 514.0,
    fecha: "2026-08-19",
    estatus: "Aceptada",
  };

  const readProof = async (proofId: string, reading: Record<string, unknown> = GOOD_READING, token = "tok2345abcdefgh2") =>
    (await app()).request(
      `/direct-payments/links/${token}/read`,
      post({ proofId }),
      { ...testEnv, AI: aiReturning(reading) },
    );

  it("scenario 46: the reading comes back with no provider credit spent", async () => {
    const { link } = await seedLinkedBusiness();
    await testEnv.PROOFS.put(`${link.id}/proof-1`, PNG(), { httpMetadata: { contentType: "image/png" } });

    const res = await readProof(`${link.id}/proof-1`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.trackingKey).toBe("NU3AGKMP3ASP8QQQ4U8J8F0K1E4K");
    /* Measured: apiCEP filters on `sender.amount`, so the caller needs
       the read amount to refuse a lookup that cannot succeed (D3) */
    expect(data.amountCents).toBe(51400);
    expect(data.senderBank).toBe("NUBANK");
    expect(data.source).toBe("reader");
    /* The engine reads the bucket directly (consta-api-merge D7); the
       bucket is never public (D12) and no provider interceptor is armed:
       a credit spent here would fail this test */

    /* Reading is not paying: no `direct_payments` row exists yet */
    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(0);
  });

  it("scenario 47: a field the gate refused arrives empty, never as a confirmable guess", async () => {
    const { link } = await seedLinkedBusiness();
    await testEnv.PROOFS.put(`${link.id}/proof-1`, PNG(), { httpMetadata: { contentType: "image/png" } });
    /* The clave printed across two lines (BUG-006's shape) and a bank
       off the vocabulary: the real gate refuses both */
    const res = await readProof(`${link.id}/proof-1`, {
      ...GOOD_READING,
      claveDeRastreo: "NU3AGKMP3ASP8QQ 4U8J8F0K1E4K",
      banco: "Banco Inventado",
    });
    const { data } = await res.json();
    /* A malformed clave is worse than no clave: it looks confirmable,
       and a payer clicking through it spends a paid call to learn
       nothing (`not_found` says the same thing for four causes) */
    expect(data.trackingKey).toBeNull();
    expect(data.senderBank).toBeNull();
    expect(data.gate.trackingKey).toBe("malformed");
  });

  it("scenario 48: a proof from another link is not readable through this one", async () => {
    const { link } = await seedLinkedBusiness();
    await testEnv.PROOFS.put("someone-elses-link/proof-1", new Uint8Array(10));

    /* Proofs are token-bound (D12): no cross-link reads, and no provider
       call spent finding out */
    expect((await readProof("someone-elses-link/proof-1")).status).toBe(404);
    /* a key that was never uploaded is indistinguishable from one that
       belongs to somebody else */
    expect((await readProof(`${link.id}/never-uploaded`)).status).toBe(404);
  });

  it("scenario 49: a confirmed reading pays through the transfer door, with the image kept", async () => {
    const { link } = await seedLinkedBusiness();
    await testEnv.PROOFS.put(`${link.id}/proof-1`, new Uint8Array(10));
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockApiCep({ status: "pending", cep: undefined });

    const res = await payTransfer("tok2345abcdefgh2", {
      proofId: `${link.id}/proof-1`,
      transfer: { trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K", senderBank: "NUBANK", date: "2026-08-19" },
    });
    expect(res.status).toBe(201);

    /* The transfer door is what validates — the door that has not missed
       once — and the receipt never reaches the provider at all */
    expect(captured.body?.sender).toBeDefined();
    expect(captured.body?.imageUrl).toBeUndefined();

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.proofMode).toBe("transfer");
    /* The image stays attached: it is the evidence the ISP will want */
    expect(row.proofKey).toBe(`${link.id}/proof-1`);
    expect(row.trackingKey).toBe("NU3AGKMP3ASP8QQQ4U8J8F0K1E4K");
  });
});

/* D18 continued: what a confirmation does to the row that preceded it.
   Scenarios 53–56. */
describe("D18: a correction supersedes, an unchanged confirmation costs nothing", () => {
  async function silentAttempt(transfer: Record<string, string>) {
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer,
      receiptStatus: "Aceptada",
    });
    const { data } = await res.json();
    return data.directPaymentId as string;
  }

  const READ = {
    trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
    senderBank: "NUBANK",
    date: "2026-08-19",
  };

  it("scenario 53: confirming the same three values keeps the row and spends no second credit", async () => {
    await seedLinkedBusiness();
    const db = drizzle(env.DB);
    const first = await silentAttempt(READ);

    /* No wisphub and no consta interceptors registered on purpose: if
       this path spent a call, the test would fail on a missing mock. */
    const res = await payTransfer("tok2345abcdefgh2", { transfer: READ, supersedes: first });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.directPaymentId).toBe(first);

    const rows = await db.select().from(payments);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("validating");
    /* the schedule and the attempt count survive untouched */
    expect(rows[0].nextValidationAt).not.toBeNull();
    expect(rows[0].validationAttempts).toBe(1);
  });

  it("scenario 54: a corrected confirmation supersedes the first row and releases its clave", async () => {
    await seedLinkedBusiness();
    const db = drizzle(env.DB);
    const first = await silentAttempt(READ);

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...READ, trackingKey: "HSBC712057" },
      supersedes: first,
    });
    expect(res.status).toBe(201);

    const rows = await db.select().from(payments).orderBy(payments.createdAt);
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.id === first)!;
    const fresh = rows.find((r) => r.id !== first)!;
    expect(old.status).toBe("superseded");
    /* Released: the misread clave may belong to another customer of the
       same ISP, and D8's index would have blocked a payment they really
       made for six hours */
    expect(old.nextValidationAt).toBeNull();
    expect(fresh.trackingKey).toBe("HSBC712057");
    /* the pair (what was read, what was confirmed) stays recoverable */
    expect(fresh.supersedesId).toBe(first);
  });

  it("scenario 55: a superseded row is not swept and cannot be revived", async () => {
    await seedLinkedBusiness();
    const db = drizzle(env.DB);
    const first = await silentAttempt(READ);
    await db
      .update(payments)
      .set({ status: "superseded", nextValidationAt: new Date(Date.now() - 1000) })
      .where(eq(payments.id, first));

    /* No consta interceptor: the sweep must not touch it */
    const report = await sweepDirectPayments(testEnv, new Date());
    expect(report.claimed).toBe(0);

    /* and it cannot be superseded a second time */
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...READ, trackingKey: "HSBC712057" },
      supersedes: first,
    });
    expect(res.status).toBe(404);
  });

  it("scenario 56: a confirmed payment records who Banxico says sent the money", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    mockApiCep();

    await payTransfer();
    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.status).toBe("confirmed");
    /* Recorded and acted on by nothing: people pay for relatives, so a
       mismatch can only ever be a signal for the ISP (D18) */
    expect(row.cepSenderName).toBe("JANELY REYES");
  });

  it("scenario 58 (partial-payment D5): the receipt's amount is what travels to Banxico", async () => {
    /* This asserted a 409 and no row. The reasoning was right — a lookup
       asking with the expected amount could only come back faceless —
       and the conclusion was wrong: the fix is to ask with the amount the
       receipt actually shows, which is the transfer the payer made. */
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockApiCep({ status: "pending", cep: undefined });

    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: READ,
      receiptAmountCents: 30000,
    });
    expect(res.status).toBe(201);
    const sent = captured.body as { sender: { amount: number } };
    expect(sent.sender.amount).toBe(300);

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.claimedAmountCents).toBe(30000);
  });

  it("scenario 58b: the matching amount goes through, and omitting it changes nothing", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });

    /* 49900 + 1500 — the debt this seed produces */
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: READ,
      receiptAmountCents: 51400,
    });
    expect(res.status).toBe(201);
    /* It never decides what is charged: that is still computed here from
       a fresh WispHub read, so omitting the field cannot buy a cheaper
       payment — it only forfeits the instant answer. */
    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.amountCents).toBe(51400);
  });

  it("a supersedes pointing at another link's payment is refused", async () => {
    await seedLinkedBusiness();
    const first = await silentAttempt(READ);
    const db = drizzle(env.DB);
    /* re-home the row on a link this token does not own */
    const [otherLink] = await db
      .insert(paymentLinks)
      .values({
        businessId: (await db.select().from(payments))[0].businessId,
        token: "tok9999zzzzzzzz9",
        wisphubCustomerId: "7",
        customerUsuario: "otro@wifiplus",
      })
      .returning();
    await db
      .update(payments)
      .set({ paymentLinkId: otherLink.id })
      .where(eq(payments.id, first));

    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...READ, trackingKey: "HSBC712057" },
      supersedes: first,
    });
    expect(res.status).toBe(404);
  });
});

/* docs/legacy/direct-payment/partial-payment.spec.md scenarios 1–7 — US-D10.
   A short transfer used to be refused with no row written, while the
   money was already in the ISP's account. */
describe("US-D10: a transfer that falls short", () => {
  const SHORT = { ...TRANSFER };

  /* The seed owes 49900 and charges a 1500 fee, so 51400 is the whole
     ask and the ISP's own debt is 49900. */
  function shortCep(amountCents: number) {
    return {
      cep: {
        trackingKey: "TRACK001XYZ",
        amountCents,
        date: new Date().toISOString().slice(0, 10),
        senderBank: "NUBANK",
        senderName: "JANELY REYES",
        receiverBank: "STP",
        beneficiaryName: "WifiPlus SA de CV",
      },
    };
  }

  it("scenario 1: below the threshold → partial, accion 0, the cut stays, a charge exists", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep(shortCep(30000));
    const sent = mockReconnection("Suspendido", 42, false);

    const res = await payTransfer("tok2345abcdefgh2", SHORT);
    const { data } = await res.json();
    expect(data.status).toBe("partial");
    /* D5: the money is registered either way — only the router is left
       alone. Devolada's fee takes nothing, because the ISP is paid first. */
    expect(sent.accion).toBe(0);
    expect(sent.totalCobrado).toBe(300);

    const [charge] = await confirmedRows(drizzle(env.DB));
    expect(charge.receivedCents).toBe(30000);
    /* D14: the whole fee accrues even though the payer covered none of
       it. The money reached the ISP's bank, so the ISP owes it onward —
       the commission is never forgiven. */
    expect(charge.serviceFeeCents).toBe(1500);
    expect(charge.actionOutcome).toBe("withheld");

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.receivedCents).toBe(30000);
  });

  it("scenario 2: the same transfer with a lenient threshold → accion 1, still partial", async () => {
    /* D6: `partial` is about the debt, not the router. A payment can
       reconnect and still leave a balance. */
    await seedLinkedBusiness({ reconnectionThresholdPercent: 60 });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep(shortCep(30000));
    const sent = mockReconnection("Activo", 42);

    const res = await payTransfer("tok2345abcdefgh2", SHORT);
    const { data } = await res.json();
    expect(data.status).toBe("partial");
    expect(sent.accion).toBe(1);
    const [charge] = await confirmedRows(drizzle(env.DB));
    expect(charge.actionOutcome).toBe("done");
  });

  it("scenario 3: over the percentage but under the floor → still withheld", async () => {
    await seedLinkedBusiness({ reconnectionThresholdPercent: 60, reconnectionFloorCents: 40000 });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep(shortCep(30000));
    const sent = mockReconnection("Suspendido", 42, false);

    await payTransfer("tok2345abcdefgh2", SHORT);
    expect(sent.accion).toBe(0);
  });

  it("scenario 4: the ISP's debt decides, never Devolada's fee", async () => {
    /* 49900 arrives against a 51400 ask: the mensualidad is covered and
       our 1500 is not. The customer is reconnected and we eat the fee —
       leaving somebody offline over it would cost more in one support
       call than the fee is worth (D3). */
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep(shortCep(49900));
    const sent = mockReconnection("Activo", 42);

    const res = await payTransfer("tok2345abcdefgh2", SHORT);
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");
    expect(sent.accion).toBe(1);
    expect(sent.totalCobrado).toBe(499);

    const [charge] = await confirmedRows(drizzle(env.DB));
    /* The payer covered the mensualidad and none of our fee. The ISP is
       made whole in WispHub, the customer is reconnected, and Devolada
       still accrues its 15.00 against the ISP (D14). */
    expect(charge.registeredCents).toBe(49900);
    expect(charge.serviceFeeCents).toBe(1500);
  });

  it("scenario 6: more than the debt → confirmed, and the surplus travels on", async () => {
    /* D10: no special case. Our fee takes its part and the rest goes to
       WispHub, which turns it into a credit against the next cycle. */
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep(shortCep(60000));
    const sent = mockReconnection("Activo", 42);

    const res = await payTransfer("tok2345abcdefgh2", SHORT);
    expect((await res.json()).data.status).toBe("confirmed");
    /* 600.00 − 15.00 of fee = 585.00 registered; 86.00 over the debt */
    expect(sent.totalCobrado).toBe(585);
  });

  it("scenario 7: the three amounts reach the page in money, never a percentage", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep(shortCep(30000));
    mockReconnection("Suspendido", 42, false);

    const res = await payTransfer("tok2345abcdefgh2", SHORT);
    const { data } = await res.json();
    const status = await (await app()).request(
      `/direct-payments/${data.directPaymentId}/status`,
      {},
      testEnv,
    );
    const { data: s } = await status.json();
    expect(s.status).toBe("partial");
    expect(s.receivedCents).toBe(30000);
    expect(s.debtCents).toBe(49900);
    expect(s.missingCents).toBe(19900);
  });
});

/* partial-payment.spec.md D14 — the fee is a receivable, not a slice of
   the transfer. Every peso the payer sent landed in the ISP's own bank
   account, so what Devolada holds is a debt the ISP settles monthly. */
describe("US-D10 / US-L01: the commission is never forgiven", () => {
  it("a short payment still accrues the whole fee to the platform statement", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep({
      cep: {
        trackingKey: "TRACK001XYZ",
        amountCents: 20000,
        date: new Date().toISOString().slice(0, 10),
        senderBank: "NUBANK",
        senderName: "JANELY REYES",
        receiverBank: "STP",
        beneficiaryName: "WifiPlus SA de CV",
      },
    });
    mockReconnection("Suspendido", 42, false);

    await payTransfer("tok2345abcdefgh2", TRANSFER);

    const [charge] = await confirmedRows(drizzle(env.DB));
    /* 200.00 arrived and every peso of it went to the ISP's debt; the
       15.00 accrues anyway, because the ISP is the one who received the
       money and owes it onward. */
    expect(charge.registeredCents).toBe(20000);
    expect(charge.serviceFeeCents).toBe(1500);
    /* `settlement` D1 derives the platform's share from exactly this
       column, and a spei charge carries no store commission (D6). */
  });
});

describe("US-D13: the amount the payer really sent", () => {
  /* The manual door's body once claimed-amount D3 ships: the payer's
     own number rides with the data they already typed. */
  const TYPED = {
    transfer: {
      trackingKey: "TRACK001XYZ",
      senderBank: "NUBANK",
      date: "2026-08-17",
      amountCents: 40000,
    },
  };

  it("scenario 2: the typed amount is what travels to Banxico", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockApiCep({ status: "pending", cep: undefined });

    const res = await payTransfer("tok2345abcdefgh2", TYPED);
    expect(res.status).toBe(201);
    const [payment] = await drizzle(env.DB).select().from(payments);
    expect(payment.claimedAmountCents).toBe(40000);
    const sent = captured.body as { sender: { amount: number } };
    expect(sent.sender.amount).toBe(400);
  });

  it("scenario 5: only a changed amount supersedes; four equal fields spend nothing", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const first = await payTransfer("tok2345abcdefgh2", TYPED);
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.directPaymentId;

    /* Identical four fields → the row is kept before any WispHub or
       Consta call — no mocks are armed, so reaching one would fail */
    const same = await payTransfer("tok2345abcdefgh2", { ...TYPED, supersedes: firstId });
    expect(same.status).toBe(200);
    expect((await same.json()).data.directPaymentId).toBe(firstId);

    /* A new amount changes what Banxico is asked: a real correction */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const edited = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TYPED.transfer, amountCents: 35000 },
      supersedes: firstId,
    });
    expect(edited.status).toBe(201);
    const rows = await drizzle(env.DB).select().from(payments);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === firstId)?.status).toBe("superseded");
    expect(rows.find((r) => r.id !== firstId)?.claimedAmountCents).toBe(35000);
  });

  it("scenario 6: the status answers with the claimed amount", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", TYPED);
    const { directPaymentId } = (await res.json()).data;

    const status = await (await app()).request(
      `/direct-payments/${directPaymentId}/status`,
      {},
      testEnv,
    );
    const { data } = await status.json();
    expect(data.claimedAmountCents).toBe(40000);
  });

  it("scenario 8: the claim cannot change the charge — the CEP decides", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep(); /* the CEP says 51400 arrived */
    mockReconnection("Activo");

    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TYPED.transfer, amountCents: 99900 },
    });
    expect((await res.json()).data.status).toBe("confirmed");
    const [charge] = await confirmedRows(drizzle(env.DB));
    expect(charge.receivedCents).toBe(51400);
  });

  it("scenario 7: no beneficiary name — validation runs, the request omits it, the link hides it", async () => {
    await seedLinkedBusiness({ speiBeneficiaryName: null });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    const captured = mockApiCep();
    mockReconnection("Activo");

    const res = await payTransfer();
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe("confirmed");
    const sent = captured.body as { beneficiary: Record<string, unknown> };
    expect("name" in sent.beneficiary).toBe(false);

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const link = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2",
      {},
      testEnv,
    );
    const { data } = await link.json();
    expect(data.status).toBe("debt");
    expect("speiBeneficiaryName" in data).toBe(false);
  });
});

/* two-eyes-receipt US1 — the classifier at minute zero.

   The sibling of "US-D14: the classifier at minute two" below, for rows
   born after the cut-over. Those rows are `proof_mode = 'receipt'` with a
   `proof_key`: the page sends the file alone now (D13), so the first paid
   call goes to the provider's image door with the engine's reading beside
   it and the comparison happens at attempt 1 rather than attempt 2. What
   the two settled on is written on the row, and the *next* attempt reads
   its door out of those fields (D17). */
describe("two-eyes-receipt US1: the classifier at minute zero", () => {
  /* The shape rules are cached for a minute and the cache outlives a
     test's isolated storage, so a scenario that must meet cold start
     (no graduated rule — the common case, D7) has to start from one. */
  beforeEach(() => resetShapeRules());

  const CLAVE = "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K";
  const READING = {
    esComprobante: true,
    claveDeRastreo: CLAVE,
    banco: "NUBANK",
    monto: 514.0,
    fecha: "2026-08-19",
    estatus: "Aceptada",
  };
  /* The engine reads the file itself, so the suite binds the reader the
     way the engine suite does — it is the one thing a test stands in for
     (constitution IV). */
  const readerEnv = (reading: Record<string, unknown> = READING) =>
    ({ ...testEnv, AI: aiReturning(reading) }) as typeof testEnv;

  /* A row born the new way: a file, and nothing typed. */
  async function seedReceipt(
    over: Record<string, unknown> = {},
    businessOver: Parameters<typeof seedLinkedBusiness>[0] = {},
  ) {
    const { business, link } = await seedLinkedBusiness(businessOver);
    const now = new Date();
    const db = drizzle(env.DB);
    const proofKey = `${link.id}/proof-1`;
    await testEnv.PROOFS.put(proofKey, PNG(), { httpMetadata: { contentType: "image/png" } });
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "receipt",
        proofKey,
        claimedAmountCents: 51400,
        nextValidationAt: new Date(now.getTime() - 1000),
        ...over,
      })
      .returning();
    return { business, link, payment, now, db, proofKey };
  }

  const rowOf = async (db: ReturnType<typeof drizzle>, id: string) =>
    (await db.select().from(payments).where(eq(payments.id, id)))[0];

  const statusOf = async (id: string) => {
    const res = await (await app()).request(`/direct-payments/${id}/status`, {}, testEnv);
    return (await res.json()).data as Record<string, unknown>;
  };

  /* Ten confirmed claves of one length graduate a bank's shape rule
     (proof-extraction D14), which is the only tiebreak the comparison
     has when the two readings differ (D7). */
  /* Ten claves that differ in one digit position: the derived pattern is
     the literal letters, `\d` where the samples varied, and the same
     28-character length — which `CLAVE` (i = 1) fits and a truncated
     clave does not. That is the whole tiebreak (proof-extraction D14). */
  const nuClave = (i: number) => `NU3AGKMP3ASP8QQQ4U8J8F0K${i}E4K`;
  async function seedNuShape(businessId: string) {
    await seedValidations(
      businessId,
      Array.from({ length: 10 }, (_, i) => ({
        mode: "transfer" as const,
        status: "valid" as const,
        senderBank: "NUBANK",
        trackingKey: nuClave(i),
        amountCents: 100,
        transferDate: "2026-08-19",
      })),
    );
    /* The rules are cached for a minute (proof-extraction D14): a test
       that seeds the log has to see its own rows at once */
    resetShapeRules();
  }

  const providerRead = (over: Record<string, unknown> = {}) => ({
    trackingKey: CLAVE,
    amountCents: 51400,
    date: "2026-08-19",
    senderBank: "NUBANK",
    referenceNumber: null,
    ...over,
  });

  it("scenario 1: the first paid call sends the file, never the reading (D3)", async () => {
    const { payment, now, db } = await seedReceipt();
    const captured = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined, reading: providerRead() });

    await sweepDirectPayments(readerEnv(), now);
    const sent = captured.body as Record<string, unknown>;
    expect(String(sent.imageUrl)).toContain("proof");
    expect(sent.sender).toBeUndefined();
    expect((await rowOf(db, payment.id)).readingCheckAttempt).toBe(1);
  });

  it("scenario 2: the two readings agree at attempt 1, and the next slot takes the transfer door (D6, D17)", async () => {
    const { payment, now, db } = await seedReceipt();
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined, reading: providerRead() });

    await sweepDirectPayments(readerEnv(), now);
    const row = await rowOf(db, payment.id);
    expect(row.status).toBe("validating");
    expect(row.readingCheck).toBe("agreed");
    expect(row.readingCheckAttempt).toBe(1);
    expect(row.acceptedFrom).toBe("agreed");
    expect(row.disputedFields).toBeNull();
    /* D17: what they settled on is on the row, so the door of the next
       attempt is read out of it — `proof_mode` stays what the payer sent */
    expect(row.trackingKey).toBe(CLAVE);
    expect(row.senderBank).toBe("NUBANK");
    expect(row.transferDate).toBe("2026-08-19");
    expect(row.proofMode).toBe("receipt");

    /* D9: never an immediate second call — the schedule's own slot */
    const later = new Date(row.nextValidationAt!.getTime() + 1000);
    const captured = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(readerEnv(), later);
    const sent = captured.body as Record<string, unknown>;
    expect(sent.imageUrl).toBeUndefined();
    expect((sent.sender as Record<string, unknown>).trackingKey).toBe(CLAVE);
    expect((sent.sender as Record<string, unknown>).bank).toBe("NUBANK");
  });

  it("scenario 3: a dispute the shape rules settle for us sends our clave next (D7)", async () => {
    const { business, payment, now, db } = await seedReceipt();
    await seedNuShape(business.id);
    /* Their clave is four characters short of the graduated shape, ours
       fits it — so ours wins and no human is disturbed */
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: providerRead({ trackingKey: "NU3AGKMP3ASP8QQQ4U8" }),
    });

    await sweepDirectPayments(readerEnv(), now);
    const row = await rowOf(db, payment.id);
    expect(row.readingCheck).toBe("disputed");
    expect(row.acceptedFrom).toBe("reader");
    expect(row.trackingKey).toBe(CLAVE);
    expect(row.disputedFields).toBeNull();

    const captured = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(readerEnv(), new Date(row.nextValidationAt!.getTime() + 1000));
    expect(((captured.body as Record<string, unknown>).sender as Record<string, unknown>).trackingKey).toBe(CLAVE);
  });

  it("scenario 4: a dispute the shape rules settle for them sends theirs next, and asks nobody (D7)", async () => {
    const { business, payment, now, db } = await seedReceipt();
    await seedNuShape(business.id);
    /* Ours is the short one this time; theirs fits the bank's shape */
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: providerRead({ trackingKey: nuClave(3) }),
    });

    await sweepDirectPayments(readerEnv({ ...READING, claveDeRastreo: "NU3AGKMP3ASP8QQQ4U8" }), now);
    const row = await rowOf(db, payment.id);
    expect(row.readingCheck).toBe("disputed");
    expect(row.acceptedFrom).toBe("provider");
    expect(row.trackingKey).toBe(nuClave(3));
    expect(row.disputedFields).toBeNull();

    const captured = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(readerEnv(), new Date(row.nextValidationAt!.getTime() + 1000));
    expect(((captured.body as Record<string, unknown>).sender as Record<string, unknown>).trackingKey).toBe(nuClave(3));
  });

  it("scenario 5: a dispute nothing can settle names the fields, and spends nothing more this minute (D8, D9)", async () => {
    const { payment, now, db } = await seedReceipt();
    /* No graduated rule for NUBANK in this test's log: cold start, which
       is the common case and lands in "ask the payer" as D7 intends */
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: providerRead({ trackingKey: "NU3AOTHERREADING00000000X8P", amountCents: 40000 }),
    });

    await sweepDirectPayments(readerEnv(), now);
    const row = await rowOf(db, payment.id);
    expect(row.readingCheck).toBe("disputed");
    expect(row.acceptedFrom).toBeNull();
    expect(row.trackingKey).toBeNull();
    const data = await statusOf(payment.id);
    expect(data.readingCheck).toBe("disputed");
    expect(data.disputedFields).toEqual(["trackingKey", "amount"]);

    /* D9: no second call in the same minute — the payer is asked, and
       the row waits for its own slot */
    await sweepDirectPayments(readerEnv(), now);
    expect((await rowOf(db, payment.id)).validationAttempts).toBe(1);
  });

  it("scenario 6: the provider goes blind and our complete reading carries the payment (FR-013)", async () => {
    const { payment, now, db } = await seedReceipt();
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });

    await sweepDirectPayments(readerEnv(), now);
    const row = await rowOf(db, payment.id);
    expect(row.readingCheck).toBe("blind");
    expect(row.blindSide).toBe("provider");
    expect(row.acceptedFrom).toBe("reader");
    expect(row.trackingKey).toBe(CLAVE);
    /* reading-check D2, kept: blindness stays null on the wire — no
       evidence either way is the same as no comparison */
    expect((await statusOf(payment.id)).readingCheck).toBeNull();

    const captured = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(readerEnv(), new Date(row.nextValidationAt!.getTime() + 1000));
    expect(((captured.body as Record<string, unknown>).sender as Record<string, unknown>).trackingKey).toBe(CLAVE);
  });

  it("scenario 7: agreement at minute zero buys the provisional release (D6)", async () => {
    const { payment, now, db } = await seedReceipt({}, { provisionalReleaseEnabled: true });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined, reading: providerRead() });
    mockPromise();

    await sweepDirectPayments(readerEnv(), now);
    const row = await rowOf(db, payment.id);
    /* provisional-release D1: the promise used to wait for the
       minute-two cross; agreement now arrives on the first call, so the
       payer's internet comes back a schedule slot sooner */
    expect(row.releaseEvidence).toBe("agreed");
    expect(row.provisionalReleaseAt).not.toBeNull();
  });

  it("scenario 8: a valid on the first call still adopts the CEP's key", async () => {
    const { payment, now, db } = await seedReceipt();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    mockApiCep({
      cep: {
        trackingKey: "NU3AREALQKRNKJHK00000000X8P",
        amountCents: 51400,
        /* Today: a CEP older than 30 days is STALE_TRANSFER (D11), which
           is a different scenario than the one under test */
        date: new Date().toISOString().slice(0, 10),
        senderBank: "NUBANK",
        senderName: "JANELY REYES",
        receiverBank: "STP",
        beneficiaryName: "WifiPlus SA de CV",
      },
    });

    await sweepDirectPayments(readerEnv(), now);
    const row = await rowOf(db, payment.id);
    expect(row.status).toBe("confirmed");
    /* Only the CEP outranks a reading, and the index must end up holding
       the truth (reading-check D7) */
    expect(row.trackingKey).toBe("NU3AREALQKRNKJHK00000000X8P");
    /* `valid` needs no second opinion: the CEP decided (D5) */
    expect(row.readingCheck).toBeNull();
  });

  it("scenario 9: agreement with no date asks for the date alone, and never guesses one (D20)", async () => {
    const { payment, now, db } = await seedReceipt();
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: providerRead({ date: null }),
    });

    await sweepDirectPayments(readerEnv({ ...READING, fecha: null }), now);
    const row = await rowOf(db, payment.id);
    /* The agreement stands — the clock retires, the release may fire — */
    expect(row.readingCheck).toBe("agreed");
    expect(row.acceptedFrom).toBe("agreed");
    /* — and exactly one field is asked for */
    expect(row.transferDate).toBeNull();
    expect((await statusOf(payment.id)).disputedFields).toEqual(["date"]);

    /* D9: nothing more is spent this minute */
    await sweepDirectPayments(readerEnv(), now);
    expect((await rowOf(db, payment.id)).validationAttempts).toBe(1);

    /* D20: and when the slot does come, the transfer door is *not*
       called with a date nobody read — the row keeps its receipt door
       until the payer's correction supersedes it with one */
    const captured = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(readerEnv(), new Date(row.nextValidationAt!.getTime() + 1000));
    const sent = captured.body as Record<string, unknown>;
    expect(sent.sender).toBeUndefined();
    expect(String(sent.imageUrl)).toContain("proof");
  });
  it("scenario 11: a settled agreement is taken once — a later reading may fill the date, never undo it (D20, FR-010)", async () => {
    const { payment, now, db } = await seedReceipt();
    /* Neither side reads a date, and they agree on everything else: the
       D20 row. It keeps the receipt door until the payer supplies the
       one field, so unlike every other settled row it *does* meet a
       second comparison. */
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: providerRead({ date: null }),
    });
    await sweepDirectPayments(readerEnv({ ...READING, fecha: null }), now);

    let row = await rowOf(db, payment.id);
    expect(row.readingCheck).toBe("agreed");
    expect(row.trackingKey).toBe(CLAVE);

    /* The next slot. Our own reading is reused inside the window (D14),
       so what can differ on a second look is the provider's OCR of the
       same file — and here it does, reading a clave one character apart
       with no rule graduated to break the tie. */
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: providerRead({ trackingKey: `${CLAVE.slice(0, -1)}X`, date: null }),
    });
    await sweepDirectPayments(readerEnv(), new Date(row.nextValidationAt!.getTime() + 1000));

    row = await rowOf(db, payment.id);
    /* FR-010: "The agreement still stands." Two machines settled this
       once, the payer was told so, and a later look at the same file
       does not take it back — the clock stays retired, the release keeps
       its evidence, and the question asked stays the one field. */
    expect(row.readingCheck).toBe("agreed");
    expect(row.acceptedFrom).toBe("agreed");
    expect(row.trackingKey).toBe(CLAVE);
    /* Taken once, at the call that took it (spec edge case) */
    expect(row.readingCheckAttempt).toBe(1);
    expect((await statusOf(payment.id)).disputedFields).toEqual(["date"]);

    /* D19: the record still counts what that second call actually saw —
       the measurement must not be quieted by the row's stability. */
    const rows = await db.select().from(extractions).orderBy(asc(extractions.createdAt));
    expect(rows.at(-1)!.readingCheck).toBe("disputed");
    expect(rows.at(-1)!.providerTrackingKey).toBe(`${CLAVE.slice(0, -1)}X`);
  });

  it("scenario 10: the transfer-door retry is the payment's own attempt, never a stranger's (FR-021)", async () => {
    const { payment, now, db } = await seedReceipt();
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined, reading: providerRead() });
    await sweepDirectPayments(readerEnv(), now);
    const row = await rowOf(db, payment.id);
    expect(row.acceptedFrom).toBe("agreed");

    /* direct-payment D8's carve-out: the provider's replay flag is
       permanent per CEP, and the first call — this row's own, on the
       image door — is what set it. The retry that follows an agreement
       must confirm the payment, not accuse its payer of reusing
       somebody else's transfer. */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    mockApiCep({ alreadyValidated: true });
    await sweepDirectPayments(readerEnv(), new Date(row.nextValidationAt!.getTime() + 1000));

    const after = await rowOf(db, payment.id);
    expect(after.status).toBe("confirmed");
    expect(after.lastError).not.toBe("TRANSFER_ALREADY_USED");
  });
});

describe("US-D14: the classifier at minute two", () => {
  /* A reader-sourced payment whose inline attempt found nothing: image
     stored, misread clave on the row, one attempt spent. */
  const CROSS_ROW = {
    amountCents: 51400,
    invoiceCents: 49900,
    serviceFeeCents: 1500,
    proofMode: "transfer",
    trackingKey: "NU3AMISREADQRNKJHK000000X8P",
    senderBank: "NUBANK",
    claimedAmountCents: 51400,
    proofKey: "lk-1/proof-1",
    validationAttempts: 1,
    lastError: "TRANSFER_NOT_FOUND",
  } as const;

  async function seedCross(over: Record<string, unknown> = {}) {
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        ...CROSS_ROW,
        transferDate: new Date().toISOString().slice(0, 10),
        nextValidationAt: new Date(now.getTime() - 1000),
        ...over,
      })
      .returning();
    return { business, link, payment, now, db };
  }

  const statusOf = async (id: string) => {
    const res = await (await app()).request(`/direct-payments/${id}/status`, {}, testEnv);
    return (await res.json()).data as Record<string, unknown>;
  };

  it("scenario 1: the cross sends the image with providerOcr, and a valid adopts the CEP's key", async () => {
    const { payment, now, db } = await seedCross();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    const captured = mockApiCep({
      cep: {
        trackingKey: "NU3AREALQKRNKJHK00000000X8P",
        amountCents: 51400,
        date: new Date().toISOString().slice(0, 10),
        senderBank: "NUBANK",
        senderName: "JANELY REYES",
        receiverBank: "STP",
        beneficiaryName: "WifiPlus SA de CV",
      },
    });

    await sweepDirectPayments(testEnv, now);
    /* `providerOcr` is the engine's own flag; what the provider sees is
       the image on its OCR door and no transfer data (proof-extraction
       D11) */
    const sent = captured.body as Record<string, unknown>;
    expect(String(sent.imageUrl)).toContain("proof");
    expect(sent.sender).toBeUndefined();

    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("confirmed");
    /* reading-check D7: the index ends up holding the truth */
    expect(row.trackingKey).toBe("NU3AREALQKRNKJHK00000000X8P");
  });

  /* two-eyes-receipt D16 / FR-020 — the cut-over, which is a *shape* and
     not a column (research R10). These two scenarios are the whole
     migration story: the old flow keeps running for rows that can only
     have been born in it, and no new row can enter it. */
  it("two-eyes-receipt US1: a legacy-shaped row still crosses at minute two, and says so", async () => {
    const { payment, now, db } = await seedCross();
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: { trackingKey: CROSS_ROW.trackingKey, amountCents: 51400, date: "2026-08-26", senderBank: "Nubank", referenceNumber: null },
    });

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.readingCheck).toBe("agreed");
    /* FR-018: the attempt records *when* the comparison was taken, never
       which flow ran — a new-flow row whose inline attempt died
       classifies at 2 as well. The D16 shape is what tells them apart. */
    expect(row.readingCheckAttempt).toBe(2);
  });

  it("two-eyes-receipt US1: a row born the new way never takes the legacy cross", async () => {
    /* `supersedes_id` is one of the three things that rule a row out of
       the legacy shape; a typed correction always has one. A row with a
       file and typed data *and* a parent could only have been born after
       the cut-over, so it classifies at its own first call instead. */
    const { business, link } = await seedLinkedBusiness();
    const db = drizzle(env.DB);
    const now = new Date();
    const [parent] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        ...CROSS_ROW,
        trackingKey: null,
        status: "superseded",
        transferDate: new Date().toISOString().slice(0, 10),
      })
      .returning();
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        ...CROSS_ROW,
        supersedesId: parent.id,
        transferDate: new Date().toISOString().slice(0, 10),
        nextValidationAt: new Date(now.getTime() - 1000),
      })
      .returning();

    const captured = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(testEnv, now);
    /* The transfer door, with the payer's own data — not the image on
       the provider's OCR door that the legacy cross would have sent */
    const sent = captured.body as Record<string, unknown>;
    expect(sent.imageUrl).toBeUndefined();
    expect((sent.sender as Record<string, unknown>).trackingKey).toBe(CROSS_ROW.trackingKey);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.readingCheck).toBeNull();
    expect(row.readingCheckAttempt).toBeNull();
  });

  it("scenario 2: a matching reading writes agreed, and the ride keeps its schedule", async () => {
    const { payment, now, db } = await seedCross();
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: {
        trackingKey: CROSS_ROW.trackingKey,
        amountCents: 51400,
        date: "2026-08-26",
        senderBank: "Nubank",
        referenceNumber: "260826",
      },
    });

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("validating");
    expect(row.readingCheck).toBe("agreed");
    expect(row.disputedFields).toBeNull();
    expect((await statusOf(payment.id)).readingCheck).toBe("agreed");
  });

  it("scenario 3+5: a differing clave and amount write disputed, with the fields named", async () => {
    const { payment, now, db } = await seedCross();
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: {
        trackingKey: "NU3AOTHERREADING00000000X8P",
        amountCents: 40000,
        date: "2026-08-26",
        senderBank: "Nubank",
        referenceNumber: null,
      },
    });

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.readingCheck).toBe("disputed");
    const data = await statusOf(payment.id);
    expect(data.readingCheck).toBe("disputed");
    expect(data.disputedFields).toEqual(["trackingKey", "amount"]);
  });

  it("scenario 6: a blind cross stays null on the wire — no evidence is the same as no cross", async () => {
    const { payment, now, db } = await seedCross();
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    /* Internally recorded so the cross never repeats (D5)… */
    expect(row.readingCheck).toBe("blind");
    /* …and invisible to the page, which keeps today's behaviour */
    const data = await statusOf(payment.id);
    expect(data.readingCheck).toBeNull();
    expect("disputedFields" in data).toBe(false);
  });

  it("scenario 7: a bank-name difference alone raises nothing", async () => {
    const { payment, now, db } = await seedCross();
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: {
        trackingKey: CROSS_ROW.trackingKey,
        amountCents: 51400,
        date: "2026-08-26",
        senderBank: "NU MEXICO",
        referenceNumber: null,
      },
    });

    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.readingCheck).toBe("agreed");
  });

  it("scenario 9: a manual-door payment (no image) never crosses", async () => {
    const { payment, now, db } = await seedCross({ proofKey: null });
    const captured = mockApiCep({ status: "pending", cep: undefined });

    await sweepDirectPayments(testEnv, now);
    const sent = captured.body as Record<string, unknown>;
    expect(sent.sender).toBeDefined();
    expect(sent.imageUrl).toBeUndefined();
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.readingCheck).toBeNull();
  });

  it("scenario 8: expiry keeps the agreement, so the page can pre-diagnose", async () => {
    const past = new Date(Date.now() - 13 * 60 * 60 * 1000);
    const { payment, now } = await seedCross({
      readingCheck: "agreed",
      validationAttempts: 7,
      createdAt: past,
    });
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });

    await sweepDirectPayments(testEnv, now);
    const data = await statusOf(payment.id);
    expect(data.status).toBe("expired");
    expect(data.readingCheck).toBe("agreed");
  });
});

/* provisional-release (US-D15) — the vote of confidence: per-transaction
   evidence buys a WispHub payment promise while Banxico confirms;
   history only revokes. */
function mockPromise() {
  const captured: { body?: Record<string, unknown> } = {};
  wh()
    .intercept({
      method: "POST",
      path: "/api/promesa-pago/",
      body: (raw) => {
        captured.body = JSON.parse(String(raw));
        return true;
      },
    })
    .reply(...json({ id_factura: 42, fecha_limite: "2026-01-01 00:00" }));
  return captured;
}

describe("US-D15: the provisional release", () => {
  it("scenario 1: a pending verdict at minute zero buys the promise with accion 1", async () => {
    await seedLinkedBusiness({ provisionalReleaseEnabled: true });
    /* one customer+invoices round for the submit, one for the release */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep({ status: "pending", cep: undefined });
    const promise = mockPromise();

    const res = await payTransfer();
    expect(res.status).toBe(201);

    expect(promise.body!.id_factura).toBe(42);
    expect(promise.body!.accion).toBe(1);
    expect(String(promise.body!.fecha_limite)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.status).toBe("validating");
    expect(row.provisionalReleaseAt).not.toBeNull();
    expect(row.releaseEvidence).toBe("pending");
    /* the seed customer is Suspendido: the reconnect face, never protect */
    expect(row.releaseKind).toBe("reconnect");
  });

  it("scenario 8: toggle off — byte-identical to today, no WispHub round", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.provisionalReleaseAt).toBeNull();
    expect(row.releaseEvidence).toBeNull();
  });

  it("D1: the manual door's not_found releases on human evidence", async () => {
    await seedLinkedBusiness({ provisionalReleaseEnabled: true });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    mockPromise();

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.status).toBe("validating");
    expect(row.lastError).toBe("TRANSFER_NOT_FOUND");
    expect(row.releaseEvidence).toBe("human");
    expect(row.provisionalReleaseAt).not.toBeNull();
  });

  it("scenario 9: a burned ride revokes the fast lane — the road stays open", async () => {
    const { link } = await seedLinkedBusiness({ provisionalReleaseEnabled: true });
    /* the prior released ride that expired and was never resolved */
    await drizzle(env.DB)
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: link.businessId,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        status: "expired",
        proofMode: "transfer",
        trackingKey: "OLDKEY001",
        provisionalReleaseAt: new Date(Date.now() - 10 * 24 * 3600 * 1000),
        releaseEvidence: "human",
      });

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    /* no mockPromise: a promise call would leave a pending interceptor */

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const rows = await drizzle(env.DB)
      .select()
      .from(payments)
      .where(eq(payments.trackingKey, "TRACK001XYZ"));
    expect(rows[0].status).toBe("validating");
    expect(rows[0].provisionalReleaseAt).toBeNull();
  });

  it("D2: a claim under the ISP's threshold buys nothing", async () => {
    await seedLinkedBusiness({ provisionalReleaseEnabled: true });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep({ status: "pending", cep: undefined });

    /* the manual door's editable amount: a $10 claim against a $499 debt */
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, amountCents: 1000 },
    });
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.provisionalReleaseAt).toBeNull();
  });

  it("D7/scenario 4: the retry that validates lifts the burned ride", async () => {
    const { link } = await seedLinkedBusiness();
    /* the released ride that expired — Banxico was just late */
    const [ride] = await drizzle(env.DB)
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: link.businessId,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        status: "expired",
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        provisionalReleaseAt: new Date(Date.now() - 7 * 3600 * 1000),
        releaseEvidence: "agreed",
        releaseKind: "reconnect",
      })
      .returning();

    /* D7: the expired page is offered exactly one retry for this clave */
    const st = await (await app()).request(`/direct-payments/${ride.id}/status`, {}, testEnv);
    expect((await st.json()).data.retryAvailable).toBe(true);

    /* the payer claims it next morning; the CEP has published by now */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep();
    mockReconnection("Activo");

    const res = await payTransfer();
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("confirmed");

    /* the vote of confidence was vindicated: the ride is no longer
       `expired`, so the D5 revocation lifts with it */
    const [old] = await drizzle(env.DB)
      .select()
      .from(payments)
      .where(eq(payments.id, ride.id));
    expect(old.status).toBe("superseded");
  });

  it("D6/scenario 7: another customer's clave is recorded at the edge and revokes", async () => {
    const { link, business } = await seedLinkedBusiness({ provisionalReleaseEnabled: true });
    /* a second customer on the same ISP whose payment owns the clave */
    const [otherLink] = await drizzle(env.DB)
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: "tok9999zzzzzzzz9",
        wisphubCustomerId: "9",
        customerUsuario: "arellano@wifiplus",
      })
      .returning();
    await drizzle(env.DB)
      .insert(payments)
      .values({
        paymentLinkId: otherLink.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        status: "validating",
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
      });

    /* the double-spend attempt dies at the index, and now leaves a row */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const rejected = await payTransfer();
    expect(rejected.status).toBe(409);

    const marks = await drizzle(env.DB).select().from(proofRejections);
    expect(marks).toHaveLength(1);
    expect(marks[0].paymentLinkId).toBe(link.id);
    expect(marks[0].trackingKey).toBe("TRACK001XYZ");

    /* the next attempt with a clean clave rides — but the fast lane is shut */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const res = await payTransfer("tok2345abcdefgh2", {
      transfer: { ...TRANSFER.transfer, trackingKey: "CLEANKEY99" },
    });
    expect(res.status).toBe(201);

    const rows = await drizzle(env.DB)
      .select()
      .from(payments)
      .where(eq(payments.trackingKey, "CLEANKEY99"));
    expect(rows[0].status).toBe("validating");
    expect(rows[0].provisionalReleaseAt).toBeNull();
  });
});

/* provisional-release D4 (US-D15) — the collection half. The two tests
   here — "customerRef is the HMAC of the usuario, paymentRef is the
   payment id" and "without the secret nothing travels and nothing
   blocks" — retired with the HMAC and its secret (consta-api-merge D5):
   the ref no longer crosses a network, so it is the link's own customer
   identity, sent on every call. What replaced them is proven in
   test/consta/attribution.test.ts (consta-api-merge US3). */

/* provisional-release D12 (US-D15) — the shadow only writes: the trust
   block as received lands next to every release evaluation, the release
   decision is byte-identical with and without it, and the graduation
   gate stays inert while K is null. */
describe("US-D15 D12: the shadow", () => {
  /* consta-api-merge D12: the block is no longer injected through a
     mock — the engine computes it from the log, so the log is seeded:
     three resolved chains of this payer, ten days old, under this
     business (D3). The engine's answer for that history is what the
     shadow must store. */
  const DAY = 24 * 3600 * 1000;
  async function seedPayerHistory(businessId: string, chains = 3) {
    await seedValidations(
      businessId,
      Array.from({ length: chains }, (_, i) => ({
        mode: "transfer" as const,
        status: "valid" as const,
        trackingKey: `HIST${String(i).padStart(6, "0")}`,
        customerRef: "greyes@wifiplus",
        paymentRef: `pay-hist-${i}`,
        createdAt: new Date(Date.now() - 10 * DAY),
      })),
    );
  }
  const expectComputedBlock = (snapshot: string | null, chains: number) => {
    const block = JSON.parse(snapshot!) as typeof TRUST_BLOCK;
    /* the link's own customer identity, undisguised (D5) */
    expect(block.customerRef).toBe("greyes@wifiplus");
    expect(block.sample.chains).toBe(chains);
    /* a rate over nothing is no measurement, never 0% (trust-layer D3) */
    expect(block.eventualValidRate).toBe(chains ? 1 : null);
    expect(block.raw.resolvedValid).toBe(chains);
    expect(block.tenantBaseline.chains).toBe(chains);
  };

  it("the snapshot lands with the release row, as received", async () => {
    const { business } = await seedLinkedBusiness({ provisionalReleaseEnabled: true });
    await seedPayerHistory(business.id);
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep({ status: "pending", cep: undefined });
    mockPromise();

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.provisionalReleaseAt).not.toBeNull();
    /* the block bought nothing: the evidence is the verdict's own */
    expect(row.releaseEvidence).toBe("pending");
    expectComputedBlock(row.trustSnapshot, 3);
  });

  it("with an empty history the decision is byte-identical and the shadow records the empty measurement", async () => {
    await seedLinkedBusiness({ provisionalReleaseEnabled: true });
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    /* Was "without a block … the shadow records null": the refs travel
       on every call now (consta-api-merge D5), so a `pending` always
       carries a block — for a stranger, one of zeros (trust-layer
       scenario 2). The decision must not move either way. */
    mockApiCep({ status: "pending", cep: undefined });
    mockPromise();

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(payments);
    /* same decision as with the block: released, on the same evidence */
    expect(row.provisionalReleaseAt).not.toBeNull();
    expect(row.releaseEvidence).toBe("pending");
    expectComputedBlock(row.trustSnapshot, 0);
  });

  it("toggle off: the evaluation still writes the shadow and decides nothing", async () => {
    const { business } = await seedLinkedBusiness();
    await seedPayerHistory(business.id);
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });

    const res = await payTransfer();
    expect(res.status).toBe(201);

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.provisionalReleaseAt).toBeNull();
    expect(row.releaseEvidence).toBeNull();
    expectComputedBlock(row.trustSnapshot, 3);
  });

  it("a released row keeps the snapshot that bought the decision", async () => {
    const { business, link } = await seedLinkedBusiness({ provisionalReleaseEnabled: true });
    const now = new Date();
    const db = drizzle(env.DB);
    /* the history as it looked at decision time — one chain fewer */
    const decisionTime = {
      ...TRUST_BLOCK,
      sample: { ...TRUST_BLOCK.sample, chains: 13, effectiveN: 10.4 },
    };
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        constaStatus: "pending",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt: new Date(now.getTime() - 2 * 60 * 1000),
        provisionalReleaseAt: new Date(now.getTime() - 60 * 1000),
        releaseEvidence: "pending",
        releaseKind: "reconnect",
        trustSnapshot: JSON.stringify(decisionTime),
      })
      .returning();

    /* the retry's block has moved on; the snapshot must not */
    await seedPayerHistory(business.id, 14);
    mockApiCep({ status: "pending", cep: undefined });
    await sweepDirectPayments(testEnv, now);

    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(JSON.parse(row.trustSnapshot!)).toEqual(decisionTime);
  });

  it("the graduation gate stays inert while K is null", () => {
    /* rich and clean — and still no privilege: K does not exist */
    expect(historyVouches(TRUST_BLOCK)).toBe(false);
    /* the day the shadow table writes K, the same record vouches… */
    expect(historyVouches(TRUST_BLOCK, 3)).toBe(true);
    /* …but an incident or a thin sample never does */
    expect(historyVouches({ ...TRUST_BLOCK, raw: { ...TRUST_BLOCK.raw, contradicted: 1 } }, 3)).toBe(false);
    expect(
      historyVouches({ ...TRUST_BLOCK, raw: { ...TRUST_BLOCK.raw, alreadyUsedAttempts: 1 } }, 3),
    ).toBe(false);
    expect(historyVouches({ ...TRUST_BLOCK, sample: { ...TRUST_BLOCK.sample, effectiveN: 2 } }, 3)).toBe(false);
    expect(historyVouches(undefined, 3)).toBe(false);
  });
});

/* TD-013 paid: the sweep obeys the engine's learned `retryAfter`
   (learned-retry D6, direct-payment D7 amendment). The suggestion rules
   the middle of the schedule; the early skeleton and the horizon never
   move. */
describe("D7 amended: the learned retryAfter governs the middle", () => {
  const min = (n: number) => n * 60 * 1000;

  /* consta-api-merge D12: the suggestion is no longer injected through
     a mock — the engine learns it from the log (learned-retry D2–D4),
     so the log is seeded the way test/consta/learned-retry.test.ts
     seeds it: thirty transfers of this pair that missed once and
     confirmed `minutes` later, plus the payment's own prior miss at
     its `createdAt` so the live anchor (D4 rule 2) is known exactly.
     Thirty at 22 min → p50 = 22, rounded up to the 25-minute step. */
  const LEARNED_MINUTES = 25;
  async function seedLearnedCell(businessId: string, ownKey: string, ownCreatedAt: Date, minutes = 22) {
    const anchor = Date.now() - 6 * 60 * 60 * 1000;
    const today = new Date().toISOString().slice(0, 10);
    const measured = Array.from({ length: 30 }, (_, i) => `LEARN${String(i).padStart(4, "0")}`).flatMap((key) => [
      { mode: "transfer" as const, status: "invalid" as const, reason: "not_found" as const, trackingKey: key, senderBank: "NUBANK", beneficiaryBank: "STP", createdAt: new Date(anchor) },
      { mode: "transfer" as const, status: "valid" as const, trackingKey: key, senderBank: "NUBANK", beneficiaryBank: "STP", createdAt: new Date(anchor + minutes * 60_000) },
    ]);
    await seedValidations(businessId, [
      ...measured,
      { mode: "transfer" as const, status: "invalid" as const, reason: "not_found" as const, trackingKey: ownKey, senderBank: "NUBANK", beneficiaryBank: "STP", amountCents: 51400, transferDate: today, createdAt: ownCreatedAt },
    ]);
  }

  it("US-D04: a suggestion skips the futile middle slots", () => {
    const createdAt = new Date(Date.now() - min(2));
    const suggestedAt = new Date(createdAt.getTime() + min(26));
    const slot = nextValidationSlot(createdAt, new Date(), { suggestedAt });
    expect(slot!.getTime()).toBe(suggestedAt.getTime());
  });

  it("US-D04: a suggestion may come EARLIER than the next static slot — the latency win", () => {
    const createdAt = new Date(Date.now() - min(46));
    /* next static would be +120; the evidence says +50 */
    const suggestedAt = new Date(createdAt.getTime() + min(50));
    const slot = nextValidationSlot(createdAt, new Date(), { suggestedAt });
    expect(slot!.getTime()).toBe(suggestedAt.getTime());
  });

  it("US-D04: before the +2 slot the ladder rules — the fast majority never waits on a percentile", () => {
    const createdAt = new Date();
    const suggestedAt = new Date(createdAt.getTime() + min(26));
    const slot = nextValidationSlot(createdAt, createdAt, { suggestedAt });
    expect(slot!.getTime()).toBe(createdAt.getTime() + min(2));
  });

  it("US-D04: a suggestion is clamped to the horizon — expiry is product law", () => {
    const createdAt = new Date(Date.now() - min(10));
    const suggestedAt = new Date(createdAt.getTime() + min(30 * 60));
    const slot = nextValidationSlot(createdAt, new Date(), { lateSlot: true, suggestedAt });
    expect(slot!.getTime()).toBe(createdAt.getTime() + min(720));
  });

  it("US-D04: a stale suggestion falls back to the static ladder", () => {
    const createdAt = new Date(Date.now() - min(46));
    const suggestedAt = new Date(createdAt.getTime() + min(10));
    const slot = nextValidationSlot(createdAt, new Date(), { suggestedAt });
    expect(slot!.getTime()).toBe(createdAt.getTime() + min(120));
  });

  it("US-D04: a malformed or absent suggestion simply does not exist", () => {
    expect(suggestedSlot("not-a-date")).toBeNull();
    expect(suggestedSlot(undefined)).toBeNull();
    expect(suggestedSlot("2026-08-28T12:00:00.000Z")!.toISOString()).toBe("2026-08-28T12:00:00.000Z");
  });

  it("US-D04: a not_found verdict with retryAfter books the suggested attempt through the sweep", async () => {
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const createdAt = new Date(now.getTime() - min(2));
    const suggested = new Date(createdAt.getTime() + min(LEARNED_MINUTES));
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        constaStatus: "pending",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt,
      })
      .returning();

    await seedLearnedCell(business.id, "TRACK001XYZ", createdAt);
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("validating");
    expect(row.lastError).toBe("TRANSFER_NOT_FOUND");
    /* +8 and +20 are skipped: the next attempt is exactly the suggestion */
    expect(row.nextValidationAt!.getTime()).toBe(suggested.getTime());
  });

  it("US-D04: a pending verdict carries the suggestion the same way", async () => {
    const { business, link } = await seedLinkedBusiness();
    const now = new Date();
    const createdAt = new Date(now.getTime() - min(2));
    const suggested = new Date(createdAt.getTime() + min(LEARNED_MINUTES));
    const db = drizzle(env.DB);
    const [payment] = await db
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        transferDate: new Date().toISOString().slice(0, 10),
        constaStatus: "pending",
        validationAttempts: 1,
        nextValidationAt: new Date(now.getTime() - 1000),
        createdAt,
      })
      .returning();

    await seedLearnedCell(business.id, "TRACK001XYZ", createdAt);
    mockApiCep({ status: "pending", cep: undefined });
    await sweepDirectPayments(testEnv, now);
    const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row.status).toBe("validating");
    expect(row.nextValidationAt!.getTime()).toBe(suggested.getTime());
  });
});

/* two-eyes-receipt US4 — the answer never waits on the paid call.

   The payer used to hold a spinner for the provider's 6–10 seconds, and
   up to its 25-second deadline, before the page could say anything at
   all — for an answer the page then polls for anyway. The attempt still
   runs first; it simply runs past the response now (D4).

   These exercise a *real* execution context from `cloudflare:test`, not
   a mocked handler: `waitUntil` is the mechanism, so a test that stubbed
   it would prove nothing (constitution IV). */
describe("two-eyes-receipt US4: the answer never waits", () => {
  it("scenario 1: the POST answers `validating` before the provider has said anything", async () => {
    await seedLinkedBusiness();
    /* pay pre-check + validation debt re-check + reconnection verify */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockReconnection("Activo");

    mockApiCep();

    const ctx = createExecutionContext();
    const db = drizzle(env.DB);
    const res = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/pay",
      post(TRANSFER),
      testEnv,
      ctx,
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    /* The whole point: an answer in the time of a D1 insert (SC-007).
       The provider *did* answer `valid` here — what this proves is that
       the response did not carry it, because the attempt had not been
       awaited when the response was built. */
    expect(data.status).toBe("validating");

    await waitOnExecutionContext(ctx);
    const [row] = await db.select().from(payments);
    expect(row.status).toBe("confirmed");
  });

  it("scenario 2: a caller with no execution context still finishes the attempt inline", async () => {
    await seedLinkedBusiness();
    /* pay pre-check + validation debt re-check + reconnection verify */
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockReconnection("Activo");
    mockApiCep();

    /* `executionCtx` throws outside a Worker request (Hono), so nothing
       is ever dropped: the handler awaits and answers with the verdict.
       Every other scenario in this suite rides this path, which is why
       they still read a terminal status off the POST. */
    const res = await payTransfer();
    expect((await res.json()).data.status).toBe("confirmed");
  });

  it("scenario 3: an attempt that dies past the response leaves the payment due at its own slot (R5)", async () => {
    await seedLinkedBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    /* The provider answers nothing at all — the deferred attempt fails
       after the payer already has their answer */
    apicep()
      .intercept({ method: "POST", path: "/validate-transfer" })
      .replyWithError(new Error("the isolate went away"));

    const ctx = createExecutionContext();
    const res = await (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/pay",
      post(TRANSFER),
      testEnv,
      ctx,
    );
    expect((await res.json()).data.status).toBe("validating");
    await waitOnExecutionContext(ctx);

    const db = drizzle(env.DB);
    let [row] = await db.select().from(payments);
    expect(row.status).toBe("validating");
    /* The counter was written BEFORE the call (the 2026-08-18 rule), so
       the retry is this payment's own attempt and the replay carve-out
       holds (FR-021) — and the slot is the ordinary +2 min. */
    expect(row.validationAttempts).toBe(1);
    expect(row.nextValidationAt!.getTime()).toBeGreaterThan(Date.now());

    /* And the sweep picks it up as a retry, exactly as it would an
       attempt that never started: the validation's debt re-check, then
       the reconnection's own verify of the customer */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    mockApiCep();
    await sweepDirectPayments(testEnv, new Date(row.nextValidationAt!.getTime() + 1000));
    [row] = await db.select().from(payments);
    expect(row.status).toBe("confirmed");
    expect(row.validationAttempts).toBe(2);
  });
});

/* ======================================================================
   receipt-triage (specs/010-receipt-triage): the reference as a key, the
   ask, the account a payment is checked against, and the review hold.
   ====================================================================== */

/* The spec's CLABE: receipt 1 shows 8195, receipt 2 shows 195 */
const RT_CLABE = "012180001234538195";
const RT_ACCOUNT = { kind: "clabe", value: RT_CLABE, bank: "STP" };
const TODAY = () => new Date().toISOString().slice(0, 10);

async function seedRtBusiness(overrides: Parameters<typeof seedBusiness>[0] = {}) {
  return seedLinkedBusiness({ speiClabe: RT_CLABE, ...overrides });
}

/* A row born since this feature: it carries its account and the accounts
   registered at submission (D25, D30) */
async function seedRtRow(
  link: { id: string },
  business: { id: string },
  over: Partial<typeof payments.$inferInsert> = {},
) {
  const [row] = await drizzle(env.DB)
    .insert(payments)
    .values({
      paymentLinkId: link.id,
      businessId: business.id,
      amountCents: 51400,
      invoiceCents: 49900,
      serviceFeeCents: 1500,
      proofMode: "transfer",
      claimedAmountCents: 51400,
      beneficiary: JSON.stringify(RT_ACCOUNT),
      registeredAccounts: JSON.stringify([RT_ACCOUNT]),
      nextValidationAt: new Date(Date.now() - 1000),
      ...over,
    })
    .returning();
  return row;
}

const rowById = async (id: string) =>
  (await drizzle(env.DB).select().from(payments).where(eq(payments.id, id)))[0];

const REF_TRANSFER = (over: Record<string, unknown> = {}) => ({
  transfer: { referenceNumber: "038195", senderBank: "NUBANK", date: TODAY(), amountCents: 51400, ...over },
});

describe("receipt-triage US1: the referencia numérica finds the transfer", () => {
  beforeEach(() => resetShapeRules());

  it("(a) a typed submission with only a reference is accepted, and the provider searches with it and no clave", async () => {
    await seedRtBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const captured = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });

    const res = await payTransfer("tok2345abcdefgh2", REF_TRANSFER());
    expect(res.status).toBe(201);
    const sender = captured.body!.sender as Record<string, unknown>;
    expect(sender.referenceNumber).toBe("038195");
    expect("trackingKey" in sender).toBe(false);
    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.referenceNumber).toBe("038195");
    expect(row.trackingKey).toBeNull();
    /* D25: typed data is checked against the cuenta de cobro, snapshotted */
    expect(JSON.parse(row.beneficiary!)).toEqual(RT_ACCOUNT);
  });

  it("(b) with both keys only the clave travels — first attempt and every retry after not_found (D1)", async () => {
    await seedRtBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const first = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await payTransfer("tok2345abcdefgh2", REF_TRANSFER({ trackingKey: "TRACK001XYZ" }));
    expect((first.body!.sender as Record<string, unknown>).trackingKey).toBe("TRACK001XYZ");
    expect("referenceNumber" in (first.body!.sender as Record<string, unknown>)).toBe(false);

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.referenceNumber).toBe("038195");
    const retry = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(testEnv, new Date(row.nextValidationAt!.getTime() + 1000));
    expect((retry.body!.sender as Record<string, unknown>).trackingKey).toBe("TRACK001XYZ");
    expect("referenceNumber" in (retry.body!.sender as Record<string, unknown>)).toBe(false);
  });

  it("(c) a disputed clave that fell back to the reference searches with it, asks nothing, and adopts Banxico's clave on valid (D13, D14)", async () => {
    const { business, link } = await seedRtBusiness();
    await testEnv.PROOFS.put(`${link.id}/p-c`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const row = await seedRtRow(link, business, { proofMode: "receipt", proofKey: `${link.id}/p-c` });
    const AI = aiReturning({
      esComprobante: true,
      claveDeRastreo: "AZTK12345678",
      referenciaNumerica: "038195",
      banco: "AZTECA",
      monto: 514,
      fecha: TODAY(),
      destino: { tipo: "clabe", digitos: "8195" },
    });
    const readerEnv = { ...testEnv, AI } as typeof testEnv;
    mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: { trackingKey: "AZTK12345679", referenceNumber: "038195", amountCents: 51400, senderBank: "AZTECA", date: TODAY() },
    });
    await sweepDirectPayments(readerEnv, new Date());
    const fell = await rowById(row.id);
    expect(fell.readingCheck).toBe("disputed");
    expect(fell.disputedFields).toBeNull();
    expect(fell.trackingKey).toBeNull();
    expect(fell.referenceNumber).toBe("038195");

    /* the next slot: the transfer door, the reference, no clave */
    const captured = mockApiCep({ cep: { ...DEFAULT_CEP, trackingKey: "AZTECA0909BANXICO1" } });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    await sweepDirectPayments(readerEnv, new Date(fell.nextValidationAt!.getTime() + 1000));
    const sender = captured.body!.sender as Record<string, unknown>;
    expect(sender.referenceNumber).toBe("038195");
    expect("trackingKey" in sender).toBe(false);
    const done = await rowById(row.id);
    expect(done.status).toBe("confirmed");
    expect(done.trackingKey).toBe("AZTECA0909BANXICO1");
  });

  it("(c) …and when that search finds nothing, the payer is asked for either key while the slots keep searching with the reference", async () => {
    const { business, link } = await seedRtBusiness();
    const row = await seedRtRow(link, business, {
      proofMode: "receipt",
      proofKey: `${link.id}/p-c2`,
      referenceNumber: "038195",
      senderBank: "AZTECA",
      transferDate: TODAY(),
      readingCheck: "disputed",
      acceptedFrom: "agreed",
    });
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(testEnv, new Date());
    const asked = await rowById(row.id);
    expect(JSON.parse(asked.disputedFields!)).toEqual(["trackingKey", "referenceNumber"]);
    expect(asked.status).toBe("validating");

    const again = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(testEnv, new Date(asked.nextValidationAt!.getTime() + 1000));
    expect((again.body!.sender as Record<string, unknown>).referenceNumber).toBe("038195");
  });

  it("(d) receipt 2: the provider agrees on 038195, and the next slot takes the transfer door with it (SC-002)", async () => {
    const { business, link } = await seedRtBusiness();
    await testEnv.PROOFS.put(`${link.id}/p-d`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const row = await seedRtRow(link, business, { proofMode: "receipt", proofKey: `${link.id}/p-d`, claimedAmountCents: null });
    const readerEnv = { ...testEnv, AI: aiReturning(RECEIPT_2_READING) } as typeof testEnv;
    const first = mockApiCep({
      status: "invalid",
      reason: "not_found",
      cep: undefined,
      reading: { trackingKey: null, referenceNumber: "038195", amountCents: 35000, senderBank: "AZTECA", date: "2026-09-09" },
    });
    await sweepDirectPayments(readerEnv, new Date());
    expect(String(first.body!.imageUrl)).toContain("p-d");
    const agreed = await rowById(row.id);
    expect(agreed.readingCheck).toBe("agreed");
    expect(agreed.referenceNumber).toBe("038195");

    const second = mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    await sweepDirectPayments(readerEnv, new Date(agreed.nextValidationAt!.getTime() + 1000));
    expect((second.body!.sender as Record<string, unknown>).referenceNumber).toBe("038195");
    expect(second.body!.imageUrl).toBeUndefined();
  });

  it("(e) a transfer confirmed by reference carries Banxico's clave, and a second payment whose search returns it is already used (D14, FR-006)", async () => {
    await seedRtBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockReconnection("Activo");
    mockApiCep({ cep: { ...DEFAULT_CEP, trackingKey: "BANXICOCLAVE001" } });
    await payTransfer("tok2345abcdefgh2", REF_TRANSFER());
    const [first] = await drizzle(env.DB).select().from(payments);
    expect(first.status).toBe("confirmed");
    expect(first.trackingKey).toBe("BANXICOCLAVE001");

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ cep: { ...DEFAULT_CEP, trackingKey: "BANXICOCLAVE001" } });
    const res = await payTransfer("tok2345abcdefgh2", REF_TRANSFER({ referenceNumber: "038196" }));
    const second = await rowById((await res.json()).data.directPaymentId);
    expect(second.status).toBe("invalid");
    expect(second.lastError).toBe("TRANSFER_ALREADY_USED");
  });

  it("(f) the provider's 422 asks for the clave, and no later slot pays for the same refusal (D17, SC-005)", async () => {
    await seedRtBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    apicep()
      .intercept({ method: "POST", path: "/validate-transfer" })
      .reply(422, JSON.stringify({ error: "Referencia duplicada en Banxico (requiere clave de rastreo)" }), {
        headers: { "Content-Type": "application/json" },
      });
    const res = await payTransfer("tok2345abcdefgh2", REF_TRANSFER());
    const { data } = await res.json();
    expect(data.error).toBe("REFERENCE_AMBIGUOUS");
    const row = await rowById(data.directPaymentId);
    expect(JSON.parse(row.disputedFields!)).toEqual(["trackingKey"]);
    expect(row.lastError).toBe("REFERENCE_AMBIGUOUS");

    /* no interceptor: a provider call here would fail the test */
    await sweepDirectPayments(testEnv, new Date(row.nextValidationAt!.getTime() + 1000));
    const still = await rowById(row.id);
    expect(still.status).toBe("validating");
    expect(still.validationAttempts).toBe(row.validationAttempts);

    /* the payer's clave supersedes it */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const fix = await payTransfer("tok2345abcdefgh2", {
      ...REF_TRANSFER({ trackingKey: "TRACK001XYZ" }),
      supersedes: row.id,
    });
    expect(fix.status).toBe(201);
    expect((await rowById(row.id)).status).toBe("superseded");
  });

  it("(g) a generic reference with no clave is refused by the contract", async () => {
    await seedRtBusiness();
    const res = await payTransfer("tok2345abcdefgh2", REF_TRANSFER({ referenceNumber: "1234567" }));
    expect(res.status).toBe(400);
    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(0);
  });

  it("(h) another link's payment with the same five data: the typed reference is refused REFERENCE_SHARED, nothing created (D7)", async () => {
    const { business, link } = await seedRtBusiness();
    const [other] = await drizzle(env.DB)
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tokother00000001", wisphubCustomerId: "7", customerUsuario: "otro@wifiplus" })
      .returning();
    await seedRtRow(other, business, {
      referenceNumber: "038195",
      senderBank: "NUBANK",
      transferDate: TODAY(),
      nextValidationAt: null,
      status: "confirmed",
    });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const res = await payTransfer("tok2345abcdefgh2", REF_TRANSFER());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("REFERENCE_SHARED");
    const mine = (await drizzle(env.DB).select().from(payments)).filter((p) => p.paymentLinkId === link.id);
    expect(mine).toHaveLength(0);
  });

  it("(h) the same link's own earlier row never matches", async () => {
    const { business, link } = await seedRtBusiness();
    await seedRtRow(link, business, {
      referenceNumber: "038195",
      senderBank: "NUBANK",
      transferDate: TODAY(),
      nextValidationAt: null,
      status: "expired",
    });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    expect((await payTransfer("tok2345abcdefgh2", REF_TRANSFER())).status).toBe(201);
  });

  it("(h) a row whose accepted reference is shared makes no provider call, and asks for the clave", async () => {
    const { business, link } = await seedRtBusiness();
    const [other] = await drizzle(env.DB)
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tokother00000002", wisphubCustomerId: "7", customerUsuario: "otro@wifiplus" })
      .returning();
    const shared = { referenceNumber: "038195", senderBank: "AZTECA", transferDate: TODAY() };
    await seedRtRow(other, business, { ...shared, nextValidationAt: null, status: "confirmed" });
    const row = await seedRtRow(link, business, { ...shared, proofMode: "receipt", proofKey: `${link.id}/p-h`, acceptedFrom: "agreed" });
    await sweepDirectPayments(testEnv, new Date());
    const after = await rowById(row.id);
    expect(after.lastError).toBe("REFERENCE_SHARED");
    expect(JSON.parse(after.disputedFields!)).toEqual(["trackingKey"]);
    expect(after.validationAttempts).toBe(0);
  });
});

describe("receipt-triage US1: a confirmation whose CEP carries no clave (FR-006 guard)", () => {
  const noClave = { ...DEFAULT_CEP, trackingKey: null };

  it("never validated before and no confirmed twin: confirms with the clave empty", async () => {
    await seedRtBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockReconnection("Activo");
    mockApiCep({ cep: noClave, previouslyValidated: false });
    const { data } = await (await payTransfer("tok2345abcdefgh2", REF_TRANSFER())).json();
    const row = await rowById(data.directPaymentId);
    expect(row.status).toBe("confirmed");
    expect(row.trackingKey).toBeNull();
  });

  it("the provider says it was validated before: already used", async () => {
    await seedRtBusiness();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ cep: noClave, previouslyValidated: true });
    const { data } = await (await payTransfer("tok2345abcdefgh2", REF_TRANSFER())).json();
    expect(await rowById(data.directPaymentId)).toMatchObject({ status: "invalid", lastError: "TRANSFER_ALREADY_USED" });
  });

  it("a confirmed twin with the same five data — on this same link — is already used", async () => {
    const { business, link } = await seedRtBusiness();
    await seedRtRow(link, business, {
      referenceNumber: "038195",
      senderBank: "NUBANK",
      transferDate: DEFAULT_CEP.date,
      nextValidationAt: null,
      status: "confirmed",
    });
    const row = await seedRtRow(link, business, {
      referenceNumber: "038195",
      senderBank: "NUBANK",
      transferDate: DEFAULT_CEP.date,
    });
    mockApiCep({ cep: noClave, previouslyValidated: false });
    await sweepDirectPayments(testEnv, new Date());
    expect(await rowById(row.id)).toMatchObject({ status: "invalid", lastError: "TRANSFER_ALREADY_USED" });
  });

  it("the provider cannot say: held for the business, never queued (D31)", async () => {
    await seedRtBusiness();
    mockCustomerLookup([wisphubCustomer()], 2);
    mockPendingInvoices(undefined, 2);
    mockApiCep({ cep: noClave, previouslyValidated: null });
    const { data } = await (await payTransfer("tok2345abcdefgh2", REF_TRANSFER())).json();
    const row = await rowById(data.directPaymentId);
    expect(row).toMatchObject({ status: "confirmed", actionOutcome: "review", reviewReason: "no_clave" });
    expect(row.nextAttemptAt).toBeNull();

    /* receipt-triage US3 (T013): the queue never takes it, and the payer reads "en revisión" */
    const report = await sweepReconnections(testEnv, new Date(Date.now() + 3600_000));
    expect(report.claimed).toBe(0);
    const status = await (await (await app()).request(`/direct-payments/${row.id}/status`, {}, testEnv)).json();
    expect(status.data.inReview).toBe(true);
  });
});

describe("receipt-triage US2: a payment that skipped the page meets the same ask", () => {
  it("receipt 1 on the receipt door rides RECEIPT_INCOMPLETE with nothing billed", async () => {
    const { business, link } = await seedRtBusiness();
    await testEnv.PROOFS.put(`${link.id}/p-r1`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const row = await seedRtRow(link, business, { proofMode: "receipt", proofKey: `${link.id}/p-r1` });
    await sweepDirectPayments({ ...testEnv, AI: aiReturning(RECEIPT_1_READING) } as typeof testEnv, new Date());
    const after = await rowById(row.id);
    expect(after.lastError).toBe("RECEIPT_INCOMPLETE");
    expect(after.status).toBe("validating");
    expect(after.constaValidationId).toBeNull();
  });
});

describe("receipt-triage US3: the account a payment is checked against", () => {
  const CARD = "4111111111111111";
  const RETIRED = "4000000000004321";
  const withKey = (destino: Record<string, unknown>) => ({
    ...RECEIPT_1_READING,
    claveDeRastreo: "BNET01002609090012345678",
    destino,
  });

  it("a receipt to the registered card names the card, and the row remembers it (D22, D30)", async () => {
    const { business, link } = await seedRtBusiness({ speiCard: CARD, speiCardBank: "NUBANK" });
    await testEnv.PROOFS.put(`${link.id}/p-card`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const card = { kind: "card", value: CARD, bank: "NUBANK" };
    const row = await seedRtRow(link, business, {
      proofMode: "receipt",
      proofKey: `${link.id}/p-card`,
      registeredAccounts: JSON.stringify([RT_ACCOUNT, card]),
    });
    const captured = mockApiCep({ status: "pending", cep: undefined });
    await sweepDirectPayments({ ...testEnv, AI: aiReturning(withKey({ tipo: "tarjeta", digitos: "1111" })) } as typeof testEnv, new Date());
    expect(captured.body!.beneficiary).toMatchObject({ bank: "NUBANK", cardNumber: CARD });
    expect(JSON.parse((await rowById(row.id)).beneficiary!)).toEqual(card);
  });

  it("a receipt to a retired card is checked there, and Banxico's confirmation is held for the business (FR-020a)", async () => {
    const { business, link } = await seedRtBusiness();
    await testEnv.PROOFS.put(`${link.id}/p-ret`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const row = await seedRtRow(link, business, {
      proofMode: "receipt",
      proofKey: `${link.id}/p-ret`,
      registeredAccounts: JSON.stringify([RT_ACCOUNT, { kind: "card", value: RETIRED, bank: "NUBANK", retired: true }]),
    });
    const captured = mockApiCep();
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    await sweepDirectPayments({ ...testEnv, AI: aiReturning(withKey({ tipo: "tarjeta", digitos: "4321" })) } as typeof testEnv, new Date());
    expect(captured.body!.beneficiary).toMatchObject({ cardNumber: RETIRED });
    expect((captured.body!.beneficiary as Record<string, unknown>).retired).toBeUndefined();
    expect(await rowById(row.id)).toMatchObject({ status: "confirmed", actionOutcome: "review", reviewReason: "retired_account" });
  });

  it("Banxico's own account outranks the receipt's digits; a whole account that fits none is contradicted (D22)", async () => {
    const { business, link } = await seedRtBusiness();
    const row = await seedRtRow(link, business, { trackingKey: "TRACK001XYZ", senderBank: "NUBANK", transferDate: TODAY() });
    mockApiCep({ cep: { ...DEFAULT_CEP, beneficiaryAccount: "999999999999999999" } });
    await sweepDirectPayments(testEnv, new Date());
    expect(await rowById(row.id)).toMatchObject({ status: "invalid", lastError: "TRANSFER_CONTRADICTED" });
  });

  it("the snapshot outlives an edit in Cuenta: a later attempt still names the account it was submitted under (FR-021)", async () => {
    const { business, link } = await seedRtBusiness();
    const row = await seedRtRow(link, business, { trackingKey: "TRACK001XYZ", senderBank: "NUBANK", transferDate: TODAY() });
    await drizzle(env.DB)
      .update((await import("../src/db/schema")).businesses)
      .set({ speiClabe: "646180157000000004" })
      .where(eq((await import("../src/db/schema")).businesses.id, business.id));
    const captured = mockApiCep({ status: "pending", cep: undefined });
    await sweepDirectPayments(testEnv, new Date());
    expect((captured.body!.beneficiary as Record<string, unknown>).clabe).toBe(RT_CLABE);
    expect((await rowById(row.id)).status).toBe("validating");
  });

  it("a payment born before this feature keeps today's flow: no ask, no tie, one provider call (FR-027, D27)", async () => {
    const { business, link } = await seedRtBusiness();
    await testEnv.PROOFS.put(`${link.id}/p-old`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const row = await seedRtRow(link, business, {
      proofMode: "receipt",
      proofKey: `${link.id}/p-old`,
      beneficiary: null,
      registeredAccounts: null,
    });
    const captured = mockApiCep({ status: "pending", cep: undefined });
    await sweepDirectPayments(
      { ...testEnv, AI: aiReturning({ ...RECEIPT_1_READING, destino: { tipo: "clabe", digitos: "9999" } }) } as typeof testEnv,
      new Date(),
    );
    expect(String(captured.body!.imageUrl)).toContain("p-old");
    expect((await rowById(row.id)).lastError).toBeNull();
  });

  it("an ISP whose cuenta de cobro is a card is paid there; the link shows only it", async () => {
    await seedLinkedBusiness({ speiClabe: null, speiBank: null, speiCard: CARD, speiCardBank: "NUBANK", speiCollectKind: "card" });
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    const res = await (await app()).request("/direct-payments/links/tok2345abcdefgh2", {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    expect(data.collectAccount).toEqual({ kind: "card", value: CARD, bank: "NUBANK" });
    expect(data.speiClabe).toBeUndefined();
  });
});

describe("receipt-triage US2/US3: what /read reports to the page (D15, D7, D8)", () => {
  const readAs = async (proofId: string, reading: Record<string, unknown>) =>
    (await app()).request(
      "/direct-payments/links/tok2345abcdefgh2/read",
      post({ proofId }),
      { ...testEnv, AI: aiReturning(reading) },
    );

  it("receipt 1: the ask, the gate's reference verdict and that the destination was seen — never its digits", async () => {
    const { link } = await seedRtBusiness();
    await testEnv.PROOFS.put(`${link.id}/r1`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const { data } = await (await readAs(`${link.id}/r1`, RECEIPT_1_READING)).json();
    expect(data.ask).toEqual({ reason: "no_key", fields: ["key"] });
    expect(data.gate.referenceNumber).toBe("missing");
    expect(data.destinationSeen).toBe(true);
    expect(JSON.stringify(data)).not.toContain("8195");
    expect(data).not.toHaveProperty("tiedAccount");
  });

  it("a receipt to another account is reported as wrong_destination", async () => {
    const { link } = await seedRtBusiness();
    await testEnv.PROOFS.put(`${link.id}/r9`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const { data } = await (
      await readAs(`${link.id}/r9`, { ...RECEIPT_1_READING, claveDeRastreo: "BNET01002609090012345678", destino: { tipo: "clabe", digitos: "9999" } })
    ).json();
    expect(data.ask).toEqual({ reason: "wrong_destination" });
  });

  it("a reading whose only key another link's payment already holds that day is asked about as shared (D7)", async () => {
    const { business, link } = await seedRtBusiness();
    const [other] = await drizzle(env.DB)
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tokother00000003", wisphubCustomerId: "7", customerUsuario: "otro@wifiplus" })
      .returning();
    await seedRtRow(other, business, {
      referenceNumber: "038195",
      senderBank: "AZTECA",
      transferDate: "2026-09-09",
      claimedAmountCents: 35000,
      nextValidationAt: null,
      status: "confirmed",
    });
    await testEnv.PROOFS.put(`${link.id}/r2`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const { data } = await (await readAs(`${link.id}/r2`, RECEIPT_2_READING)).json();
    expect(data.referenceNumber).toBe("038195");
    expect(data.ask).toEqual({ reason: "no_key", fields: ["key"], shared: true });
    /* converge T060 (FR-028): counted as the ask it is */
    const [reading] = await drizzle(env.DB).select().from(extractions);
    expect(reading.outcome).toBe("key_missing");
  });

  it("Banxico's own account, tied to the snapshot, becomes the account the payment was checked against (D22)", async () => {
    const CARD = "4111111111111111";
    const { business, link } = await seedRtBusiness({ speiCard: CARD, speiCardBank: "NUBANK" });
    const card = { kind: "card", value: CARD, bank: "NUBANK" };
    const row = await seedRtRow(link, business, {
      trackingKey: "TRACK001XYZ",
      senderBank: "NUBANK",
      transferDate: TODAY(),
      registeredAccounts: JSON.stringify([RT_ACCOUNT, card]),
    });
    mockApiCep({ cep: { ...DEFAULT_CEP, beneficiaryAccount: CARD } });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockReconnection("Activo");
    await sweepDirectPayments(testEnv, new Date());
    const after = await rowById(row.id);
    expect(after.status).toBe("confirmed");
    expect(JSON.parse(after.beneficiary!)).toEqual(card);
  });
});

/* receipt-triage US3 (FR-020a, US3/AC7, plan D31; converge T058): money
   paid to an account the business removed waits for the business's own
   decision, so a provisional release — a WispHub promise that reconnects
   the customer — must not fire for it on any evidence. */
describe("receipt-triage US3: no provisional release for a payment to a removed account", () => {
  const RETIRED = { kind: "card", value: "4000000000004321", bank: "NUBANK", retired: true };
  const typedRow = (link: { id: string }, business: { id: string }, account: Record<string, unknown>) =>
    seedRtRow(link, business, {
      trackingKey: "TRACK001XYZ",
      /* not the card's own bank: a same-institution transfer is never
         SPEI, and the engine's guard refuses it before any credit */
      senderBank: "AZTECA",
      transferDate: TODAY(),
      beneficiary: JSON.stringify(account),
      registeredAccounts: JSON.stringify([RT_ACCOUNT, RETIRED]),
    });

  it("control: the same pending verdict on a current account buys the promise", async () => {
    const { business, link } = await seedRtBusiness({ provisionalReleaseEnabled: true });
    const row = await typedRow(link, business, RT_ACCOUNT);
    mockApiCep({ status: "pending", cep: undefined });
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockPromise();
    await sweepDirectPayments(testEnv, new Date());
    expect((await rowById(row.id)).releaseEvidence).toBe("pending");
  });

  it("a pending verdict on a retired account asks WispHub nothing and releases nothing", async () => {
    const { business, link } = await seedRtBusiness({ provisionalReleaseEnabled: true });
    const row = await typedRow(link, business, RETIRED);
    mockApiCep({ status: "pending", cep: undefined });
    /* Watched at the edge: without the gate the release would try WispHub
       and fail quietly inside its own try, so an unmocked call is not
       proof enough */
    const seen: string[] = [];
    const original = globalThis.fetch.bind(globalThis);
    const restore = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input instanceof Request ? input.url : input));
      return original(input, init);
    }) as typeof fetch;
    try {
      await sweepDirectPayments(testEnv, new Date());
    } finally {
      globalThis.fetch = restore;
    }
    expect(seen.filter((u) => u.includes("wisphub"))).toEqual([]);
    const after = await rowById(row.id);
    expect(after.releaseEvidence).toBeNull();
    expect(after.provisionalReleaseAt).toBeNull();
  });
});

/* receipt-triage US1 (FR-007, D7; converge T060): the shared-reference stop
   holds on the receipt door itself, for a client that never asked /read */
describe("receipt-triage US1: a shared reference on the receipt door costs nothing", () => {
  it("receipt 2, submitted as a file with no /read, whose reference another link's payment holds: no provider call, the clave is asked", async () => {
    const { business, link } = await seedRtBusiness();
    const [other] = await drizzle(env.DB)
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tokother00000004", wisphubCustomerId: "7", customerUsuario: "otro@wifiplus" })
      .returning();
    await seedRtRow(other, business, {
      referenceNumber: "038195",
      senderBank: "AZTECA",
      transferDate: "2026-09-09",
      claimedAmountCents: 35000,
      nextValidationAt: null,
      status: "confirmed",
    });
    await testEnv.PROOFS.put(`${link.id}/p-shared`, PNG(), { httpMetadata: { contentType: "image/png" } });
    const row = await seedRtRow(link, business, { proofMode: "receipt", proofKey: `${link.id}/p-shared`, claimedAmountCents: null });
    const readerEnv = { ...testEnv, AI: aiReturning(RECEIPT_2_READING) } as typeof testEnv;

    /* no apiCEP interceptor: a provider call would fail the test */
    await sweepDirectPayments(readerEnv, new Date());
    const asked = await rowById(row.id);
    expect(asked.status).toBe("validating");
    expect(asked.lastError).toBe("REFERENCE_SHARED");
    expect(JSON.parse(asked.disputedFields!)).toEqual(["trackingKey"]);
    expect(asked.constaValidationId).toBeNull();
    const [reading] = await drizzle(env.DB).select().from(extractions);
    expect(reading.outcome).toBe("key_missing");
    expect(reading.validationId).toBeNull();

    /* and the next slot makes no call either, until the payer's clave */
    await sweepDirectPayments(readerEnv, new Date(asked.nextValidationAt!.getTime() + 1000));
    expect((await rowById(row.id)).lastError).toBe("REFERENCE_SHARED");
  });
});

/* bug: one-open-attempt — a payer who comes back to the link corrects
   the attempt still in review instead of starting a second one beside it,
   and a submission identical to an attempt the link already holds is
   answered from it with nothing spent. Found live on dev, 2026-09-25: a
   typed reference Banxico could not find kept polling the provider for
   twelve hours after the same customer's receipt had paid. */
describe("bug: one-open-attempt", () => {
  const TOKEN = "tok2345abcdefgh2";
  const getLink = async () =>
    (await (await app()).request(`/direct-payments/links/${TOKEN}`, {}, testEnv)).json();

  /* A typed reference Banxico cannot find: the row stays `validating`
     with a slot, exactly like Abraham's first attempt */
  async function notFoundByReference() {
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "invalid", reason: "not_found", cep: undefined });
    const res = await payTransfer(TOKEN, {
      transfer: { referenceNumber: "9784417", senderBank: "AZTECA", date: "2026-09-24" },
    });
    expect(res.status).toBe(201);
    return (await res.json()).data.directPaymentId as string;
  }

  /* A proof of this link whose reading recorded its fingerprint, the way
     the engine's own reading does */
  async function readProof(businessId: string, linkId: string, name: string, bytes: Uint8Array) {
    const key = `${linkId}/${name}`;
    await testEnv.PROOFS.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
    await drizzle(env.DB).insert(extractions).values({
      businessId,
      source: "reader",
      outcome: "passed",
      proofKey: key,
      proofSha256: await sha256Hex(bytes),
    });
    return key;
  }

  async function seedAttempt(
    business: { id: string },
    link: { id: string },
    values: Partial<typeof payments.$inferInsert>,
  ) {
    const [row] = await drizzle(env.DB)
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "receipt",
        status: "validating",
        nextValidationAt: new Date(Date.now() + 60_000),
        ...values,
      })
      .returning();
    return row;
  }

  it("the link tells the page which attempt is in review, and only while one is", async () => {
    await seedLinkedBusiness();
    const first = await notFoundByReference();

    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    const { data } = await getLink();
    expect(data.inReview).toEqual({ directPaymentId: first, status: "validating" });

    await drizzle(env.DB).update(payments).set({ status: "expired", nextValidationAt: null });
    /* the invoices come from the page's 30-second display cache */
    mockCustomerLookup([wisphubCustomer()]);
    expect((await getLink()).data.inReview).toBeUndefined();
  });

  it("a new submission without `supersedes` corrects the attempt in review, which stops polling", async () => {
    await seedLinkedBusiness();
    const db = drizzle(env.DB);
    const first = await notFoundByReference();

    /* The receipt with the clave, from a page that no longer remembered
       the first attempt: no `supersedes` in the body */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const res = await payTransfer(TOKEN, {
      transfer: { trackingKey: "260925071144393084I", senderBank: "AZTECA", date: "2026-09-25" },
    });
    expect(res.status).toBe(201);
    const second = (await res.json()).data.directPaymentId as string;

    const old = (await db.select().from(payments).where(eq(payments.id, first)))[0];
    expect(old.status).toBe("superseded");
    expect(old.nextValidationAt).toBeNull();
    const fresh = (await db.select().from(payments).where(eq(payments.id, second)))[0];
    expect(fresh.supersedesId).toBe(first);

    /* Hours later, the sweep never asks the provider about it again (no
       interceptor: a call would fail the test) */
    await db.update(payments).set({ nextValidationAt: null }).where(eq(payments.id, second));
    const report = await sweepDirectPayments(testEnv, new Date(Date.now() + 13 * 3600 * 1000));
    expect(report.claimed).toBe(0);
  });

  it("the same file uploaded again while its attempt is in review answers with that attempt, spending nothing", async () => {
    const { business, link } = await seedLinkedBusiness();
    const bytes = PNG();
    const k1 = await readProof(business.id, link.id, "proof-1", bytes);
    const first = await seedAttempt(business, link, { proofKey: k1 });
    /* The re-upload lands under a new key and was never read: its
       fingerprint comes from the bytes themselves */
    const k2 = `${link.id}/proof-2`;
    await testEnv.PROOFS.put(k2, bytes, { httpMetadata: { contentType: "image/png" } });

    /* No WispHub and no provider interceptor on purpose */
    const res = await payTransfer(TOKEN, { proofId: k2 });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.directPaymentId).toBe(first.id);
    expect(data.status).toBe("validating");
    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(1);
  });

  it("the same file as a payment already confirmed on the link is refused as used, with no provider call", async () => {
    const { business, link } = await seedLinkedBusiness();
    const bytes = PNG();
    const k1 = await readProof(business.id, link.id, "proof-1", bytes);
    await seedAttempt(business, link, {
      proofKey: k1,
      trackingKey: "260925071144393084I",
      status: "confirmed",
      nextValidationAt: null,
    });
    const k2 = await readProof(business.id, link.id, "proof-2", bytes);

    /* The link is reusable: showing last month's receipt back as
       "confirmado" would read as this month paid (D9) */
    const res = await payTransfer(TOKEN, { proofId: k2 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("TRANSFER_ALREADY_USED");
    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(1);
    const [rejection] = await drizzle(env.DB).select().from(proofRejections);
    expect(rejection.trackingKey).toBe("260925071144393084I");
  });

  it("the same reference, date, bank and amount typed again answers with the attempt in review", async () => {
    await seedLinkedBusiness();
    const first = await notFoundByReference();

    const res = await payTransfer(TOKEN, {
      transfer: { referenceNumber: "9784417", senderBank: "AZTECA", date: "2026-09-24" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.directPaymentId).toBe(first);
    expect(await drizzle(env.DB).select().from(payments)).toHaveLength(1);
  });

  it("the same reference as a payment already paid is not refused: a reference is never unique", async () => {
    const { business, link } = await seedLinkedBusiness();
    await seedAttempt(business, link, {
      proofMode: "transfer",
      referenceNumber: "9784417",
      trackingKey: "260925071144378233I",
      senderBank: "AZTECA",
      transferDate: "2026-09-24",
      claimedAmountCents: 51400,
      status: "confirmed",
      nextValidationAt: null,
    });

    /* a second real transfer with the same printed reference goes to
       Banxico, which is the only one who can tell them apart */
    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const res = await payTransfer(TOKEN, {
      transfer: { referenceNumber: "9784417", senderBank: "AZTECA", date: "2026-09-24" },
    });
    expect(res.status).toBe(201);
  });

  it("the same reference with another date is a correction, not the same attempt", async () => {
    await seedLinkedBusiness();
    const first = await notFoundByReference();

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    mockApiCep({ status: "pending", cep: undefined });
    const res = await payTransfer(TOKEN, {
      transfer: { referenceNumber: "9784417", senderBank: "AZTECA", date: "2026-09-25" },
    });
    expect(res.status).toBe(201);
    const [old] = await drizzle(env.DB).select().from(payments).where(eq(payments.id, first));
    expect(old.status).toBe("superseded");
  });

  it("a refused correction gives the attempt in review back, with its slot", async () => {
    const { business, link } = await seedLinkedBusiness();
    const db = drizzle(env.DB);
    const [other] = await db
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: "tok9876zyxwvut99",
        wisphubCustomerId: "7",
        customerUsuario: "otro@wifiplus",
      })
      .returning();
    /* Another customer's payment already owns this clave */
    await seedAttempt(business, other, {
      proofMode: "transfer",
      trackingKey: "OTHER0001CLAVE",
      senderBank: "NUBANK",
      transferDate: "2026-09-25",
      status: "confirmed",
      nextValidationAt: null,
    });
    const first = await notFoundByReference();
    const [before] = await db.select().from(payments).where(eq(payments.id, first));

    mockCustomerLookup([wisphubCustomer()], 1);
    mockPendingInvoices(undefined, 1);
    const res = await payTransfer(TOKEN, {
      transfer: { trackingKey: "OTHER0001CLAVE", senderBank: "NUBANK", date: "2026-09-25" },
    });
    expect(res.status).toBe(409);
    const [after] = await db.select().from(payments).where(eq(payments.id, first));
    expect(after.status).toBe("validating");
    expect(after.nextValidationAt?.getTime()).toBe(before.nextValidationAt?.getTime());
    expect(link.id).toBe(after.paymentLinkId);
  });

  it("an attempt replaced after it was read is not sent to the provider", async () => {
    const { business, link } = await seedLinkedBusiness();
    const db = drizzle(env.DB);
    const stale = await seedAttempt(business, link, {
      proofMode: "transfer",
      trackingKey: "TRACK001XYZ",
      senderBank: "NUBANK",
      transferDate: "2026-08-17",
    });
    /* The payer corrected it after the sweep (or the inline attempt) had
       read it as `validating` */
    await db.update(payments).set({ status: "superseded", nextValidationAt: null }).where(eq(payments.id, stale.id));

    const [isp] = await db.select().from(businesses).where(eq(businesses.id, business.id));
    /* No provider interceptor: a call would fail the test */
    const row = await runValidation(testEnv, db, stale, link, isp, await integrationOf(db, business.id), new Date());
    expect(row.status).toBe("superseded");
    expect(row.validationAttempts).toBe(0);
    expect(row.nextValidationAt).toBeNull();
  });

  it("an API link keeps its transfers side by side: no attempt in review is named on its page", async () => {
    const { business } = await seedLinkedBusiness();
    const db = drizzle(env.DB);
    const [apiLink] = await db
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: "tokapi000000001",
        source: "api",
        customerRef: "ref-1",
        askCents: 50000,
      })
      .returning();
    await seedAttempt(business, apiLink, {});
    const res = await (await app()).request(`/direct-payments/links/${apiLink.token}`, {}, testEnv);
    const { data } = await res.json();
    expect(data.status).toBe("debt");
    expect(data.inReview).toBeUndefined();
  });
});
