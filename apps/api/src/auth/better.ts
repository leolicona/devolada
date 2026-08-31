import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import * as authSchema from "../db/auth-schema";
import { sendAuthCode } from "../email/sender";

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const ONE_DAY = 60 * 60 * 24;

/* Better Auth instance (better-auth.spec.md). Per-request construction is
   the Workers pattern: the D1 binding only exists inside a request. */
export function makeAuth(env: Bindings) {
  if (!env.BETTER_AUTH_SECRET) {
    /* Same posture as the email sender: local dev works loudly unsafe;
       deployed environments get the secret from CI, which refuses to
       deploy without it. */
    console.warn("BETTER_AUTH_SECRET missing: sessions signed with a public dev value");
  }

  /* Suffix patterns (per-PR previews) stay in CORS; Better Auth's origin
     check gets the exact origins only. */
  const exactOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .filter(Boolean)
    .filter((o) => !o.startsWith("*"));

  return betterAuth({
    baseURL: env.API_BASE_URL ?? "http://localhost:8787",
    basePath: "/auth",
    secret: env.BETTER_AUTH_SECRET ?? "devolada-dev-only-insecure-secret",
    database: drizzleAdapter(drizzle(env.DB), { provider: "sqlite", schema: authSchema }),
    trustedOrigins: exactOrigins,
    emailAndPassword: { enabled: true },
    /* 30-day sliding window in both apps (spec D5). The cookie session
       cache stays off: the middleware's per-request DB check IS the
       suspension guarantee (US-S03), so caching would only delay it. */
    session: {
      expiresIn: THIRTY_DAYS,
      updateAge: ONE_DAY,
      cookieCache: { enabled: false },
    },
    /* No cross-site cookie machinery (spec D7): every surface lives
       under devoladapago.com, so the session cookie travels same-site.
       Chrome's third-party cookie blocking killed the SameSite=None
       setup in real browsers — measured 2026-08-15, login looped back
       to login while curl worked. */
    plugins: [
      emailOTP({
        sendVerificationOnSignUp: true,
        async sendVerificationOTP({ email, otp, type }) {
          /* Never throw: onboarding and recovery must not depend on the
             email provider (spec D8; same law as the old sender). */
          try {
            await sendAuthCode(env, type, email, otp);
          } catch (e) {
            console.error(`auth code email failed (${type})`, e);
          }
        },
      }),
      passkey({
        rpID: env.PASSKEY_RP_ID ?? "localhost",
        rpName: "Devolada",
        origin: exactOrigins.length ? exactOrigins : undefined,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof makeAuth>;
