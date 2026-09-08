# Design review: Pagos — the filter bar (`/payments`)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md` (pivot phase 2)
Philosophy: functionalist, tokens are law, warm accent; calm by default
Date: 2026-09-02 · Status: **PR1 merged (#157); PR2 built and verified (branch `feat/pagos-date-range`)**
Code: `apps/admin/src/features/feed/FeedScreen.tsx`, `apps/admin/src/components/ui/tabs.tsx`
Owning spec: `docs/legacy/reconciliation/payments-and-classes.spec.md` **D4** (US-R03) — everything here amends D4; no new US-ID.

The round started as four questions about the filter bar. Measuring them turned up two defects, one dead test, and one open spec question that the measurement closes. The owner then took decisions on each branch (grill session) and a second pass reviewed the agreement; this document is the consolidated result. The chronology is at the end.

## Summary

The bar is structurally sound: **0 axe violations** at 375, clean tab order, dark mode is a real palette, and **the page never scrolls horizontally** at any width from 320 to 1280. The decisive finding is that **native date inputs render `mm/dd/yyyy` even with `lang="es-MX"` on `<html>` and on the input** — the browser's application locale wins, nothing in markup moves it — which closes the open DoD question in `FeedScreen.tsx:466-470` and makes the custom range control the priority. The chip rail's "horizontal scroll" is not overflow; it is the scrollbar gutter, a clipped focus ring, and a cut that stops 16px short of the screen. Two defects rode along: the `Fechas` toggle reports a state change it does not perform (by design, it turns out — see F6), and an inverted range shows the first-run empty copy while the header counts the payments it hides.

Method: local dev (`:5174` + API `:8787`, seeded), Playwright/Chromium, locale `es-MX`, tz `America/Mexico_City`. Every number below was measured unless marked *est.*

## Screenshots captured

| Screenshot | Breakpoint | What it shows |
|---|---|---|
| `review-pagos-filters-desktop-1280.png` | Desktop 1280×800 | Cliente / Desde / Hasta in one labelled row, chips on one line |
| `review-pagos-filters-tablet-768.png` | Tablet 768×1024 | Chips wrap to two rows; no scroll |
| `review-pagos-filters-mobile-375.png` | Mobile 375×812 | Label, `Fechas` button, rail cut flush mid-word at the container edge |
| `review-pagos-filters-mobile-360.png` | Mobile 360×780 | Same at the admin's 360 floor |
| `review-pagos-chips-scrolled-mobile-375.png` | Mobile 375 | Rail scrolled fully right — the page does not move |
| `review-pagos-chip-focus-clip-mobile-375.png` | Mobile 375 (rail crop) | Focus ring on "En cola" cut flat across the top |
| `review-pagos-dates-open-mobile-375.png` | Mobile 375 | Dates panel open — `mm/dd/yyyy` |
| `review-pagos-dates-esmx-mobile-375.png` | Mobile 375, locale es-MX | Still `mm/dd/yyyy` |
| `review-pagos-inverted-range-mobile-375.png` | Mobile 375 | Desde 30 sep › Hasta 1 sep → first-run empty copy, header still "2 pagos" |
| `review-pagos-filters-dark-desktop-1280.png` | Desktop 1280, dark | Palette holds; native date widgets are the exception |
| `review-pagos-filters-dark-mobile-375.png` | Mobile 375, dark | Same on a phone |

| `review-pagos-filters-after-mobile-360.png` | Mobile 360 · **after PR1** | Chips first, rail off the screen edge, 44px controls |
| `review-pagos-filters-after-range-mobile-360.png` | Mobile 360 · after | Trigger reads `1–15 sep`, panel collapsed, no-match copy with *Limpiar filtros* |
| `review-pagos-chip-focus-after-mobile-360.png` | Mobile 360 (rail crop) · after | Focus ring on "En cola" intact on all four sides |
| `review-pagos-filters-after-desktop-1280.png` | Desktop 1280 · after | Chips row above the labelled controls row |
| `review-pagos-filters-after-tablet-768.png` | Tablet 768 · after | Chips wrap to two rows, controls row below — the 640–1024 band holds in PR1's two-row shape |
| `review-pagos-range-bar-mobile-360.png` | Mobile 360 · **after PR2** | Magnifier search "Buscar cliente" + `Fechas` on one row, no label |
| `review-pagos-range-sheet-mobile-360.png` | Mobile 360 · PR2 | Bottom sheet: presets, es calendar, future days disabled, Limpiar/Aplicar |
| `review-pagos-range-sheet-range-mobile-360.png` | Mobile 360 · PR2 | A range: strong ends, soft band between, preview `27 ago – 2 sep` |
| `review-pagos-range-sheet-oneday-mobile-360.png` | Mobile 360 · PR2 | One day picked: a full circle, preview `1 sep` |
| `review-pagos-range-sheet-dark-mobile-360.png` | Mobile 360, dark · PR2 | Same range in the dark palette |
| `review-pagos-range-popover-desktop-1280.png` | Desktop 1280 · PR2 | Popover anchored to the trigger's end |
| `review-pagos-range-bar-tablet-768.png` | Tablet 768 · PR2 | Chips on two rows, controls row below |

> All in `.design/devolada/screenshots/`.

## Findings

### F1 — The rail is right; three things make it look wrong

`document.documentElement.scrollWidth === clientWidth` at 320, 360, 375, 414, 768, 1024 and 1280. Scrolling the rail fully right leaves `scrollLeft === 0`. What scrolls is the `TabsList` itself: seven chips need **742px** of a **343px** container at 375, and `overflow-x-auto` (`FeedScreen.tsx:528`) is the fix the 2026-09-01 review asked for. Above `sm` it correctly stops: `overflow-x: visible` at 768+, chips wrap.

- **`overflow-x: auto` made `overflow-y: auto` too** (CSS: one non-visible axis forces the other to `auto`). The rail now clips vertically, and the 3px `--shadow-focus` ring (`tokens.css:135`) on a focused chip is **cut flat across the top** — `spaceAbove: 0`, `spaceBelow: 4` (the `pb-1`). `SPEC.md:163` already admits *"keyboard order and visible focus are covered by no test"*.
- **A classic scrollbar has 4px where it needs ~15.** `scrollbar-width` computes to `auto`; nothing suppresses it. Headless Chromium draws overlay bars (gutter `0px`), so CI never sees it; macOS "Always show", Windows, and DevTools device mode do. This is what reads as "horizontal scroll".
- **No "keep swiping" signal.** The cut lands at x=343 of 375 — 16px short of the screen — mid-word ("Fallido|s"). A cut before the edge reads as clipping; a cut off the edge reads as more content.

Fix (`FeedScreen.tsx:526-529`): edge bleed `-mx-4 px-4 sm:mx-0 sm:p-0`; ring room `-my-1 py-1` (padding for the ring, negative margin so the chips do not move); `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`; keep `sm:overflow-x-visible`.

### F2 — Native date inputs render US format for a Mexican ISP

With `navigator.language = "es-MX"`, `navigator.languages = ["es-MX"]`, `<html lang="es-MX">` and `lang="es-MX"` on the input, Chromium renders **`mm/dd/yyyy`**. The date input's format follows the browser's application locale, not the page's. An ISP on an English-UI Chrome — common on a Mexican shop desktop — reads `03/09` as March 9 on a money screen. **This closes the open DoD line** in the code comment at `FeedScreen.tsx:466-470`: the observation is done, and page `lang` does not move it. Only a custom calendar recovers the format, the language and the range semantics.

### F3 — The filter row's copy and contrast

- Placeholder `#a8a29e` on `#f1efea` = **2.19:1** (AA needs 4.5:1). axe does not flag placeholders, so `contrast-lint.mjs` stays green.
- Inputs are `text-sm` = **14px** on mobile (`input.tsx:14`); iOS Safari force-zooms focused fields under 16px.
- Touch targets: chips **36px**, search / date inputs / `Fechas` **40px**. `Button` default is `h-10` = 40 (`button.tsx:20`).
- The search is ~630px wide on desktop (`min-w-48 flex-1`).
- Date inputs fire a query per keystroke (`FeedScreen.tsx:503,513`); the search is debounced 300ms (`413-416`).
- Both Pagos and Cobros search **name + usuario** and nothing else (`apps/api/src/routes/payments/handler.ts:93-100`; `CobrosScreen.tsx:207`). They fold accents differently: Cobros lowercases in JS; Pagos uses SQLite `LIKE`, ASCII-only — `maría` finds "MARÍA" in Cobros, not in Pagos.
- Text widths in Archivo Variable: `"Buscar por nombre o usuario"` **205px** @16 / 179 @14; `"Buscar nombre o usuario"` 178 @16; `"Buscar cliente"` **101px** @16. Container inner width: 288 @320, **328 @360**, 343 @375, 382 @414.

### F4 — Cobros and Pagos disagree on the same row

| | Cobros (`CobrosScreen.tsx:280-294`) | Pagos |
|---|---|---|
| Order | chips left, search right, one row directly above the list | search + dates row, then chips |
| Visible label | none | "Cliente" |
| Placeholder | "Buscar por nombre o usuario" | "Nombre o usuario" |
| Accessible name | `aria-label` | the label |

Cobros' shape satisfies both pulls at once: chips first in reading order (scope before refine) **and** the row adjacent to the `tabpanel` it labels (the list lives inside `<TabsContent>`, `FeedScreen.tsx:536`). Cobros survives without a label because its placeholder leads with the verb. `.design/devolada/INFORMATION_ARCHITECTURE.md:69` lists Pagos' filters as *"estado, fecha, cliente"* — a list of dimensions, not a layout order (the agreed row puts cliente before fecha), so it is corroboration, not authority.

### F5 — An inverted range lies about the business

Desde 30 sep › Hasta 1 sep → 0 rows and *"Sin pagos por aquí todavía. Aparecerán en cuanto tus clientes empiecen a pagar."* (`FeedScreen.tsx:550-552`) while the same screen's header reads *"Hoy: $814.00 · 2 pagos"*. Nothing prevents `from > to`. A filtered-to-nothing list must not use the first-run copy — the same principle as US-P01.

### F6 — The `Fechas` toggle cannot collapse once a date is set — by decision

`showDates = datesOpen || from !== "" || to !== ""` (`FeedScreen.tsx:408`). With a date set, two clicks leave `panelVisible: true` and `aria-expanded: "true"`. This is **not a bug**: `feed.test.tsx:352-355` asserts it (*"an active filter keeps the fields visible even after closing"*). It was the 2026-09-01 review's answer to "an active filter must never be invisible" — force the panel open. The cost is a toggle that reports a state change it does not perform. The plan meets the same requirement differently (the trigger names the range) and therefore **reverses that decision and rewrites its test**.

### F7 — The 44px touch-target assertion is dead code

`expectTouchTargets` is defined at `tests/e2e/responsive.spec.ts:29` and **never invoked** — the only calls in the file (87, 102, 120) are the other three assertions. Yet `design-review.spec.md` D1 states responsive.spec.md *"proved… every control clears 44px"* and `responsive.spec.md` DoD line 42 lists it as done. **Both assert something untrue.** This is why 36px chips and 40px inputs shipped. Calibration: the ≥48px `--size-touch` rule is `apps/pago` law (FRONTEND.md:26); the Admin section sets no touch floor; the 360px floor does apply to the admin (FRONTEND.md:31).

### F8 — What exists to build with

- `@radix-ui/react-dialog@^1.1.23` is a dependency (Sheet is free). No `sheet.tsx`, `popover.tsx`, `calendar.tsx`, `react-day-picker` or `vaul` anywhere in the monorepo. `apps/admin/components.json` is configured (`ui → @/components/ui`, `hooks → @/hooks`), so `pnpm dlx shadcn@latest add popover` lands correctly (FRONTEND.md:22).
- **No `matchMedia` / `useMediaQuery` in any app.** The only responsive mechanism is CSS; the shell renders both navs and hides one (a11y D5). `shell.test.tsx:24` uses `getAllByRole` — happy-dom does not hide what CSS hides.
- The business timezone owns "today" (settings D5); the feed reports `today.startedAtMs`, which is `null` while pending and on error. `useDisplaySettings().timezone` is always available.
- The admin's `Input` (`h-10 text-sm px-3`, no icon) is a deliberate local copy (FRONTEND.md:20), not drift; the shared atom (`packages/ui/src/components/input.tsx`) is `h-12 text-base` with an `icon` prop.
- `feed.test.tsx:344` resolves the trigger with `getByRole("button", { name: "Fechas" })`.
- Next free debt id: **TD-019** (TD-018 is the highest).

## Answers to the four questions

1. **Remove "Cliente"?** Recommended keeping it (F3: the placeholder is 2.19:1 and vanishes on typing). **Owner: remove it**, with the placeholder changed to lead with the verb — which is what makes the label redundant. Ships with PR2 (see plan), because dropping it while Desde/Hasta keep labels leaves a ragged desktop row.
2. **Remove "Fechas"?** Recommended keeping it. Owner first removed it (learned affordance under daily use), then **reversed on the arithmetic**: the trigger must name an active range (F6), so it carries text anyway, and the icon-only version truncates the search exactly when a range is set (145px of room vs 205 needed at 360). **Stays.**
3. **Bottom sheet with a range calendar?** **Yes — and it is the priority**, because of F2. Popover on desktop, bottom sheet on mobile.
4. **Why the horizontal scroll?** F1. Not overflow; fix the rail.

## Decisions (final)

| # | Decision | Why |
|---|---|---|
| D1 | **Two PRs.** PR1 = rail + order + filtered-empty copy + test + specs (no deps). PR2 = date control + label/placeholder (+1 dep, revises D4). | PR1 does not depend on the sheet. The copy change moves to PR2 so the desktop row is never half-labelled. |
| D2 | Chips **first**, on their own row at every width; the controls row (search + trigger) below it. *Corrected in PR2: Cobros' one-row shape does not fit Pagos even at 1280 — seven chips (742px) + search + trigger exceed the ~976px `main`. One row is Cobros' (three chips), not the product's.* | Scope before refine; adjacency to the tabpanel. |
| D3 | Placeholder **`"Buscar cliente"`** + `aria-label="Buscar por nombre o usuario"`; label removed. | 101px is the only verb-leading string that fits beside a labelled trigger at 360 (152px of room). "o usuario" is a hint, not a gate. |
| D4 | `Fechas` **keeps its text** and **names an active range**. | F6. The invisible-filter requirement is met by the label, not by a panel that cannot close. |
| D5 | Range copy: **compact adaptive** — `1–15 sep` · `28 ago – 15 sep` · `28 dic 2025 – 3 ene 2026` · `3 sep`. New short formatter beside `formatTime` in `lib/datetime.ts`, landing in **PR1** (D4 needs it). | `fmtCepDate` gives "1 de septiembre de 2026" — too long for a button. |
| D6 | Row 2 is **`flex-wrap`**: two rows in the common case, the trigger drops to its own line only when wide. | *est.* `28 ago – 15 sep` leaves ~101px for the placeholder (zero margin); cross-year leaves ~41px. A promise that degrades beats one that lies. |
| D7 | **Popover on desktop** (`pnpm dlx shadcn@latest add popover`), **Sheet below `sm`** on the existing Dialog dep. | A centred modal is too heavy for adjusting a range; the cost is 1 dep + 1 file against 6 Radix deps present. |
| D8 | **Two triggers, CSS hides one**; the draft lives in a shared `DateRangeField`; one calendar body. | Matches the a11y D5 precedent and avoids a JS/CSS breakpoint split. Radix mounts only the open one. *Built as: both triggers read "Fechas" (a real browser exposes only the visible one; an invented suffix would reach screen readers for happy-dom's sake), and the unit tests read the first with `getAllByRole`, as `shell.test.tsx:24` reads the two navs.* |
| D9 | **Dismiss discards · Aplicar commits · Limpiar clears + commits + closes.** | Removing a filter must not cost two taps. Staging also ends the query-per-keystroke (F3). |
| D10 | **Three presets** — Hoy · Últimos 7 días · Este mes — **apply immediately**. Dates as `YYYY-MM-DD` strings in the business zone from `useDisplaySettings().timezone` + `Intl`; `today.startedAtMs` preferred when present. Future days disabled, boundary in the business zone. | `today` is `null` on pending/error; the strings need no feed. At 23:00 in Tijuana a UTC boundary would disable *today*. |
| D11 | **No open-ended ranges in the UI**: one day + Aplicar = that day (`from = to`). The sheet previews the pending selection so Aplicar's effect is visible. | A premature Aplicar must not widen the filter silently. The API keeps accepting open ranges. |
| D12 | Filters stay in **component state, not the URL**; reasoning recorded. | Nothing navigates away from `/payments`. Cost acknowledged: a refresh — frequent on phones, where background tabs are discarded — loses the view. Revisit if the pilot reports it. |
| D13 | Wire `expectTouchTargets` **scoped to the filter bar** in PR1; fix its controls to ≥44px; **correct the false claim** in `design-review.spec.md` D1 and `responsive.spec.md` DoD line 42; open **TD-019** for the admin at large, stating the `Button h-10 → h-11` question explicitly. | Scoping to the route still fails on every default `Button` on the page (F3). Raising `Button` is a global density decision outside this round. |
| D14 | **No BUGS.md entries.** | The empty-copy defect is fixed in the PR that found it, with a test. The toggle is a decision reversal (F6), not a defect. |
| D15 | A filtered-to-nothing list says so — *"Ningún pago coincide con estos filtros"* + a clear action — whenever `status !== "all" \|\| q \|\| from \|\| to`. The message lives inside `TabsContent` (US-P04). | F5. |

## Plan

### PR1 — rail, order, empty state, test, specs (no new deps) — **built 2026-09-02**

Verified on the branch: `tsc` clean on every workspace; admin unit tests 116/116 (12 new: the rewritten fold test, two empty-state tests, nine formatter cases); e2e `responsive.spec.ts` 5/5 including the new filter-bar assertion; `spec-lint` clean. Measured after: page never scrolls sideways; rail spans 0→360; ring room 4px above and below; `scrollbar-width: none`; all nine filter-bar controls at 44px; trigger `1–15 sep` with `aria-expanded="false"` and the panel hidden. Files: `FeedScreen.tsx`, `tabs.tsx`, `lib/datetime.ts` (+`formatDateRange`), `test/feed.test.tsx`, `test/datetime.test.ts`, `tests/e2e/responsive.spec.ts`, `payments-and-classes.spec.md` (D4 amended, **D10** added, DoD line closed), `design-review.spec.md` (D1 corrected, **D10** added), `responsive.spec.md` (scenario 2 corrected), `TECH_DEBT.md` (**TD-019**).

1. Rail fix per F1. Add an e2e assertion that a focused chip's box sits inside the rail's padding (closes the SPEC.md:163 gap for this screen).
2. Chips row moves above the controls row (search + dates). Desktop stays two rows until PR2; capture **768** in the PR's review — the 640–1024 band is where chips wrap and the row shape is untested.
3. `showDates = datesOpen`; the trigger names an active range via the new compact formatter (D5). Rewrite `feed.test.tsx:335-356` to assert the new contract (toggle collapses; label carries the range).
4. Filtered-empty copy (D15) with a test.
5. Filter-bar controls ≥44px; `expectTouchTargets` wired for that selector (D13). Open TD-019.
6. Specs: amend D4 (order), amend `design-review.spec.md` with this round, correct the 44px claims in both specs.

### PR2 — the date range control (+ `react-day-picker`) — **built 2026-09-02**

Verified on the branch: `tsc` clean on every workspace; admin unit tests 122/122 (6 new: presets in the business's zone, one day + Aplicar, dismiss discards, Limpiar + disabled tomorrow, zone helpers); e2e `responsive.spec.ts` 5/5; `spec-lint` clean. Measured after: sheet day cells 44×44 at 360, 32 future days disabled, `lu ma mi ju vi sá do`, preset `Últimos 7 días` → `27 ago – 2 sep`; popover `align="end"` on the trigger at 1280; search + trigger share a row at 360. Deps: `@radix-ui/react-popover` (scoped, like every other Radix dep — the CLI's monolithic `radix-ui` and its `date-fns` were removed), `react-day-picker` 10. Files: `components/ui/{popover,sheet,calendar}.tsx`, `features/feed/DateRangeField.tsx`, `FeedScreen.tsx`, `components/ui/input.tsx` (+`icon`), `lib/datetime.ts` (+zone helpers), tests, `payments-and-classes.spec.md` D4 revised, `FRONTEND.md` primitives list.

1. `shadcn add popover`; `react-day-picker` v9, locale `es`, `mode="range"`, themed from `tokens.css` (selected range on `--accent-soft`, matching the active chip; both palettes).
2. `DateRangeField` (draft state) → `Sheet` trigger `sm:hidden` / `Popover` trigger `hidden sm:block` with distinct names (D8); one `RangeCalendar` body; D9–D11 semantics.
3. Desktop's inline Desde/Hasta inputs go. Trade acknowledged: typing into a visible field becomes trigger → popover → pick → Aplicar, in exchange for the correct format.
4. Label removed, placeholder `"Buscar cliente"`, `aria-label`, magnifier via an `icon` prop added to the admin `Input` (mirroring the shared atom). Row 2 `flex-wrap` (D6).
5. Revise D4 with the control; close the DoD line on native date format with F2.

## Open

- **Cobros' placeholder.** Pagos gets `"Buscar cliente"`; Cobros keeps the long form. One word per concept suggests Cobros follows — undecided.
- **Sheet internals**: height, whether the calendar scrolls inside it, Esc/keyboard inside a sheet (Radix Dialog handles focus trap and Esc; the calendar's own keyboard nav is react-day-picker's).
- **Accent folding** in the Pagos search (F3) — a BUGS.md candidate if the pilot hits it.
- The search's 630px desktop width (`sm:max-w-sm`) and a scroll-position memory for the active chip — polish, unscheduled.

## What works well

- The rail decision itself: one scrolling line beats three wrapped ones, and the `sm` hand-off to wrapping is clean (measured at every width ≥768).
- `shrink-0 whitespace-nowrap` on the trigger (`tabs.tsx:22-25`): chips hold their shape; no label breaks inside its pill.
- Zero axe violations, logical tab order, dark mode as a palette rather than an inversion — the native date widgets are the only element outside the token system, which is exactly what PR2 reclaims.
- The chips are the questions an ISP asks (`FeedScreen.tsx:35-38`); no lifecycle vocabulary leaks into the labels.

## Chronology

1. Four questions asked; measured; recommended keeping both labels, building the sheet, fixing the rail.
2. Follow-up: chips before or after the search → before (F4).
3. Follow-up: adopt Cobros' placeholder → yes, if the field keeps a full-width line (205px does not fit beside a trigger).
4. Owner: remove both labels. Recorded with conditions (aria-labels, range shown on the trigger, ≥44px).
5. Owner, on condition 3: removing "Fechas" makes no sense if the button must speak → **reversed**; placeholder shortened to `"Buscar cliente"`.
6. Grill session: eleven decisions; codebase resolved the spec home (US-R03/D4), the dead test (F7), the presets' clock, and the container switch.
7. Review of the agreement: F6 reclassified as a tested decision; two-row fit shown to fail for wide ranges; route-scoped test shown to fail on every `Button`; PR1 shown to recreate a ragged row. Amendments applied above (D1, D6, D13, D14) — pending the owner's veto.
