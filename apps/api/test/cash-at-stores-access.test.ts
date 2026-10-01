import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { organization, session as sessionTable, stores, user as userTable } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { app, json, PASSWORD, seedBusiness, sessionCookieHeader, sessionOf } from "./helpers";
import { seedActiveStore, seedStore, seedStoreChannel, storeSession } from "./store-helpers";

/* cash-at-stores US3 (T014, T041) — the shopkeeper is a second kind of
   actor (D2): refused by every business door, resolved by its own row on
   every request, signed in by phone through the username plugin, which
   only the acceptance route may write (D3). The M1 measurements of
   quickstart §0 are the first describe: they decide D3 and D5. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const db = () => drizzle(env.DB);
const call = async (path: string, init: RequestInit = {}, e: unknown = env) => (await app()).request(path, init, e as typeof env);
const withCookie = (cookie: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), Cookie: cookie, Origin: "http://localhost:5177" },
});

describe("cash-at-stores US3 — M1: the username plugin on a local D1 (D3, D5)", () => {
  it("a user whose username was written in the DB signs in by phone with POST /auth/sign-in/username", async () => {
    const { store, email } = await seedActiveStore({ phone: "5512345678" });
    const res = await call("/auth/sign-in/username", json({ username: store.phone, password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(sessionOf(res)).toContain("better-auth.session_token=");
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe(email);

    /* and the session it opened is the store's */
    const me = await call("/auth/me", withCookie(sessionOf(res)));
    expect(me.status).toBe(200);
    expect((await me.json()).data).toMatchObject({ type: "store", storeId: store.id });
  });

  it("the same user, unverified, gets 403 EMAIL_NOT_VERIFIED — requireEmailVerification holds on this door", async () => {
    const { store, userId } = await seedActiveStore({ phone: "5512345678" });
    await db().update(userTable).set({ emailVerified: false }).where(eq(userTable.id, userId));
    const res = await call("/auth/sign-in/username", json({ username: store.phone, password: PASSWORD }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("a wrong password answers the plugin's generic refusal, never which half was wrong", async () => {
    const { store } = await seedActiveStore({ phone: "5512345678" });
    const res = await call("/auth/sign-in/username", json({ username: store.phone, password: "otra-cosa-123" }));
    expect(res.status).toBe(401);
    const unknown = await call("/auth/sign-in/username", json({ username: "5599999999", password: PASSWORD }));
    expect(unknown.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe(((await unknown.json()) as { code: string }).code);
  });

  it("POST /auth/sign-up/email with a username is refused, and no user is born", async () => {
    const res = await call(
      "/auth/sign-up/email",
      json({ name: "Intruso", email: "intruso@correo.mx", password: PASSWORD, username: "5512345678" }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("USERNAME_NOT_ALLOWED");
    expect(await db().select().from(userTable).where(eq(userTable.email, "intruso@correo.mx"))).toHaveLength(0);
  });

  it("a displayUsername on sign-up is refused too — the plugin would copy it into username (measured)", async () => {
    const res = await call(
      "/auth/sign-up/email",
      json({ name: "Intruso", email: "intruso@correo.mx", password: PASSWORD, displayUsername: "5512345678" }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("USERNAME_NOT_ALLOWED");
  });

  it("POST /auth/update-user {username} is refused for a signed-in user", async () => {
    await seedBusiness();
    const cookie = await sessionCookieHeader("demo@devolada.app");
    const res = await call("/auth/update-user", withCookie(cookie, json({ username: "5512345678" })));
    expect(res.status).toBe(400);
    const [owner] = await db().select().from(userTable).where(eq(userTable.email, "demo@devolada.app"));
    expect(owner.username).toBeNull();
  });

  it("a third door the plan did not name: /auth/sign-in/email-otp refuses a username in its body (measured)", async () => {
    const res = await call(
      "/auth/sign-in/email-otp",
      json({ email: "intruso@correo.mx", otp: "123456", username: "5512345678" }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("USERNAME_NOT_ALLOWED");
  });

  it("whether a phone is a store's is nobody's to probe: /auth/is-username-available is off", async () => {
    const res = await call("/auth/is-username-available", json({ username: "5512345678" }));
    expect(res.status).toBe(404);
  });
});

describe("cash-at-stores US3 — a store's account opens no business door (D2, FR-013)", () => {
  it("a shopkeeper gets WRONG_ACTOR on the feed, on POST /businesses, and cannot create an organization", async () => {
    const { headers } = await seedActiveStore();
    const feed = await call("/payments/feed", { headers });
    expect(feed.status).toBe(403);
    expect((await feed.json()).error.code).toBe("WRONG_ACTOR");

    const create = await call("/businesses", withCookie(headers.Cookie, json({ name: "Mi negocio", timezone: "America/Mexico_City" })));
    expect(create.status).toBe(403);
    expect((await create.json()).error.code).toBe("WRONG_ACTOR");

    /* Better Auth's own door answers in its own words (constitution III's
       exemption); what matters is that nothing was created */
    const org = await call("/auth/organization/create", withCookie(headers.Cookie, json({ name: "Mi negocio", slug: "mi-negocio-x" })));
    expect(org.status).toBe(403);
    expect(await db().select().from(organization).where(eq(organization.slug, "mi-negocio-x"))).toHaveLength(0);
  });

  it("a shopkeeper is never a platform operator, even with an email in PLATFORM_OPERATOR_EMAILS", async () => {
    const { headers, email } = await seedActiveStore();
    const operatorEnv = { ...(env as unknown as Bindings), PLATFORM_OPERATOR_EMAILS: email };
    const res = await call("/platform/settings", { headers }, operatorEnv);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("WRONG_ACTOR");
  });

  it("a business member gets WRONG_ACTOR on a store route", async () => {
    await seedBusiness();
    const res = await call("/store/customers?q=lupe", { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("WRONG_ACTOR");
  });

  it("no session is AUTHENTICATION_ERROR on a store route", async () => {
    const res = await call("/store/customers?q=lupe");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTHENTICATION_ERROR");
  });
});

describe("cash-at-stores US3 — the store's own row decides, on every request (D2, FR-014)", () => {
  it("/auth/me answers the store branch: the store and the business with the channel on", async () => {
    const business = await seedBusiness({ name: "WiFi Plus" });
    const { store, headers } = await seedActiveStore();
    const before = await call("/auth/me", { headers });
    expect((await before.json()).data).toEqual({ type: "store", storeId: store.id, name: store.name, businessName: null });

    await seedStoreChannel(business);
    const after = await call("/auth/me", { headers });
    expect((await after.json()).data).toEqual({ type: "store", storeId: store.id, name: store.name, businessName: "WiFi Plus" });
  });

  it("a suspended store gets STORE_SUSPENDED and its session row is gone", async () => {
    const { store, userId, headers } = await seedActiveStore();
    await db().update(stores).set({ status: "suspended" }).where(eq(stores.id, store.id));
    const res = await call("/store/customers?q=lupe", { headers });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("STORE_SUSPENDED");
    expect(await db().select().from(sessionTable).where(eq(sessionTable.userId, userId))).toHaveLength(0);
    /* the next request has no session at all */
    expect((await call("/auth/me", { headers })).status).toBe(401);
  });

  it("an invited store's user (between the acceptance's two writes) is the wrong actor, not a business", async () => {
    const store = await seedStore({ status: "invited" });
    const { cookie } = await storeSession(store, { activate: false });
    const res = await call("/auth/me", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("WRONG_ACTOR");
  });

  it("the business branch carries storeChannel, set once and kept after the switch goes off (D7, D23)", async () => {
    const business = await seedBusiness();
    const asOwner = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };
    expect((await (await call("/auth/me", asOwner)).json()).data.storeChannel).toEqual({ on: false, since: null });
    const at = new Date("2026-10-01T15:00:00Z");
    await seedStoreChannel(business, at);
    expect((await (await call("/auth/me", asOwner)).json()).data.storeChannel).toEqual({ on: true, since: at.getTime() });
  });
});
