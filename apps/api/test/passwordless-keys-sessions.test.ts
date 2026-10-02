import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { passkey, session as sessionTable, user as userTable } from "../src/db/schema";
import { app, json, mintCode, seedBusiness, sessionOf } from "./helpers";

/* passwordless-access US5 (D8, D11; FR-021–FR-023): Seguridad keeps control
   of keys and sessions without a password. "Cerrar sesión en los demás
   dispositivos" is Better Auth's own `revoke-other-sessions`; a key asks
   for a session younger than a day (the step-up answers an older one); a
   removed key stops at once, and the código still opens the account. */

const call = async (path: string, init: RequestInit = {}) => (await app()).request(path, init, env);
const db = () => drizzle(env.DB);
const as = (cookie: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), Cookie: cookie, Origin: "http://localhost:5174" },
});
const signIn = async (email: string) => {
  const res = await call("/auth/sign-in/email-otp", json({ email, otp: await mintCode(email) }));
  expect(res.status).toBe(200);
  return sessionOf(res);
};

describe("passwordless-access US5 — closing the other sessions (D11, FR-022)", () => {
  it("from one of three sessions: the other two get 401 at their next request, the caller stays", async () => {
    await seedBusiness({ email: "dueno@negocio.mx" });
    const [here, phone, laptop] = [await signIn("dueno@negocio.mx"), await signIn("dueno@negocio.mx"), await signIn("dueno@negocio.mx")];

    const res = await call("/auth/revoke-other-sessions", as(here, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });

    expect((await call("/auth/me", as(phone))).status).toBe(401);
    expect((await call("/auth/me", as(laptop))).status).toBe(401);
    expect((await call("/auth/me", as(here))).status).toBe(200);
  });
});

describe("passwordless-access US5 — a key asks for a session younger than a day (D8, FR-021)", () => {
  it("a 25-hour session gets SESSION_NOT_FRESH; the session a código opens gets the options", async () => {
    await seedBusiness({ email: "dueno@negocio.mx" });
    const old = await signIn("dueno@negocio.mx");
    const [owner] = await db().select().from(userTable).where(eq(userTable.email, "dueno@negocio.mx"));
    await db()
      .update(sessionTable)
      .set({ createdAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(sessionTable.userId, owner.id));

    const stale = await call("/auth/passkey/generate-register-options", as(old));
    expect(stale.status).toBe(403);
    expect(((await stale.json()) as { code: string }).code).toBe("SESSION_NOT_FRESH");

    /* the step-up: a código opens a fresh session */
    const fresh = await signIn("dueno@negocio.mx");
    const options = await call("/auth/passkey/generate-register-options", as(fresh));
    expect(options.status).toBe(200);
    expect(((await options.json()) as { challenge: string }).challenge).toBeTruthy();
  });
});

describe("passwordless-access US5 — removing a key (FR-023)", () => {
  it("the row is gone, the list no longer has it, and the código still opens the account", async () => {
    await seedBusiness({ email: "dueno@negocio.mx" });
    const [owner] = await db().select().from(userTable).where(eq(userTable.email, "dueno@negocio.mx"));
    const id = crypto.randomUUID();
    await db().insert(passkey).values({
      id,
      name: null,
      publicKey: "pk",
      userId: owner.id,
      credentialID: "cred-1",
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      transports: "internal",
      createdAt: new Date(),
    });
    const cookie = await signIn("dueno@negocio.mx");
    const listed = await call("/auth/passkey/list-user-passkeys", as(cookie));
    expect(((await listed.json()) as { id: string }[]).map((k) => k.id)).toEqual([id]);

    const removed = await call("/auth/passkey/delete-passkey", as(cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
    expect(removed.status).toBe(200);
    expect(await db().select().from(passkey).where(eq(passkey.userId, owner.id))).toHaveLength(0);
    expect(await (await call("/auth/passkey/list-user-passkeys", as(cookie))).json()).toEqual([]);

    /* the last key gone, the código is the way in */
    await signIn("dueno@negocio.mx");
  });
});
