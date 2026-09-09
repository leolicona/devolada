# Implementation Plan: design-foundations

**Branch**: `claude/new-session-1cpf5p` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-design-foundations/spec.md`

## Summary

Give the product one visual system that actually governs: a named stacking
order, one dimming treatment, one definition each of button and text field, and
a motion vocabulary for feedback — the payer's page breathes while a transfer is
validated and fades the outcome in when it lands.

The technical approach is smaller than it sounds, because Phase 0 found that the
pinned Tailwind (4.3.3) already reads every namespace this needs: `--z-index-*`,
`--transition-duration-*`, `--ease-*` and `--animate-*`. So the whole value
layer is `@theme` entries in one file. Binding Tailwind's own
`--default-transition-duration` and `--default-transition-timing-function` to our
tokens turns the fifteen-literal debt into fifteen deletions. What remains to be
written by hand is one pending atom, one reveal wrapper, the merge of two Button
recipes into one, and a single-line exception to the reduced-motion rule.

## Technical Context

**Language/Version**: TypeScript 5.7, React 19

**Primary Dependencies**: Tailwind CSS 4.3.3 (resolved; manifest range `^4.1.0`),
`class-variance-authority` 0.7, Radix primitives, `@devolada/ui` (workspace)

**Storage**: N/A — this feature stores nothing

**Testing**: Vitest 3.2 + happy-dom + Testing Library + MSW + axe (component
layer); Playwright 1.62 + axe (browser layer, `tests/e2e`); screenshot review
suite (`tests/design`, `playwright.review.config.ts`)

**Target Platform**: Evergreen browsers; the payer's surface is a phone-first
PWA, the back office is desktop-first

**Project Type**: pnpm monorepo — two React frontends over a shared UI package

**Performance Goals**: the pending animation runs on compositor-only properties
(opacity), so it must not trigger layout or paint on a low-end phone; 60fps with
no dropped frames while a validation poll is in flight

**Constraints**: WCAG 2.2 AA in both themes (already measured and green); no
horizontal scroll at 360/768/1280; `prefers-reduced-motion` honoured as amended
by constitution VI (no translation, scale or rotation; opacity permitted); no
external font or asset requests

**Scale/Scope**: 2 surfaces, 8 shared atoms, 13 back-office primitives, ~15
screens. This feature edits 2 style files, 3 shared components, 5 back-office
primitives and deletes 2 duplicate component files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.1.0. One gate per principle.

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Every non-obvious rule this feature adds cites `design-foundations D<n>` — the decision table in `.specify/design/foundations.md` §2, which shares this feature's slug, so citations resolve 1:1 | PASS |
| II | Money Law | No amount, currency or timestamp is touched | PASS (N/A) |
| III | One Contract, Pure Routers | No route, schema or envelope is touched | PASS (N/A) |
| IV | Tests Run on the Real Runtime | Contrast, target size, reduced motion and stacking order are browser questions; they go to Playwright, never to happy-dom, whose `color-contrast` and `target-size` rules are disabled for exactly this reason | PASS |
| V | Tenant Isolation | No query, session or role is touched | PASS (N/A) |
| VI | Visual Foundations (NON-NEGOTIABLE) | This feature is the principle's implementation. Every one of its twelve bullets is a requirement in the spec; the four added in v1.1.0 for stacking, dimming, shared atoms and motion are FR-001…FR-005 and FR-007…FR-013 | PASS |
| VII | Every Test Cites Its Story | Every new spec file cites `design-foundations US1|US2|US3` | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | The breath degrades to a still, legible pending state if the animation cannot run; the reveal degrades to an instant swap. Neither hides the state | PASS |

**Post-design re-check (after Phase 1)**: PASS, unchanged. The design adds no
new value that is not a token, introduces no raw literal, and moves no
verification out of the browser layer. See *Complexity Tracking* — empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-design-foundations/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── design-tokens.md
│   └── components.md
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/ui/src/
├── styles/
│   ├── tokens.css                 # + stacking scale, + breath duration; motion tokens unchanged
│   └── index.css                  # + @theme mapping for z-index/duration/ease/animate,
│                                  #   + @keyframes breath, ~ reduced-motion exception
├── components/
│   ├── button.tsx                 # ~ merged recipe: 3 sizes, 5 variants
│   ├── input.tsx                  # ~ absorbs the back-office field
│   ├── pending.tsx                # + the breath atom
│   ├── reveal.tsx                 # + the outcome cross-fade
│   └── skeleton.tsx               # unchanged (still animate-pulse)
└── index.ts                       # + Pending, Reveal exports

apps/admin/src/
├── components/ui/
│   ├── button.tsx                 # - deleted, call sites re-point to @devolada/ui
│   ├── input.tsx                  # - deleted, likewise
│   ├── dialog.tsx                 # ~ z-overlay / z-modal, bg-overlay
│   ├── alert-dialog.tsx           # ~ likewise (drops bg-ink/40)
│   ├── sheet.tsx                  # ~ likewise (drops bg-black/50)
│   ├── popover.tsx                # ~ z-dropdown
│   └── select.tsx                 # ~ z-dropdown
└── features/                      # ~ duration-150 deletions only

apps/pago/src/
└── features/pago/PaymentPage.tsx  # ~ Pending + Reveal at the verification state,
                                   #   duration-150 deletions

tests/
├── e2e/motion.spec.ts             # + reduced motion, breath present, no transform
└── design/review-foundations.spec.ts  # + screenshots: 3 modal surfaces, both themes

scripts/
└── review-diff.mjs                # + compares two runs of the review captures
```

**One entry was added during implementation** (recorded 2026-09-09, converge
F6): `scripts/review-diff.mjs`. T002 recorded the review baseline as a checksum
on the assumption that the capture suite is byte-deterministic. It is not — two
runs of identical code differ by about 73 pixels in a million — so the checksum
reported twenty-one unchanged screens as changed, which is worse than no check
at all. The script measures how much moved and where instead, and it is what
answers T036's question about whether the back office still renders the same.

**Structure Decision**: the monorepo's existing split is the plan. Everything
shared lands in `packages/ui` (constitution VI: it is the single definition of
any atom both surfaces render); the two apps only consume, except for the
back-office-only primitives whose stacking and dimming change in place. No new
package, no new directory level.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.
