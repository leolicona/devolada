# Data Model: receipt-triage

**Date**: 2026-09-24 · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

One additive migration, `0036_receipt_triage.sql`: four `ADD COLUMN` on two
existing tables, no new table, nothing dropped, renamed or rebuilt. The PR
preview applies it to the live dev database; every existing row reads NULL on
the new columns and keeps today's meaning. (If `0036` is taken between
planning and implementation, the next free number is used and this line is
amended, as two-eyes-receipt did for `0030`.)

## `payments` — the second key (D1, D9, D12)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `reference_number` | text | yes | The referencia numérica this payment searches with: typed by the payer, or accepted from the readings. One to seven digits, as printed — leading zeros kept, never cast to a number (D10) |

Rules:

- **A key is a clave or a reference.** The lifecycle's `accepted` test
  (two-eyes plan D17, D20) becomes: (`tracking_key` **or**
  `reference_number`) **and** `sender_bank` **and** `claimed_amount_cents`
  **and** `transfer_date`. An accepted row takes the transfer door with
  whichever keys it has; both travel when both are set.
- **Banxico's clave is adopted onto every confirmed row that has none**
  (D12): a row with `reference_number` and no `tracking_key` receives the
  CEP's clave when Banxico confirms, whatever its `proof_mode`. The existing
  unique index `payments_business_tracking_idx` then refuses a second row with
  that clave, racing ones included (direct-payment D8); the existing
  unique-violation branch turns the loser `invalid` with
  `TRANSFER_ALREADY_USED`.
- No index on `reference_number`: references repeat by design (R2), and
  nothing looks a payment up by one.
- **`disputed_fields`** (JSON, existing) gains the value `"referenceNumber"`
  (D11). **`last_error`** (existing) gains `REFERENCE_AMBIGUOUS` (D15): while
  it is set and the row has no clave, a slot does not call the provider.

## `extractions` — what each reading saw (D19)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `proof_key` | text | yes | The proof this row read; its prefix is the link id, which is what lets "how did an ask end" be a query. NULL for rows born before this feature |
| `reference_number` | text | yes | The reference our reader read, as printed, whether or not it passed the gate |
| `provider_reference_number` | text | yes | The reference the provider's picture reading returned, on the paid call's row |

`outcome` gains one value — TypeScript only; the column is text with no CHECK
constraint:

| Outcome | When | Credits |
| --- | --- | --- |
| `key_missing` | A clear SPEI reading with neither a clave nor a reference (D14) | 0 |

Written by the **read** path (`/read`, the free draft) and by the **receipt
door** when a client skipped the page; either way the row has no
`validation_id`.

`gate_reference_number` is not stored: the gate's verdict on the reference is
derivable from `reference_number` (`^\d{1,7}$`), and a derivable column is a
column that can disagree.

## The reading, in the engine (no storage)

- `Reading` (`consta/extraction/reader.ts`) gains `referenceNumber: string |
  null`, asked in the same prompt as `"referenciaNumerica"` — both prompts
  share `FIELDS`, so a PDF's text is asked the same question.
- `Gate` gains `referenceNumber: "ok" | "malformed" | "missing"`;
  `GatedReading` gains `referenceNumber: string | null` (only when `ok`).
  `passes` becomes: (`trackingKey === "ok"` or `referenceNumber === "ok"`) and
  `senderBank === "ok"` and `amount === "ok"`.
- `ProviderReading` (`compare.ts`) gains `referenceNumber`, filled from the
  adapter's `reading.referenceNumber`, which it already parses.
- `Classification.accepted` becomes `{ trackingKey: string | null;
  referenceNumber: string | null; senderBank; amountCents; date }`, at least
  one key set. `DisputedField` gains `"referenceNumber"`.

## The ask (no storage beyond the outcome)

`askBeforeCredit(extracted)` → `null | { fields: AskField[] }`, with
`AskField = "key" | "amount" | "date" | "senderBank"`:

1. Not a reader reading, not a receipt, or not **clear** — `legibility ===
   "full"` on a picture, or a PDF's text (D14) → `null`.
2. The gate's `trackingKey` is not `missing`, or its `referenceNumber` is not
   `missing` → `null`. (A malformed key is a reading, not an absence.)
3. Otherwise → `{ fields }`: `"key"` first, then each of `amount`, `date`,
   `senderBank` whose gate says `missing` (or, for the date, that the reading
   has none), in the form's order.

## State and transitions

No payment status is added or renamed.

- **The ask at the upload** happens before a payment exists. When a client
  skipped the page, the receipt door throws `RECEIPT_INCOMPLETE`; the
  lifecycle's catch turns it into `retryLater("RECEIPT_INCOMPLETE")` with
  nothing billed; the row rides the schedule to `expired` as any row without
  a verdict does.
- **A reference that matches more than one transfer** (D15): `validating` →
  `validating` with `disputed_fields = ["trackingKey"]`, `last_error =
  REFERENCE_AMBIGUOUS`; no further provider call until the payer's correction
  supersedes the row with a clave (two-eyes D18), or the schedule ends in
  `expired`.
