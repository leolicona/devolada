# Bug Assessment: a reference search asks the next calendar day, not Banxico's next business day

- **Slug**: reference-search-business-day
- **Created**: 2026-09-26
- **Source**: pasted text (product creator, in session, with photos of two
  Banco Azteca receipts from the morning of Saturday 2026-09-26), plus a
  read-only look at the dev D1 the same day. No URL supplied, so the URL
  Trust Policy did not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> "Revisa los dos últimos pagos de esta mañana, en el recibo solo aparece el
> número de referencia. El primero se validó exitoso, el segundo está en
> proceso." — and then: "¿Por qué la primera de esta mañana pasó? Y la
> segunda no?"

Both receipts: Banco Azteca, $3.00, Saturday 26/Sep/2026 (07:08:13 and
07:10:58 CST), Cuenta origen "Guardadito ***8301", Cuenta destino "Bbva
Mexico ***417", Referencia 9784417.

## Symptom

A transfer made on a Saturday was filed by Banxico under Monday 28 — the
next SPEI business day, as the Azteca claves themselves show (`260928…`).
The payment found by reference asked Banxico about Saturday 26, then
Sunday 27, and got `not_found` both times; it will keep asking those two
days until it expires. Expected: a reference search asks the operation day
Banxico files the transfer under, which skips Saturdays, Sundays and SPEI
holidays.

## Reproduction

Observed on dev (read-only, 2026-09-26):

1. Payment `91c62db4-…` (Abraham), created 13:13:27 UTC from the 07:10:58
   CST receipt. Our reading and the provider's agreed (`reading_check =
   agreed`): referencia 9784417, AZTECA, $3.00, date 2026-09-26, no clave.
2. `validations`: 13:13:44 receipt door `not_found` (15.7 s); 13:16:26
   transfer door by reference with **2026-09-26** → `not_found`; 13:22:23
   transfer door with **2026-09-27** → `not_found`.
3. The sister payment `905cefcc-…` (Janely, the 07:08:13 receipt) was found
   on the receipt door, where the provider searches on its own: `valid`,
   clave `260928071156202040I`, CEP date **2026-09-28**.
4. The two receipts of the night before (Friday 25, 18:58 and 22:46) have
   CEP dates 2026-09-28 as well — Friday after 18:00 rolls to Monday, not
   to Saturday.

In tests: a row found by reference, dated a Saturday (or a Friday with a
printed time ≥ 18:00), asks `searchDates` for its days — today it answers
the calendar day and the next calendar day.

## Suspected Code Paths

- `apps/api/src/direct-payments/search-date.ts::searchDates` — `next` is
  `nextIsoDate(args.date)`, the next calendar day. A transfer before 18:00
  on a Saturday, Sunday or holiday is filed "the day printed", which is not
  a SPEI operation day at all.
- `apps/api/src/direct-payments/search-date.ts::nextSearchDate` — alternates
  between those two days only; neither can be right on a weekend.
- `apps/api/src/direct-payments/validation.ts::referenceSearch` — feeds it.
- The bug `spei-date-rollover` (fixed 2026-09-25, `.specify/bugs/spei-date-rollover/`)
  introduced the rule; its assessment covers the 18:00 change and not the
  business-day calendar.

## Root Cause Hypothesis

`spei-date-rollover` modelled SPEI's operation day as "the calendar day,
or the next one from 18:00". Banxico's operation day is a **business** day:
transfers made on a Saturday, a Sunday, a bank holiday, or after the 18:00
change on the last business day before them, are filed under the next
business day. The Azteca claves encode it (`2609 28 …` for Friday-night and
Saturday-morning transfers) and every CEP returned since agrees. So every
weekend or holiday transfer found by reference is searched on days that
cannot hold it. Confidence: **high** for the weekend (four CEPs dated the
28th for transfers made Friday 18:58 → Saturday 07:10); **medium** for the
holiday calendar (not observed yet, but the same rule by Banxico's
definition).

## Proposed Remediation

**Preferred**: make the operation day a business-day rule. `searchDates`
computes the **primary** day as: the date printed if it is a SPEI business
day and the time (or the submission) is before 18:00; otherwise the next
SPEI business day after it. The **alternate** stays the other plausible
day (the printed date when it is a business day; else the previous rule's
choice), so an unusual bank that prints the operation day still finds its
transfer on the second try, at no extra cost. SPEI business days are
Monday–Friday minus Banxico's SPEI non-business days; the holiday list is
data with a year on it, kept beside the code and failing a check when the
next year is missing (the `gen-banks --check` pattern).

**Alternatives**:
- *Weekends only, no holiday list*: covers the case seen today and every
  weekend; fails silently on the ~8 SPEI holidays a year.
- *Ask the provider's receipt door again instead of searching by reference*:
  the provider found the 07:08 receipt by itself. But it answered
  `not_found` for the 07:10 one, and two-eyes-receipt D17 moves an agreed
  reading to the transfer door on purpose.

**Files likely to change**:
- `apps/api/src/direct-payments/search-date.ts`
- a SPEI calendar module (+ data file with the non-business days) under
  `apps/api/src/time/` or `direct-payments/`
- `apps/api/test/spei-date-rollover.test.ts` (or a new file citing this bug)

**Tests to add or update**:
- Saturday 07:10 → primary Monday; Friday 18:58 → primary Monday; Sunday
  23:00 → primary Monday; a weekday 10:00 → same day; a holiday → next
  business day; the day before a holiday after 18:00 → the day after it.
- The payment's attempts ask the primary, then the alternate, as today.
- The calendar check fails when the current or next year has no holiday list.

## Risks & Considerations

- **Ambiguity grows on business days.** Every transfer of a weekend lands
  on Monday, so a reference shared by several payers of the same amount is
  more likely to match more than one transfer on that day. This is bug
  `reference-finds-other-transfer`; the two fixes are designed together.
- **The clave path.** `search-date.ts` states a clave "finds its CEP
  whatever date comes with it (measured 2026-08-17)". Today's dev data
  disagrees at least once: clave `260928071155271843I` with 2026-09-26 was
  `not_found` five times, and with 2026-09-28 once (10:51 UTC), although the
  receipt door found it `valid` at 06:51 UTC. **Resolved 2026-09-26, 14:19
  UTC**: the clave path needs no change. Abraham's transfer (Saturday 07:10,
  filed under Monday 28) was found `valid` by clave `260928071156210101I`
  asked with **2026-09-26** (validation `transfer`, 8.3 s; payment
  `9d78ee65-…` confirmed). The earlier clave `not_found`s were wrong input,
  not a wrong date: `2609280711562101011` was the same clave typed with a
  final `1` for the `I`. The one unexplained miss left is
  `260928071155271843I` with 2026-09-28 at 10:51 UTC.
- The holiday list is a new piece of data to keep up to date each year.

## Measured 2026-09-26

`../reference-finds-other-transfer/measurement.md` holds 15 direct apiCEP
calls (`scripts/apicep-probe.sh`). What they settle for this bug:

- **Weekend**: Saturday transfers are filed under Monday 28, and a search
  with the printed Saturday date finds them as well as one with the 28th
  (cases E3, F4). The primary/alternate pair of the remediation is right,
  and the printed day is a safe alternate.
- **18:00**: the three Thursday 23:40–23:48 transfers carry operation day
  Friday 25 in their CEPs (E6's ZIP, opened), so the rollover from
  `spei-date-rollover` holds for filing. But the search found them only
  when asked with the **24th** (their credit day), not with the 25th (E7).
  Across the run the credit day never missed and the operation day missed
  once. **Lot 3 (same day, 9 more calls) closed it**: a Friday-night
  transfer answers by clave to its printed day (25) and to none of 26, 27,
  28; a Thursday-night one to 24 and not to 25. The operation day found
  nothing in direct mode. So the search asks **the printed day, first and
  only**; the Monday is the one alternate worth a call, for weekend
  transfers. The business-day rule keeps its place for what is recorded
  and compared, not for what is asked. See `measurement.md`, "Lot 3".
  **Banxico by batch (same day, folio A0E0097211) put it beyond the
  provider**: 16 claves asked with their credit day, 16 CEPs; 14 asked
  with their operation day, 14 "no se pudo localizar". Banxico's query
  indexes the credit day only. The remediation's "primary = next business
  day" is therefore **wrong for the search** and must not be built; the
  business-day calendar is still right for what Devolada records.

## Open Questions

- [NEEDS CLARIFICATION: the source for SPEI non-business days — Banxico
  publishes them yearly; confirm the list for 2026 and 2027.]
- ~~Does the transfer door need the operation day for a clave search too?~~
  No — measured 2026-09-26, see the clave path above.
