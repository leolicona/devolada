# Bug Verification: a single CEP's cadena is read with the seal that follows it

- **Slug**: single-cep-unreadable
- **Tested**: 2026-09-29
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

Every automated check passes on the PR head (`29c51ed`), and nothing else
broke. The automated equivalent of the reproduction no longer reproduces:
the Nu screenshot as it happened confirms by time from the cadena, and Klar
after 18:00 confirms.

The reproduction the assessment describes on dev, with a real receipt and a
real apiCEP answer, was not exercised. The fix is not merged, so dev does
not run it yet. Hence **partial**, not verified.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction, pre-fix (automated) | `main`'s reader with the measured fixtures, on the three API files | fail, as expected | Recorded in fix.md: 52 of 195 fail. Not re-run here, because this command does not modify source. |
| Reproduction, post-fix (automated) | `pnpm --filter @devolada/api exec vitest run test/cep-bundle-match.test.ts -t "single-cep-unreadable"` | pass | 5 of 5. See the notes below the table. |
| Reproduction on dev (end to end) | Upload a Nu screenshot cut before its clave, and a Klar receipt, on dev | not-run | The PR is not merged, so dev does not run the fix. The check needs real receipts and paid apiCEP calls. |
| New / updated tests | `pnpm --filter @devolada/api exec vitest run test/consta/bundle.test.ts test/consta/validate.test.ts test/cep-bundle-match.test.ts test/payments-unmatched.test.ts`; `pnpm --filter @devolada/pago exec vitest run test/pago.test.tsx`; `pnpm --filter @devolada/admin exec vitest run test/feed.test.tsx` | pass | api 205/205, pago 82/82, admin 38/38. |
| Regression suite | GitHub Actions CI on `29c51ed` (run 36517497606): `quality` and `preview` | pass | Every workspace's tests and the build pass, and the preview uploaded. Locally, on the same code: api 930, pago 88, admin 317, ui 50, landing 10. |
| Lint / type-check | `spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint`, `pnpm -r --if-present typecheck` | pass | contrast-lint notes 6 pairs below the AAA target while AA holds, the same as on `main`. |

The five post-fix reproduction tests cover:
- the Nu screenshot as it happened, which confirms by time;
- Klar after 18:00, which confirms;
- a cadena of another shape, or none, which is unreadable and says why;
- D9, which still confirms when there is nothing to compare.

## Output Excerpts

```
✓ … the Nu screenshot of 2026-09-28 as it happened: no clave, one valid whose cadena carries its seal — it reads, and the payment confirms by time
✓ … Klar after 18:00, shaped like the measured answer: filed under the next day and credited on the day typed — it reads and confirms
 Test Files  1 passed (1)
      Tests  5 passed | 39 skipped (44)

api:   Test Files  4 passed (4)   Tests  205 passed (205)
pago:  Test Files  1 passed (1)   Tests  82 passed (82)
admin: Test Files  1 passed (1)   Tests  38 passed (38)
✔ spec-lint: 90 test files checked
✔ gen-banks: 97 banks, the constant in step
✔ contrast-lint: 34 pairs in both themes at AA, no hardcoded colors (6 below the AAA target)
✔ pending-lint: 30 in-progress labels, every one inside a pending region
```

## Residual Risks

- **The code has not read a real `cdaChain` yet.** The automated
  reproduction runs on synthetic answers built in the measured shape; the
  real answers stayed on the creator's machine. The creator's filter read
  them field by field, and every check passed once the seal was set apart.
- **The seal's alphabet in a real `cdaChain` was inferred.** The probe saw
  344 characters, and the seals dev keeps from printed CEPs are standard
  base64 (3 of 3). A seal outside base64 would read "not delimited": the
  clave would be asked, and the reason recorded.
- **The reader can stop a Nu upload before any of this.** On 2026-09-28 it
  read the bank "NU" from the logo, which is outside the vocabulary, and the
  first upload of one screenshot was gated. That is a separate issue, but it
  can interrupt the test on dev: upload again if it happens.
- **A Klar payer cannot give a clave.** If a Klar payment stays undecided,
  the ask leads nowhere. This is an open question in the assessment.

## Recommendation

Hold: the automated checks pass, but the reproduction on dev was not
exercised.

1. Merge PR #255 so dev deploys it.
2. Upload a Nu screenshot cut before its clave, and a Klar receipt.
3. Re-run `/speckit-bug-test slug=single-cep-unreadable`.

Both payments should confirm with no clave asked. Their records should be
read from the cadena (`cep_records` with no bundle, credit day and time from
the cadena), with no `readWhy` on the trail. With that, the result becomes
verified.
