---

description: "Task list for feedback-vocabulary-rollout"
---

# Tasks: feedback-vocabulary-rollout

**Input**: Design documents from `/specs/002-feedback-vocabulary-rollout/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: mandatory here, not optional. Constitution IV puts contrast, motion,
layout and reduced-motion questions in the browser layer because a simulated DOM
cannot answer them, and constitution VII requires every test to cite its story.
Every test task below cites `feedback-vocabulary-rollout US<n>`.

**Organization**: grouped by user story so each can be implemented, tested and
shipped on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US4, mapping to the spec's user stories
- Every task names the file it touches

## Decision citations

Code comments cite `feedback-vocabulary-rollout D<n>`, tabled in
[plan.md](./plan.md#decisions). D1…D5 are the clarify answers, D6…D11 the design
decisions from research.

---

## Phase 1: Setup

**Purpose**: know what the product looked like before anything moved, and prove
the instruments work on this branch.

- [X] T001 [P] Record the pre-change review baseline: run `pnpm exec playwright test --config playwright.review.local.config.ts` and keep the output under `tests/design/.baseline-002/` (git-ignored). SC-010 and every "nothing else moved" claim compare against this; captured after the fact it proves nothing.
- [X] T002 [P] Run `pnpm e2e`, `pnpm -r --if-present test`, `pnpm -r --if-present typecheck`, `node scripts/contrast-lint.mjs` and `node scripts/spec-lint.mjs` on this branch and record the results in the task notes. A gate that was already red must be known before the first edit, not discovered at the end.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the instruments every story's tests depend on. Neither changes
product behaviour.

**⚠️ CRITICAL**: T003 and T004 land before any story's test is written.

- [X] T003 Add a stub in `tests/e2e/stubs.ts` that holds an admin API response open until released, so a back-office pending state can be observed at all. Without it every pending assertion races the response and passes for the wrong reason.
- [X] T004 Add a self-proving probe to `tests/e2e/motion.spec.ts`, in the shape the file already uses: before asserting an absence, plant an element that would violate the claim, confirm the check catches it, then remove it. 001 shipped a check that was green because it looked for something the page never renders; an empty result from a healthy page and an empty result from a broken instrument are identical.

---

## Phase 3: User Story 1 — The operator can tell the back office is working (P1) 🎯 MVP

**Goal**: every wait the operator is having shows it and says it, once, and a
wait nobody started stays invisible.

**Independent test**: visit every back-office screen that can be pending with the
wording covered; each is recognisably pending. Repeat with a screen reader and
hear each announced once. Then switch tabs away and back on a loaded screen and
confirm nothing appears. Needs nothing from US2, US3 or US4.

### Shared atoms

- [X] T005 [US1] Add the optional `shape` prop to `packages/ui/src/components/pending.tsx` per [contracts/components.md](./contracts/components.md): below the threshold the shape is laid out but not painted (`visibility: hidden`) so the space is held; past it the shape paints, the region breathes and the label is announced, all on the same schedule. `FLASH_THRESHOLD_MS` and `MINIMUM_VISIBLE_MS` stay the single pair of constants. Cite D5, D7.
- [X] T006 [P] [US1] Remove `animate-pulse` from `packages/ui/src/components/skeleton.tsx`. Keep `aria-hidden`, the token fill and the rounding. Cite D2, D6, and note in the comment that the movement now belongs to the region — including why: `animate-pulse` matched no `data-motion` selector, so the blanket reduced-motion rule froze every skeleton.

### Tests for the atoms

- [X] T007 [P] [US1] Unit-test the `shape` path in `packages/ui/test/pending.test.tsx` with fake timers: nothing painted before the threshold, the shape's box still occupying space, paint + breath + announcement starting together, and a wait that resolves early leaving no trace. Cite `feedback-vocabulary-rollout US1`.
- [X] T008 [P] [US1] Unit-test in `packages/ui/test/atoms.test.tsx` that `Skeleton` carries no animation utility of its own and stays `aria-hidden`. Cite `feedback-vocabulary-rollout US1`.

### Screens with a known content shape (wrap the load; the skeletons become the `shape`)

- [X] T009 [P] [US1] Wrap the load and every started action in `apps/admin/src/features/cobros/CobrosScreen.tsx` (3 skeletons), per the shared rule below.
- [X] T010 [P] [US1] Wrap the load and every started action in `apps/admin/src/features/credit/CreditCard.tsx` (1 skeleton, 3 pending actions), per the shared rule below.
- [X] T011 [P] [US1] Wrap the load and every started action in `apps/admin/src/features/feed/FeedScreen.tsx` (6 skeletons, 7 pending sites), per the shared rule below.
- [X] T012 [P] [US1] Wrap the load and every started action in `apps/admin/src/features/integrations/IntegrationsScreen.tsx` (1 skeleton), per the shared rule below.
- [X] T013 [P] [US1] Wrap the load and every started action in `apps/admin/src/features/integrations/WispHubScreen.tsx` (2 skeletons, 10 pending sites), per the shared rule below.
- [X] T014 [P] [US1] Wrap the load and every started action in `apps/admin/src/features/links/LinksScreen.tsx` (3 skeletons), per the shared rule below.
- [X] T015 [P] [US1] Wrap the load and every started action in `apps/admin/src/features/onboarding/ChooseBusinessScreen.tsx` (1 skeleton), per the shared rule below.
- [X] T016 [P] [US1] Wrap the load and every started action in `apps/admin/src/features/operator/OperatorScreen.tsx` (2 skeletons, 6 pending sites), per the shared rule below.
- [X] T017 [P] [US1] Wrap the load and every started action in `apps/admin/src/features/settings/SettingsScreen.tsx` (3 skeletons, 12 pending sites), per the shared rule below.
- [X] T018 [P] [US1] Wrap the load and every started action in `apps/admin/src/features/settings/UsersCard.tsx` (1 skeleton, 7 pending sites), per the shared rule below.

For each of T009–T018: pass the existing skeleton block as `shape`, give the region a label naming what loads in es-MX ("Cargando los cobros"), and drive `active` from the query's first load — never from a refetch (D1). Wrap each started action in its own `Pending` at the control the operator used, with `announce` on the action and the screen's own region keeping its single announcement (D4). Add no wording beyond the region labels.

### Screens with no shape to promise (the bare breath)

- [X] T019 [P] [US1] Wrap the accept control in `apps/admin/src/features/invitations/AcceptInvitationScreen.tsx` — a started action with no shape to promise, so it takes the bare breath.
- [X] T020 [P] [US1] Wrap the create control in `apps/admin/src/features/onboarding/NewBusinessScreen.tsx` — likewise, the bare breath.
- [X] T021 [P] [US1] Audit the 3 pending sites in `apps/admin/src/features/shell/Shell.tsx` and treat only those that are waits the operator is having; leave the rest silent (D1).
- [X] T022 [P] [US1] Give the load a region and a label in `apps/admin/src/features/auth/PasskeyCard.tsx`. It renders `passkeys.data && …` only, so while loading it shows **nothing at all** — no list, no empty state, no signal. SC-001's clearest instance.

### Story tests

- [X] T023 [US1] In a new `tests/e2e/feedback.spec.ts`, prove a wait below the threshold shows nothing and shifts no layout: hold the stub from T003 open briefly, release before the threshold, and assert the region never painted and the bounding box of the following element never moved. Cite `feedback-vocabulary-rollout US1`.
- [X] T024 [US1] In `tests/e2e/feedback.spec.ts`, prove a background refresh stays silent: load a screen, trigger a refetch the operator did not start, assert no pending treatment appears (SC-011). Cite `feedback-vocabulary-rollout US1`.
- [X] T025 [US1] In `tests/e2e/motion.spec.ts`, prove no pending region freezes under reduced motion: with `prefers-reduced-motion: reduce`, a loading back-office region reports computed `animation-duration` of `2.4s`, not `1e-05s` (SC-012, FR-014). **Verify by mutation**: remove the region's `data-motion` and confirm this test turns red.
- [X] T026 [US1] Component-test in `apps/admin/test/` that a screen with a load and an action pending at once announces each once and not twice (SC-002, D4). Cite `feedback-vocabulary-rollout US1`.

**Checkpoint**: the back office shows and says every wait it is having, and says nothing about the waits it is not.

---

## Phase 4: User Story 2 — Surfaces arrive and leave the same way (P2)

**Goal**: one definition of arriving and one of departing, shared by every
overlapping surface.

**Independent test**: open and close every overlapping surface; each arrives and
departs identically, and opening the same one twice is indistinguishable.

**Parallel with US1, US3 and US4** — it touches only `index.css` and
`apps/admin/src/components/ui/`, which no other story opens.

- [X] T027 [US2] Add `--animate-enter` and `--animate-leave` to the `@theme inline` block and the `enter` / `leave` keyframes to `packages/ui/src/styles/index.css`, exactly as [contracts/motion.md](./contracts/motion.md) specifies. Opacity only — no transform may enter either keyframe. Leave the reduced-motion exception **untouched** and say why in the comment (D9). Cite D9.
- [X] T028 [P] [US2] `apps/admin/src/components/ui/dialog.tsx` — replace the inert `data-[state=open]:animate-in data-[state=open]:fade-in-0` on the overlay with the real pair, and add the pair to the content. Note in the comment that those utilities came from `tailwindcss-animate`, which this repo does not install, so they emitted nothing (research R5).
- [X] T029 [P] [US2] `apps/admin/src/components/ui/alert-dialog.tsx` — add the pair to content and backdrop.
- [X] T030 [P] [US2] `apps/admin/src/components/ui/sheet.tsx` — likewise.
- [X] T031 [P] [US2] `apps/admin/src/components/ui/popover.tsx` — likewise.
- [X] T032 [P] [US2] `apps/admin/src/components/ui/select.tsx` — likewise.
- [X] T033 [US2] In `tests/e2e/motion.spec.ts`, assert computed `animation-name` is `enter` on open and `leave` on close for all five surfaces and their backdrops, and that computed `transform` stays `none` throughout, in both themes (FR-006, SC-006). Cite `feedback-vocabulary-rollout US2`.
- [X] T034 [US2] In `tests/e2e/motion.spec.ts`, assert the closing node is **gone** after the departure, and again under `prefers-reduced-motion: reduce` where the keyframe is flattened to 0.01ms. Radix keeps a closing node mounted until `animationend`; a keyframe that never ends leaves a dialog in the DOM forever — invisible in a screenshot, fatal in use. Cite `feedback-vocabulary-rollout US2`.
- [X] T035 [US2] Add back-office surface captures to a new `tests/design/review-feedback.spec.ts`, both themes, so the arrival is reviewable by eye and by `scripts/review-diff.mjs`. Cite `feedback-vocabulary-rollout US2`.

**Checkpoint**: every overlapping surface arrives and departs one way, and none of them slide.

---

## Phase 5: User Story 3 — A retry looks like a first attempt (P3)

**Goal**: retrying is waiting. No separate treatment, and no signal without a click.

**Independent test**: fail an operation, retry it, and compare the second pending
state against the first — indistinguishable. Then leave the failure on screen,
switch tabs and come back: the button must not read "Cargando…".

**Depends on US1** for `Pending`, and touches eight of the same feature files.

- [X] T036 [US3] Rewrite `packages/ui/src/components/list-error.tsx` per [contracts/components.md](./contracts/components.md): delete the `retrying` prop, widen `onRetry` to `() => void | Promise<unknown>`, hold the waiting state internally from the click until the returned promise settles, and delete `animate-spin` from the icon. The word "Cargando…" is untouched. Cite D3, D10, and record in the comment why the prop is deleted rather than fixed at the call sites.
- [X] T037 [P] [US3] `apps/admin/src/features/cobros/CobrosScreen.tsx:285` — drop `retrying=`, let `onRetry` return the promise.
- [X] T038 [P] [US3] `apps/admin/src/features/credit/CreditCard.tsx:210` — likewise.
- [X] T039 [P] [US3] `apps/admin/src/features/feed/FeedScreen.tsx:541` and `:580` — two call sites; `:580` passes `isFetchingNextPage`, which **is** operator-initiated, so check what it should become rather than deleting it by pattern.
- [X] T040 [P] [US3] `apps/admin/src/features/integrations/IntegrationsScreen.tsx:31` — likewise.
- [X] T041 [P] [US3] `apps/admin/src/features/integrations/WispHubScreen.tsx:340` — likewise.
- [X] T042 [P] [US3] `apps/admin/src/features/links/LinksScreen.tsx:211` — likewise.
- [X] T043 [P] [US3] `apps/admin/src/features/onboarding/ChooseBusinessScreen.tsx:36` — likewise; drop the `void` operator so the promise reaches `ListError`.
- [X] T044 [P] [US3] `apps/admin/src/features/settings/UsersCard.tsx:91` — likewise.
- [X] T045 [US3] Unit-test in a new `packages/ui/test/list-error.test.tsx` that the waiting state starts on the click and ends when the promise settles, that a rejected promise still ends it, and that nothing rotates. Cite `feedback-vocabulary-rollout US3`.
- [X] T046 [US3] In `tests/e2e/motion.spec.ts`, assert no computed `animation-name` of `spin` or `pulse` exists anywhere on either surface (SC-013). **Verify by mutation**: restore `animate-spin` on one element and confirm this test turns red — otherwise it is an absence check that proves nothing, exactly the class of green-but-empty test T004 exists to prevent.

**Checkpoint**: one waiting movement in the product, and no signal without a click.

---

## Phase 6: User Story 4 — One name for a size, everywhere (P4)

**Goal**: every component names a context. Nothing moves.

**Independent test**: read every place the product asks for a size and confirm
each names a context; compare the badges before and after and see no difference.

**Touches `list-error.tsx`, so it follows US3** rather than running beside it.

- [X] T047 [US4] Rename `StatusBadge`'s sizes in `packages/ui/src/components/status-badge.tsx`: `sm` → `compact`, `md` → `standard`. Values unchanged; no `decisive`. Update the prop comment to name contexts rather than surfaces. Cite D11 and FR-013.
- [X] T048 [P] [US4] `apps/pago/src/features/pago/PaymentPage.tsx` — 6 call sites at lines 616, 899, 917, 983, 997, 1046: `size="md"` → `size="standard"`. Nothing else in this file changes and nothing the payer sees changes.
- [X] T049 [P] [US4] `packages/ui/src/playground/Showcase.tsx` — 3 call sites at lines 102, 201, 202: `size="md"` → `size="standard"`.
- [X] T050 [US4] In `packages/ui/src/components/list-error.tsx`, replace the retry button's `className="h-10 shrink-0 px-4 text-sm"` with `size="compact"` plus whatever layout classes remain. A screen names a size; it never states a height (research R8, data-model *Control size*).
- [X] T051 [P] [US4] Unit-test in a new `packages/ui/test/status-badge.test.tsx` that both names render, that the default is `compact`, and that the emitted classes for `compact`/`standard` match today's `sm`/`md` exactly (FR-012). Cite `feedback-vocabulary-rollout US4`.
- [X] T052 [US4] Run `pnpm -r --if-present typecheck` and confirm zero call sites were missed. This is US4 scenario 4's instrument: a size name outside the vocabulary must be rejected before the screen can ship.
- [X] T053 [US4] Re-run the review captures and `node scripts/review-diff.mjs` against T001's baseline. Every screen showing a status must be unchanged (SC-010). Investigate any diff above the script's threshold before proceeding — the suite is not byte-deterministic, so read the reported count and bounding box, not just the verdict.

**Checkpoint**: one size vocabulary, and the product looks exactly as it did.

**T053 result (2026-09-10)**: 59 captures compared against T001's baseline, 13
beyond the 0.05% floor. A control run — the review suite twice over identical
code — reproduced 9 of those 13, so they are run-to-run variance, not this
feature: three payer captures whose breath phase is a coin toss (max delta 2–4),
and six whose text carries a clock (`pago-espera-larga` renders an hour derived
from `Date.now()`, `admin-links-inicial` renders "consultado hace…").

The five that ARE this feature's: `review-foundations-dialog-1280` and
`-confirmation-1280`, both themes, and `review-pago-verificando-base-375`. Max
delta 2–3 out of 255, inside the box the surface itself occupies — the
compositing cost of giving those surfaces an animation, which is the point of
US2. Nothing visible moved.

**No capture showing a StatusBadge changed at all**, which is SC-010.

---

## Phase 7: Polish & Cross-Cutting

- [X] T054 Run every gate in CI order and record the results: `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm e2e`. None may be skipped or quarantined to get green.
- [X] T055 Walk the three by-hand checks in [quickstart.md](./quickstart.md), including the two that exist to catch a signal that must **not** appear: the tab-switch on a loaded screen, and the tab-switch on a failed one.
- [X] T056 Correct [contracts/components.md](./contracts/components.md) and [contracts/motion.md](./contracts/motion.md) wherever implementation proved a sentence wrong. Correct the contract to match the code only when nothing asked for the other reading — and say so inline, as 001's `Field` wrapper note does.
- [X] T057 Log the `StatusBadge` class-composition defect with `/speckit-debt-log`: it concatenates strings instead of merging through `cn`, so a caller's `className` silently loses to whichever rule the stylesheet emits last. Found during this feature's research (R8), deliberately not fixed by it.
- [X] T058 Update `.specify/design/foundations.md` to record that the vocabulary is fully built: five names, four treatments, and `retrying` implemented as `waiting` on purpose (D8).

---

**T054 result (2026-09-10)**: all seven gates green, in CI order — spec-lint 52
files, gen-banks in step, contrast-lint 34 pairs, 5 typechecks, 594 unit tests
across 52 files, 51 browser tests, 3 builds. None skipped, none quarantined.

**T055 result (2026-09-10)**: two of the three by-hand checks were driven in a
real browser and their evidence read.

- *A failure left on screen, then a tab switch* — the button reads
  "Reintentar", not "Cargando…". This is research R6's bug, confirmed gone at
  the surface rather than only in the unit test.
- *A pending back-office screen with the wording covered* — captured at 1280 and
  read: three placeholder rows in the shape of charge rows, no wording, nothing
  turning. Recognisably pending (SC-003).

**Not done, and it matters**: the screen-reader pass. FR-002 and SC-002 are
asserted by `apps/admin/test/feedback.test.tsx` (one live region, naming what
loads, gone when idle) and by axe in the browser layer, but nobody has listened
to these screens with an actual screen reader. That is a real gap in the
evidence, not a formality — the ownership rule was written from reading the DOM,
and a live region can be structurally correct and still read badly.

---

## Dependencies & Execution Order

```text
Setup (T001–T002)
   └─▶ Foundational (T003–T004)
          ├─▶ US1  (T005–T026)  ──▶ US3 (T036–T046) ──▶ US4 (T047–T053)
          └─▶ US2  (T027–T035)   [independent of the other three]
                                        └─▶ Polish (T054–T058)
```

**Why US1 → US3 → US4 is a chain, not a preference**: US3 edits eight of the
feature files US1 opens, and US4 edits `list-error.tsx`, which US3 rewrites.
Running them in parallel means resolving the same file twice.

**Why US2 is genuinely parallel**: it touches `packages/ui/src/styles/index.css`
and the five files in `apps/admin/src/components/ui/`. No other story opens any
of them.

## Parallel opportunities

| Wave | Tasks | Files |
| --- | --- | --- |
| US1 screens | T009–T022 | 14 distinct feature files |
| US1 atom tests | T007, T008 | 2 distinct test files |
| US2 surfaces | T028–T032 | 5 distinct primitives |
| US3 call sites | T037–T044 | 8 distinct feature files |
| US4 call sites | T048, T049 | 2 distinct files |

Across stories, the whole of US2 (T027–T035) runs beside any of the others.

## Implementation Strategy

**MVP is User Story 1.** It is the story the feature was chartered for, it is
the surface where waiting happens dozens of times a day, and it closes the
reduced-motion defect on its own. Shipped alone it is a complete increment: the
back office shows and says every wait it is having.

**Then US2**, which can be built in parallel and merged whenever it is ready.

**Then US3 and US4**, in that order, because they share files.

**A note on verification.** 001 produced four checks that passed while proving
nothing — an end-state assertion that held with the threshold at zero, a
constant set that matched no real value, a branch that tested a case the page
never renders, and two capture techniques that photographed the wrong frame.
Three tasks here (T004, T025, T046) exist because of that, and each one says how
to break the code and confirm the test notices. A green absence check is worth
nothing until it has been seen to fail.

---

## Phase 8: Convergence

**Assessed 2026-09-10** against `spec.md`, `plan.md` and `tasks.md`, with the
constitution as governing constraint. 15 functional requirements, 14 success
criteria, 15 acceptance scenarios, 11 plan decisions and 8 principles checked.
Four findings, none CRITICAL.

**The shape of the miss, because it explains all of F1 and F2.** Every sweep in
the plan and in this task list keyed on `isPending`, `Skeleton` or `ListError`.
A control whose wait lives in a local `useState` boolean matches none of those
greps. The plan's "18 buttons" figure and its 15-file list both came from that
search, so the undercount was inherited rather than noticed — and T019 and T020
were written against *files* rather than against *controls*, which is how they
were marked done with the wrong half of each treated.

- [ ] T059 [P] [US1] Wrap the two controls T019 and T020 actually named, per FR-001 (partial): the submit in `apps/admin/src/features/invitations/AcceptInvitationScreen.tsx:224` and in `apps/admin/src/features/onboarding/NewBusinessScreen.tsx:90`. Both still carry only `disabled={busy}` and a changed word; only their full-screen session gates were treated. Give each a `Pending` at the control, with an es-MX label, per D1/D4.
- [ ] T060 [US1] Wrap the six started actions in `apps/admin/src/features/auth/pages.tsx` per FR-001, FR-002 (missing): lines 129 (log in), 247 (create account), 320 (confirm), 412 (send code), 448 (save password) and 456 (resend). Each drives a local `busy` flag and shows nothing but a greyed button. The log-in screen matters most: a hang there is the same complaint that opened this feature, met before the operator has any other signal to read.
- [ ] T061 [P] [US1] Wrap the passkey ceremony button in `apps/admin/src/features/auth/PasskeyCard.tsx:101` per FR-001, FR-002 (missing). "Esperando a tu dispositivo…" is a wait on hardware that can take many seconds, and it is the longest of the nine.
- [ ] T062 [P] [US4] Resolve `apps/admin/src/features/account/Avatar.tsx:15-18` against SC-009 (partial). It declares `xs` / `sm` / `lg`; call sites are `AccountHub.tsx:167` and `Shell.tsx:136`. FR-011 binds *shared* components and this one is app-local, so FR-011 holds while SC-009 — which counts size names "anywhere in the product" — does not. Decide which is right and make code and spec agree; do not leave the gap silent. Note the component also carries `text-[10px]` / `text-[11px]`, which belongs to the `no-literal-gate` debt rather than to this task.
- [ ] T063 [US1] Add an instrument for SC-001 (missing): nothing counts operator-initiated waits that show no pending treatment, which is why F1 and F2 survived a full implementation pass. A component-level or browser-level check that finds a control whose word changes while it is disabled and which has no `Pending` above it would have caught all nine. Verify it by mutation — remove one `Pending` and confirm it turns red — or it joins the checks this feature already found green and empty.

### What was clean

FR-003 through FR-010 and FR-012 through FR-015 hold on the tree: no animation
outside `breath`, `reveal`, `enter` and `leave`; no duration, height or z-index
literal in any component; no `Pending` carrying both a shape and bare skeletons;
all five overlay surfaces on one arrival pair and one departure pair.

One `unrequested` addition, surfaced without a task: `.specify/debt/no-literal-gate/`.
T057 named only the `StatusBadge` debt; the second entry came from analyze
finding C1 and carries its own justification. The screen-reader pass remains
unverified and is recorded under T055 — evidence, not code, so not a finding
here.
