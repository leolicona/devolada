<!--
Sync Impact Report
==================
Version change: (none) → 1.0.0
Rationale: initial adoption. No prior constitution existed; the file held the
unmodified Spec Kit placeholder scaffold, so this is a ratification and not a bump.

Principles: 8 defined (template ships 5 slots; the extra three were requested and
the heading hierarchy is unchanged).
  I.    Spec before code
  II.   Money is exact and its history immutable
  III.  The oracle never loses a payment, and never holds it
  IV.   One tenant model, one billing model
  V.    Nothing outside an adapter speaks a provider's language
  VI.   One word per concept
  VII.  The interface obeys the tokens
  VIII. Every test cites its story

Added sections:
  - Stack and runtime boundaries (SECTION_2)
  - Development workflow and quality gates (SECTION_3)
  - Governance

Removed sections: none.

Sources: this document summarizes and links docs/legacy/{ARCHITECTURE,FRONTEND,
TESTING,CICD,SPEC}.md and docs/BRIEF.md. It does not replace them; on any conflict
of detail the linked file is the normative text.

Follow-up TODOs:
  - TODO(NO_INTERNALS_RULE): whether Devolada specs may depend on Consta internals
    is unresolved (docs/BRIEF.md §7.2). The rule's original justification — keeping a
    future extraction to a folder move — was retired on 2026-09-08. Deliberately absent
    from Principle V until decided.
  - TODO(INTEGRATOR_TERM): the glossary has no row for the API integrator
    (docs/BRIEF.md §7.3). Principle VI governs the term once it exists.
  - Drift found while drafting, to be reconciled in PR3, not here:
    docs/legacy/ARCHITECTURE.md still says "ispId on every business table" (renamed to
    businessId by the pivot) and names Agnostic Auth as the IdP (retired for Better Auth).
    This document states the current truth; ARCHITECTURE.md has not been edited.
-->

# Devolada Constitution

Devolada is the SPEI validation-and-reconciliation platform — the oracle of truth
about whether money arrived. This constitution states the rules no feature
re-decides. It **summarizes and links** the normative layer documents; where a
detail conflicts, the linked file wins.

## Core Principles

### I. Spec before code

Every feature MUST have a written spec before code is touched, and that spec MUST be
registered in the index within the same PR. If it exists in the code but not in a
spec, it is wrong — this is the golden rule, and `scripts/spec-lint.mjs` enforces it
as a blocking CI step rather than as a habit.

Specs are **living documents**: they are amended with reality during development and
MUST NOT fork into a second version of the truth. A spec records its decisions with
stable identifiers and, for each, the alternative that was rejected and why — because
code records what was built and never what was refused.

A **lite path** exists and MUST NOT be widened: a bugfix, typo or copy change carries
an entry in the bug log (when production was affected) plus a regression test, and no
spec. The threshold is exact — if a business rule or a contract changes, it is a spec.

*Rationale*: the corpus is the only place a rejected alternative survives. See
[SPEC.md](../../docs/legacy/SPEC.md).

### II. Money is exact, and its history is immutable

Money MUST be integer cents everywhere. Floats MUST NOT touch amounts. Every visible
amount MUST be rendered through `formatMoney` / `<Amount>` from `packages/ui`, and a
breakdown's total MUST be computed, never passed by hand.

Any table recording money history MUST be append-only: never `UPDATE`, never `DELETE`.
A correction is a counter-entry. A balance MUST be derived with `SUM` and MUST NOT be
stored. Tests MUST build their scenarios with entries, the way production does — a test
that edits or deletes rows to reach a state is not a test of this system.

*Rationale*: a stored balance is a second truth that drifts. See
[ARCHITECTURE.md](../../docs/legacy/ARCHITECTURE.md).

### III. The oracle never loses a payment, and never holds it

A payment MUST NOT be rejected because a provider failed. It MUST be recorded, with
the dependent action queued on the same row under a status the user can see
(`queued → reconnected | failed | withheld`). A failed action MUST demand visible
intervention rather than failing silently.

Devolada MUST NOT take custody of funds. Money moves to the business's own CLABE.
No concentrator account, no percentage of the transfer.

*Rationale*: the money has already moved when we are asked; refusing the record loses
it. Custody is a different company with a different licence.

### IV. One tenant model, one billing model

Every business table MUST carry `businessId`. The business is the tenant, and a user
MAY hold several as isolated workspaces.

Every **confirmed** validation MUST debit that business's prepaid credit at the
current fee — never per attempt, never a percentage of the amount. An API integrator
is a business with prepaid credit like any other: there MUST NOT be a second billing
path. A feature that needs one is a constitutional amendment, not a design choice.

*Rationale*: two billing paths become two schemas, two reconciliations and two truths
about what a customer owes. Decided 2026-09-08 (docs/BRIEF.md §7.1).

### V. Nothing outside an adapter speaks a provider's language

Operated systems MUST sit behind the provider port. An adapter implements the read and
write sides and declares its capabilities; nothing outside it may speak a provider's
API or vocabulary. Rows, envelope and user-facing copy MUST say `PROVIDER_*`.

No screen, row, column or error may assume a specific provider, and a business with no
integration MUST get a coherent product rather than a broken one.

*Rationale*: WispHub is the first integration, not the product. See
[integrations/provider-port.spec.md](../../docs/legacy/integrations/provider-port.spec.md).

### VI. One word per concept

The glossary is law. Each concept has exactly one word in user copy and one identifier
in code; synonyms MUST NOT be introduced. User-facing copy MUST be **es-MX**; code
identifiers, documentation and commits MUST be **English**.

The distinctions the glossary draws MUST be preserved literally — notably that
*"Pago parcial"* is always the reconciliation CLASS `short` while *"Pago incompleto"*
is always the lifecycle STATUS `partial`; a payment may wear both, and they answer
different questions.

Where a measured integration contract in `docs/legacy/integrations/*.md` disagrees
with a vendor's official guide, **the local file wins** — it was measured against the
live service.

*Rationale*: a synonym is a second concept nobody declared. See the glossary in
[BRIEF.md](../../docs/BRIEF.md).

### VII. The interface obeys the tokens

Every colour, space, radius, shadow and size MUST come from
`packages/ui/src/styles/tokens.css`. Hardcoded values are forbidden anywhere outside
that file, and `scripts/contrast-lint.mjs` fails the build on one.

`StatusBadge` MUST be the only representation of a domain status; a missing status is
added to the atom, never re-drawn per screen. Light and dark are two calibrated
palettes — dark MUST NOT be an inversion. Contrast MUST meet AA at minimum.

**Status MUST NOT be communicated by colour alone**: always icon + text.

*Rationale*: colour alone excludes users who cannot see it, and a second status pill
is a second vocabulary. See [FRONTEND.md](../../docs/legacy/FRONTEND.md).

### VIII. Every test cites its story

Every test MUST name the user story it covers (`describe("US-D03: …")`), so spec
coverage is traced by grep rather than by faith. A spec's listed scenarios are the
**floor** for its Definition of Done: the DoD MUST NOT be checked while any of them
lacks a passing automated test.

Tests are part of building a feature, never a later phase.

*Rationale*: an uncited test proves something about the code and nothing about the
spec. See [TESTING.md](../../docs/legacy/TESTING.md).

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
  own API-key authentication, because that boundary is architectural rather than
  commercial. It MUST NOT be folded into `apps/api`.
- `/dev/*` routes MUST exist only when `ENVIRONMENT=dev`.

## Development workflow and quality gates

Trunk-based on `main`. A PR opens the gate; merging deploys to dev; a `v*` tag deploys
to production behind an approval gate.

The PR gate MUST stay blocking and MUST NOT be weakened to land a change:

| Gate | What it protects |
|---|---|
| `scripts/spec-lint.mjs` | Principle I — the golden rule |
| `scripts/gen-banks.mjs --check` | The bank vocabulary compiled from its measured source |
| `scripts/contrast-lint.mjs` | Principle VII — tokens and contrast |
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

This constitution supersedes convenience and precedent. It does not supersede the
layer documents it summarizes: on a conflict of detail, the linked file is normative.

- **Amendments** MUST arrive in their own PR, stating what changed and why, and MUST
  NOT ride along inside a feature PR.
- **Versioning** is semantic. MAJOR removes or redefines a principle in a
  backward-incompatible way; MINOR adds a principle or materially expands guidance;
  PATCH clarifies wording without changing meaning.
- **Compliance** is checked per feature at the Constitution Check gate during planning,
  before research and again after design. A justified violation MUST be recorded in the
  plan's complexity tracking with the simpler alternative that was rejected; an
  unrecorded violation is a defect.
- **During the Spec Kit migration**, `docs/legacy/` remains normative and is still
  enforced by `spec-lint`. This constitution governs new work; it does not retroactively
  overrule an archived spec until that spec is rebuilt. Migration plan:
  [spec-kit-migration.eval.md](../../docs/spec-kit-migration.eval.md).

**Version**: 1.0.0 | **Ratified**: 2026-09-08 | **Last Amended**: 2026-09-08
