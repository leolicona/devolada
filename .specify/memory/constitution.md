<!--
Sync Impact Report
==================
Version: 1.0.0 (revised before first merge — v1.0.0 never reached main, so this
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

**Version**: 1.0.0 | **Ratified**: 2026-09-08 | **Last Amended**: 2026-09-08
