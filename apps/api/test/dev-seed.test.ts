import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, cepBundles, cepRecords, member } from "../src/db/schema";
import { makeAuth } from "../src/auth/better";
import { listCredentials } from "../src/api-clients/store";
import type { Bindings } from "../src/env";
import { app, cookiesOf, json, PASSWORD } from "./helpers";
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
   owner membership (business-and-memberships D1/D7 shape), idempotent. */

describe("dev seed creates the demo business with its owner", () => {
  it("US-B02: the demo owner signs in and lands in the demo business", async () => {
    const seed = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(seed.status).toBe(200);

    const db = drizzle(env.DB);
    const [business] = await db.select().from(businesses).where(eq(businesses.email, "demo@devolada.app"));
    const [owner] = await db.select().from(member).where(eq(member.organizationId, business.orgId));
    expect(owner.role).toBe("owner");

    const login = await (await app()).request(
      "/auth/sign-in/email",
      json({ email: "demo@devolada.app", password: PASSWORD }),
      env,
    );
    expect(login.status).toBe(200);
    const cookie = cookiesOf(login)
      .find((c) => c.includes("session_token"))!
      .split(";")[0];
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

  it("marries an orphan user to the demo business, keeping the user's password", async () => {
    /* The deployed-dev case of 2026-08-15: a Better Auth user with the demo
       email and no business (left by a failed signup). The seed must give
       it the business; the password the user set keeps working. */
    const auth = makeAuth(env as unknown as Bindings);
    await auth.api.signUpEmail({
      body: { name: "Leo", email: "demo@devolada.app", password: "clave-recuperada-1" },
    });

    const seed = await (await app()).request("/dev/seed", { method: "POST" }, env);
    expect(seed.status).toBe(200);

    const login = await (await app()).request(
      "/auth/sign-in/email",
      json({ email: "demo@devolada.app", password: "clave-recuperada-1" }),
      env,
    );
    expect(login.status).toBe(200);
    const cookie = cookiesOf(login)
      .find((c) => c.includes("session_token"))!
      .split(";")[0];
    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(200);
    expect((await me.json()).data).toMatchObject({ type: "business", role: "owner" });
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
