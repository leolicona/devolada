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

- [ ] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [ ] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Iteration 1 (2026-09-18)** — two items fail, both on the same cause.

Three requirements carry an open decision and cannot be planned until the
creator answers:

| Requirement | The fork |
| --- | --- |
| FR-024 | An unpaid period: does it accumulate on the link, or does the new period replace it? |
| FR-025 | How the payer learns a new period fell due: the business sends, the doorway is the notice, or Devolada messages them. |
| FR-035 | Bringing in existing members: one at a time, or a list at once. |

Every other requirement has a matching acceptance scenario in its user story,
or an edge case that names its boundary. The three above have none, on purpose:
writing scenarios for one branch of an open decision would make the answer look
settled.

Fixed during iteration 1, before this checklist was first run: five phrases
carried architecture vocabulary into a stakeholder document (the link's secret
address described as a "token" in three places, and the periodic work described
by its mechanism in Dependencies). All reworded in product terms; the Constitution
Impact section keeps principle vocabulary, which is its job.

**Blocking**: this spec is not ready for `/speckit-plan`. It is ready for
`/speckit-clarify`, or for the creator to answer the three questions directly.
