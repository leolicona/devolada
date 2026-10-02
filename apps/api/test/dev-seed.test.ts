import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { account, businesses, cepBundles, cepRecords, member, user as userTable } from "../src/db/schema";
import { listCredentials } from "../src/api-clients/store";
import type { Bindings } from "../src/env";
import { app, json, seedLegacyUser, sessionOf } from "./helpers";
import {
  buildBundleZip,
  bundleOf,
  entryName,
  SENDER_4417,
  SENDER_8301,
  SYNTHETIC,
  transferPdf,
  type SyntheticTransfer,
} from "./consta/bundle-fixtures";
// @ts-expect-error — the sandbox is plain JS for bare node, with no types
import { sandboxBundle } from "../sandbox/cep-bundle.mjs";

/* The dev seed (CLAUDE.md): a demo business with its auth twin and an
   owner membership (business-and-memberships D1/D7 shape), idempotent.

   passwordless-access US2 (D14, D16): the demo holds no password. It
   signs in with a código from `POST /dev/code`, which mints only for a
   test address (bug: dev-code-readable). */

const devCode = async (body: unknown, bindings: unknown = env) =>
  (await app()).request("/dev/code", json(body), bindings as typeof env);
const codeIn = async (res: Response) => ((await res.json()) as { data: { code: string } }).data.code;

describe("dev seed creates the demo business with its owner", () => {
  it("passwordless-access US2: the demo owner is born verified, without a password, and a /dev/code código lands them in the demo business", async () => {
    const seed = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(seed.status).toBe(200);
    expect((await seed.json()).data.admin).toEqual({ email: "demo@devolada.app" });

    const db = drizzle(env.DB);
    const [business] = await db.select().from(businesses).where(eq(businesses.email, "demo@devolada.app"));
    const [owner] = await db.select().from(member).where(eq(member.organizationId, business.orgId));
    expect(owner.role).toBe("owner");
    const [user] = await db.select().from(userTable).where(eq(userTable.email, "demo@devolada.app"));
    expect(user).toMatchObject({ emailVerified: true, name: "ISP Demo" });
    expect(await db.select().from(account).where(eq(account.userId, user.id))).toHaveLength(0);

    const minted = await devCode({ email: "demo@devolada.app", type: "sign-in" });
    expect(minted.status).toBe(200);
    const login = await (await app()).request(
      "/auth/sign-in/email-otp",
      json({ email: "demo@devolada.app", otp: await codeIn(minted) }),
      env,
    );
    expect(login.status).toBe(200);
    const cookie = sessionOf(login);
    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(200);
    expect((await me.json()).data).toMatchObject({ type: "business", id: business.id, role: "owner" });

    /* And running it again stays idempotent */
    const again = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(again.status).toBe(200);
    expect(await db.select().from(businesses)).toHaveLength(1);
  });

  it("automated-collections-api T070: hands out a real and a test credential, fresh on every seed", async () => {
    const seed = async () =>
      ((await (await (await app()).request("/dev/seed", { method: "POST" }, env)).json()) as { data: { api: { key: string; testKey: string } } }).data.api;
    const v1 = async (key: string) =>
      (await app()).request("/v1/payment-links?customerRef=CLI-1", { headers: { Authorization: `Bearer ${key}` } }, env);

    const first = await seed();
    expect(first.key).toMatch(/^dk_[0-9a-f]{32}$/);
    expect(first.testKey).toMatch(/^dk_[0-9a-f]{32}$/);
    expect(first.key).not.toBe(first.testKey);
    expect((await v1(first.key)).status).toBe(200);
    expect((await v1(first.testKey)).status).toBe(200);

    /* the next seed replaces the pair: the old keys stop working, the demo holds one live pair */
    const second = await seed();
    expect((await v1(first.key)).status).toBe(401);
    expect((await v1(first.testKey)).status).toBe(401);
    expect((await v1(second.key)).status).toBe(200);
    expect((await v1(second.testKey)).status).toBe(200);
    const [business] = await drizzle(env.DB).select().from(businesses).where(eq(businesses.email, "demo@devolada.app"));
    /* and the business can collect: the quickstart's first link shows a CLABE */
    expect(business).toMatchObject({ speiClabe: "646180157000000004", speiBank: "STP" });
    const live = (await listCredentials(drizzle(env.DB), business.id)).filter((c) => c.revokedAt === null);
    expect(live.map((c) => [c.name, c.isTest]).sort()).toEqual([
      ["Demo (prueba)", true],
      ["Demo (real)", false],
    ]);
  });

  it("marries an orphan user to the demo business: verified, and holding no password (passwordless-access US2)", async () => {
    /* The deployed-dev case of 2026-08-15: a Better Auth user with the demo
       email and no business (left by a failed signup). The seed gives it
       the business; like every account now, it holds no password, and a
       código opens it. */
    await seedLegacyUser("Leo", "demo@devolada.app");

    const seed = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(seed.status).toBe(200);

    const db = drizzle(env.DB);
    const [user] = await db.select().from(userTable).where(eq(userTable.email, "demo@devolada.app"));
    expect(user.emailVerified).toBe(true);
    expect(await db.select().from(account).where(eq(account.userId, user.id))).toHaveLength(0);

    const login = await (await app()).request(
      "/auth/sign-in/email-otp",
      json({ email: "demo@devolada.app", otp: await codeIn(await devCode({ email: "demo@devolada.app" })) }),
      env,
    );
    expect(login.status).toBe(200);
    const me = await (await app()).request("/auth/me", { headers: { Cookie: sessionOf(login) } }, env);
    expect(me.status).toBe(200);
    expect((await me.json()).data).toMatchObject({ type: "business", role: "owner" });
  });
});

describe("passwordless-access US2 — POST /dev/code mints a código for a test address only (D14, D15)", () => {
  it("refuses a real address and a blank one with 403 TEST_ADDRESS_ONLY, and mints nothing", async () => {
    for (const email of ["ana@negocio.mx", "", "   "]) {
      const res = await devCode({ email, type: "sign-in" });
      expect(res.status, email).toBe(403);
      expect(await res.json(), email).toEqual({ success: false, error: { code: "TEST_ADDRESS_ONLY" } });
    }
    expect((await devCode({ type: "sign-in" })).status).toBe(403);
  });

  it("mints for a `.invalid` address and for the demo's, and each código works once", async () => {
    for (const email of ["x@journey.invalid", "demo@devolada.app"]) {
      const otp = await codeIn(await devCode({ email, type: "sign-in" }));
      expect(otp, email).toMatch(/^\d{6}$/);
      const enter = () => app().then((a) => a.request("/auth/sign-in/email-otp", json({ email, otp, name: "Prueba" }), env));
      expect((await enter()).status, email).toBe(200);
      expect((await enter()).status, email).toBe(400);
    }
  });

  it("a fresh código replaces the one before it", async () => {
    const first = await codeIn(await devCode({ email: "x@journey.invalid" }));
    let second = await codeIn(await devCode({ email: "x@journey.invalid" }));
    while (second === first) second = await codeIn(await devCode({ email: "x@journey.invalid" }));
    const enter = (otp: string) =>
      app().then((a) => a.request("/auth/sign-in/email-otp", json({ email: "x@journey.invalid", otp, name: "Prueba" }), env));
    expect((await enter(first)).status).toBe(400);
    expect((await enter(second)).status).toBe(200);
  });

  it("GET /dev/last-code is retired, and outside ENVIRONMENT=dev /dev/code does not exist", async () => {
    expect((await (await app()).request("/dev/last-code?email=x%40journey.invalid", {}, env)).status).toBe(404);
    const prod = await devCode({ email: "x@journey.invalid" }, { ...(env as unknown as Bindings), ENVIRONMENT: "prod" });
    expect(prod.status).toBe(404);
  });
});

/* cep-bundle-match T046 (quickstart Step 0): the creator runs their own
   bundles through the engine's reading before a release, and nothing of
   them stays behind */
describe("cep-bundle-match US1: /dev/cep-read reads a bundle as the engine would, and keeps nothing", () => {
  const t = (clave: string, creditTime: string, senderAccount: string): SyntheticTransfer => ({
    clave,
    operationDay: "2026-09-26",
    creditDay: "2026-09-26",
    creditTime,
    senderAccount,
    beneficiaryAccount: "012180000089784417",
    amount: "3.00",
  });
  const MINE = t("260926071199000041I", "07:11:20", SENDER_8301);
  const THEIRS = t("260926114099000042I", "11:40:47", SENDER_4417);
  const read = async (body: Uint8Array, bindings: Bindings = env as Bindings) =>
    (await app()).request("/dev/cep-read", { method: "POST", body, headers: { "Content-Type": "application/zip" } }, bindings);

  it("answers the records and the unreadable entries, by four digits, and stores nothing", async () => {
    const zip = buildBundleZip([
      { name: entryName(MINE.operationDay, MINE.clave), bytes: transferPdf(MINE) },
      { name: entryName(THEIRS.operationDay, THEIRS.clave), bytes: transferPdf(THEIRS) },
      { name: entryName("2026-09-26", "260926114099000043I"), bytes: transferPdf(t("260926114099000043I", "12:00:00", SENDER_4417), { omitLabel: "seal" }) },
    ]);
    const res = await read(zip);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data).toEqual({
      kind: "zip",
      records: [
        {
          clave: MINE.clave,
          operationDate: "2026-09-26",
          creditDate: "2026-09-26",
          creditTime: "07:11:20",
          amountCents: 300,
          senderBank: expect.any(String),
          senderAccountType: "40",
          senderTail: "3010",
          receiverAccountType: "40",
          receiverTail: "4417",
        },
        expect.objectContaining({ clave: THEIRS.clave, creditTime: "11:40:47", senderTail: "4171" }),
      ],
      unreadable: [{ entry: entryName("2026-09-26", "260926114099000043I"), reason: expect.any(String) }],
    });
    const text = JSON.stringify(data);
    for (const secret of [SENDER_8301, SENDER_4417, SYNTHETIC.senderName, SYNTHETIC.senderRfc]) expect(text).not.toContain(secret);
    const db = drizzle(env.DB);
    expect(await db.select().from(cepRecords)).toHaveLength(0);
    expect(await db.select().from(cepBundles)).toHaveLength(0);
  });

  it("the sandbox's bundle (T019) reads whole: its two transfers, nothing unreadable", async () => {
    const res = await read(sandboxBundle("2026-09-26"));
    const { data } = (await res.json()) as { data: { records: Record<string, unknown>[]; unreadable: unknown[] } };
    expect(data.records.map((r) => [r.creditTime, r.senderTail, r.amountCents])).toEqual([
      ["07:11:20", "3010", 300],
      ["11:40:47", "4171", 300],
    ]);
    expect(data.unreadable).toEqual([]);
  });

  it("anything else is NOT_A_BUNDLE; outside dev the route does not exist", async () => {
    expect((await read(new TextEncoder().encode("no es un zip"))).status).toBe(400);
    expect((await read(bundleOf([MINE]), { ...(env as Bindings), ENVIRONMENT: "prod" })).status).toBe(404);
  });
});
