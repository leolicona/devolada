# Specification Quality Checklist: feedback-vocabulary-rollout

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-09
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

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.

### Iteration 1 — 2026-09-09

All 16 items pass on the first pass. Zero `[NEEDS CLARIFICATION]` markers: the
three decisions that could have become questions were settled as documented
assumptions instead, each with a defensible default —

- **A known content shape wins** over the generic pending signal (FR-003), so no
  question about which treatment a region gets.
- **Departure is animated only for surfaces that overlay the page.** Animating
  every unmount in the product is a cost this feature declines to take on.
- **The back office reuses the payer's announcement pattern screen by screen**
  rather than gaining a product-wide announcer, which would be a larger change
  than anything here requires.

Every success criterion is a count that reaches zero or a side-by-side
comparison, so none of them needs an instrument the project does not have.

### Companion edits outside this feature

Resolving these gaps required narrowing `001-design-foundations`, because two
specs cannot both own the same requirement:

- Its **FR-007** now says it implements `waiting` and `resolving`, and names this
  feature for the other three.
- Its **SC-009** is now scoped to the payer's surface.
- Its **Out of Scope** names the split and why it happened.

Those edits are recorded here rather than hidden: this command's own output is
the 002 spec, and the 001 change is the other half of the same decision.

### Iteration 2 — 2026-09-10 (User Story 4 added)

Finding **I2** folded in on request: `StatusBadge` still declares `sm` / `md`
while every other shared component now names a context. Re-ran all 16 items
against the amended spec; all 16 still pass, with two worth recording.

- **"No implementation details" (items 1 and 16).** User Story 4 quotes `sm` and
  `md`, and Key Entities names `compact` / `standard` / `decisive`. These are the
  vocabulary itself — already a Key Entity in `001-design-foundations`'s data
  model — and the story cannot be stated without naming the words it replaces.
  Kept.
- **"Focused on user value" (item 2).** This story's value goes to whoever builds
  the next screen, not to the payer or the operator. That is stated plainly in
  its **Why this priority** rather than dressed up as an end-user benefit, and it
  is why the story sits at P4 behind the three that fix something.

Two decisions were settled as assumptions instead of questions:

- **Renaming, not resizing.** The vocabulary names contexts; a status is read
  rather than aimed at, so it takes the names and keeps its dimensions. Giving
  the badge the vocabulary's 40/48px heights would grow every badge in a table
  row — a visual change nothing asked for.
- **The rename reaches the payer's six call sites.** Leaving them on the old word
  would keep two vocabularies alive, which is the drift itself. It edits a word,
  not a pixel, so the feature stays back-office in everything a user can see.

**Status: ready for `/speckit-plan`** — `001-design-foundations` has now shipped
(PR #195, merged into `main`), so this spec's first assumption is satisfied.

### Iteration 3 — 2026-09-10 (post-convergence)

One criterion changed after implementation, recorded here because the checklist
is where a spec edit made late is easiest to miss.

**SC-009 was narrowed** from "size names used anywhere in the product" to "size
names used on a control or a status". `/speckit-converge` found the code
satisfying FR-011 and failing SC-009 — `Avatar` declares `xs` / `sm` / `lg` and
is app-local, so FR-011's "shared component" scope never reached it. The
criterion was written broader than the requirement it measures, and broader than
the entity it names: the data model calls it **Control size**, with heights and
a touch-target rule, and an avatar is neither aimed at nor read as status. The
alternative — renaming a 24px nav glyph `compact` — would have made the
vocabulary mean less.

All 16 items re-checked against the amended spec; all 16 still pass. "Success
criteria are measurable" now measures something the product actually governs.
