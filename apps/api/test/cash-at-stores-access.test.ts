import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { organization, session as sessionTable, storeInvitations, stores, user as userTable } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { app, json, lastCodeFor, PASSWORD, seedBusiness, sessionCookieHeader, sessionOf } from "./helpers";
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

/* The operator's create, as the panel calls it, answering the plaintext
   link once — the only place a test can learn a token */
async function invite(phone = "5512345678") {
  await seedBusiness({ email: "operador@devolada.app" });
  const opEnv = { ...(env as unknown as Bindings), PLATFORM_OPERATOR_EMAILS: "operador@devolada.app" };
  const res = await (await app()).request(
    "/platform/stores",
    {
      ...json({ name: "Abarrotes Lupita", address: "Av. Juárez 12, Centro", shopkeeperName: "Lupita Hernández", phone }),
      headers: { "Content-Type": "application/json", Cookie: await sessionCookieHeader("operador@devolada.app") },
    },
    opEnv as unknown as typeof env,
  );
  const { data } = await res.json();
  return { store: data.store as { id: string }, token: (data.invitation.url as string).split("/invitacion/")[1] };
}

describe("cash-at-stores US3 — the invitation: preview, acceptance, the código (D4, D5, FR-009)", () => {
  it("the preview shows the store and the last four digits; anything else is `invalid`", async () => {
    const { token } = await invite();
    expect((await (await call(`/store/invitations/${token}`)).json()).data).toEqual({ state: "open", storeName: "Abarrotes Lupita", phoneTail: "5678" });
    expect((await (await call("/store/invitations/no-such-token")).json()).data).toEqual({ state: "invalid" });
  });

  it("an expired invitation reads `invalid`", async () => {
    const { token } = await invite();
    await db().update(storeInvitations).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await (await call(`/store/invitations/${token}`)).json()).data).toEqual({ state: "invalid" });
    const res = await call(`/store/invitations/${token}/accept`, json({ email: "lupita@correo.mx", password: "secreta123" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INVITATION");
  });

  it("acceptance: a user with no username, then the phone written, the store active, the code sent; the código signs in", async () => {
    const { store, token } = await invite();
    const res = await call(`/store/invitations/${token}/accept`, json({ email: " Lupita@Correo.MX ", password: "secreta123" }));
    expect(res.status).toBe(201);
    expect((await res.json()).data).toEqual({ email: "lupita@correo.mx" });

    const [user] = await db().select().from(userTable).where(eq(userTable.email, "lupita@correo.mx"));
    expect(user).toMatchObject({ username: "5512345678", displayUsername: "5512345678", emailVerified: false, name: "Lupita Hernández" });
    const [row] = await db().select().from(stores).where(eq(stores.id, store.id));
    expect(row).toMatchObject({ userId: user.id, status: "active" });
    const [inv] = await db().select().from(storeInvitations);
    expect(inv.status).toBe("accepted");
    /* used: it no longer opens */
    expect((await (await call(`/store/invitations/${token}`)).json()).data.state).toBe("invalid");

    /* before the código, a sign-in by phone is EMAIL_NOT_VERIFIED */
    const early = await call("/auth/sign-in/username", json({ username: "5512345678", password: "secreta123" }));
    expect(early.status).toBe(403);

    const verified = await call("/auth/email-otp/verify-email", json({ email: "lupita@correo.mx", otp: await lastCodeFor("lupita@correo.mx") }));
    expect(verified.status).toBe(200);
    const me = await call("/auth/me", withCookie(sessionOf(verified)));
    expect((await me.json()).data).toMatchObject({ type: "store", storeId: store.id });

    const signIn = await call("/auth/sign-in/username", json({ username: "5512345678", password: "secreta123" }));
    expect(signIn.status).toBe(200);
  });

  it("EMAIL_TAKEN for an existing user and for an operator's address; the invitation stays open", async () => {
    const { token } = await invite();
    await seedBusiness({ email: "tomado@correo.mx" });
    const taken = await call(`/store/invitations/${token}/accept`, json({ email: "tomado@correo.mx", password: "secreta123" }));
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("EMAIL_TAKEN");

    const opEnv = { ...(env as unknown as Bindings), PLATFORM_OPERATOR_EMAILS: "jefa@devolada.app" };
    const operator = await call(`/store/invitations/${token}/accept`, json({ email: "jefa@devolada.app", password: "secreta123" }), opEnv);
    expect(operator.status).toBe(409);
    expect((await operator.json()).error.code).toBe("EMAIL_TAKEN");
    expect(await db().select().from(userTable).where(eq(userTable.email, "jefa@devolada.app"))).toHaveLength(0);
    expect((await (await call(`/store/invitations/${token}`)).json()).data.state).toBe("open");
  });

  it("a store another request accepted meanwhile: the late user is removed, and the answer is INVALID_INVITATION", async () => {
    const { store, token } = await invite();
    /* the race, as the second request meets it: the store already has its
       shopkeeper by the time this one writes */
    const first = await call(`/store/invitations/${token}/accept`, json({ email: "uno@correo.mx", password: "secreta123" }));
    expect(first.status).toBe(201);
    await db().update(storeInvitations).set({ status: "sent" });
    await db().update(stores).set({ status: "invited" }).where(eq(stores.id, store.id));
    const second = await call(`/store/invitations/${token}/accept`, json({ email: "dos@correo.mx", password: "secreta123" }));
    expect(second.status).toBe(400);
    expect(await db().select().from(userTable).where(eq(userTable.email, "dos@correo.mx"))).toHaveLength(0);
    const [row] = await db().select().from(stores).where(eq(stores.id, store.id));
    expect(row.userId).not.toBeNull();
  });

  it("recovery: the forget-password código resets the password, and the phone signs in with the new one (FR-011)", async () => {
    const { email } = await seedActiveStore({ phone: "5512345678" });
    expect((await call("/auth/email-otp/send-verification-otp", json({ email, type: "forget-password" }))).status).toBe(200);
    const reset = await call("/auth/email-otp/reset-password", json({ email, otp: await lastCodeFor(email), password: "nueva-clave-1" }));
    expect(reset.status).toBe(200);
    expect((await call("/auth/sign-in/username", json({ username: "5512345678", password: PASSWORD }))).status).toBe(401);
    expect((await call("/auth/sign-in/username", json({ username: "5512345678", password: "nueva-clave-1" }))).status).toBe(200);
  });
});
