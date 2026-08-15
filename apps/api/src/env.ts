export type Bindings = {
  DB: D1Database;
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
  /* Base URL of the store PWA, used to build invitation links */
  TIENDA_BASE_URL: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /* Dev only: the seed copies this key into the demo ISP row.
     In real use, every ISP stores its own key in isps.wisphub_api_key. */
  WISPHUB_API_KEY?: string;
  /* Points the adapter at a sandbox; unset means the real API */
  WISPHUB_BASE_URL?: string;
};

export type Actor =
  | {
      type: "store";
      id: string;
      ispId: string;
      name: string;
      phone: string;
      status: "invited" | "active" | "suspended";
    }
  | {
      type: "isp";
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
      status: "active" | "suspended";
      /* Settings D7: they ride the session, so no screen needs a second
         request before it can render a time or a banner */
      timezone: string;
      timeFormat: "12h" | "24h";
      wisphubConfigured: boolean;
    };

export type Variables = {
  actor: Actor;
};
