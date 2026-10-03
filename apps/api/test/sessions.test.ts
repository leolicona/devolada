import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, session as sessionTable, user as userTable } from "../src/db/schema";
import { app, cookiesOf, json, mintCode, seedBusiness, seedSession, sessionCookieHeader, sessionOf } from "./helpers";

/* docs/legacy/auth/sessions.spec.md scenarios, rewritten for Better Auth
   (better-auth.spec.md D5): sessions live in our D1, no IdP to mock.
   The store-login scenarios retired with the store network
   (devolada-red); the ISP is the only credentialed actor now.

   passwordless-access US2: the sign-in is a código (D1). The wrong-password
   and unknown-email cases left with the password door (their absence is
   passwordless-sign-in.test.ts's 404), and "a reset revokes live sessions"
   is `revoke-other-sessions` now (passwordless-keys-sessions.test.ts). */

describe("US-S04: the ISP signs in", () => {
  it("a sign-in código returns 200 and resolves the ISP actor (passwordless-access US2)", async () => {
    await seedBusiness();

    const res = await (await app()).request(
      "/auth/sign-in/email-otp",
      json({ email: "demo@devolada.app", otp: await mintCode("demo@devolada.app") }),
      env,
    );
    expect(res.status).toBe(200);

    const me = await (await app()).request(
      "/auth/me",
      { headers: { Cookie: sessionOf(res) } },
      env,
    );
    expect((await me.json()).data).toMatchObject({ type: "business", emailVerified: true });
  });

  it("an unverified user holds no session: the row is revoked and the answer is 403 EMAIL_NOT_VERIFIED (better-auth D16)", async () => {
    await seedBusiness({ emailVerified: false });
    const cookie = await sessionCookieHeader("demo@devolada.app");
    const res = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("EMAIL_NOT_VERIFIED");
    const again = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(again.status).toBe(401);
  });
});

describe("US-S02: the session survives without visible expiry", () => {
  it("the same cookie works across requests", async () => {
    await seedBusiness();
    const cookie = await sessionCookieHeader("demo@devolada.app");

    for (let i = 0; i < 2; i++) {
      const res = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
      expect(res.status).toBe(200);
    }
  });

  it("BUG-015: after a day of use the window slides in the row AND in the browser's cookie (scenario 17)", async () => {
    const business = await seedBusiness();
    const [owner] = await drizzle(env.DB).select().from(userTable);
    /* Two days old: past `updateAge`, so this request refreshes */
    await seedSession(owner.id, "aged@devolada.app", business.orgId, { ageDays: 2 });
    const cookie = await sessionCookieHeader("aged@devolada.app");

    const res = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const reissued = cookiesOf(res).find((c) => c.includes("session_token="));
    expect(reissued).toBeDefined();
    expect(reissued).toMatch(/Max-Age=2592000/);

    const [row] = await drizzle(env.DB).select().from(sessionTable).where(eq(sessionTable.userId, owner.id));
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);

    /* A fresh row (under a day) is left alone: no cookie churn per request */
    await seedSession(owner.id, "fresh@devolada.app", business.orgId);
    const quiet = await (await app()).request("/auth/me", { headers: { Cookie: await sessionCookieHeader("fresh@devolada.app") } }, env);
    expect(quiet.status).toBe(200);
    expect(cookiesOf(quiet).find((c) => c.includes("session_token="))).toBeUndefined();
  });

  it("/auth/me without a session returns 401", async () => {
    const res = await (await app()).request("/auth/me", {}, env);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTHENTICATION_ERROR");
  });

  it("a tampered session cookie returns 401", async () => {
    await seedBusiness();
    const cookie = await sessionCookieHeader("demo@devolada.app");
    /* Flip a character inside the signed value */
    const tampered = cookie.slice(0, -4) + (cookie.endsWith("A") ? "B" : "A") + cookie.slice(-3);

    const res = await (await app()).request("/auth/me", { headers: { Cookie: tampered } }, env);
    expect(res.status).toBe(401);
  });
});

describe("US-S02/sessions rule 2: suspension revokes access immediately", () => {
  it("a suspended ISP with a live session gets 403 and the session row dies", async () => {
    const business = await seedBusiness();
    const db = drizzle(env.DB);
    const cookie = await sessionCookieHeader("demo@devolada.app");
    await db.update(businesses).set({ status: "suspended" }).where(eq(businesses.id, business.id));

    const res = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("ACCOUNT_SUSPENDED");

    /* Server-side revocation (spec D5): the session row is gone, so the
       same cookie now fails as unauthenticated, not merely suspended */
    const again = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(again.status).toBe(401);
  });

  it("sign-out kills the session", async () => {
    await seedBusiness();
    const cookie = await sessionCookieHeader("demo@devolada.app");

    const out = await (await app()).request(
      "/auth/sign-out",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          /* A browser always sends Origin on POST; Better Auth checks it
             against trustedOrigins */
          Origin: "http://localhost:5174",
        },
      },
      env,
    );
    expect(out.status).toBe(200);

    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(401);
  });
});
