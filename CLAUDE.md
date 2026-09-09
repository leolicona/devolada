# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Devolada: direct SPEI payments with automatic validation for service businesses — today, ISPs running WispHub (permanent payment link → transfer to the ISP's CLABE → Banxico validation through Consta → automatic reconnection). Code identifiers, docs and commits are written in **English**; **user-facing copy is es-MX** (the product ships in Mexico). One word per concept, no synonyms: Cobro→`charge`, Pago directo→`direct_payment`, Comprobante de transferencia→`proof` — the full glossary is in the archive's [`SPEC.md`](https://github.com/leolicona/devoladapago-legacy-documentation/blob/main/SPEC.md). The store network was extracted to the `devolada-red` repo (2026-08-31).

## The archive (read this first when reading old citations)

> **The pre-Spec-Kit corpus left this repo on 2026-09-09.** The 47 spec
> documents, the design cycle and the migration evaluation now live, read-only,
> in
> [`leolicona/devoladapago-legacy-documentation`](https://github.com/leolicona/devoladapago-legacy-documentation).
> Code comments across `apps/`, `packages/`, `tests/` and `scripts/` still cite
> those documents by the paths they had here — `docs/legacy/TESTING.md`,
> `docs/legacy/direct-payment/direct-payment.spec.md`,
> `.design/devolada/TASKS.md`. Those citations were deliberately left intact:
> they are stable names, and they resolve in the archive by dropping the
> prefix — `docs/legacy/<path>` is `<path>` at the archive root, and
> `.design/devolada/<path>` is `design/devolada/<path>`.
>
> The archive is **history, not law**. It records how the features built before
> the migration were specified; it is not amended, and `spec-lint` no longer
> enforces it.

## Methodology (not optional)

> **Spec Kit is the working flow (decided 2026-09-08).** A new feature is
> specified with GitHub Spec Kit, using **its core templates unmodified**:
> `/speckit-specify` creates `specs/NNN-<slug>/`, and `plan.md` / `tasks.md`
> are committed there alongside `spec.md`. There is no
> `.specify/templates/overrides/` and none is to be added — the shape of a
> spec is Spec Kit's to decide, not ours.
> The laws no feature re-decides are in the constitution at
> [`.specify/memory/constitution.md`](.specify/memory/constitution.md), which
> links the layer documents rather than replacing them: on a conflict of
> detail, the linked file wins. The brief is [`docs/BRIEF.md`](docs/BRIEF.md).

The project is **spec-driven**; the constitution governs and CI enforces the gate (`scripts/spec-lint.mjs`):

- **Golden rule**: if it exists in the code but not in a spec, it's wrong. A new feature starts at `/speckit-specify` — never by touching code first. The spec is updated with reality during development; it never forks.
- **Changing a feature that predates the migration**: there is no spec in this repo to amend — the archive is read-only. Either the change rebuilds the feature under Spec Kit (`/speckit-specify`, which is what carries it into `specs/`), or it is small enough for the lite path. Read the archived spec first either way; it is the record of every decision the feature already took.
- **Lite path**: bugfixes/typos/copy carry no spec — they carry a test. (The `BUGS.md` and `TECH_DEBT.md` registers went to the archive with the corpus and have no successor here yet.)
- **Tests cite their story** (constitution VII): a Spec Kit feature uses its per-feature number carrying the feature slug (`direct-payment US1: …`); a feature not yet rebuilt keeps the `US-XNN` it carries in the archive. `spec-lint` accepts both while the migration runs, and checks nothing else.
- **The stack is decided in the constitution** (*Stack conventions*): each convention names the skill under `.claude/skills/` that carries its patterns, and a task that writes code under a convention loads that skill first.
- Cross-cutting layers no feature re-decides — [ARCHITECTURE](https://github.com/leolicona/devoladapago-legacy-documentation/blob/main/ARCHITECTURE.md), [FRONTEND](https://github.com/leolicona/devoladapago-legacy-documentation/blob/main/FRONTEND.md), [TESTING](https://github.com/leolicona/devoladapago-legacy-documentation/blob/main/TESTING.md), [CICD](https://github.com/leolicona/devoladapago-legacy-documentation/blob/main/CICD.md), [integrations](https://github.com/leolicona/devoladapago-legacy-documentation/tree/main/integrations) — are in the archive until the constitution absorbs them.
- The archive's `integrations/agnostic-auth.md` documents the **verified real contract**, which differs from the service's official guide — on conflict, that file wins.

## Commands

```sh
pnpm install                                  # monorepo root (pnpm workspaces)
pnpm playground                               # tokens/components playground (packages/ui, port 5173)
pnpm --filter @devolada/api dev               # local API (wrangler, port 8787; local D1)
pnpm --filter @devolada/consta dev            # Consta validation API (wrangler, port 8788; own local D1)
pnpm --filter @devolada/api db:generate       # generate a drizzle migration from src/db/schema.ts
pnpm --filter @devolada/api db:migrate:local  # apply migrations to the local D1
pnpm -r --if-present typecheck                # typecheck every workspace
pnpm -r --if-present test                     # tests
node scripts/spec-lint.mjs                    # story-citation gate (constitution VII)
node scripts/gen-banks.mjs                    # regenerate the bank constants from scripts/banks.data.md
```

Local dev seed: with the API running, `curl -X POST localhost:8787/dev/seed` creates a demo ISP (`demo@devolada.app`), password `devolada123`. `/dev/*` routes exist only with `ENVIRONMENT=dev`.

**Never deploy from a local machine**: every deploy goes through GitHub Actions. Trunk-based on `main`; PR → CI + preview; merge → dev; `v*` tag → prod with approval gate. Parallel features use `git worktree` (distinct ports, per-worktree local D1, one spec per worktree).

## Architecture

```
apps/api      Hono + Drizzle + Zod on Cloudflare Workers + D1
apps/consta   Consta: the SPEI validation engine — own Worker + D1
apps/pago     Public payment page (no sessions; mobile-first)
apps/admin    ISP dashboard (desktop-first)
packages/ui   Design tokens (Tailwind v4) + shared atoms
```

Invariants that cut across everything:

- **Money is always integer cents**; visible formatting comes solely from `formatMoney`/`<Amount>` in `packages/ui`.
- **Money history tables are append-only** (house rule): never UPDATE/DELETE; corrections = counter-entries; balances derived with SUM, never stored. The store ledger that embodied it lives in `devolada-red`; the pivot's `credit_entries` is its next instance.
- **Sessions**: Better Auth lives inside `apps/api` (BFF; HTTP-only cookies); `apps/api` is the only party talking to WispHub and to Consta — frontends consume the proxy. The middleware (`apps/api/src/auth/middleware.ts`) checks status in the DB on every request (suspension = immediate revocation).
- **A payment is never rejected because of WispHub failures**: it is recorded and the reconnection is queued on the same `payments` row with visible status (`queued → reconnected | failed | withheld`).
- `businessId` on every business table (the tenant; multi-workspace since phase 2).
- API envelope: `{ success: true, data }` | `{ success: false, error: { code } }`; Zod validation at the edge.

**Generated code**: `apps/consta/src/provider/banks.ts` and `apps/api/src/direct-payments/banks.ts` are written by `scripts/gen-banks.mjs` from `scripts/banks.data.md`. Edit the data file and re-run the script — never the constants; CI fails on drift.

## Frontend

**Every frontend task starts at the shadcn catalog.** Check it before writing a component by hand; copy the primitive into the app's `src/components/ui/` and theme it with our tokens. shadcn is the recipe, the tokens are the law. Order: domain atom in `@devolada/ui` → shadcn primitive → new component.

The other essentials: the tokens in `packages/ui/src/styles/tokens.css` are law (zero hardcoded values; mapped to Tailwind via `@theme inline` in `src/styles/index.css`); `StatusBadge` is the only representation of domain statuses; light+dark via `[data-theme]` (dark is its own palette, not inversion); status is never communicated by color alone (always icon + text).

The frontend laws and the design cycle that produced these screens — briefs, information architecture, the ordered build plan, the design reviews and their screenshots — are in the archive under [`design/devolada/`](https://github.com/leolicona/devoladapago-legacy-documentation/tree/main/design/devolada).
