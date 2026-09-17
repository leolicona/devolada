export type Bindings = {
  DB: D1Database;
  /* Private bucket for SPEI transfer proofs (direct-payment spec D12):
     objects are served only through short-lived signed URLs. */
  PROOFS: R2Bucket;
  /* Signs Better Auth's sessions and tokens. Missing → a public dev
     value with a loud warning; CI refuses to deploy without it. */
  BETTER_AUTH_SECRET?: string;
  /* This API's own public URL — Better Auth builds absolute URLs with it */
  API_BASE_URL?: string;
  /* WebAuthn relying-party id (better-auth.spec.md D7).
     Unset → localhost (local dev). */
  PASSKEY_RP_ID?: string;
  ENVIRONMENT?: "dev" | "prod";
  /* "off" disarms Better Auth's rate limiter (better-auth.spec.md D11).
     Set ONLY by the API test suite, whose hundreds of sign-ins share one
     address; no wrangler environment defines it, so every deploy limits. */
  AUTH_RATE_LIMIT?: "off";
  /* Comma-separated list of frontend origins allowed by CORS (TD-007).
     CORS stays (different origins) but cookies are same-site now: every
     surface lives under devoladapago.com (spec D7). */
  ALLOWED_ORIGINS?: string;
  /* Base URL of the admin app (es-MX copy in emails may reference it) */
  ADMIN_BASE_URL: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /* Dev only: the seed copies this key into the demo ISP row.
     In real use, every ISP stores its own key in businesses.wisphub_api_key. */
  WISPHUB_API_KEY?: string;
  /* Points the adapter at a sandbox; unset means the real API */
  WISPHUB_BASE_URL?: string;
  /* The SPEI validation engine (Consta) runs inside this Worker
     (consta-api-merge D1, D9). What can be absent is the provider's
     credential, never the engine.
     APICEP_TOKEN — worker secret (validation spec D2). Unset → the SPEI
     channel is unavailable: `speiAvailable` is false, the link answers
     `unavailable` and the page says so; a payment already in flight
     retries as PROVIDER_NOT_CONFIGURED and rides the schedule. */
  APICEP_TOKEN?: string;
  /* Overridable so the local sandbox (`pnpm --filter @devolada/api
     sandbox`) can stand in for the provider. Unset → the real apiCEP.
     Tests pin it to the mocked origin (constitution IV). */
  APICEP_BASE_URL?: string;
  /* validation spec D16 deadline override, in ms. Unset → 25 s — the one
     deadline a provider call carries now that engine and caller are one
     process (consta-api-merge D10). Exists so tests can make a mock hang
     cheaply. */
  APICEP_DEADLINE_MS?: string;
  /* The receipt reader (proof-extraction D1, D5). Unset binding → the
     image route degrades to the provider's OCR rather than failing: a
     door that still works beats a door that 500s. */
  AI?: Ai;
  /* proof-extraction D5: the reader's model is config, not a literal, so
     replacing it is a deploy and not a release. Unset → the reader's
     DEFAULT_MODEL. */
  EXTRACTION_MODEL?: string;
  /* Base URL of the public payment page, used to build link URLs */
  PAGO_BASE_URL: string;
  /* operator-panel D2: comma-separated emails of the platform operators.
     Never grantable from a screen; changing it is a deploy. */
  PLATFORM_OPERATOR_EMAILS?: string;
};

export type Role = "owner" | "admin" | "operator" | "viewer";

/* business-and-memberships D4: the actor is the user inside its active
   business, with the role its membership carries. Flat display fields
   ride along so no screen needs a second request (settings D7). */
export type Actor = {
  type: "business";
  /* The business (tenant) id — what every business table keys on */
  id: string;
  orgId: string;
  name: string;
  userId: string;
  /* account-hub D2: the person behind the session, for the avatar's
     initials and the hub's identity card — one request, not two */
  userName: string;
  email: string;
  emailVerified: boolean;
  status: "active" | "suspended";
  role: Role;
  timezone: string;
  timeFormat: "12h" | "24h";
  /* integrations-hub D10: any provider — the shell never names one */
  integrationConfigured: boolean;
  /* business-and-memberships D5 (2026-09-02): a business is born without
     a CLABE; the shell's banner and the share buttons read this */
  speiConfigured: boolean;
  /* integrations-hub D4: connected with actions off — the shell chip.
     Every role sees it: a paused hand is context everyone reading Pagos
     needs. */
  observing: boolean;
  /* Every business this user belongs to — the switcher's list (US-B02) */
  businesses: { id: string; orgId: string; name: string; role: Role }[];
  /* operator-panel D2: derived from the secret, per request (a string
     compare — no query) */
  platformOperator: boolean;
};

export type Variables = {
  actor: Actor;
};
