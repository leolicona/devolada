# Specification Quality Checklist: Cobros in Links

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-25
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

- Both open questions were answered by the creator on 2026-09-25 and are
  recorded under Clarifications: the chip is **Por cobrar** (FR-002), and a
  search in its view finds customers as Links does and says what each one
  owes (FR-010, FR-017, FR-018, US3). Every item now passes.
- Provider facts (invoice fields, the default date window, the one-call
  balance answer) are named where they change a product promise. This
  repo's specs record measurements this way (constitution: every
  non-obvious rule cites when it was measured). They say what the provider
  answers, not how Devolada is built.
- SC-006 names "the sweep" because the creator asked for its absence from
  this view, in their own words. It is verifiable by switching the pass off.
