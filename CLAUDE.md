# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Devolada lets a Mexican ISP (the *business* / Negocio) collect customer payments
by SPEI: permanent payment link → the customer transfers to the ISP's CLABE →
Banxico validation through Consta → the action fires back in the ISP's system
(WispHub reconnection). Identifiers, comments and commits are **English**;
product copy is **es-MX**.

## How we talk during a session

The person you are working with is the **product creator**; you are the
technical expert implementing their vision. Two rules govern every message:

- **Clear B2-level English.** Plain words, short sentences, no jargon for its
  own sake. This governs the conversation only — code, comments and commits
  stay English, product copy stays es-MX.
- **Talk about the product, not the plumbing.** Keep the discussion on what a
  feature does, what it is worth to the ISP or to the payer, and how it should
  be designed. Technical detail earns its place when it changes a product
  decision: name what a trade-off costs, what it makes possible, or what it
  rules out — then let them decide. Implementation detail that leads to no
  decision is noise.

The constitution says it in one line: *ask for decisions, not approvals*.

## Read first

[`.specify/memory/constitution.md`](.specify/memory/constitution.md) is the law
of this repo and supersedes every other practice document, this file included.
It carries the eight principles CI enforces and the fixed stack table. Read it
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
pnpm --filter @devolada/admin dev             # ISP panel (5174)
pnpm --filter @devolada/pago dev              # public payment page (5175)
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
demo ISP (`demo@devolada.app` / `devolada123`). `/dev/*` 404s unless
`ENVIRONMENT=dev`. Secrets go in per-app `.dev.vars` (git-ignored, including
suffixed copies). The API's optional secrets, each degrading when unset
(constitution VIII; the authoritative comments live in `apps/api/src/env.ts`):

| `.dev.vars` key | unset means |
| --- | --- |
| `APICEP_TOKEN` | the SPEI channel is unavailable; `/v1` still creates links with a `VALIDATION_UNAVAILABLE` notice |
| `APICEP_BASE_URL` | the real provider; `http://localhost:8789` points it at `pnpm --filter @devolada/api sandbox` |
| `WEBHOOK_SIGNING_KEYS` | webhook deliveries are recorded but never attempted (`SIGNING_KEY_MISSING` on the row, empty JWKS); mint one with the one-liner in `specs/003-automated-collections-api/quickstart.md` |
| `RESEND_API_KEY` | the OTP is logged instead of emailed |
| `WISPHUB_API_KEY` | the dev seed connects no provider |
| `APICEP_DEADLINE_MS`, `WEBHOOK_DELIVERY_TIMEOUT_MS` | 25 s and 10 s — test knobs, never set by a deploy |

`BETTER_AUTH_SECRET` is the one exception — CI refuses to deploy without it.

CI order on every PR — none of it may be skipped or quarantined to get green:
`spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint`, typecheck,
tests, build.
**Never deploy from a local machine.** Merge to `main` deploys dev (the browser
and passkey layers gate it); a `v*` tag deploys prod behind an approval gate.

## Architecture

```
apps/api      Hono 4 + Drizzle + zod on Workers/D1 — the only party that talks
              to WispHub, apiCEP and Resend; hosts Better Auth; runs the
              every-minute cron sweeps; hosts the SPEI validation engine
              (Consta) as a module at `src/consta/`, reachable only
              in-process and attributed by `business_id`
apps/pago     public payment page, no session, mobile-first (assets Worker)
apps/admin    ISP panel, desktop-first, TanStack Router + Query (assets Worker)
packages/ui   design tokens + the atoms both frontends render
```

The frontends never proxy through Vite — SPA routes and API paths share names —
so they call the Worker directly (`VITE_API_URL` baked in at build;
`apps/admin/src/lib/base.ts` falls back to `localhost:8787` in dev).

**The zod schema is the contract.** Each resource is
`apps/api/src/routes/<area>/{index,handler,schema}.ts`: `index.ts` is a *pure*
router (middleware, `zValidator`, wiring — no logic), `handler.ts` holds the
logic, `schema.ts` is exported from `@devolada/api` (`./payments-schema`,
`./role-matrix`, …) and imported by the frontends for types, by MSW handlers and
by Playwright stubs to validate fixtures. Adding an area means adding the export
in `apps/api/package.json` too.

Invariants worth knowing before you touch anything:

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
- **`payments` is one row for the whole life of a payment**: proof → validation
  (`validating → confirmed | partial | invalid | unapplied | expired |
  superseded | queued_for_credit`) → the action queue on the same row
  (`actionOutcome: queued | done | withheld | failed | observation`). A WispHub
  failure never rejects a payment; it queues the action with visible status.
  Every one of those words was chosen against a specific wrong reading — read
  the comment in `apps/api/src/db/schema.ts` before renaming one.
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
  `.dev.vars` can never redirect a suite.
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
