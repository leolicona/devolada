export type Bindings = {
  DB: D1Database;
  ENVIRONMENT?: "dev" | "prod";
  /* Provider credentials (validation spec D2). Token is a worker secret;
     base URL is overridable so tests and a future sandbox can point
     elsewhere. Unset base → the real apiCEP. */
  APICEP_TOKEN?: string;
  APICEP_BASE_URL?: string;
  /* Guards /admin/keys (validation spec D5). Unset → the routes 404. */
  CONSTA_ADMIN_TOKEN?: string;
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
