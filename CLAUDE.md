# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Devolada lets Mexican businesses of any kind (the *business* / Negocio)
collect payments by SPEI: payment link → the payer transfers to the business's
own CLABE → Banxico validation through Consta → the verdict fires the
business's own action — for an ISP, the WispHub reconnection through its
**adapter**; for a business on the `/v1` API, its webhook. Today WispHub is
the one provider adapter (reconnection, customers, open invoices). A payer
can also pay **cash at a store** of Devolada's network: the shopkeeper
records it in `apps/red`, the payment joins Pagos as `channel: "store"` and
fires the same action, and the business confirms each hand-over of the cash
in *Puntos de pago* (spec 018). The SPEI money never touches Devolada; the
cash stays with the store until it reaches the business. Say "business", not "ISP", wherever a rule holds for
every business; the ISP is one segment, served first, and the core never
assumes it (constitution IX). Identifiers, comments and commits are
**English**; product copy is **es-MX**.

## How we talk during a session

The person you are working with is the **product creator**; you are the
technical expert implementing their vision. Two rules govern every message:

- **Clear B2-level English.** Plain words, short sentences, no jargon for its
  own sake. This governs the conversation only — code, comments and commits
  stay English, product copy stays es-MX.
- **Talk about the product, not the plumbing.** Keep the discussion on what a
  feature does, what it is worth to the business or to the payer, and how it should
  be designed. Technical detail earns its place when it changes a product
  decision: name what a trade-off costs, what it makes possible, or what it
  rules out — then let them decide. Implementation detail that leads to no
  decision is noise.

The constitution says it in one line: *ask for decisions, not approvals*.

## Read first

[`.specify/memory/constitution.md`](.specify/memory/constitution.md) is the law
of this repo and supersedes every other practice document, this file included.
It carries the nine principles and the fixed stack table. Read it
before planning anything; where it and code disagree, one of them gets amended —
the gap is not tolerated silently.

Work is **spec-driven** with GitHub Spec Kit, using its core templates
unmodified:

- Feature → `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
  `/speckit-implement`, all committed under `specs/NNN-slug/`. Never start at
  the code.
- Bug → the lite path `/speckit-bug-assess` → `-fix` → `-test` under
  `.specify/bugs/<slug>/` (`assess` and `test` never edit source).
- Deliberate shortcut → `/speckit-debt-log` under `.specify/debt/<slug>/`,
  closed only by `/speckit-debt-pay` with evidence.

**Every non-obvious rule in code cites the decision that made it**, as
`<feature-slug> D<n>` in a comment (`direct-payment D9`, `payments-and-classes
D7`), and says when a reason was measured (`measured 2026-08-19: …`). The
codebase reads as a trail of decisions — match that density when you edit it.

**The pre-Spec-Kit corpus left this repo on 2026-09-09.** Comments across
`apps/`, `packages/`, `tests/` and `scripts/` still cite it by its old paths
(`docs/legacy/TESTING.md`, `docs/consta/validation.spec.md`,
`.design/devolada/…`). Those paths do not exist here; they resolve in the
read-only archive `leolicona/devoladapago-legacy-documentation` by dropping the
prefix. The archive is history, not law — leave the citations intact, and
re-specify anything you rebuild.

## Commands

```sh
pnpm install                                  # pnpm 10 workspace, Node 22
pnpm playground                               # packages/ui tokens + atoms showcase (5173)
pnpm --filter @devolada/api dev               # product API + the validation engine: wrangler + local D1 (8787)
pnpm --filter @devolada/admin dev             # the business's panel (5174)
pnpm --filter @devolada/pago dev              # public payment page (5175)
pnpm --filter @devolada/landing dev           # public landing page (5176; Astro, no client framework)
pnpm --filter @devolada/red dev               # the shopkeeper's app (5177)
pnpm --filter @devolada/api sandbox           # apiCEP mock (8789), for validating without a provider token

pnpm --filter @devolada/api db:generate       # drizzle migration from src/db/schema.ts
pnpm --filter @devolada/api db:migrate:local  # apply migrations to the local D1

pnpm -r --if-present typecheck                # every workspace
pnpm -r --if-present test                     # every workspace
pnpm --filter @devolada/api test -- test/direct-payment.test.ts   # one file
pnpm --filter @devolada/admin test -- -t "revoked membership"     # one test by name
pnpm --filter @devolada/api test:watch        # api only

node scripts/spec-lint.mjs                    # story citations (constitution VII)
node scripts/contrast-lint.mjs                # measures tokens.css in both themes
node scripts/gen-banks.mjs [--check]          # regenerate / verify the bank constants
node scripts/pending-lint.mjs                # every in-progress label sits inside a <Pending>

pnpm e2e                                      # Playwright + axe, built previews, stubbed API
pnpm e2e:ui                                   # same, headed
pnpm e2e:passkey                              # passkey ceremony against a real wrangler API
pnpm exec playwright test --config playwright.review.config.ts   # design-review screenshots
```

Local seed: with the API up, `curl -X POST localhost:8787/dev/seed` creates a
demo ISP (`demo@devolada.app`), with no password: the panel signs in with a
código, which prints in the API's console without `RESEND_API_KEY`, or comes
from `POST /dev/code {email, type: "sign-in"}` — only for `.invalid` and the
demo's addresses (passwordless-access D14, D16). `/dev/*` 404s unless
`ENVIRONMENT=dev`. Secrets go in per-app `.dev.vars` (git-ignored, including
suffixed copies). The API's optional secrets, each degrading when unset
(constitution VIII; the authoritative comments live in `apps/api/src/env.ts`):

| `.dev.vars` key | unset means |
| --- | --- |
| `APICEP_TOKEN` | the SPEI channel is unavailable; `/v1` still creates links with a `VALIDATION_UNAVAILABLE` notice |
| `APICEP_BASE_URL` | the real provider; `http://localhost:8789` points it at `pnpm --filter @devolada/api sandbox` |
| `APICEP_STORAGE_ORIGIN` | set in `wrangler.jsonc` to the provider's storage; with the sandbox, `http://localhost:8789` so its bundle downloads. Unset, no bundle of CEPs is downloaded and a several-matches payment asks the payer for the clave |
| `WEBHOOK_SIGNING_KEYS` | webhook deliveries are recorded but never attempted (`SIGNING_KEY_MISSING` on the row, empty JWKS); mint one with the one-liner in `specs/003-automated-collections-api/quickstart.md` |
| `RESEND_API_KEY` | the OTP is logged instead of emailed |
| `WISPHUB_API_KEY` | the dev seed connects no provider |
| `APICEP_DEADLINE_MS`, `WEBHOOK_DELIVERY_TIMEOUT_MS`, `READER_TIMEOUT_MS`, `STORE_SIGN_IN_FLOOR_MS` | 25 s, 10 s, 8 s and 1 s — the last is the base of the floor a refused store sign-in waits for (it grows to ten times the store lookup's round trip; `0` turns it off), so timing cannot tell a store's phone from a stranger's (passwordless-access FR-033) — test knobs, never set by a deploy |

`BETTER_AUTH_SECRET` is the one exception — CI refuses to deploy without it.

CI order on every PR — none of it may be skipped or quarantined to get green:
`spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint`, typecheck,
tests, build.
**Never deploy from a local machine.** Merge to `main` deploys dev — all five
Workers: API, admin, payment page, landing, the store app (the browser and
passkey layers gate it); a `v*` tag deploys prod, and **the tag is the approval** — there is
no reviewer click (production-launch D3). A release is
`git tag vX.Y.Z origin/main && git push origin vX.Y.Z` on a commit whose
Deploy Dev run is green — the tag job checks and refuses otherwise (D1). A
rollback is Actions → *Rollback Prod* with the service and the version id
from the release's summary; it moves code, never data (D7). The runbook is
`specs/006-production-launch/quickstart.md`.

## Architecture

```
apps/api      Hono 4 + Drizzle + zod on Workers/D1 — the only party that talks
              to WispHub, apiCEP and Resend; hosts Better Auth; runs the
              every-minute cron sweeps; hosts the SPEI validation engine
              (Consta) as a module at `src/consta/`, reachable only
              in-process and attributed by `business_id`
apps/pago     public payment page, no session, mobile-first (assets Worker)
apps/admin    the business's panel, desktop-first, TanStack Router + Query (assets Worker)
apps/landing  the product's front door at the root domain: an Astro static
              page on an assets Worker with a script in front (`www`
              redirect, `?ch=` channel tag into the forms, security
              headers + CSP); renders the shared atoms at build and ships
              no framework. Requests and counts live in the API
              (`routes/landing/`); the operator reads them in the panel
apps/red      the shopkeeper's app, phone-first, no offline work (assets
              Worker); from 1024 px a side menu and two halves
              (cash-at-stores D32): Cobrar (search → debt → record → folio and the
              WhatsApp receipt), Caja and Movimientos (the store's cash
              book, the hand-over). Its own session kind, the store actor
              (`requireStore`); no account holds a password: the
              shopkeeper's código is asked by phone and goes to the
              store's email (passwordless-access D10); the cash book is
              `store_ledger`, written only by `src/store-ledger/`
              (cash-at-stores D19)
packages/ui   design tokens + the atoms every surface renders
```

The frontends never proxy through Vite — SPA routes and API paths share names —
so they call the Worker directly (`VITE_API_URL` baked in at build;
`apps/admin/src/lib/base.ts` falls back to `localhost:8787` in dev). The
landing bakes `PUBLIC_API_URL` and `PUBLIC_SITE_URL` the same way
(`apps/landing/src/lib/urls.ts`); its Worker's CSP takes the API origin from
`API_ORIGIN` in `apps/landing/wrangler.jsonc` (landing-page D12, D14).

**The zod schema is the contract.** Each resource is
`apps/api/src/routes/<area>/{index,handler,schema}.ts`: `index.ts` is a *pure*
router (middleware, `zValidator`, wiring — no logic), `handler.ts` holds the
logic, `schema.ts` is exported from `@devolada/api` (`./payments-schema`,
`./role-matrix`, …) and imported by the frontends for types, by MSW handlers and
by Playwright stubs to validate fixtures. Adding an area means adding the export
in `apps/api/package.json` too.

Invariants worth knowing before you touch anything:

- **The core speaks generic; adapters translate** (constitution IX). A
  provider's paths, pagination, cursors, field names and measured quirks live
  in its adapter (`apps/api/src/wisphub/`). Core routes, contracts and screens
  use the core's words (customer, open invoices, debt, integration) and offer
  a feature because the integration has the capability, never because it is
  WispHub. Older code that breaks this is registered debt under
  `.specify/debt/`; new code adds no leak.
- **Money is integer cents end to end** (`*_cents`, `receivedCents`); provider
  decimals convert by string parsing (`decimalToCents`), never `× 100`.
  Timestamps are ms; "today" belongs to the business timezone, not the browser.
- **One envelope**: `{ success: true, data }` / `{ success: false, error: { code } }`
  with `UPPER_SNAKE` codes. Better Auth's own
  endpoints are the single exemption, and the clients know it (`baPost`).
- **Tenant isolation**: every business table carries `business_id` and every
  query filters by the actor's business. The actor is resolved per request in
  `apps/api/src/auth/middleware.ts` from Better Auth membership + active
  organization. Authorization names an *area and action*
  (`requireArea("payments", "operate")`), never a button;
  `auth/role-matrix.ts` is the one source of truth and must never import server
  code, because the admin imports it. Platform operators come from
  `PLATFORM_OPERATOR_EMAILS` — changing that set is a deploy.
- **A payer's reference belongs to a person inside one business**: seven
  digits in `payer_references`, held by customers through
  `payer_reference_customers` — beside the link, never on it (a link row
  stays identity-only). The whole phone is never stored, nor a name: they
  are read live through the integration's `customersWithPhone` and
  forgotten. Only `direct-payments/payer-reference.ts` writes the holders
  (payment-without-receipt D1).
- **`payments` is one row for the whole life of a payment**: proof → validation
  (`validating → confirmed | partial | invalid | unapplied | expired |
  superseded | queued_for_credit`) → the action queue on the same row
  (`actionOutcome: queued | done | withheld | failed | observation`). A WispHub
  failure never rejects a payment; it queues the action with visible status.
  Every one of those words was chosen against a specific wrong reading — read
  the comment in `apps/api/src/db/schema.ts` before renaming one.
  A receipt goes to the provider's image door first, with the edge reading
  beside it; on `not_found` the two are compared and the row records
  agreed / disputed / blind plus what they accepted (`two-eyes-receipt D3, D5`),
  which is what picks the door of the next attempt (D17). The pay request
  answers before that call returns (D4).
- **Sweeps ride one trigger**: the every-minute cron in `apps/api/src/index.ts`
  (`waitUntil`) runs re-validation, the reconnection queue and top-ups. New
  periodic work joins it rather than adding a trigger,
  and speaks only when it did something.
- **Absent config degrades, never breaks**: every binding in `env.ts` carries a
  comment saying what "unset" means (no provider credential → the SPEI channel
  says it is unavailable; no Resend key → the OTP is logged). `BETTER_AUTH_SECRET` is the
  one exception — CI refuses to finish a deploy without it.
- **Generated, never hand-edited**: `apps/api/src/direct-payments/banks.ts`
  comes from `scripts/banks.data.md` via `gen-banks.mjs`; CI fails on drift.

## UI

`packages/ui/src/styles/tokens.css` is the law: semantic tokens only
(`--color-surface`, `--space-4`), mapped to Tailwind via `@theme inline`, with
no raw colour/size/spacing/z-index/duration literal in a component.
`contrast-lint.mjs` measures the file in both themes and CI fails on drift.
Dark is its own palette, not an inversion. Status is never colour alone — always
icon + text, and `StatusBadge` is its only representation.

Order when a component is needed: shared atom in `@devolada/ui` → shadcn
primitive copied into the app's `src/components/ui/` and themed with tokens →
something new. An atom both surfaces render belongs in `packages/ui`; a
duplicate recipe in an app is drift. Sizes are declared: 40px compact (desktop
admin), 48px touch, 64px for the decisive action. Floor is 360px, designed at
375, body text 16px, no horizontal scroll ever. Motion vocabulary: waiting
breathes, outcomes cross-fade, nothing spins or bounces on the payer's page, and
reduced motion drops translation/scale/rotation while keeping an opacity breath
so a working screen never reads as frozen.

## Testing

Four layers, each answering only what it can (constitution IV):

- **API** (`apps/api/test/`, the engine's own suite under `test/consta/`) run in workerd via
  `@cloudflare/vitest-pool-workers` against a real local D1 — migrations applied
  per test, isolated storage, **no database mocks**. Providers are intercepted at
  the network edge with `fetchMock` at their real origin, and
  `vitest.config.ts` *pins* those origins and secrets so a developer's
  `.dev.vars` can never redirect a suite. The reader is stubbed at the binding
  (`aiReturning`), both of its doors: `run` for the reading and `toMarkdown`
  for the text a PDF converts to.
- **Component** (happy-dom + Testing Library + MSW with
  `onUnhandledRequest: "error"`); handlers answer with the envelope and
  schema-validated fixtures, and `axe` runs on every rendered screen with
  `color-contrast` / `target-size` disabled — a simulated DOM cannot answer them.
- **Browser** (`tests/e2e`, Playwright + axe) owns exactly those: real contrast
  in both themes, touch-target size, measured focus indicator, no horizontal
  scroll at 360/768/1280.
- **Passkey** (`tests/passkey`) boots a real wrangler API + D1 and drives
  Chromium's virtual authenticator.

A test starts from empty or it is not a test: module caches reset `beforeEach`,
MSW handlers `afterEach`, `localStorage` where a screen remembers.

**Every `*.test.*` / `*.spec.*` under `apps/` and `packages/` cites what it
proves** — `<feature-slug> US<n>`, an archive-era `US-XNN`, or `bug: <slug>`. A
bare `US1` is not a citation. `spec-lint.mjs` is warning-only until TD-005 is
paid; write the citation anyway.
