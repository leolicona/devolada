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

Both answered by the creator and recorded under **Clarifications**:

- **Closed list.** No free-text address. An installation Devolada has not
  vetted is neither selectable nor reachable; adding one is a reviewed change.
  The cost — an ISP on a new installation waits on Devolada — is carried by
  FR-006, which requires the screen to say so and show how to ask, rather than
  leaving an empty choice.
- **Accept the change and invalidate.** Changing installation re-reads the
  roster and makes every affected payment link dormant until its match is
  confirmed. This is the larger of the two options and it grew the feature:
  User Story 4 was added at P4, and FR-011 through FR-017 now carry dormancy,
  the payer's message, the survival of the link's address, and the rule that a
  reference from another installation can never be acted on.

The new story is a genuine slice: without it an ISP can still change
installation safely — links go dormant and they build new ones — so the
recovery flow can ship after the rest without leaving money at risk. FR-013
states that separation explicitly so a plan cannot lose it.

Requirement count grew 13 → 19, success criteria 8 → 10, edge cases 7 → 10.
