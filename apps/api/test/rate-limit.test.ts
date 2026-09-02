import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { rateLimit } from "../src/db/schema";
import { app, json, seedBusiness, PASSWORD } from "./helpers";

/* better-auth.spec.md D11 (US-S04, US-S06): the limiter is on by
   construction and counts in D1. The suite pins AUTH_RATE_LIMIT=off in
   vitest.config.ts; these tests hand the app an env without the pin. */

const armed = () => {
  const { AUTH_RATE_LIMIT: _off, ...rest } = env as unknown as Record<string, unknown>;
  return rest;
};

const signIn = async (password: string, bindings: unknown) =>
  (await app()).request("/auth/sign-in/email", json({ email: "demo@devolada.app", password }), bindings);

describe("D11: the limiter is armed unless told otherwise, and counts in D1", () => {
  it("a fourth sign-in within ten seconds answers 429, and the count lives in rate_limit", async () => {
    await seedBusiness();
    for (let i = 0; i < 3; i++) expect((await signIn("wrong-password", armed())).status).toBe(401);

    const fourth = await signIn(PASSWORD, armed());
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get("x-retry-after")).toBeTruthy();

    const rows = await drizzle(env.DB).select().from(rateLimit);
    expect(rows.some((r) => r.key.endsWith("|/sign-in/email") && r.count === 3)).toBe(true);
  });

  it("the code check has its own rule: the sixth verify-email in a minute answers 429", async () => {
    const attempt = async () =>
      (await app()).request("/auth/email-otp/verify-email", json({ email: "nadie@business.mx", otp: "000000" }), armed());
    for (let i = 0; i < 5; i++) expect((await attempt()).status).not.toBe(429);
    expect((await attempt()).status).toBe(429);
  });

  it("the suite's pin disarms it: the fourth sign-in passes under AUTH_RATE_LIMIT=off", async () => {
    await seedBusiness();
    for (let i = 0; i < 3; i++) expect((await signIn("wrong-password", env)).status).toBe(401);
    expect((await signIn(PASSWORD, env)).status).toBe(200);
  });
});
