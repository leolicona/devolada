import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, paymentLinks, payments } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { app, seedBusiness, seedConfirmedPayment, seedMember, sessionCookieHeader } from "./helpers";

/* docs/reconciliation/payments-and-classes.spec.md scenarios 1–7 and 11
   (US-R02, US-R03). Consta and WispHub are fetch-mocked respecting their
   contracts, like the direct-payment suite. */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const CONSTA_ORIGIN = "https://consta.test";

/* In-memory R2, same reason as direct-payment.test.ts: real R2 writes
   trip vitest-pool-workers' isolated storage. */
function fakeProofs(): R2Bucket {
  const store = new Map<string, { data: unknown; contentType?: string }>();
  return {
    async put(key: string, value: unknown, opts?: R2PutOptions) {
      const meta = (opts?.httpMetadata as { contentType?: string } | undefined)?.contentType;
      store.set(key, { data: value, contentType: meta });
      return {} as R2Object;
    },
    async get(key: string) {
      const object = store.get(key);
      if (!object) return null;
      return {
        body: new Blob([object.data as BlobPart]).stream(),
        httpMetadata: { contentType: object.contentType },
      } as unknown as R2ObjectBody;
    },
    async list() {
      return { objects: [], truncated: false } as unknown as R2Objects;
    },
  } as unknown as R2Bucket;
}

const testEnv = {
  ...env,
  PROOFS: fakeProofs(),
  CONSTA_BASE_URL: CONSTA_ORIGIN,
  CONSTA_API_KEY: "ck_test",
} as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };

const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const consta = () => fetchMock.get(CONSTA_ORIGIN);
const json = (body: unknown) => [
  200,
  JSON.stringify(body),
  { headers: { "Content-Type": "application/json" } },
] as const;

const wisphubCustomer = (over: Record<string, unknown> = {}) => ({
  id_servicio: 6,
  usuario: "greyes@wifiplus",
  nombre: "Janely",
  estado: "Suspendido",
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { id: 71342, nombre: "Zona dia 15" },
  ...over,
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

function mockReconnection(verifyEstado = "Activo", invoiceId = 42, formas = true) {
  wh()
    .intercept({ method: "PATCH", path: "/api/clientes/6/" })
    .reply(...json({ id_servicio: 6, auto_activar_servicio: true }));
  /* The payment-method id is cached per business (provider-latency D5),
     so only the first reconnection of a test asks for it. */
  if (formas) {
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") })
      .reply(...json({ results: [{ id: 7, nombre: "efectivo" }] }));
  }
  wh()
    .intercept({ method: "POST", path: `/api/facturas/${invoiceId}/registrar-pago/` })
    .reply(...json({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }));
  mockCustomerLookup([wisphubCustomer({ estado: verifyEstado })]);
}

function mockConsta(cepAmountCents: number, trackingKey = "TRACK001XYZ") {
  consta()
    .intercept({ method: "POST", path: "/validate" })
    .reply(
      ...json({
        success: true,
        data: {
          validationId: "v-1",
          status: "valid",
          alreadyValidated: false,
          cep: {
            trackingKey,
            amountCents: cepAmountCents,
            date: new Date().toISOString().slice(0, 10),
            senderBank: "NUBANK",
            senderName: "JANELY REYES",
            receiverBank: "STP",
            beneficiaryName: "WifiPlus SA de CV",
          },
        },
      }),
    );
}

const SPEI_CONFIG = {
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
};

async function seedLinkedBusiness(overrides: Record<string, unknown> = {}) {
  const business = await seedBusiness({
    wisphubApiKey: "wh-key-1",
    serviceFeeCents: 1500,
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

async function payTransfer(trackingKey = "TRACK001XYZ") {
  return (await app()).request(
    "/direct-payments/links/tok2345abcdefgh2/pay",
    post({ transfer: { trackingKey, senderBank: "NUBANK", date: "2026-08-17" } }),
    testEnv,
  );
}

/* One confirmed round trip: pay pre-check (customer + invoices), the
   validation's fresh re-read, Consta, and the reconnection. */
function mockConfirmedFlow(
  cepAmountCents: number,
  trackingKey = "TRACK001XYZ",
  opts: { formas?: boolean } = {},
) {
  mockCustomerLookup([wisphubCustomer()], 2);
  mockPendingInvoices(undefined, 2);
  mockConsta(cepAmountCents, trackingKey);
  mockReconnection("Activo", 42, opts.formas ?? true);
}

/* The seed owes $499.00 and charges a $15.00 fee: the ask is $514.00. */
describe("US-R02 scenario 1: the class is computed at the verdict, with the tolerance", () => {
  it("received = asked → exact; received = asked − $1 with tolerance $0 → short", async () => {
    await seedLinkedBusiness();
    const db = drizzle(env.DB);

    mockConfirmedFlow(51400);
    expect((await payTransfer()).status).toBe(201);

    mockConfirmedFlow(51300, "TRACK002XYZ", { formas: false });
    expect((await payTransfer("TRACK002XYZ")).status).toBe(201);

    const rows = await db.select().from(payments).orderBy(payments.createdAt);
    const byKey = new Map(rows.map((r) => [r.trackingKey, r]));
    expect(byKey.get("TRACK001XYZ")).toMatchObject({
      status: "confirmed",
      reconciliationClass: "exact",
      receivedCents: 51400,
    });
    /* $1 short of the ask: the fee absorbs it (partial D3) so the STATUS
       is confirmed — and the CLASS still says short. Two facts, two
       fields. */
    expect(byKey.get("TRACK002XYZ")).toMatchObject({
      status: "confirmed",
      reconciliationClass: "short",
      receivedCents: 51300,
    });
  });

  it("with the tolerance raised to $1, a NEW $1-short payment is exact while the earlier row keeps short", async () => {
    const { business } = await seedLinkedBusiness();
    const db = drizzle(env.DB);

    mockConfirmedFlow(51300);
    await payTransfer();
    const [earlier] = await db.select().from(payments);
    expect(earlier.reconciliationClass).toBe("short");

    await db.update(businesses).set({ toleranceCents: 100 }).where(eq(businesses.id, business.id));

    mockConfirmedFlow(51300, "TRACK002XYZ", { formas: false });
    await payTransfer("TRACK002XYZ");

    const rows = await db.select().from(payments).orderBy(payments.createdAt);
    const byKey = new Map(rows.map((r) => [r.trackingKey, r]));
    expect(byKey.get("TRACK002XYZ")?.reconciliationClass).toBe("exact");
    /* D3: computed once — the old row never re-reads the policy */
    expect(byKey.get("TRACK001XYZ")?.reconciliationClass).toBe("short");
  });

  it("received > asked → over", async () => {
    await seedLinkedBusiness();
    mockConfirmedFlow(60000);
    await payTransfer();
    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row).toMatchObject({ status: "confirmed", reconciliationClass: "over" });
  });
});

describe("US-R02 scenarios 2 and 11: unapplied is over by definition, and always the business's to resolve", () => {
  it("a debt settled between submission and the verdict → unapplied, class over, the whole payment surplus", async () => {
    await seedLinkedBusiness();

    /* Submission sees the debt; the validation's fresh read sees it paid
       elsewhere (direct-payment D14). */
    mockCustomerLookup([wisphubCustomer()]);
    mockPendingInvoices();
    mockCustomerLookup([wisphubCustomer({ estado_facturas: "Pagadas", estado: "Activo" })]);
    mockPendingInvoices([]);
    mockConsta(51400);

    expect((await payTransfer()).status).toBe(201);
    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row).toMatchObject({
      status: "unapplied",
      reconciliationClass: "over",
      /* the proof view needs its facts even here */
      receivedCents: 51400,
      cepSenderName: "JANELY REYES",
    });

    /* Scenario 11 (API half): the row rides the default feed with the
       whole payment as surplus, while the response still says the
       integration credits ordinary surpluses — the client's copy keeps
       the two apart (D2's carve-out). */
    const res = await (await app()).request("/payments/feed", asBusiness, env);
    const { data } = await res.json();
    expect(data.effectiveOverTreatment).toBe("credit");
    expect(data.payments[0]).toMatchObject({
      status: "unapplied",
      reconciliationClass: "over",
      reconnectionStatus: null,
      surplusCents: 51400,
      customerName: "greyes@wifiplus",
    });
  });
});

describe("US-R02 scenario 3: the effective treatment", () => {
  it("with WispHub the effective treatment is credit although the policy says flag; without, flag", async () => {
    const business = await seedBusiness({ wisphubApiKey: "wh-key-1" });
    const res = await (await app()).request("/settings", asBusiness, env);
    const { data } = await res.json();
    expect(data.reconciliationPolicy).toEqual({
      toleranceCents: 0,
      overTreatment: "flag",
      effectiveOverTreatment: "credit",
    });

    await drizzle(env.DB)
      .update(businesses)
      .set({ wisphubApiKey: null })
      .where(eq(businesses.id, business.id));
    const bare = await (await app()).request("/settings", asBusiness, env);
    expect((await bare.json()).data.reconciliationPolicy.effectiveOverTreatment).toBe("flag");
  });

  it("PATCH /settings updates the policy", async () => {
    await seedBusiness();
    const res = await (await app()).request(
      "/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...asBusiness.headers },
        body: JSON.stringify({ toleranceCents: 100, overTreatment: "credit" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.reconciliationPolicy.toleranceCents).toBe(100);
    expect(data.reconciliationPolicy.overTreatment).toBe("credit");
  });
});

describe("US-R02 scenarios 4 and 5: the class rides the feed row, and the filters hold", () => {
  async function seedVariety() {
    const business = await seedBusiness();
    const day = (iso: string) => new Date(`${iso}T18:00:00Z`);
    await seedConfirmedPayment(business, {
      folio: "DV-CLS01",
      customerName: "Janely",
      reconciliationClass: "exact",
      createdAt: day("2026-08-01"),
    });
    await seedConfirmedPayment(business, {
      folio: "DV-CLS02",
      status: "partial",
      customerName: "Janely",
      reconciliationClass: "short",
      receivedCents: 30000,
      reconnectionStatus: "withheld",
      createdAt: day("2026-08-20"),
    });
    await seedConfirmedPayment(business, {
      folio: "DV-CLS03",
      customerUsuario: "aflores@wifiplus",
      customerName: "Abraham",
      reconciliationClass: "exact",
      createdAt: day("2026-08-25"),
    });
    return business;
  }

  const feed = async (qs = "") => {
    const res = await (await app()).request(`/payments/feed${qs}`, asBusiness, env);
    return (await res.json()).data;
  };

  it("scenario 4: rows carry the class; an invalid row carries none and stays out of the default view", async () => {
    const business = await seedVariety();
    await seedConfirmedPayment(business, {
      folio: null,
      status: "invalid",
      reconnectionStatus: null,
      confirmedAt: null,
      receivedCents: null,
      trackingKey: "TRACKBAD01",
    });

    const all = await feed();
    expect(all.payments).toHaveLength(3);
    expect(all.payments.map((p: { reconciliationClass: string }) => p.reconciliationClass)).toEqual(
      ["exact", "short", "exact"],
    );

    const invalid = await feed("?status=invalid");
    expect(invalid.payments).toHaveLength(1);
    expect(invalid.payments[0]).toMatchObject({ status: "invalid", reconciliationClass: null });
  });

  it("scenario 5: class, customer and date filters", async () => {
    await seedVariety();

    const short = await feed("?class=short");
    expect(short.payments.map((p: { folio: string }) => p.folio)).toEqual(["DV-CLS02"]);

    const byName = await feed("?q=Abraham");
    expect(byName.payments.map((p: { folio: string }) => p.folio)).toEqual(["DV-CLS03"]);

    const byUsuario = await feed("?q=aflores");
    expect(byUsuario.payments.map((p: { folio: string }) => p.folio)).toEqual(["DV-CLS03"]);

    /* Dates on the business's wall clock (settings D5): inclusive on
       both ends. */
    const range = await feed("?from=2026-08-10&to=2026-08-20");
    expect(range.payments.map((p: { folio: string }) => p.folio)).toEqual(["DV-CLS02"]);
  });
});

describe("US-R03 scenario 6: the proof is the whole truth, readable by every role", () => {
  it("a transfer-door payment answers the CEP and no image — to a viewer", async () => {
    const business = await seedBusiness({ speiBeneficiaryName: "WifiPlus SA de CV" });
    const payment = await seedConfirmedPayment(business, {
      trackingKey: "TRACK001XYZ",
      senderBank: "NUBANK",
      transferDate: "2026-08-17",
      cepSenderName: "JANELY REYES",
    });
    await seedMember(business, "lector@wifiplus.mx", "viewer");
    const asViewer = { headers: { Cookie: await sessionCookieHeader("lector@wifiplus.mx") } };

    const res = await (await app()).request(`/payments/${payment.id}/proof`, asViewer, env);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      folio: payment.folio,
      proofMode: "transfer",
      cep: {
        trackingKey: "TRACK001XYZ",
        amountCents: 51400,
        date: "2026-08-17",
        senderBank: "NUBANK",
        senderName: "JANELY REYES",
        beneficiaryName: "WifiPlus SA de CV",
      },
      imageUrl: null,
    });
  });

  it("a receipt-door payment answers a signed URL that serves the image and expires", async () => {
    const business = await seedBusiness();
    const payment = await seedConfirmedPayment(business, { proofMode: "receipt" });
    const proofKey = `${payment.paymentLinkId}/h-proof1`;
    await testEnv.PROOFS.put(proofKey, "img-bytes", {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await drizzle(env.DB)
      .update(payments)
      .set({ proofKey })
      .where(eq(payments.id, payment.id));

    const res = await (await app()).request(`/payments/${payment.id}/proof`, asBusiness, testEnv);
    const { data } = await res.json();
    expect(data.imageUrl).toContain(`/direct-payments/proofs/${proofKey}?exp=`);

    /* The URL serves (direct-payment D12's own door) … */
    const path = data.imageUrl.replace("http://localhost:8787", "");
    const img = await (await app()).request(path, asBusiness, testEnv);
    expect(img.status).toBe(200);
    expect(img.headers.get("Content-Type")).toBe("image/jpeg");

    /* … and a tampered signature does not */
    const bad = await (await app()).request(path.replace(/sig=\w{8}/, "sig=00000000"), asBusiness, testEnv);
    expect(bad.status).toBe(404);
  });

  it("another business's payment is 404", async () => {
    const business = await seedBusiness();
    const payment = await seedConfirmedPayment(business, {});
    await seedBusiness({ email: "otro@business.mx" });
    const asOther = { headers: { Cookie: await sessionCookieHeader("otro@business.mx") } };
    const res = await (await app()).request(`/payments/${payment.id}/proof`, asOther, env);
    expect(res.status).toBe(404);
  });
});

describe("US-R03 scenario 7: a failed reconnection can be retried by an operator", () => {
  it("a failed row goes back to queued with next attempt now; a second retry is 409", async () => {
    const business = await seedBusiness();
    const payment = await seedConfirmedPayment(business, {
      reconnectionStatus: "failed",
      reconnectionAttempts: 6,
      reconnectionError: "WISPHUB_UNAVAILABLE",
    });
    await seedMember(business, "operador@wifiplus.mx", "operator");
    const asOperator = { headers: { Cookie: await sessionCookieHeader("operador@wifiplus.mx") } };

    const before = Date.now();
    const res = await (await app()).request(
      `/payments/${payment.id}/retry-reconnection`,
      { method: "POST", ...asOperator },
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.reconnectionStatus).toBe("queued");
    expect(data.nextAttemptAt).toBeGreaterThanOrEqual(before);

    /* D5: the payment and the credit are untouched */
    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row).toMatchObject({
      reconnectionStatus: "queued",
      reconnectionAttempts: 6,
      registeredCents: payment.registeredCents,
    });

    const again = await (await app()).request(
      `/payments/${payment.id}/retry-reconnection`,
      { method: "POST", ...asOperator },
      env,
    );
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("NOT_RETRYABLE");
  });

  it("a viewer cannot retry", async () => {
    const business = await seedBusiness();
    const payment = await seedConfirmedPayment(business, { reconnectionStatus: "failed" });
    await seedMember(business, "lector@wifiplus.mx", "viewer");
    const asViewer = { headers: { Cookie: await sessionCookieHeader("lector@wifiplus.mx") } };
    const res = await (await app()).request(
      `/payments/${payment.id}/retry-reconnection`,
      { method: "POST", ...asViewer },
      env,
    );
    expect(res.status).toBe(403);
  });
});
