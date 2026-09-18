# Bug Verification: the admin's dropdown popup is unbounded, so a long list is unreachable

- **Slug**: bank-picker-unreachable
- **Tested**: 2026-09-18
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The defect was exercised in a real browser both ways: against the pre-fix
`select.tsx` the popup runs to 1041px inside a 720px window, reports
`max-height: none` and leaves its last row at viewport ratio 0; with the fix it
is bounded, scrolls, and every row is reachable. The reported screen was checked
too — the bank can be chosen. Nothing regressed: 727 unit/component/API tests,
67 browser tests, four lint gates and the build all pass.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | `git show dc48cf4^:…/select.tsx` restored, then `playwright test tests/e2e/dropdown.spec.ts` | fail, as expected | 3/3 failed — the defect, measured |
| Reproduction (post-fix) | same spec, fix restored | pass | 3/3 |
| Reported screen | `playwright test tests/e2e/bank-picker.spec.ts` — `/settings/direct-payment`, open **Banco**, reach the end of the list | pass | The symptom the creator reported is gone on the screen they reported it on |
| Regression: browser layer | `pnpm exec playwright test` | pass | 67 tests, including the motion suite that opens and closes this same dropdown |
| Regression: every workspace | `pnpm -r --if-present test` | pass | 727 tests (api 436, admin 190, pago 51, ui 50) |
| Lint gates | `spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint` | pass | CI order |
| Type-check | `pnpm -r --if-present typecheck` | pass | four workspaces |
| Build | `pnpm -r --if-present build` | pass | |
| Passkey ceremony | `pnpm e2e:passkey` | not-run | Needs a real wrangler API, D1 and the IdP. It touches this area only through the bank field, which no longer uses this control; it runs on merge to `main`, before the dev deploy |

## Output Excerpts

Against the pre-fix `select.tsx` — the defect stated as numbers:

```
✘ a dropdown longer than the window stays inside it
    Expected: <= 721
    Received:    1041
✘ the popup is the scroll container, and really scrolls
    Expected: not "none"        ← max-height
✘ the last row is reachable
    Expected: in viewport / Received: viewport ratio 0
  3 failed
```

With the fix:

```
✓ a dropdown longer than the window stays inside it (806ms)
✓ the popup is the scroll container, and really scrolls (833ms)
✓ the last row is reachable (585ms)
  3 passed
```

Measured directly in the open popup, 26 rows in a 720px window: content 613px,
viewport 605px over 936px of rows, `overflow-y: auto`, and it scrolls.

## Residual Risks

- **The reported steps were not re-run verbatim, and cannot be.** The assessment's
  reproduction opens the bank list as a dropdown; the bank is a searchable
  picker now (`specs/007-searchable-picker/`), so that exact path no longer
  reaches this control. The defect was therefore exercised, pre and post, on the
  workspace switcher — the one dropdown whose length is data rather than code —
  and the reported *symptom* was checked separately on the reported screen. Both
  halves are covered, but by two checks rather than one.
- Chromium only, as the browser layer is configured. The bound comes from Radix's
  collision handling, which is the same code path on every engine.
- `contrast-lint` measures the palette; the change adds no colour, only a height.

## Recommendation

Close the bug — verified in a browser, before and after, with the failure
measured rather than assumed. The one thing to carry forward is already written
into the guard: it asserts that a dropdown is bounded and scrolls, not that one
particular list is long, so it keeps proving the rule after the bank leaves.
