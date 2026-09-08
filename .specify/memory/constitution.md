<!--
Sync Impact Report
==================
Version: 1.0.0 → 1.1.0 (MINOR: materially expanded guidance — the stack is now
decided here, and each convention names the skill that carries it). Revised in place
before first merge — 1.1.0 has not reached main, so this replaces it rather than
bumping, the same way 1.0.0 was revised; nothing has operated under the earlier text.

Added:
  - "Stack conventions" under Stack and runtime boundaries: seven conventions
    (Hono, Drizzle on D1, Wrangler, React + Vite, shadcn, Vitest + Playwright,
    pnpm) stated as MUSTs, each naming the skill that holds its procedural
    knowledge, plus the rule that binds plan → tasks → implement to them.
    Motivation: a skill is model-invoked — it loads when its description matches
    the moment, and nothing guarantees the moment. This file is the deterministic
    layer: /speckit-plan fills the Constitution Check from it, /speckit-tasks and
    /speckit-implement read it, so a convention written here is carried by the plan
    and named on the task, and the skill is loaded on purpose.

Revised in the same PR (2026-09-08), after measuring the cost of hand-copying a
platform skill: the vendored `wrangler` was already two rows behind cloudflare/skills
upstream two days after it was synced. Cloudflare's skills are no longer vendored;
they install from Cloudflare's marketplace through the `cloudflare` plugin, declared
project-wide in .claude/settings.json. The section now states how a skill reaches the
repository (vendored and pinned, or plugin-installed), forbids copying a Cloudflare
skill into .claude/skills/, and the Workers row gains the retrieval-over-memory rule
that the workers-best-practices skill opens with.

Modified principles: none.
Removed sections: none.

Templates: plan-template.md's Constitution Check is filled from this file at plan
time (speckit-plan, step 2); no template edit is needed, and the core templates
stay unmodified by decision (CLAUDE.md, 2026-09-08).

Deferred (carried from 1.0.0, still open):
  - TODO(INTEGRATOR_TERM): the glossary still has no row for the API integrator
    (docs/BRIEF.md §7.3). Principle V governs the term once it exists.
  - Drift for PR3, not patched here: docs/legacy/ARCHITECTURE.md still says
    "ispId" (renamed to businessId by the pivot) and names Agnostic Auth (retired
    for Better Auth). This document states the current truth.
  - PR3 must fold the layer documents' content into this constitution before PR4
    deletes docs/legacy/, or the precedence rule in Governance will point at files
    that no longer exist.
-->

# Devolada Constitution

Devolada is the SPEI validation-and-reconciliation platform — the oracle of truth
about whether money arrived. This constitution states the rules no feature
re-decides.

## Core Principles

### I. Money is exact, and its history is immutable

Money MUST be integer cents everywhere. Floats MUST NOT touch amounts. Every visible
amount MUST be rendered through `formatMoney` / `<Amount>` from `packages/ui`, and a
breakdown's total MUST be computed, never passed by hand.

Any table recording money history MUST be append-only: never `UPDATE`, never `DELETE`.
A correction is a counter-entry. A balance MUST be derived with `SUM` and MUST NOT be
stored. Tests MUST build their scenarios with entries, the way production does — a test
that edits or deletes rows to reach a state is not a test of this system.

*Rationale*: a stored balance is a second truth that drifts.

### II. The oracle never loses a payment, and never holds it

A payment MUST NOT be rejected because a provider failed. It MUST be recorded, with
the dependent action queued on the same row under a status the user can see
(`queued → reconnected | failed | withheld`). A failed action MUST demand visible
intervention rather than failing silently.

Devolada MUST NOT take custody of funds. Money moves to the business's own CLABE.
No concentrator account, no percentage of the transfer.

*Rationale*: the money has already moved when we are asked; refusing the record loses
it. Custody is a different company with a different licence.

### III. One tenant model, one billing model

Every business table MUST carry `businessId`. The business is the tenant, and a user
MAY hold several as isolated workspaces.

Every **confirmed** validation MUST debit that business's prepaid credit at the
current fee — never per attempt, never a percentage of the amount. An API integrator
is a business with prepaid credit like any other: there MUST NOT be a second billing
path. A feature that needs one is an amendment to this constitution, not a design
choice.

*Rationale*: two billing paths become two schemas, two reconciliations and two truths
about what a customer owes.

### IV. A boundary is crossed through its contract, never around it

Operated systems MUST sit behind the provider port. An adapter implements the read and
write sides and declares its capabilities; nothing outside it may speak a provider's
API or vocabulary. Rows, envelope and user-facing copy MUST say `PROVIDER_*`. No
screen, row, column or error may assume a specific provider, and a business with no
integration MUST get a coherent product rather than a broken one.

The same rule governs the validation engine. `apps/consta` MUST be reached only
through its public API — never through its database, its tables or its internal
modules — even though it is a domain of Devolada rather than a separate product.

*Rationale for keeping this after the merge was planned*: unifying Consta into one
database is intended, and this rule is what makes that unification cheap. While every
caller goes through the contract, the merge is a change inside one adapter; the day
callers reach into Consta's tables, it becomes an excavation of every caller instead.
The rule is retired **by** the unification's own spec, not before it.

### V. One word per concept

The glossary is law. Each concept has exactly one word in user copy and one identifier
in code; synonyms MUST NOT be introduced. User-facing copy MUST be **es-MX**; code
identifiers, documentation and commits MUST be **English**.

The distinctions the glossary draws MUST be preserved literally — notably that
*"Pago parcial"* is always the reconciliation CLASS `short` while *"Pago incompleto"*
is always the lifecycle STATUS `partial`; a payment may wear both, and they answer
different questions.

Where a measured integration contract disagrees with a vendor's official guide, **the
measured contract wins** — it was verified against the live service.

*Rationale*: a synonym is a second concept nobody declared.

### VI. The interface obeys the tokens

Every colour, space, radius, shadow and size MUST come from
`packages/ui/src/styles/tokens.css`. Hardcoded values are forbidden anywhere outside
that file, and `scripts/contrast-lint.mjs` fails the build on one.

`StatusBadge` MUST be the only representation of a domain status; a missing status is
added to the atom, never re-drawn per screen. Light and dark are two calibrated
palettes — dark MUST NOT be an inversion. Contrast MUST meet AA at minimum.

**Status MUST NOT be communicated by colour alone**: always icon + text.

*Rationale*: colour alone excludes users who cannot see it, and a second status pill
is a second vocabulary.

### VII. Every test names the story it covers

Every test MUST name the user story it covers, and the name MUST identify the story
globally. Spec Kit numbers stories per feature (`US1`, `US2`), so the citation MUST
carry the feature slug with it:

```
describe("direct-payment US1: a valid transfer reconnects the service", …)
```

A bare `US1` is not a citation — two features would both own one, and the traceability
this principle exists for is grep across the repository.

A spec's acceptance scenarios are the **floor** for its Definition of Done: the DoD
MUST NOT be checked while any of them lacks a passing automated test. Tests are part of
building a feature, never a later phase.

*Transition*: a feature not yet rebuilt keeps its legacy `US-XNN` identifier, and its
tests are compliant as they stand. A feature's tests adopt the new form in the same PR
that rebuilds its spec — never separately, or the citation points at nothing.

*Rationale*: an uncited test proves something about the code and nothing about the spec.

## Stack and runtime boundaries

The platform runs entirely on Cloudflare Workers, with **D1**, **R2** and **Workers AI**
as its only data and inference primitives. Introducing another (KV, Queues, Durable
Objects, Vectorize, Hyperdrive) is an architectural decision that MUST be recorded in a
spec before use.

- `apps/api` is the **Backend-for-Frontend, and this is a law rather than a preference**.
  It alone talks to providers and to the validation engine. Frontends MUST NOT store
  tokens, call an identity provider, or attach `Authorization` headers — they send
  cookies and receive envelopes.
- Sessions are HTTP-only cookies, and the middleware MUST check account status **in the
  database on every request**: suspension is immediate revocation, never a token's
  remaining lifetime. A 401 MUST be identical whether the account exists or not.
- The API envelope is uniform — `{ success: true, data }` or
  `{ success: false, error: { code } }` — with Zod validation at the edge. The Zod
  schemas are the contract frontends and mocks derive from.
- `apps/consta` is the **validation engine: a domain of Devolada, not a separate
  product**, and it is not sold on its own. It keeps its own Worker, its own D1 and its
  own API-key authentication today. Unifying it onto one database is intended future
  work and MUST arrive as its own spec, which weighs at least: the row-read quota a
  single D1 then carries for both, how validation logs sit beside append-only credit
  entries under Principle I, and what replaces API-key authentication at the seam.
- `/dev/*` routes MUST exist only when `ENVIRONMENT=dev`.

### Stack conventions

The stack is decided here, not per plan. Each convention below is law for every feature,
and beside it is the skill that carries its procedural knowledge — the house patterns, the
pitfalls, the commands. Skills are model-invoked: one loads when its description matches
the moment, and nothing guarantees the moment. This table is the deterministic anchor. A
plan's Constitution Check MUST name every convention the feature touches; `tasks.md` MUST
carry that convention on each task that writes code under it; and such a task MUST load the
named skill before writing. A deviation from a convention is recorded in the plan's
Complexity Tracking with the alternative rejected, and it lands as an amendment here before
the code does — never as a feature-level decision.

A skill reaches the repository one of two ways, and the table says which. Most are vendored
under `.claude/skills/`, pinned to the upstream commit recorded in
`.claude/skills/skills.lock.json`. Cloudflare's are **not**: they are installed from
Cloudflare's own marketplace by the `cloudflare` plugin, declared project-wide in
`.claude/settings.json` so that every clone resolves the same one, and they MUST NOT be
copied into `.claude/skills/` — a hand-copied platform skill goes stale against the
platform it documents, which is how this rule was learned.

| Convention | Skill |
|---|---|
| Every HTTP service MUST be a **Hono** app on Workers. Routes validate with Zod through `@hono/zod-validator` and answer with the envelope above; a Hono app is tested through `app.request()` under `@cloudflare/vitest-pool-workers`. | `hono` |
| Every database access MUST go through **Drizzle** on D1. `src/db/schema.ts` is the source of truth; migrations are generated with `drizzle-kit generate` into `migrations/`, versioned, and applied only through `wrangler d1 migrations apply`. | `drizzle-orm-d1` |
| Every Worker MUST be declared in a versioned `wrangler.jsonc` and run locally with `wrangler dev`; it deploys only from GitHub Actions (Development workflow). A platform limit, binding or API claim MUST be verified against current documentation rather than recalled. | `wrangler`, `workers-best-practices` (`cloudflare` plugin) |
| Every frontend MUST be **React with Vite**, shipped as static assets from its own Worker — no server rendering, no Next.js. Server state lives in TanStack Query; `apps/admin` routes with TanStack Router. | `vite`, `vercel-react-best-practices` |
| UI primitives MUST come from the **shadcn** catalog, copied into the app's `src/components/ui/` and themed with the tokens (Principle VI). A component library MUST NOT be added as a dependency. | `shadcn` |
| Tests MUST run on **Vitest** in every workspace — Workers under `@cloudflare/vitest-pool-workers`, UI under happy-dom with Testing Library — and end-to-end flows on **Playwright** from the root configs. | `vitest`, `webapp-testing` |
| The monorepo MUST stay on **pnpm workspaces**; `pnpm-lock.yaml` is written only by pnpm. | `pnpm` |

*Rationale*: a rule the plan carries and the task names is followed; a skill that may or
may not load is a hope. The skill holds the how; the constitution holds the must.

## Development workflow and quality gates

Trunk-based on `main`. A PR opens the gate; merging deploys to dev; a `v*` tag deploys
to production behind an approval gate.

**Not every change carries a spec.** A bugfix, typo or copy change carries a bug-log
entry (when production was affected) plus a regression test, and no spec. The threshold
is exact and MUST NOT be widened: if a business rule or a contract changes, it is a
spec.

The PR gate MUST stay blocking and MUST NOT be weakened to land a change:

| Gate | What it protects |
|---|---|
| `scripts/spec-lint.mjs` | That code has a spec behind it, and that tests cite their story |
| `scripts/gen-banks.mjs --check` | The bank vocabulary compiled from its measured source |
| `scripts/contrast-lint.mjs` | Principle VI — tokens and contrast |
| `pnpm -r typecheck` · `pnpm -r test` · `pnpm -r build` | The rest |

- **No deploy ever runs from a local machine.** Every deploy goes through GitHub
  Actions with configuration injected at build time. An agent can break a build; it
  MUST NOT be able to break production.
- A secret the pipeline plants MUST be verified against its provider, not merely
  counted as present — a wrong-but-present credential deploys green otherwise.
- Parallel features use `git worktree`, one spec per worktree. Two features touching
  the same spec serialize; they are not parallel.
- Migrations MUST be additive, and a migration that rebuilds a table MUST be proven
  against seeded data before it ships.

## Governance

**This constitution is the governing document.** Where it speaks, it is the final word;
a practice that contradicts it is a defect, not a precedent.

Detail it does not state lives in the layer documents under `docs/legacy/`
([ARCHITECTURE](../../docs/legacy/ARCHITECTURE.md),
[FRONTEND](../../docs/legacy/FRONTEND.md),
[TESTING](../../docs/legacy/TESTING.md),
[CICD](../../docs/legacy/CICD.md),
[integrations](../../docs/legacy/integrations/)), which remain the reference — and,
for anything not yet rebuilt, remain enforced by `spec-lint`. That arrangement is
temporary by construction: the migration deletes `docs/legacy/`, so any law still
living only there MUST be folded into this document before it goes
([migration plan](../../docs/spec-kit-migration.eval.md)).

- **Amendments** MUST arrive in their own PR, stating what changed and why, and MUST
  NOT ride along inside a feature PR.
- **Versioning** is semantic. MAJOR removes or redefines a principle in a
  backward-incompatible way; MINOR adds a principle or materially expands guidance;
  PATCH clarifies wording without changing meaning.
- **Compliance** is checked per feature at the Constitution Check gate during planning,
  before research and again after design. A justified violation MUST be recorded in the
  plan's complexity tracking with the simpler alternative that was rejected; an
  unrecorded violation is a defect.

**Version**: 1.1.0 | **Ratified**: 2026-09-08 | **Last Amended**: 2026-09-08
