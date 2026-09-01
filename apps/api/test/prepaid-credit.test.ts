import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, creditEntries, platformSettings, user as userTable } from "../src/db/schema";
import { debitValidationFee, grantWelcomeBonus, stepFor } from "../src/credit";
import type { Bindings } from "../src/env";
import { app, seedBusiness, seedConfirmedPayment, seedMember, sessionCookieHeader } from "./helpers";

/* docs/platform/prepaid-credit.spec.md scenarios 1–7, 13–14 (US-B04,
   US-L03) and docs/platform/operator-panel.spec.md scenarios 1–8
   (US-L02). Top-ups and the pause (prepaid-credit D6, D8, D9) land with
   their own PR. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

const OPERATOR = "demo@devolada.app";
const opEnv = () => ({ ...(env as unknown as Bindings), PLATFORM_OPERATOR_EMAILS: OPERATOR }) as Bindings;
const testEnv = () => opEnv() as unknown as typeof env;

const asUser = async (email: string) => ({ headers: { Cookie: await sessionCookieHeader(email) } });
const call = async (email: string, path: string, init: RequestInit = {}) => {
  const { headers } = await asUser(email);
  return (await app()).request(
    path,
    { ...init, headers: { ...headers, "Content-Type": "application/json", ...(init.headers ?? {}) } },
    testEnv(),
  );
};
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

const userIdOf = async (email: string) => {
  const [u] = await drizzle(env.DB).select().from(userTable).where(eq(userTable.email, email));
  return u.id;
};

const MINIMUM = {
  name: "WifiPlus Norte",
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
};

describe("US-L03: the fee keys on the terminal verdict, once per payment", () => {
  it("scenario 2: a confirmed payment debits $5.00 once — a second call is a no-op", async () => {
    const business = await seedBusiness();
    const db = drizzle(env.DB);
    const payment = await seedConfirmedPayment(business, { status: "confirmed" });

    expect(await debitValidationFee(opEnv(), db, payment)).toBe(true);
    expect(await debitValidationFee(opEnv(), db, payment)).toBe(false);
    const rows = await db.select().from(creditEntries).where(eq(creditEntries.businessId, business.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "validation_fee", cents: -500, paymentId: payment.id });
  });

  it("scenario 3: partial, unapplied and invalid (contradicted) each debit once; expired and superseded never", async () => {
    const business = await seedBusiness();
    const db = drizzle(env.DB);
    const charged = [];
    for (const status of ["partial", "unapplied", "invalid", "expired", "superseded"] as const) {
      const p = await seedConfirmedPayment(business, {
        status,
        folio: `DV-${status.toUpperCase().slice(0, 5)}1`,
        customerUsuario: `${status}@wifiplus`,
      });
      charged.push([status, await debitValidationFee(opEnv(), db, p)]);
    }
    expect(charged).toEqual([
      ["partial", true],
      ["unapplied", true],
      ["invalid", true],
      ["expired", false],
      ["superseded", false],
    ]);
    const rows = await db.select().from(creditEntries).where(eq(creditEntries.businessId, business.id));
    expect(rows).toHaveLength(3);
  });

  it("scenario 5 + 6: the override wins; a global change applies from its moment on", async () => {
    const a = await seedBusiness({ feeOverrideCents: 300 });
    const b = await seedBusiness({ email: "otro@business.mx" });
    const db = drizzle(env.DB);
    const pa = await seedConfirmedPayment(a, { customerUsuario: "a@wifiplus" });
    const pb = await seedConfirmedPayment(b, { customerUsuario: "b@wifiplus" });
    await debitValidationFee(opEnv(), db, pa);
    await debitValidationFee(opEnv(), db, pb);
    const [ra] = await db.select().from(creditEntries).where(eq(creditEntries.businessId, a.id));
    const [rb] = await db.select().from(creditEntries).where(eq(creditEntries.businessId, b.id));
    expect(ra.cents).toBe(-300);
    expect(rb.cents).toBe(-500);

    /* The operator raises the global fee: only later debits see it */
    expect((await call(OPERATOR, "/platform/settings/validation_fee_cents", json({ value: 700 }))).status).toBe(201);
    const pb2 = await seedConfirmedPayment(b, { customerUsuario: "b2@wifiplus", folio: "DV-B2" });
    await debitValidationFee(opEnv(), db, pb2);
    const rowsB = await db.select().from(creditEntries).where(eq(creditEntries.businessId, b.id));
    expect(rowsB.map((r) => r.cents).sort()).toEqual([-700, -500].sort());
  });
});

describe("US-B04: the balance, the bonus and the steps", () => {
  it("scenario 1: a first business is born with 20 × fee; the same user's second is born at $0", async () => {
    await seedBusiness();
    const first = await call(OPERATOR, "/businesses", json(MINIMUM));
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.id;
    const second = await call(OPERATOR, "/businesses", json({ ...MINIMUM, name: "WifiPlus Sur" }));
    const secondId = (await second.json()).data.id;

    const db = drizzle(env.DB);
    const b1 = await db.select().from(creditEntries).where(eq(creditEntries.businessId, firstId));
    const b2 = await db.select().from(creditEntries).where(eq(creditEntries.businessId, secondId));
    expect(b1).toHaveLength(1);
    expect(b1[0]).toMatchObject({ kind: "welcome_bonus", cents: 10000 });
    expect(b2).toHaveLength(0);
  });

  it("scenario 7: the steps — ok, low at five validations' worth, empty at 0, paused past the cap", () => {
    expect(stepFor(10000, 500, 5000)).toBe("ok");
    expect(stepFor(2500, 500, 5000)).toBe("low");
    expect(stepFor(0, 500, 5000)).toBe("empty");
    expect(stepFor(-5000, 500, 5000)).toBe("empty");
    expect(stepFor(-5001, 500, 5000)).toBe("paused");
  });

  it("scenario 7 (emails): crossing 0 and crossing the cap each send once to every owner", async () => {
    const business = await seedBusiness();
    const db = drizzle(env.DB);
    /* Two owners, so the recipient list is the memberships' (D7) */
    await seedMember(business, "socio@wifiplus.mx", "owner");
    const sent: { to: string[]; subject: string }[] = [];
    fetchMock
      .get("https://api.resend.com")
      .intercept({ method: "POST", path: "/emails" })
      .reply(200, (req) => {
        const body = JSON.parse(String(req.body)) as { to: string[]; subject: string };
        sent.push({ to: body.to, subject: body.subject });
        return { id: "e" };
      })
      .times(2);
    const mailEnv = { ...opEnv(), RESEND_API_KEY: "re_test" };

    /* Balance $5.00 → one debit reaches 0 exactly → "llegó a cero" */
    await db.insert(creditEntries).values({ businessId: business.id, kind: "adjustment", cents: 500, reason: "seed", authorUserId: null });
    await debitValidationFee(mailEnv, db, await seedConfirmedPayment(business, { customerUsuario: "u1@x" }));
    /* Ten more debits: −$50.00 is still "empty"; the eleventh crosses the cap */
    for (let i = 2; i <= 11; i++) {
      await debitValidationFee(mailEnv, db, await seedConfirmedPayment(business, { customerUsuario: `u${i}@x`, folio: `DV-U${i}` }));
    }
    await debitValidationFee(mailEnv, db, await seedConfirmedPayment(business, { customerUsuario: "u12@x", folio: "DV-U12" }));

    expect(sent).toHaveLength(2);
    expect(sent[0].subject).toMatch(/llegó a cero/);
    expect(sent[1].subject).toMatch(/validación en pausa/);
    expect(sent[0].to.sort()).toEqual(["demo@devolada.app", "socio@wifiplus.mx"]);
  });

  it("scenario 13 + 14: any member reads the balance and the entries; the page's sum is the balance", async () => {
    const business = await seedBusiness();
    await seedMember(business, "lector@wifiplus.mx", "viewer");
    const db = drizzle(env.DB);
    await grantWelcomeBonus(db, business, await userIdOf(OPERATOR));
    await debitValidationFee(opEnv(), db, await seedConfirmedPayment(business));

    const summary = await (await call("lector@wifiplus.mx", "/credit")).json();
    expect(summary.data).toMatchObject({ balanceCents: 9500, feeCents: 500, capCents: 5000, step: "ok", topUp: null });
    const entries = await (await call("lector@wifiplus.mx", "/credit/entries")).json();
    const total = entries.data.entries.reduce((n: number, e: { cents: number }) => n + e.cents, 0);
    expect(total).toBe(9500);
    expect(entries.data.entries.map((e: { kind: string }) => e.kind).sort()).toEqual(["validation_fee", "welcome_bonus"]);
  });

  it("the actor carries the step for the chip", async () => {
    await seedBusiness();
    const me = await (await call(OPERATOR, "/auth/me")).json();
    expect(me.data.credit).toEqual({ balanceCents: 0, step: "empty" });
    expect(me.data.platformOperator).toBe(true);
  });
});

describe("US-L02: the operator panel", () => {
  it("scenario 1: the secret names the operator; everyone else is refused", async () => {
    const business = await seedBusiness();
    await seedMember(business, "dueno2@wifiplus.mx", "owner");
    expect((await call(OPERATOR, "/platform/settings")).status).toBe(200);
    const res = await call("dueno2@wifiplus.mx", "/platform/settings");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NOT_PLATFORM_OPERATOR");
    const me = await (await call("dueno2@wifiplus.mx", "/auth/me")).json();
    expect(me.data.platformOperator).toBe(false);
  });

  it("scenario 2: no rows → birth values; the top-up account reads as unset", async () => {
    await seedBusiness();
    const { data } = await (await call(OPERATOR, "/platform/settings")).json();
    const byKey = Object.fromEntries(data.settings.map((s: { key: string; current: string | null }) => [s.key, s.current]));
    expect(byKey).toMatchObject({
      validation_fee_cents: "500",
      welcome_bonus_validations: "20",
      negative_cap_cents: "5000",
      topup_min_cents: "5000",
      topup_clabe: null,
      default_fee_payer: "isp",
    });
    const credit = await (await call(OPERATOR, "/credit")).json();
    expect(credit.data.topUp).toBeNull();
  });

  it("scenario 3 + 4: a valid write appends with its author and shows in the history; bad values and unknown keys → 400", async () => {
    const business = await seedBusiness();
    const set = await call(OPERATOR, "/platform/settings/validation_fee_cents", json({ value: 300 }));
    expect(set.status).toBe(201);
    const db = drizzle(env.DB);
    const rows = await db.select().from(platformSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("300");

    const listed = await (await call(OPERATOR, "/platform/settings")).json();
    const fee = listed.data.settings.find((s: { key: string }) => s.key === "validation_fee_cents");
    expect(fee.current).toBe("300");
    expect(fee.history).toHaveLength(1);

    /* The next debit pays the new fee (prepaid-credit scenario 6) */
    await debitValidationFee(opEnv(), db, await seedConfirmedPayment(business));
    const [entry] = await db.select().from(creditEntries);
    expect(entry.cents).toBe(-300);

    expect((await call(OPERATOR, "/platform/settings/validation_fee_cents", json({ value: 50 }))).status).toBe(400);
    expect((await call(OPERATOR, "/platform/settings/retry_schedule", json({ value: 1 }))).status).toBe(400);
  });

  it("scenario 5: the top-up bank is a pick from the catalog", async () => {
    await seedBusiness();
    expect((await call(OPERATOR, "/platform/settings/topup_bank", json({ value: "Banco Inventado" }))).status).toBe(400);
    expect((await call(OPERATOR, "/platform/settings/topup_bank", json({ value: "STP" }))).status).toBe(201);
    expect((await call(OPERATOR, "/platform/settings/topup_clabe", json({ value: "646180157000000004" }))).status).toBe(201);
    const credit = await (await call(OPERATOR, "/credit")).json();
    expect(credit.data.topUp).toEqual({ clabe: "646180157000000004", bank: "STP", beneficiary: null });
  });

  it("scenario 6: an adjustment lands with reason and author; a short reason is refused", async () => {
    const business = await seedBusiness();
    const ok = await call(OPERATOR, `/platform/businesses/${business.id}/adjustments`, json({ cents: 2000, reason: "Cortesía piloto: doble cobro del 30/08" }));
    expect(ok.status).toBe(201);
    const db = drizzle(env.DB);
    const [row] = await db.select().from(creditEntries);
    expect(row).toMatchObject({ kind: "adjustment", cents: 2000, reason: "Cortesía piloto: doble cobro del 30/08" });
    expect(row.authorUserId).toBeTruthy();
    expect((await call(OPERATOR, `/platform/businesses/${business.id}/adjustments`, json({ cents: 100, reason: "corto" }))).status).toBe(400);
    const entries = await (await call(OPERATOR, "/credit/entries")).json();
    expect(entries.data.entries[0]).toMatchObject({ kind: "adjustment", reason: "Cortesía piloto: doble cobro del 30/08" });
  });

  it("scenario 7 + 8: the override is set and cleared from the panel; the map finds by name and email with the SUM", async () => {
    const business = await seedBusiness();
    const db = drizzle(env.DB);
    await grantWelcomeBonus(db, business, await userIdOf(OPERATOR));

    const patched = await call(OPERATOR, `/platform/businesses/${business.id}`, { method: "PATCH", body: JSON.stringify({ feeOverrideCents: 300 }) });
    expect((await patched.json()).data.feeCents).toBe(300);
    const [b] = await db.select().from(businesses).where(eq(businesses.id, business.id));
    expect(b.feeOverrideCents).toBe(300);
    await call(OPERATOR, `/platform/businesses/${business.id}`, { method: "PATCH", body: JSON.stringify({ feeOverrideCents: null }) });

    const list = await (await call(OPERATOR, "/platform/businesses?q=demo")).json();
    expect(list.data.businesses).toHaveLength(1);
    expect(list.data.businesses[0]).toMatchObject({ id: business.id, balanceCents: 10000, feeCents: 500, step: "ok" });
    const byEmail = await (await call(OPERATOR, "/platform/businesses?q=devolada.app")).json();
    expect(byEmail.data.businesses).toHaveLength(1);
  });
});
