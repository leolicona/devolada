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

- [ ] No [NEEDS CLARIFICATION] markers remain
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

- Two open questions, three markers: the chip's label (FR-002) and what a
  search does in the Cobros view (FR-010, and US3, which depends on it).
  Both go to the creator before `/speckit-plan`.
- Provider facts (invoice fields, the default date window, the one-call
  balance answer) are named where they change a product promise. This
  repo's specs record measurements this way (constitution: every
  non-obvious rule cites when it was measured). They say what the provider
  answers, not how Devolada is built.
- SC-006 names "the sweep" because the creator asked for its absence from
  this view, in their own words. It is verifiable by switching the pass off.
