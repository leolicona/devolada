# Bug Assessment: a transfer made after SPEI's 18:00 date change is never found by its reference

- **Slug**: spei-date-rollover
- **Created**: 2026-09-25
- **Source**: pasted text (product creator, in session), plus the dev database
  read the same day and Banxico's *"Información operativa del SPEI"* (PDF,
  "Información actualizada al 30 de junio de 2020"). The creator uploaded the
  PDF into the session, and it was read from the local file. No URL was part of
  the bug report, so the URL Trust Policy did not apply. Web searches made
  during the prior research are listed under **Sources**. Direct fetches of
  `www.banxico.org.mx` and `www.apicep.cloud` were refused by this
  environment's egress proxy (`EGRESS_BLOCKED`), which is why the creator
  supplied the PDF.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> A transfer found by its referencia numérica fails when it was made after
> SPEI's evening date change: Banxico files it under the next operating day
> (the change is at 18:00 Mexico City time "de cada día", per Banxico's
> "Información operativa del SPEI", and Banxico may extend it), while the
> receipt and the payer carry the calendar date. The reference search asks
> Banxico with the wrong day and gets not_found on every retry (Abraham, dev,
> 2026-09-24 23:50 → CEP date 2026-09-25, clave 260925…). Agreed remediation:
> take the transfer's time — from the receipt when it prints one, otherwise the
> submission time — and apply the rule in Mexico City time: from 18:00 on,
> search with the next day, before it with the same day; if that search finds
> nothing, the next retry tries the other day (no extra paid calls), which
> covers Banxico's extended cut-offs and doubtful cases. Only the reference
> search changes; a clave search is untouched. Also: the manual form's default
> "today" and the server's missing-date fallback are computed in UTC; they must
> use the business's day. Out of scope: bank-specific crediting behaviour
> between banks (a later feature) and "Es otra transferencia".

Decisions the product creator made in session (2026-09-25):

- Use the hour: "si es después de la 6 intentar con el día siguiente, sino con
  el día actual".
- Take the hour from the receipt when it prints one, otherwise from when the
  payment was submitted. The form does **not** ask the payer for a time.
- Keep the other day as a fallback on the next retry.
- Interbank crediting behaviour (each bank's own crediting hours) is a later
  feature, not this bug.

### What Banxico says (the uploaded PDF, verbatim)

> "Tiene un horario de operación de 24 horas diarias, 7 días a la semana […]
> Derivado de ese esquema de operación, se establece un horario para que el
> SPEI cambie de fecha, actualmente corresponde a las 18:00 hrs de cada día.
> Sin embargo, en caso de presentarse alguna situación que impida que se preste
> el servicio, el Banco de México puede autorizar la ampliación del horario del
> SPEI o de cambio de fecha." (page 1)

> "El SPEI es un sistema que opera las 24 horas del día, bajo este esquema se
> realiza un proceso de cambio de día de operación que sucede en condiciones
> normales a las 18:00 horas." (page 3, over a chart of the actual change time
> per day, April 2018 – June 2020)

Two consequences for the design:

- **18:00 is Banxico's clock**, which is Mexico City time. It is not the
  business's zone: an ISP in Hermosillo (UTC−7) sees the cut at 17:00 local.
- **18:00 is the normal case, not a guarantee.** On a day with an incident,
  Banxico moves the change later. A rule on the hour alone would guess wrong
  on those days, which is why the fallback stays.

### Evidence (dev D1, read 2026-09-25)

All three receipts of that night were validated through the receipt door. The
reader read the calendar date printed on each one. Banxico's CEP carried the
next day:

| Transfer | Checked (CDMX) | Printed on receipt | CEP (Banxico) | Clave |
| --- | --- | --- | --- | --- |
| Janely | 24 Sep 23:44 | 2026-09-24 | **2026-09-25** | `260925071144378233I` |
| Valentín | 24 Sep 23:46 | 2026-09-24 | **2026-09-25** | `260925071144368901I` |
| Abraham | 25 Sep 00:16 | 2026-09-24 | **2026-09-25** | `260925071144393084I` |

Banco Azteca's clave opens with the operation date (`260925` = 2026-09-25),
which independently confirms the CEP date.

Abraham's first attempt (`d2a101ed`) was typed by reference (`9784417`,
AZTECA, $5.00, date **2026-09-24**) at 23:50 CDMX. Every one of its 7 transfer
door calls asked Banxico about 2026-09-24 and got `invalid / not_found`
(validations at 23:50, 23:52, 23:58, 00:10, 00:35, 01:50 and 05:50 CDMX). No
call ever asked about 2026-09-25.

Production holds no payments yet (`SELECT COUNT(*) FROM payments` → 0 on
`devolada-db-prod`), so there is no wider sample. Nothing in dev falls
between 17:00 and 19:00 or on a weekend.

## Symptom

A payment searched by its referencia numérica (typed with no clave, or a
receipt whose readings settled on the reference) is sent to Banxico with the
calendar date the payer or the receipt gave. When the transfer was made at or
after 18:00 Mexico City time, Banxico filed it under the next operating day.
So every search on the schedule answers `not_found`. The payer is told their
transfer was not found, and the ISP's customer stays cut off. The money has
already arrived, and the row expires after 12 hours.

Expected: a transfer made after the change is searched under the day Banxico
filed it. When the first guess is wrong (an extended cut, a doubtful time),
a later retry finds it with the other day, at no extra cost.

## Reproduction

1. On a panel link, make a SPEI transfer at or after 18:00 CDMX with a
   referencia numérica (no clave used in the form).
2. Submit it by reference on the payment page's manual form, with the date
   printed on the receipt (the calendar day).
3. Every transfer door call carries that date (`validations.transfer_date`),
   and each answers `invalid / not_found` until the row expires.

Reproduced from dev data (Abraham, above). Not yet observed: the same search
with the **next** day finding the transfer. For Abraham it would most likely
have answered `422` (reference shared by three transfers the same night), which
the product already turns into a request for the clave (receipt-triage D17).
[NEEDS CLARIFICATION: confirm on dev with a real transfer after 18:00 that
carries a reference used once; this is `/speckit-bug-test`'s job after the
fix.]

## Suspected Code Paths

- `apps/api/src/direct-payments/validation.ts:452` (`byReference`) and
  `:506-517` (the transfer door request). The search date is always
  `payment.transferDate`, the payer's or the receipt's calendar date, on
  every attempt. There is no notion of the operation date, and no other day
  is ever tried.
- `apps/api/src/direct-payments/validation.ts:509`: the missing-date
  fallback is `now.toISOString().slice(0, 10)`, the UTC date, which is the
  wrong day from 18:00 CDMX on. Today it only reaches rows born before
  the manual form required a date (D20), but it is the same mistake.
- `apps/api/src/direct-payments/validation.ts:668-680` and `:727`: an
  accepted reading (two-eyes D6/D7, receipt-triage D13) writes
  `transferDate: verdict.accepted.date` onto the row, so the next slot takes
  the transfer door (D17). This is how a reference-only **receipt** reaches
  the same search, from its second attempt on.
- `apps/api/src/consta/extraction/compare.ts:356`: `accepted.date` rides our
  reading first (`ours?.date ?? theirs?.date`). The reader's reading is
  where a printed time would come from.
- `apps/api/src/consta/extraction/reader.ts:94` (the prompt's `FIELDS`) and
  `:250` (the parse). The reader asks for `"fecha"` only, so the time a
  receipt prints is never read. `Reading` has no time field
  (`reader.ts:45-71`).
- `apps/api/src/consta/extract.ts:126` and `apps/api/src/db/schema.ts`
  (`extractions`): the reading record stores `transfer_date` and no time.
- `apps/api/src/time/business-day.ts:72` (`businessWallClock`) and `:97`
  (`nextIsoDate`) already give the wall clock in any zone and the next
  calendar day (bug: wisphub-payment-utc-time). The rule needs nothing new
  to tell time.
- `apps/pago/src/features/pago/PaymentPage.tsx:206`: the manual form's
  default date is `new Date().toISOString().slice(0, 10)`, the UTC date.
  From 18:00 to midnight CDMX it proposes tomorrow. The page does not know
  the business's timezone: `linkStatusResponse`
  (`apps/api/src/routes/direct-payments/schema.ts:38`) carries none.
- Not affected: a **clave** search. Measured 2026-08-17 (`validation.ts`,
  the `STALE_TRANSFER_DAYS` comment): apiCEP treats the claimed date as a
  hint, not a filter, when it has the clave. Top-ups
  (`apps/api/src/credit/topups.ts:84`) search by clave only.

## Root Cause Hypothesis

SPEI dates every transfer by its **operation day**, which changes at 18:00
Mexico City time (Banxico, above). Receipts and payers carry the **calendar**
day. A clave finds its CEP whatever date comes with it, so the product never
had to tell the two apart until receipt-triage made the referencia numérica a
key (D1, D11). Banxico needs the operation date to search a reference, and
the lifecycle sends the calendar date, the same one, on every retry. Confidence: **high** that the date is
wrong for transfers after 18:00: three of three CEPs on dev, the Azteca clave
prefix and Banxico's own text. **Medium** that the next-day search finds it: not observed yet,
and the provider's reference search is not documented in any source we could
reach.

## Proposed Remediation

**Preferred**: decide the search date from the transfer's time, and keep the
other day as the fallback.

1. **Read the time from the receipt.** The reader's prompt adds
   `"hora": "<the time of the operation as HH:MM, 24-hour, or null>"`,
   and `Reading` gains `time`. Anything not matching `^\d{2}:\d{2}$`
   (hours 00–23, minutes 00–59) is dropped to null, the way the other fields
   are. The reading record stores it in a new nullable
   `extractions.transfer_time` (migration `0037`, via
   `pnpm --filter @devolada/api db:generate`). Nothing else about the reading
   changes. The engine's comparison, gate and `accepted` stay as they are.
2. **One pure helper decides the two dates**, for example
   `searchDates({ date, time, submittedAt })` beside the schedule. It returns
   `{ primary, alternate }`, both in Mexico City time, always
   `America/Mexico_City`, whatever the business's zone:
   - with a printed time: `time ≥ 18:00` → primary is the next day, alternate
     is the printed date; otherwise primary is the printed date, alternate is
     the next day;
   - with no time: the submission instant (`payments.created_at`) read on
     Mexico City's wall clock. Submitted before 18:00 on the date given →
     primary is that date (certain: the transfer came before its submission).
     Submitted at or after 18:00 on that date, or on a later day → primary is
     the next day (the likely case, since the page flow is transfer then
     submit).

   The time is looked up at request time from the row's own proof: the latest
   reader extraction for `payment.proof_key` with a time, used **only** when
   that extraction's date equals the row's `transfer_date`. This ensures the
   time belongs to the date being searched. A typed row with no proof uses
   the submission instant.
3. **Alternate on the retries, only for a reference search.** The first
   by-reference call asks the primary date. Each later by-reference call asks
   the other date from the one the row's previous by-reference call asked.
   That is read from the row's last validation record (`consta_validation_id`
   → `validations.transfer_date`, `mode = 'transfer'`,
   `reference_number` set). Anything else asks the primary date. No extra paid
   calls: it rides the D7 schedule and the late slot as today. A clave search
   keeps sending the row's own date, unchanged.
4. **When Banxico finds it on either day**, nothing new is needed: the CEP's
   clave, bank and date are adopted by the row as today (receipt-triage D14,
   `adoptKey`), so the row ends up holding the operation date.
5. **"Today" belongs to the business.** The server fallback at
   `validation.ts:509` uses `businessWallClock(business.timezone, now).date`.
   `linkStatusResponse` gains `timezone`, sent on a `debt` answer (the
   business's IANA zone, which is not sensitive). The manual form computes
   its default date with `Intl.DateTimeFormat` in that zone, and falls back
   to `America/Mexico_City` when an older API does not send it.

**Alternatives**:
- *The fallback alone, no time.* Alternate the two days from the first retry,
  with no reader change, no migration and no submission rule. It finds the
  transfer at most one slot later (the first retry is at +2 min). It is simpler,
  but the product creator asked for the hour rule, and a printed time gets it
  right on the first call.
- *Both days on every attempt.* It is found on the first call either way,
  but it doubles the paid calls of every `not_found`, for a delay the
  alternation already keeps to minutes. Not recommended.
- *Compute the operation date once and store it on the row.* It would
  overwrite the payer's or the receipt's own date (the human's data,
  two-eyes FR-015) with a guess. Rejected: the row keeps what was given, and
  the search date is derived.

**Files likely to change**:
- `apps/api/src/consta/extraction/reader.ts`: the `hora` field, `Reading.time`
- `apps/api/src/consta/extract.ts`: writes `transferTime`
- `apps/api/src/db/schema.ts` and a new `apps/api/migrations/0037_*.sql`:
  `extractions.transfer_time`
- `apps/api/src/direct-payments/schedule.ts` (or a new
  `apps/api/src/direct-payments/search-date.ts`): the pure `searchDates`
  helper
- `apps/api/src/direct-payments/validation.ts`: the search date for a
  reference search, the time lookup, the alternation, and the fallback in the
  business's day
- `apps/api/src/routes/direct-payments/schema.ts` and `handler.ts`:
  `timezone` on `linkStatusResponse`
- `apps/pago/src/features/pago/PaymentPage.tsx`: the manual form's default
  date
- Tests: `apps/api/test/direct-payment.test.ts` (or a new
  `apps/api/test/spei-date-rollover.test.ts`), the reader's tests under
  `apps/api/test/consta/`, `apps/pago/test/pago.test.tsx`, and the
  MSW/Playwright fixtures that validate `linkStatusResponse`

**Tests to add or update** (each citing `bug: spei-date-rollover`):
- `searchDates` (pure): 17:59 → same day first; 18:00 → next day first;
  23:50 → next day first; a printed time wins over the submission instant; no
  time and submitted before 18:00 → same day; no time and submitted the next
  morning → next day first; month and year ends (`2026-12-31` →
  `2027-01-01`); a Hermosillo business still uses Mexico City's 18:00.
- The lifecycle, typed by reference, submitted at 23:50 CDMX with date D: the
  first provider call carries D+1 (`sender.date`). After its `not_found`, the
  next swept attempt carries D, then D+1 again.
- The lifecycle, typed by reference, submitted at 14:00 CDMX: the first call
  carries D.
- A clave search submitted at 23:50: every call carries the row's own date
  (unchanged).
- A receipt whose reading printed `23:40` and settled on a reference: the
  first transfer door call carries the next day, even when it was submitted the
  next morning. A reading whose date differs from the row's date contributes no
  time.
- Found on the alternate day: the row adopts Banxico's clave and date, and
  confirms (the existing D14 path, now reached through the other day).
- The reader: `"hora": "23:47"` is read to `time`; `"25:10"`, `"7pm"` and a
  missing field read as null; the reading record stores it.
- The server fallback for a row without a date uses the business's day: at
  20:00 CDMX it is today, not tomorrow.
- The payment page: with the system clock at 02:00Z (20:00 CDMX the day
  before) and `timezone: "America/Mexico_City"`, the manual form proposes
  the CDMX date, not the UTC one. It passes axe.

## Risks & Considerations

- **Receipts that already print the operation date.** Some banks may print the
  date they applied (already rolled) next to an evening time. The rule would
  then add one day too many on the first call. The fallback asks the printed
  date on the next retry, which is why it is not optional. The first call is
  wasted; nothing is lost.
- **The reader prompt changes.** The reader is still unmeasured on real
  receipts (debt `receipt-triage-reader-unmeasured`). Adding one field could
  move its other answers. The change is additive and the gate still judges
  every field, but the measurement the debt asks for should include `hora`.
- **The time a receipt prints is assumed to be Mexico City time**, as bank apps
  in Mexico print. A bank that printed the device's zone would shift the rule by
  that zone's offset for one call; the fallback covers it.
- **Weekends and holidays.** The PDF says the change happens "de cada día",
  which reads as every calendar day, weekends included, so +1 is right. It
  does not say so explicitly. If a Saturday transfer were filed under Monday,
  neither date would find it. Each attempt's date is recorded in
  `validations.transfer_date`, so the first real case will show it.
- **An extended cut (Banxico moves the change later).** A transfer between
  18:00 and the extended change keeps the same day. The first call asks the
  next day and misses; the retry asks the same day. Covered by the fallback.
- **A wrong match on the alternate day.** Asking the next day could find
  another transfer from the same account with the same reference, bank,
  amount and receiving account on that day: the payer's own next payment. The
  money is theirs and the business's, and the adopted clave keeps it from
  paying twice (direct-payment D8).
- **`sharedReference` (receipt-triage D7)** keeps comparing the row's own
  date, not the search date. It guards against *other* payments with the same
  five data. A mismatch there costs one provider call that the provider's 422
  answers, and it is not changed here.
- **API contract.** `linkStatusResponse.timezone` is additive and optional for
  a client. The fixtures that validate the schema need the field only when a
  test asserts it.
- **Migration.** One nullable column on `extractions`. Production is several
  migrations behind already (no `proof_key` on its `extractions`), so this
  joins the queue that the first release tag applies.
- **Observability.** The date each attempt asked is already on its validation
  record. When a row is found on the alternate day, log that once, so it can
  be counted how often the first guess missed.

## Open Questions

- [NEEDS CLARIFICATION: weekends and holidays. Does SPEI change the operation
  date at 18:00 on non-business days to the next *calendar* day (as "de cada
  día" suggests), or to the next business day? Banxico's Circular 14/2017 as
  amended (Circular 9/2026) may say. Until then the fix uses +1, and the first
  weekend case will show it.]
- [NEEDS CLARIFICATION: confirmation that a reference search with the correct
  operation date finds a transfer whose reference was used once. Verified on
  dev after the fix, by `/speckit-bug-test`.]

## Sources

- Banxico, *Información operativa del SPEI* (30 Jun 2020), uploaded by the
  product creator:
  <https://www.banxico.org.mx/spei/d/%7B280E813D-23AC-1EB6-5447-FA1786A129CB%7D.pdf>
- Banxico, *Comprobante Electrónico de Pago*: the CEP is searched by operation
  date, clave or reference, banks, account and amount:
  <https://www.banxico.org.mx/cep/>
- Secondary sources consistent with the 18:00 change:
  [Kapital](https://kapital.com/blog/educacion-financiera/spei-horarios-limites-comisiones),
  [Compartamos](https://www.compartamos.com.mx/compartamos/blog/emprendamos/spei-horarios-limites-y-tiempos-de-acreditacion),
  [Dock](https://dock.tech/es/fluid/blog/financiero/spei/)
- apiCEP documentation (not reachable from this environment; summarized by
  search): <https://www.apicep.cloud/documentacion>
