# Bug Fix: the admin's dropdown popup is unbounded, so a long list is unreachable

- **Slug**: bank-picker-unreachable
- **Fixed**: 2026-09-18
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`SelectContent` now bounds the popup by the space Radix has measured for it,
which is what hands the viewport inside something to scroll within. One change,
at the one place every dropdown in the ISP panel comes from, so the class of
defect is closed rather than one instance of it.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/admin/src/components/ui/select.tsx` | modified | The popup takes `max-h-[var(--radix-select-content-available-height)]`, and says it may scroll. The comment carries the measurement |
| `tests/e2e/dropdown.spec.ts` | added test | The browser-layer guard, cited `bug: bank-picker-unreachable` |
| `tests/e2e/stubs.ts` | modified | A `/settings` stub, so a browser test can reach the panel's settings screens |

## Diff Highlights

The defect and its fix, in one class list:

```diff
-  "z-dropdown min-w-[var(--radix-select-trigger-width)] overflow-hidden …"
+  "z-dropdown max-h-[var(--radix-select-content-available-height)] min-w-… overflow-x-hidden overflow-y-auto …"
```

## Tests Added or Updated

- `tests/e2e/dropdown.spec.ts` — three checks against the workspace switcher,
  because that is the one dropdown whose length is data rather than code
  (nothing caps how many businesses a person belongs to):
  - the popup stays inside the window;
  - it has a real maximum height, no taller than the window, and the viewport
    inside it is a scroll container that actually overflows;
  - the last row is reachable, and reaching it really scrolled something.

  The guard asserts the *rule*, not one long list. The list it was reported on —
  the bank — becomes a searchable picker under
  `specs/007-searchable-picker/`, and after that no screen in the panel renders
  a list whose length is fixed in code and long enough to overflow. A guard
  written against such a list would quietly stop proving anything.

## Local Verification

- `playwright test tests/e2e/dropdown.spec.ts` → **3 passed**
- Same spec against the pre-fix `select.tsx` (`git show dc48cf4^:…`) → **3 failed**:
  popup bottom at 1041px in a 720px window, `max-height: none`, last row at
  viewport ratio 0. The guard catches the defect it was written for.
- `pnpm exec playwright test` → 67 passed (the motion suite exercises this same
  dropdown opening and closing; the arriving/departing vocabulary is unchanged)
- `pnpm --filter @devolada/admin test` → 190 passed
- `pnpm --filter @devolada/admin typecheck` → clean
- Manual: measured the open popup in Chromium — 26 rows in a 720px window gives
  a 613px content box over a 605px viewport holding 936px of rows, and it
  scrolls. The same popup unbounded opened at y = −3,134px.

## Deviations from Assessment

- **The scroll container is the viewport, not the content.** The assessment said
  to bound the content "and let the viewport scroll inside it", which is right,
  but a first pass also capped the viewport at a fixed height. Measuring showed
  that cap was doing nothing the bound was not already doing: Radix gives the
  viewport `flex: 1` inside a content box that is `display: flex`, so bounding
  the content is what bounds the viewport. The fixed cap was removed — an
  arbitrary number that changes nothing is a rule nobody can verify. The
  comment in `select.tsx` now states what was measured.
- **The code landed before this command ran.** The change was first applied in
  commit `dc48cf4`, during a hand-driven pass that folded this defect together
  with the searchable picker. The creator asked for the two to be split and for
  the commands to drive it. This pass re-derived the fix from the narrowed
  assessment, removed the unverifiable cap, and added the browser guard, which
  the first pass did not have — it only tested the picker.
- `tests/e2e/stubs.ts` was not in the assessment's file list. It holds no
  behaviour, only the fixture a browser test needs to reach a settings screen.

## Follow-ups

- Two test files still cite this bug but now prove the searchable picker:
  `apps/admin/test/bank-picker.test.tsx` and `tests/e2e/bank-picker.spec.ts`.
  Their citations move to the feature's stories when
  `specs/007-searchable-picker/` lands (constitution VII).
- `PREFIX_TO_BANK` maps 34 of 97 banks
  (`apps/api/src/direct-payments/clabe.ts`). Widening it would pre-select the
  bank for more ISPs. Separate change, separate decision.
