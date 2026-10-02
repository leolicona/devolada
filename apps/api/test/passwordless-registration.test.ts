import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { account, user as userTable, verification } from "../src/db/schema";
import { app, json, seedBusiness, sentCode, sessionOf } from "./helpers";

/* passwordless-access US1 (contracts/panel-access.md): registration is the
   email-OTP plugin's sign-in door (D1). A código goes out for any address;
   the account is born at the código, verified and named, with no password;
   a taken address answers exactly like a new one until its código opens
   it. The código's terms are written (D2): ten minutes, three tries, a
   hash, and a new request ends the old one. */

const call = async (path: string, init: RequestInit = {}) => (await app()).request(path, init, env);
const db = () => drizzle(env.DB);
const requestCode = (email: string) => call("/auth/email-otp/send-verification-otp", json({ email, type: "sign-in" }));
const enter = (email: string, otp: string, name?: string) =>
  call("/auth/sign-in/email-otp", json({ email, otp, ...(name ? { name } : {}) }));
const userOf = async (email: string) => (await db().select().from(userTable).where(eq(userTable.email, email)))[0];
const codeOf = async (res: Response) => ((await res.json()) as { code?: string }).code;

describe("passwordless-access US1 — the registration (D1, FR-001–FR-005)", () => {
  it("name and email, then the código: the account is born verified, named, with a session and no password", async () => {
    const asked = await requestCode("ana@negocio.mx");
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ success: true });

    const res = await enter("ana@negocio.mx", sentCode("ana@negocio.mx"), "Ana López");
    expect(res.status).toBe(200);
    expect(sessionOf(res)).toContain("better-auth.session_token=");

    const user = await userOf("ana@negocio.mx");
    expect(user).toMatchObject({ emailVerified: true, name: "Ana López" });
    expect(await db().select().from(account).where(eq(account.userId, user.id))).toHaveLength(0);

    /* the session is a person's: the wizard is next (no business yet) */
    const session = await call("/auth/get-session", { headers: { Cookie: sessionOf(res) } });
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe("ana@negocio.mx");
  });

  it("nothing exists before the código: a mistyped address leaves no account behind (FR-004)", async () => {
    expect((await requestCode("ana@negocoi.mx")).status).toBe(200);
    expect(await db().select().from(userTable)).toHaveLength(0);
  });

  it("a taken address answers the same, and its código opens the existing account with its name unchanged (FR-005)", async () => {
    await seedBusiness({ email: "dueno@negocio.mx" });
    const before = await userOf("dueno@negocio.mx");

    const asked = await requestCode("dueno@negocio.mx");
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ success: true });

    const res = await enter("dueno@negocio.mx", sentCode("dueno@negocio.mx"), "Otro Nombre");
    expect(res.status).toBe(200);
    const after = await userOf("dueno@negocio.mx");
    expect(after.id).toBe(before.id);
    expect(after.name).toBe(before.name);
    expect(await db().select().from(userTable).where(eq(userTable.email, "dueno@negocio.mx"))).toHaveLength(1);
  });

  it("a name the screens would refuse is refused by the server too, and no account is born (analysis A3)", async () => {
    await requestCode("ana@negocio.mx");
    const otp = sentCode("ana@negocio.mx");
    for (const name of [" A ", "x".repeat(81)]) {
      const res = await enter("ana@negocio.mx", otp, name);
      expect(res.status, name).toBe(400);
      expect(await codeOf(res), name).toBe("INVALID_NAME");
    }
    expect(await userOf("ana@negocio.mx")).toBeUndefined();

    /* a name with spaces around it is stored trimmed */
    const res = await enter("ana@negocio.mx", otp, "  Ana López  ");
    expect(res.status).toBe(200);
    expect((await userOf("ana@negocio.mx")).name).toBe("Ana López");
  });
});

describe("passwordless-access US1 — the código's terms (D2, FR-003, FR-025)", () => {
  it("a código past its ten minutes answers OTP_EXPIRED", async () => {
    await requestCode("ana@negocio.mx");
    const [row] = await db().select().from(verification).where(eq(verification.identifier, "sign-in-otp-ana@negocio.mx"));
    /* ten minutes, written (D2): not the plugin's five */
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    await db().update(verification).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(verification.id, row.id));
    const res = await enter("ana@negocio.mx", sentCode("ana@negocio.mx"), "Ana López");
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("OTP_EXPIRED");
  });

  it("three wrong tries kill the código: then even the right one answers TOO_MANY_ATTEMPTS", async () => {
    await requestCode("ana@negocio.mx");
    const right = sentCode("ana@negocio.mx");
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect((await enter("ana@negocio.mx", wrong, "Ana López")).status).toBe(400);
    const res = await enter("ana@negocio.mx", right, "Ana López");
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("TOO_MANY_ATTEMPTS");
    expect(await userOf("ana@negocio.mx")).toBeUndefined();
  });

  it("a new request ends the previous código: refused while the new one lives, and after it is used", async () => {
    await requestCode("ana@negocio.mx");
    const a = sentCode("ana@negocio.mx");
    await requestCode("ana@negocio.mx");
    let b = sentCode("ana@negocio.mx");
    /* two requests in a row may draw the same six digits; ask again until they differ */
    while (b === a) {
      await requestCode("ana@negocio.mx");
      b = sentCode("ana@negocio.mx");
    }
    /* one live row per address (T005's hook), never two to tie on */
    expect(await db().select().from(verification).where(eq(verification.identifier, "sign-in-otp-ana@negocio.mx"))).toHaveLength(1);

    const early = await enter("ana@negocio.mx", a, "Ana López");
    expect(early.status).toBe(400);
    expect(await codeOf(early)).toBe("INVALID_OTP");

    expect((await enter("ana@negocio.mx", b, "Ana López")).status).toBe(200);

    const late = await enter("ana@negocio.mx", a);
    expect(late.status).toBe(400);
    expect(await codeOf(late)).toBe("INVALID_OTP");
  });

  it("the stored código is a hash with its tries, never the six digits (constitution V)", async () => {
    await requestCode("ana@negocio.mx");
    const otp = sentCode("ana@negocio.mx");
    const [row] = await db().select().from(verification).where(eq(verification.identifier, "sign-in-otp-ana@negocio.mx"));
    expect(row.value).toMatch(/^[A-Za-z0-9_-]{43}:0$/);
    expect(row.value).not.toContain(otp);
  });
});

describe("passwordless-access US1 — the password doors of registration are closed (D1, D4)", () => {
  it("POST /auth/sign-up/email and POST /auth/business/signup answer 404, and no user is born", async () => {
    const signUp = await call("/auth/sign-up/email", json({ name: "Ana López", email: "ana@negocio.mx", password: "una-clave-123" }));
    expect(signUp.status).toBe(404);
    const business = await call("/auth/business/signup", json({ name: "Ana López", email: "ana@negocio.mx", password: "una-clave-123" }));
    expect(business.status).toBe(404);
    expect(await db().select().from(userTable)).toHaveLength(0);
  });
});
