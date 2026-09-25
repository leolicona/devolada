# Bug Fix: a payment lands in WispHub hours late, and after 18:00 on the next day

- **Slug**: wisphub-payment-utc-time
- **Fixed**: 2026-09-25
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The dates Devolada sends to WispHub are now written on the ISP's wall clock,
from `businesses.timezone`, not the UTC clock. WispHub reads a date without a
zone as its tenant's local time, so a Mexico City ISP's 20:30 payment is now
filed at 20:30 on the same day, not at 02:30 on the next one. This covers
`fecha_pago` on `registrar-pago` and the three dates of the "Adeudo anterior"
zero-total invoice. All three doors that register a payment pass the
business's zone: the verdict, the retry queue and the panel ("Ejecutar
ahora" and accepting a held payment).

The moment itself is unchanged, as the assessment's preferred remediation
says: a payment is still dated when Devolada registers it. Which moment it
should carry is still the assessment's open question (see Follow-ups).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/time/business-day.ts` | modified | new `businessWallClock(timezone, instant)` → `{ date: "YYYY-MM-DD", dateTime: "YYYY-MM-DD HH:MM" }`, on the same cached `Intl.DateTimeFormat` the business day uses; midnight's `24` read as `00`; cut to the minute, never rounded |
| `apps/api/src/wisphub/reconnection.ts` | modified | `attemptReconnection` takes `business: { id, timezone }` instead of `businessId`; `date`/`dateTime` come from the helper; the comment records the assumption (WispHub's tenant zone = the zone saved in Devolada) and that a retry still registers the retry's time |
| `apps/api/src/direct-payments/validation.ts` | modified | the verdict passes its business row |
| `apps/api/src/reconnection/queue.ts` | modified | the sweep reads `{ id, timezone }` for the batch's businesses in one query (the validation sweep's pattern) and passes each charge its own |
| `apps/api/src/routes/payments/handler.ts` | modified | `dispatchObserved` takes the actor's business (`{ id, timezone }`) instead of its id; both callers pass `actor` |
| `apps/api/test/wisphub-payment-utc-time.test.ts` | added test | 7 tests, all `bug: wisphub-payment-utc-time` |

No schema change, no migration, no API contract change. `wisphub/client.ts`
is untouched: `registerPayment` and `createInvoice` already pass the strings
through as given.

## Diff Highlights

The helper (`time/business-day.ts`):

```ts
export function businessWallClock(timezone: string, instant: Date): { date: string; dateTime: string } {
  const list = formatterFor(timezone).formatToParts(instant);
  const two = (n: number) => String(n).padStart(2, "0");
  const date = `${read(list, "year")}-${two(read(list, "month"))}-${two(read(list, "day"))}`;
  /* en-CA writes midnight as 24, as in offsetMsAt */
  const time = `${two(read(list, "hour") % 24)}:${two(read(list, "minute"))}`;
  return { date, dateTime: `${date} ${time}` };
}
```

The adapter (`wisphub/reconnection.ts`):

```ts
-      const date = now.toISOString().slice(0, 10);
-      const dateTime = `${date} ${now.toISOString().slice(11, 16)}`;
+      const { date, dateTime } = businessWallClock(business.timezone, now);
```

## Tests Added or Updated

`apps/api/test/wisphub-payment-utc-time.test.ts` (WispHub fetch-mocked at its
origin; the request bodies WispHub receives are the assertion):

- *the ISP's wall clock* (the helper, fixed instants)
  - `2026-10-01T02:30Z` → `2026-09-30 20:30` in `America/Mexico_City` and
    `2026-09-30 19:30` in `America/Hermosillo`
  - midnight is `00:00` of the new day; `20:30:59.999` stays `20:30`
  - Tijuana through both 2026 clock changes: `01:59` → `03:00` in March, and
    `01:30` twice, an hour apart, in November
- *the queue registers on each ISP's clock* (`sweepReconnections` at the fixed
  instant `2026-10-01T02:30Z`)
  - one batch, two businesses: `registrar-pago` carries `2026-09-30 20:30` for
    the Mexico City ISP and `2026-09-30 19:30` for the Hermosillo one. This
    proves the zone comes from each charge's own business
  - with nothing pending, the "Adeudo anterior" invoice is born with
    `fecha_emision`, `fecha_vencimiento` and `fecha_pago` = `2026-09-30`, and
    the payment on it carries `2026-09-30 20:30`
- *every door that registers writes the ISP's clock* (real clock, Hermosillo
  business)
  - the verdict of a transfer payment
  - "Ejecutar ahora" on an observed payment

  These two read their own `now`, so they assert against the moment of the
  request. Hermosillo is UTC−7 all year, so the expected wall clock is plain
  arithmetic, independent of the Intl code, and it never equals UTC.
  Either side of one minute boundary is accepted.

No existing test changed.

## Local Verification

- Red first: the new file run against the unfixed code (a throwaway
  `git worktree` of `028484d` in the scratchpad, with only the helper and the
  test file copied in, removed afterwards): **4 failed, 3 passed**. Every
  path test failed with the symptom: `expected '2026-10-01 02:30' to be
  '2026-09-30 20:30'`, the invoice dated the 1st, and the real-clock tests
  received the UTC `15:24` against an expected `08:24`. The 3 that passed
  test the helper, which was copied in.
- `pnpm exec vitest run test/wisphub-payment-utc-time.test.ts` (in `apps/api`)
  → 7 passed
- `pnpm --filter @devolada/api test` → 46 files, 692 tests passed
- `pnpm -r --if-present typecheck` → clean in every workspace
- `node scripts/spec-lint.mjs` → ✔ 80 test files checked
- `node scripts/gen-banks.mjs --check` → ✔ 97 banks, the constant in step
- `node scripts/contrast-lint.mjs` → ✔ 34 pairs at AA (6 below the AAA
  target, as before this change)
- `node scripts/pending-lint.mjs` → ✔ 30 labels inside pending regions
- Not run: the browser and passkey layers (no frontend change). Nothing was
  deployed and no WispHub installation was called.

## Deviations from Assessment

- **`dispatchObserved` changed too.** The assessment listed
  `routes/payments/handler.ts` as passing the zone. The panel's call goes
  through `dispatchObserved`, which is shared since receipt-triage D31 by
  "Ejecutar ahora" and the accept of a held payment. So that helper now
  takes the actor's business instead of its id. The actor already carries
  `timezone`, so this adds no read.
- **The queue reads the zone itself.** Its `due` rows carry only
  `businessId`, so the sweep adds one narrow query per tick that has work
  (`{ id, timezone }` for at most 20 businesses), shaped like the validation
  sweep's own business read.
- **The assessment's line numbers moved.** `main` merged receipt-triage (#240)
  after the assessment was written. Before this fix, the validation call sat
  at `validation.ts:1191` (not `:954`) and the panel's at `handler.ts:337`
  (not `:296`). Same code.

## Follow-ups

- **Decision for the creator: which moment `fecha_pago` should carry.** It is
  still the registration moment, so a queued retry, an "Ejecutar ahora" or an
  accepted review days later still dates the payment on that later day. The
  row already stores the validation moment (`confirmedAt`), which stays the
  same across retries. It stores the transfer's date (`transferDate`) but not
  its time, so dating by the transfer would need a time the row does not keep
  today.
- **Confirm the pilot's tenant zone** with one `GET /facturas/{id}/` on a
  payment Devolada registered there (the assessment's second open question).
  The fix assumes WispHub's zone equals the one saved in Devolada; the
  settings screen could later show the zone next to the WispHub connection.
- **Checked, not changed:** the payment promise's `fecha_limite`
  (`direct-payments/provisional.ts`, `promiseDeadline`) is also a naive UTC
  date sent to WispHub. West of UTC the UTC date is never earlier than the
  local one, so it can only make the promise last longer, by up to the
  offset. provisional-release D3's "must outlive the ride" holds, but its
  "under 24 h" extra window is really up to 24 h plus the offset. Tightening
  it is a product call about service continuity, not this bug.
- Payments registered before this fix stay shifted in WispHub (out of scope,
  as the assessment says).
- `/speckit-bug-test slug=wisphub-payment-utc-time` for the independent check.
