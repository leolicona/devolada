# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Devolada is the SPEI validation-and-reconciliation platform — the oracle of truth about whether money arrived.** A business's end customer opens their permanent payment link, sees what they owe, transfers by SPEI **to the business's own CLABE** (never to ours — no custody, no fintech licence), submits their proof, and the transfer is validated against Banxico's CEP. On a confirmed verdict the service reconnects on its own. Business model: prepaid validation credit, debited per *confirmed* validation — never per attempt, never a percentage.

Today's pilot shape is ISPs running WispHub, but **WispHub is one integration, not the product**: no screen, row, column or error may assume it. Market is Mexico — **UI copy is es-MX, code identifiers and docs are English**.

`docs/BRIEF.md` is the seed document: brief, measured stack, invariants, the full glossary, and the 36-feature backlog. Read it before any non-trivial change — most of it is not recoverable from the code.

## Commands

```sh
pnpm install                                  # root; pnpm workspaces, Node 22, pnpm@10.29.3
pnpm playground                               # @devolada/ui tokens/components playground (vite default 5173)
pnpm --filter @devolada/admin dev             # business dashboard (5174)
pnpm --filter @devolada/pago dev              # public payment page (5175)
pnpm --filter @devolada/api dev               # API worker, local D1 (8787)
pnpm --filter @devolada/consta dev            # validation engine, own local D1 (8788)

pnpm -r --if-present typecheck                # what CI runs
pnpm -r --if-present test
pnpm -r --if-present build

pnpm --filter @devolada/api test sessions     # one workspace, filtered by test-name/path substring
pnpm --filter @devolada/api test:watch        # api and consta only
pnpm --filter @devolada/admin test -- -t "US-A01"   # by story citation

pnpm --filter @devolada/api db:generate       # drizzle migration from src/db/schema.ts
pnpm --filter @devolada/api db:migrate:local  # apply to local D1 (same pair on consta)

node scripts/spec-lint.mjs                    # story-citation gate
node scripts/contrast-lint.mjs                # token contrast/palette gate
node scripts/gen-banks.mjs [--check]          # regenerate bank constants / fail on drift

pnpm exec playwright install --with-deps chromium   # once, before the browser layer
pnpm e2e [tests/e2e/pago.spec.ts]             # browser layer; builds + previews both SPAs itself
pnpm e2e:ui                                   # Playwright UI mode
pnpm e2e:passkey                              # playwright.passkey.config.ts
pnpm exec playwright test --config playwright.review.config.ts   # design-review screenshots
```

There is no ESLint or Prettier — the three `scripts/*.mjs` gates plus `typecheck` are the lint.

**Local seed:** with the API running, `curl -X POST localhost:8787/dev/seed` creates a demo ISP (`demo@devolada.app` / `devolada123`). `/dev/*` 404s unless `ENVIRONMENT=dev`. Secrets go in per-app `.dev.vars` (gitignored, including suffixed variants).

**Never deploy from a local machine.** Trunk-based on `main`: PR → `ci.yml` gate (+ preview when `PREVIEW_ENABLED`), merge → dev, `v*` tag → prod behind an approval gate. Parallel features use `git worktree` — each app owns a distinct port for exactly this reason.

## Architecture

```
apps/api      Hono + Drizzle + Zod on Workers + D1 + R2 — the BFF, and the only
              party that talks to WispHub or to Consta; every-minute cron sweeps
apps/consta   Consta: the SPEI validation engine — own Worker, own D1, own API keys
apps/pago     Public payment page (no sessions; mobile-first)
apps/admin    Business dashboard (desktop-first; TanStack Router + Query)
packages/ui   Design tokens (Tailwind v4) + shared domain atoms
```

**Consta is a domain of Devolada, not a second product** (decided 2026-09-08). It is never sold separately, but the runtime boundary stands: separate Worker, separate D1, API-key auth instead of cookies, `consta.devoladapago.com`. Nothing licenses merging it into `apps/api`.

**Request shape.** Frontends never call a provider — they call `apps/api`, which proxies. `apps/api/src/index.ts` mounts one Hono route per domain; each `src/routes/<domain>/` is a three-file split that is a house rule: `index.ts` is a *pure router* (auth middleware + `zValidator` + wiring, no logic), `handler.ts` holds the logic, `schema.ts` the Zod types. `schema.ts` files and `auth/role-matrix.ts` are re-exported through the `exports` map in `apps/api/package.json`, and the frontends import them (`@devolada/api/credit-schema`, `@devolada/api/role-matrix`) — so the API contract and the permission matrix are one definition, typechecked across the worker/browser boundary. Adding a shared schema means adding an entry to that map.

**Auth** is Better Auth inside `apps/api` (BFF, HTTP-only cookies; email+code, passkeys, organizations). `src/auth/middleware.ts` resolves the Better Auth user into an `Actor` — memberships name the businesses, the session's active organization picks one, the role rides along — and hits the DB on **every** request, so suspension is immediate revocation rather than a token's remaining lifetime. Better Auth's own endpoints are exempt from the API envelope; the frontends have separate `baGet`/`baPost` wrappers for them (`apps/admin/src/lib/api.ts`).

**The cron** (`scheduled` in `apps/api/src/index.ts`, every minute in dev/prod) runs the reconnection sweep, the queued-for-credit release → direct-payment re-validation sweep, the top-up sweep, and the Consta key backfill. All new periodic work rides this one trigger; do not add a second Worker trigger.

**Adapters.** All WispHub traffic goes through `src/wisphub/`, all Consta traffic through `src/consta/client.ts`. Every provider call carries a deadline. No provider vocabulary escapes its adapter: rows, envelope and copy say `PROVIDER_*`, and a business with no integration still gets a coherent product.

**Generated code — never edit by hand:** `apps/consta/src/provider/banks.ts` and `apps/api/src/direct-payments/banks.ts` are written by `scripts/gen-banks.mjs` from `scripts/banks.data.md`. Edit the data file, re-run the script; CI fails on drift.

## Invariants

Laws no feature re-decides. The code has known violations, so these are stated as law, not as description (`docs/BRIEF.md` §3 is authoritative).

1. **Money is always integer cents.** Visible formatting comes solely from `formatMoney` / `<Amount>` in `packages/ui`.
2. **Money history tables are append-only.** Never UPDATE, never DELETE; corrections are counter-entries; balances are derived with SUM, never stored (`credit_entries` → `credit_balance`). Tests build scenarios with entries, the way production does.
3. **A payment is never rejected because the provider failed.** It is recorded and the action is queued on the same row with a visible status (`queued → reconnected | failed | withheld`).
4. **`businessId` on every business table.** The business is the tenant.
5. **API envelope:** `{ success: true, data }` | `{ success: false, error: { code } }`, with Zod validation at the edge.
6. **Sessions are checked against the DB on every request.**
7. **No provider vocabulary escapes its adapter.**
8. **Design tokens are law** (`packages/ui/src/styles/tokens.css`): zero hardcoded values. `StatusBadge` is the only representation of domain statuses. Light and dark are two palettes, not an inversion. **Status is never communicated by colour alone** — always icon + text.
9. **Every test cites its user story**, so coverage is traced by grep rather than faith.
10. **The measured integration contract wins over the vendor's guide.**

Out of scope, decided: funds custody, dynamic CLABEs, percentage fees, manual verification. The store network was extracted to `devolada-red` on 2026-08-31.

## Vocabulary

One word per concept, no synonyms — the full table is `docs/BRIEF.md` §4 and it is not recoverable from the code. The traps worth memorising:

- **Cobro** = `payment_request`, read **live** from the provider — there is no table and no stored copy. **Pago** = `payment`, the transfer that arrived.
- **"Pago parcial"** is always the *class* `short` (`reconciliation_class`: `exact/short/over`); **"Pago incompleto"** is always the lifecycle *status* `partial`. A payment can wear both — they answer different questions.
- **Comprobante de transferencia** = `proof` (the customer's evidence); **Comprobante/Folio** = `receipt`/`folio` (our receipt). Never swap them.
- Retired ID ranges (US-S01/S03/S05, US-C\*, US-K\*, US-E\*, US-A02/A03, US-L01, **US-V12–V14**) are never reused. US-V12–V14 was a bank-email provisional match, killed by measurement before any code existed — do not propose it again.

## Working method

The project is **spec-driven with GitHub Spec Kit**, using its core templates unmodified — no `.specify/templates/overrides/`, and none is to be added.

- **Golden rule:** if it exists in the code but not in a spec, it's wrong. A new feature starts at `/speckit-specify`, which creates `specs/NNN-<slug>/`; `plan.md` and `tasks.md` are committed there beside `spec.md`. (`specs/` does not exist yet — the first rebuilt feature creates it.)
- **Features predating the migration have no spec in this repo.** The pre-Spec-Kit corpus — 47 documents, 367 numbered decisions with their rejected alternatives, `TECH_DEBT.md`, `BUGS.md`, the measured integration contracts — moved to `leolicona/devoladapago-legacy-documentation` (read-only) on 2026-09-09. Code comments still cite it by its old paths: `docs/legacy/<path>` resolves to `<path>` at the archive root, `.design/devolada/<path>` to `design/devolada/<path>`. It is history, not law. Changing such a feature means rebuilding it under Spec Kit, or taking the lite path.
- **Lite path** (bugfix, typo, copy): no spec, but a test — and a bug that reached production gets a `.specify/bugs/<slug>/` entry via `/speckit-bug-assess` → `/speckit-bug-fix` → `/speckit-bug-test`. Only `fix` touches source. Pass the same `slug=<kebab-case>` to all three; never overwrite an existing directory.
- **Technical debt** has its own register: `/speckit-debt-log`, `/speckit-debt-review`, `/speckit-debt-pay` write `.specify/debt/<slug>/`. `log` and `review` read code only.
- **Story citations are gated by CI.** `scripts/spec-lint.mjs` requires every `*.test.*` under `apps/`/`packages/` to contain one of: `US-XNN` (archive-era), `<feature-slug> US<n>` (Spec Kit), or `bug: <slug>` (lite path). Convention is `describe("US-D03: …")`. It is warning-only today and becomes an error once TD-005 is paid.
- **The constitution is currently absent.** `.specify/memory/constitution.md` was deleted on 2026-09-09 and not yet rewritten (CI steps still name it). Until `/speckit-constitution` regenerates it, `docs/BRIEF.md` holds the invariants, and its §7 records the open questions a spec must not quietly answer on its own.
- `.claude/skills/` carries the stack's patterns — `hono`, `drizzle-orm-d1`, `wrangler`, `workers-best-practices`, `vitest`, `vite`, `shadcn`, `pnpm`. Load the relevant one before writing code under that convention.

## Frontend

**Every frontend task starts at the shadcn catalog.** Order: domain atom in `@devolada/ui` → shadcn primitive copied into the app's `src/components/ui/` and themed with our tokens → a new component. shadcn is the recipe; the tokens are the law.

Tokens live in `packages/ui/src/styles/tokens.css` and reach Tailwind through `@theme inline` in `src/styles/index.css`; dark is `[data-theme="dark"]` and is its own palette. `scripts/contrast-lint.mjs` parses that file directly, composites translucent colours over their surface, and enforces AA (AAA on amounts and statuses) — so a token edit can fail CI.

Both SPAs organise by `src/features/<domain>/` with screens, plus `src/lib/` for the fetch wrapper and helpers. The dev server deliberately does **not** proxy the API: `/settings`, `/links` and friends are SPA routes *and* API paths, so a same-origin base would answer a reload with JSON. `src/lib/base.ts` points at `http://localhost:8787` in development and at `VITE_API_URL` in deployed builds, with CORS allow-listed per environment in `wrangler.jsonc`.

## Testing

Four layers, and which one a question belongs to matters:

- **Workers layer** (`apps/api/test/`, `apps/consta/test/`) runs the real Hono app in workerd via `@cloudflare/vitest-pool-workers`, against a **real local D1** — no database mocks. Migrations are read by `vitest.config.ts` and applied per test in `test/setup.ts`; every test starts from an empty database. `singleWorker: true` is deliberate (per-file runtimes exhausted the ephemeral port space), which is why `test/setup.ts` resets module-level provider caches in `beforeEach`. Provider origins, `RESEND_API_KEY` and `AUTH_RATE_LIMIT` are **pinned as bindings** so a developer's `.dev.vars` cannot make the suite hit real services.
- **Component layer** (`apps/admin/test/`, `apps/pago/test/`, `packages/ui/test/`): React Testing Library + happy-dom + MSW.
- **Browser layer** (`tests/e2e/`, Playwright + axe): touch targets, breakpoints, real contrast — the questions a simulated DOM cannot answer. It builds both SPAs as static previews and stubs the API by route interception, so it needs no wrangler. It runs after merge in `deploy-dev.yml`, not in the PR loop.
- **`tests/passkey/`** and **`tests/design/`** have their own configs; the design suite only writes screenshots.

Auth tests use the real Better Auth server API rather than a mocked IdP — `apps/api/test/helpers.ts` signs a deterministic session cookie and inserts the matching row.
