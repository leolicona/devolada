# Implementation Plan: searchable-picker

**Branch**: `claude/clabe-dropdown-search-ouw4cc` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-searchable-picker/spec.md`

## Summary

Give the bank field a search of its own. The ISP types into the field, the list
narrows to what matches — case- and accent-insensitive, names that start with
what was typed first — and the name is chosen with the pointer or the keyboard
alone. The field commits only a name from the generated vocabulary, and every
way out of it restores the name last chosen.

Technically this is one new primitive in the panel — an ARIA 1.2 combobox built
on the Radix popover the panel already ships — consumed by the three screens
that name a bank. No route, no schema, no migration, no new dependency. The
payer's public page is untouched.

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`; React 19

**Primary Dependencies**: `@radix-ui/react-popover` (already a dependency of
`apps/admin`, used by the date-range field), `lucide-react` icons, the
`@devolada/ui` atoms and tokens. **No new package.**

**Storage**: N/A. The chosen name is saved by the routes that already save it
(`PATCH /settings`, `POST /credit/top-ups`, `POST /platform/settings/:key`);
their contracts do not change.

**Testing**: Vitest 3 on happy-dom with Testing Library, MSW
(`onUnhandledRequest: "error"`) and `axe` for what is offered and what commits;
Playwright 1.6x + axe for what needs layout.

**Target Platform**: `apps/admin`, an assets-only Worker; current browsers.

**Project Type**: Web application — frontend only, one of the two panels.

**Performance Goals**: Filtering 97 names is a single pass over a frozen array;
it must feel instantaneous at every keystroke. The panel's bundle must not grow
by a dependency.

**Constraints**: WCAG 2.2 AA; keyboard-complete; visible, measured focus; dark
mode is its own palette; floor 360px with no horizontal scroll; compact 40px
counter height (the panel's pointer size); semantic tokens only; es-MX copy.

**Scale/Scope**: 97 names, 3 screens, 1 new primitive, 0 API changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| # | Principle | Gate | Verdict |
|---|-----------|------|---------|
| I | Spec-Driven, Every Decision Cited | This spec exists before the code is judged; every non-obvious rule in the control cites `searchable-picker D<n>` | **PASS** — the control's comments currently cite `bug: bank-picker-unreachable` from the pass that built it; `/speckit-converge` re-cites them to this feature |
| II | Money Law | No amount is read, written or displayed | **N/A** — the field names a bank; the fee and the CLABE beside it are untouched |
| III | One Contract, Pure Routers | No route, no zod schema, no envelope. The vocabulary that must agree in several places is generated from one source and never hand-transcribed | **PASS** — the control receives the names; `gen-banks --check` still governs them |
| IV | Tests Run on the Real Runtime | Each layer answers only what it can | **PASS** — component layer: which names are offered, what commits, `axe`. Browser layer: real contrast in both themes, target size, focus, the 360px floor |
| V | Tenant Isolation and Authorization by Area | No query, no `business_id`, no new right | **N/A** — the screens that host the field already resolve the actor and the area |
| VI | Visual Foundations (NON-NEGOTIABLE) | Tokens only; compact 40px; keyboard-complete; visible focus; dark is its own palette; 360px floor; es-MX copy; the atom lives once | **PASS** — a primitive only the panel renders may live in the panel (`apps/admin/src/components/ui/`); the field itself is the shared `Input` atom, not a second recipe |
| VII | Every Test Cites Its Story | Every new test cites `searchable-picker US<n>` | **PASS** — enforced by `spec-lint` |
| VIII | Absent Configuration Degrades | No binding, no secret | **N/A** |

**Result: no violation.** Complexity Tracking is empty.

One judgement worth recording rather than burying: the control is **not** added
to `packages/ui`. Constitution VI reserves that package for an atom *both*
surfaces render, and the payer's page deliberately keeps the phone's own picker
(spec, Out of Scope). Putting it in the shared package would publish a second
picker that one surface must never use.

## Project Structure

### Documentation (this feature)

```text
specs/007-searchable-picker/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── bank-field.md    # Phase 1 output — the control's contract
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/admin/src/
├── components/ui/
│   └── combobox.tsx            # the new primitive
├── lib/
│   └── banks.ts                # the vocabulary in reading order, defined once
└── features/
    ├── settings/SettingsScreen.tsx   # the business's own account
    ├── credit/CreditCard.tsx         # a top-up's sender
    └── operator/OperatorScreen.tsx   # the platform's own account

apps/admin/test/
└── bank-picker.test.tsx        # what is offered, what commits, axe

packages/ui/src/components/
└── input.tsx                   # the shared field the control is built from

tests/e2e/
└── bank-picker.spec.ts         # contrast, target size, the 360px floor

apps/pago/                      # UNTOUCHED — the payer keeps the phone's picker
```

**Structure Decision**: the control is a panel primitive under
`apps/admin/src/components/ui/`, beside the other shadcn primitives the panel
copied and themed (`select.tsx`, `popover.tsx`, `dialog.tsx`). It is built from
the shared `Input` atom in `packages/ui` rather than restating the field recipe,
which is what constitution VI asks for when only one surface renders a control.
The sorted vocabulary lives once in `apps/admin/src/lib/banks.ts` so the three
screens do not each carry a copy of the sort.

## Constitution Check — re-evaluated after Phase 1

Re-run against the design in `research.md`, `data-model.md` and
`contracts/bank-field.md`. **No verdict changes.** What the design added, and why
it changes nothing:

- **No new dependency** (D5 anchors against a popover the panel already ships),
  so the fixed stack table is untouched.
- **No persisted model** (`data-model.md` is field states, not columns), so II
  and V stay N/A for the same reasons as before.
- **D7** is the one judgement the check turns on, and it is recorded above:
  the control stays in the panel because only the panel may render it.
- **D6** exists because of gate VI/IV — the popup layer announces nothing, and
  `axe` on every panel screen is what catches it if that regresses.

## Complexity Tracking

No constitution gate is violated; this section is intentionally empty.
