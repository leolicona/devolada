import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { rateLimit } from "../src/db/schema";
import { app, json } from "./helpers";

/* better-auth.spec.md D11 (US-S04, US-S06): the limiter is on by
   construction and counts in D1. The suite pins AUTH_RATE_LIMIT=off in
   vitest.config.ts; these tests hand the app an env without the pin.

   passwordless-access US2 (D3, FR-027): the doors are códigos now. Asking
   for one keeps the email-OTP plugin's 3 per 60 s — what stops a script
   from filling an inbox; typing one gets 5 per 60 s, so a person who
   mistyped twice can still paste it. The password door's cases left with
   the door (D4). */

const armed = () => {
  const { AUTH_RATE_LIMIT: _off, ...rest } = env as unknown as Record<string, unknown>;
  return rest;
};

const requestCode = async (bindings: unknown) =>
  (await app()).request("/auth/email-otp/send-verification-otp", json({ email: "ana@negocio.mx", type: "sign-in" }), bindings);
const enter = async (bindings: unknown) =>
  (await app()).request("/auth/sign-in/email-otp", json({ email: "ana@negocio.mx", otp: "000000" }), bindings);

describe("passwordless-access US2 — the código doors are limited, and the count lives in D1 (D3)", () => {
  it("a fourth código request within a minute answers 429, with when to come back", async () => {
    for (let i = 0; i < 3; i++) expect((await requestCode(armed())).status).toBe(200);

    const fourth = await requestCode(armed());
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get("x-retry-after")).toBeTruthy();

    const rows = await drizzle(env.DB).select().from(rateLimit);
    expect(rows.some((r) => r.key.endsWith("|/email-otp/send-verification-otp") && r.count === 3)).toBe(true);
  });

  it("typing a código gets five tries a minute: the sixth answers 429", async () => {
    for (let i = 0; i < 5; i++) expect((await enter(armed())).status).not.toBe(429);
    expect((await enter(armed())).status).toBe(429);
  });

  it("the code check of the store's verification keeps its own rule: the sixth verify-email in a minute answers 429", async () => {
    const attempt = async () =>
      (await app()).request("/auth/email-otp/verify-email", json({ email: "nadie@business.mx", otp: "000000" }), armed());
    for (let i = 0; i < 5; i++) expect((await attempt()).status).not.toBe(429);
    expect((await attempt()).status).toBe(429);
  });

  it("the suite's pin disarms both doors under AUTH_RATE_LIMIT=off", async () => {
    for (let i = 0; i < 4; i++) expect((await requestCode(env)).status).toBe(200);
    for (let i = 0; i < 6; i++) expect((await enter(env)).status).not.toBe(429);
  });
});
