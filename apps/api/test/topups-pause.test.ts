import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { asc, eq } from "drizzle-orm";
import { creditEntries, paymentLinks, payments, topUps } from "../src/db/schema";
import { releaseQueuedForCredit, sweepTopUps } from "../src/credit/topups";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import type { Bindings } from "../src/env";
import { app, seedBusiness, seedConfirmedPayment, seedMember, sessionCookieHeader } from "./helpers";

/* docs/legacy/platform/prepaid-credit.spec.md scenarios 8–12 (US-B05, US-B06):
   the top-up through the platform's own account, and the pause. */

const CONSTA_ORIGIN = "https://consta.test";
const WISPHUB_ORIGIN = "https://api.wisphub.net";
const OPERATOR = "demo@devolada.app";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const testEnv = () =>
  ({
    ...(env as unknown as Bindings),
    CONSTA_BASE_URL: CONSTA_ORIGIN,
    CONSTA_API_KEY: "ck_platform",
    PLATFORM_OPERATOR_EMAILS: OPERATOR,
  }) as Bindings;

const jsonReply = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

function mockConsta(verdict: Record<string, unknown>) {
  fetchMock
    .get(CONSTA_ORIGIN)
    .intercept({ method: "POST", path: "/validate" })
    .reply(...jsonReply({ success: true, data: { validationId: "v-1", alreadyValidated: false, ...verdict } }));
}
const validCep = (amountCents: number, trackingKey = "TOPUP0001ABC") => ({
  status: "valid",
  cep: {
    trackingKey,
    amountCents,
    date: "2026-09-01",
    senderBank: "BBVA MEXICO",
    senderName: "WIFIPLUS SA DE CV",
    receiverBank: "STP",
    beneficiaryName: "Devolada",
  },
});

/* The payer's link needs WispHub's debt for the pay request (D1) */
function mockWisphubDebt() {
  const wh = fetchMock.get(WISPHUB_ORIGIN);
  wh.intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario=") })
    .reply(...jsonReply({
      count: 1,
      results: [{ id_servicio: 6, usuario: "greyes@wifiplus", nombre: "Janely", estado: "Suspendido", estado_facturas: "Pendiente de Pago", precio_plan: "499.00", saldo: "0.00", zona: { id: 1, nombre: "Zona" } }],
    }));
  wh.intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1") })
    .reply(...jsonReply({ next: null, count: 1, results: [{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 }] }));
}

const asUser = async (email: string) => ({ headers: { Cookie: await sessionCookieHeader(email) } });
const call = async (email: string, path: string, init: RequestInit = {}) => {
  const { headers } = await asUser(email);
  return (await app()).request(
    path,
    { ...init, headers: { ...headers, "Content-Type": "application/json", ...(init.headers ?? {}) } },
    testEnv() as unknown as typeof env,
  );
};
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

async function platformAccountSet() {
  await call(OPERATOR, "/platform/settings/topup_clabe", post({ value: "646180157099999999" }));
  await call(OPERATOR, "/platform/settings/topup_bank", post({ value: "STP" }));
}

/* Below the cap: −$60.00 against a −$50.00 cap */
async function pause(businessId: string) {
  await drizzle(env.DB)
    .insert(creditEntries)
    .values({ businessId, kind: "adjustment", cents: -6000, reason: "test: pause", authorUserId: null });
}

async function seedLink(businessId: string, token = "toklinkpause00001") {
  const [link] = await drizzle(env.DB)
    .insert(paymentLinks)
    .values({ businessId, token, wisphubCustomerId: "6", customerUsuario: "greyes@wifiplus" })
    .returning();
  return link;
}

const spei = { speiClabe: "646180157000000004", speiBank: "STP", speiBeneficiaryName: "WifiPlus SA de CV", wisphubApiKey: "wh-key-1" };

describe("US-B06: the pause — what is new waits without spending", () => {
  it("scenario 8: a new proof under the cap is queued, no provider call; the payer reads the business's fault", async () => {
    const business = await seedBusiness(spei);
    await pause(business.id);
    const link = await seedLink(business.id);
    mockWisphubDebt();

    const res = await (await app()).request(
      `/direct-payments/links/${link.token}/pay`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transfer: { trackingKey: "QUEUED0001", senderBank: "NUBANK", date: "2026-09-01" } }) },
      testEnv() as unknown as typeof env,
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("queued_for_credit");

    const status = await (await app()).request(`/direct-payments/${data.directPaymentId}/status`, {}, testEnv() as unknown as typeof env);
    expect((await status.json()).data.status).toBe("queued_for_credit");

    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.validationAttempts).toBe(0);
    expect(row.nextValidationAt).toBeNull();
    /* No fee: nothing was validated */
    expect((await drizzle(env.DB).select().from(creditEntries)).filter((e) => e.kind === "validation_fee")).toHaveLength(0);
  });

  it("scenario 8 (in flight): a payment already validating keeps its schedule while paused", async () => {
    const business = await seedBusiness(spei);
    await pause(business.id);
    await seedConfirmedPayment(business, {
      status: "validating",
      folio: null,
      proofMode: "transfer",
      trackingKey: "INFLIGHT01",
      senderBank: "NUBANK",
      transferDate: "2026-09-01",
      nextValidationAt: new Date(Date.now() - 60_000),
      actionOutcome: null,
    });
    mockConsta({ status: "pending" });
    const report = await sweepDirectPayments(testEnv());
    expect(report).toMatchObject({ claimed: 1, stillValidating: 1 });
    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.validationAttempts).toBe(1);
    expect(row.status).toBe("validating");
  });

  it("scenario 9 (release): queued proofs go back to validating in arrival order once the balance clears the cap", async () => {
    const business = await seedBusiness(spei);
    await pause(business.id);
    const db = drizzle(env.DB);
    const link = await seedLink(business.id);
    for (const [i, key] of ["Q1AAAAAA", "Q2BBBBBB"].entries()) {
      await db.insert(payments).values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        trackingKey: key,
        status: "queued_for_credit",
        createdAt: new Date(Date.now() - (2 - i) * 60_000),
      });
    }
    /* Still paused: nothing moves */
    expect(await releaseQueuedForCredit(testEnv())).toBe(0);

    await db.insert(creditEntries).values({ businessId: business.id, kind: "adjustment", cents: 20000, reason: "test: top up", authorUserId: null });
    expect(await releaseQueuedForCredit(testEnv())).toBe(2);
    const rows = await db.select().from(payments).orderBy(asc(payments.nextValidationAt));
    expect(rows.map((r) => [r.trackingKey, r.status])).toEqual([["Q1AAAAAA", "validating"], ["Q2BBBBBB", "validating"]]);
  });
});

describe("US-B05: the top-up through the platform's own account", () => {
  it("scenario 9: a valid CEP credits its amount and the balance leaves the pause; billed to nobody", async () => {
    const business = await seedBusiness();
    await platformAccountSet();
    await pause(business.id);
    mockConsta(validCep(25000));

    const res = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0001ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ status: "credited", creditedCents: 25000, proofMode: "transfer" });

    const credit = await (await call(OPERATOR, "/credit")).json();
    expect(credit.data.balanceCents).toBe(19000);
    expect(credit.data.step).toBe("ok");
    const entries = await drizzle(env.DB).select().from(creditEntries);
    expect(entries.filter((e) => e.kind === "top_up")).toHaveLength(1);
    /* The platform's validation is nobody's fee */
    expect(entries.filter((e) => e.kind === "validation_fee")).toHaveLength(0);
  });

  it("scenario 10: the CEP's amount is credited, not the claimed one", async () => {
    const business = await seedBusiness();
    await platformAccountSet();
    mockConsta(validCep(8000));
    const res = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0002ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 10000 } }));
    expect((await res.json()).data.creditedCents).toBe(8000);
    const [entry] = await drizzle(env.DB).select().from(creditEntries).where(eq(creditEntries.businessId, business.id));
    expect(entry.cents).toBe(8000);
  });

  it("scenario 11: below the minimum the form refuses, and nothing is stored", async () => {
    await seedBusiness();
    await platformAccountSet();
    const res = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0003ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 2000 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BELOW_MINIMUM");
    expect(await drizzle(env.DB).select().from(topUps)).toHaveLength(0);
  });

  it("scenario 12: a reused tracking key is refused — one transfer credits once", async () => {
    await seedBusiness();
    await platformAccountSet();
    mockConsta(validCep(25000));
    expect((await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0001ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }))).status).toBe(201);
    const again = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "topup0001abc", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("TRANSFER_ALREADY_USED");
  });

  it("a pending CEP rides the schedule and the sweep credits it later", async () => {
    await seedBusiness();
    await platformAccountSet();
    mockConsta({ status: "pending" });
    const res = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0004ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }));
    const { data } = await res.json();
    expect(data.status).toBe("validating");
    expect(data.nextValidationAt).not.toBeNull();

    const db = drizzle(env.DB);
    await db.update(topUps).set({ nextValidationAt: new Date(Date.now() - 1000) });
    mockConsta(validCep(25000, "TOPUP0004ABC"));
    expect(await sweepTopUps(testEnv())).toMatchObject({ claimed: 1, credited: 1 });
    const [row] = await db.select().from(topUps);
    expect(row).toMatchObject({ status: "credited", creditedCents: 25000 });
    const listed = await (await call(OPERATOR, "/credit/top-ups")).json();
    expect(listed.data.topUps[0]).toMatchObject({ id: row.id, status: "credited" });
  });

  it("only the owner tops up; without the platform's account the door says so", async () => {
    const business = await seedBusiness();
    await seedMember(business, "admin@wifiplus.mx", "admin");
    expect((await call("admin@wifiplus.mx", "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0005ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }))).status).toBe(403);
    const unset = await call(OPERATOR, "/credit/top-ups", post({ transfer: { trackingKey: "TOPUP0005ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } }));
    expect(unset.status).toBe(409);
    expect((await unset.json()).error.code).toBe("TOPUP_NOT_CONFIGURED");
  });
});
