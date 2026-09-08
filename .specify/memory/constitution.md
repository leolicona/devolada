<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0 (MINOR — a section added that materially expands
guidance; no principle removed or redefined).

Added:
  - "Implementation conventions": the per-concern MUST table naming the library
    and the Claude Code skill to load. Skills are model-invoked and load only when
    a description happens to match; this section is the deterministic anchor that
    /speckit-plan carries through the Constitution Check. Adds the two rules that
    make it bite: a plan lists the skills of every concern it touches, and a task
    introducing a library outside the table needs a recorded decision.

Companion change (same PR): the plan-template override gains a "Skills to load"
line in Technical Context, so the plan has a place to satisfy the first rule.

Previous report (1.0.0, revised before first merge — v1.0.0 never reached main, so this
replaces it in place rather than bumping; nothing has operated under the old text).

Removed:
  - "Spec before code" (was Principle I). GitHub Spec Kit *is* a spec-before-code
    workflow; restating it as a principle was ceremony. The two parts of it that
    Spec Kit does NOT provide were moved rather than dropped: spec-lint stays a
    blocking CI gate (Development workflow), and the lite path moved to the same
    section — it is a workflow rule about which changes legitimately carry no spec,
    not a restatement of spec-before-code.

Renumbered: former II–VIII are now I–VII.

Redefined:
  - IV (was V): the no-internals rule is now law, on its own justification.
    Closes TODO(NO_INTERNALS_RULE).
  - VII (was VIII): user-story identifiers adopt Spec Kit's per-feature `US<n>`
    numbering, prefixed with the feature slug so grep traceability survives the
    loss of global uniqueness. Legacy `US-XNN` stays valid per feature until that
    feature is rebuilt.
  - Governance: precedence inverted. The constitution now wins over the layer
    documents, which is Spec Kit's own model (its constitution is the single
    governance artifact; it has no concept of cross-cutting layer docs). The
    layers remain the detailed reference until PR3 folds their content in.

Deferred:
  - TODO(INTEGRATOR_TERM): the glossary still has no row for the API integrator
    (docs/BRIEF.md §7.3). Principle V governs the term once it exists.
  - Drift for PR3, not patched here: docs/legacy/ARCHITECTURE.md still says
    "ispId" (renamed to businessId by the pivot) and names Agnostic Auth (retired
    for Better Auth). This document states the current truth.
  - New task for the migration plan: PR3 must fold the layer documents' content
    into this constitution before PR4 deletes docs/legacy/, or the precedence
    rule below will point at files that no longer exist.
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

## Implementation conventions

Skills are model-invoked: a skill loads when its description happens to match the
context, and nothing guarantees it does. This section is the deterministic anchor.
`/speckit-plan` carries it through the Constitution Check, tasks inherit it, and
implementation has no escape from it. Each row names the concern, the law, and the
skill to load **before** writing that kind of code.

| Concern | MUST | Skill to load |
|---|---|---|
| HTTP service | **Hono.** Every HTTP surface in `apps/api` and `apps/consta` is a Hono app. Validation with `@hono/zod-validator` at the edge; the uniform envelope on every response. | `hono` ᶠ |
| Contracts and validation | **Zod.** A route's `schema.ts` is the contract; frontends derive types from it and MSW handlers are validated against it, so a mock cannot lie. | `zod` |
| Persistence | **Drizzle on D1.** Migrations through `drizzle-kit`, additive, a rebuild proven on seeded data. Any statement that grows with the tenant is chunked under `D1_MAX_PARAMS` (BUG-021). | `drizzle-orm-d1`, `cloudflare` ᶠ |
| Authentication | **Better Auth inside `apps/api`, and nowhere else** (BFF). HTTP-only cookies; account status re-checked in the database on every request; passkeys and organizations through its plugins. | `better-auth-best-practices` ᶠ, `organization-best-practices` ᶠ, `email-and-password-best-practices` ᶠ, `better-auth-security-best-practices` ᶠ, `create-auth` ᶠ |
| Object storage · inference | **R2** (`PROOFS`) for transfer evidence; **Workers AI** for receipt extraction. | `cloudflare` ᶠ |
| UI | **React 19** with **TanStack Router** (routes are dumb; logic lives in features) and **TanStack Query** (the only home of server state). **Tailwind v4** through the tokens; **shadcn** primitives copied into `src/components/ui/`, never added as a dependency. | `react-router` ᶠ, `router-core` ᶠ, `router-query` ᶠ, `shadcn` ᶠ, `vercel-react-best-practices` ᶠ, `tanstack-query` |
| API tests | **Vitest under `@cloudflare/vitest-pool-workers`**: the real workerd runtime and a real local D1. **No database mocks.** Provider bases are pinned in `vitest.config.ts`, interceptor counts are exact, module caches reset per test. | `vitest` |
| Component and network tests | **Vitest + React Testing Library + happy-dom**, queried by what the user sees. Network through **MSW**, handlers validated against the Zod schemas. Travel from the origin screen; do not mount the destination. | `vitest`, `react` |
| End-to-end | **Playwright + axe** against built previews for breakpoints, touch geometry and real contrast; against the real API (`pnpm e2e:passkey`) for the passkey and identity journeys. | `playwright` |
| Workers, config, deploy | **Wrangler** and `wrangler.jsonc`; Workers best practices (no floating promises, no global state, bindings not globals). Deploys through GitHub Actions only. | `wrangler`, `workers-best-practices`, `cloudflare`, `cloudflare-workers-ci-cd` |
| Build and packaging | **Vite 6** for every frontend; **pnpm** workspaces with `--filter`, `workspace:*` and a committed lockfile. | `vite`, `pnpm` |

Two rules make the table bite:

- A plan MUST list, under *Skills to load* in its Technical Context, the skill of
  every concern the feature touches. A plan that touches a concern without its skill
  fails the Constitution Check.
- A plan MUST fill the **Cloudflare Platform Context** table before Phase 0, and every
  limit or quota in it MUST be verified against current documentation — through the
  Cloudflare MCP server where it is connected, otherwise against the bundled
  references, marked as such. `/speckit-cloudflare-discover` writes that table from
  the spec and `/speckit-cloudflare-review` audits it; both run as optional hooks
  around `/speckit-plan`. **A memorised limit is not a verified limit**: BUG-021 was
  D1's hundred-parameter cap, invisible to a local D1 that does not enforce it and to
  181 passing tests.
- A task MUST NOT introduce a library for a concern in this table other than the one
  named. Doing so is a decision — it goes through Complexity Tracking with the
  rejected alternative, or it is a defect.

Where a skill is generic and the house rule is stricter (Vitest's skill knows nothing
of the workers pool; there is no MSW skill at all), **this table is the law and the
skill is the reference**.

**ᶠ marks a skill published by the technology's own maintainers**, resolved to a
verified GitHub organization. An unmarked skill is community-authored because no
first-party one exists — Drizzle, Zod, Tailwind, TanStack Query, Vitest and MSW
publish none as of 2026-09-08.

Every vendored skill MUST be declared in [`tools/skills.json`](../../tools/skills.json)
with its repository, `license` and `official` flag, and MUST arrive through
`tools/scripts/sync-skills.sh`, which pins each source's upstream commit in
`.claude/skills/skills.lock.json`. That manifest is the single register of what is
installed and where it came from. Three rules follow:

- A skill that contradicts this constitution or a spec is **wrong**, whoever wrote it.
  That holds for first-party skills too, and doubly for community ones.
- **A skill not declared in the manifest has unknown provenance and MUST be replaced
  or removed** — never kept because it seems useful. Local changes to a vendored skill
  go in `tools/skill-overlays/<name>/`, never edited in place, or the next sync
  silently reverts them.
- `skills.sh` performs **no signature verification** on install
  ([RFC](https://github.com/vercel-labs/skills/issues/617)), so a source MUST be pinned
  to an owner/repo verified as the maintainer's, never to a registry slug or a display
  badge. A community source MUST carry a `note` in the manifest saying why it was taken
  when no first-party skill exists.
- A skill whose technology is **not in this project's stack MUST NOT be vendored**. A
  skill nobody can use is noise in every prompt that lists it.

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
