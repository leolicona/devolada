# Design Foundations — Devolada

Run date: 2026-09-09 · Mode: **update** (foundations already existed)

## 1. Detection

**Found, and mature.** Nothing was created from scratch; everything below extends
what the tree already holds.

| What | Where | State |
| --- | --- | --- |
| Semantic tokens: colour (light + dark), spacing (base 4), type ramp, radii, shadow, motion, breakpoints, component tokens | `packages/ui/src/styles/tokens.css` (287 lines) | Complete |
| Token → utility mapping | `packages/ui/src/styles/index.css`, Tailwind v4 `@theme inline` | Complete |
| Base layer: focus ring, `prefers-reduced-motion`, tabular numerals, self-hosted fonts (Archivo Variable, JetBrains Mono) | `index.css` | Complete |
| Consumption | `apps/pago/src/styles.css` imports as-is; `apps/admin/src/styles.css` bridges shadcn's semantic vars onto our tokens | Complete |
| Written law | Constitution **Principle VI. Visual Foundations (NON-NEGOTIABLE)** | Ratified v1.0.0 |
| Executable verification | `scripts/contrast-lint.mjs` (CI, `deploy-dev`, `deploy-prod`), `tests/e2e/{contrast,keyboard,responsive}.spec.ts`, screenshot suite `tests/design/` | Running |

**Gaps found** — the reason this run exists:

- **G1 — No layering scale.** `z-50` written by hand 8 times across `dialog.tsx`,
  `alert-dialog.tsx`, `sheet.tsx`, `popover.tsx`, `select.tsx`. A raw size value
  in components, which Principle VI forbids.
- **G2 — Three backdrops, three recipes.** `bg-black/50` (`dialog.tsx:19`,
  `sheet.tsx:23`) and `bg-ink/40` (`alert-dialog.tsx:20`), while the token
  `--color-surface-overlay` (utility `bg-overlay`) already exists and is used by
  neither. `bg-black/50` is a raw colour: direct drift against Principle VI.
- **G3 — `Button` and `Input` exist twice**, with divergent vocabularies:
  `packages/ui/src/components/button.tsx` (`primary/secondary/ghost`; 48px touch,
  64px decisive) vs `apps/admin/src/components/ui/button.tsx`
  (`default/outline/ghost/destructive/link`; 40px, 48px). Same for `input.tsx`
  (76 vs 48 lines).

## 2. Decisions

Direction, accessibility bar, dark-mode strategy, spacing base and motion were
**not re-asked**: Principle VI and `tokens.css` already answer them. They are
restated here only as the standing record.

| # | Decision | Source |
| --- | --- | --- |
| D1 | Aesthetic direction: functionalist (Rams), warm neutrals, deep-teal action accent, subtle borders over shadows, minimal purposeful motion — "trust doesn't bounce". Colour is information, always paired with icon + text. | Ratified, Principle VI |
| D2 | Accessibility: WCAG 2.2 AA minimum (4.5:1 body, 3:1 controls/borders/focus), AAA the aim on status and amount inks; keyboard-complete; reduced motion honoured. | Ratified, Principle VI |
| D3 | Dark mode is its own palette, never an inversion: system preference plus `[data-theme]`, both themes measured. | Ratified, Principle VI |
| D4 | Spacing base 4; mobile-first, real floor 360px designed at 375; body 16px; touch targets 48px, 64px for the decisive action. | Ratified, Principle VI |
| D5 | **This run records and decides; it does not implement.** The gaps are documented here and closed later in a feature. | Developer |
| D6 | **`packages/ui` is canonical** for anything both surfaces render. Admin-only primitives (dialog, select, sheet, popover, tabs, switch, calendar, textarea, label, collapsible, alert-dialog) keep living in the app, consuming the shared tokens. | Developer |
| D7 | The shared `Button` gains **`size: compact` (40px)**, declared for the desktop admin, alongside `md` (48px touch) and `critical` (64px). 40px still clears WCAG 2.2 AA target size (SC 2.5.8, 24×24); the 48px floor stays the rule on the touch PWA. | Developer |
| D8 | New foundation values this round: **a semantic layering scale** and **one shared dimming treatment**. No table-density scale for admin — not now. | Developer |
| D9 | Enforcement is **the written rule only**. No new CI lint for raw stacking or colour values; `contrast-lint` keeps covering the palette, and review plus `/speckit-analyze` catch the rest. | Developer (agent had suggested a CI gate; overruled) |

## 3. Principles for `/speckit-constitution`

Principle VI exists and is NON-NEGOTIABLE. This is an **amendment** — three
bullets added, nothing removed, no renumbering. Version bump: **1.0.0 → 1.1.0**
(MINOR: new rules, existing ones intact).

```markdown
### VI. Visual Foundations (NON-NEGOTIABLE)

<!-- add to the existing bullets -->

- Stacking order is semantic and tokenised: every overlapping surface takes its
  position from the layering scale in `tokens.css`. No raw z-index in a
  component, and no new layer without a name.
- One dimming treatment: every modal surface — dialog, sheet, confirmation —
  renders the same backdrop from `--color-surface-overlay`. A hand-mixed
  translucent black or ink is drift, in either theme.
- `packages/ui` is the single definition of any atom both surfaces render;
  a duplicate recipe in an app is drift. Sizes are declared, not improvised:
  compact (40px, desktop admin), standard (48px touch), decisive (64px).
  Primitives only one surface uses may live in that app, but consume the
  shared tokens and never redefine a value.
```

## 4. Feature description for `/speckit-specify`

```text
Feature: design-foundations. Consolidate the visual system every screen of
Devolada already builds on, and close the three places where screens still
improvise. Users: the developer and every future visual feature. The
foundation provides the semantic value set (colour for light and dark, type
ramp, spacing, radii, elevation, motion) plus, new in this feature, a named
stacking order for overlapping surfaces and a single dimming treatment shared
by every modal surface; and it provides one definition of the atoms both
surfaces render — button and text field — offered in three sizes: compact for
the desktop back office, standard for touch, and decisive for the charge
path. Success criteria: no screen in either surface carries a literal colour,
size, spacing or stacking value; every overlapping surface takes its position
from the named order; the modal, the sheet and the confirmation dim the page
identically in both themes; a button or text field renders from one
definition regardless of surface; every text/background pair meets WCAG 2.2
AA in both themes; the same screen renders correctly at 375, 768 and 1280
wide with no horizontal scroll; reduced motion is honoured. Out of scope:
page layouts, feature components, any change to the aesthetic direction or
the palette, table density, marketing pages, illustration, and the internals
of primitives only the back office renders.
```

## 5. Notes for `/speckit-plan`

- **Token format**: CSS custom properties in `packages/ui/src/styles/tokens.css`,
  surfaced as Tailwind utilities through `@theme inline` in
  `packages/ui/src/styles/index.css`. **Extend both files; replace neither.**
  Layer values belong in `:root` only — a stacking order has no dark variant.
- **Layering**: name the layers semantically (base, dropdown, sticky, overlay,
  modal, toast), not numerically. Before mapping them in `@theme inline`,
  **verify whether Tailwind v4 exposes a theme namespace for z-index** in the
  pinned version (`tailwindcss ^4.1.0`); if it does not, consume the variable
  directly at the call site or through a small `@layer utilities` block rather
  than inventing a namespace.
- **Overlay**: `--color-surface-overlay` and its `bg-overlay` utility already
  exist and already have a dark value. Replace `bg-black/50`
  (`apps/admin/src/components/ui/dialog.tsx:19`, `sheet.tsx:23`) and `bg-ink/40`
  (`alert-dialog.tsx:20`).
- **Atoms**: extend the `cva` recipe in `packages/ui/src/components/button.tsx`
  with `compact` (D7) and with the two variants only the admin has today
  (`destructive`, `link`); map admin's names onto the shared ones
  (`default` → `primary`, `outline` → `secondary`). Then delete
  `apps/admin/src/components/ui/button.tsx` and `input.tsx` and re-point their
  call sites at `@devolada/ui`. The disabled treatment both files already
  document — a different fill, never lowered opacity — survives the merge.
- **The bridge stays**: `apps/admin/src/styles.css` keeps mapping shadcn's
  semantic variables onto our tokens; the admin-only primitives depend on it.
- **Contracts**: deliver the value set as a UI contract under the feature's
  `contracts/` — the token names and their meaning, not their hex.
- **Verification**: `contrast-lint` and the existing e2e suites are the gate.
  Per D9, **do not add a new lint** for stacking or raw colour; cover the new
  rules with the screenshot suite in `tests/design/` and review instead. Every
  new spec file cites its story, per Principle VII.

## 6. Open questions

- `[NEEDS CLARIFICATION: do destructive and link belong in the shared Button, or stay admin-only variants — shared/admin-only?]`
  The charge PWA renders neither today.
- `[NEEDS CLARIFICATION: do the admin-only primitives eventually move to packages/ui, or is the app the permanent home — move/permanent?]`
  D6 settles today's boundary, not the destination.
- Table density for the admin was raised and declined this round (D8). It stays
  a live question the first time a table screen is specified.
