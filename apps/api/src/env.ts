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
  /* Consta, the SPEI validation service (direct-payment spec). The base
     is env config, never hardcoded: Consta has no prod env yet by its
     own decision (consta validation spec D8). Key is a worker secret. */
  CONSTA_BASE_URL?: string;
  CONSTA_API_KEY?: string;
  /* provisional-release D4: secret behind the HMAC that pseudonymises
     the WispHub usuario before it travels to Consta as `customerRef`.
     Unset → no refs travel; validation is never blocked by it. */
  CUSTOMER_REF_SECRET?: string;
  /* TD-015, temporary: comma-separated payment-link tokens whose
     validation is simulated instead of asked of Banxico, so a demo can
     reach the green screen — a real CEP has no measured upper bound on
     publication (apicep.md). Read only when `ENVIRONMENT === "dev"`;
     prod never carries it. Deleted with TD-015. */
  DEMO_LINK_TOKENS?: string;
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
  email: string;
  emailVerified: boolean;
  status: "active" | "suspended";
  role: Role;
  timezone: string;
  timeFormat: "12h" | "24h";
  wisphubConfigured: boolean;
  /* Every business this user belongs to — the switcher's list (US-B02) */
  businesses: { id: string; orgId: string; name: string; role: Role }[];
  /* operator-panel D2: derived from the secret, per request */
  platformOperator: boolean;
  /* prepaid-credit D7: the chip renders from the session (settings D7 pattern) */
  credit: { balanceCents: number; step: "ok" | "low" | "empty" | "paused" };
};

export type Variables = {
  actor: Actor;
};
