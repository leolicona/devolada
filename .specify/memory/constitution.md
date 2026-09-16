<!--
Sync Impact Report (v1.3.0, 2026-09-16)
- Version change: 1.2.0 → 1.3.0 — MINOR: the fixed stack table shrinks by one
  Worker and one database, one bullet of Principle V is generalised and one
  added, and three sentences in III, IV and VIII stop naming a service that
  the code will no longer have. No principle removed or redefined, no
  renumbering. Built on v1.2.0 (PR #197, 003-automated-collections-api),
  whose Purpose sentence and `retryable` grant it keeps.
- Source: specs/004-consta-api-merge — plan.md Constitution Check and
  Complexity Tracking, research.md R3 and R14, decisions D3, D4, D11, D15;
  the /speckit-analyze run of 2026-09-12 (findings C1, C3). Governance
  requires a blocked feature's plan to propose the amendment rather than
  route around it; this is that amendment. As with v1.1.0, the amendment
  leads the implementation on purpose: the code catches up under
  specs/004-consta-api-merge/tasks.md.
- What this decides: Consta, the SPEI validation engine, stops being a
  Worker of its own with its own D1, API keys and secrets, and becomes a
  module of `apps/api`. Validation is attributed to the business (or to the
  platform, for its own top-ups) by `business_id`, not by a key. The engine
  keeps its name so every `consta … D<n>`, `proof-extraction D<n>`,
  `trust-layer D<n>` and `learned-retry D<n>` citation in the code keeps
  resolving.
- Modified sections:
  · Technology Stack & Constraints, API row — `apps/consta` removed; the
    engine is named inside `apps/api`.
  · Technology Stack & Constraints, Environments row — "Consta has no prod
    env until its first external consumer" removed; the engine deploys where
    the API deploys, and the provider credential decides whether it
    validates.
  · III. One Contract, Pure Routers — v1.2.0's grant of `message` and
    `retryable` to program-facing surfaces is kept whole; its example list
    shrinks from two surfaces to one. `apps/consta` was named for the routes
    it mounted and the eight places it sent `retryable`; after this
    amendment it mounts nothing and answers no caller over a wire. The
    engine's in-process failure carries `retryable`, which is not an
    envelope. `/v1/*` remains the surface the grant was written for.
  · IV. Tests Run on the Real Runtime — "API and Consta tests" → "API
    tests"; the intercepted providers no longer list Consta; one sentence
    added naming the receipt reader's Workers AI binding as the one binding
    tests stub (it has no local runtime and no origin to intercept) — the
    practice since proof-extraction, now written down (analyze C3).
  · V. Tenant Isolation and Authorization by Area — the bullet "Consta keys
    are stored as SHA-256 only; the issuer token opens ONLY key issuance" is
    generalised into a rule any credential can be held to (a credential the
    product only compares is hashed; one it must send is stored as it is),
    which keeps the precedent 003-automated-collections-api D11 relies on;
    the issuer clause goes with the issuer. One bullet added: the validation
    and reading records carry `business_id`, NULL for the platform's own
    top-ups, and exactly two derived statistics read across businesses by
    decision consta-api-merge D4 — bank clave shape and Banxico latency per
    bank pair — returning rules, never rows.
  · VIII. Absent Configuration Degrades, Never Breaks — "no Consta key" →
    "no provider credential"; "the Consta base URL is absent in prod by
    decision" → the provider credential absent from an environment is a
    decision the deploy log records, never an accident.
- Added sections: none. Removed sections: none. Renamed principles: none.
- Templates: plan-template.md ✅ (Constitution Check is filled at plan time
  from this file); spec-template.md ✅; tasks-template.md ✅;
  checklist-template.md ✅. No placeholder change needed.
- Follow-up TODOs:
  TODO(TD-005): still open from v1.0.0 — spec-lint runs warning-only until
  the debt it names is registered with /speckit-debt-log. `.specify/debt/`
  now exists (three entries); TD-005 itself is not yet among them.
  TODO(MOTION-DEBT): paid — `.specify/debt/unmapped-motion-tokens` closed
  2026-09-09 with evidence. Kept one more report so the trail reads whole.
  TODO(BREATH-AMPLITUDE): carried unchanged from v1.1.0.
  Carried from v1.2.0, still open: who may be admitted as a business, and
  whether identity is checked before one can collect.

Sync Impact Report (v1.2.0, 2026-09-12)
- Version change: 1.1.0 → 1.2.0 — MINOR: the Purpose paragraph widens who the
  product is for, and Principle III gains one rule. No principle removed or
  redefined, no renumbering.
- Source: /speckit-analyze findings C1 and H2 on feature
  003-automated-collections-api. Governance requires a blocked feature's plan to
  propose the amendment rather than route around it; both texts below were
  written by the developer and are recorded verbatim.
- Purpose (finding C1): "Devolada lets a Mexican ISP (the *business*, or
  Negocio) collect its customers' payments by SPEI, validate the transfer
  through Consta, and act on it in the ISP's own system" → "Devolada lets
  Mexican businesses collect payments by SPEI, with dedicated downstream
  automation for ISPs."
  What this decides, beyond the wording: the business is no longer assumed to
  run an internet service, and acting in the business's own system is one thing
  that can follow a verdict rather than the definition of the product. ISPs keep
  a named place — the WispHub automation is "dedicated", not legacy.
  What it does NOT change: the money never touches Devolada. The payer transfers
  to the business's own CLABE and Consta validates against Banxico. That is what
  makes the widening affordable, and no principle here grants Devolada custody
  of anyone's money.
- Modified principles: III. One Contract, Pure Routers — the envelope bullet is
  split in two. The base envelope is now stated without an inline exception, and
  a second bullet permits an optional `message` and an optional boolean
  `retryable` on any surface whose callers are programs rather than browsers.
  `apps/consta` stops being a named exception and becomes an instance of the
  rule; browser-facing routes are explicitly barred from both properties, so
  es-MX product copy is never replaced by a provider's message.
  The test is program-vs-browser, not internal-vs-external, and the distinction
  is load bearing: `apps/consta` is internal — consumed directly by the
  `apps/api` Worker, exposed to nothing else — while `/v1/*` is deliberately
  reachable by other companies' systems. Both answer programs, so both qualify.
  Scoping the grant to internal services would have excluded `/v1/*`, the
  surface it was written for; scoping it to the path `/v1/*` would have excluded
  `apps/consta`, which mounts at `/validate`, `/extract`, `/banks` and
  `/admin/keys` and already sends `retryable` from eight places. It also
  survives the Environments row's own expectation that Consta may one day have
  an external consumer: on this test, that day amends nothing.
- Added sections: none. Removed sections: none. Renamed principles: none.
- Code impact: `apps/consta` already answers with `retryable` and needs no
  change. Nothing in the tree sends `message` today — the property is permitted,
  never required, and no existing response shape moves.
- Templates: plan-template.md ✅ (Constitution Check is filled at plan time from
  this file); spec-template.md ✅; tasks-template.md ✅; checklist-template.md
  ✅. No placeholder change needed.
- Carried from v1.1.0, still open: the Purpose amendment does not settle who may
  be admitted as a business, or whether identity is checked before one can
  collect. The developer deliberately left that open on 2026-09-12;
  `businesses.status` already gates the money path, so a policy can arrive later
  without a migration.

Sync Impact Report (v1.1.0)
- Version change: 1.0.0 → 1.1.0 — MINOR: six rules added to an existing
  principle, none removed or redefined, no renumbering.
- Modified principles: VI. Visual Foundations (NON-NEGOTIABLE) — extended with
  the layering scale, the single dimming treatment, packages/ui as the one
  definition of a shared atom (compact 40px / standard 48px / decisive 64px),
  and the feedback motion vocabulary (waiting breathes, the outcome
  cross-fades, motion never carries state alone nor escalates). The existing
  "prefers-reduced-motion honoured" bullet is now given its meaning rather than
  replaced: translation, scale and rotation go; an opacity-only breath at low
  amplitude stays, so a working screen never reads as frozen.
- Added sections: none. Removed sections: none. Renamed principles: none.
- Source: .specify/design/foundations.md, runs 1 and 2 (2026-09-09), decisions
  D5–D15. The gaps those rules close are documented there and are NOT yet
  fixed in code — the amendment leads the implementation on purpose.
- Numbering kept deliberately (carried from v1.0.0): VII is "every test cites
  its story" because scripts/spec-lint.mjs and .github/workflows/ci.yml refer
  to it as "constitution VII"; VI is "visual foundations" because the
  web-design-guidelines overlay refers to Principle VI.
- Templates: .specify/templates/plan-template.md ✅ (Constitution Check is
  filled at plan time from this file); spec-template.md ✅; tasks-template.md
  ✅; checklist-template.md ✅. No placeholder change needed.
- Follow-up TODOs:
  TODO(TD-005): still open from v1.0.0 — spec-lint runs warning-only until the
  debt it names is registered with /speckit-debt-log; .specify/debt/ does not
  yet exist.
  TODO(MOTION-DEBT): the 15 hand-written `duration-150` literals (foundations
  D15) are debt to register before the design-foundations feature runs.
  TODO(BREATH-AMPLITUDE): the amplitude and period of the permitted
  opacity breath are undecided (foundations §6); until they are, "low
  amplitude" is a judgement call, not a measurement.
-->

# Devolada Constitution

Devolada lets Mexican businesses collect payments by SPEI, with dedicated
downstream automation for ISPs. It is built by one developer working with AI
agents; that developer decides. Ask for decisions, not approvals.

## Core Principles

### I. Spec-Driven, Every Decision Cited

- Features are specified with Spec Kit under `specs/NNN-slug/` before they are
  built: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`. A bug takes the lite path (`/speckit-bug-assess` →
  `-fix` → `-test`, under `.specify/bugs/<slug>/`); a shortcut is registered
  with `/speckit-debt-log` under `.specify/debt/<slug>/`.
- Every non-obvious rule in code MUST cite the decision that made it, in a
  comment, in the form `<feature-slug> D<n>` (e.g. `direct-payment D9`).
  A comment explains *why*, and when the reason was measured it says when
  (`measured 2026-08-19: …`).
- The retired specification corpus lives read-only in
  `leolicona/devoladapago-legacy-documentation`; anything rebuilt is
  specified again with Spec Kit, never by editing the archive.

Rationale: the codebase reads as a trail of decisions. A rule without its
decision is one nobody dares change and nobody can verify.

### II. Money Law

- Money is integer cents, end to end: schema columns (`*_cents`), API
  contracts (`receivedCents`), UI props. Floats never touch an amount.
- Provider values (decimal strings, JSON numbers) are converted by string
  parsing (`decimalToCents`, `amountToCents`); `value * 100` is forbidden.
- Display is `Intl.NumberFormat("es-MX", { currency: "MXN" })`; amounts render
  with tabular numerals. SPEI is exact to the cent: reconciliation tolerance is
  born at 0 and only a business decision raises it.
- Timestamps are milliseconds since epoch. The business's timezone owns
  "today" (`America/Mexico_City` by default) — never the browser, never UTC.

Rationale: a payment platform's one unforgivable bug is being a cent off. The
law removes the class of error rather than testing for it.

### III. One Contract, Pure Routers

- Every API resource has `routes/<area>/{index,handler,schema}.ts`. The router
  is pure: middleware, `zValidator`, wiring, nothing else. Logic lives in the
  handler. Schemas are zod and are THE contract: exported from `@devolada/api`
  (`./<area>-schema`), imported by the admin and the payment page for types,
  and used by MSW handlers and Playwright stubs to validate every fixture.
- Responses wear one envelope: `{ success: true, data }` or
  `{ success: false, error: { code } }` with `UPPER_SNAKE` codes. Better Auth's
  own endpoints are the only exemption and the clients know it (`baPost`).
- A surface whose callers are programs rather than browsers may extend that
  error object, and only such a surface may: it MAY carry an optional `message`
  and an optional boolean `retryable` (`error: { code, message, retryable }`),
  so a programmatic client can tell a failure worth retrying from one worth
  fixing. One surface qualifies today: the `/v1/*` contracts in `apps/api`,
  which serve other companies' systems. The SPEI validation engine is a
  component of `apps/api`, not a surface — its in-process failure carries
  `retryable`, and that is not an envelope. Neither property is ever
  required. A browser-facing route MUST NOT carry either: its client ships
  with the code list, and its words are es-MX product copy, never a
  provider's `message`.
- A vocabulary that must agree in several places (the bank list) is generated
  from one documented source (`scripts/gen-banks.mjs`) and CI fails when a copy
  drifts (`--check`). Hand-transcribed duplicates are forbidden.

Rationale: a frontend that derives its types from the server's schema cannot
drift into fiction the server would never send; a stub validated by the same
schema cannot test a shape that does not exist.

### IV. Tests Run on the Real Runtime

- API tests run in workerd via `@cloudflare/vitest-pool-workers` with a real
  local D1: migrations applied per test, isolated storage, **no database
  mocks**. External providers (WispHub, apiCEP, Resend) are intercepted at
  the network edge (`fetchMock`) at their real origin; the vitest config pins
  those origins and secrets so `.dev.vars` can never redirect a suite. The
  receipt reader is a Workers AI binding, not an origin: it has no local
  runtime, so tests stub it at the binding (`env.AI`) — the one binding a
  test may stand in for, and the answer it returns is a measured one.
- Component tests run on happy-dom with Testing Library and MSW
  (`onUnhandledRequest: "error"`); handlers answer with the envelope and
  schema-validated fixtures. `axe` runs on every rendered screen, with
  `color-contrast` and `target-size` disabled there because a simulated DOM
  cannot answer them.
- The browser layer (Playwright + axe, `tests/e2e`) answers what needs
  layout: real contrast in light and dark, touch-target size, tab order with
  a *measured* focus indicator, no horizontal scroll at 360/768/1280. The
  passkey ceremony (`tests/passkey`) runs against a real API with Chromium's
  virtual authenticator.
- A test starts from empty or it is not a test: module caches are reset
  `beforeEach`, MSW handlers `afterEach`, `localStorage` where a screen
  remembers state.

Rationale: what happy-dom cannot measure is guessed, and a guessed verdict is
worth less than no verdict. Each layer answers only the questions it can.

### V. Tenant Isolation and Authorization by Area

- Every business table carries `business_id`; every business query filters by
  the actor's business. The actor is resolved from Better Auth's membership
  and active organization on every request (`requireSession`), with the
  membership's role riding along.
- Authorization names an area and an action (`requireArea("payments",
  "operate")`), never a button. `auth/role-matrix.ts` is the single source of
  truth: pure data, imported by the admin as `@devolada/api/role-matrix`, so it
  MUST never import server code. Better Auth's plugin roles are derived from
  it, never written twice.
- Platform operators come from `PLATFORM_OPERATOR_EMAILS`; the right is never
  grantable from a screen — changing it is a deploy.
- A credential the product only ever compares is stored as a SHA-256 hash and
  shown in plaintext once, at issuance; a credential the product must send to
  a provider is stored as it is, with the same trust as the row it sits on.
  Dev-only routes answer 404 outside `ENVIRONMENT=dev`. CORS is an allow-list
  of frontend origins.
- The validation and reading records (`validations`, `extractions`) carry
  `business_id`, NULL for the platform's own top-ups. Exactly two derived
  statistics read across businesses, by decision `consta-api-merge D4`: the
  bank clave shape (proof-extraction D14) and Banxico's latency per bank pair
  (learned-retry D2). Both are facts about banks; both return a rule, never a
  row; neither reads a column that names a business or a payer. A third such
  read is an amendment, not a comment.

Rationale: a multi-tenant payment system leaks money, not just data, when a
filter is missing. One matrix, checked by area, is auditable with grep.

### VI. Visual Foundations (NON-NEGOTIABLE)

- All UI consumes semantic design tokens from `packages/ui/src/styles/tokens.css`
  (`--color-surface`, `--space-4`), mapped to Tailwind via `@theme inline`. No
  raw colour, size or spacing values in components; component tokens are
  derived, never new values. `tokens.css` is the law:
  `scripts/contrast-lint.mjs` measures it and CI fails on drift.
- Aesthetic direction: functionalist (Rams), warm neutrals, deep-teal action
  accent, subtle borders over shadows, minimal purposeful motion — "trust
  doesn't bounce". Colour is information (green paid, amber queued, red
  failed) and is ALWAYS paired with icon + text.
- Accessibility: WCAG 2.2 AA minimum — 4.5:1 body text, 3:1 controls, borders
  and focus ring; AAA is the aim on status and amount inks. Focus is visible
  and measured; keyboard-complete; `prefers-reduced-motion` honoured.
- Dark mode is its own palette, never an inversion: system preference plus
  `[data-theme]`, verified in both themes by contrast-lint and the browser
  layer.
- Mobile-first: real floor 360px, designed at 375; body text 16px; touch
  targets 48px, 64px for the decisive action; no horizontal scroll, ever.
- Copy is es-MX product copy: the customer's page says "pago", never
  "cobro"; auth emails carry codes, never links. Fonts are self-hosted
  (Archivo Variable, JetBrains Mono for folios and keys); no external font
  requests.
- Stacking order is semantic and tokenised: every overlapping surface takes its
  position from the layering scale in `tokens.css`. No raw z-index in a
  component, and no new layer without a name.
- One dimming treatment: every modal surface — dialog, sheet, confirmation —
  renders the same backdrop from `--color-surface-overlay`. A hand-mixed
  translucent black or ink is drift, in either theme.
- `packages/ui` is the single definition of any atom both surfaces render; a
  duplicate recipe in an app is drift. Sizes are declared, not improvised:
  compact (40px, desktop admin), standard (48px touch), decisive (64px).
  Primitives only one surface uses may live in that app, but consume the shared
  tokens and never redefine a value.
- Feedback has a named motion vocabulary: waiting breathes, the outcome
  cross-fades, nothing spins or bounces on the payer's page. Duration and
  easing come from tokens — a literal duration in a component is drift.
- Motion never carries state on its own, and it never escalates: when a wait
  grows, the copy says so and the animation does not.
- Reduced motion removes translation, scale and rotation — never the feedback
  itself. An opacity-only breath at low amplitude is the permitted floor, so a
  screen that is still working never reads as frozen.

Rationale: the customer proofreads a CLABE and an amount on a phone in a bank
app's shadow. Every rule here is one way that reading goes wrong.

### VII. Every Test Cites Its Story

- Every `*.test.*` / `*.spec.*` file under `apps/` and `packages/` MUST cite
  what it proves: `<feature-slug> US<n>` for a Spec Kit story, `US-XNN` for a
  story still carried from the archive, or `bug: <slug>` for a regression from
  the lite path. A bare `US1` is not a citation.
- `scripts/spec-lint.mjs` enforces the citation in CI. It is warning-only
  until the debt it names (TD-005) is paid; paying it makes the gate an error.
- A task in `tasks.md` carries its `[US<n>]` label so the test that lands for
  it inherits the citation.

Rationale: coverage that can be traced with grep is coverage that can be
questioned. A test nobody can tie to a promise is a test nobody can retire.

### VIII. Absent Configuration Degrades, Never Breaks

- Every binding is declared in `env.ts` with a comment saying what "unset"
  means. An optional secret that is missing turns its feature *unavailable*
  with a warning (no provider credential → the SPEI channel says so; no Resend
  key → the code is logged; no AI binding → the receipt reader falls back to
  the provider's OCR); it never throws at the edge and never leaves a customer
  looking at a void.
- The one exception is named: `BETTER_AUTH_SECRET` is required to deploy;
  CI refuses to finish a deploy without it.
- Secrets live in CI environments and are `wrangler secret put` *after* the
  deploy (TD-011); nothing secret is committed (`.dev.vars*` is ignored).
  Base URLs, model ids and feature switches are `vars`, never literals — an
  environment without the provider credential is a decision the deploy log
  records with a warning, never an accident.
- A secret that exists is not a secret that works: a deploy verifies the
  provider credential it planted, and reads the body, not just the status.

Rationale: the failures that hurt were silent — a green step that planted a
dead token, a missing HMAC key that lost a month of payer history. Degrade
loudly, in the UI and in the deploy log.

## Technology Stack & Constraints

The stack is fixed; a plan that departs from it justifies the departure in
Complexity Tracking.

| Layer | Convention |
| --- | --- |
| Runtime | Cloudflare Workers, `compatibility_date` 2025-05-01, `nodejs_compat` where Better Auth needs it |
| API | Hono 4 + `@hono/zod-validator`; `apps/api` — the product API, the SPEI validation engine (Consta, at `src/consta/`, attributed by `business_id` and reachable only in-process), and the every-minute cron sweeps |
| Data | D1 via Drizzle ORM (`sqlite`), one database, migrations generated by `drizzle-kit`, additive — the per-PR preview applies them to the live dev database while the deployed Worker keeps serving; R2 for transfer proofs behind signed URLs; Workers AI for receipt reading (model is a var) |
| Auth | Better Auth 1.6: email + password with OTP verification, passkeys (`@better-auth/passkey`), organization plugin as the tenant twin; sessions in our D1 |
| Frontend | React 19, Vite 6, Tailwind CSS 4, shadcn/ui (new-york, lucide) over Radix, TanStack Router + Query; `apps/admin` (panel) and `apps/pago` (public payment page) served as assets-only Workers with SPA fallback |
| Shared UI | `@devolada/ui`: tokens, base stylesheet and atoms consumed by both apps |
| Language | TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`; Node 22; pnpm 10 workspace |
| Tests | Vitest 3 (`vitest-pool-workers` for Workers, happy-dom for React), MSW 2, Testing Library, Playwright 1.6x + axe |
| Environments | `dev` and `prod` per Worker under `devoladapago.com`; per-PR preview versions. The engine deploys where the API deploys; whether an environment validates is decided by the provider credential planted there, not by a deploy |

Additional constraints:

- Product copy is es-MX; identifiers and comments are English.
- The app never proxies the API through Vite: SPA routes and API paths share
  names, so clients call the Worker directly with `VITE_API_URL` baked in at
  build time.
- One Worker trigger: new sweeps ride the existing every-minute cron with
  `waitUntil`, and speak only when they did something.

## Development Workflow & Quality Gates

- Work happens on a branch and lands in `main` by pull request. Every PR
  runs, in order: `spec-lint`, `gen-banks --check`, `contrast-lint`,
  typecheck, unit/component/API tests, build. All MUST pass; none may be
  skipped, disabled or quarantined to get green.
- With `PREVIEW_ENABLED`, every PR uploads no-traffic preview versions of the
  three Workers against the dev database; migrations are applied early
  because they are additive.
- Merge to `main` deploys `dev`: the browser layer (`pnpm e2e`) and the
  passkey ceremony (`pnpm e2e:passkey`) gate the deploy, then migrations,
  deploy, secrets sync, credential verification, smoke test.
- Production deploys from a `v*` tag through the `production` environment's
  approval gate, with a D1 export archived before migrating.
- A feature is done when its spec's stories have cited tests at the layer
  that can answer them (Principle IV), its plan's Constitution Check passes,
  and `/speckit-analyze` reports no CRITICAL finding.
- A shortcut taken on purpose is registered the same day with
  `/speckit-debt-log`; it is closed only by `/speckit-debt-pay` with evidence.

## Governance

- This constitution supersedes every other practice document in the repo.
  Where code and constitution disagree, one of them is amended — silently
  tolerating the gap is not an option.
- Amendments go through `/speckit-constitution` and bump the version:
  MAJOR for removing or redefining a principle, MINOR for adding one or
  materially expanding guidance, PATCH for wording. Each amendment updates
  the Sync Impact Report and the `Last Amended` date.
- Compliance is checked at three points: `/speckit-plan` fills its
  Constitution Check with one gate per principle and records any justified
  violation in Complexity Tracking; `/speckit-analyze` treats a conflict as
  CRITICAL; CI runs the executable half (`spec-lint`, `contrast-lint`,
  `gen-banks --check`).
- Principle numbers are stable: code and CI cite them (`constitution VII`).
  A renumbering is a MAJOR change and updates every citation in the tree.
- The developer decides. When a principle blocks a feature, the feature's
  plan says so and proposes the amendment; it does not route around it.

**Version**: 1.3.0 | **Ratified**: 2026-09-09 | **Last Amended**: 2026-09-16
