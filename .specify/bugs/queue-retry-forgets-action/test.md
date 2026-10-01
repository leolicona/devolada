# Bug Verification: a retried action reconnects a customer the business's rule left cut

- **Slug**: queue-retry-forgets-action
- **Tested**: 2026-10-01
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The assessment's reproduction is exercised end to end in workerd against a
real local D1, with WispHub at its origin through `fetchMock`: a payment whose
decision is register-only, whose first attempt meets a 503, is retried by the
sweep with `accion: 0`. Without the fix the same test sees `accion: 1`. No
regression in the API suite.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | the sweep's `reconnect` argument removed, `npx vitest run test/queue-retry-forgets-action.test.ts` | fail (as expected) | 3 of 4 cases: `expected 1 to be +0` on `accion` |
| Reproduction (post-fix) | `npx vitest run test/queue-retry-forgets-action.test.ts` | pass | 4/4 |
| Regression suite | `pnpm --filter @devolada/api exec vitest run` | pass | 59 files, 1056 tests |
| Type-check | `pnpm --filter @devolada/api typecheck` | pass | |
| Story citations | `node scripts/spec-lint.mjs` | pass | 96 test files checked |

## Output Excerpts

```
 ✓ test/queue-retry-forgets-action.test.ts (4 tests)
 Test Files  59 passed (59)
      Tests  1056 passed (1056)
```

## Residual Risks

- Not observed on a live WispHub tenant: the reproduction is the code path with
  WispHub intercepted at its origin, which is the house's API layer
  (constitution IV).
- Rows already queued in production when this deploys carry no decision and
  are retried with the old reconnect. The queue drains within about five hours.

## Recommendation

Close the bug — verified on the API layer, the only layer that can answer it.
