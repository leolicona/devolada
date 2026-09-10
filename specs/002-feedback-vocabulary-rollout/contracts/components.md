# Contract: components

**Feature**: feedback-vocabulary-rollout · **Package**: `@devolada/ui` and
`apps/admin/src/components/ui/`

## `Pending` (extended)

One new optional prop. Every existing call site keeps working untouched, because
its absence is today's behaviour exactly.

| Prop | Type | Change |
| --- | --- | --- |
| `active` | `boolean` | unchanged |
| `label` | `string` | unchanged |
| `announce` | `boolean` | unchanged |
| `shape` | `ReactNode` | **new**. The placeholder this region promises while it waits |
| `children` | `ReactNode` | unchanged |

**Guarantees**

- Without `shape`: children render immediately and only the signal waits out the
  threshold. This is what the payer's submit button needs — the button must stay
  on screen and usable while the region waits.
- With `shape`: the shape replaces the children while `active`. Below the
  threshold it is laid out but not painted (`visibility: hidden`), so the space
  is held and nothing jumps when it appears (FR-015).
- The breath, the paint and the announcement start on the same schedule. A
  region never breathes silently, and never speaks while invisible.
- One movement per region. The shape does not animate on its own (research R1).
- The threshold and the minimum visible time stay where they are, as the single
  pair of constants in `pending.tsx`. This prop exists so there is one of them,
  not two.

## `Skeleton` (changed)

**Removes** `animate-pulse`. Keeps `aria-hidden`, the token fill and the rounding.

A shape's job is to promise a layout. The movement belongs to the region that
owns the wait, which is what makes "the two are never applied to the same region
at once" (FR-003) a property of the code rather than a rule to remember.

> This also closes a live defect. The reduced-motion exception names
> `[data-motion="breath"]` and `[data-motion="reveal"]`; `animate-pulse` matched
> neither, so the blanket rule flattened it and every skeleton froze for anyone
> who asked for less motion — a dead grey block where the constitution requires
> a screen that still reads as working. Under the region's breath it is covered.

## `ListError` (changed)

| Prop | Change |
| --- | --- |
| `what` | unchanged |
| `onRetry` | `() => void` → `() => void \| Promise<unknown>` |
| `retrying` | **removed** |
| `className` | unchanged |

**Guarantees**

- The component derives its own waiting state by awaiting what `onRetry`
  returns. A retry is running when the operator clicked, and at no other time.
- The turning icon is gone (FR-008). The retry waits the way every other action
  waits: the region breathes, the word stays "Cargando…".
- The button names a size (`compact`) instead of stating a height. The
  `h-10 px-4 text-sm` literal goes with the prop.

**Why the prop is removed rather than fixed at the call sites.** All eight of
them pass `isRefetching`, which TanStack sets true when an errored query
refetches on window focus — a wait nobody started, showing a signal, which is
what FR-001 forbids. Deleting the prop deletes the category; fixing eight call
sites leaves eight chances to reintroduce it. See research R6.

## `StatusBadge` (changed)

**Sizes**: `sm` → `compact`, `md` → `standard`. No `decisive`: a badge has no
committing-action context, and a member with no context is left out rather than
filled in for symmetry (FR-013).

**Guarantee — nothing moves.** The names change; the padding, the type scale and
the icon size do not (FR-012). A badge is read, never aimed at, so it carries no
touch-target obligation and takes the vocabulary's names without its heights.
The review captures are the proof (SC-010).

**Call sites**: six on the payer's page and one in the showcase pass `size="md"`
and become `size="standard"`. Back-office call sites pass nothing and keep the
default, renamed underneath them.

## Overlay surfaces (changed)

`dialog` · `alert-dialog` · `sheet` · `popover` · `select`

Each content element and each dimming backdrop gains:

```
data-[state=open]:animate-enter data-[state=closed]:animate-leave
```

**Guarantees**

- One definition, shared. No surface writes its own duration, curve or keyframe
  (FR-005, FR-009).
- The backdrop and the surface carry the same pair, so they never separate
  mid-flight.
- The dialog overlay's `data-[state=open]:animate-in data-[state=open]:fade-in-0`
  is **replaced**, not deleted. Those utilities come from `tailwindcss-animate`,
  which is not installed in this repo, so they have always emitted nothing
  (research R5). FR-007 asks that an inert decoration be given a working
  treatment or removed; this one gets the working treatment.
- Nothing translates, scales or rotates. A surface that slides would break FR-006
  and would make the reduced-motion decision in the motion contract indefensible.

## What this contract does not touch

- The wording of any pending state. This feature adds no copy and changes none.
- `Reveal`, and the payer's waiting and outcome treatments.
- Any inline element's unmount. A collapsible, a tab panel and a table row are
  removed without a departure treatment.
- `StatusBadge`'s class composition. It concatenates strings instead of merging
  through `cn`, so a caller's `className` cannot override a conflict. That is
  real, it is not what User Story 4 asks for, and it belongs in the debt
  register rather than in this feature.
