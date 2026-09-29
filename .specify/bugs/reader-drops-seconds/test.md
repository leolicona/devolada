# Bug Verification: the reader drops the seconds a receipt prints

- **Slug**: reader-drops-seconds
- **Tested**: 2026-09-29
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

Everything code can prove holds, and nothing regressed:
- the version-4 wording reaches both prompts;
- `timeOf` converts a 12-hour time, keeps printed seconds and invents none;
- version-3 answers read as before;
- the whole API suite, every typecheck and the CI lints pass.

The symptom itself was not re-run: the model dropping the seconds of a Nu
receipt. It needs a real model reading the creator's captures. This
container cannot reach Workers AI, and dev has no version-4 reading yet. So
whether version 4 removes the miss is still unproven.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix): a real model reads the Nu captures with version 4 | the bench, `/operador` → Lector, or `/read` on dev | not-run | no Cloudflare credentials in this container, so no Workers AI and no access to the captures in R2; the branch is not deployed to dev |
| Dev has no version-4 reading (read-only D1 query) | count of `extractions` and `bench_readings` by `question_version` | pass (as a fact) | `extractions`: v2 40 rows, v3 21 rows (latest 2026-09-29 07:34 UTC), no v4. `bench_readings`: no rows of any version |
| The code half of the reproduction: the printed forms convert | `bug: reader-drops-seconds` block in `apps/api/test/consta/reader-questions.test.ts` | pass | "09:14:50 AM" is "09:14:50"; "01:20:10 PM" is "13:20:10"; "09:14 AM" stays "09:14" |
| New / updated tests | `npx vitest run test/consta/reader-questions.test.ts test/spei-date-rollover.test.ts` (in `apps/api`) | pass | 25 of 25, 2 files (run at the fix, unchanged since) |
| Regression suite (API, engine included) | `npx vitest run` (in `apps/api`) | pass | 55 files, 936 of 936 tests |
| Type-check, every workspace | `pnpm -r --if-present typecheck` | pass | api, admin, pago, landing, ui; landing's Astro check: 0 errors, 0 warnings |
| CI lints | `spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint` | pass | contrast-lint's six AAA warnings are older than the fix |
| Component suites (admin, pago) | not run | skipped | the fix changes no schema and no contract the frontends import; the admin shows `questionVersion` as text |
| Browser and passkey layers | not run | skipped | untouched by the fix; they need built previews and a real wrangler |

## Output Excerpts

```text
# apps/api, full suite
 Test Files  55 passed (55)
      Tests  936 passed (936)

# apps/api, the two time files
 ✓ test/consta/reader-questions.test.ts (20 tests)
 ✓ test/spei-date-rollover.test.ts (5 tests)

# pnpm -r --if-present typecheck
typecheck-exit=0

# dev D1, read-only, 2026-09-29
extractions     qv 2  n 40  latest 2026-09-27 01:37:53
extractions     qv 3  n 21  latest 2026-09-29 07:34:09
(bench_readings: no rows)
```

## Residual Risks

- **The symptom's own check is open.** The miss was the model's (one Nu
  capture in two). No stub can show that a new wording removes it
  (constitution IV, receipt-reader-tuning D20).
- **The prompt is one text.** Version 4 changed only the time's field and
  rule. A word there can still move another field (the clave, the bank, the
  reference), and only the bench tally shows it.
- **A copied zone gives no time.** If the model copies "(hora de CDMX)" in
  spite of the rule, `timeOf` returns null. That fails safe, since the time
  only filters, but it loses the time's signal.
- **"NU" for NUBANK** is still read on Nu receipts and stops the gate. It is
  out of this bug's scope, and it hid the one 13:20 capture that kept its
  seconds.
- **The dev bench has never recorded a reading**, of any version. The
  measurement the fix depends on has not been taken for versions 3 or 4.
- **The fix is on `fix/reader-drops-seconds`**, pushed, with no PR. CI has
  not run on it.

## Recommendation

Hold. Don't close yet: the fix is sound in code and regresses nothing, but
the original symptom was not re-run.
1. Merge the branch through a PR, so it deploys to dev.
2. On the bench, read these with version 4 beside version 3:
   - the two Nu 09:14 captures;
   - the two Nu 13:20 captures;
   - the three Azteca receipts.
3. Mark `time` on each.

If every capture that prints seconds keeps them, and no other field reads
worse, re-run `/speckit-bug-test slug=reader-drops-seconds` with that
tally and close as verified. If a Nu capture still loses its seconds, reopen
with `/speckit-bug-assess` and the new readings as evidence.
