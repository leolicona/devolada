# Bug Assessment: a reference search alternates between the printed day and the next day; it must ask the printed day only

- **Slug**: reference-search-printed-day
- **Created**: 2026-09-27
- **Source**: pasted text (product creator, in session), plus a read-only
  look at the dev D1 the same day. No URL supplied, so the URL Trust Policy
  did not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> "Actualmente la validacion de recibos a traves de numero referencia alterna
> entre la fecha actual y la fecha del dia siguiente. EL comportamamiento
> esperado es que solo consulte por la fecha impresa en el recibo impresa."

## Symptom

A payment searched by referencia numérica asks Banxico for the **next** day
whenever the receipt printed a time from 18:00 on, or, with no printed time,
whenever it was submitted from 18:00 on. After a `not_found`, the next
attempt asks the other day, and so on, alternating. Expected: every search
asks the **day printed on the receipt** (or typed by the payer), and a retry
asks that same day again.

## Evidence

- **Banxico's batch** (`cep-scl`, folio A0E0097211, 2026-09-26;
  `../reference-finds-other-transfer/measurement.md`): 16 of 16 transfers
  found with the printed day, 0 of 14 with the operation day. The operation
  day is the next business day for a transfer after 18:00 or on a weekend.
  The rule `spei-date-rollover` introduced asks exactly that day first.
- **apiCEP by clave**: two night transfers were found only with their
  printed day. The Friday 18:58 one answered to 25 and not to 28 (G1, G4);
  the Thursday 23:40 one answered to 24 and not to 25 (G6, G7).
- **Dev, 2026-09-26** (Juan Fernando's link): a Nu receipt printed Saturday
  19:21, referencia 260926, $3.00. The transfer door searched by reference
  at 19:24:57 with **2026-09-27**, the next day the rule picked because the
  submission came after 18:00. The same transfer was found at 19:40 by clave
  with **2026-09-26**, its printed day.
- The assessment `reference-search-business-day` already recorded, after
  the measurement, that its remediation ("primary = next business day") is
  wrong for the search and must not be built.

## Reproduction

1. Create a payment by reference with `transferDate` = D and a submission
   (or a printed time) at or after 18:00 Mexico City on D.
2. Run the validation: the transfer-door request carries `date` = D+1.
3. Let the provider answer `not_found`; run it again: `date` = D.
4. Again after a `not_found`: D+1.

`apps/api/test/direct-payment.test.ts`, "typed by reference at 23:50: the
next day first, then the day typed, then the next again", pins this
behaviour as intended today.

## Suspected Code Paths

- `apps/api/src/direct-payments/search-date.ts`: `searchDates()` picks
  `{primary, alternate}` from the printed time or the submission against
  18:00; `nextSearchDate()` flips between them after a `not_found`.
- `apps/api/src/direct-payments/validation.ts`:
  - `referenceSearch()` (~line 1505) reads the printed time and the
    previous call, and returns the day to ask.
  - `runValidation`: the request's `date: search?.date ?? …` (~line 567),
    and the `spei-date-rollover` log line comparing `search.date` with
    `search.primary` (~line 859).
- `apps/api/test/spei-date-rollover.test.ts` (the `searchDates` and
  `nextSearchDate` unit tests) and the `bug: spei-date-rollover` block of
  `apps/api/test/direct-payment.test.ts` pin the old rule.

## Root Cause Hypothesis

`spei-date-rollover` (2026-09-25) assumed a reference search must carry the
operation day Banxico files a transfer under, because a Thursday-night
reference had failed with its printed day. The measurement of 2026-09-26
showed the opposite: Banxico's CEP query answers only the printed (credit)
day. The Thursday-night miss was not a wrong date; the batch found those
transfers with the printed day. Confidence: **high**. The rule is visible
in the code, and the dev log shows the next day asked.

## Proposed Remediation

**Preferred**: a reference search asks `payment.transferDate`, the day the
receipt printed or the payer typed, on every attempt. It asks the business's
day only when the row has no date, as the clave path already does. Concretely:

- Remove `referenceSearch()` and the `search` value from `runValidation`.
  The request's `date` becomes `payment.transferDate ??
  businessWallClock(business.timezone, now).date` for a clave and a
  reference alike.
- Remove the log line that compares the day found with the first guess.
- Remove `searchDates` and `nextSearchDate` from `search-date.ts`, together
  with the file if nothing else uses it.
- Keep what the reader stores: the printed time
  (`extractions.transfer_time`). It no longer decides the date, but it is
  the key to picking one CEP out of a several-matches ZIP (spec 012) and
  costs nothing.
- The comments cite this slug and the measurement, and say the rule of
  `spei-date-rollover` for the search is retired. That rule still holds
  for what is **recorded**: the CEP's operation day.

**Alternatives**:

- Keep the alternation with the printed day first and the next day as the
  alternate. The batch says the next day finds nothing at Banxico (0 of
  14), so every alternate is a paid call that cannot succeed. Apart from
  that, apiCEP answered the Monday for Saturday transfers, which is
  undocumented provider behaviour. Not recommended.

**Files likely to change**:

- `apps/api/src/direct-payments/validation.ts`
- `apps/api/src/direct-payments/search-date.ts` (removed, or reduced)
- `apps/api/test/direct-payment.test.ts`: the `bug: spei-date-rollover`
  block
- `apps/api/test/spei-date-rollover.test.ts`: the `searchDates` and
  `nextSearchDate` unit tests (the reader tests stay)

**Tests to add or update** (`bug: reference-search-printed-day`):

- A reference typed at 23:50 with day D: every attempt, including after a
  `not_found`, asks D.
- A receipt that printed 23:40 on D, submitted the next morning: asks D.
- A Saturday receipt printed after 18:00: asks the Saturday, never the
  Monday.
- A `pending` answer asks the same day again (unchanged).
- A clave search keeps the row's own date (unchanged).
- A row with no date asks the business's day, not the UTC one (unchanged).
- The tests that pinned the alternation are replaced, not skipped: the
  behaviour they asserted is the defect.

## Risks & Considerations

- **Nothing on the row changes.** No migration, and the API contract is
  unchanged.
- **Rows open right now** that are mid-alternation simply ask their printed
  day on the next slot.
- **Retries on the same day cost the same credits as before**, but no
  longer spend half of them on a day that cannot answer.
- **A payer who typed the wrong day is not rescued by this search.**
  Before, the alternation covered the next day by accident. Spec 012
  (scenario 5) plans the neighbouring calendar days for that case. Out of
  scope here.
- **`sharedReference` compares `payments.transfer_date`**, and a confirmed
  receipt-door row overwrites it with the CEP's operation day (`adoptKey`).
  So a new reference row with printed day D does not see a confirmed row
  stored with D+1 or the Monday. This gap exists today and this fix does
  not change it; worth its own bug.

## Open Questions

- None blocking. The creator stated the expected behaviour, and the batch
  measured it.
