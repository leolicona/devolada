# Implementation Plan: feedback-vocabulary-rollout

**Branch**: `claude/002-feedback-vocabulary-rollout` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-feedback-vocabulary-rollout/spec.md`

## Summary

Give the back office the same feedback language the payer's page got in 001, and
finish the vocabulary: define arriving and departing once for every overlapping
surface, make a retry indistinguishable from a first attempt, and put every
component on the shared size names.

Phase 0 found the work is mostly **subtraction**. The product currently emits
three waiting movements — the skeleton pulses, the new region breathes, the
retry spins — and only one of them comes from tokens. Two of the three are
deleted, not replaced. What gets written by hand is two opacity keyframes, one
optional prop on `Pending`, and a prop removal on `ListError` that deletes a
whole class of bug rather than eight instances of it.

Two live defects surfaced while reading and are folded in, because both are the
feature's own subject matter:

- **Every skeleton freezes under reduced motion.** The exception that keeps
  waiting alive names the breath only, so the blanket rule flattens the pulse.
  A person who asked for less motion gets a dead grey block where constitution VI
  requires a screen that still reads as working.
- **The retry button says "Cargando…" without a click.** All eight call sites
  drive it from `isRefetching`, and the query client refetches an errored query
  on window focus. A wait nobody started, showing a signal, which is exactly
  what FR-001 forbids.

**On the back-office scope.** This feature edits three files outside the back
office: two shared atoms in `packages/ui`, and `PaymentPage.tsx` for six size
renames. Nothing the payer sees changes — the renames move words in code, not
pixels, and the review captures are the proof. Keeping the payer on the old size
names would leave two vocabularies alive, which is the drift User Story 4 exists
to remove.

## Technical Context

**Language/Version**: TypeScript 5.7, React 19

**Primary Dependencies**: Tailwind CSS 4.3.3, Radix primitives (`Presence` is
load-bearing for departures), TanStack Query 5, `@devolada/ui` (workspace)

**Storage**: N/A — this feature stores nothing

**Testing**: Vitest 3.2 + happy-dom + Testing Library + MSW + axe (component);
Playwright 1.62 + axe (`tests/e2e`, both apps served as built previews on 4174
and 4175); screenshot review suite (`tests/design`)

**Target Platform**: Evergreen browsers. The back office is desktop-first; the
payer's surface is phone-first and is only renamed here

**Project Type**: pnpm monorepo — two React frontends over a shared UI package

**Performance Goals**: every movement stays on compositor-only properties
(opacity). One animation per pending region rather than one per placeholder bar,
so a list of 23 shapes runs one animation, not 23

**Constraints**: WCAG 2.2 AA in both themes; `prefers-reduced-motion` honoured as
constitution VI amends it — translation, scale and rotation go, an opacity
breath stays; no new token value; no literal duration, colour, size or z-index

**Scale/Scope**: 5 overlay surfaces, 4 shared atoms, 10 back-office feature files
carrying 23 placeholder shapes and 9 failure notices, 18 buttons whose only
pending signal today is being disabled, 9 badge call sites to rename

## Decisions

Code comments cite these as `feedback-vocabulary-rollout D<n>` (constitution I).

| # | Decision | Made in |
| --- | --- | --- |
| D1 | A first load and every action the operator starts carry a treatment; a refresh nobody started does not | spec, Clarifications Q1 |
| D2 | One waiting movement in the product. The placeholder shape breathes at the shared rhythm | Clarifications Q2 |
| D3 | A retry waits the way every action waits. Nothing rotates | Clarifications Q3 |
| D4 | A load is announced by its screen, an action at its control, and a nested region stays silent | Clarifications Q4 |
| D5 | One flash threshold governs everything, and a region below it holds its space | Clarifications Q5 |
| D6 | The movement is attached to the region, not to each placeholder bar | research R1 |
| D7 | `Pending` gains a `shape` prop rather than the codebase gaining a second component | research R2 |
| D8 | `retrying` is `waiting`. It has no treatment of its own | research R3 |
| D9 | Arriving and departing are **not** carved out of reduced motion. Only waiting is | research R4 |
| D10 | `ListError` derives its own waiting state from the click; the `retrying` prop is deleted | research R6 |
| D11 | A component takes the size vocabulary's names, not its heights | spec Assumptions, FR-012 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.1.0. One gate per principle.

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Eleven decisions, each with a place it was made — five in the spec's Clarifications, five in research, one in the spec's Assumptions. Comments cite `feedback-vocabulary-rollout D<n>` | PASS |
| II | Money Law | No amount, currency or timestamp is touched | PASS (N/A) |
| III | One Contract, Pure Routers | No route, schema or envelope is touched | PASS (N/A) |
| IV | Tests Run on the Real Runtime | Computed animation names, reduced-motion behaviour, whether a closing node actually unmounts, and whether a layout shifts are all questions happy-dom cannot answer — it applies no stylesheet and reports no layout. They go to Playwright. The component layer keeps what it can answer: prop wiring, announcement text, the threshold's timing under fake timers | PASS |
| V | Tenant Isolation | No query, session or role is touched | PASS (N/A) |
| VI | Visual Foundations (NON-NEGOTIABLE) | This feature completes the principle's motion bullets and removes the last two animations that do not come from tokens. It adds no value to `tokens.css`, no literal to a component, and no new layer. It also repairs the reduced-motion bullet, which the skeleton has been breaking since 001 shipped | PASS |
| VII | Every Test Cites Its Story | Every new test cites `feedback-vocabulary-rollout US1`…`US4` | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | Nothing here is configurable, so the gate reads as graceful failure: if animations cannot run, the placeholder shape and the announced words still carry the state; if a departure keyframe never fires, Radix still unmounts on its own timeout. No state is carried by movement alone | PASS |

**Post-design re-check (after Phase 1)**: PASS, unchanged. The design adds two
keyframes built from existing durations, one optional prop, and deletes two
animations and one prop. It introduces no raw literal and moves no verification
out of the browser layer. See *Complexity Tracking* — empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-feedback-vocabulary-rollout/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── motion.md
│   └── components.md
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/ui/src/
├── styles/index.css               # + @theme --animate-enter / --animate-leave,
│                                  #   + @keyframes enter / leave.
│                                  #   The reduced-motion exception is UNCHANGED (D9)
├── components/
│   ├── pending.tsx                # ~ + optional `shape`; threshold constants stay put
│   ├── skeleton.tsx               # ~ - animate-pulse. A shape, not a movement (D2, D6)
│   ├── list-error.tsx             # ~ - `retrying` prop, - animate-spin,
│   │                              #   - the h-10 literal, ~ onRetry returns a promise
│   └── status-badge.tsx           # ~ sm → compact, md → standard (D11)
├── playground/Showcase.tsx        # ~ 3 size renames
└── index.ts                       # unchanged — no new export

packages/ui/test/
├── pending.test.tsx               # + the shape path: withheld, held, space kept
├── list-error.test.tsx            # + waits on the click, not on a refetch
└── status-badge.test.tsx          # + the two names, and that nothing else moved

apps/admin/src/
├── components/ui/
│   ├── dialog.tsx                 # ~ the inert animate-in is REPLACED (FR-007)
│   ├── alert-dialog.tsx           # ~ + enter / leave, content and backdrop
│   ├── sheet.tsx                  # ~ likewise
│   ├── popover.tsx                # ~ likewise
│   └── select.tsx                 # ~ likewise
└── features/                      # ~ 10 files: Pending around each load and each
                                   #   started action; 9 ListError call sites drop
                                   #   `retrying`; 18 buttons gain a real signal

apps/pago/src/
└── features/pago/PaymentPage.tsx  # ~ 6 badge size renames. Nothing else, and
                                   #   nothing the payer can see

tests/
├── e2e/motion.spec.ts             # + enter / leave computed; the closing node is
│                                  #   GONE afterwards; pulse and spin absent
├── e2e/feedback.spec.ts           # + below the threshold nothing shows and nothing
│                                  #   shifts; a background refetch stays silent;
│                                  #   no pending region freezes under reduced motion
└── design/review-feedback.spec.ts # + back-office surfaces and both badge sizes,
                                   #   both themes, for scripts/review-diff.mjs
```

**Structure Decision**: no new package, no new directory. The shared atoms stay
in `packages/ui` and the five overlay surfaces stay as app-local primitives,
which is what constitution VI prescribes — an atom both surfaces render is
shared, a primitive only one surface uses may live in that app. The back office
is the only surface that renders an overlay today, so the five stay where they
are and consume the shared definition rather than moving.

## Complexity Tracking

No constitution violation to justify. This feature deletes more than it adds.
