import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq, isNull } from "drizzle-orm";
import { paymentLinks, payments, platformSettings, topUps, user } from "../../src/db/schema";
import { validateTopUp } from "../../src/credit/topups";
import { consta, ConstaError, type ConstaRequest } from "../../src/consta";
import { loadShapeRules, resetShapeRules } from "../../src/consta/extraction";
import { app } from "../helpers";
import {
  aiReturning,
  db,
  engineEnv,
  extractions,
  PNG,
  putProof,
  seedBusiness,
  seedOwner,
  seedValidations,
  validations,
} from "./helpers";

/* consta-api-merge US3 — the validation record lives beside the payment.
   Every provider call and every reading is a row in the product's own
   database, attributed to the business it served (D3) or to the
   platform for its own top-up, keyed to the link's own customer identity
   with no secret in the env (D5, FR-006), never holding the file (FR-005),
   never visible to another business (SC-007) — and the two reads the
   constitution names as cross-business (D4) do read across on purpose.
   Every title carries the word "attributed" so `-t "attributed"` in the
   quickstart selects the story. */

const APICEP_ORIGIN = "https://api.apicep.cloud";
const WISPHUB_ORIGIN = "https://api.wisphub.net";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

const pendingReply = { validationId: "prov-attr", status: "pending", validation: { cepPreviouslyValidated: false } };
const notFoundReply = { validationId: "prov-nf", status: "invalid", validation: { banxicoConfirmed: false, cepPreviouslyValidated: null } };

function mockApiCep(reply: unknown, opts: { status?: number; headers?: Record<string, string> } = {}) {
  fetchMock
    .get(APICEP_ORIGIN)
    .intercept({ method: "POST", path: "/validate-transfer" })
    .reply(opts.status ?? 200, JSON.stringify(reply), {
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    });
}

const transfer = (trackingKey: string, senderBank = "NUBANK", receiver = "STP") => ({
  transfer: {
    date: new Date().toISOString().slice(0, 10),
    amountCents: 51400,
    senderBank,
    trackingKey,
    beneficiary: { bank: receiver, clabe: "646180157000000004" },
  },
});

const SPEI = {
  wisphubApiKey: "wh-key-1",
  serviceFeeCents: 1500,
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
};

describe("consta-api-merge US3: every record is attributed", () => {
  it("scenario 1: a business's payment writes one validations row attributed to it, keyed to the link's own customer (FR-006), with no secret in the env", async () => {
    const business = await seedBusiness(SPEI);
    await drizzle(env.DB)
      .insert(paymentLinks)
      .values({ businessId: business.id, token: "tokattr000000001", wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" });
    const wh = fetchMock.get(WISPHUB_ORIGIN);
    wh.intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") }).reply(
      ...json({ count: 1, results: [{ id_servicio: 6, usuario: "greyes@wifiplus", nombre: "Janely", estado: "Suspendido", estado_facturas: "Pendiente de Pago", precio_plan: "499.00", saldo: "0.00", zona: { id: 1, nombre: "Zona" } }] }),
    );
    wh.intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") }).reply(
      ...json({ next: null, count: 1, results: [{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 }] }),
    );
    mockApiCep(pendingReply);

    /* The env carries no CUSTOMER_REF_SECRET any more — the binding is
       gone (D5); the ref is the usuario itself */
    const testEnv = engineEnv();
    expect("CUSTOMER_REF_SECRET" in testEnv).toBe(false);
    const res = await (await app()).request(
      "/direct-payments/links/tokattr000000001/pay",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transfer: { trackingKey: "TRACKATTR01", senderBank: "NUBANK", date: new Date().toISOString().slice(0, 10) } }) },
      testEnv as unknown as typeof env,
    );
    expect(res.status).toBe(201);

    const [payment] = await drizzle(env.DB).select().from(payments);
    const rows = await db().select().from(validations);
    expect(rows).toHaveLength(1);
    expect(rows[0].businessId).toBe(business.id);
    expect(rows[0].customerRef).toBe("greyes@wifiplus");
    expect(rows[0].paymentRef).toBe(payment.id);
    /* the payment points at a local row now (data-model: a local key) */
    expect(payment.constaValidationId).toBe(rows[0].id);
  });

  it("scenario 1 / FR-004: a billed failure — the envelope-shaped 400 — writes a row with status NULL, attributed the same way", async () => {
    const { id, key } = await seedOwner();
    mockApiCep(
      { validationId: "prov-billed", status: "error", error: "El banco emisor y el banco receptor no pueden ser la misma institución." },
      { status: 400 },
    );
    let failure: ConstaError | null = null;
    try {
      await consta(engineEnv(), db(), { businessId: key }).validate({ ...transfer("TRACKBILLED01"), customerRef: "greyes@wifiplus", paymentRef: "pay-billed" } as ConstaRequest);
    } catch (e) {
      if (e instanceof ConstaError) failure = e;
      else throw e;
    }
    expect(failure?.code).toBe("REQUEST_REJECTED");
    const rows = await db().select().from(validations).where(eq(validations.businessId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBeNull();
    expect(rows[0].providerValidationId).toBe("prov-billed");
    expect(rows[0].customerRef).toBe("greyes@wifiplus");
    expect(rows[0].paymentRef).toBe("pay-billed");
  });

  it("scenario 2: a top-up is attributed to the platform — NULL owner — and never to a business", async () => {
    const business = await seedBusiness();
    const [owner] = await drizzle(env.DB).select().from(user).where(eq(user.email, "demo@devolada.app"));
    /* operator-panel D1: the platform's own account, where the top-up lands */
    await drizzle(env.DB).insert(platformSettings).values([
      { key: "topup_clabe", value: "646180157099999999", authorUserId: owner.id },
      { key: "topup_bank", value: "STP", authorUserId: owner.id },
    ]);
    const now = new Date();
    const [topUp] = await drizzle(env.DB)
      .insert(topUps)
      .values({
        businessId: business.id,
        submittedByUserId: owner.id,
        claimedCents: 25000,
        proofMode: "transfer",
        trackingKey: "TOPUPATTR001",
        senderBank: "BBVA MEXICO",
        transferDate: now.toISOString().slice(0, 10),
        nextValidationAt: now,
      })
      .returning();
    mockApiCep(pendingReply);

    const row = await validateTopUp(engineEnv(), drizzle(env.DB), topUp, now);
    expect(row.constaStatus).toBe("pending");
    const rows = await db().select().from(validations);
    expect(rows).toHaveLength(1);
    expect(rows[0].businessId).toBeNull();
    expect(rows[0].customerRef).toBeNull();
    expect(rows[0].paymentRef).toBeNull();
    expect(await db().select().from(validations).where(eq(validations.businessId, business.id))).toHaveLength(0);
    expect(await db().select().from(validations).where(isNull(validations.businessId))).toHaveLength(1);
  });

  it("scenario 4 / FR-005: a reading is attributed with a fingerprint of the file and no column holding the bytes", async () => {
    const { id, key } = await seedOwner();
    const testEnv = engineEnv({ AI: aiReturning({ esComprobante: true, claveDeRastreo: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K", banco: "NUBANK", monto: 514, fecha: "2026-08-19", estatus: "Aceptada" }) });
    await putProof(testEnv.PROOFS, "link-attr/receipt.png", PNG(), "image/png");

    const reading = await consta(testEnv, db(), { businessId: key }).extract({ proofKey: "link-attr/receipt.png" });
    expect(reading.source).toBe("reader");
    const rows = await db().select().from(extractions).where(eq(extractions.businessId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].proofSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].byteSize).toBe(64);
    expect(rows[0].mediaType).toBe("image/png");
    expect(Object.keys(rows[0])).not.toContain("bytes");
    expect(JSON.stringify(rows[0])).not.toContain("iVBOR");
  });

  it("scenario 5 / SC-007: rows attributed to business A are invisible to a query scoped to business B", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    mockApiCep(pendingReply);
    await consta(engineEnv(), db(), { businessId: a.key }).validate(transfer("TRACKISO0A01") as ConstaRequest);
    mockApiCep(pendingReply);
    await consta(engineEnv(), db(), { businessId: a.key }).validate(transfer("TRACKISO0A02") as ConstaRequest);
    mockApiCep(pendingReply);
    await consta(engineEnv(), db(), { businessId: b.key }).validate(transfer("TRACKISO0B01") as ConstaRequest);

    const ofA = await db().select().from(validations).where(eq(validations.businessId, a.id));
    const ofB = await db().select().from(validations).where(eq(validations.businessId, b.id));
    expect(ofA.map((r) => r.trackingKey).sort()).toEqual(["TRACKISO0A01", "TRACKISO0A02"]);
    expect(ofB.map((r) => r.trackingKey)).toEqual(["TRACKISO0B01"]);
    expect(await db().select().from(validations)).toHaveLength(3);
  });

  it("D4: the two bank statistics read across businesses on purpose — a shape rule and a retry cell attributed to nobody", async () => {
    const a = await seedOwner();
    const b = await seedOwner();
    /* Azteca as measured 2026-08-30: 18 digits and a literal trailing I;
       five confirmed at each business — ten in all, the graduation floor */
    const aztecaClave = (i: number) => `260831070865${String(690000 + i * 137).padStart(6, "0")}I`;
    const confirmed = (i: number) => ({ mode: "transfer" as const, status: "valid" as const, senderBank: "AZTECA", trackingKey: aztecaClave(i), amountCents: 100, transferDate: "2026-08-30" });
    await seedValidations(a.id, [0, 1, 2, 3, 4].map(confirmed));
    await seedValidations(b.id, [5, 6, 7, 8, 9].map(confirmed));
    resetShapeRules();
    const rules = await loadShapeRules(db());
    expect(rules.map((r) => r.bank)).toEqual(["AZTECA"]);
    expect(rules[0].samples).toBe(10);
    /* a rule, never a row: the pattern and its sample count are all it holds */
    expect(Object.keys(rules[0]).sort()).toEqual(["bank", "length", "pattern", "samples"]);

    /* Thirty measured transfers of one pair, fifteen at each business,
       fill one retry cell: a third business's first miss gets the moment */
    const anchor = Date.now() - 6 * 60 * 60 * 1000;
    const measured = (prefix: string) =>
      Array.from({ length: 15 }, (_, i) => `${prefix}${String(i).padStart(4, "0")}`).flatMap((key) => [
        { mode: "transfer" as const, status: "invalid" as const, reason: "not_found" as const, trackingKey: key, senderBank: "NUBANK", beneficiaryBank: "STP", createdAt: new Date(anchor) },
        { mode: "transfer" as const, status: "valid" as const, trackingKey: key, senderBank: "NUBANK", beneficiaryBank: "STP", createdAt: new Date(anchor + 22 * 60_000) },
      ]);
    await seedValidations(a.id, measured("CELLA"));
    await seedValidations(b.id, measured("CELLB"));
    const c = await seedOwner();
    mockApiCep(notFoundReply);
    const verdict = await consta(engineEnv(), db(), { businessId: c.key }).validate(transfer("TRACKCELL0C01") as ConstaRequest);
    expect(verdict.reason).toBe("not_found");
    expect(verdict.retryAfter).toBeDefined();
    /* and C's own record is still only C's */
    expect(await db().select().from(validations).where(eq(validations.businessId, c.id))).toHaveLength(1);
  });
});
