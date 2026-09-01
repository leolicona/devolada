export type Bindings = {
  DB: D1Database;
  ENVIRONMENT?: "dev" | "prod";
  /* Provider credentials (validation spec D2). Token is a worker secret;
     base URL is overridable so tests and a future sandbox can point
     elsewhere. Unset base → the real apiCEP. */
  APICEP_TOKEN?: string;
  APICEP_BASE_URL?: string;
  /* D16 deadline override, in ms. Unset → 25 s, strictly under the
     caller's 30 s. Exists so tests can make a mock hang cheaply. */
  APICEP_DEADLINE_MS?: string;
  /* Guards /admin/keys (validation spec D5). Unset → the routes 404. */
  CONSTA_ADMIN_TOKEN?: string;
  /* D5 amendment (payments-and-classes D7): opens ONLY POST /admin/keys.
     The SaaS mints keys for its businesses and nothing else — a
     compromised issuer must never become the admin of every tenant. */
  CONSTA_ISSUER_TOKEN?: string;
  /* The receipt reader (proof-extraction D1, D5). Unset binding → the image
     route degrades to the provider's OCR rather than failing: a door that
     still works beats a door that 500s. */
  AI?: Ai;
  EXTRACTION_MODEL?: string;
};

export type Variables = {
  /* Set by the API-key middleware; every validation is logged under it */
  apiKey: { id: string; name: string };
};
