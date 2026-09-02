import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, user as userTable, member } from "../src/db/schema";
import { app, cookiesOf, json, lastCodeFor, seedBusiness, sessionOf, PASSWORD } from "./helpers";

/* better-auth.spec.md scenarios 1, 2, 7, 8, 16 — ISP signup with a code
   as the master key, and the code as the door (D16; US-S04, US-S06). */

const EMAIL = "nuevo@business.mx";

async function signup() {
  return (await app()).request(
    "/auth/business/signup",
    json({ name: "ISP Nuevo", email: EMAIL, password: PASSWORD }),
    env,
  );
}

const verify = async (otp: string, cookie?: string) =>
  (await app()).request(
    "/auth/email-otp/verify-email",
    { ...json({ email: EMAIL, otp }), headers: { "Content-Type": "application/json", Origin: "http://localhost:5174", ...(cookie ? { Cookie: cookie } : {}) } },
    env,
  );

describe("US-S04: ISP signup verifies the email with a code — the code opens the session (D16)", () => {
  it("signup returns 201 with a code and no session — and no business yet (D5)", async () => {
    const res = await signup();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ type: "user", emailVerified: false });
    /* D16: nothing to carry — the session is born when the código is typed */
    expect(cookiesOf(res).find((c) => c.includes("session_token="))).toBeUndefined();

    /* business-and-memberships D5: the business is born at wizard
       completion, never at signup */
    const db = drizzle(env.DB);
    expect(await db.select().from(businesses)).toHaveLength(0);

    /* The verification code went out through our hook (spec D9) and is
       redeemable — the test mailbox is the verification table */
    expect(await lastCodeFor(EMAIL)).toMatch(/^\d{6}$/);
  });

  it("before the code, the password alone opens nothing: sign-in answers 403 EMAIL_NOT_VERIFIED (scenario 1)", async () => {
    await signup();
    const res = await (await app()).request("/auth/sign-in/email", json({ email: EMAIL, password: PASSWORD }), env);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("EMAIL_NOT_VERIFIED");
    expect(cookiesOf(res).find((c) => c.includes("session_token="))).toBeUndefined();
  });

  it("typing the code flips emailVerified and signs the person in; the wizard follows (scenario 1)", async () => {
    await signup();
    const otp = await lastCodeFor(EMAIL);

    const verified = await verify(otp);
    expect(verified.status).toBe(200);
    const cookie = sessionOf(verified);

    const db = drizzle(env.DB);
    const [u] = await db.select().from(userTable).where(eq(userTable.email, EMAIL));
    expect(u.emailVerified).toBe(true);

    /* No business yet: /auth/me says so, and the wizard is the next screen */
    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(403);
    expect((await me.json()).error.code).toBe("NO_BUSINESS");

    /* business-and-memberships scenario 1, end to end: the wizard's one
       call births the business, and the actor carries the verified flag */
    const born = await (await app()).request(
      "/businesses",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          name: "WifiPlus",
          speiClabe: "646180157000000004",
          speiBank: "STP",
          speiBeneficiaryName: "WifiPlus SA de CV",
        }),
      },
      env,
    );
    expect(born.status).toBe(201);
    const after = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect((await after.json()).data).toMatchObject({ emailVerified: true, role: "owner", name: "WifiPlus" });

    /* And the password now opens the door on its own */
    const login = await (await app()).request("/auth/sign-in/email", json({ email: EMAIL, password: PASSWORD }), env);
    expect(login.status).toBe(200);
  });

  it("a wrong code fails, the flag stays down and no session is born (scenario 8)", async () => {
    await signup();
    const res = await verify("000000");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(cookiesOf(res).find((c) => c.includes("session_token="))).toBeUndefined();

    const db = drizzle(env.DB);
    const [u] = await db.select().from(userTable).where(eq(userTable.email, EMAIL));
    expect(u.emailVerified).toBe(false);
  });

  it("a mistyped, unverified address is not taken: the next signup replaces it, password included (D16)", async () => {
    await signup();
    const again = await (await app()).request(
      "/auth/business/signup",
      json({ name: "ISP Nuevo", email: EMAIL, password: "otra-clave-99" }),
      env,
    );
    expect(again.status).toBe(201);

    const db = drizzle(env.DB);
    expect(await db.select().from(userTable).where(eq(userTable.email, EMAIL))).toHaveLength(1);
    const verified = await verify(await lastCodeFor(EMAIL));
    expect(verified.status).toBe(200);
    const oldPass = await (await app()).request("/auth/sign-in/email", json({ email: EMAIL, password: PASSWORD }), env);
    expect(oldPass.status).toBe(401);
    const newPass = await (await app()).request("/auth/sign-in/email", json({ email: EMAIL, password: "otra-clave-99" }), env);
    expect(newPass.status).toBe(200);
  });

  it("a taken email returns 409 EMAIL_TAKEN (scenario 2)", async () => {
    await seedBusiness({ email: EMAIL });
    const res = await signup();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EMAIL_TAKEN");
  });

  it("a malformed payload returns 400", async () => {
    const res = await (await app()).request(
      "/auth/business/signup",
      json({ name: "X", email: "no-es-correo", password: "corta" }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("US-S06: recovery by code restores access (scenario 7)", () => {
  it("email → code → new password signs in; the old password dies", async () => {
    await seedBusiness({ email: EMAIL });

    const ask = await (await app()).request(
      "/auth/email-otp/request-password-reset",
      json({ email: EMAIL }),
      env,
    );
    expect(ask.status).toBe(200);
    const otp = await lastCodeFor(EMAIL);

    const reset = await (await app()).request(
      "/auth/email-otp/reset-password",
      json({ email: EMAIL, otp, password: "nueva-clave-9" }),
      env,
    );
    expect(reset.status).toBe(200);

    const oldPass = await (await app()).request(
      "/auth/sign-in/email",
      json({ email: EMAIL, password: PASSWORD }),
      env,
    );
    expect(oldPass.status).toBe(401);

    const newPass = await (await app()).request(
      "/auth/sign-in/email",
      json({ email: EMAIL, password: "nueva-clave-9" }),
      env,
    );
    expect(newPass.status).toBe(200);
  });

  it("an unknown email answers the same 200 (no existence leak)", async () => {
    const res = await (await app()).request(
      "/auth/email-otp/request-password-reset",
      json({ email: "nadie@example.com" }),
      env,
    );
    expect(res.status).toBe(200);
  });
});
