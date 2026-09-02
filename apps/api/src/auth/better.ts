import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { organization } from "better-auth/plugins/organization";
import { eq } from "drizzle-orm";
import { passkey } from "@better-auth/passkey";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import * as authSchema from "../db/auth-schema";
import { sendAuthCode, sendMemberInvitation } from "../email/sender";
import { ac, pluginRoles } from "./roles";

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const ONE_DAY = 60 * 60 * 24;
/* business-and-memberships D8 (owner, 2026-09-02): 48 hours, written —
   the plugin's default happens to be the same number, and a guarantee
   that lives in a default is not ours (D11's lesson). */
const INVITATION_TTL = 60 * 60 * 48;

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

  const db = drizzle(env.DB);
  return betterAuth({
    baseURL: env.API_BASE_URL ?? "http://localhost:8787",
    basePath: "/auth",
    secret: env.BETTER_AUTH_SECRET ?? "devolada-dev-only-insecure-secret",
    database: drizzleAdapter(db, { provider: "sqlite", schema: authSchema }),
    trustedOrigins: exactOrigins,
    emailAndPassword: { enabled: true },
    /* D11: the limiter is explicit, never inherited. Better Auth turns it
       on only under NODE_ENV=production and keeps counters in memory — on
       Workers that is an isolate that forgets every few minutes, and a
       deploy whose NODE_ENV nobody set. Counters live in D1 (the
       `rateLimit` table); the address comes from Cloudflare's own header
       first — the default list has only x-forwarded-for, and with no
       address every visitor shares one bucket. Better Auth's built-in
       rules stay (sign-in 3/10s, code requests 3/60s); ours cover the
       code checks and the invitation door, which have no built-in rule. */
    rateLimit: {
      enabled: env.AUTH_RATE_LIMIT !== "off",
      storage: "database",
      customRules: {
        "/email-otp/verify-email": { window: 60, max: 5 },
        "/email-otp/reset-password": { window: 60, max: 5 },
        "/organization/accept-invitation": { window: 60, max: 10 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
    },
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
    /* business-and-memberships D4 (spike 3): one membership does not
       activate itself on sign-in; this hook does it, so the common user
       never meets a one-item switcher. */
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const rows = await db
              .select({ organizationId: authSchema.member.organizationId })
              .from(authSchema.member)
              .where(eq(authSchema.member.userId, session.userId));
            return rows.length === 1
              ? { data: { ...session, activeOrganizationId: rows[0].organizationId } }
              : { data: session };
          },
        },
      },
    },
    plugins: [
      /* One organization per business — its auth twin (spec D1/D2).
         Roles derive from the matrix in roles.ts (spike finding 2). */
      organization({
        ac,
        roles: pluginRoles,
        creatorRole: "owner",
        invitationExpiresIn: INVITATION_TTL,
        async sendInvitationEmail(data) {
          try {
            await sendMemberInvitation(env, data.email, {
              businessName: data.organization.name,
              role: data.role,
              inviterName: data.inviter.user.name,
              invitationId: data.id,
            });
          } catch (e) {
            console.error("member invitation email failed", e);
          }
        },
      }),
      emailOTP({
        /* The business signup route sends the code itself (D13): a user
           born through an invitation (D14) is verified by the invitation
           and must not receive a code for nothing. */
        sendVerificationOnSignUp: false,
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
