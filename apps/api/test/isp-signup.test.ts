import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { isps } from "../src/db/schema";
import {
  app,
  cookiesOf,
  idpError,
  idpTokens,
  mockIdp,
  seedIsp,
  sessionCookieHeader,
} from "./helpers";

/* docs/auth/isp-signup.spec.md scenarios 1–8. */

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

const EMAIL = "nuevo@isp.mx";

function mockSignupIdp() {
  mockIdp("/auth/hash", { body: { success: true, data: { hash: "h1", salt: "s1" } } });
  mockIdp("/auth/verify-password", { body: { success: true, data: idpTokens(EMAIL) } });
  mockIdp("/auth/initiate", {
    body: { success: true, data: { token: "tok-1", magicLink: "https://ignored" } },
  });
}

describe("US-S04: ISP signs up and verifies their email", () => {
  it("valid signup creates the account unverified and signs in", async () => {
    mockSignupIdp();

    const res = await (await app()).request(
      "/auth/signup",
      json({ name: "ISP Nuevo", email: EMAIL, password: "devolada123" }),
      env,
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ type: "isp", emailVerified: false });
    expect(cookiesOf(res).join(";")).toContain("gm_access=");

    const db = drizzle(env.DB);
    const [row] = await db.select().from(isps).where(eq(isps.email, EMAIL));
    expect(row.emailVerified).toBe(false);
    expect(row.passwordHash).toBe("h1");
  });

  it("taken email returns 409 EMAIL_TAKEN", async () => {
    await seedIsp({ email: EMAIL });
    const res = await (await app()).request(
      "/auth/signup",
      json({ name: "Otro", email: EMAIL, password: "devolada123" }),
      env,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EMAIL_TAKEN");
  });

  it("malformed payload returns 400", async () => {
    const res = await (await app()).request(
      "/auth/signup",
      json({ email: "no-es-correo", password: "x" }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("verify-email with a valid token marks the ISP verified and signs in", async () => {
    await seedIsp({ email: EMAIL, emailVerified: false });
    mockIdp("/auth/verify", { body: { success: true, data: idpTokens(EMAIL) } });

    const res = await (await app()).request("/auth/verify-email", json({ token: "tok-1" }), env);
    expect(res.status).toBe(200);
    expect((await res.json()).data.emailVerified).toBe(true);

    const db = drizzle(env.DB);
    const [row] = await db.select().from(isps).where(eq(isps.email, EMAIL));
    expect(row.emailVerified).toBe(true);
  });

  it("verify-email with an invalid token returns 400 INVALID_TOKEN", async () => {
    mockIdp("/auth/verify", { status: 400, body: idpError("HTTP_EXCEPTION", "Invalid token") });
    const res = await (await app()).request("/auth/verify-email", json({ token: "bad" }), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_TOKEN");
  });

  it("resend-verification needs an ISP session", async () => {
    await seedIsp({ email: EMAIL, emailVerified: false });
    mockIdp("/auth/initiate", {
      body: { success: true, data: { token: "tok-2", magicLink: "https://ignored" } },
    });

    const withSession = await (await app()).request(
      "/auth/resend-verification",
      { method: "POST", headers: { Cookie: sessionCookieHeader(EMAIL) } },
      env,
    );
    expect(withSession.status).toBe(200);

    const anonymous = await (await app()).request(
      "/auth/resend-verification",
      { method: "POST" },
      env,
    );
    expect(anonymous.status).toBe(401);
  });
});

describe("US-S06: ISP recovers their password", () => {
  it("recover responds an identical 200 for existing and unknown emails", async () => {
    await seedIsp({ email: EMAIL });
    mockIdp("/auth/initiate", {
      body: { success: true, data: { token: "tok-3", magicLink: "https://ignored" } },
    });

    const existing = await (await app()).request("/auth/recover", json({ email: EMAIL }), env);
    const unknown = await (await app()).request(
      "/auth/recover",
      json({ email: "nadie@isp.mx" }),
      env,
    );
    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await existing.json()).toEqual(await unknown.json());
  });

  it("reset-password replaces the hash, verifies the email and signs in", async () => {
    await seedIsp({ email: EMAIL, emailVerified: false, passwordHash: "old", passwordSalt: "old" });
    mockIdp("/auth/verify", { body: { success: true, data: idpTokens(EMAIL) } });
    mockIdp("/auth/hash", { body: { success: true, data: { hash: "h2", salt: "s2" } } });

    const res = await (await app()).request(
      "/auth/reset-password",
      json({ token: "tok-3", password: "nueva-clave-1" }),
      env,
    );
    expect(res.status).toBe(200);
    expect(cookiesOf(res).join(";")).toContain("gm_access=");

    const db = drizzle(env.DB);
    const [row] = await db.select().from(isps).where(eq(isps.email, EMAIL));
    expect(row.passwordHash).toBe("h2");
    expect(row.emailVerified).toBe(true);
  });
});
