# Design Foundations — Devolada

Run 1: 2026-09-09 — record the system, close three gaps.
Run 2: 2026-09-09 — feedback motion (waiting, resolving).
Mode: **update** — foundations already existed; nothing here replaces them.

## 1. Detection

**Found, and mature.** Everything below extends what the tree already holds.

| What | Where | State |
| --- | --- | --- |
| Semantic tokens: colour (light + dark), spacing (base 4), type ramp, radii, shadow, breakpoints, component tokens | `packages/ui/src/styles/tokens.css` (287 lines) | Complete |
| Token → utility mapping | `packages/ui/src/styles/index.css`, Tailwind v4 `@theme inline` | Complete **except motion** |
| Motion tokens: 4 durations, 3 easings | `tokens.css:138-146` | **Dead** — unmapped, unconsumed |
| Base layer: focus ring, blanket `prefers-reduced-motion`, tabular numerals, self-hosted fonts | `index.css:127-134` | Complete |
| Consumption | `apps/pago/src/styles.css` as-is; `apps/admin/src/styles.css` bridges shadcn's vars onto our tokens | Complete |
| Written law | Constitution **Principle VI. Visual Foundations (NON-NEGOTIABLE)** | Ratified v1.0.0 |
| Executable verification | `scripts/contrast-lint.mjs` (CI, deploy-dev, deploy-prod), `tests/e2e/{contrast,keyboard,responsive}.spec.ts`, screenshots in `tests/design/` | Running |
| The waiting flow itself | `apps/pago/src/features/pago/PaymentPage.tsx`: polling (`refetchInterval`, l.350), `aria-live="polite"` (l.584), honesty staged over `validationAttempts` slots `[2,8,20,45,120,360]` min, `nextValidationAt`, `provisionalRelease` | Built, **unanimated** |

**Gaps** — the reason these runs exist:

- **G1 — No layering scale.** `z-50` by hand 8 times across `dialog.tsx`,
  `alert-dialog.tsx`, `sheet.tsx`, `popover.tsx`, `select.tsx`.
- **G2 — Three backdrops, three recipes.** `bg-black/50` (`dialog.tsx:19`,
  `sheet.tsx:23`) and `bg-ink/40` (`alert-dialog.tsx:20`), while
  `--color-surface-overlay` (utility `bg-overlay`) sits unused. `bg-black/50`
  is a raw colour: direct drift against Principle VI.
- **G3 — `Button` and `Input` defined twice**: `packages/ui/src/components/`
  (`primary/secondary/ghost`; 48px touch, 64px decisive) vs
  `apps/admin/src/components/ui/` (`default/outline/ghost/destructive/link`;
  40px, 48px). Same for `input.tsx` (76 vs 48 lines).
- **G4 — The motion tokens are dead.** `--duration-*` and `--easing-*` are
  declared and reach nothing: `index.css` never maps them, so no utility can
  see them. Components write **`duration-150` by hand, 15 times** — a literal
  that happens to equal `--duration-fast`.
- **G5 — No feedback vocabulary.** Three animations exist in the whole tree:
  `animate-pulse` (Skeleton), `animate-spin` (ListError retry), `animate-in`
  (dialog overlay). The payer waits for Banxico through text alone, and
  `--duration-slow`'s own comment — *"charge result reveal"* — names a
  decision that never reached the code.

## 2. Decisions

Direction, accessibility bar, dark mode, spacing base and the mobile-first
floor were **not re-asked**: Principle VI and `tokens.css` answer them. They
are restated as the standing record.

| # | Decision | Source |
| --- | --- | --- |
| D1 | Aesthetic direction: functionalist (Rams), warm neutrals, deep-teal accent, subtle borders over shadows, minimal purposeful motion — "trust doesn't bounce". Colour is information, always with icon + text. | Ratified, Principle VI |
| D2 | WCAG 2.2 AA minimum (4.5:1 body, 3:1 controls/borders/focus), AAA the aim on status and amount inks; keyboard-complete; reduced motion honoured. | Ratified, Principle VI |
| D3 | Dark mode is its own palette, never an inversion. | Ratified, Principle VI |
| D4 | Spacing base 4; floor 360px designed at 375; body 16px; touch 48px, 64px decisive. | Ratified, Principle VI |
| D5 | **These runs record and decide; they do not implement.** Gaps are documented here and closed later in a feature. | Developer |
| D6 | **`packages/ui` is canonical** for anything both surfaces render. Admin-only primitives stay in the app, consuming the shared tokens. | Developer |
| D7 | The shared `Button` gains **`size: compact` (40px)** for the desktop admin, beside `md` (48px) and `critical` (64px). 40px clears WCAG 2.2 AA target size (SC 2.5.8, 24×24); the 48px floor stays the rule on the touch PWA. | Developer |
| D8 | New values run 1: **a semantic layering scale** and **one shared dimming treatment**. No table-density scale. | Developer |
| D9 | Enforcement is **the written rule only** — no new CI lint. `contrast-lint` keeps covering the palette; review and `/speckit-analyze` catch the rest. | Developer (agent suggested a CI gate; overruled) |
| D10 | **Waiting breathes.** A slow pulse on what is pending (the existing Skeleton) plus a discreet indeterminate line under the status. **No spinner on the payer's page** — a spinner promises continuous work that does not happen between validation attempts. | Developer |
| D11 | **Motion does not escalate with the wait.** One intensity from minute 2 to hour 6; the honesty already scales in the copy (`validation-status-ux` D1–D5) and a second axis is only noise. | Developer |
| D12 | **The outcome cross-fades in**, calm, at `--duration-slow` (400ms) — the duration already reserved for exactly this. No celebration: the customer's money is confirmed, not applauded. Applies to the rejection too. | Developer |
| D13 | **Reduced motion means no translation, scale or rotation — never no feedback.** An opacity-only breath at low amplitude is permitted, because a frozen waiting screen reads as a dead one. This **amends the blanket rule** at `index.css:127-134`, which today flattens every animation to `0.01ms`. | Developer (agent had suggested keeping the blanket rule and moving the signal into text; overruled) |
| D14 | The vocabulary is **named and covers every feedback state** — waiting, resolving, entering and leaving, retrying — and applies to both surfaces: uploading a receipt, copying a CLABE, saving in admin, validating the transfer. | Developer |
| D15 | Motion tokens get **mapped to utilities and new literals forbidden**. The 15 existing `duration-150` were registered as the debt `unmapped-motion-tokens`. **Superseded 2026-09-09**: the debt is paid *inside* the design-foundations feature (spec FR-020), not on its own schedule — the feature already touches the file where it lives, and the alternative leaves the tree contradicting Principle VI in 15 places. The register entry stays open until its checks pass. | Developer |
| D16 | **The breath is candidate A — opacity `1 → 0.70` over `2.4s`, `--easing-default`, infinite.** Chosen 2026-09-09 without a comparison panel: B is the skeleton's own `animate-pulse`, and a waiting *page* must stay quieter than loading *content*; C's 15% swing at 3s vanishes on a bright phone screen outdoors, and an unseen signal is the failure this feature exists to prevent. The pair is still confirmed by eye before merge (spec FR-019, task T047) — but on the real pending screen, beside the copy it accompanies, not against the other two candidates. Two token values: if the confirmation rejects them it is a one-line edit, which is why gating the feature on deciding them first was withdrawn. | Developer |

## 3. Principles for `/speckit-constitution`

Principle VI exists and is NON-NEGOTIABLE. This is one **amendment** carrying
both runs — six bullets added, none removed, no renumbering. Motion stays in VI
rather than becoming a new principle: VI already rules on reduced motion and on
"minimal purposeful motion", and one subject deserves one home. Version bump:
**1.0.0 → 1.1.0** (MINOR: new rules, existing ones intact).

```markdown
### VI. Visual Foundations (NON-NEGOTIABLE)

<!-- add to the existing bullets -->

- Stacking order is semantic and tokenised: every overlapping surface takes its
  position from the layering scale in `tokens.css`. No raw z-index in a
  component, and no new layer without a name.
- One dimming treatment: every modal surface — dialog, sheet, confirmation —
  renders the same backdrop from `--color-surface-overlay`. A hand-mixed
  translucent black or ink is drift, in either theme.
- `packages/ui` is the single definition of any atom both surfaces render; a
  duplicate recipe in an app is drift. Sizes are declared, not improvised:
  compact (40px, desktop admin), standard (48px touch), decisive (64px).
  Primitives only one surface uses may live in that app, but consume the shared
  tokens and never redefine a value.
- Feedback has a named motion vocabulary: waiting breathes, the outcome
  cross-fades, nothing spins or bounces on the payer's page. Duration and
  easing come from tokens — a literal duration in a component is drift.
- Motion never carries state on its own, and it never escalates: when a wait
  grows, the copy says so and the animation does not.
- Reduced motion removes translation, scale and rotation — never the feedback
  itself. An opacity-only breath at low amplitude is the permitted floor, so a
  screen that is still working never reads as frozen.
```

## 4. Feature description for `/speckit-specify`

```text
Feature: design-foundations. Consolidate the visual system every screen of
Devolada already builds on, close the three places where screens improvise,
and give waiting a language. Users: the developer, every future visual
feature, and the payer who is watching a page while a transfer is validated.
The foundation provides the semantic value set (colour for light and dark,
type ramp, spacing, radii, elevation, motion) and, new here: a named stacking
order for overlapping surfaces; a single dimming treatment shared by every
modal surface; one definition of the atoms both surfaces render — button and
text field — in three sizes (compact for the back office, standard for touch,
decisive for the charge path); and a named vocabulary for feedback states
covering waiting, resolving, entering, leaving and retrying. While a process
is pending, the page breathes calmly rather than spinning, at one intensity
however long the wait lasts; when the outcome arrives — confirmed or refused
— it fades in unhurried rather than snapping or celebrating. Success
criteria: no screen in either surface carries a literal colour, size, spacing,
stacking or duration value; every overlapping surface takes its position from
the named order; modal, sheet and confirmation dim the page identically in
both themes; a button or text field renders from one definition regardless of
surface; a pending process is recognisable as pending without reading a word,
and its state is still stated in words for anyone who cannot see the motion;
with reduced motion requested, nothing translates, scales or rotates and no
pending screen reads as frozen; every text/background pair meets WCAG 2.2 AA
in both themes; the same screen renders at 375, 768 and 1280 with no
horizontal scroll. Out of scope: page layouts, feature components, any change
to the aesthetic direction or the palette, table density, the wording of the
staged waiting copy, marketing pages, illustration, and the internals of
primitives only the back office renders.
```

## 5. Notes for `/speckit-plan`

- **Token format**: CSS custom properties in `packages/ui/src/styles/tokens.css`,
  surfaced as Tailwind utilities through `@theme inline` in
  `packages/ui/src/styles/index.css`. **Extend both; replace neither.** Layer
  and motion values live in `:root` only — neither has a dark variant.
- **Layering**: name the layers semantically (base, dropdown, sticky, overlay,
  modal, toast). Before mapping them, **verify whether Tailwind v4 exposes a
  theme namespace for z-index** in the pinned `tailwindcss ^4.1.0`; if it does
  not, consume the variable at the call site or through a small
  `@layer utilities` block rather than inventing a namespace. The same check
  applies to the animation namespace for the new keyframes.
- **Overlay**: `--color-surface-overlay` and `bg-overlay` already exist, dark
  value included. Replace `bg-black/50` (`dialog.tsx:19`, `sheet.tsx:23`) and
  `bg-ink/40` (`alert-dialog.tsx:20`).
- **Atoms**: extend the `cva` recipe in `packages/ui/src/components/button.tsx`
  with `compact` (D7) and the two variants only admin has (`destructive`,
  `link`); map `default` → `primary`, `outline` → `secondary`. Then delete
  `apps/admin/src/components/ui/{button,input}.tsx` and re-point their call
  sites at `@devolada/ui`. The disabled treatment both files document — a
  different fill, never lowered opacity — survives the merge.
- **Motion, mapping (D15)**: map `--duration-*` and `--easing-*` into
  `@theme inline` so utilities exist, and add the keyframes the vocabulary
  needs. New code consumes them; the 15 existing `duration-150` are **not**
  migrated in this feature — register them with `/speckit-debt-log` first, with
  `packages/ui/src/components/button.tsx` and `apps/admin/src/components/ui/`
  as the entry points.
- **Motion, the waiting pair (D10–D12)**: the breath belongs in `packages/ui`
  as a shared atom, not inside `PaymentPage.tsx` — the same indicator must
  serve upload, save and retry (D14). The outcome reveal uses
  `--duration-slow`; everything else stays at `--duration-fast`. Nothing in the
  vocabulary reads `validationAttempts` (D11): the component takes a pending
  boolean, never the clock.
- **Motion, reduced (D13)**: the blanket block at `index.css:127-134` is
  **amended, not deleted** — keep flattening transform-bearing animation, and
  carve out an opacity-only exception at low amplitude for pending indicators.
  Nothing else gets the exception. `PaymentPage.tsx`'s existing
  `aria-live="polite"` region (l.584) stays as it is; the motion is an
  addition to it, not a replacement.
- **The bridge stays**: `apps/admin/src/styles.css` keeps mapping shadcn's
  semantic variables onto our tokens.
- **Contracts**: deliver the value set as a UI contract under the feature's
  `contracts/` — names and meaning, not hex or milliseconds.
- **Verification**: per D9, **add no new lint**. `contrast-lint` and the e2e
  suites are the gate; cover the new rules with `tests/design/` screenshots and
  review. A reduced-motion case belongs in the e2e suite, which already drives
  a real browser. Every new spec file cites its story (Principle VII).

## 6. Open questions

- ~~`[NEEDS CLARIFICATION: do destructive and link belong in the shared Button,
  or stay admin-only variants — shared/admin-only?]`~~ **Settled 2026-09-09 in
  the merge (T028)**: shared. Leaving them behind would have meant either a
  second recipe for the back office — the thing this feature exists to remove —
  or deleting two variants it uses. The payer's page renders neither, and
  carrying an unused variant in a shared atom costs nothing.
- `[NEEDS CLARIFICATION: do the admin-only primitives eventually move to packages/ui, or is the app the permanent home — move/permanent?]`
  D6 settles today's boundary, not the destination.
- ~~`[NEEDS CLARIFICATION: the breath's amplitude and period — a measured pair,
  or left to the implementer's eye?]`~~ **Settled 2026-09-09 by D16**: the pair
  is candidate A, `1 → 0.70` over `2.4s`, confirmed on the real pending screen
  at T047 rather than in a playground comparison.
- Table density for the admin was raised and declined (D8). It stays live the
  first time a table screen is specified.

---

## 7. What the implementation found (2026-09-09)

Written at T045. Everything here is a deviation from the plan or a fact the
plan assumed wrongly — the parts that went as written are not repeated.

**The breath pair is candidate A, `1 → 0.70` over `2.4s`** (D16), in
`tokens.css` as `--opacity-breath` and `--duration-breath`. **Confirmed on
screen by the developer on 2026-09-09** (T047), from the peak/trough captures in
both themes at a phone width. FR-019 is satisfied: the pair was judged by eye,
beside the copy it accompanies, before merge.

**The debt `unmapped-motion-tokens` is paid** — verified, all 15 anchors gone,
`payment.md` records the evidence. D15 said the register entry stays open until
its checks pass; they pass.

**Three tasks could not be done as written.**

- T003/T004 (the three-candidate playground panel, gating everything) were
  withdrawn: the pair is two token values, reversible in one line, and gating a
  feature on a decision that cheap bought nothing. The looking moved to T047,
  where it happens beside the copy it accompanies.
- T027 asked for a capture of a confirmation opened from an open sheet. The
  product has no such screen — the only sheet holds a calendar. What the picture
  was for is a number, not an image, so the resolved `z-index` is now asserted
  from the live DOM instead.
- T014/T015/T031/T032 named co-located test paths. Every one of this repo's ~30
  test files lives in a package-level `test/`; the tasks were wrong, not the
  repo.

**Two things the plan assumed wrongly.**

- *The review suite is deterministic.* It is not: two runs of identical code
  differ by ~73 px in 1,024,000. T002's sha256 manifest was deleted and replaced
  by `scripts/review-diff.mjs`, a pixel diff with a floor. Two permanent sources
  of difference are now documented — a relative-time label, and hover states
  left behind by the spec's last click.
- *A hover-only change is invisible in a static capture.* It is not, for the
  same reason: the mouse stays where it was clicked.

**One deliberate visual change, on the payer's surface.** The two Button recipes
disagreed about `ghost`: the back office painted a hover fill, the payer's page
did not. The fill won — a text-only button otherwise gives a pointer nothing to
aim at — so ghost buttons on the payer's page now respond to hover. Nothing at
rest moved. Recorded in `contracts/components.md`.

**One cascade trap worth remembering.** The reduced-motion carve-out needs
`!important` on both properties and must follow the blanket rule, because the
blanket rule is itself `!important` and beats specificity. Without it the breath
freezes silently and every screenshot check still passes, since a frozen pending
screen and a working one are pixel-identical. `tests/e2e/motion.spec.ts` asserts
the *computed* duration for exactly this reason; asserting the class proves
nothing about how the cascade resolved.
