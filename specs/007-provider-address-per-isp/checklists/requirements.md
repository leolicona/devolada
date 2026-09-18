# Specification Quality Checklist: Provider Address per ISP

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-18
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

**16 of 16 — ready for `/speckit-plan`.**

### Iteration 1 — 2026-09-18

Two `[NEEDS CLARIFICATION]` markers, both scope-sized rather than detail:
whether an unlisted installation may be self-served, and what becomes of
stored customer references when a connected business changes installation.
Everything else passed on the first pass.

### Iteration 2 — 2026-09-18

Both markers answered by the creator and recorded under **Clarifications**:
the list is closed (no free-text address), and an installation change makes
every affected payment link dormant until re-matched. The second answer added
User Story 4 and six requirements.

### Iteration 3 — 2026-09-18

**Scope cut.** The creator questioned how a business could reach the
installation-change situation at all, given a connection needs both the
address and a key valid on it. Re-reading the code showed the second
clarification rested on a false premise:

- The ordinary correction reads nothing and stores nothing, so there is
  nothing to repair.
- A payment link is keyed by the customer's **username**, not the provider's
  numeric id — the id was already a disposable cache, refreshed on sight,
  because the provider recycles it (`apps/api/src/db/schema.ts`,
  admin-links-view D5). A customer present on the new installation under the
  same username keeps the same link at the same address, with no new
  machinery.
- API-created links carry no provider customer and are untouched.

User Story 4 and the dormancy requirements are removed. What genuinely
remains unprotected is written into a **Deferred** section rather than solved
or dropped silently: a link whose customer is absent from the new
installation still takes a payment, and a username that means a different
person there would attach to the wrong customer. Neither is created by this
feature; neither is fixed by it.

Requirements 19 → 13, stories 4 → 3, success criteria 10 → 8. The feature is
now what it says on the title: the address, per ISP.
