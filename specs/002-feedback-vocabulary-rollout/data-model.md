# Data Model: feedback-vocabulary-rollout

**Feature**: 002 · **Date**: 2026-09-10 · **Phase**: 1

This feature stores nothing. The entities below are the vocabulary the code
speaks: what a screen may name, and what each name is allowed to mean.

---

## Feedback state

The closed set `001-design-foundations` defined. **Five names, four treatments.**

| State | Treatment | Where it lives |
| --- | --- | --- |
| `waiting` | the breath, opacity only, `--duration-breath` | `Pending` |
| `resolving` | the cross-fade, `--duration-slow` | `Reveal` |
| `entering` | opacity 0 → 1, `--duration-normal` | `--animate-enter` on a surface |
| `leaving` | opacity 1 → 0, `--duration-fast` | `--animate-leave` on a surface |
| `retrying` | **`waiting`, unchanged** — no treatment of its own | `Pending` (research R3) |

**Rules**

- No sixth state. A screen that needs something else has found a spec gap, not a
  styling problem.
- `retrying` is not a synonym kept for tidiness: it is the guarantee US3 asks
  for. If it ever gains a treatment of its own, a retry can stop looking like a
  first attempt without anyone editing US3.
- Exactly one of these movements is carved out of reduced motion, and it is the
  breath. See *Motion contract*.

---

## Pending region

The unit FR-001 and FR-002 operate on: one region, one wait, one announcement.

| Field | Meaning |
| --- | --- |
| `active` | Whether the wait is running. Nothing else — no elapsed time, no attempt count (FR-010) |
| `label` | What is waiting, in es-MX, for anyone who cannot see the movement |
| `announce` | Whether this region owns the announcement, or defers to one outside it |
| `shape` | The placeholder the region promises, when its content has a known shape |

**Lifecycle**

```text
idle ──active──▶ withheld ──threshold elapsed──▶ visible ──┐
 ▲                   │                                      │
 │                   │ resolved before the threshold        │ resolved
 │                   ▼                                      ▼
 └───────────────  idle  ◀────minimum visible elapsed──── holding
```

- **withheld**: the wait is running and nothing is shown. If `shape` is given it
  is laid out but not painted, so the space is held and the page will not jump
  (FR-015).
- **visible**: the region breathes, the shape is painted, and the label is
  announced — all three start together, on the same schedule.
- **holding**: the wait finished, but not enough time has passed to read the
  signal. It stays until it can be read, then leaves.
- A wait that resolves in **withheld** leaves no trace at all (SC-014).

**Rules**

- A region either promises a shape or shows the bare breath. Never both at once
  (FR-003).
- A region nested inside one that already announces stays silent (FR-002).
- A wait nobody started never becomes a region at all (FR-001). In this codebase
  that means a query's first load and an operator's click, never a background
  refetch — see research R6 for the one place that is currently wrong.

---

## Overlay surface

Anything that renders over the page and is dismissed as a unit.

| Surface | File | Arrives today | Departs today |
| --- | --- | --- | --- |
| Dialog | `apps/admin/src/components/ui/dialog.tsx` | inert decoration | no |
| Alert dialog | `…/alert-dialog.tsx` | no | no |
| Sheet | `…/sheet.tsx` | no | no |
| Popover | `…/popover.tsx` | no | no |
| Select | `…/select.tsx` | no | no |

**Rules**

- Every surface arrives with `entering` and departs with `leaving`, and its
  dimming backdrop does the same, so the two never separate mid-flight.
- A surface changes visibility only. Nothing translates, scales or rotates, in
  either theme, with or without reduced motion (FR-006).
- Inline elements are not overlay surfaces. A collapsible, a tab panel and a
  table row are removed without a departure treatment; this is the boundary the
  spec's assumption draws, and it is what keeps the feature from becoming "every
  unmount in the product".
- The payer's surface renders no overlay today, so this entity is back-office in
  practice. The definition still lives in `packages/ui` styles, because FR-005
  says there is one definition and not one per surface.

---

## Control size

Carried unchanged from `001-design-foundations`. This feature adds no member; it
finishes applying the three that exist.

| Size | Height | Serves |
| --- | --- | --- |
| `compact` | 40px | The dense back office |
| `standard` | 48px | Touch. The default on the payer's surface |
| `decisive` | 64px | The charge path's committing action |

**Rules**

- A screen names one. It never states a height — `h-10` in a call site is the
  same defect as inventing a size name (research R8).
- A component offers only the sizes it serves (FR-013). `StatusBadge` offers
  `compact` and `standard`; there is no decisive badge.
- A component takes the names, not the heights (FR-012). A badge is read, never
  aimed at, so it carries no touch-target obligation and keeps the dimensions it
  has today.
