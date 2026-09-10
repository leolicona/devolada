# Contract: motion

**Feature**: feedback-vocabulary-rollout · **Files**:
`packages/ui/src/styles/index.css`, `packages/ui/src/styles/tokens.css`

This feature introduces **no new value**. Every duration and curve below already
exists in `tokens.css`; what is new is two keyframes and two theme entries that
put existing values to work (FR-009).

## 1. Theme entries (new)

```css
@theme inline {
  /* Arriving and departing. One definition each, shared by every surface
     (FR-005). Leaving is faster than arriving because nobody wants to wait
     to dismiss something (research R4). */
  --animate-enter: enter var(--duration-normal) var(--easing-default) both;
  --animate-leave: leave var(--duration-fast) var(--easing-default) both;
}
```

Utilities produced: `animate-enter`, `animate-leave`.

**Guarantee**: no new token is added to `tokens.css` by this feature. If a
duration here needs changing, the value it points at is the thing to change, and
`contrast-lint` and the review captures still measure the same file.

## 2. Keyframes (new)

```css
@keyframes enter { from { opacity: 0; } }
@keyframes leave { to   { opacity: 0; } }
```

**Guarantee — opacity only.** No transform may enter either keyframe: no scale,
no translate, no rotation, in either theme (FR-006). This is not a stylistic
preference. It is what makes §4 defensible, and it is the same rule the breath
and the reveal already carry.

## 3. Keyframes (removed)

`animate-pulse` leaves `Skeleton`. It is Tailwind's own keyframe — a 2s dip to
50% on a curve of its choosing, none of it from `tokens.css` — and it was the
product's second waiting rhythm (spec Clarifications Q2). The shape stops
animating; the region that owns it breathes instead (research R1).

`animate-spin` leaves `ListError`. It was the third (Clarifications Q3).

After this feature the product emits **one** waiting movement.

## 4. Reduced motion

The exception in `index.css` stays exactly as narrow as it is. It is extended
by nothing.

| Movement | Under `prefers-reduced-motion: reduce` |
| --- | --- |
| `breath` | keeps running, unchanged — carved out today |
| `reveal` | keeps running, once — carved out today |
| `enter` | flattened to 0.01ms. The surface appears at once |
| `leave` | flattened to 0.01ms. The surface disappears at once |

**Why enter and leave are not carved out.** FR-014 requires a *pending*
treatment to keep moving, because a frozen waiting screen reads as a dead one
and the person is waiting on money. An arrival is not that: instant is a fine
answer for a dialog. Widening the exception without that reason would weaken the
argument for the part that needs it.

**Guarantee — departure still completes.** Radix keeps a closing node mounted
until `animationend`. At 0.01ms that event fires almost immediately, so the
surface still unmounts; it does not hang, and it does not need `forceMount`.
A test must prove this, because a surface that never unmounts is invisible in a
still screenshot and fatal in use.

**Guarantee — no `data-motion` on enter or leave.** That attribute exists in
this codebase for one purpose: it is the selector the exception matches on.
Putting it where nothing is carved out would tell the next reader something
false. Enter and leave are asserted through their computed `animation-name`,
the way `tests/e2e/motion.spec.ts` already asserts the breath.

## 5. What a test must measure

> Two rows below were corrected on 2026-09-10, both because the first version
> would have passed while proving nothing.
>
> **"computed `transform` is `none`"** is wrong, and wrong in the direction that
> hides a defect: the dialog centres itself with `-translate-x-1/2`, so its
> transform is never `none` and the assertion fails on a surface behaving
> perfectly. Worse, a page-wide version of it fails for a reason unrelated to
> FR-006 — the charge row is a Collapsible whose chevron rotates on expand. What
> FR-006 forbids is a transform *inside the arrival*, so the check reads the
> keyframes at the source.
>
> **The `pulse`/`spin` check must visit the state it guards.** The first version
> loaded a page where no retry was running; restoring `animate-spin` on
> ListError's icon left it green, because that class only exists while retrying.
> An absence check that never enters the state it names reports a safety it has
> not looked for.

Every assertion here is on **computed style**, never on a class name. The trap
`001-design-foundations` documented still holds: the blanket reduced-motion rule
is `!important`, so a rule that loses to it fails silently while every class
assertion and every screenshot stays green.

| Claim | Measured as |
| --- | --- |
| A surface fades in | computed `animation-name` on open is `enter` |
| A surface fades out and leaves | `animation-name` is `leave` on close, and the node is gone afterwards |
| Nothing moves | the `enter` and `leave` keyframes animate `opacity` and nothing else, read from the stylesheet |
| The breath survives reduced motion | computed `animation-duration` is `2.4s`, not `1e-05s` |
| Enter and leave do not survive it | computed `animation-duration` is `1e-05s` |
| One waiting movement exists | no computed `animation-name` of `pulse` or `spin` anywhere, **while a retry is actually running** |
