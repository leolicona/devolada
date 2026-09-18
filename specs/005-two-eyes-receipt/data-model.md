# Data Model: two-eyes-receipt

**Feature**: 005 · **Date**: 2026-09-17 · **Phase**: 1

One additive migration (`0029_two_eyes_receipt.sql`): columns on
`payments`, `extractions` and `top_ups`. No new table, no drop, no rename.
Money stays integer cents, timestamps milliseconds (constitution II). Every
table touched already carries `business_id` (constitution V).

---

## Reading — the engine's in-memory `Reading` (unchanged storage, one field)

| Field | Type | Change |
| --- | --- | --- |
| `legibility` | `"full" \| "partial" \| "none" \| null` | **New** (R7). Null when the model omitted it (read as `full`). The text variant (a PDF) never produces `none` (D15) |
| everything else | | unchanged: `isReceipt`, `trackingKey`, `senderBank`, `amount`, `date`, `status`, `raw`, `model` |

---

## Classification — the engine's `compare.ts` result (in memory, then stored)

| Field | Values | Meaning |
| --- | --- | --- |
| `readingCheck` | `agreed` \| `disputed` \| `blind` | The three words the minute-two cross already uses (reading-check D2), now taken at minute zero (D5) |
| `disputedFields` | subset of `["trackingKey", "amount", "date"]` | The fields the payer is asked for (D8): `trackingKey` / `amount` on a `disputed` nothing decided; `date` whenever the accepted data has no date, whatever the `readingCheck` (D20) |
| `blindSide` | `provider` \| `reader` \| `both` \| null | Which reading was missing; null unless `blind` |
| `accepted` | `{ trackingKey, senderBank, amountCents, date }` \| null | The structured data later attempts carry through the transfer door (D6, D7); null when the payer must be asked |
| `acceptedFrom` | `agreed` \| `reader` \| `provider` \| null | Which reading the accepted data came from |

The decision table is research R3.

---

## Payment — `payments` (three columns added)

| Column | Type | Meaning |
| --- | --- | --- |
| `reading_check` | enum, existing | Now written at the first call for new rows (D5) and at minute two for legacy rows (D16) |
| `disputed_fields` | text JSON, existing | Unchanged meaning; the page empties exactly these fields |
| `reading_check_attempt` | integer NULL | **New.** The attempt number at which the classification was taken — usually `1` for a provider-first call, higher when the inline attempt never ran (provider down, worker evicted) and the sweep classified. Which *flow* a row followed is the D16 shape, not this number (FR-018) |
| `blind_side` | text NULL | **New.** `provider` \| `reader` \| `both`; set only when `reading_check = 'blind'` |
| `accepted_from` | text NULL | **New.** `agreed` \| `reader` \| `provider` \| `human`. Who supplied the clave, bank, amount and date the transfer-door retries carry. `human` is written when a typed correction supersedes (so the count of "payer asked and answered" is a query) |
| `tracking_key`, `sender_bank`, `transfer_date`, `claimed_amount_cents` | existing | Now also written by the lifecycle from the accepted data (D17). Before this feature they were written only from the payer's form or adopted from the CEP |

**Door rule (D17)**: the next attempt is a transfer call when
`tracking_key`, `sender_bank`, `claimed_amount_cents` **and**
`transfer_date` are all present, a receipt call otherwise. Accepted data
without a date never reaches the transfer door: `disputed_fields` carries
`"date"`, the page asks for it, and the payer's answer supersedes the row
with the date (D20). `proof_mode` keeps meaning what the payer submitted.

**Legacy shape (D16)**: `proof_mode = 'transfer' AND proof_key IS NOT NULL
AND supersedes_id IS NULL AND reading_check IS NULL` identifies a payment
born before the cut-over; only those rows take the minute-two cross.

**State transitions** (unchanged set; one new path):

```text
validating ──(valid, CEP matches)──────────────► confirmed | partial | unapplied
validating ──(contradicted / stale / used)─────► invalid
validating ──(schedule exhausted)──────────────► expired
validating ──(payer corrects)──────────────────► superseded  (a new row is born, accepted_from = human)
validating ──(first call: not_found + classified)──► validating  (reading_check, accepted data written; next door chosen from the row)
```

---

## Reading record — `extractions` (seven columns added)

| Column | Type | Meaning |
| --- | --- | --- |
| `source` | enum, existing | A PDF read at the edge is `reader` now (D1). `provider-ocr` remains for a file nothing here read (no binding, no text) |
| `outcome` | text, existing | Gains `illegible` (the model said `none`, refused before spending, D2) beside `passed`, `gated`, `not_a_receipt`, `unreadable`, `refused`, `routed`. `gated` no longer means "refused": a gated reading now goes to the provider; the word is kept for the row |
| `legibility` | text NULL | **New.** `full` \| `partial` \| `none`, what the model said (R7); null for a text reading or when the model omitted it |
| `reading_check` | text NULL | **New.** As on `payments`; written on the row of the provider-first call, for payments and top-ups alike (D19) |
| `disputed_fields` | text NULL | **New.** JSON array, as on `payments` |
| `blind_side` | text NULL | **New.** As on `payments` |
| `accepted_from` | text NULL | **New.** `agreed` \| `reader` \| `provider`; never `human` here (a typed correction reads nothing) |
| `provider_tracking_key` | text NULL | **New.** What the provider read, verbatim, on the same row as what we read |
| `provider_amount_cents` | integer NULL | **New.** Cents, converted by `amountToCents` in `apicep.ts` as today |
| `validation_id` | existing | Links the provider-first call to its billed row, as today |

**Counts the feature must make possible (FR-018), each one query:**

| Question | Query shape |
| --- | --- |
| Agreed / disputed / blind on first calls | `SELECT reading_check, blind_side, COUNT(*) FROM extractions WHERE validation_id IS NOT NULL AND reading_check IS NOT NULL GROUP BY 1, 2` (legacy crosses have no extraction row of their own; they are the `payments` rows with the D16 shape — `proof_mode = 'transfer' AND proof_key IS NOT NULL AND supersedes_id IS NULL AND reading_check IS NOT NULL` — never "`reading_check_attempt = 2`", because a new-flow row whose inline attempt failed classifies at attempt 2 too) |
| Provider blind while we read fully | `… WHERE blind_side = 'provider' AND gate_tracking_key = 'ok' AND amount_cents IS NOT NULL` |
| Refusals for legibility, credits spent | `SELECT outcome, COUNT(*) FROM extractions WHERE outcome IN ('not_a_receipt', 'illegible') …` — `validation_id` is NULL on every such row, which is the zero |
| PDFs read at the edge vs handed over unread | `SELECT source, outcome, COUNT(*) … WHERE media_type = 'application/pdf'` |
| Reader wrong, provider right (free measurement) | `payments` confirmed with `accepted_from IS NULL` and `tracking_key <> extractions.tracking_key` on the linked row |

---

## Top-up — `top_ups` (no new column)

| Column | Change |
| --- | --- |
| `tracking_key`, `sender_bank`, `transfer_date` | Now also written from the accepted data after a provider-first call (R9), so the next attempt takes the transfer door by the same rule as a payment |
| `claimed_cents` | existing, unchanged: the amount the transfer door searches with |

A top-up the machines could not decide keeps `tracking_key` null and rides
the receipt door on every slot, as today. Its classification lives on the
extraction row.

---

## Validation record — `validations` (unchanged)

One row per billed call as today. A provider-first call is a `mode =
receipt` row; the agreed retries that follow are `mode = transfer` rows for
the same `payment_ref`. The shape rules and the retry cells read it as they
do now.

---

## Contract fields (see `contracts/`)

- `ConstaVerdict` gains `readingCheck`, `disputedFields`, `blindSide`,
  `accepted`, `acceptedFrom`, `ourReading`.
- `ConstaReading` gains `legibility`.
- `proofReadingResponse` gains `legibility`.
- `directPaymentStatusResponse` is unchanged: the page reads
  `readingCheck` (`agreed` | `disputed`, blind stays null on the wire) and
  `disputedFields` as today.
