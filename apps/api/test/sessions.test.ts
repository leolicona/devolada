import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { stores } from "../src/db/schema";
import {
  app,
  cookiesOf,
  idpError,
  idpTokens,
  makeJwt,
  mockIdp,
  seedIsp,
  seedStore,
  sessionCookieHeader,
} from "./helpers";

/* Retroactive coverage of docs/auth/sessions.spec.md scenarios 1–8,
   originally verified with curl (TD-005). */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("US-S01: store and admin log in with credentials", () => {
  it("valid store login returns 200 with session cookies", async () => {
    const isp = await seedIsp();
    await seedStore(isp.id);
    mockIdp("/auth/verify-password", { body: { success: true, data: idpTokens("5512345678") } });

    const res = await (await app()).request(
      "/auth/store/login",
      json({ phone: "5512345678", password: "devolada123" }),
      env,
    );
    expect(res.status).toBe(200);
    const cookies = cookiesOf(res).join(";");
    expect(cookies).toContain("gm_access=");
    expect(cookies).toContain("gm_refresh=");
    expect((await res.json()).data.type).toBe("store");
  });

  it("the ISP actor from /auth/me includes emailVerified", async () => {
    await seedIsp({ emailVerified: false });
    const res = await (await app()).request(
      "/auth/me",
      { headers: { Cookie: sessionCookieHeader("demo@devolada.app") } },
      env,
    );
    expect((await res.json()).data).toMatchObject({ type: "isp", emailVerified: false });
  });

  it("valid admin login returns 200 with session cookies", async () => {
    await seedIsp();
    mockIdp("/auth/verify-password", {
      body: { success: true, data: idpTokens("demo@devolada.app") },
    });

    const res = await (await app()).request(
      "/auth/admin/login",
      json({ email: "demo@devolada.app", password: "devolada123" }),
      env,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.type).toBe("isp");
  });

  it("wrong password returns a generic 401", async () => {
    const isp = await seedIsp();
    await seedStore(isp.id);
    mockIdp("/auth/verify-password", {
      status: 401,
      body: idpError("AUTHENTICATION_ERROR"),
    });

    const res = await (await app()).request(
      "/auth/store/login",
      json({ phone: "5512345678", password: "wrong-pass-1" }),
      env,
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTHENTICATION_ERROR");
  });

  it("malformed payload returns 400", async () => {
    const res = await (await app()).request(
      "/auth/store/login",
      json({ phone: "55" }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("US-S02: sessions renew transparently", () => {
  it("/auth/me with a valid access cookie returns the actor", async () => {
    const isp = await seedIsp();
    await seedStore(isp.id);

    const res = await (await app()).request(
      "/auth/me",
      { headers: { Cookie: sessionCookieHeader("5512345678") } },
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ type: "store", phone: "5512345678", status: "active" });
  });

  it("/auth/me without a session returns 401", async () => {
    const res = await (await app()).request("/auth/me", {}, env);
    expect(res.status).toBe(401);
  });

  it("refresh-only cookie renews tokens within the same request", async () => {
    const isp = await seedIsp();
    await seedStore(isp.id);
    mockIdp("/auth/refresh", { body: { success: true, data: idpTokens("5512345678") } });

    const res = await (await app()).request(
      "/auth/me",
      { headers: { Cookie: "gm_refresh=rt-old" } },
      env,
    );
    expect(res.status).toBe(200);
    expect(cookiesOf(res).join(";")).toContain("gm_access=");
  });

  it("expired access with an invalid refresh returns 401", async () => {
    const isp = await seedIsp();
    await seedStore(isp.id);
    const expired = makeJwt({ identity: "5512345678", exp: 1 });
    mockIdp("/auth/refresh", { status: 401, body: idpError("AUTHENTICATION_ERROR") });

    const res = await (await app()).request(
      "/auth/me",
      { headers: { Cookie: `gm_access=${expired}; gm_refresh=rt-revoked` } },
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe("US-S03: suspension revokes access immediately", () => {
  it("a suspended store with a live session gets 403 ACCOUNT_SUSPENDED", async () => {
    const isp = await seedIsp();
    const store = await seedStore(isp.id);
    const db = drizzle(env.DB);
    await db.update(stores).set({ status: "suspended" }).where(eq(stores.id, store.id));

    const res = await (await app()).request(
      "/auth/me",
      { headers: { Cookie: sessionCookieHeader("5512345678") } },
      env,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("logout revokes the refresh token and clears cookies", async () => {
    mockIdp("/auth/token/revoke", { body: { success: true, data: {} } });

    const res = await (await app()).request(
      "/auth/logout",
      { method: "POST", headers: { Cookie: "gm_refresh=rt-x" } },
      env,
    );
    expect(res.status).toBe(200);
    const cleared = cookiesOf(res).join(";");
    expect(cleared).toContain("gm_access=;");
    expect(cleared).toContain("gm_refresh=;");
  });
});
