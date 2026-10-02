import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { organization, session as sessionTable, storeInvitations, stores, user as userTable } from "../src/db/schema";
import type { Bindings } from "../src/env";
import { storeMeResponse } from "../src/routes/store/schema";
import { app, json, mintCode, seedBusiness, sentCode, sessionCookieHeader, sessionOf } from "./helpers";
import { seedActiveStore, seedStore, seedStoreChannel, storeSession } from "./store-helpers";

/* cash-at-stores US3 (T014, T041) — the shopkeeper is a second kind of
   actor (D2): refused by every business door, resolved by its own row on
   every request, signed in by phone through the username plugin, which
   only the acceptance route may write (D3). The M1 measurements of
   quickstart §0 are the first describe: they decide D3 and D5.

   passwordless-access US2 (T077): the panel's password doors close in PR 1
   while the store keeps its phone and password until US6. The códigos are
   hashed now (D2), so they come from the sender's log (`sentCode`), and the
   `username` refusals once proven on `/sign-up/email` — closed, 404 — are
   proven on the doors that stay open.

   passwordless-access US6 (T059): the store's password goes too. The phone
   and password door (`/auth/sign-in/username`), the password acceptance and
   the `forget-password` recovery left this suite; their absence, and the
   email-and-código acceptance and phone sign-in that replace them, are
   proven in passwordless-store.test.ts. What stays here is what did not
   change: no request writes a username, the store's own row decides on
   every request, and a store's account opens no business door. */

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

describe("cash-at-stores US3 — M1: no request writes a username (D3)", () => {
  it("a right código with a username in the body is refused, and no user is born (passwordless-access US2)", async () => {
    const otp = await mintCode("intruso@correo.mx");
    const res = await call(
      "/auth/sign-in/email-otp",
      json({ email: "intruso@correo.mx", otp, name: "Intruso", username: "5512345678" }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("USERNAME_NOT_ALLOWED");
    expect(await db().select().from(userTable).where(eq(userTable.email, "intruso@correo.mx"))).toHaveLength(0);
  });

  it("a displayUsername is refused too, on the código door and on update-user — the plugin would copy it into username (measured)", async () => {
    const otp = await mintCode("intruso@correo.mx");
    const res = await call(
      "/auth/sign-in/email-otp",
      json({ email: "intruso@correo.mx", otp, name: "Intruso", displayUsername: "5512345678" }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("USERNAME_NOT_ALLOWED");

    await seedBusiness();
    const cookie = await sessionCookieHeader("demo@devolada.app");
    const update = await call("/auth/update-user", withCookie(cookie, json({ displayUsername: "5512345678" })));
    expect(update.status).toBe(400);
    expect(((await update.json()) as { code: string }).code).toBe("USERNAME_NOT_ALLOWED");
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
    const { store, headers, email } = await seedActiveStore();
    const before = await call("/auth/me", { headers });
    const data = storeMeResponse.parse((await before.json()).data);
    /* passwordless-access US6 (D8): with the store account's own email */
    expect(data).toEqual({ type: "store", storeId: store.id, name: store.name, businessName: null, email });

    await seedStoreChannel(business);
    const after = await call("/auth/me", { headers });
    expect(storeMeResponse.parse((await after.json()).data)).toEqual({
      type: "store",
      storeId: store.id,
      name: store.name,
      businessName: "WiFi Plus",
      email,
    });
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

/* passwordless-access US6: the acceptance as the store app makes it — the
   invitation's código, then the address and that código */
async function accept(token: string, email: string, e: unknown = env) {
  await call(`/store/invitations/${token}/code`, json({ email }), e);
  return call(`/store/invitations/${token}/accept`, json({ email, otp: sentCode(email) }), e);
}

describe("cash-at-stores US3 — the invitation: preview and the acceptance's races (D4, D5, T089)", () => {
  it("the preview shows the store and the last four digits; anything else is `invalid`", async () => {
    const { token } = await invite();
    expect((await (await call(`/store/invitations/${token}`)).json()).data).toEqual({ state: "open", storeName: "Abarrotes Lupita", phoneTail: "5678" });
    expect((await (await call("/store/invitations/no-such-token")).json()).data).toEqual({ state: "invalid" });
  });

  it("an expired invitation reads `invalid`, and neither asks for a código nor accepts one", async () => {
    const { token } = await invite();
    await db().update(storeInvitations).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await (await call(`/store/invitations/${token}`)).json()).data).toEqual({ state: "invalid" });
    const code = await call(`/store/invitations/${token}/code`, json({ email: "lupita@correo.mx" }));
    expect(code.status).toBe(400);
    expect((await code.json()).error.code).toBe("INVALID_INVITATION");
    const res = await call(`/store/invitations/${token}/accept`, json({ email: "lupita@correo.mx", otp: await mintCode("lupita@correo.mx") }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INVITATION");
    expect(await db().select().from(userTable).where(eq(userTable.email, "lupita@correo.mx"))).toHaveLength(0);
  });

  it("the panel's registration of a shopkeeper's address opens the store's account by código, which the panel refuses (passwordless-access US1)", async () => {
    const { store, token } = await invite();
    expect((await accept(token, "lupita@correo.mx")).status).toBe(201);
    const [shopkeeper] = await db().select().from(userTable).where(eq(userTable.email, "lupita@correo.mx"));

    /* the registration door answers as for anyone (FR-005), and the código
       proves the inbox — whoever types it is the shopkeeper */
    expect((await call("/auth/email-otp/send-verification-otp", json({ email: "lupita@correo.mx", type: "sign-in" }))).status).toBe(200);
    const res = await call("/auth/sign-in/email-otp", json({ email: "lupita@correo.mx", otp: sentCode("lupita@correo.mx"), name: "Otro Negocio" }));
    expect(res.status).toBe(200);

    /* the same account, still the store's; no second user, no new name */
    const users = await db().select().from(userTable).where(eq(userTable.email, "lupita@correo.mx"));
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: shopkeeper.id, name: "Lupita Hernández", emailVerified: true });
    const [row] = await db().select().from(stores).where(eq(stores.id, store.id));
    expect(row.userId).toBe(shopkeeper.id);

    /* and its session is the store branch, which every business door refuses (cash-at-stores D2) */
    const me = await call("/auth/me", withCookie(sessionOf(res)));
    expect((await me.json()).data).toMatchObject({ type: "store", storeId: store.id });
    const feed = await call("/payments/feed", withCookie(sessionOf(res)));
    expect(feed.status).toBe(403);
    expect((await feed.json()).error.code).toBe("WRONG_ACTOR");
  });

  it("two acceptances at once: one wins, the other is INVALID_INVITATION — never a 500 — and writes nothing (T089, D5)", async () => {
    const { store, token } = await invite();
    await call(`/store/invitations/${token}/code`, json({ email: "uno@correo.mx" }));
    await call(`/store/invitations/${token}/code`, json({ email: "dos@correo.mx" }));
    const [a, b] = await Promise.all([
      call(`/store/invitations/${token}/accept`, json({ email: "uno@correo.mx", otp: sentCode("uno@correo.mx") })),
      call(`/store/invitations/${token}/accept`, json({ email: "dos@correo.mx", otp: sentCode("dos@correo.mx") })),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const loser = a.status === 400 ? a : b;
    expect((await loser.json()).error.code).toBe("INVALID_INVITATION");
    const winnerEmail = a.status === 201 ? "uno@correo.mx" : "dos@correo.mx";
    const loserEmail = a.status === 201 ? "dos@correo.mx" : "uno@correo.mx";
    /* D5's rollback: the loser's user is gone, with its session */
    expect(await db().select().from(userTable).where(eq(userTable.email, loserEmail))).toHaveLength(0);
    const [winner] = await db().select().from(userTable).where(eq(userTable.email, winnerEmail));
    const [row] = await db().select().from(stores).where(eq(stores.id, store.id));
    expect(row).toMatchObject({ userId: winner.id, status: "active" });
    expect(winner.username).toBe("5512345678");
    const [inv] = await db().select().from(storeInvitations);
    expect(inv.status).toBe("accepted");
    /* no session outlives its user */
    const users = new Set((await db().select({ id: userTable.id }).from(userTable)).map((u) => u.id));
    for (const row of await db().select().from(sessionTable)) expect(users.has(row.userId)).toBe(true);
    expect(await db().select().from(sessionTable).where(eq(sessionTable.userId, winner.id))).toHaveLength(1);
  });

  it("a store another request accepted meanwhile: no user is born, and the answer is INVALID_INVITATION", async () => {
    const { store, token } = await invite();
    /* the race, as the second request meets it: the store already has its
       shopkeeper by the time this one reads it */
    expect((await accept(token, "uno@correo.mx")).status).toBe(201);
    await db().update(storeInvitations).set({ status: "sent" });
    await db().update(stores).set({ status: "invited" }).where(eq(stores.id, store.id));
    const second = await call(`/store/invitations/${token}/accept`, json({ email: "dos@correo.mx", otp: await mintCode("dos@correo.mx") }));
    expect(second.status).toBe(400);
    expect((await second.json()).error.code).toBe("INVALID_INVITATION");
    expect(await db().select().from(userTable).where(eq(userTable.email, "dos@correo.mx"))).toHaveLength(0);
    const [row] = await db().select().from(stores).where(eq(stores.id, store.id));
    expect(row.userId).not.toBeNull();
  });
});
