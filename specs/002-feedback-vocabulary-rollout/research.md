# Research: feedback-vocabulary-rollout

**Feature**: 002 · **Date**: 2026-09-10 · **Phase**: 0

Every finding below was read out of the code on this branch, at
`d13a951`. Where a claim is "nothing happens", it is proved by an absence
that can be checked in one command, not by looking at a screenshot.

---

## R1 — The waiting movement belongs to the region, not to each bar

**Decision**: `Skeleton` stops animating and becomes a pure shape. The breath is
applied once, by the region that owns the wait.

**Rationale**: the clarify session settled that one waiting movement exists
(spec Clarifications Q2). It did not settle where that movement is attached, and
the two options are not equivalent:

- Per bar, every `Skeleton` carries `animate-breath`. A list with six bars runs
  six animations. They are in phase only while they mount together; a bar that
  mounts a frame later breathes against the others, which is a shimmer nobody
  asked for.
- Per region, the container carries it and the shapes ride along. One animation,
  guaranteed in phase, and FR-003's "the two MUST NOT be applied to the same
  region at once" becomes a property of the component instead of a rule each
  screen has to remember.

Per region also reads correctly against the spec sentence "a placeholder shape
breathes at the shared rhythm": it does, because its container does.

**Alternatives considered**: keeping `animate-pulse` on `Skeleton` and carving it
out of the reduced-motion rule separately (rejected — two rhythms, which Q2
closed); a CSS `animation-delay` chain to force the bars into phase (rejected —
fragile, and it treats a symptom of the wrong attachment point).

---

## R2 — The flash threshold needs the shape rendered but invisible

**Decision**: `Pending` gains an optional `shape` prop. Below the threshold the
shape renders with `visibility: hidden`; past it, the shape becomes visible and
the region breathes and announces.

**Rationale**: FR-015 asks for two things that pull against each other — show
nothing before the threshold, and hold the space content will occupy. `display:
none` satisfies the first and breaks the second; the page jumps when the shape
arrives. `visibility: hidden` satisfies both: the box is laid out, painted
nothing, and is out of the accessibility tree.

Today's `Pending` renders children immediately and delays only the signal, which
is right for the payer's submit button — the button must stay usable while the
region waits. It is wrong for a list, where the skeletons *are* the signal and
must not appear before the threshold. That difference is real, so it earns a
prop rather than a second component: same state, same threshold, same
announcement, same breath, one file to change when the threshold moves.

Every existing call site keeps working untouched, because `shape` is optional
and its absence is today's behaviour exactly.

**Alternatives considered**: a separate `PendingRegion` component (rejected — two
components that share a timing constant will drift apart, which is the class of
bug this whole feature exists to remove); exporting the timing as a hook and
letting each screen assemble it (rejected — ten call sites each rebuilding the
same three-line dance).

---

## R3 — `retrying` has no treatment of its own

**Decision**: the vocabulary keeps five names and gains four treatments.
`retrying` is implemented *as* `waiting`, not beside it.

**Rationale**: this falls straight out of Clarifications Q3. US3 asks that a
retry be indistinguishable from a first attempt; the strongest way to guarantee
that is for there to be nothing separate to distinguish. A `retrying` treatment
that merely happens to look like `waiting` today is one refactor away from
looking different.

This is worth stating plainly because `001-design-foundations` named five states
and this feature was chartered to "implement the remaining three". Three are
implemented; one of them is implemented by pointing at an existing treatment.
That is a complete implementation of the state, not a dropped requirement.

---

## R4 — Arriving and departing are opacity keyframes, and are deliberately NOT
carved out of reduced motion

**Decision**: add `--animate-enter` and `--animate-leave` to the theme, each an
opacity-only keyframe. Attach them with Radix's own `data-[state=open]` /
`data-[state=closed]` selectors. Do **not** give them `data-motion` attributes,
and do **not** add them to the reduced-motion exception.

**Rationale**: three separate points.

*Why Radix's data attributes work for departure.* Radix keeps a closing node
mounted while a CSS animation is running on it — `Presence` reads the computed
`animation-name`, sees it change when state flips to `closed`, and waits for
`animationend` before unmounting. So a departure needs no `forceMount` and no
state of our own; it needs a keyframe whose name differs from the opening one.
`enter` and `leave` differ.

*Why no `data-motion`.* That attribute exists in this codebase for exactly one
purpose: it is what the reduced-motion exception in `index.css` matches on.
Putting it on an element that is not carved out would invite the next reader to
believe it does something. Enter and leave are asserted through their computed
`animation-name`, the same way `tests/e2e/motion.spec.ts` already asserts the
breath.

*Why no exception.* FR-014 requires **pending** treatments to keep moving, and
the reason is specific: a frozen waiting screen reads as a dead one, and the
person is waiting on money. An arrival is not that. Under reduced motion the
blanket rule flattens both keyframes to 0.01ms, the surface appears and
disappears at once, and `animationend` still fires so Radix still unmounts.
Instant is a fine answer for a dialog; frozen is not a fine answer for a wait.
The distinction is the whole reason the exception is narrow.

**Durations**: `enter` takes `--duration-normal` (250ms), `leave` takes
`--duration-fast` (150ms). Leaving faster than arriving is the ordinary
convention — nobody wants to wait to dismiss something — and both come from the
existing scale, so FR-009 holds.

**Alternatives considered**: one duration for both (rejected — a 250ms dismissal
feels sticky); carving enter/leave out of reduced motion for symmetry with the
breath (rejected on the reasoning above — the exception is narrow on purpose,
and widening it without a reason weakens the argument for the part that needs
it).

---

## R5 — The inert decoration is exactly one, and it is provable

**Decision**: FR-007's "arrival treatment that does nothing" is
`apps/admin/src/components/ui/dialog.tsx:19` —
`data-[state=open]:animate-in data-[state=open]:fade-in-0` on the dialog
overlay. It is replaced by the real `animate-enter`, not deleted.

**Rationale**: those utilities come from `tailwindcss-animate`, which is not
installed. Not in any workspace manifest, and `index.css` carries no `@plugin`
directive — so Tailwind emits no rule for either class and the overlay appears
instantly. This is provable by absence in one grep rather than by staring at a
screenshot, which matters because an animation that does nothing and an
animation that is very fast are indistinguishable to the eye.

The other four surfaces — `alert-dialog`, `sheet`, `popover`, `select` — carry no
arrival treatment at all, inert or otherwise. So the count of inert decorations
is one, and the count of surfaces that need one built is five.

---

## R6 — One real leak of "a wait nobody started", and it belongs to the atom

**Decision**: `ListError` stops taking `retrying` as a prop and derives it from
the click instead, by awaiting whatever `onRetry` returns.

**Rationale**: all eight `isRefetching` call sites in the back office feed
`ListError.retrying`. `apps/admin/src/main.tsx:8` builds `new QueryClient()` with
no options, so TanStack's defaults apply: `refetchOnWindowFocus: true` and
`staleTime: 0`. An errored query refetches when the tab regains focus, which
turns `isRefetching` true without anyone clicking, which makes the retry button
read "Cargando…" and spin. That is precisely FR-001's MUST NOT, live today.

Fixing it at the eight call sites means eight chances to get it wrong again.
Fixing it in the atom deletes the prop, and with it the whole category. The
signature widens from `() => void` to `() => void | Promise<unknown>`; every
current call site already hands back a promise from `refetch()` and only needs
its `void` operator dropped.

**Alternatives considered**: configuring `refetchOnWindowFocus: false` globally
(rejected — that is a data-freshness decision with nothing to do with this
feature, and it would hide the bug rather than fix it); passing a
click-scoped boolean from each screen (rejected — same eight chances).

`feed.isFetchingNextPage` is *not* this bug: "Cargar más" is a click, so its
wait is one the operator started.

---

## R7 — Announcement needs no new machinery

**Decision**: no product-wide announcer. `Pending`'s existing `announce` prop
plus a per-region label is the whole mechanism.

**Rationale**: Clarifications Q4 split announcements by who started the wait,
which maps exactly onto the API `001-design-foundations` already shipped —
`announce` defaults to true and a nested region passes `false`, which is why the
payer's in-card button passes `announce={false}` today. A screen's load gets one
`Pending` naming what loads ("Cargando los cobros"); an action gets a `Pending`
at its control. Nothing else is needed, and the spec's own assumption already
declines a global announcer.

`Skeleton` keeps `aria-hidden`. It was correct for its original reason — the
region announces once instead of once per bar — and R1 makes the region's
ownership structural rather than conventional.

---

## R8 — The size vocabulary has two offenders, not one

**Decision**: US4 covers `StatusBadge`'s `sm` / `md`, and also the hard-coded
`h-10 px-4 text-sm` on `ListError`'s retry button.

**Rationale**: FR-011 forbids a component declaring size names of its own;
`StatusBadge` is the only one that does. But User Story 4 scenario 1 says a
screen that asks for a size must *name a context*, and `ListError` states a
height instead — the exact thing the data model's "a screen picks a size, it
does not pass a height" rule exists to stop. It is one line, it is inside a file
this feature already opens for R6, and leaving it would mean shipping a feature
about size vocabulary past a size literal.

**Mapping**: `sm` → `compact`, `md` → `standard`. Values unchanged (FR-012), so
`decisive` is not offered — a badge has no committing-action context (FR-013).
Six payer call sites and one showcase call site pass `size="md"` and become
`size="standard"`; back-office call sites pass nothing and keep the default,
which is renamed under them.

**A related defect found while reading**: `StatusBadge` builds its class string
by template concatenation rather than through `cn`, so a caller's `className`
cannot override a conflicting utility — it loses to whichever rule the
stylesheet emits last. It is not what US4 asks for, and this plan does not fold
it in. It is worth a debt entry.
