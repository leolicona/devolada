import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { invitation, user, verification } from "../src/db/schema";
import { app, seedBusiness } from "./helpers";

/* bug: dev-code-readable — the deployed dev Worker answers /dev/* too, and
   /dev/last-code handed out any account's código (every account's latest,
   with no address at all); /dev/last-invitation, any pending invitation's
   id. Both now answer only for a test address — `.invalid`, or the demo
   account — and refuse the rest before a row is read. */

const get = async (path: string) => (await app()).request(path, {}, env);

/* A código as Better Auth's email-OTP plugin stores it: `<type>-otp-<email>`,
   the code then the attempts (1.6.29, plain until passwordless-access D2) */
async function storeCode(identifier: string, code: string) {
  const now = new Date();
  await drizzle(env.DB)
    .insert(verification)
    .values({ id: crypto.randomUUID(), identifier, value: `${code}:0`, expiresAt: new Date(now.getTime() + 600_000), createdAt: now, updatedAt: now });
}

const REFUSED = { success: false, error: { code: "TEST_ADDRESS_ONLY" } };

describe("bug: dev-code-readable — /dev/last-code answers only for a test address", () => {
  it("refuses a real address, and no digit of its código leaves", async () => {
    await storeCode("sign-in-otp-ana@negocio.mx", "482913");
    const res = await get("/dev/last-code?email=ana%40negocio.mx");
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual(REFUSED);
    expect(body).not.toContain("482913");
  });

  it("refuses a missing or blank address instead of answering anyone's latest código", async () => {
    await storeCode("sign-in-otp-ana@negocio.mx", "482913");
    for (const path of ["/dev/last-code", "/dev/last-code?email=", "/dev/last-code?email=%20"]) {
      const res = await get(path);
      expect(res.status, path).toBe(403);
      expect(await res.text(), path).not.toContain("482913");
    }
  });

  it("matches the address whole: `.invalid` inside a real address never reaches its código", async () => {
    await storeCode("sign-in-otp-ana.invalid@gmail.com", "271828");
    await storeCode("sign-in-otp-bowner@journey.invalid", "141421");
    for (const email of ["ana.invalid", "owner@journey.invalid"]) {
      const res = await get(`/dev/last-code?email=${encodeURIComponent(email)}`);
      expect(res.status, email).toBe(200);
      const body = await res.text();
      expect(JSON.parse(body), email).toEqual({ success: true, data: { code: null } });
      expect(body, email).not.toMatch(/271828|141421/);
    }
  });

  it("still reads a `.invalid` address's código and the demo account's, as the passkey journeys do", async () => {
    await storeCode("email-verification-otp-owner@journey.invalid", "314159");
    await storeCode("sign-in-otp-demo@devolada.app", "161803");
    expect(await (await get("/dev/last-code?email=owner%40journey.invalid")).json()).toEqual({ success: true, data: { code: "314159" } });
    /* typed in any case: the plugin stores the address lowercased */
    expect(await (await get("/dev/last-code?email=Demo%40Devolada.app")).json()).toEqual({ success: true, data: { code: "161803" } });
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
