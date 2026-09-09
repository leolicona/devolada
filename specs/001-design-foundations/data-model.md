# Phase 1 Data Model: design-foundations

**Date**: 2026-09-09 · **Feature**: [spec.md](./spec.md)

This feature stores nothing and persists nothing. Its "entities" are the three
closed vocabularies the spec names — a value belongs to exactly one, and a
screen may not invent a fourth member.

---

## Stacking position

The named place an overlapping surface occupies, front to back. Every
overlapping surface holds exactly one (FR-001, FR-002).

| Position | Order | Occupied by |
| --- | --- | --- |
| `base` | 0 | Page content. The absence of a stacking decision. |
| `sticky` | 10 | Pinned headers, the back office sidebar, the payer's tab bar. |
| `dropdown` | 20 | Menus and pop-overs anchored to a control: select, popover, combobox. Above sticky, because a menu opened from a pinned header must clear it. |
| `overlay` | 30 | The dimmed backdrop behind a modal surface. |
| `modal` | 40 | Dialog, sheet and confirmation content. Always above its own backdrop. |
| `toast` | 50 | Transient notices, which outrank everything because they may report on it. |

**Rules**

- The order is total: no two positions share a number, and the numbers are
  spaced by ten so a position can be inserted without renumbering.
- A surface takes a position by name. A screen that needs a place not in this
  table adds a named one here first (FR-002).
- `overlay` and `modal` are a pair: a modal surface always renders both, never
  content without its backdrop.

**Migration**: eight surfaces currently share the single value `z-50`, which is
why a confirmation opened from a sheet has no defined winner today.

---

## Feedback state

The named condition a region of the interface is in while something is
happening to it (FR-007). Each has one appearance and one behaviour under
reduced motion.

| State | Meaning | Appearance | Under reduced motion |
| --- | --- | --- | --- |
| `waiting` | Work is in progress and its end is not knowable | The breath: opacity cycles, low amplitude, one intensity (FR-008, FR-010) | Unchanged — the breath is opacity only (FR-013) |
| `resolving` | The answer has arrived and is replacing the wait | Cross-fade in, unhurried, no bounce or scale (FR-012) | Cross-fade permitted; it changes no geometry |
| `entering` | A surface is arriving | Fade in | Fade only, never slide |
| `leaving` | A surface is departing | Fade out | Fade only, never slide |
| `retrying` | A failed process is being attempted again | `waiting`, with no residue of the failure | As `waiting` |

**State transitions**

```text
idle ──► waiting ──► resolving ──► idle(resolved)
             ▲             │
             └── retrying ◄┘  (only from a refused outcome)
```

**Rules**

- `waiting` carries no notion of elapsed time or attempt count (FR-017): the
  same state renders identically at minute two and hour six (SC-002).
- `waiting` is never the sole carrier of meaning; the same state exists as
  words for assistive technology (FR-011, SC-009).
- `waiting` does not render for a process shorter than the flash threshold, and
  once rendered it stays long enough to be read (FR-014).
- `resolving` is the same for a confirmation and a refusal. The tone lives in
  the words and the colour, never in the motion (FR-012).

---

## Control size

The named context a control serves, so a screen never states a height (FR-004).

| Size | Height | Serves |
| --- | --- | --- |
| `compact` | 40px | The dense back office: filter bars, table rows, dialog footers |
| `standard` | 48px | Touch. The default everywhere on the payer's surface |
| `decisive` | 64px | The charge path's committing action, full width |

**Rules**

- `compact` is declared for pointer-first screens. It clears WCAG 2.2 AA target
  size (SC 2.5.8, 24×24) but not the product's own 48px touch floor, so it is
  not used on the payer's surface (constitution VI).
- `decisive` keeps the size it has today; consolidation may not shrink it
  (User Story 3, scenario 4).
- A screen picks a size. It does not pass a height.
