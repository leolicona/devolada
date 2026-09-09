<!--
Sync Impact Report
- Version change: (none) → 1.0.0 — initial constitution, inferred from the
  working tree on 2026-09-09 (apps/, packages/, tests/, scripts/, .github/,
  .specify/). No commit history or deleted file was consulted.
- Modified principles: none (initial).
- Added sections: Core Principles (I–VIII), Technology Stack & Constraints,
  Development Workflow & Quality Gates, Governance.
- Removed sections: none.
- Numbering kept deliberately: VII is "every test cites its story" because
  scripts/spec-lint.mjs and .github/workflows/ci.yml already refer to it as
  "constitution VII"; VI is "visual foundations" because the
  web-design-guidelines overlay this project may adopt refers to Principle VI.
- Templates: .specify/templates/plan-template.md ✅ (Constitution Check is
  filled at plan time from this file; no placeholder change needed);
  spec-template.md ✅; tasks-template.md ✅ (its [Story] labels are the
  citations Principle VII expects); checklist-template.md ✅.
- Follow-up TODOs: none in this document. Related code gate: spec-lint runs
  warning-only until the debt it names (TD-005) is paid — register it with
  /speckit-debt-log so the register knows.
-->

# Devolada Constitution

Devolada lets a Mexican ISP (the *business*, or Negocio) collect its customers'
payments by SPEI, validate the transfer through Consta, and act on it in the
ISP's own system. It is built by one developer working with AI agents; that
developer decides. Ask for decisions, not approvals.

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
  `{ success: false, error: { code } }` with `UPPER_SNAKE` codes (Consta adds
  `retryable`). Better Auth's own endpoints are the only exemption and the
  clients know it (`baPost`).
- A vocabulary that must agree in several places (the bank list) is generated
  from one documented source (`scripts/gen-banks.mjs`) and CI fails when a copy
  drifts (`--check`). Hand-transcribed duplicates are forbidden.

Rationale: a frontend that derives its types from the server's schema cannot
drift into fiction the server would never send; a stub validated by the same
schema cannot test a shape that does not exist.

### IV. Tests Run on the Real Runtime

- API and Consta tests run in workerd via `@cloudflare/vitest-pool-workers`
  with a real local D1: migrations applied per test, isolated storage, **no
  database mocks**. External providers (WispHub, apiCEP, Consta, Resend) are
  intercepted at the network edge (`fetchMock`) at their real origin; the
  vitest config pins those origins and secrets so `.dev.vars` can never
  redirect a suite.
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
- Consta keys are stored as SHA-256 only; the issuer token opens ONLY key
  issuance. Dev-only routes answer 404 outside `ENVIRONMENT=dev`. CORS is an
  allow-list of frontend origins.

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
  with a warning (no Consta key → the SPEI channel says so; no Resend key →
  the code is logged; no AI binding → OCR falls back); it never throws at the
  edge and never leaves a customer looking at a void.
- The one exception is named: `BETTER_AUTH_SECRET` is required to deploy;
  CI refuses to finish a deploy without it.
- Secrets live in CI environments and are `wrangler secret put` *after* the
  deploy (TD-011); nothing secret is committed (`.dev.vars*` is ignored).
  Base URLs, model ids and feature switches are `vars`, never literals — the
  Consta base URL is absent in prod by decision, not by accident.
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
| API | Hono 4 + `@hono/zod-validator`; `apps/api` (product API + every-minute cron sweeps), `apps/consta` (SPEI validation, server-to-server, no CORS) |
| Data | D1 via Drizzle ORM (`sqlite`), migrations generated by `drizzle-kit`, additive; R2 for transfer proofs behind signed URLs; Workers AI for receipt reading (model is a var) |
| Auth | Better Auth 1.6: email + password with OTP verification, passkeys (`@better-auth/passkey`), organization plugin as the tenant twin; sessions in our D1 |
| Frontend | React 19, Vite 6, Tailwind CSS 4, shadcn/ui (new-york, lucide) over Radix, TanStack Router + Query; `apps/admin` (panel) and `apps/pago` (public payment page) served as assets-only Workers with SPA fallback |
| Shared UI | `@devolada/ui`: tokens, base stylesheet and atoms consumed by both apps |
| Language | TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`; Node 22; pnpm 10 workspace |
| Tests | Vitest 3 (`vitest-pool-workers` for Workers, happy-dom for React), MSW 2, Testing Library, Playwright 1.6x + axe |
| Environments | `dev` and `prod` per Worker under `devoladapago.com`; per-PR preview versions; Consta has no prod env until its first external consumer |

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

**Version**: 1.0.0 | **Ratified**: 2026-09-09 | **Last Amended**: 2026-09-09
