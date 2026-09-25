# Bug Verification: a transfer made after SPEI's 18:00 date change is never found by its reference

- **Slug**: spei-date-rollover
- **Tested**: 2026-09-25
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

Our side of the bug is fixed and proven before and after. The code before
the fix (`e75f86a`) asks Banxico about Abraham's typed reference with the
**24th** at 23:50. The fix (`d6691ae`) asks the **25th** first, then the
24th, then the 25th again. The manual form proposed the UTC date (the 25th)
at 20:00 Mexico City time; it now proposes the 24th. No regression was
found in any suite.

**Not exercised:** the other half of the assessment's reproduction, where
Banxico **finds** a real transfer made after 18:00 when asked the next day.
It needs a real bank transfer on dev with the fix deployed and the real
provider. This environment has neither, since the fix is not merged and
there is no provider credential here. The assessment marked this check
`[NEEDS CLARIFICATION]` for this step, so the result is **partial**, not
verified.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction, our side: Abraham's typed reference at 23:50 | `vitest run test/direct-payment.test.ts -t "typed by reference at 23:50"` | **fail before, pass after** | before: `expected '2026-09-24' to be '2026-09-25'`, the old code asks the calendar day. After: 25 → 24 → 25, and the row keeps the 24th the payer typed |
| A receipt printed 23:40, submitted the next morning | `-t "a receipt printed 23:40"` | **fail before, pass after** | before: asks the 24th. After: asks the 25th, from the printed time |
| A time read with another date is ignored | `-t "a time read with another date"` | **fail before, pass after** | before: the 24th. After: the submission stands in (the 25th first) |
| `pending` asks the same day again | `-t "pending on a day"` | **fail before, pass after** | before: the 24th every time. After: the 25th twice |
| The server fallback uses the business's day | `-t "a row with no date asks the business's day"` | **fail before, pass after** | before: `expected '2026-09-25' to be '2026-09-24'`, the UTC date at 20:00 Mexico City time |
| The link sends the business's zone | `-t "the link tells the page the business's zone"` | **fail before, pass after** | before: `undefined` |
| The manual form's "today", 3 cases | `vitest run test/pago.test.tsx -t "spei-date-rollover"` | **fail before, pass after** | before: at 20:00 Mexico City time it received `2026-09-25` where `2026-09-24` was expected. After: correct for Mexico City, for Hermosillo, and with no zone sent |
| Guards that must not move | `-t "typed by reference at 14:00"`, `"a clave search keeps…"`, `"a receipt printed 17:30"` | **pass before and after** | expected: a daytime transfer and every clave search keep the day given |
| Found on the fallback day confirms | `-t "found on the other day"` | pass before and after | This pins the confirmation and clave adoption on the fallback day, not the switch itself: the old code asks the 24th every time, so it also reaches the 24th. The switch is proven by the 23:50 test above |
| The rule, the alternation and the reader (new code) | `vitest run test/spei-date-rollover.test.ts` | pass (9) | the old code has no `search-date.ts` or `timeOf`, so there is no "before" run for these |
| Migration 0037 applies | the API harness applies every migration per test | pass | the lifecycle tests write and read `extractions.transfer_time` |
| Regression suite | `pnpm -r --if-present test` | pass | ui 50, api 721, landing 10, pago 84, admin 244 |
| Type-check | `pnpm -r --if-present typecheck` | pass | 0 errors |
| Repo lints | `spec-lint` (81 files), `gen-banks --check`, `contrast-lint`, `pending-lint` | pass | contrast shows its standing AAA warnings, unchanged |
| Build | `pnpm -r --if-present build` | pass | ui, landing, pago, admin |
| Browser layer | `pnpm e2e`, `pnpm e2e:passkey` | skipped | long-running; CI runs them on the PR. `timezone` is optional, so the stubbed fixtures stay valid |
| **Reproduction, Banxico's side: a real transfer after 18:00, found by its reference on the next day** | a real SPEI transfer on dev with a reference used once, submitted by reference | **not-run** | the fix is not deployed, and this environment has no provider credential. The reason for **partial** |

How the "before" run was made: a temporary `git worktree` at `e75f86a` (main
before this bug), with the fix's versions of `direct-payment.test.ts`,
`consta/helpers.ts` and `pago.test.tsx` copied in and the workspace
`node_modules` linked. Each lifecycle test ran on its own, so one failure
could not leak mocks into the next. The worktree was removed afterwards; no
source file in the repo was touched.

## Output Excerpts

Before the fix (`e75f86a`):

```
FAIL  typed by reference at 23:50 :: AssertionError: expected '2026-09-24' to be '2026-09-25'
FAIL  a receipt printed 23:40 :: AssertionError: expected '2026-09-24' to be '2026-09-25'
FAIL  a row with no date asks the business's day :: AssertionError: expected '2026-09-25' to be '2026-09-24'
FAIL  the link tells the page the business's zone :: AssertionError: expected undefined to be 'America/Mexico_City'
× bug: spei-date-rollover > at 20:00 in Mexico City the manual form proposes that day, not the UTC one
  Expected the element to have value: 2026-09-24
  Received: 2026-09-25
```

After the fix (`d6691ae`):

```
Test Files  2 passed (2)   Tests  19 passed        (the two API files, filtered)
apps/api test:   Tests  721 passed (721)
apps/pago test:  Tests  84 passed (84)
apps/admin test: Tests  244 passed (244)
```

## Residual Risks

- **The provider's reference search is not observed with the right day
  yet.** The fix asks the day Banxico's own rule and the CEPs on dev point
  to, but no call has shown the search *finding* a transfer that way. If it
  does not, the payer is still asked for the clave, which is the behaviour
  before this fix. Nothing gets worse.
- **Abraham's own case would not validate by reference either way.** Three
  transfers that night share his reference, bank, amount, day and account.
  With the right day, the provider should answer "referencia duplicada"
  (422), and the page asks for the clave at once instead of after 12 hours.
- **Weekends and holidays** are unconfirmed (the assessment's open
  question). The first weekend case will show, in `validations.transfer_date`
  and the new log line, which day found it.
- **The reader's new `hora` field** is untested on real receipts. It is
  covered by the debt `receipt-triage-reader-unmeasured`.
- **Production** is several migrations behind. `0037` travels with the
  first release tag.

## Recommendation

Hold as **partial** until the live check runs, then close. Merge the PR so
dev gets the fix and migration 0037, then make one real SPEI transfer **after
18:00** with a **reference used only once**, and submit it by reference on
the payment page. It should confirm without asking for the clave. In
`validations`, its first transfer-mode row should carry the **next** day's
`transfer_date`. When it does, record the evidence here and change the
result to **verified**. If Banxico still answers `not_found` with the right
day, reopen with `/speckit-bug-assess` and that evidence.
