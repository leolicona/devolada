# Bug Fix: the Cobros link lookup reserves both fixed parameters, and the suite enforces D1's cap

- **Slug**: cobros-links-lookup-params
- **Fixed**: 2026-09-19
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The chunk size in `listPaymentRequests` went from `D1_MAX_PARAMS - 1` to `- 2` (business id and
`source`), and `test/setup.ts` now wraps the suite's D1 binding so any statement binding more than
100 values throws D1's own error locally — the blindness `db/params.ts` described is closed for the
whole suite, not just this query.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/routes/payment-requests/handler.ts` | modified | `chunks(usuarios, D1_MAX_PARAMS - 2)`; comment names both fixed parameters and the bug |
| `apps/api/test/setup.ts` | modified | `env.DB` wrapped once per runtime: `prepare(sql).bind(...values)` throws `D1_ERROR: too many SQL variables (N bound, D1 allows 100)` when `N > D1_MAX_PARAMS`. The real binding is kept under a global symbol because `singleWorker` re-runs the setup per file and `applyD1Migrations` insists on the real class. |
| `apps/api/test/payment-requests.test.ts` | added test | 120 debtors, all with stored links → 200 and every row carries its link. Fails on the old chunk size with `101 bound`. |

## Diff Highlights

```ts
// handler.ts
for (const part of chunks(usuarios, D1_MAX_PARAMS - 2)) {
```

```ts
// test/setup.ts
if (prop === "bind") return (...values: unknown[]) => {
  if (values.length > D1_MAX_PARAMS) throw new Error(`D1_ERROR: too many SQL variables (${values.length} bound, D1 allows ${D1_MAX_PARAMS})`);
  return bound(target.bind(...values));
};
```

## Tests Added or Updated

- `payment-requests.test.ts` — *"bug cobros-links-lookup-params: 120 debtors with stored links read in one page, every row carrying its link"*. Measured against the unfixed handler first: `D1_ERROR: too many SQL variables (101 bound, D1 allows 100)` — the production number.
- Every existing API test now runs under the cap. The first draft of the new test's own seeding bound 180 values (20 rows × 9 columns) and was caught by the guard before the handler was — chunked to 10 rows, which is the same lesson the roster's insert already carries (`floor(100 / 9)`).

## Local Verification

- `apps/api: vitest run test/payment-requests.test.ts` → unfixed: 1 failed (`101 bound`); fixed: **9 passed**.
- `apps/api: vitest run` (whole suite under the guard) → first run: 36 files failed at setup (`applyD1Migrations: parameter 1 is not of type 'D1Database'` — the proxy handed back to the migrator on the second file); after keeping the real binding under a global and wrapping once → **37 files, 518 passed**. No other statement in the suite exceeds the cap.
- `pnpm --filter @devolada/api typecheck` → clean. `spec-lint` ✔ 68 · `pending-lint` ✔.
- Not run here: admin/pago/ui suites (untouched), e2e (CI).

## Deviations from Assessment

- The assessment proposed the guard in `test/setup.ts`; the once-per-runtime detail (`singleWorker`)
  was discovered on the first full run and is recorded in the guard's comment.

## Follow-ups

- The remaining `inArray(...)` sites listed in the assessment are now measured by the suite
  wherever a test reaches them at size; an explicit audit of the ones bounded only "on paper"
  (sweep batches, feed pages) is worth a pass when the pilot's volumes are known.
- The dev business was switched to the wisphub.net demo key during this investigation and now
  carries panel links for both installations (1,010). Switch it back to **wisphub.io + the pilot's
  key** to verify this fix on the pilot's data after deploy; consider clearing the demo's links from
  that business afterwards.
