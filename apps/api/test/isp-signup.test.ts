import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { businesses, user as userTable, member } from "../src/db/schema";
import { app, json, lastCodeFor, seedBusiness, sessionOf, PASSWORD } from "./helpers";

/* better-auth.spec.md scenarios 1, 2, 7, 8 — ISP signup with a code as
   the master key (US-S04, US-S06). */

const EMAIL = "nuevo@business.mx";

async function signup() {
  return (await app()).request(
    "/auth/business/signup",
    json({ name: "ISP Nuevo", email: EMAIL, password: PASSWORD }),
    env,
  );
}

describe("US-S04: ISP signup verifies the email with a code", () => {
  it("signup returns 201 with a session and a code — and no business yet (D5)", async () => {
    const res = await signup();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ type: "user", emailVerified: false });
    expect(sessionOf(res)).toContain("session_token=");

    /* business-and-memberships D5: the business is born at wizard
       completion, never at signup — /auth/me says so until then */
    const db = drizzle(env.DB);
    expect(await db.select().from(businesses)).toHaveLength(0);
    const me = await (await app()).request("/auth/me", { headers: { Cookie: sessionOf(res) } }, env);
    expect(me.status).toBe(403);
    expect((await me.json()).error.code).toBe("NO_BUSINESS");

    /* The verification code went out through our hook (spec D9) and is
       redeemable — the test mailbox is the verification table */
    expect(await lastCodeFor(EMAIL)).toMatch(/^\d{6}$/);
  });

  it("typing the code flips emailVerified (scenario 1)", async () => {
    const res = await signup();
    const cookie = sessionOf(res);
    const otp = await lastCodeFor(EMAIL);

    const verify = await (await app()).request(
      "/auth/email-otp/verify-email",
      { ...json({ email: EMAIL, otp }), headers: { "Content-Type": "application/json", Origin: "http://localhost:5174", Cookie: cookie } },
      env,
    );
    expect(verify.status).toBe(200);

    const db = drizzle(env.DB);
    const [u] = await db.select().from(userTable).where(eq(userTable.email, EMAIL));
    expect(u.emailVerified).toBe(true);

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
    const me = await (await app()).request("/auth/me", { headers: { Cookie: cookie } }, env);
    expect((await me.json()).data).toMatchObject({ emailVerified: true, role: "owner", name: "WifiPlus" });
  });

  it("a wrong code fails and the flag stays down (scenario 8)", async () => {
    const res = await signup();
    const cookie = sessionOf(res);

    const verify = await (await app()).request(
      "/auth/email-otp/verify-email",
      { ...json({ email: EMAIL, otp: "000000" }), headers: { "Content-Type": "application/json", Origin: "http://localhost:5174", Cookie: cookie } },
      env,
    );
    expect(verify.status).toBeGreaterThanOrEqual(400);

    const db = drizzle(env.DB);
    const [u] = await db.select().from(userTable).where(eq(userTable.email, EMAIL));
    expect(u.emailVerified).toBe(false);
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
