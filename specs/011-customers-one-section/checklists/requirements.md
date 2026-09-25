# Specification Quality Checklist: Customers, One Section

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

Two items failed on the first pass and were fixed before this checklist was
marked complete:

- **Success criteria technology-agnostic** — SC-007 measured "no additional
  provider request", which is an internal cost, not an outcome the operator
  can feel. Rewritten as the wait the operator experiences: Clientes opens no
  slower than the slower of the two sections it replaces.
- **No implementation details leak** — an assumption read "the card is a
  route, not an overlay". Rewritten in the product's own words: the card has
  its own address, so it can be sent to a colleague.

Nothing carried a [NEEDS CLARIFICATION] marker. Where the description did not
decide, a default was chosen and recorded in **Assumptions**; each is a
legitimate target for `/speckit-clarify`. The three most consequential, in
order of what they would cost to change later:

1. **The debt is shown on every row, under every filter** — including while
   browsing the whole customer base. This is the premise of the merge; if it
   were narrowed to the debt view only, the split this feature closes would
   partly reopen.
2. **The filter offers four states** (owes / past due / not yet due /
   everyone). Keeps every filter the debtor list has today and adds the
   whole base as a fourth. A narrower strip would drop a capability the
   merge is not supposed to cost.
3. **The section opens on debtors.** Taken from the operator's own described
   workflow. Opening on everyone instead would put the filter back as a step.

One structural item is worth a reviewer's eye rather than a fix: FR-027 asks
that "the customers who owe right now" be answerable without a browser, and
SC-008 measures it. It is the only requirement in this spec that exists for a
feature not yet written. It earns its place because the alternative — learning
after the merge that the debtor set only exists as a screen's shape — is a
rewrite, not an addition.

**Amended 2026-09-23** after the demo-tenant billing-cycle case (spec,
*How a balance moves through one billing cycle*). Two clarifications were
recorded as the creator's decisions (the row shows balance and open invoices
by name; the default filter is *Con facturas abiertas*), and FR-002, FR-006,
FR-007, FR-008, FR-016, FR-017 and FR-027 were revised to match. Re-checked:
16/16 still pass, and there are still no [NEEDS CLARIFICATION] markers. The one
new open question (a total on the row) is recorded in **Assumptions**.

**Amended 2026-09-25**: the creator chose this feature over
cobros-on-demand-search (Clarifications). Nothing in the checklist changes.
