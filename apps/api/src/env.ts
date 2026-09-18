import type { businesses } from "./db/schema";

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
  /* Which WispHub installation the adapter talks to. WispHub runs more
     than one, and a tenant's key is valid only on its own: the pilot ISP
     signs in at wisphub.io, whose API host is a different server than
     the wisphub.net one this defaults to, so a perfectly good key is
     rejected against the wrong host. Unset → wisphub.net
     (`DEFAULT_BASE_URL` in wisphub/client.ts), which is where the demo
     tenant and the local sandbox live. Platform-wide, so it can name one
     installation for all tenants at once — the address really belongs on
     the business's integration row (debt `wisphub-host-is-platform-wide`). */
  WISPHUB_BASE_URL?: string;
  /* The SPEI validation engine (Consta) runs inside this Worker
     (consta-api-merge D1, D9). What can be absent is the provider's
     credential, never the engine.
     APICEP_TOKEN — worker secret (validation spec D2). Unset → the SPEI
     channel is unavailable: `validationAvailable` is false, the payer's
     link answers `unavailable` and the page says so; a payment already in
     flight retries as PROVIDER_NOT_CONFIGURED and rides the schedule.
     automated-collections-api D5: a platform condition, never the
     business's — /v1 still creates its link and attaches a
     VALIDATION_UNAVAILABLE notice rather than refusing it. */
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
  /* automated-collections-api D10: the platform's webhook signing keys —
     a JSON array of private JWKs (EC P-256), each with a `kid` and an
     optional `retiredAt` (ISO 8601 or ms). The one without `retiredAt`
     signs; the retired ones stay published in /.well-known/jwks.json for
     7 days so a delivery signed before the change still verifies
     (FR-039). A Worker secret, never a D1 row. Unset → outcomes are still
     recorded and deliveries still enqueued, but none is attempted: each
     row reads SIGNING_KEY_MISSING, the sweep warns once per run, the
     panel says signing is not configured and the key set is empty
     (constitution VIII). Tests pin a fixed pair in vitest.config.ts. */
  WEBHOOK_SIGNING_KEYS?: string;
  /* automated-collections-api D8 (FR-016): how long one delivery waits
     for a 2xx, in ms. Unset → 10 s, the number the spec carries. Exists
     so tests can make a mock destination hang cheaply, exactly like
     APICEP_DEADLINE_MS; no wrangler environment sets it. */
  WEBHOOK_DELIVERY_TIMEOUT_MS?: string;
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

/* automated-collections-api D11 (plan, Complexity Tracking): the second
   kind of actor — the business's own software holding a credential, not
   a person holding a membership. It resolves to exactly one business,
   carries no role and never passes through `requireArea`; every /v1
   query filters by `businessId`. Set by `requireApiCredential`. */
export type ApiClient = {
  type: "api";
  credentialId: string;
  businessId: string;
  /* automated-collections-api D12: a test credential creates test links
     and test payments — readable through the API, invisible to every
     real total */
  isTest: boolean;
  /* The business row, read in the same query as the credential so no
     handler needs a second lookup for the CLABE, the status or the
     timezone */
  business: typeof businesses.$inferSelect;
};

export type Variables = {
  actor: Actor;
  apiClient: ApiClient;
};
