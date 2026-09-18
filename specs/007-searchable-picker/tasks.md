---

description: "Task list template for feature implementation"
---

# Tasks: searchable-picker

**Input**: Design documents from `/specs/007-searchable-picker/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included, and **not optional here**. Constitution IV requires each
question to be answered at the layer that can answer it, and VII requires every
test to cite its story. A task that ships behaviour without its cited test does
not satisfy this repo.

**Organization**: Tasks are grouped by user story so each can be implemented and
tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are in the descriptions

## Path Conventions

Web application, frontend only. The panel is `apps/admin/`; shared atoms are
`packages/ui/`; the browser layer is `tests/e2e/`. `apps/pago/` is not touched.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The two small openings the control needs before it can exist.

- [ ] T001 Export the popover anchor from `apps/admin/src/components/ui/popover.tsx`, so a control can position a list against a field without that field becoming a trigger (research D5)
- [ ] T002 [P] Make `InputProps` extend `ComponentProps<"input">` in `packages/ui/src/components/input.tsx` so a `ref` travels with the rest of the props; the control must return focus to the field after a choice, and a second copy of the field recipe to get one would be drift (constitution VI)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The vocabulary and the control's skeleton. No user story can begin until these exist.

**⚠️ CRITICAL**: T003–T005 block every story below.

- [ ] T003 Define the vocabulary in reading order once, in `apps/admin/src/lib/banks.ts`, sorted with es-MX collation from the generated `BANKS`; it adds no name, drops none and renames none (constitution III)
- [ ] T004 Create the control in `apps/admin/src/components/ui/combobox.tsx`: the shared `Input` atom as the field, the list anchored to it and rendered at the document root, opening on a click, on typing and on the arrow keys but never on focus (research D1, D5, D9)
- [ ] T005 Give the control its announced shape in `apps/admin/src/components/ui/combobox.tsx`: the field carries the combobox role and whether the list is open, the list is a listbox whose rows are options, the highlighted row is named, and the layer around the list announces nothing of its own (research D6, FR-010)

---

## Phase 3: User Story 1 - The ISP finds their bank by typing (Priority: P1) 🎯 MVP

**Goal**: An ISP types a fragment and the list narrows to their bank; the choice can be made with the pointer or the keyboard alone.

**Independent test**: Open `/settings/direct-payment`, type into **Banco**, and confirm the offered names are the ones that match. This alone is the feature.

### Implementation for User Story 1

- [ ] T006 [US1] Add the matching rule to `apps/admin/src/components/ui/combobox.tsx`: normalise both sides (decompose, drop combining marks, lowercase), keep every name containing the query, and offer names that *start* with it before names that merely contain it (research D2, FR-001–FR-003)
- [ ] T007 [US1] In the same file, offer the whole vocabulary while the field still holds the name last chosen, so opening the picker to change your mind shows the choices rather than the choice (research D4)
- [ ] T008 [US1] Put the field on the direct-payment screen in `apps/admin/src/features/settings/SettingsScreen.tsx`, preserving the account-number seeding and the rule that a hand-picked name wins over the prefix thereafter (FR-008)

### Tests for User Story 1

- [ ] T009 [US1] Cover what is offered, in `apps/admin/test/bank-picker.test.tsx`: the whole vocabulary with nothing typed, narrowing to one name, matching across case and accents, names that start with the query first, and a keyboard-only choice reaching the save. Cite `searchable-picker US1`
- [ ] T010 [P] [US1] Cover what needs a browser, in `tests/e2e/bank-picker.spec.ts`: the list opens inside the window and typing reaches a bank with no scrolling at all. Cite `searchable-picker US1`
- [ ] T011 [P] [US1] Update the seeding assertion in `apps/admin/test/identity-round.test.tsx` — the seeded name is now the field's value, not text rendered beside it

**Checkpoint**: the bank can be found by typing. US2 and US3 are not needed for this to be worth shipping.

---

## Phase 4: User Story 2 - The field never holds a name nobody chose (Priority: P2)

**Goal**: Cancelling, clicking away and tabbing on all restore the name last chosen; nothing outside the vocabulary can ever be saved.

**Independent test**: With a bank chosen, type a fragment and leave the field by each of the three exits. The chosen name is back each time.

### Implementation for User Story 2

- [ ] T012 [US2] Restore the chosen name on every exit in `apps/admin/src/components/ui/combobox.tsx` — cancel, focus leaving the field, and moving to the next field — so the field can never come to rest on a typed fragment (research D3, FR-007)
- [ ] T013 [US2] In the same file, say `Sin resultados` when nothing matches, offer no rows, and change nothing that is saved (FR-006)
- [ ] T014 [US2] In the same file, report a choice only when it is a name that was offered, whatever was typed (FR-004)

### Tests for User Story 2

- [ ] T015 [US2] Cover the safety rule in `apps/admin/test/bank-picker.test.tsx`: each of the three exits restores the chosen name, a query matching nothing says so and leaves the save unavailable. Cite `searchable-picker US2`

**Checkpoint**: the feature is now safe as well as fast.

---

## Phase 5: User Story 3 - One bank field, wherever a bank is chosen (Priority: P3)

**Goal**: The business's own account, a top-up's sender and the platform's own account all behave the same way.

**Independent test**: Choose a bank on each of the three screens with the same keys and confirm nothing changes between them.

### Implementation for User Story 3

- [ ] T016 [P] [US3] Put the field on the top-up form in `apps/admin/src/features/credit/CreditCard.tsx`, and confirm the form still submits on Enter while the list is closed (contracts/bank-field.md, keyboard contract)
- [ ] T017 [P] [US3] Put the field on the platform's bank setting in `apps/admin/src/features/operator/OperatorScreen.tsx`, leaving the short enum pickers on that screen as they are

### Tests for User Story 3

- [ ] T018 [US3] Update the top-up test in `apps/admin/test/credit.test.tsx` to drive the field exactly as the settings test does, proving one control and not three. Cite `searchable-picker US3`
- [ ] T019 [P] [US3] Confirm `apps/pago` is untouched: the payer's page still offers the whole vocabulary through the phone's own picker, per its existing assertion in `apps/pago/test/pago.test.tsx` (research D8, FR-011)

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T020 Cite the decisions in `apps/admin/src/components/ui/combobox.tsx` as `searchable-picker D<n>` against [research.md](./research.md), replacing the `bug: bank-picker-unreachable` citations left by the pass that first built the control (constitution I)
- [ ] T021 [P] Cite the same feature in `apps/admin/src/lib/banks.ts`, `apps/admin/src/features/settings/SettingsScreen.tsx`, `apps/admin/src/features/credit/CreditCard.tsx` and `apps/admin/src/features/operator/OperatorScreen.tsx` where each names the picker
- [ ] T022 [P] Move the story citations in `apps/admin/test/bank-picker.test.tsx` and `tests/e2e/bank-picker.spec.ts` from the bug slug to `searchable-picker US<n>` (constitution VII)
- [ ] T023 [P] Update the picker assertion in `tests/passkey/identity-journey.spec.ts` to read the field's value
- [ ] T024 Run `axe` on the open list, in `apps/admin/test/bank-picker.test.tsx`, scoped so a portalled layer is judged on its own semantics and not on the landmarks of the page it floats above
- [ ] T025 Run the gates in CI order and record the result: `spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm exec playwright test`, build

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T002)** → no dependencies.
- **Foundational (T003–T005)** → needs Setup. **Blocks every story.**
- **US1 (T006–T011)** → needs Foundational.
- **US2 (T012–T015)** → needs Foundational. Independent of US1's screen wiring, but only demonstrable once typing exists, hence P2.
- **US3 (T016–T019)** → needs Foundational; reads best after US1 and US2, since it is those behaviours repeated.
- **Polish (T020–T025)** → last.

### User Story Dependencies

No story depends on another's code. US1 is the MVP; US2 makes it safe; US3 spreads it.

### Within Each User Story

Implementation before its tests is the order written here, but T009/T015/T018 may be written first if you prefer to watch them fail — the repo has no rule either way.

### Parallel Opportunities

- T001 and T002 touch different packages.
- T010, T011 (different files from T009).
- T016 and T017 are different screens.
- T021, T022, T023 are different files.

---

## Parallel Example: User Story 3

```text
T016 (CreditCard.tsx)  ─┐
                        ├─► then T018 (credit.test.tsx)
T017 (OperatorScreen.tsx)┘
T019 (pago.test.tsx) — independent of both
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

Setup → Foundational → US1. At that point an ISP can find their bank by typing,
which is the whole complaint that started this. Ship-able on its own.

### Incremental Delivery

US2 next: it is short, and it is what keeps a wrong bank name out of the database.
US3 last: it is the same behaviour on two more screens, valuable but not urgent.

### Parallel Team Strategy

Not applicable — one developer working with agents (constitution, Purpose).

---

## Notes

- `apps/pago/` is out of scope by decision (research D8), not by omission. T019
  exists to keep that deliberate.
- The control already exists in the working tree from the pass that first built
  it alongside `bug: bank-picker-unreachable`. `/speckit-converge` reconciles
  these tasks against that code and appends anything genuinely unbuilt.

---

## Phase 7: Convergence

Appended 2026-09-18 by `/speckit-converge`. The control was built before this
feature had a spec, so its trail points at the bug it was born beside rather
than at the decisions recorded in [research.md](./research.md).

- [ ] T026 CRITICAL — Re-cite the control's non-obvious rules against this feature's decisions in `apps/admin/src/components/ui/combobox.tsx` (header, the restore-on-exit rule, the whole-list-while-resting rule, the open-on-click rule, the presentational popup) and in `apps/admin/src/lib/banks.ts`, replacing `bug: bank-picker-unreachable` with the matching `searchable-picker D<n>`, per Constitution I (contradicts)
- [ ] T027 CRITICAL — Re-cite the three call sites against this feature in `apps/admin/src/features/settings/SettingsScreen.tsx`, `apps/admin/src/features/credit/CreditCard.tsx` and `apps/admin/src/features/operator/OperatorScreen.tsx`, each of which currently explains its picker by pointing at the scroll defect, per Constitution I (contradicts)
- [ ] T028 CRITICAL — Move the story citations in `apps/admin/test/bank-picker.test.tsx` (file header and all three `describe` blocks) and `tests/e2e/bank-picker.spec.ts` from `bug: bank-picker-unreachable` to `searchable-picker US1` / `US2` / `US3`, matching what each block actually proves, per Constitution VII (contradicts) — note `spec-lint` accepts either shape, so CI will not catch this
- [ ] T029 Bound the list by the space it actually has, not by a fixed 288px: `apps/admin/src/components/ui/combobox.tsx:195` caps the popup with `max-h-72` while research D5 justifies the anchored popup precisely because it "gives the popup the space it actually has", and the spec's edge case asks the field to hold at the narrow end of the panel, per research D5 and spec Edge Cases (partial)
- [ ] T030 Cite the top-up screen's bank field to this feature in `apps/admin/test/credit.test.tsx`, which drives the control but cites only archive-era stories, leaving US3/AC1 — the same field on a second screen — with no cited test, per US3/AC1 (missing)
- [ ] T031 Cover the platform operator's bank field in a test under `apps/admin/test/`; no test reaches `apps/admin/src/features/operator/OperatorScreen.tsx`'s picker at all, so US3/AC2 is unproven, per US3/AC2 and FR-009 (missing)
