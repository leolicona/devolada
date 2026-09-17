# Specification Quality Checklist: consta-api-merge

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.

### Iteration 1 — 2026-09-12

Fifteen of sixteen items pass. The one open item is the three
`[NEEDS CLARIFICATION]` markers, kept on purpose: each is a decision the
product creator owns, each has a recommended answer, and the spec is written
to that answer so that the recommended reply changes nothing.

- **Q1 (FR-021)** — whether the engine keeps any door for callers outside the
  product. The engine was built to serve other companies and none came; the
  product's own external door is `003-automated-collections-api`. Scope.
- **Q2 (FR-022)** — whether the engine's dev-only record is carried across.
  Production holds nothing; dev holds the creator's own measurements. Data.
- **Q3 (FR-023)** — whether the production switch-on, which spends real
  credits on real transfers, is part of this feature. Money.

Two judgements recorded for items 1 and 16 ("no implementation details"):

- The feature's subject is *what the product is made of*. "One service, one
  database, one credential" is the requirement itself, not a leak of how it
  is built; the spec says nothing about which runtime, framework, ORM or
  test tool carries it. Names of decisions (`proof-extraction D<n>`,
  `trust-layer D<n>`) appear because the constitution requires the citations
  to survive the move, and a requirement about citations has to name them.
- The word "Worker" survives once, inside the user's own description quoted
  in Assumptions. Everywhere else the spec says "service".

Two decisions were settled as assumptions rather than questions, each with a
defensible default:

- **The identity-disguising secret is retired.** Its reason — the payer's
  identity crossing the network to another service — is gone with the
  network. A rule without a decision behind it is one the constitution says
  to remove, and the constitution itself cites the month of history the
  missing secret once lost.
- **The engine keeps its name.** Renaming would break every citation the
  moved code carries; keeping it costs nothing anyone can see.

Every success criterion is a count that reaches zero, a comparison case by
case, or a single run of something the project already has (the deploy, the
latency report, the test suite, `/speckit-analyze`).

**Numbering**: `003` is taken by `automated-collections-api` on
`origin/claude/devoladapago-wisphub-integration-cqz6xp` (not yet on `main`),
so this feature is `004`. The two are siblings, not a chain: the spec's
Assumptions and Edge Cases name how they rebase on each other.

### Iteration 2 — 2026-09-12

All three questions answered by the developer with the recommended option;
the markers are replaced in place and the answers recorded under
*Clarifications*. Validation re-run: all 16 items pass.

- **Q1 → internal only.** FR-021 stands as written; the doors, the
  per-business keys and the issuing tokens go with the service.
- **Q2 → start empty.** FR-022 now also says the old database is exported and
  kept unread; the two edge cases that pointed at the question point at the
  requirement instead.
- **Q3 → able, not on.** FR-023 stands as written; SC-005 is proven on a
  preview against an intercepted provider.

Nothing in the answers opened a new question, so the *Open Questions* section
was removed rather than left empty.

### Iteration 3 — 2026-09-12 (re-validation on request)

`/speckit-specify 004` re-ran the checklist over the finished spec. All 16
items pass; one criterion was sharpened rather than changed. **SC-004** now
says that a missing provider credential is not a "could not reach itself"
failure — it is the degraded state FR-009 already governs. Without that
sentence a reviewer could count the absent-credential case against the
criterion and fail a spec that was right.

Verified against the tree while re-reading: four services to three, two
databases to one, six secret slots plus one base URL to one secret, and the
engine's suite at 71 tests across four files — the numbers the summary and
SC-002/SC-003/SC-010 rest on.

**Status: ready for `/speckit-plan`.** `/speckit-clarify` is not needed — no
question remains open in the spec. The plan owes the constitution amendment
named in FR-024 before implementation starts.
