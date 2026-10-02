import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { organization } from "better-auth/plugins/organization";
import { username } from "better-auth/plugins/username";
import { eq } from "drizzle-orm";
import { passkey } from "@better-auth/passkey";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import * as authSchema from "../db/auth-schema";
import { stores, verification } from "../db/schema";
import { sendAuthCode, sendMemberInvitation } from "../email/sender";
import { ac, pluginRoles } from "./roles";

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const ONE_DAY = 60 * 60 * 24;
/* business-and-memberships D8 (owner, 2026-09-02): 48 hours, written —
   the plugin's default happens to be the same number, and a guarantee
   that lives in a default is not ours (D11's lesson). */
const INVITATION_TTL = 60 * 60 * 48;

/* cash-at-stores D2: a shopkeeper is the user a store row names. Read
   per request, never cached: the store's own status is checked on every
   action (FR-014), and this answers the cheaper question beside it. */
export async function isStoreUser(db: ReturnType<typeof drizzle>, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: stores.id }).from(stores).where(eq(stores.userId, userId)).limit(1);
  return Boolean(row);
}

/* cash-at-stores D3: the shopkeeper's phone lives in `user.username`, and
   no request may write it. Measured M1, 2026-10-01, against 1.6.29's dist:
   besides `/sign-up/email` and `/update-user`, `/sign-in/email-otp` creates
   a user from any extra body field, and the plugin's own sign-up hook
   copies a `displayUsername` into `username` — so the refusal covers every
   path and both fields.
   passwordless-access D4 (PR 2): the one path left out, `/sign-in/username`
   (the phone-and-password door), is in `disabledPaths`, so no request may
   carry a username any more. Only the store acceptance route writes the
   column, directly (D10). The set stays so a door re-opened by mistake
   would still be the only one. */
const USERNAME_INPUT_PATHS = new Set(["/sign-in/username"]);

/* passwordless-access analysis A3: the two doors that take a person's name
   from a request — the registration's código (`/sign-in/email-otp`) and
   `/welcome`'s question (`/update-user`). The screens check it first; this is
   the server's half of data-model.md's rule. */
const NAME_INPUT_PATHS = new Set(["/sign-in/email-otp", "/update-user"]);
const NAME_MIN = 2;
const NAME_MAX = 80;

/* The plugin's own kinds of código (email-otp `routes.mjs`, `types`): only
   these name an identifier the plugin writes. passwordless-access D4 (PR 2):
   only `sign-in` has a door left; the other two stay listed so a request
   for one still ends that kind's previous código. */
const OTP_TYPES = new Set(["email-verification", "sign-in", "forget-password"]);

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
    /* passwordless-access D4 (PR 2): no password door is left, so the
       password machinery is off. With it go better-auth D16's
       `requireEmailVerification` and D17's `revokeSessionsOnPasswordReset`
       — both guarded doors that no longer exist — and
       `emailVerification.autoSignInAfterVerification`, read only by the
       email-OTP plugin's `verify-email`, disabled below. Every person enters
       through the código (`/sign-in/email-otp`, D1), which births the
       account verified or verifies a legacy one. The middleware's own check
       stays: a session whose user is unverified is revoked (better-auth
       D16's belt). */
    emailAndPassword: { enabled: false },
    disabledPaths: [
      /* cash-at-stores D3: whether a phone is a store's is nobody's to probe */
      "/is-username-available",
      /* passwordless-access D4: no account can be created with a password —
         registration is the código door (D1). Better Auth answers 404 from
         its router, so the server's own `auth.api.*` calls keep the path
         (measured 2026-10-02, M3). */
      "/sign-up/email",
      /* passwordless-access D4 (PR 1): the panel's password door */
      "/sign-in/email",
      /* passwordless-access D4 (PR 2): the store app's phone and password —
         the shopkeeper signs in by phone and código now (D10) */
      "/sign-in/username",
      /* passwordless-access D4 (PR 2): password recovery, both the plugin's
         paths and the old alias. There is no password to recover. */
      "/email-otp/request-password-reset",
      "/email-otp/reset-password",
      "/forget-password/email-otp",
      /* passwordless-access D4 (PR 2): the old verification door (better-auth
         D16). The sign-in código verifies the address itself (D1). */
      "/email-otp/verify-email",
      /* passwordless-access D4 (PR 2): over HTTP it would tell a stranger
         whether an address has an account once they hold its código. The
         store acceptance still calls it from the server (D10), which this
         list does not reach. */
      "/email-otp/check-verification-otp",
    ],
    hooks: {
      /* cash-at-stores D3: see USERNAME_INPUT_PATHS. Runs before every
         plugin's hooks (1.6.29 `getHooks`: the user hook first). */
      before: createAuthMiddleware(async (ctx) => {
        const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : undefined;
        if (!USERNAME_INPUT_PATHS.has(ctx.path) && body && ("username" in body || "displayUsername" in body)) {
          throw new APIError("BAD_REQUEST", { code: "USERNAME_NOT_ALLOWED", message: "USERNAME_NOT_ALLOWED" });
        }

        /* passwordless-access D2: a new request ends the previous código.
           The plugin only adds a row, and its rows' `created_at` is stored
           to the second — measured 2026-10-02 (M4): códigos A then B asked
           for in the same second tie, and the plugin checked A, so A opened
           a session while B was live. Deleting the address's rows of that
           kind before the plugin writes the new one leaves one live código
           per address, so there is no tie to lose. */
        if (ctx.path === "/email-otp/send-verification-otp" && body) {
          const { email, type } = body;
          if (typeof email === "string" && typeof type === "string" && OTP_TYPES.has(type)) {
            await db.delete(verification).where(eq(verification.identifier, `${type}-otp-${email.toLowerCase()}`));
          }
        }

        /* analysis A3: see NAME_INPUT_PATHS. Stored trimmed. */
        if (NAME_INPUT_PATHS.has(ctx.path) && body && "name" in body) {
          const name = typeof body.name === "string" ? body.name.trim() : "";
          if (name.length < NAME_MIN || name.length > NAME_MAX) {
            throw new APIError("BAD_REQUEST", { code: "INVALID_NAME", message: "INVALID_NAME" });
          }
          return { context: { body: { ...body, name } } };
        }
      }),
    },
    /* D11: the limiter is explicit, never inherited. Better Auth turns it
       on only under NODE_ENV=production and keeps counters in memory — on
       Workers that is an isolate that forgets every few minutes, and a
       deploy whose NODE_ENV nobody set. Counters live in D1 (the
       `rateLimit` table); the address comes from Cloudflare's own header
       first — the default list has only x-forwarded-for, and with no
       address every visitor shares one bucket. Better Auth's built-in
       rule stays (`/sign-in/*` 3/10s). The email-OTP plugin sets 3/60s on
       its own paths — send-verification-otp, check-verification-otp,
       verify-email and sign-in/email-otp (read in 1.6.29's `index.mjs` on
       2026-10-02) — and `customRules` override it.
       passwordless-access D3: `/sign-in/email-otp` gets 5/60s. The
       plugin's 3 would stop a person who mistyped twice and then pasted
       the código, and three wrong tries already kill each código (D2).
       `send-verification-otp` keeps the plugin's 3/60s: it is what stops a
       script from filling an inbox. The rules for `verify-email` and
       `reset-password` left with their doors (D4, PR 2). */
    rateLimit: {
      enabled: env.AUTH_RATE_LIMIT !== "off",
      storage: "database",
      customRules: {
        "/sign-in/email-otp": { window: 60, max: 5 },
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
        /* cash-at-stores D2: a shopkeeper never creates a business — this
           door and `POST /businesses` both refuse (FR-013) */
        allowUserToCreateOrganization: async (user) => !(await isStoreUser(db, user.id)),
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
        /* passwordless-access D4: there is no password sign-up for this to
           follow; the plugin's default, written so nobody turns it on
           thinking it matters. Every código goes out because a person asked
           for one (D1, D10). */
        sendVerificationOnSignUp: false,
        /* passwordless-access D2: the código's terms, written. Each was a
           default nobody chose (read in 1.6.29's dist on 2026-10-02:
           `index.mjs` sets 300 s and plain text). Ten minutes is the
           creator's; three tries is what better-auth D11 already counted
           on; and a credential the product only ever compares is stored as
           a SHA-256 hash (constitution V) — `"hashed"` is the plugin's
           SHA-256, base64url, compared in constant time. */
        expiresIn: 600,
        allowedAttempts: 3,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp, type }) {
          /* Never throw: the door must not depend on the email provider
             (spec D8; same law as the old sender). "Reenviar código"
             retries. */
          try {
            await sendAuthCode(env, type, email, otp);
          } catch (e) {
            console.error(`auth code email failed (${type})`, e);
          }
        },
      }),
      /* cash-at-stores D3: owns the `user.username` column, where the
         store's phone lives. passwordless-access D4 (PR 2): it stays
         installed for the column alone — its sign-in path is disabled
         above, and `POST /store/sign-in` reads the column to find the
         store's email (D10). Removing it would change `auth-schema.ts`,
         which comes from the generator (better-auth D10). */
      username(),
      passkey({
        rpID: env.PASSKEY_RP_ID ?? "localhost",
        rpName: "Devolada",
        origin: exactOrigins.length ? exactOrigins : undefined,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof makeAuth>;
