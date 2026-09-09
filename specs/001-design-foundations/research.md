# Phase 0 Research: design-foundations

**Date**: 2026-09-09 · **Feature**: [spec.md](./spec.md)

Three unknowns entered this phase. Two came from `.specify/design/foundations.md`
§5, which explicitly refused to guess them; one is the reduced-motion value the
spec deferred to planning (FR-019).

---

## R1 — Does the pinned Tailwind expose theme namespaces for stacking, duration, easing and animation?

**Decision**: Yes, all four — but **not under the names a guess would produce**.
The mapping is done entirely through `@theme`, with no custom utility layer and
no arbitrary values.

| What we need | Theme key Tailwind actually reads | Utility it produces |
| --- | --- | --- |
| Stacking position | `--z-index-*` | `z-modal`, `z-overlay`, … |
| Duration | `--transition-duration-*` | `duration-fast`, `duration-slow`, … |
| Easing | `--ease-*` | `ease-default`, `ease-out`, … |
| Named animation | `--animate-*` | `animate-breath` |

**Rationale**: read from the published package, not from memory. The version
resolved in `pnpm-lock.yaml` is **4.3.3** (the manifest range is `^4.1.0`, so
foundations §5's "4.1" was the floor, not the pin). Its `theme.css` declares the
namespaces `--animate-*, --aspect-*, --blur-*, --breakpoint-*, --color-*,
--container-*, --default-*, --drop-*, --ease-*, --font-*, --inset-*, --leading-*,
--max-*, --perspective-*, --radius-*, --shadow-*, --text-*, --tracking-*`, and
its compiled utilities resolve `z-*` from `themeKeys: ["--z-index"]` and
`duration-*` from `["--transition-duration"]`, falling back to a bare number as
milliseconds.

Note the asymmetry this creates, because it is the trap: our value is
`--duration-fast`, and the key Tailwind reads is `--transition-duration-fast`.
The `@theme` entry bridges them (`--transition-duration-fast: var(--duration-fast)`).
Neither name can be dropped.

**Alternatives considered**:
- *Arbitrary values* (`z-[var(--z-modal)]`, `duration-(--duration-fast)`) —
  works, but leaves the value invisible to anyone reading the theme and keeps
  the call sites noisy. Rejected: a named namespace exists.
- *A hand-written `@layer utilities` block* — the fallback foundations §5
  prescribed if no namespace existed. Not needed.

---

## R2 — Two theme defaults make most of the duration migration a deletion

**Decision**: Bind Tailwind's own transition defaults to our tokens:
`--default-transition-duration: var(--duration-fast)` and
`--default-transition-timing-function: var(--easing-default)`. Then remove the
15 `duration-150` literals rather than rewriting them.

**Rationale**: `theme.css` declares `--default-transition-duration: 150ms` and
`--default-transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1)`. Every
`transition-*` utility falls back to those when no `duration-*` is present. Two
facts follow:

1. Tailwind's default timing function is **byte-identical** to our
   `--easing-default`. The token was not merely unmapped; it was silently
   correct all along. The same holds for the other two: our `--easing-in` and
   `--easing-out` match Tailwind's `--ease-in` and `--ease-out` exactly. So the
   easing half of the "dead tokens" was dead *and* redundant — which is why the
   contract overrides those two names rather than inventing new ones: identical
   rendering today, and the curve pinned to `tokens.css` if a future Tailwind
   revises its defaults.
2. Because the default duration is also 150ms, `transition-colors duration-150`
   and bare `transition-colors` render identically **today**. So the 15 literals
   can be deleted, and once the default is bound to `--duration-fast` those call
   sites follow the token from then on.

This turns the debt (FR-020, SC-012) from 15 rewrites into 15 deletions plus two
`@theme` lines — and, unlike a rewrite, it cannot drift again: there is nothing
left at the call site to drift.

**Alternatives considered**:
- *Rewrite each site as `duration-fast`* — explicit at every call site, but 15
  places to keep correct and a wider diff. Rejected in favour of the deletion,
  which is strictly smaller and ends with the same rendering.
- *Leave the defaults alone and only map the namespace* — would keep bare
  `transition-*` on Tailwind's 150ms rather than ours, so editing
  `--duration-fast` still would not govern those transitions. That is the
  original bug, half-fixed. Rejected.

---

## R3 — How far and how slowly may a pending screen breathe under reduced motion?

**Decision**: The breath is an **opacity-only** animation, and the pair is
**candidate A** — `opacity: 1 → 0.7`, 2.4s, `--easing-default`, infinite
(developer decision, 2026-09-09, superseding this section's original
"settle it in a playground panel first"). FR-019's requirement that the pair be
judged by eye stands, but it is answered on the real pending screen at T047,
where the animation sits beside the copy it accompanies, instead of in a
three-swatch comparison that gated every other task. The values are two tokens:
if T047 rejects them, that is a one-line edit, which is why gating on them
up front bought nothing. Under `prefers-reduced-motion`, the same
animation runs unchanged — that is the whole point of choosing opacity.

| Candidate | Amplitude | Period | Reads as |
| --- | --- | --- | --- |
| A (start here) | 1 → 0.70 | 2.4s | Present but unhurried |
| B | 1 → 0.50 | 2.0s | Tailwind's own `animate-pulse`; more insistent |
| C | 1 → 0.85 | 3.0s | Very quiet; risks being missed on a bright screen |

**Rationale**: opacity is not a vestibular trigger — the criterion behind
`prefers-reduced-motion` is motion, and the constitution's amended bullet
(v1.1.0) names translation, scale and rotation as what must go. Opacity also
animates on the compositor, so the breath costs nothing on a low-end phone,
which is the device the payer is holding. Candidate B is the existing
`animate-pulse` (`50% { opacity: .5 }`, 2s, `cubic-bezier(.4,0,.6,1)`), already
used by the skeleton; starting one step gentler than the skeleton keeps the
pending *page* quieter than pending *content*, which is the right hierarchy.

**Alternatives considered**:
- *Never looking at all* — still rejected. FR-019 is right that the difference
  between calm and distracting is not decidable in a document; what changed is
  only *when* and *where* the looking happens, not *whether*.
- *The three-candidate playground panel, up front* — rejected 2026-09-09 as
  cost without a matching risk. It compared the candidates against each other,
  which is not the question; the question is how one of them reads next to the
  waiting copy on a phone.
- *A separate, quieter animation under reduced motion* — two animations to keep
  in agreement, and the reduced one would be the one nobody reviews. Rejected;
  one animation that is already safe is better than two that must be kept safe.

---

## R4 — How the blanket reduced-motion rule is amended

**Decision**: Keep the existing blanket flattening and re-enable exactly one
thing after it, addressed by a data attribute the breath carries. Nothing else
in the product gains an exception.

**Rationale**: `packages/ui/src/styles/index.css` flattens every animation and
transition to `0.01ms` under `prefers-reduced-motion`. Deleting that rule would
expose every future animation by default — the opposite of the constitution's
intent. Re-enabling one attributed element keeps the default deny and makes the
exception greppable, which is how a reviewer finds it later.

**Alternatives considered**:
- *Removing the blanket rule and annotating each animation* — inverts a safe
  default into an unsafe one. Rejected.
- *A `:not()` selector on the universal rule* — same effect, but pushes the
  exception into a selector nobody reads. Rejected for the explicit re-enable,
  which states the exception on its own line.
