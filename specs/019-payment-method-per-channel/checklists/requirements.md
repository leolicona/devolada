# Specification Quality Checklist: payment-method-per-channel

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-01 · **Re-validated**: 2026-10-02, after Devolada took over the naming of the methods
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

- The spec was rewritten on 2026-10-01 from a collector user to payment
  methods, and its directory renamed from `019-devolada-as-collector` to
  `019-payment-method-per-channel`, so code comments cite a slug that
  says what the feature does. The branch keeps its name.
- Revised on 2026-10-02 from the creator's note: Devolada names the methods
  (`SPEI - LINK DEVOLADAPAGO`, `EFECTIVO - RED DEVOLADAPAGO`), one for the
  whole store network, and the increment lives in the adapter. This
  removed the choice screen, the per-store methods, the per-payment mark in
  Pagos and the new entity. The Clarifications keep both sessions, and
  mark what the second one replaced.
- The same day the creator fixed the final names, `SPEI -
  LINK.DEVOLADAPAGO` and `CASH - RED.DEVOLADAPAGO`. Reading the adapter
  showed that "CASH" matches today's rule for the cash method, so FR-012
  (the cash method is never one of Devolada's) and an edge case on rollout
  order were added, and FR-003's tolerance now names the dot.
- The method names appear in the spec because they are product copy the
  business types into its own system, and the creator fixed them. FR-011
  places them in the adapter, so the core never carries them.
- Two readings were informed defaults, recorded in Assumptions: one method
  for the network (from the creator's example "EFECTIVO - RED
  DEVOLADAPAGO"), and "descripción" as the method's own description in the
  business's system, if it has one (M4), never part of the match.
- US4 (the screen says whether each method exists) is added so a typo in
  the name does not send every payment back to cash in silence
  (constitution VIII). It lives on the integration's own screen, which the
  adapter already owns.
- "What was measured" (R1–R7) and "What must be measured before the plan"
  (M1–M4) name provider facts, not implementation. They follow the house
  style of spec 014's "What the provider answers (measured)". M1 and M4
  are measured by API on the demo tenant; M2 and M3 in the provider's
  panel by the creator. They are product dependencies, not clarifications.
- The Dependencies section corrects the first draft: the action half of
  the debt `core-reads-provider-directly` was already paid by spec 018 D9,
  so recording a payment is already a declared capability. This feature
  only widens what the core hands it.
