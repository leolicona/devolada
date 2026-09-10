# Quickstart: feedback-vocabulary-rollout

**Feature**: 002 · **Date**: 2026-09-10 · **Phase**: 1

How to prove this feature works. Each section names what it answers and what a
pass looks like; none of it duplicates the contracts.

## Prerequisites

```sh
pnpm install                      # pnpm 10 workspace, Node 22
pnpm --filter @devolada/api dev   # only for the by-hand checks below (8787)
pnpm --filter @devolada/admin dev # the back office (5174)
```

With the API up, `curl -X POST localhost:8787/dev/seed` creates the demo ISP
(`demo@devolada.app` / `devolada123`).

## The gates, in CI order

```sh
node scripts/spec-lint.mjs        # every new test cites its story
node scripts/gen-banks.mjs --check
node scripts/contrast-lint.mjs    # tokens.css in both themes
pnpm -r --if-present typecheck
pnpm -r --if-present test
```

None of these may be skipped or quarantined to get green (constitution, CLAUDE.md).

`typecheck` carries more weight than usual here: renaming `StatusBadge`'s sizes
and deleting `ListError`'s `retrying` prop are both changes the compiler can
find exhaustively, and it is the cheapest instrument that proves no call site
was missed (US4 scenario 4).

## User Story 1 — the operator can tell the back office is working

**Automated**

```sh
pnpm e2e
```

Answers: a pending region announces itself once; a region below the flash
threshold shows nothing and does not shift the layout (SC-014); no pending
region freezes under reduced motion (SC-012).

**By hand** — this story's third scenario needs a person.

1. Open the back office, throttle the network to Slow 3G.
2. Navigate to a list. Cover the wording with your hand.
3. It must be recognisable as still working within five seconds (SC-003).
4. Repeat with the tab already loaded, then switch away and back. **Nothing may
   appear** — a refetch you did not ask for is not a wait (SC-011).

**With a screen reader**: load a screen and hear what is loading, named, once.
Click a save and hear that action announced at the control you used, not a
second copy of the screen's message (SC-002).

## User Story 2 — surfaces arrive and leave the same way

**Automated**

```sh
pnpm e2e
```

Answers: computed `animation-name` is `enter` on open and `leave` on close, for
every surface and its backdrop; computed `transform` stays `none` throughout
(SC-006); the count of arrival treatments that produce no visible change is zero
(SC-005).

**The assertion that matters most**: after a close, the node must be **gone**.
Radix keeps a closing node mounted until `animationend`, so a keyframe that
never ends leaves a dialog in the DOM forever — invisible in a screenshot,
fatal in use. Assert removal, not just the animation name. Run it under reduced
motion too, where the keyframe is flattened to 0.01ms.

**By hand**: open and close each surface twice. The two arrivals must be
indistinguishable, and so must the two departures (SC-004).

## User Story 3 — a retry looks like a first attempt

**By hand**, because the comparison is the point:

1. Stop the API. Load a list; the failure notice appears.
2. Start the API. Click "Reintentar" and watch.
3. It must wait exactly as the first attempt did — same movement, same rhythm,
   nothing turning (SC-007, SC-013).
4. Now leave the failure on screen, switch to another tab, and switch back.
   The button must **not** read "Cargando…". That is the bug research R6 names,
   and this is the cheapest way to see it.

## User Story 4 — one name for a size

```sh
pnpm -r --if-present typecheck    # every call site named a context
pnpm exec playwright test --config playwright.review.config.ts
node scripts/review-diff.mjs      # nothing moved
```

The review captures answer SC-010: the size names changed and no pixel did. The
diff script reports how much moved and where, which matters because the capture
suite is not byte-deterministic — about 73 pixels in a million differ between
two runs of identical code (recorded in `001-design-foundations`, converge F6).

Also read the result with your own eyes once: `pnpm playground` renders every
badge at both sizes side by side.

## Environment note

Chromium in this container sits at Playwright revision 1194 while
`@playwright/test` 1.62.1 expects 1234. Both suites run against a gitignored
local override — `playwright.*.local.config.ts` — that sets
`executablePath: "/opt/pw-browsers/chromium"`. The committed configs are not
touched, and CI uses its own browsers.

## Definition of done

- Every gate above green, none skipped.
- The three by-hand checks done at least once, including the two that exist to
  catch a signal that should **not** appear.
- `pnpm playground` and the review captures show no unintended visual change.
