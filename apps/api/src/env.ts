export type Bindings = {
  DB: D1Database;
  /* Service binding in production; dev falls back to HTTP via AUTH_BASE_URL */
  AGNOSTIC_AUTH_API?: Fetcher;
  AUTH_BASE_URL: string;
  AUTH_APP_ID: string;
  /* HS256 secret agnostic-auth signs JWTs with.
     Without it (dev only) tokens are decoded without signature verification. */
  AUTH_JWT_SECRET?: string;
  COOKIE_DOMAIN?: string;
  ENVIRONMENT?: "dev" | "prod";
  /* Comma-separated list of frontend origins allowed by CORS (TD-007) */
  ALLOWED_ORIGINS?: string;
  /* "true" when frontends live on another site (*.workers.dev):
     cookies switch to SameSite=None + Secure */
  CROSS_SITE_COOKIES?: string;
  /* Base URL of the admin app, used to build magic links (spec D1) */
  ADMIN_BASE_URL: string;
  /* Base URL of the store PWA, used to build invitation links */
  TIENDA_BASE_URL: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /* Dev only: the seed copies this key into the demo ISP row.
     In real use, every ISP stores its own key in isps.wisphub_api_key. */
  WISPHUB_API_KEY?: string;
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
