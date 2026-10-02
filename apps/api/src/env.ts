import type { businesses } from "./db/schema";
import type { CapabilityName } from "./integrations/capabilities";

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
     address, and by the passkey layer's local API (playwright.passkey.config.ts,
     passwordless-access D3: its journeys ask several códigos a minute from
     one address); no wrangler environment defines it, so every deploy
     limits. */
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
  /* The platform's DEFAULT WispHub installation — no longer an
     override (provider-address-per-isp D5).

     WispHub runs more than one installation and a tenant's key is valid
     only on its own, so a perfectly good key is rejected against the
     wrong host. That address now belongs to the business: each
     `integrations` row stores an installation key and `wisphubFor`
     resolves it. This binding answers only for a row that chose nothing
     — the second rung of `integration.installation` → this → wisphub.net
     — so a business that chose is never overridden by config again.

     Unset → wisphub.net (`DEFAULT_BASE_URL` in wisphub/client.ts, the
     catalogue's default entry), where the demo tenant lives. Nothing
     breaks when it is absent; that absence is in fact the intended
     state, and both remote environments are meant to carry no value
     (see the removal in wrangler.jsonc). While a value IS set it still
     decides for every business that recorded nothing, which is why it
     leaving and the pilot's row being set must ship together — debt
     `wisphub-host-is-platform-wide`.

     Value form: a full API base, e.g. `https://api.wisphub.net/api`.
     Local development only, and a value outside the compiled catalogue
     cannot be described to the panel (the screen names the default
     instead), which is one more reason for it to stay unset. */
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
  /* cep-bundle-match D16: the origin of the provider's storage, the only
     place a bundle of CEPs is downloaded from (a "several matches"
     answer links a ZIP there — measured 2026-09-26). A var in
     wrangler.jsonc for local, dev and prod, with no URL written in code
     (constitution VIII). Unset → no bundle is ever downloaded: the
     payment goes undecided and the payer is asked for the clave. A link
     on any other origin is never fetched, set or not. `.dev.vars` points
     it at the sandbox (http://localhost:8789); tests pin it. */
  APICEP_STORAGE_ORIGIN?: string;
  /* The receipt reader (proof-extraction D1, D5), and since
     two-eyes-receipt D1 the PDF-to-text conversion beside it: the same
     binding's `toMarkdown` turns a PDF into text, which the same model
     then reads, so a PDF gets the same draft, the same gate and the same
     protections as a photograph.

     Unset → the receipt still goes to the provider's image door, with no
     reading of ours beside it (D3): the payer's page never blocks, and a
     PDF is handed over unread. What is lost is the second pair of eyes —
     a `not_found` classifies as `blind` on our side (FR-005), so the
     payer is asked rather than the machines agreeing for free. A door
     that still works beats a door that 500s (constitution VIII).

     receipt-triage D15, D22: unset also means no reading of ours to ask
     from and nothing to tie a destination with — no capture is stopped
     for a missing key or a foreign account, no reference comes from our
     side, and no other registered account is chosen: the file goes to the
     provider named with the cuenta de cobro. The provider's own reading
     still counts, its reference included, when the comparison runs. */
  AI?: Ai;
  /* proof-extraction D5, receipt-reader-tuning D1/D7: the **default**
     reader model — always in the allowed list, what reads when no choice
     was made, and the fallback when a chosen model fails (D11). Unset →
     the reader's DEFAULT_MODEL. Which model reads is the operator's
     choice in /operador → Lector, among `EXTRACTION_MODELS`. */
  EXTRACTION_MODEL?: string;
  /* receipt-reader-tuning D7: the environment's allowed reader models, a
     JSON var of `{ id, label, input? }[]` — `input` is merged into the
     model call (D10). Wrangler hands a JSON var over already parsed,
     hence `unknown`. The default is always prepended when missing. Unset
     → the default alone, which is the reader before this feature; invalid
     → the same, with one warning per isolate (constitution VIII). */
  EXTRACTION_MODELS?: unknown;
  /* receipt-reader-tuning D11: how long a *chosen* model that is not the
     default may take before the default reads instead. Unset → 8000 ms:
     the default answers in ~2.7 s (measured 2026-08-19), so a chosen model
     past 8 s is failing, and the payer's worst case stays near 11 s
     (research R6). A test knob — never set by a deploy. */
  READER_TIMEOUT_MS?: string;
  /* Base URL of the public payment page, used to build link URLs */
  PAGO_BASE_URL: string;
  /* cash-at-stores D4, D29: the store app's address, where a store's
     invitation link lands (`${RED_BASE_URL}/invitacion/<token>`). Set per
     environment in wrangler.jsonc, beside PAGO_BASE_URL. Unset → the
     local dev server (http://localhost:5177) with a warning: the operator
     panel shows the link it got, and says when it points at a local
     machine rather than the store app, so a wrong deploy is never sent to
     a shopkeeper silently (constitution VIII). */
  RED_BASE_URL?: string;
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
     Never grantable from a screen; changing it is a deploy.
     landing-page D10: also where the landing page's access requests are
     announced — one email per request, the outcome written on the row. */
  PLATFORM_OPERATOR_EMAILS?: string;
  /* landing-page D6: where the landing page lives, for the request door's
     second answer. A plain HTML form post (no script in the visitor's
     browser) is answered with a 303 to `${LANDING_BASE_URL}/gracias` or
     `/no-enviada?motivo=<code>` — a browser navigating a form needs a page,
     not an envelope. Unset → the form post is answered with the envelope
     exactly as a JSON request is (a developer's machine; constitution
     VIII). Tests pin a value in vitest.config.ts and strip it for the
     unset behaviour. */
  LANDING_BASE_URL?: string;
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
  /* cobros-in-links D13 (constitution IX): what the integration can do,
     by capability name, so the panel offers a feature because the
     integration can answer it — never because it is one provider.
     Empty with no integration. */
  integrationCapabilities: CapabilityName[];
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
  /* cash-at-stores D7, D23: the store channel, from the business row
     already loaded. `since` shows Puntos de pago from the first switch
     on, and keeps it after (FR-034). */
  storeChannel: { on: boolean; since: number | null };
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

/* cash-at-stores D2: the store actor — a shopkeeper, a Better Auth user
   who belongs to no business. Resolved by `requireStore` from its own
   `stores` row on every request, never from a membership; a business
   route refuses it (`requireSession` answers WRONG_ACTOR). Only an
   `active` store becomes an actor: a suspended one is refused with
   STORE_SUSPENDED and an invited one with WRONG_ACTOR. It carries no
   role and no `platformOperator` (constitution V's store bullet). */
export type StoreActor = {
  type: "store";
  storeId: string;
  userId: string;
  /* The store's name, for the app's header */
  name: string;
  status: "active";
};

export type Variables = {
  actor: Actor;
  apiClient: ApiClient;
  store: StoreActor;
};
