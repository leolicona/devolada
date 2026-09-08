# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Devolada: direct SPEI payments with automatic validation for service businesses — today, ISPs running WispHub (permanent payment link → transfer to the ISP's CLABE → Banxico validation through Consta → automatic reconnection). The pivot spec (`docs/legacy/platform/pivot.spec.md`) is the constitution; the store network was extracted to the `devolada-red` repo (pivot D15, 2026-08-31). Code identifiers, docs and commits are written in **English**; **user-facing copy is es-MX** (the product ships in Mexico). The glossary in `docs/legacy/SPEC.md` maps domain terms both ways (Cobro→`charge`, Pago directo→`direct_payment`, Comprobante de transferencia→`proof`, …) — one word per concept, no synonyms.

## Methodology (not optional)

> **Spec Kit is the working flow (decided 2026-09-08).** A new feature is
> specified with GitHub Spec Kit, using **its core templates unmodified**:
> `/speckit-specify` creates `specs/NNN-<slug>/`, and `plan.md` / `tasks.md`
> are committed there alongside `spec.md`. There is no
> `.specify/templates/overrides/` and none is to be added — the shape of a
> spec is Spec Kit's to decide, not ours.
> The previous corpus is archived under `docs/legacy/`: still normative for
> every feature already built, still enforced there by `spec-lint`, and still
> where those features' specs are amended. The laws no feature re-decides are
> in the constitution at
> [`.specify/memory/constitution.md`](.specify/memory/constitution.md), which
> links the layer documents rather than replacing them: on a conflict of
> detail, the linked file wins. The brief is
> [`docs/BRIEF.md`](docs/BRIEF.md); the migration plan and the alternatives it
> weighed are in
> [`docs/spec-kit-migration.eval.md`](docs/spec-kit-migration.eval.md).
> **Read `docs/legacy/` for anything about a feature that has not been rebuilt
> yet.**

The project is **spec-driven**; the constitution governs and CI enforces the gate (`scripts/spec-lint.mjs`):

- **Golden rule**: if it exists in the code but not in a spec, it's wrong. A new feature starts at `/speckit-specify` — never by touching code first. The spec is updated with reality during development; it never forks.
- **A feature already built keeps its spec where it lives**: amend `docs/legacy/<domain>/<feature>.spec.md` and its row in the `docs/legacy/SPEC.md` index, in the same PR. It moves to `specs/` only when the feature itself is rebuilt.
- **Lite path**: bugfixes/typos/copy carry no spec — they carry an entry in `docs/legacy/BUGS.md` (if production was affected) and a test.
- Conscious debt → `docs/legacy/TECH_DEBT.md` (TD-NNN format with a payment condition).
- **Tests cite their story** (constitution VII): a Spec Kit feature uses its per-feature number carrying the feature slug (`direct-payment US1: …`); a feature not yet rebuilt keeps `US-XNN`. `spec-lint` accepts both while the migration runs.
- **The stack is decided in the constitution** (*Stack conventions*): each convention names the skill that carries its patterns, and a task that writes code under a convention loads that skill first. Most skills are vendored under `.claude/skills/` and pinned in `skills.lock.json`; Cloudflare's come from the `cloudflare` plugin declared in `.claude/settings.json` and are never copied into the repo.
- Cross-cutting layers no feature re-decides: `docs/legacy/ARCHITECTURE.md`, `docs/legacy/FRONTEND.md`, `docs/legacy/TESTING.md`, `docs/legacy/CICD.md`, `docs/legacy/integrations/*.md`.
- `docs/legacy/integrations/agnostic-auth.md` documents the **verified real contract**, which differs from the service's official guide — on conflict, the local file wins.

## Commands

```sh
pnpm install                                  # monorepo root (pnpm workspaces)
pnpm playground                               # tokens/components playground (packages/ui, port 5173)
pnpm --filter @devolada/api dev               # local API (wrangler, port 8787; local D1)
pnpm --filter @devolada/consta dev            # Consta validation API (wrangler, port 8788; own local D1)
pnpm --filter @devolada/api db:generate       # generate a drizzle migration from src/db/schema.ts
pnpm --filter @devolada/api db:migrate:local  # apply migrations to the local D1
pnpm -r --if-present typecheck                # typecheck every workspace
pnpm -r --if-present test                     # tests (infrastructure defined in docs/legacy/TESTING.md)
node scripts/spec-lint.mjs                    # local golden-rule enforcement
```

Local dev seed: with the API running, `curl -X POST localhost:8787/dev/seed` creates a demo ISP (`demo@devolada.app`), password `devolada123`. `/dev/*` routes exist only with `ENVIRONMENT=dev`.

**Never deploy from a local machine**: every deploy goes through GitHub Actions (`docs/legacy/CICD.md`). Trunk-based on `main`; PR → CI + preview; merge → dev; `v*` tag → prod with approval gate. Parallel features use `git worktree` (coexistence rules in CICD.md: distinct ports, per-worktree local D1, one spec per worktree).

## Architecture

```
apps/api      Hono + Drizzle + Zod on Cloudflare Workers + D1
apps/consta   Consta: the SPEI validation engine — own Worker + D1 (specs in docs/legacy/consta/)
apps/pago     Public payment page (no sessions; mobile-first)
apps/admin    ISP dashboard (desktop-first)
packages/ui   Design tokens (Tailwind v4) + shared atoms
```

Invariants that cut across everything (detail in `docs/legacy/ARCHITECTURE.md`):

- **Money is always integer cents**; visible formatting comes solely from `formatMoney`/`<Amount>` in `packages/ui`.
- **Money history tables are append-only** (house rule, ARCHITECTURE.md): never UPDATE/DELETE; corrections = counter-entries; balances derived with SUM, never stored. The store ledger that embodied it lives in `devolada-red`; the pivot's `credit_entries` is its next instance.
- **Sessions**: Better Auth lives inside `apps/api` (BFF; HTTP-only cookies); `apps/api` is the only party talking to WispHub and to Consta — frontends consume the proxy. The middleware (`apps/api/src/auth/middleware.ts`) checks status in the DB on every request (suspension = immediate revocation).
- **A payment is never rejected because of WispHub failures**: it is recorded and the reconnection is queued on the same `payments` row with visible status (`queued → reconnected | failed | withheld`).
- `businessId` on every business table (the tenant; multi-workspace since phase 2).
- API envelope: `{ success: true, data }` | `{ success: false, error: { code } }`; Zod validation at the edge.

## Frontend

Laws in `docs/legacy/FRONTEND.md`; design artifacts (brief, IA, tasks) in `.design/devolada/` (the SaaS cycle — pivot phase 2; the store-era layer lives in `devolada-red`).

**Every frontend task starts at the shadcn catalog.** Check it before writing a component by hand; copy the primitive into the app's `src/components/ui/` and theme it with our tokens. shadcn is the recipe, the tokens are the law. Order: domain atom in `@devolada/ui` → shadcn primitive → new component.

The other essentials: the tokens in `packages/ui/src/styles/tokens.css` are law (zero hardcoded values; mapped to Tailwind via `@theme inline` in `src/styles/index.css`); `StatusBadge` is the only representation of domain statuses; light+dark via `[data-theme]` (dark is its own palette, not inversion); status is never communicated by color alone (always icon + text).

The ordered build plan lives in `.design/devolada/TASKS.md`; tests cite their user story (`US-D03: …`) per `docs/legacy/TESTING.md`.
