import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { session as sessionTable, stores } from "../src/db/schema";
import {
  app,
  cookiesOf,
  json,
  seedIsp,
  seedStore,
  sessionCookieHeader,
  sessionOf,
  PASSWORD,
} from "./helpers";

/* docs/auth/sessions.spec.md scenarios, rewritten for Better Auth
   (better-auth.spec.md D5): sessions live in our D1, no IdP to mock. */

describe("US-S01: store and admin log in with credentials", () => {
  it("valid store login (phone as username) returns 200 with a session cookie", async () => {
    const isp = await seedIsp();
    await seedStore(isp.id);

    const res = await (await app()).request(
      "/auth/sign-in/username",
      json({ username: "5512345678", password: PASSWORD }),
      env,
    );
    expect(res.status).toBe(200);
    const cookie = sessionOf(res);

    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(200);
    expect((await me.json()).data).toMatchObject({ type: "store", phone: "5512345678" });
  });

  it("valid admin login (email) returns 200 and resolves the ISP actor", async () => {
    await seedIsp();

    const res = await (await app()).request(
      "/auth/sign-in/email",
      json({ email: "demo@devolada.app", password: PASSWORD }),
      env,
    );
    expect(res.status).toBe(200);

    const me = await (await app()).request(
      "/auth/me",
      { headers: { Cookie: sessionOf(res) } },
      env,
    );
    expect((await me.json()).data).toMatchObject({ type: "isp", emailVerified: true });
  });

  it("the ISP actor from /auth/me includes emailVerified", async () => {
    await seedIsp({ emailVerified: false });
    const res = await (await app()).request(
      "/auth/me",
      { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } },
      env,
    );
    expect((await res.json()).data).toMatchObject({ type: "isp", emailVerified: false });
  });

  it("wrong password returns 401 with no session cookie", async () => {
    const isp = await seedIsp();
    await seedStore(isp.id);

    const res = await (await app()).request(
      "/auth/sign-in/username",
      json({ username: "5512345678", password: "wrong-pass-1" }),
      env,
    );
    expect(res.status).toBe(401);
    expect(cookiesOf(res).find((c) => c.includes("session_token="))).toBeUndefined();
  });

  it("unknown phone answers exactly like a wrong password (no existence leak)", async () => {
    const res = await (await app()).request(
      "/auth/sign-in/username",
      json({ username: "5599999999", password: "wrong-pass-1" }),
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe("US-S02: the session survives without visible expiry", () => {
  it("the same cookie works across requests", async () => {
    const isp = await seedIsp();
    await seedStore(isp.id);
    const cookie = await sessionCookieHeader("5512345678");

    for (let i = 0; i < 2; i++) {
      const res = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
      expect(res.status).toBe(200);
    }
  });

  it("/auth/me without a session returns 401", async () => {
    const res = await (await app()).request("/auth/me", {}, env);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTHENTICATION_ERROR");
  });

  it("a tampered session cookie returns 401", async () => {
    const isp = await seedIsp();
    await seedStore(isp.id);
    const cookie = await sessionCookieHeader("5512345678");
    /* Flip a character inside the signed value */
    const tampered = cookie.slice(0, -4) + (cookie.endsWith("A") ? "B" : "A") + cookie.slice(-3);

    const res = await (await app()).request("/auth/me", { headers: { Cookie: tampered } }, env);
    expect(res.status).toBe(401);
  });
});

describe("US-S03: suspension revokes access immediately", () => {
  it("a suspended store with a live session gets 403 and the session row dies", async () => {
    const isp = await seedIsp();
    const store = await seedStore(isp.id);
    const db = drizzle(env.DB);
    await db.update(stores).set({ status: "suspended" }).where(eq(stores.id, store.id));

    const cookie = await sessionCookieHeader("5512345678");
    const res = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("ACCOUNT_SUSPENDED");

    /* Server-side revocation (spec D5): the session row is gone, so the
       same cookie now fails as unauthenticated, not merely suspended */
    const again = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(again.status).toBe(401);
    const rows = await db.select().from(sessionTable);
    expect(rows.find((r) => r.token.includes("5512345678"))).toBeUndefined();
  });

  it("sign-out kills the session", async () => {
    await seedIsp();
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
