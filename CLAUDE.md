# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Devolada: a network of payment points in neighborhood corner stores for ISPs running WispHub. Code identifiers, docs and commits are written in **English**; **user-facing copy is es-MX** (the product ships in Mexico). The glossary in `docs/SPEC.md` maps domain terms both ways (Cobro→`charge`, Entrega→`cash_drop`, Movimiento→`ledger_entry`, …) — one word per concept, no synonyms.

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
pnpm --filter @devolada/api db:generate       # generate a drizzle migration from src/db/schema.ts
pnpm --filter @devolada/api db:migrate:local  # apply migrations to the local D1
pnpm -r --if-present typecheck                # typecheck every workspace
pnpm -r --if-present test                     # tests (infrastructure defined in docs/TESTING.md)
node scripts/spec-lint.mjs                    # local golden-rule enforcement
```

Local dev seed: with the API running, `curl -X POST localhost:8787/dev/seed` creates a demo ISP (`demo@devolada.app`) and demo store (`5512345678`), password `devolada123`. `/dev/*` routes exist only with `ENVIRONMENT=dev`.

**Never deploy from a local machine**: every deploy goes through GitHub Actions (`docs/CICD.md`). Trunk-based on `main`; PR → CI + preview; merge → dev; `v*` tag → prod with approval gate. Parallel features use `git worktree` (coexistence rules in CICD.md: distinct ports, per-worktree local D1, one spec per worktree).

## Architecture

```
apps/api      Hono + Drizzle + Zod on Cloudflare Workers + D1
packages/ui   Design tokens (Tailwind v4) + shared atoms
apps/tienda   Store PWA (not created yet; mobile-first)
apps/admin    ISP dashboard (not created yet; desktop-first)
```

Invariants that cut across everything (detail in `docs/ARCHITECTURE.md`):

- **Money is always integer cents**; visible formatting comes solely from `formatMoney`/`<Amount>` in `packages/ui`.
- **The `ledger_entries` table is an append-only ledger**: never UPDATE/DELETE; corrections = counter-entries; a store's balance is derived with SUM, never stored.
- **Sessions**: HTTP-only cookies `gm_access`/`gm_refresh`; `apps/api` is the only party talking to the external IdP (Agnostic Auth) and to WispHub — frontends consume the proxy. The middleware (`apps/api/src/auth/middleware.ts`) checks status in the DB on every request (suspension = immediate revocation) and refreshes transparently.
- **A charge is never rejected because of WispHub failures**: it is recorded and the reconnection is queued with visible status (`queued → reconnected | failed`).
- `ispId` on every business table (latent multi-tenancy); the MVP UI doesn't expose it.
- API envelope: `{ success: true, data }` | `{ success: false, error: { code } }`; Zod validation at the edge.

## Frontend

Laws in `docs/FRONTEND.md`; design artifacts (brief, IA, tokens, tasks) in `.design/devolada/`. The essentials: the tokens in `packages/ui/src/styles/tokens.css` are law (zero hardcoded values; mapped to Tailwind via `@theme inline` in `src/styles/index.css`); `StatusBadge` is the only representation of domain statuses; light+dark via `[data-theme]` (dark is its own palette, not inversion); status is never communicated by color alone (always icon + text).

The ordered build plan lives in `.design/devolada/TASKS.md`; tests cite their user story (`US-C02: …`) per `docs/TESTING.md`.
