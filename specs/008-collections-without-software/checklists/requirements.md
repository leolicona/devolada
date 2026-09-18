# Specification Quality Checklist: Collections Without Software

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

**Iteration 1 (2026-09-18)** — two items failed. Three requirements carried an
open decision (FR-024 unpaid periods, FR-025 how the payer learns, FR-035
bringing in existing members) and no acceptance scenarios could be written for
them without making one branch look settled. Also fixed before the first run:
five phrases carried architecture vocabulary into a stakeholder document, all
reworded in product terms.

**Iteration 2 (2026-09-18)** — all items pass. The creator answered the three
questions and the spec grew accordingly:

| Was open | Answer | What it changed |
| --- | --- | --- |
| FR-024 | The business chooses per link: accumulate or replace | FR-024, new FR-024a (correcting a balance), FR-005 split so "what it asks now" and "what each period adds" are two numbers; US2 scenarios 8–10 |
| FR-025 | The doorway is the notice, plus an opt-in notice per device; Devolada messaging payers is deferred | FR-025 rewritten, new FR-036 – FR-043, new User Story 4 with 7 scenarios, SC-010 and SC-011, a Constitution Impact reading under principles VI and VIII |
| FR-035 | One at a time; volume stays with the collections API | FR-035 rewritten and moved into "Links made by hand" where it belongs, SC-012, and a list import moved to Deferred with its trigger named |

Scope after the answers: 4 user stories, 32 acceptance scenarios, 44
requirements, 12 success criteria, 18 edge cases.

**On "all functional requirements have clear acceptance criteria"**: most map to
a numbered scenario in their story or to a named edge case. Three are invariants
rather than journeys — FR-012 (a positive whole amount), FR-013 (authorised by
area and action) and FR-014 (visible only to its own business). Their acceptance
is that they hold or they do not, which is clear and testable, so the item
passes rather than being marked with an exception.

**Carried into planning, not blocking**: FR-042 and the notice assumption say
that notice delivery depends on the payer's phone and browser, and that at least
one platform requires a page be added to the home screen first. The plan must
measure actual reach before any copy promises anything. The spec is written so
that a reach of zero still leaves a working feature (FR-043).

**Ready for `/speckit-plan`.**
