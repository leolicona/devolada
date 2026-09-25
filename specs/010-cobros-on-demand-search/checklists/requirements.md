# Specification Quality Checklist: Cobros On-Demand Search

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-22
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

### Iteration 1 — 2026-09-22

Three functional requirements had no acceptance scenario, so nothing on the
screen would have failed if they were skipped:

- **FR-023** (the link is born from the act on a search result too) — added
  as US1 scenarios 12 and 13, the second one negative: reading results
  creates nothing. Without it the feature could ship creating a link per
  rendered result, which is exactly what `009 FR-008` exists to prevent.
- **FR-018** (a customer answered in two blocks is rendered once) — added as
  US2 scenario 8. The provider offers no ordering, so this is a real state,
  not a hypothetical.
- **FR-025** (the business's timezone owns "overdue") — added as US2
  scenario 9, written so it fails if the browser's date is used. Carried
  from the page's current behaviour, which no scenario had pinned.

### Provider-contract facts in the spec — deliberate

`OPTIONS /facturas/`, `tipo_fecha`, `desde` / `hasta`, `limit` / `offset`,
`saldo` and `estado_facturas` appear in **Context** and **Assumptions**, never
in a functional requirement. They are the provider's constraints on what the
product can promise, not choices Devolada is free to make — and constitution
principle I requires the decision to carry the measurement that made it, with
its date. This follows the precedent of
[`009`](../../009-links-on-demand-search/spec.md), whose Assumptions name
`__contains`, `estado` and the same paging parameters.

The one fact that had to be measured twice before the spec could be written
is stated as such: the invoice list takes **no customer filter**
(`OPTIONS /facturas/` 2026-09-01; re-verified live 2026-08-16). Every shape
in this feature follows from it.

### One assumption the plan must settle before building

The due-date filters (FR-014) rest on `tipo_fecha` with `desde` / `hasta`,
which the provider documents but which carry two known hazards: both dates
default to the current month, so a filter that forgets its window silently
drops older arrears; and a row with no due date belongs to no due-date
window. The spec names the fallback rather than leaving it to the screen —
one list with no tabs, never a tab that quietly describes only the rows that
happened to load.
