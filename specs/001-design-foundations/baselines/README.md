# T002 — the pre-change review baseline

Captured **2026-09-09** from `2cb051d` (before any source
change in this feature) by `playwright.review.config.ts`:
**136 tests passed in 7.7m, 49 captures** written to `.design/screenshots/`.

`T002-review-capture.sha256` is the manifest. The PNGs themselves are **not**
committed — `.design/` was tracked once and deliberately dropped in `5dc5f5d`;
these images are regenerated, not reviewed in git.

## What this is for

T036 re-runs the same captures after User Story 3 renames the control sizes and
proves the back office renders unchanged. The manifest is how that comparison
survives losing the working directory.

## How to use it at T036

```bash
pnpm exec playwright test --config playwright.review.config.ts
cd .design/screenshots && sha256sum *.png | sort -k2 \
  | diff - ../../specs/001-design-foundations/baselines/T002-review-capture.sha256
```

**No output means nothing moved** — that is the pass, and it is exact.

A differing hash is **a question, not a failure**. These are full-page
screenshots, so sub-pixel antialiasing or a hair of layout timing can shift
bytes without shifting anything a person would see. Open the pair and look
before concluding the rename broke something.

## If the captures are gone

Regenerate them from `main` — the run is deterministic (both apps are built
static bundles, the API is stubbed per test), so a re-capture on the same
commit reproduces the same manifest.

## Environment note

This container provisions Chromium 141 at Playwright revision 1194, while
`@playwright/test` 1.62.1 expects 1234 and refuses to launch without it. The
baseline was taken through an uncommitted `playwright.review.local.config.ts`
that sets `launchOptions.executablePath` to `/opt/pw-browsers/chromium`.

That skew does not affect what T036 measures — baseline and re-capture run on
the same binary, and the comparison is between them, never against a golden
image. But **a manifest is only comparable to a run on the same browser build**.
Regenerating on a different Chromium invalidates these hashes wholesale.
