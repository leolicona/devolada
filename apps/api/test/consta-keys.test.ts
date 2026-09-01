import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, paymentLinks, payments } from "../src/db/schema";
import { sweepDirectPayments } from "../src/direct-payments/validation";
import { backfillConstaKeys } from "../src/consta/issuer";
import type { Bindings } from "../src/env";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";

/* docs/reconciliation/payments-and-classes.spec.md scenarios 9, 10 and
   12 (D7/D8/D9 — pivot D20 executed). */

const WISPHUB_ORIGIN = "https://api.wisphub.net";
const CONSTA_ORIGIN = "https://consta.test";

const testEnv = {
  ...env,
  CONSTA_BASE_URL: CONSTA_ORIGIN,
  CONSTA_API_KEY: "ck_platform",
  CONSTA_ISSUER_TOKEN: "issuer-secret",
} as typeof env & Bindings;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };

const consta = () => fetchMock.get(CONSTA_ORIGIN);
const wh = () => fetchMock.get(WISPHUB_ORIGIN);
const json = (body: unknown) => [
  200,
  JSON.stringify(body),
  { headers: { "Content-Type": "application/json" } },
] as const;

/* The issuer door: asserts the Bearer is the ISSUER token, never the
   admin's and never an api key. */
function mockIssuer(key: string) {
  consta()
    .intercept({
      method: "POST",
      path: "/admin/keys",
      headers: { authorization: "Bearer issuer-secret" },
    })
    .reply(...json({ success: true, data: { id: `id-${key}`, name: "x", key } }));
}

const MINIMUM = {
  name: "WifiPlus Norte",
  speiClabe: "646180157000000004",
  speiBank: "STP",
};

async function createBusiness(over: Partial<typeof MINIMUM> = {}, envOverride = testEnv) {
  return (await app()).request(
    "/businesses",
    {
      method: "POST",
      headers: { ...asBusiness.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ...MINIMUM, ...over }),
    },
    envOverride,
  );
}

describe("D7 scenario 9: a business is born with its own Consta key", () => {
  it("POST /businesses issues through the issuer door and stores the key in the row", async () => {
    await seedBusiness();
    mockIssuer("ck_biz000000000000000000000000000001");

    const res = await createBusiness();
    expect(res.status).toBe(201);
    const { data } = await res.json();

    const [row] = await drizzle(env.DB).select().from(businesses).where(eq(businesses.id, data.id));
    expect(row.constaApiKey).toBe("ck_biz000000000000000000000000000001");
  });

  it("D8: the validation of that business's payment travels under ITS key", async () => {
    const business = await seedBusiness({
      wisphubApiKey: "wh-key-1",
      speiClabe: "646180157000000004",
      speiBank: "STP",
      constaApiKey: "ck_biz000000000000000000000000000002",
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

    const customer = {
      id_servicio: 6,
      usuario: "greyes@wifiplus",
      nombre: "Janely",
      estado: "Suspendido",
      estado_facturas: "Pendiente de Pago",
      precio_plan: "499.00",
      saldo: "0.00",
    };
    /* One read each: the pay pre-check. A `pending` verdict never
       re-reads WispHub — that only happens after `valid`. */
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes/") })
      .reply(...json({ count: 1, results: [customer] }));
    wh()
      .intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas/?") })
      .reply(...json({ next: null, count: 1, results: [{ id_factura: 42, cliente: { usuario: "greyes@wifiplus" }, total: 499 }] }));
    /* The interceptor only matches the BUSINESS key: a payment that
       traveled under the platform's key finds no mock and cannot reach
       `pending`. That match is the assertion. */
    consta()
      .intercept({
        method: "POST",
        path: "/validate",
        headers: { authorization: "Bearer ck_biz000000000000000000000000000002" },
      })
      .reply(...json({ success: true, data: { validationId: "v-1", status: "pending", alreadyValidated: false } }));

    const res = await (await app()).request(
      `/direct-payments/links/${link.token}/pay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transfer: { trackingKey: "TRACK001XYZ", senderBank: "NUBANK", date: "2026-08-17" } }),
      },
      testEnv,
    );
    expect(res.status).toBe(201);
    const [row] = await drizzle(env.DB).select().from(payments);
    expect(row.constaStatus).toBe("pending");
  });
});

describe("D7 scenario 10: the backfill, and an issuer that is down at birth", () => {
  it("existing businesses without a key get one, once each", async () => {
    await seedBusiness();
    await seedBusiness({ email: "otro@business.mx", name: "WifiPlus Sur" });
    mockIssuer("ck_bf0000000000000000000000000000001");
    mockIssuer("ck_bf0000000000000000000000000000002");

    expect(await backfillConstaKeys(testEnv)).toBe(2);
    const rows = await drizzle(env.DB).select().from(businesses);
    expect(rows.map((r) => r.constaApiKey).sort()).toEqual([
      "ck_bf0000000000000000000000000000001",
      "ck_bf0000000000000000000000000000002",
    ]);

    /* once: a second sweep finds nothing missing and calls nobody */
    expect(await backfillConstaKeys(testEnv)).toBe(0);
  });

  it("a business born while the issuer is down is created anyway, with no key", async () => {
    await seedBusiness();
    /* No interceptor: the issuance call fails (net connect disabled) and
       the birth must survive it. */
    const res = await createBusiness({ name: "WifiPlus Costa" });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    const [row] = await drizzle(env.DB).select().from(businesses).where(eq(businesses.id, data.id));
    expect(row.constaApiKey).toBeNull();
  });

  it("with the issuer secret unset, nothing is attempted", async () => {
    await seedBusiness();
    expect(await backfillConstaKeys({ ...testEnv, CONSTA_ISSUER_TOKEN: undefined })).toBe(0);
  });
});

describe("D9 scenario 12: a suspended business validates nothing", () => {
  async function seedSuspendedWithRow() {
    const business = await seedBusiness({
      wisphubApiKey: "wh-key-1",
      speiClabe: "646180157000000004",
      speiBank: "STP",
      constaApiKey: "ck_biz000000000000000000000000000003",
    });
    const [link] = await drizzle(env.DB)
      .insert(paymentLinks)
      .values({
        businessId: business.id,
        token: "toksuspend123456",
        wisphubCustomerId: "6",
        customerUsuario: "greyes@wifiplus",
      })
      .returning();
    const past = new Date(Date.now() - 60_000);
    const [row] = await drizzle(env.DB)
      .insert(payments)
      .values({
        paymentLinkId: link.id,
        businessId: business.id,
        amountCents: 51400,
        invoiceCents: 49900,
        serviceFeeCents: 1500,
        proofMode: "transfer",
        status: "validating",
        trackingKey: "TRACKSUSP01",
        senderBank: "NUBANK",
        transferDate: "2026-08-17",
        nextValidationAt: past,
      })
      .returning();
    await drizzle(env.DB)
      .update(businesses)
      .set({ status: "suspended" })
      .where(eq(businesses.id, business.id));
    return { business, link, row, past };
  }

  it("the link answers 409 BUSINESS_SUSPENDED on GET and POST", async () => {
    const { link } = await seedSuspendedWithRow();
    const get = await (await app()).request(`/direct-payments/links/${link.token}`, {}, testEnv);
    expect(get.status).toBe(409);
    expect((await get.json()).error.code).toBe("BUSINESS_SUSPENDED");

    const post = await (await app()).request(
      `/direct-payments/links/${link.token}/pay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transfer: { trackingKey: "TRACK002XYZ", senderBank: "NUBANK", date: "2026-08-17" } }),
      },
      testEnv,
    );
    expect(post.status).toBe(409);
    expect((await post.json()).error.code).toBe("BUSINESS_SUSPENDED");
  });

  it("the sweep skips its validating rows with the schedule frozen, and they validate on reactivation; the key is untouched", async () => {
    const { business, row, past } = await seedSuspendedWithRow();

    const frozen = await sweepDirectPayments(testEnv);
    expect(frozen.claimed).toBe(0);
    const [untouched] = await drizzle(env.DB).select().from(payments).where(eq(payments.id, row.id));
    expect(untouched.nextValidationAt?.getTime()).toBe(past.getTime());
    expect(untouched.validationAttempts).toBe(0);

    /* Reactivation: the row is due again with its old schedule, and the
       resumed attempt is a real one — under the business's key, which
       suspension never revoked. */
    await drizzle(env.DB).update(businesses).set({ status: "active" }).where(eq(businesses.id, business.id));
    consta()
      .intercept({
        method: "POST",
        path: "/validate",
        headers: { authorization: "Bearer ck_biz000000000000000000000000000003" },
      })
      .reply(...json({ success: true, data: { validationId: "v-2", status: "pending", alreadyValidated: false } }));

    const resumed = await sweepDirectPayments(testEnv);
    expect(resumed.claimed).toBe(1);
    const [after] = await drizzle(env.DB).select().from(payments).where(eq(payments.id, row.id));
    expect(after.constaStatus).toBe("pending");
    const [biz] = await drizzle(env.DB).select().from(businesses).where(eq(businesses.id, business.id));
    expect(biz.constaApiKey).toBe("ck_biz000000000000000000000000000003");
  });
});
