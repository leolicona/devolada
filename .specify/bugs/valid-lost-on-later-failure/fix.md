# Bug Fix: Banxico's `valid` is kept; a WispHub failure retries WispHub alone

- **Slug**: valid-lost-on-later-failure
- **Fixed**: 2026-09-26
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The product creator chose **option A** on 2026-09-26. When Banxico says
`valid` and every check of the CEP passes, the payment keeps that verdict
(`banxico_valid_at`) and the CEP's facts on its row before the WispHub half
runs. If WispHub then fails, the next slot resumes at the WispHub read with
no provider call. The row is never `expired`, and the ISP's feed says
"Confirmado por Banxico; falta leer WispHub: <motivo>". Step 3 landed as
well: a first validation of the CEP made by this business on another link
counts as its own, not as "validated outside Devolada".

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/db/schema.ts` | modified | `payments.banxico_valid_at` (timestamp ms), commented with the decision and the 2026-09-26 measurement |
| `apps/api/migrations/0039_valid_kept.sql` (+ meta) | added | one additive `ADD COLUMN`; older rows keep NULL and run as before |
| `apps/api/src/direct-payments/validation.ts` | modified | see the highlights below |
| `apps/api/src/routes/direct-payments/handler.ts` | modified | a submission on a link whose attempt Banxico confirmed is answered from that attempt; nothing is created or spent |
| `apps/api/src/routes/payments/schema.ts`, `handler.ts` | modified | the feed carries `banxicoConfirmedAt` and `waitingOn` (the WispHub code) for a kept row that is still `validating`; both are defaulted, so older fixtures still parse |
| `apps/admin/src/features/feed/FeedScreen.tsx` | modified | the expanded row shows "Confirmado por Banxico; falta leer WispHub: …" with a reason per code |
| `apps/api/test/direct-payment.test.ts` | added tests | 6 tests, `bug: valid-lost-on-later-failure` |
| `apps/admin/test/feed.test.tsx` | added tests | 2 tests plus axe |

## Diff Highlights

- **The panel half is its own function.** `settlePanelPayment` covers
  everything from the D14 debt re-check to the dispatch. The code moved
  unchanged; only its inputs (the CEP's amount and sender, the hold) became
  parameters. It is reached in two ways:
  - Straight after a `valid` verdict. `base` now carries `banxicoValidAt`,
    `receivedCents`, `cepSenderName` and `reviewReason` (the hold), so any
    `retryLater` inside the WispHub half writes the kept verdict.
  - At the top of `runValidation` when `payment.banxicoValidAt` is set on a
    panel link. This runs before the credential check, so it makes no
    provider call and needs no credential.
- **`retryLater` never expires a kept row.** Past the schedule it retries
  every `KEPT_RETRY_MINUTES = 60` minutes. Each retry is one WispHub read,
  with no provider call.
- **`tracesToOwnAttempt` also counts our own earlier validation.** It
  accepts a `validations` row of this business, joined to one of its
  payments (not this one), that has the same clave, `status = 'valid'` and
  `already_validated = false`. That is the first validation, and it was
  ours. A replayed first row or another business's row still refuses. The
  unique clave index remains what stops a double payment: a live payment
  that holds the clave still refuses the claim.

## Tests Added or Updated

- `direct-payment.test.ts`:
  - `bug: valid-lost-on-later-failure — valid, then WispHub refuses the key → the verdict is kept, and the next slot confirms with no provider call`.
    The second slot has no apiCEP interceptor, and exactly one
    `validations` row exists at the end.
  - `… a kept verdict past the six-hour schedule is retried on the hour, never expired`.
  - `… the ISP's feed says Banxico confirmed it and what WispHub needs`.
  - `… a new submission on the link does not replace an attempt Banxico confirmed`.
  - `… our own first validation on another link of the business is ours, not a stranger's`.
  - `… a first validation that was itself a replay, or another business's, still refuses` (control).
- `feed.test.tsx`:
  - `bug: valid-lost-on-later-failure — the detail reads 'Confirmado por Banxico' with the WispHub reason` (with axe).
  - `… an ordinary wait carries no such line`.

## Local Verification

- `pnpm exec vitest run test/direct-payment.test.ts -t valid-lost`: 6/6
  pass.
- Mutation check: with the resume, the forgiveness and the hourly slot
  disabled, all 6 fail. The two controls fail by cascade from interceptors
  left pending, not on their own assertion.
- `pnpm -r typecheck`, `spec-lint`, `pending-lint`, `contrast-lint`,
  `gen-banks --check`: all green.
- Full suites: API 772/772, admin 258/258, pago 84/84.

## Deviations from Assessment

- **Scope grew to three more files:**
  - `routes/direct-payments/handler.ts`: a payer's re-upload would have
    superseded the kept row and asked the provider again, the very loss
    this fix closes.
  - `routes/payments/{schema,handler}.ts` and the admin `FeedScreen.tsx`:
    the ISP's sentence the creator asked for.
- `credit/topups.ts` is unchanged. A top-up has no WispHub half, so nothing
  after its `valid` can fail this way.
- The hold is kept in `review_reason` rather than in a new column. The feed
  reads that column only when `action_outcome = 'review'`, so writing it
  early shows nothing.

## Follow-ups

- **The payer's page still shows the calm "Verificando pago"** for a kept
  row. A sentence such as "Banxico confirmó tu transferencia; la estamos
  aplicando a tu cuenta" is a product decision for the payer's page
  (validation-status-ux).
- **The feed badge still reads "Verificando"**; the new sentence is in the
  expanded row. A badge of its own would be a new `StatusBadge` state in
  `packages/ui`.
- **Dev data:** Juan Fernando's `0e2aa815-…` was born before this fix and
  holds no kept verdict. Re-uploading the receipt on his link now confirms
  it through step 3 or the supersede chain.
- The assessment's open question on how long a kept row may wait: it now
  waits indefinitely, retrying hourly and visible to the ISP. A ceiling or
  an email to the ISP stays open.
