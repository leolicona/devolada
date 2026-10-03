import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { account, passkey, session as sessionTable, user as userTable, verification } from "../src/db/schema";
import { app, json, seedBusiness, seedLegacyUser, seedSession, sentCode, sessionCookieHeader, sessionOf } from "./helpers";

/* passwordless-access US2 (contracts/panel-access.md): the sign-in is the
   same door as the registration (D1) — a código for any address, the same
   answer for every one (FR-013) — and the password door is closed (D4).
   A legacy account whose email was never proven loses what it accrued
   before the proof (Better Auth's `revokeUnprovenAccountAccess`). */

const call = async (path: string, init: RequestInit = {}) => (await app()).request(path, init, env);
const db = () => drizzle(env.DB);
const requestCode = (email: string) => call("/auth/email-otp/send-verification-otp", json({ email, type: "sign-in" }));
const enter = (email: string, otp: string) => call("/auth/sign-in/email-otp", json({ email, otp }));
const userOf = async (email: string) => (await db().select().from(userTable).where(eq(userTable.email, email)))[0];

describe("passwordless-access US2 — the código opens an existing account (D1, FR-013)", () => {
  it("a sign-in código opens a session in the owner's business", async () => {
    const business = await seedBusiness({ email: "dueno@negocio.mx" });
    expect((await requestCode("dueno@negocio.mx")).status).toBe(200);
    const res = await enter("dueno@negocio.mx", sentCode("dueno@negocio.mx"));
    expect(res.status).toBe(200);
    const me = await call("/auth/me", { headers: { Cookie: sessionOf(res) } });
    expect((await me.json()).data).toMatchObject({ type: "business", id: business.id, role: "owner" });
  });

  it("an unknown address gets the same answer, and its código creates an account with no name yet", async () => {
    const asked = await requestCode("nueva@negocio.mx");
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ success: true });

    const res = await enter("nueva@negocio.mx", sentCode("nueva@negocio.mx"));
    expect(res.status).toBe(200);
    /* /welcome asks the name before anything else (D6) */
    expect(await userOf("nueva@negocio.mx")).toMatchObject({ emailVerified: true, name: "" });
  });

  it("the name can be given once, after the fact, through update-user", async () => {
    await requestCode("nueva@negocio.mx");
    const cookie = sessionOf(await enter("nueva@negocio.mx", sentCode("nueva@negocio.mx")));
    const res = await call("/auth/update-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5174", Cookie: cookie },
      body: JSON.stringify({ name: " Ana López " }),
    });
    expect(res.status).toBe(200);
    expect((await userOf("nueva@negocio.mx")).name).toBe("Ana López");
  });
});

describe("passwordless-access US2 — the password door is closed (D4, FR-010)", () => {
  it("POST /auth/sign-in/email answers 404, even for an account that still holds a password", async () => {
    await seedLegacyUser("Ana", "ana@negocio.mx", { emailVerified: true });
    const res = await call("/auth/sign-in/email", json({ email: "ana@negocio.mx", password: "una-clave-123" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("passwordless-access US6 — only the sign-in kind of código is ever sent (D4)", () => {
  it("asking for an email-verification or a password-reset código is refused, and nothing is written or sent", async () => {
    for (const type of ["email-verification", "forget-password"]) {
      const res = await call("/auth/email-otp/send-verification-otp", json({ email: "ana@negocio.mx", type }));
      expect(res.status, type).toBe(400);
      expect((await res.json()).code, type).toBe("OTP_TYPE_NOT_ALLOWED");
    }
    expect(await db().select().from(verification)).toHaveLength(0);
    expect(() => sentCode("ana@negocio.mx")).toThrow();
  });
});

describe("passwordless-access US2 — a legacy unverified account, proven by its código (D1, D5)", () => {
  it("ends verified, and the password and the session it held before the proof are gone", async () => {
    await seedLegacyUser("Legado", "legado@negocio.mx");
    const legacy = await userOf("legado@negocio.mx");
    expect(legacy.emailVerified).toBe(false);
    await seedSession(legacy.id, "legado@negocio.mx");
    const oldCookie = await sessionCookieHeader("legado@negocio.mx");

    await requestCode("legado@negocio.mx");
    const res = await enter("legado@negocio.mx", sentCode("legado@negocio.mx"));
    expect(res.status).toBe(200);

    const after = await userOf("legado@negocio.mx");
    expect(after).toMatchObject({ id: legacy.id, emailVerified: true, name: "Legado" });
    expect(
      await db().select().from(account).where(and(eq(account.userId, legacy.id), eq(account.providerId, "credential"))),
    ).toHaveLength(0);
    /* one session: the código's; the one from before the proof is gone */
    expect(await db().select().from(sessionTable).where(eq(sessionTable.userId, legacy.id))).toHaveLength(1);
    expect((await call("/auth/me", { headers: { Cookie: oldCookie } })).status).toBe(401);
  });
});

describe("passwordless-access US3 — an account with a key signs in by código all the same (FR-015)", () => {
  it("the key is a way in, never the only one", async () => {
    await seedBusiness({ email: "dueno@negocio.mx" });
    const owner = await userOf("dueno@negocio.mx");
    await db().insert(passkey).values({
      id: crypto.randomUUID(),
      name: null,
      publicKey: "pk",
      userId: owner.id,
      credentialID: "cred-1",
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      transports: "internal",
      createdAt: new Date(),
      aaguid: null,
    });

    await requestCode("dueno@negocio.mx");
    const res = await enter("dueno@negocio.mx", sentCode("dueno@negocio.mx"));
    expect(res.status).toBe(200);
    expect(sessionOf(res)).toContain("better-auth.session_token=");
  });
});
