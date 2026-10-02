# Bug Fix: a reference search asks the printed day only

- **Slug**: reference-search-printed-day
- **Fixed**: 2026-09-27
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

A search by reference used to ask the next day whenever the receipt
printed a time from 18:00 on, or was submitted from 18:00 on, and then
alternated after each `not_found`. It now asks the day the receipt printed
or the payer typed, on every attempt, exactly as a clave search already did.
The rule `spei-date-rollover` added for the search is retired. Its other
parts stay: the business's "today" and the printed time the reader keeps.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/direct-payments/validation.ts` | modified | The request's `date` is `payment.transferDate ?? business day` for every key. Removed `referenceSearch()`, the `search` value and the first-guess log line, plus the imports only they used. |
| `apps/api/src/direct-payments/search-date.ts` | removed | `searchDates` / `nextSearchDate` had no other user. |
| `apps/api/src/consta/extraction/reader.ts`, `apps/api/src/consta/extract.ts`, `apps/api/src/db/schema.ts` | comments | The printed time is still read and stored, and no longer decides the day. It is kept to pair a receipt with one CEP of a several-matches ZIP. |
| `apps/api/test/direct-payment.test.ts` | tests replaced | New `bug: reference-search-printed-day` block. The `bug: spei-date-rollover` block keeps only the two tests whose behaviour still holds. |
| `apps/api/test/spei-date-rollover.test.ts` | tests removed | The `searchDates` / `nextSearchDate` unit tests go with the functions. The reader-time tests stay. |

## Diff Highlights

```ts
/* bug: reference-search-printed-day — a clave and a reference alike ask
   the day the receipt printed or the payer typed, on every attempt. … */
date: payment.transferDate ?? businessWallClock(business.timezone, now).date,
```

## Tests Added or Updated

`apps/api/test/direct-payment.test.ts`, `bug: reference-search-printed-day`:

- `typed by reference at 23:50: every attempt asks the day typed, never the next`: three attempts, each after a `not_found`, all ask the 24th.
- `typed by reference at 14:00: the day typed`
- `found on the printed day: the row adopts Banxico's clave and records its operation day`: asks the 24th, and the row then stores the CEP's 25th.
- `pending on a day asks the same day again`
- `a clave search keeps the row's own date, even at 23:50`
- `a receipt printed 23:40 is searched on its printed day, whenever it was submitted`
- `a Saturday receipt printed 19:21 asks the Saturday on every attempt, never the Sunday or the Monday`: Juan Fernando's case on dev.

Kept under `bug: spei-date-rollover`: "a row with no date asks the
business's day", and "the link tells the page the business's zone".

Replaced, not skipped: "the next day first, then the day typed, then the
next again", "found on the other day", "a receipt printed 23:40 is searched
on the next day", and "a time read with another date … the submission stands
in". They asserted the defect.

## Local Verification

- `vitest run test/direct-payment.test.ts -t "printed-day|spei-date-rollover"`: 9/9 pass.
- Mutation check: with `validation.ts` and `search-date.ts` restored from
  `main`, 5 of the 7 new tests fail (every one that depends on the day).
  The 14:00 case and the clave case pass on both, as they should.
- `pnpm -r --if-present typecheck`: clean.
- `spec-lint` and `pending-lint`: clean.
- Full API suite: 50 files, 765/765 pass. Before the fix it was 772: six
  `searchDates`/`nextSearchDate` unit tests went away, and the rollover
  block went from 11 tests to 9 across the two describes.

## Deviations from Assessment

- None in scope. `search-date.ts` was removed rather than reduced, since
  nothing else imported it. The `SPEI_ZONE` / `SPEI_DATE_CHANGE` constants
  had no other reader.

## Follow-ups

- **`sharedReference` compares `payments.transfer_date`**, and a confirmed
  row stores the CEP's operation day there (`adoptKey`). A new reference row
  carrying its printed day therefore misses a confirmed twin. This needs its
  own bug.
- **A payer who typed the wrong day** is no longer rescued by the next-day
  alternate. Spec 012, scenario 5 (neighbouring calendar days) covers it.
  *2026-09-30: built by payment-without-receipt D14 (tasks T025) — round 3
  of a row searched by a payer's reference asks the day before and the day
  after the day given (never after today, never the operation day), in
  `runValidation` (`neighbourDays`); rows without a `reference_source`
  keep asking the printed day alone, as this fix left them.*
- **The several-matches ZIP** is still read as `not_found`
  (`reference-finds-other-transfer`, spec 012).
