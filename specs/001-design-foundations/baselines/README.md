# The design-review baseline, and how to compare against it

## What T002 got wrong, and the correction

T002 captured the pre-change review baseline and recorded it as a **sha256
manifest**, on the stated assumption that the review suite is deterministic.

**It is not.** Two runs of *identical* code produce different bytes for the
same capture: measured at 73 pixels out of 1,024,000 — 0.007% — on
`review-admin-links-inicial-1280.png`. A caret, a focus ring, a glyph's
antialiasing. Small, but never zero.

A checksum calls that "changed". Run against the manifest after Phase 3 and 4,
it flagged 21 files, including back-office screens that no change in this
feature touches. A reviewer who is told everything changed learns nothing and
stops looking — which is exactly the failure mode of a check that is too
strict, and worse than having no check at all.

The manifest is deleted. The comparison is now a **pixel diff with a floor**:
`scripts/review-diff.mjs`.

## How to compare at T036

```bash
# 1. The baseline: the same captures from the commit before this feature.
git worktree add /tmp/baseline <commit-before-the-feature>
cd /tmp/baseline && pnpm install && \
  pnpm exec playwright test --config playwright.review.config.ts
cp -r .design/screenshots /tmp/baseline-shots

# 2. The current captures.
cd - && pnpm exec playwright test --config playwright.review.config.ts

# 3. The diff.
node scripts/review-diff.mjs /tmp/baseline-shots .design/screenshots
```

Anything above the floor is printed with its pixel count, its worst channel
delta, and **the bounding box of the difference** — so you know which corner of
the screenshot to open rather than being left to spot it yourself.

`--max <ratio>` moves the floor. The default is `0.0005` (0.05%), about seven
times the measured noise: high enough that a caret does not cry wolf, low
enough that a changed colour, border or control size cannot hide under it.

## Two things that differ every run, and are not regressions

Found while running this at T036:

- **Relative times.** `review-admin-links-inicial-*` renders "consultado hace N
  min" from a fixed stub timestamp against the wall clock. It differs by
  construction between any two runs, and the gap grows the longer the two are
  apart. Roughly 1,000 pixels — above the floor, and permanently so.
- **Hover states.** The mouse stays wherever the last `click()` in the spec put
  it, so a capture taken after a click can include a hovered control. This is
  not the suite being wrong; it is the suite photographing a real state. But it
  makes any control with a hover treatment a moving target.

Both are worth knowing before concluding that a change moved something.

## What "unchanged" means here

Above the floor is **a question, not a verdict**. Open the pair and look. A
real change in this feature — a renamed control size that shifts a button's
height, a dimming that got darker — moves thousands of pixels in a compact
box, not seventy scattered ones.

## Environment note

This container provisions Chromium 141 at Playwright revision 1194 while
`@playwright/test` 1.62.1 expects 1234 and refuses to launch. The captures were
taken through an uncommitted `playwright.review.local.config.ts` that sets
`launchOptions.executablePath` to `/opt/pw-browsers/chromium`.

Baseline and comparison must run on the **same browser build**. A different
Chromium changes text rasterisation everywhere at once, which no floor can tell
apart from a real regression.
