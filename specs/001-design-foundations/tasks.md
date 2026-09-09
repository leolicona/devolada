# Tasks: design-foundations

**Input**: Design documents from `/specs/001-design-foundations/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included, and not optional here. Constitution IV puts contrast, target
size, reduced motion and stacking order in the browser layer because happy-dom
cannot answer them; constitution VII requires every new spec file to cite its
story. Each test task below names the citation it must carry.

**Organization**: Grouped by user story, so each can be implemented, tested and
demonstrated on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3 — maps to the user stories in spec.md
- File paths are exact and repo-relative

---

## Phase 1: Setup

**Purpose**: get a baseline to compare against.

- [X] T001 Install workspace dependencies with `pnpm install` at the repository root
- [X] T002 Capture the pre-change review baseline: run `pnpm exec playwright test --config playwright.review.config.ts` and keep the output, so User Story 3 can prove the back office renders unchanged — 136 passed, 49 captures, manifest at `baselines/T002-review-capture.sha256` (see `baselines/README.md` for how T036 compares against it)

> **T003 and T004 were withdrawn on 2026-09-09.** They built a three-candidate
> panel in the playground and gated every other task on a comparison session
> there. The breath pair is two numbers in a token: changing it later is a
> one-line edit to `tokens.css`, so gating the whole feature on deciding it
> first bought nothing. Candidate A (`1 → 0.70`, `2.4s`) is settled in
> `contracts/design-tokens.md` §3 and the looking moved to T047, where it
> happens on the real pending screen with the real copy beside it — a better
> test than three swatches out of context. The IDs are left as a gap rather
> than renumbered, so every cross-reference in this file and in the analysis
> still points where it did.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the value layer. Every user story consumes it.

**⚠️ CRITICAL**: no story work begins until this phase is complete. Tasks T005–T006
share one file and T007–T010 share another, so this phase is deliberately
sequential — do not parallelise it.

- [X] T005 Add the stacking scale to `packages/ui/src/styles/tokens.css` in `:root` — `--z-base: 0`, `--z-sticky: 10`, `--z-dropdown: 20`, `--z-overlay: 30`, `--z-modal: 40`, `--z-toast: 50`, with a comment citing `design-foundations D8` and noting the ten-step spacing
- [X] T006 Add `--duration-breath` and `--opacity-breath` to `packages/ui/src/styles/tokens.css` using the pair settled in `contracts/design-tokens.md` §3 — research R3 candidate A, `2400ms` and `0.7` — citing `design-foundations D10`. T047 confirms the pair on screen and may change these two values; nothing else moves if it does (depends on T005)
- [X] T007 Extend the `@theme inline` block in `packages/ui/src/styles/index.css` with the mappings from `contracts/design-tokens.md`: `--z-index-*` for the six positions, `--transition-duration-*` for the four durations, `--ease-default` plus the `--ease-in` / `--ease-out` overrides, and `--animate-breath`. Note in a comment that the theme keys are Tailwind's names, not ours, and that both are required (research R1)
- [X] T008 Bind `--default-transition-duration: var(--duration-fast)` and `--default-transition-timing-function: var(--easing-default)` in the same `@theme inline` block in `packages/ui/src/styles/index.css`, with a comment recording that this is what makes a bare `transition-colors` obey the tokens (research R2) (depends on T007)
- [X] T009 Add `@keyframes breath` to `packages/ui/src/styles/index.css` animating opacity only — `50% { opacity: var(--opacity-breath) }` — with a comment stating that no transform may ever enter these keyframes, because the reduced-motion exception depends on it (depends on T006, T007)
- [X] T010 Amend the `prefers-reduced-motion` block in `packages/ui/src/styles/index.css`: keep the blanket flattening and add one exception re-enabling animation for `[data-motion="breath"]`, citing `design-foundations D13` and constitution VI. **The exception MUST carry `!important` on `animation-duration` and `animation-iteration-count`, and MUST come after the blanket rule.** The blanket rule uses `!important`, which beats specificity — without it the breath silently stays frozen and every visual check still "passes" because a frozen screen and a working one look identical in a screenshot (depends on T009)

**Checkpoint**: values exist and reach the utilities. `pnpm --filter @devolada/ui build` succeeds and `z-modal`, `duration-slow`, `ease-default` and `animate-breath` resolve.

---

## Phase 3: User Story 1 - The payer can see the page is still working (Priority: P1) 🎯 MVP

**Goal**: while a transfer is being validated the page breathes; when the answer
arrives it fades in, the same way for a confirmation and a refusal.

**Independent Test**: with a validation pending, cover the wording and ask
whether the page is still working; then let the outcome land and ask whether it
was noticed. Needs no part of US2 or US3.

- [ ] T011 [P] [US1] Create the `Pending` atom in `packages/ui/src/components/pending.tsx` per `contracts/components.md`: props `active`, `label`, `announce`, `children`; sets `data-motion="breath"` and `animate-breath` only while active; announces `label` itself only when `announce` is true, so a caller that already owns a live region passes `announce={false}` and no state is ever read out twice; applies no transform; honours the ~200ms flash threshold and a minimum visible duration (FR-014)
- [ ] T012 [P] [US1] Create the `Reveal` wrapper in `packages/ui/src/components/reveal.tsx`: fades its children in over `--duration-slow` with `--easing-default`, no scale, no translate, identical for good and bad news (FR-012)
- [ ] T013 [US1] Export `Pending` and `Reveal` from `packages/ui/src/index.ts` (depends on T011, T012)
- [ ] T014 [P] [US1] Component test in `packages/ui/src/components/pending.test.tsx` citing `design-foundations US1`: the breath attribute is present while active and absent when idle, no transform utility is applied, the label is available to assistive technology, and a process shorter than the flash threshold renders nothing
- [ ] T015 [P] [US1] Component test in `packages/ui/src/components/reveal.test.tsx` citing `design-foundations US1`: children are rendered, no transform utility is applied, and the same treatment is used regardless of the outcome's tone
- [ ] T016 [US1] Wrap the verification state in `apps/pago/src/features/pago/PaymentPage.tsx` (the pending branch around lines 604–626) with `Pending`, passing `announce={false}` so the `aria-live="polite"` region already at line 584 stays the single announcer, and passing the existing wording as `label` for the attribute only (depends on T013)
- [ ] T017 [US1] Wrap the outcome — the release `Alert` and its refusal counterpart — in `Reveal` in `apps/pago/src/features/pago/PaymentPage.tsx`, without touching the staged waiting copy or its schedule (depends on T013)
- [ ] T018 [US1] Add `tests/e2e/motion.spec.ts` citing `design-foundations US1`: with `prefers-reduced-motion: reduce` no element animates transform anywhere in either surface, the outcome still appears, and — the assertion that catches T010 going wrong — the breath's **computed** `animation-duration` is the token's value and not `0.01ms`. Asserting the class or the attribute is not enough; only the computed value proves the cascade resolved the way it was meant to
- [ ] T019 [US1] Add a permanent `Pending` and `Reveal` demonstration to `packages/ui/src/playground/Showcase.tsx` (depends on T011, T012)

**Checkpoint**: User Story 1 is complete and demonstrable on its own.

---

## Phase 4: User Story 2 - Overlapping surfaces behave as one system (Priority: P2)

**Goal**: one stacking order and one dimming treatment across every overlapping
surface, in both themes.

**Independent Test**: open every overlapping surface in both themes; each sits
where the order says and dims the page identically.

- [ ] T020 [P] [US2] In `apps/admin/src/components/ui/dialog.tsx`, replace `z-50` with `z-overlay` on the overlay and `z-modal` on the content, and `bg-black/50` with `bg-overlay`
- [ ] T021 [P] [US2] In `apps/admin/src/components/ui/alert-dialog.tsx`, the same substitution, dropping `bg-ink/40`
- [ ] T022 [P] [US2] In `apps/admin/src/components/ui/sheet.tsx`, the same substitution, dropping `bg-black/50`
- [ ] T023 [P] [US2] In `apps/admin/src/components/ui/popover.tsx`, replace `z-50` with `z-dropdown`
- [ ] T024 [P] [US2] In `apps/admin/src/components/ui/select.tsx`, replace `z-50` with `z-dropdown`
- [ ] T025 [US2] Sweep for survivors: `grep -rn "z-\[\|z-[0-9]" apps packages --include="*.tsx" | grep -v node_modules` must print nothing (FR-002, SC-005) (depends on T020–T024)
- [ ] T026 [US2] Add `tests/design/review-foundations.spec.ts` citing `design-foundations US2`: capture dialog, sheet and confirmation in both themes so the three dimmings can be compared as images (SC-006)
- [ ] T027 [US2] Add a scenario to `tests/design/review-foundations.spec.ts` opening a confirmation from an open sheet and capturing it, proving the order resolves rather than depending on which was written last (depends on T026)

**Checkpoint**: User Story 2 is complete and verifiable from the captures alone.

---

## Phase 5: User Story 3 - One button, one field, three sizes (Priority: P3)

**Goal**: the button and the text field each have exactly one definition.

**Independent Test**: delete the duplicate definitions; every back-office screen
renders unchanged against the T002 baseline.

- [ ] T028 [US3] Extend the recipe in `packages/ui/src/components/button.tsx` to the contract in `contracts/components.md`: sizes `compact` (40px), `standard` (48px, default), `decisive` (64px, full width); variants `primary`, `secondary`, `ghost`, `destructive`, `link`. Keep the disabled-is-a-different-fill rule both current files document, and delete the file's own `duration-150` while here
- [ ] T029 [US3] Update the payer's surface for the renamed sizes in `apps/pago/src/features/pago/PaymentPage.tsx`: `size="critical"` at lines 225, 286 and 1253 becomes `decisive`, and any reliance on the old `md` default becomes `standard`. This is a compile break the moment T028 lands, so it ships in the same change, not after it. `StatusBadge`'s own `size="md"` is a different prop and is left alone (depends on T028)
- [ ] T030 [US3] Extend `packages/ui/src/components/input.tsx` with the `compact` size, keeping the `Field` wrapper and the deliberately darker `--color-border-input` edge
- [ ] T031 [P] [US3] Component test in `packages/ui/src/components/button.test.tsx` citing `design-foundations US3`: all five variants and three sizes render, `decisive` keeps its full width, and disabled changes fill rather than opacity
- [ ] T032 [P] [US3] Component test in `packages/ui/src/components/input.test.tsx` citing `design-foundations US3`: both sizes render and the field keeps its label, hint and error wiring
- [ ] T033 [US3] Re-point every back-office import of the local button to `@devolada/ui`, mapping `default`→`primary` and `outline`→`secondary` at each call site (depends on T028)
- [ ] T034 [US3] Re-point every back-office import of the local input to `@devolada/ui` (depends on T030)
- [ ] T035 [US3] Delete `apps/admin/src/components/ui/button.tsx` and `apps/admin/src/components/ui/input.tsx`, then confirm nothing imports them (depends on T033, T034)
- [ ] T036 [US3] Re-run the review captures and diff against the T002 baseline following `baselines/README.md`; the back office must render unchanged, and the charge path's decisive action must be unchanged in size (depends on T035)

**Checkpoint**: User Story 3 is complete; no duplicate atom definition remains.

---

## Phase 6: Cross-Cutting — the registered debt, and closing out

**Purpose**: FR-020 and SC-012. These are requirements, not optional polish. They
sit here because they serve no single story.

After T008 the two theme defaults carry our tokens, so every remaining
`duration-150` is redundant: these are **deletions**, and each one must leave the
rendering identical.

- [ ] T037 [P] Delete `duration-150` in `apps/admin/src/components/ui/tabs.tsx`, `calendar.tsx` and `switch.tsx` (two occurrences in switch)
- [ ] T038 [P] Delete `duration-150` in `apps/admin/src/features/cobros/CobrosScreen.tsx` and `apps/admin/src/features/feed/FeedScreen.tsx` (two occurrences each)
- [ ] T039 [P] Delete `duration-150` in `apps/pago/src/features/pago/PaymentPage.tsx` (four occurrences)
- [ ] T040 [P] Delete `duration-150` in `packages/ui/src/playground/Showcase.tsx`
- [ ] T041 Verify the debt's own checks against the tree: `grep -rn "duration-[0-9]" apps packages --include="*.tsx" | grep -v node_modules` prints nothing, and `grep -n "var(--duration-" packages/ui/src/styles/index.css` prints the mapping (depends on T037–T040)
- [ ] T042 Confirm the values now govern (SC-008): temporarily change `--duration-slow` in `packages/ui/src/styles/tokens.css`, observe the outcome reveal change, and revert
- [ ] T043 Close the register entry with `/speckit-debt-pay unmapped-motion-tokens` (depends on T041)
- [ ] T044 Run the standing gates: `node scripts/spec-lint.mjs`, `node scripts/contrast-lint.mjs`, `pnpm e2e` — all green, with no new warning
- [ ] T045 Record the breath pair as confirmed by T047, and any deviation from the plan, in `.specify/design/foundations.md`, and confirm every non-obvious rule added by this feature cites `design-foundations D<n>` (constitution I)
- [ ] T046 Walk `quickstart.md` end to end as a final check
- [ ] T047 Settle the breath on screen (FR-019, research R3): with a validation pending on the payer's page, look at the breath in **both** themes at a phone-sized viewport, once with reduced motion on and once off. Judge it as the payer does — against the waiting copy, not against the other candidates. Too insistent or too faint means editing `--opacity-breath` and `--duration-breath` in `packages/ui/src/styles/tokens.css`, nothing else. Record the final pair in `contracts/design-tokens.md` §3 and `.specify/design/foundations.md`. **This is a merge gate**: the pair ships confirmed by eye or it does not ship (depends on T016, T018)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies, and gates nothing but its own baseline.
- **Foundational (Phase 2)**: depends on Setup. **Blocks all three stories.**
  Internally sequential — T005–T006 share `tokens.css`, T007–T010 share
  `index.css`.
- **User Stories (Phases 3–5)**: all depend on Phase 2 only. They touch disjoint
  files and can run in parallel or in priority order.
- **Cross-cutting (Phase 6)**: T037–T040 depend on T008; T043 depends on the
  whole debt sweep; T044–T046 depend on every story you intend to ship.

### User Story Dependencies

- **US1 (P1)**: after Phase 2. Independent.
- **US2 (P2)**: after Phase 2. Independent. Touches only back-office primitives.
- **US3 (P3)**: after Phase 2. Independent, but T036 needs the T002 baseline, so
  do not skip T002 even when starting with US3.

### Parallel Opportunities

- Phase 3: T011 ∥ T012, then T014 ∥ T015.
- Phase 4: T020 ∥ T021 ∥ T022 ∥ T023 ∥ T024 — five different files, no shared state.
- Phase 5: T031 ∥ T032.
- Phase 6: T037 ∥ T038 ∥ T039 ∥ T040.
- Across phases: US1, US2 and US3 can be worked simultaneously once Phase 2 lands.

---

## Parallel Example: User Story 2

```bash
# Five primitives, five files, no ordering between them:
Task: "dialog.tsx → z-overlay / z-modal, bg-overlay"
Task: "alert-dialog.tsx → z-overlay / z-modal, bg-overlay"
Task: "sheet.tsx → z-overlay / z-modal, bg-overlay"
Task: "popover.tsx → z-dropdown"
Task: "select.tsx → z-dropdown"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup.
2. Phase 2 Foundational.
3. Phase 3 User Story 1.
4. **Stop and validate**: quickstart §2, in both themes and with reduced motion.
5. This alone is shippable: the payer's page stops looking dead while it waits.

### Incremental Delivery

1. Setup + Foundational → the values govern.
2. + US1 → the wait has a language (MVP).
3. + US2 → overlapping surfaces agree.
4. + US3 → one definition per atom.
5. + Phase 6 → the debt is paid and the register closed.

Each increment leaves the tree green: the gates in T044 are the standing ones,
not new to this feature.

---

## Notes

- Phase 2 is the one place where task order actually matters; everywhere else the
  [P] markers are real.
- Every test task names its citation because `scripts/spec-lint.mjs` checks for
  it and will warn on any file that lacks one.
- Phase 6's deletions are behaviour-preserving **only after T008**. Doing them
  first would change every transition in the product to the browser default.
- Commit per task or per logical group; stop at any checkpoint to validate a
  story on its own.
