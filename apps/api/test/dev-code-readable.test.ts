import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { invitation, user, verification } from "../src/db/schema";
import { app, json, mintCode, seedBusiness } from "./helpers";

/* bug: dev-code-readable — the deployed dev Worker answers /dev/* too, and
   /dev/last-code handed out any account's código (every account's latest,
   with no address at all); /dev/last-invitation, any pending invitation's
   id. Both now answer only for a test address — `.invalid`, or the demo
   account — and refuse the rest before a row is read.

   passwordless-access US2 (D14): códigos are stored hashed, so there are no
   digits to read back; `/dev/last-code` retired and `POST /dev/code` mints a
   fresh one instead, under the same rule. */

const get = async (path: string) => (await app()).request(path, {}, env);
const devCode = async (body: unknown) => (await app()).request("/dev/code", json(body), env);
const enter = async (email: string, otp: string) =>
  (await app()).request("/auth/sign-in/email-otp", json({ email, otp, name: "Prueba" }), env);

const REFUSED = { success: false, error: { code: "TEST_ADDRESS_ONLY" } };

describe("bug: dev-code-readable — /dev/code mints only for a test address (passwordless-access US2)", () => {
  it("refuses a real address, and its live código is left as it was", async () => {
    const live = await mintCode("ana@negocio.mx");
    const res = await devCode({ email: "ana@negocio.mx", type: "sign-in" });
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual(REFUSED);
    expect(body).not.toContain(live);
    expect(await drizzle(env.DB).select().from(verification).where(eq(verification.identifier, "sign-in-otp-ana@negocio.mx"))).toHaveLength(1);
    expect((await enter("ana@negocio.mx", live)).status).toBe(200);
  });

  it("refuses a missing or blank address instead of minting for anyone", async () => {
    for (const body of [{}, { email: "" }, { email: "   " }]) {
      const res = await devCode({ ...body, type: "sign-in" });
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(await res.json()).toEqual(REFUSED);
    }
    expect(await drizzle(env.DB).select().from(verification)).toHaveLength(0);
  });

  it("matches the address whole: `.invalid` inside a real address never reaches its account", async () => {
    const real = await mintCode("ana.invalid@gmail.com");
    const res = await devCode({ email: "ana.invalid", type: "sign-in" });
    expect(res.status).toBe(200);
    const minted = ((await res.json()) as { data: { code: string } }).data.code;
    if (minted !== real) expect((await enter("ana.invalid@gmail.com", minted)).status).toBe(400);
    /* the real address's own código was never touched */
    expect((await enter("ana.invalid@gmail.com", real)).status).toBe(200);
  });

  it("still mints for a `.invalid` address and the demo account's, as the passkey journeys do", async () => {
    const verify = await devCode({ email: "owner@journey.invalid", type: "email-verification" });
    expect(((await verify.json()) as { data: { code: string } }).data.code).toMatch(/^\d{6}$/);
    /* typed in any case: the plugin keys the address lowercased */
    const demo = await devCode({ email: "Demo@Devolada.app", type: "sign-in" });
    const otp = ((await demo.json()) as { data: { code: string } }).data.code;
    expect((await enter("demo@devolada.app", otp)).status).toBe(200);
  });

  it("GET /dev/last-code is gone", async () => {
    expect((await get("/dev/last-code?email=owner%40journey.invalid")).status).toBe(404);
  });
});

describe("bug: dev-code-readable — /dev/last-invitation answers only for a test address", () => {
  it("refuses a real invitee's address and answers a `.invalid` one's invitation id", async () => {
    const business = await seedBusiness({ email: "dueno@negocio.mx" });
    const db = drizzle(env.DB);
    const [owner] = await db.select().from(user).where(eq(user.email, "dueno@negocio.mx"));
    const now = new Date();
    const invite = (id: string, email: string) =>
      db.insert(invitation).values({
        id,
        organizationId: business.orgId,
        email,
        role: "operator",
        status: "pending",
        expiresAt: new Date(now.getTime() + 2 * 86_400_000),
        createdAt: now,
        inviterId: owner.id,
      });
    await invite("inv-real", "luis@negocio.mx");
    await invite("inv-test", "luis@journey.invalid");

    const real = await get("/dev/last-invitation?email=luis%40negocio.mx");
    expect(real.status).toBe(403);
    const body = await real.text();
    expect(JSON.parse(body)).toEqual(REFUSED);
    expect(body).not.toContain("inv-real");

    expect(await (await get("/dev/last-invitation?email=luis%40journey.invalid")).json()).toEqual({ success: true, data: { id: "inv-test" } });
  });
});
