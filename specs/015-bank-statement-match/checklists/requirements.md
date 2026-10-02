# Specification Quality Checklist: bank-statement-match

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-29
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

- Carved out of spec 012's User Story 3 on 2026-09-29. Its six scenarios
  and requirements (spec 012's old FR-013 – FR-018, SC-004) are all here;
  User Story 1 carries five of the scenarios, User Story 3 the "abonos sin
  cliente" one.
- Added while specifying, as informed defaults (see Assumptions), for the
  creator to confirm at `/speckit-clarify`:
  - User Story 2 turns spec 012's "it closes what the instant path did
    not (the payer who never confirmed, the search that found nothing)"
    into rules: a payment is created from a credit for a payer who never
    confirmed, and an expired payment is confirmed.
  - A credit older than the amount it would pay does not pay it (User
    Story 2, scenario 4). Without this rule, a statement uploaded late
    could pay this month's invoice with last month's transfer.
  - A statement never decides a payment in spec 013's undecided state.
  - Movements that are neither SPEI credits nor same-bank credits are
    skipped and not kept.
- Revised 2026-10-02 with same-bank payments (User Story 4, FR-016 –
  FR-023, SC-004), from the creator's decisions of that day
  (Clarifications). Added while specifying as informed defaults, and
  confirmed by the creator on 2026-10-02 ("Sí, continúa"):
  - A receipt showing the same bank on both sides asks the payer for their
    bank before any search (FR-017): the candidate receipt-reader-tuning
    left for this decision, since the reading may be a misread.
  - An operator can mark a same-bank payment "no llegó" by hand, the
    counterpart of confirming it by hand. Without it, a business whose
    bank Devolada cannot read yet keeps a list that never shrinks.
  - A same-bank credit with the payment's reference and amount on another
    day keeps the payment waiting and is listed for the operator; it is
    never confirmed on a day the payer did not give.
  - "No llegó" counts against the payer's history only when the service
    had been restored for it, which is today's rule for a release whose
    money never came.
  - Transfers to the business's card or phone stay out of scope.
- BBVA Net Cash and Banxico appear as the measured facts the feature
  rests on, not as implementation choices.
- The payer reads a same-bank payment's state in spec 017's words, never
  how it is validated (FR-019, the creator's rule of 2026-10-02).
- Planning no longer waits for the pilot's file (Session 2026-10-02): the
  real BBVA export is measured before its reader is built. The same-bank
  part without a file is delivered first.
