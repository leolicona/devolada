# Bug Fix: a retried action reconnects a customer the business's rule left cut

- **Slug**: queue-retry-forgets-action
- **Fixed**: 2026-10-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The decided action (the mapped action plus the threshold's vote) now lives on
the payment row as `decided_action`, written at every dispatch decision and
read back by every retry. The sweep passes it to the adapter as `reconnect`,
and maps the adapter's `withheld` answer to the row's terminal outcome; the
operator's retry records the row's own decision in the ledger.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/db/schema.ts` | modified | `payments.decided_action`, nullable text, the `hypothesisOf` vocabulary |
| `apps/api/migrations/0043_queue_decided_action.sql` | added | one `ALTER TABLE … ADD` — additive (renumbered from 0042 on 2026-10-01: spec 017 took 0042 on `main` first) |
| `apps/api/src/reconnection/queue.ts` | modified | `decidedActionOf(row)`; the sweep passes `reconnect`; a `withheld` answer is terminal (`done` / `withheld`) and acked; the report gains `registered` |
| `apps/api/src/direct-payments/validation.ts` | modified | `settlePanelPayment`'s dispatch writes `decidedAction` |
| `apps/api/src/routes/payments/handler.ts` | modified | `dispatchObserved` writes `decidedAction`; `retryAction` records the row's decided action in the ledger |
| `apps/api/test/queue-retry-forgets-action.test.ts` | added test | four cases, `bug: queue-retry-forgets-action` |
| `apps/api/test/reconnection-queue.test.ts` | modified | the quiet sweep's report shape gains `registered: 0` |

## Diff Highlights

```ts
// reconnection/queue.ts
export function decidedActionOf(row: { decidedAction: string | null; observedAction: string | null }) {
  return parseHypothesis(row.decidedAction ?? row.observedAction ?? "register_and_reconnect:reconnect");
}
…
const { action, reconnect } = decidedActionOf(charge);
const result = await attemptReconnection(…, { invoiceId, paymentRegistered }, reconnect);
if (result.status === "withheld") { /* done under register_only, withheld otherwise; acked */ }
```

## Tests Added or Updated

- `queue-retry-forgets-action.test.ts` — a short payment below the threshold
  whose first `registrar-pago` met a 503: the sweep posts `accion: 0` and the
  row ends `withheld`, ledger acked.
- same file — an `exact` payment mapped to `register_only`, same outage: the
  sweep posts `accion: 0` and the row ends `done`.
- same file — the operator's retry of a `failed` register-only row records
  `register_only` in the ledger, and the sweep posts `accion: 0`.
- same file — a row with no decision on file (queued before the fix) keeps
  today's reconnect.

## Local Verification

- `npx vitest run test/queue-retry-forgets-action.test.ts` with the sweep's
  `reconnect` argument removed → the first three cases fail with
  `expected 1 to be +0` (the bug reproduced); restored → 4/4 pass.
- `pnpm --filter @devolada/api exec vitest run` → 59 files, 1056 tests pass.
- `pnpm --filter @devolada/api typecheck` → clean.
- `node scripts/spec-lint.mjs` → 96 test files checked.

## Deviations from Assessment

- `SweepReport` gains a `registered` counter, so the cron log says what a
  register-only retry did instead of hiding it in `reconnected`. One existing
  assertion of the report's exact shape (`reconnection-queue.test.ts`, the
  quiet sweep) gains `registered: 0`. Not listed in the assessment's files.

## Follow-ups

- `specs/018-cash-at-stores` D9 moves the three call sites behind
  `paymentActions`; the decision travels with them.
