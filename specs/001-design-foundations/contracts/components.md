# Contract: shared components

**Feature**: design-foundations · **Package**: `@devolada/ui`

## `Pending` (new)

The `waiting` feedback state. Wraps or marks the region that is pending.

| Prop | Type | Meaning |
| --- | --- | --- |
| `active` | `boolean` | Whether the region is pending. Nothing else — no elapsed time, no attempt count (FR-017) |
| `label` | `string` | The state in words, for assistive technology (FR-011) |
| `announce` | `boolean` | Whether `Pending` owns the announcement. `false` when the caller already has a live region |
| `children` | `ReactNode` | The region that breathes |

**Guarantees**

- Renders `data-motion="breath"` and the `animate-breath` utility while
  `active`; neither when idle.
- Announces `label` through its own polite live region when `announce` is true,
  and stays silent when it is false. The choice is a prop, not a guess: the
  payer's page already owns a live region at `PaymentPage.tsx:584` and must not
  gain a second, so it passes `announce={false}` (FR-011, spec Assumptions).
- Does not appear before the flash threshold (~200ms) and, once shown, stays
  long enough to be read (FR-014).
- Applies no transform, ever. The reduced-motion exception is only sound while
  this holds.

## `Reveal` (new)

The `resolving` feedback state. Identical for a confirmation and a refusal.

| Prop | Type | Meaning |
| --- | --- | --- |
| `children` | `ReactNode` | The outcome |

**Guarantees**

- Fades in over `--duration-slow` with `--easing-default`. No scale, no
  translate, no overshoot (FR-012).
- Under reduced motion the fade still runs — opacity is permitted — but it may
  not become a movement.
- Carries no tone: colour and words distinguish good news from bad.

## `Button` (merged)

One definition, replacing `apps/admin/src/components/ui/button.tsx`.

**Sizes**: `compact` (40px) · `standard` (48px, default) · `decisive` (64px, full width)

**Variants**: `primary` · `secondary` · `ghost` · `destructive` · `link`

| Back office name today | Becomes |
| --- | --- |
| `default` | `primary` |
| `outline` | `secondary` |
| `ghost` | `ghost` |
| `destructive` | `destructive` |
| `link` | `link` |

**Guarantees**

- Disabled is a different fill, never lowered opacity — the rule both current
  files independently document, and it survives the merge.
- `decisive` keeps today's size and full width.
- `compact` is not used on the payer's surface (data-model: Control size).

## `Input` / `Field` (merged)

One definition, replacing `apps/admin/src/components/ui/input.tsx`. Keeps the
shared version's `Field` wrapper (label, hint, error) and the 48px standard
height, gaining `compact` for the back office.

**Guarantee**: the input border stays `--color-border-input`, the one border
deliberately darker than the card edge so a control is findable (WCAG 1.4.11) —
documented in `tokens.css` and not weakened by the merge.
