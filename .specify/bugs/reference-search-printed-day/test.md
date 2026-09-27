# Bug Verification: a reference search asks the printed day only

- **Slug**: reference-search-printed-day
- **Tested**: 2026-09-27
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The assessment's reproduction no longer reproduces. A reference typed at
23:50 with day D asks D on the first attempt and after each `not_found`,
and a Saturday receipt printed at 19:21 asks the Saturday every time. No
regression in the API suite, typecheck or lint. Dev was not exercised: the
fix reaches dev only when the PR merges.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | the assessment's steps 1–4, as `typed by reference at 23:50: every attempt asks the day typed, never the next` | pass | three attempts after `not_found`, all ask 2026-09-24 |
| The dev case | `a Saturday receipt printed 19:21 asks the Saturday on every attempt, never the Sunday or the Monday` | pass | the shape of Juan Fernando's receipt |
| New / updated tests | `vitest run test/direct-payment.test.ts test/spei-date-rollover.test.ts -t "printed-day\|spei-date-rollover"` | pass | 12/12 |
| Mutation (from fix.md) | `validation.ts` and `search-date.ts` restored from `main` | fail as expected | 5 of 7 new tests fail; the two that pass test behaviour that never changed (14:00, clave) |
| No next-day logic left in the search | `grep -rn "searchDates\|nextSearchDate\|search-date" apps/api/src` | pass | no hits; `nextIsoDate` remains only in the feed's date-range filters |
| Regression suite | `pnpm --filter @devolada/api exec vitest run` | pass | 50 files, 765/765 |
| Type-check | `pnpm --filter @devolada/api typecheck` | pass | `tsc --noEmit` clean |
| Lint | `node scripts/spec-lint.mjs` | pass | 85 test files checked |
| Dev, live | a reference receipt uploaded after 18:00 on dev | not-run | needs the merge to deploy dev, and one paid call |

## Output Excerpts

```
 Test Files  2 passed (2)
      Tests  12 passed | 161 skipped (173)
...
 Test Files  50 passed (50)
      Tests  765 passed (765)
```

## Residual Risks

- **The provider is mocked in these tests.** They prove what Devolada asks,
  not what apiCEP answers. What it answers was measured on 2026-09-26
  (`../reference-finds-other-transfer/measurement.md`).
- **A payer who typed the wrong day** is no longer rescued by the next-day
  alternate (spec 012, scenario 5).
- **`sharedReference`** still compares a printed day with the operation day
  stored on confirmed rows (fix.md, Follow-ups).

## Recommendation

Close the bug once merged. After dev deploys, one reference receipt
uploaded after 18:00 should show its printed day in `validations.transfer_date`.
