# Contract: design tokens

**Feature**: design-foundations · **Consumers**: `apps/pago`, `apps/admin`, and
every future screen.

The contract is the **name and its meaning**. Values are shown because a
reviewer needs something to check against, but a consumer depends on the name.
Everything lives in `packages/ui/src/styles/tokens.css` and reaches Tailwind
through the existing `@theme inline` block in `index.css`.

## 1. Stacking (new)

Declared in `:root` only — stacking has no theme variant.

| Token | Value | Theme key it maps to | Utility |
| --- | --- | --- | --- |
| `--z-base` | `0` | `--z-index-base` | `z-base` |
| `--z-sticky` | `10` | `--z-index-sticky` | `z-sticky` |
| `--z-dropdown` | `20` | `--z-index-dropdown` | `z-dropdown` |
| `--z-overlay` | `30` | `--z-index-overlay` | `z-overlay` |
| `--z-modal` | `40` | `--z-index-modal` | `z-modal` |
| `--z-toast` | `50` | `--z-index-toast` | `z-toast` |

> The theme key is **not** `--z-*`. Tailwind 4.3.3 resolves the `z-*` utility
> from `--z-index-*` (research R1). Both names are required: ours is the value,
> theirs is the bridge.

## 2. Motion (existing tokens, newly reachable)

The seven tokens already in `tokens.css` are unchanged. What is new is that
they now reach the utilities.

| Existing token | Theme key it maps to | Utility |
| --- | --- | --- |
| `--duration-instant` (50ms) | `--transition-duration-instant` | `duration-instant` |
| `--duration-fast` (150ms) | `--transition-duration-fast` | `duration-fast` |
| `--duration-normal` (250ms) | `--transition-duration-normal` | `duration-normal` |
| `--duration-slow` (400ms) | `--transition-duration-slow` | `duration-slow` |
| `--easing-default` | `--ease-default` | `ease-default` |
| `--easing-in` | `--ease-in` (override) | `ease-in` |
| `--easing-out` | `--ease-out` (override) | `ease-out` |

> All three of our curves are **byte-identical** to Tailwind's own
> (`--ease-in`, `--ease-out`, `--ease-in-out`; research R2). Overriding the two
> that share a name therefore changes nothing on screen — it exists so the curve
> is pinned to `tokens.css` rather than to a dependency that could revise its
> defaults in a future release. `--ease-default` is a new name because ours
> carries the meaning "the project's default", which `ease-in-out` does not.

**Two defaults are bound to our tokens**, which is what makes a bare
`transition-colors` obey the design system:

| Tailwind default | Bound to |
| --- | --- |
| `--default-transition-duration` | `var(--duration-fast)` |
| `--default-transition-timing-function` | `var(--easing-default)` |

**Consequence for consumers**: a component that wants the standard 150ms
transition writes `transition-colors` and nothing else. Writing `duration-150`
is drift (constitution VI); writing `duration-fast` is correct but redundant at
the default.

## 3. The breath (new)

| Token | Value | Purpose |
| --- | --- | --- |
| `--duration-breath` | `2400ms` | The period of the pending animation (research R3, candidate A) |
| `--opacity-breath` | `0.7` | The floor the breath descends to |
| `--animate-breath` | `breath var(--duration-breath) var(--easing-default) infinite` | Theme key `--animate-breath`, utility `animate-breath` |

**The pair is settled: candidate A, `1 → 0.70` over `2.4s`** (developer decision,
2026-09-09). Candidate B is Tailwind's own `animate-pulse`, which the skeleton
already uses — the waiting *page* must stay quieter than loading *content*, or
the hierarchy inverts. Candidate C's 15% swing at 3s disappears on a bright
phone screen outdoors, which is where the payer is standing, and an unseen
signal is the exact failure this feature exists to prevent. A sits one step
below the skeleton: present without insisting.

**Confirmed on screen 2026-09-09 (T047)**, from the peak/trough captures in
both themes at a phone width — `review-foundations-breath-{peak,trough}-375-*`.
The pair ships unchanged. Moving it later is still a one-line edit here and in
`tokens.css`: no component, test or contract depends on the values, only on the
names.

Keyframes `breath` animate **opacity only**: `50% { opacity: var(--opacity-breath) }`.
No transform of any kind may enter these keyframes — that is the property the
reduced-motion exception rests on (FR-013).

## 3b. The outcome's cross-fade (new)

Added during implementation and **recorded here 2026-09-09 (converge F3)**: it
shipped in `index.css` without ever reaching this contract, which is precisely
how a token becomes invisible to the next reader. The contract is the name and
its meaning; a name that lives only in a stylesheet has neither.

| Token | Value | Purpose |
| --- | --- | --- |
| `--animate-reveal` | `reveal var(--duration-slow) var(--easing-default) both` | Theme key `--animate-reveal`, utility `animate-reveal` |

Keyframes `reveal` animate **opacity only**: `from { opacity: 0 }`. `both` as the
fill mode, so the element starts invisible instead of flashing at full strength
for one frame before the animation takes hold.

Both `breath` and `reveal` are re-enabled by name under
`prefers-reduced-motion`, and that carve-out is only defensible while neither
moves — see §7.

## 3c. The reduced-motion carve-out (contract, not decoration)

Two rules in `index.css`, inside the existing `@media (prefers-reduced-motion:
reduce)` block and **after** the blanket flattening:

| Selector | Declares | Why |
| --- | --- | --- |
| `[data-motion="breath"]` | `animation-duration: var(--duration-breath) !important`, `animation-iteration-count: infinite !important` | The wait must not read as frozen |
| `[data-motion="reveal"]` | `animation-duration: var(--duration-slow) !important` | The answer must not appear with no transition at all |

`reveal` deliberately declares **no** iteration count: the blanket rule already
pins it to 1, and copying the breath's `infinite` would loop the outcome fading
in forever.

Both `!important`s on the breath are load-bearing. The blanket rule is itself
`!important`, which beats specificity, so dropping either keyword leaves the
breath silently frozen while every screenshot check still passes.

## 4. Dimming (existing token, newly used)

`--color-surface-overlay` and its utility `bg-overlay` already exist, with a
value for each theme. This feature changes nothing about them; it makes the
three modal surfaces use them (FR-003), replacing `bg-black/50` in two files
and `bg-ink/40` in a third.

## 5. The reduced-motion exception

The blanket rule in `index.css` stays. One exception is added after it:

```text
@media (prefers-reduced-motion: reduce) {
  … existing blanket flattening …
  [data-motion="breath"] { animation runs at its declared duration }
}
```

`data-motion="breath"` is part of this contract: it is the only value the
attribute takes, and only the pending atom sets it. A second exception requires
amending this contract and the constitution bullet behind it.
