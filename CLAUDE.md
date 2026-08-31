# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Devolada: direct SPEI payments with automatic validation for service businesses — today, ISPs running WispHub (permanent payment link → transfer to the ISP's CLABE → Banxico validation through Consta → automatic reconnection). The pivot spec (`docs/platform/pivot.spec.md`) is the constitution; the store network was extracted to the `devolada-red` repo (pivot D15, 2026-08-31). Code identifiers, docs and commits are written in **English**; **user-facing copy is es-MX** (the product ships in Mexico). The glossary in `docs/SPEC.md` maps domain terms both ways (Cobro→`charge`, Pago directo→`direct_payment`, Comprobante de transferencia→`proof`, …) — one word per concept, no synonyms.

## Methodology (not optional)

The project is **spec-driven**; the rules live in `docs/SPEC.md` and CI enforces them (`scripts/spec-lint.mjs`):

- **Golden rule**: if it exists in the code but not in `SPEC.md`, it's wrong. Every new feature starts by writing `docs/<domain>/<feature>.spec.md` (with a US-ID reserved in `SPEC.md`) **before** touching code, registered in the index within the same PR. The spec is updated with reality during development; it never forks.
- **Lite path**: bugfixes/typos/copy carry no spec — they carry an entry in `docs/BUGS.md` (if production was affected) and a test.
- Conscious debt → `docs/TECH_DEBT.md` (TD-NNN format with a payment condition). Spec template: `docs/auth/sessions.spec.md`.
- Cross-cutting layers no feature re-decides: `docs/ARCHITECTURE.md`, `docs/FRONTEND.md`, `docs/TESTING.md`, `docs/CICD.md`, `docs/integrations/*.md`.
- `docs/integrations/agnostic-auth.md` documents the **verified real contract**, which differs from the service's official guide — on conflict, the local file wins.

## Commands

```sh
pnpm install                                  # monorepo root (pnpm workspaces)
pnpm playground                               # tokens/components playground (packages/ui, port 5173)
pnpm --filter @devolada/api dev               # local API (wrangler, port 8787; local D1)
pnpm --filter @devolada/consta dev            # Consta validation API (wrangler, port 8788; own local D1)
pnpm --filter @devolada/api db:generate       # generate a drizzle migration from src/db/schema.ts
pnpm --filter @devolada/api db:migrate:local  # apply migrations to the local D1
pnpm -r --if-present typecheck                # typecheck every workspace
pnpm -r --if-present test                     # tests (infrastructure defined in docs/TESTING.md)
node scripts/spec-lint.mjs                    # local golden-rule enforcement
```

Local dev seed: with the API running, `curl -X POST localhost:8787/dev/seed` creates a demo ISP (`demo@devolada.app`), password `devolada123`. `/dev/*` routes exist only with `ENVIRONMENT=dev`.

**Never deploy from a local machine**: every deploy goes through GitHub Actions (`docs/CICD.md`). Trunk-based on `main`; PR → CI + preview; merge → dev; `v*` tag → prod with approval gate. Parallel features use `git worktree` (coexistence rules in CICD.md: distinct ports, per-worktree local D1, one spec per worktree).

## Architecture

```
apps/api      Hono + Drizzle + Zod on Cloudflare Workers + D1
apps/consta   Consta: the SPEI validation engine — own Worker + D1 (specs in docs/consta/)
apps/pago     Public payment page (no sessions; mobile-first)
apps/admin    ISP dashboard (desktop-first)
packages/ui   Design tokens (Tailwind v4) + shared atoms
```

Invariants that cut across everything (detail in `docs/ARCHITECTURE.md`):

- **Money is always integer cents**; visible formatting comes solely from `formatMoney`/`<Amount>` in `packages/ui`.
- **Money history tables are append-only** (house rule, ARCHITECTURE.md): never UPDATE/DELETE; corrections = counter-entries; balances derived with SUM, never stored. The store ledger that embodied it lives in `devolada-red`; the pivot's `credit_entries` is its next instance.
- **Sessions**: Better Auth lives inside `apps/api` (BFF; HTTP-only cookies); `apps/api` is the only party talking to WispHub and to Consta — frontends consume the proxy. The middleware (`apps/api/src/auth/middleware.ts`) checks status in the DB on every request (suspension = immediate revocation).
- **A charge is never rejected because of WispHub failures**: it is recorded and the reconnection is queued with visible status (`queued → reconnected | failed`).
- `ispId` on every business table (latent multi-tenancy); the MVP UI doesn't expose it.
- API envelope: `{ success: true, data }` | `{ success: false, error: { code } }`; Zod validation at the edge.

## Frontend

Laws in `docs/FRONTEND.md`; design artifacts (brief, IA, tasks) in `.design/devolada/` (the SaaS cycle — pivot phase 2; the store-era layer lives in `devolada-red`).

**Use the `/shadcn` skill for every frontend task.** Check the shadcn catalog before writing a component by hand; copy the primitive into the app's `src/components/ui/` and theme it with our tokens. shadcn is the recipe, the tokens are the law. Order: domain atom in `@devolada/ui` → shadcn primitive → new component.

The other essentials: the tokens in `packages/ui/src/styles/tokens.css` are law (zero hardcoded values; mapped to Tailwind via `@theme inline` in `src/styles/index.css`); `StatusBadge` is the only representation of domain statuses; light+dark via `[data-theme]` (dark is its own palette, not inversion); status is never communicated by color alone (always icon + text).

The ordered build plan lives in `.design/devolada/TASKS.md`; tests cite their user story (`US-D03: …`) per `docs/TESTING.md`.
