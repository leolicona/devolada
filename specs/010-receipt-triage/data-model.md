# Data Model: receipt-triage

**Date**: 2026-09-24 · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

One additive migration, `0036_receipt_triage.sql`: twelve `ADD COLUMN` on
three existing tables, no new table, nothing dropped, renamed or rebuilt. The
PR preview applies it to the live dev database; every existing row reads NULL
on the new columns and keeps today's meaning. (If `0036` is taken between
planning and implementation, the next free number is used and this line is
amended, as two-eyes-receipt did for `0030`.)

## `businesses` — the card and the phone (D9, D26)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `spei_card` | text | yes | 16 digits, passes the Luhn check. A debit card that receives SPEI |
| `spei_card_bank` | text | yes | A name from the provider's vocabulary (`BANKS`). Set iff `spei_card` is set |
| `spei_phone` | text | yes | 10 digits. A phone registered with its bank to receive transfers |
| `spei_phone_bank` | text | yes | A name from `BANKS`. Set iff `spei_phone` is set |

- In the `clabe` area (owner only), like `spei_clabe`
  (business-and-memberships D3). Roles that cannot update settings read them
  masked to the last four digits.
- `spei_clabe` stays required for the channel: `configured` is unchanged. A
  card or a phone without a CLABE is stored but offers nothing on the page.
- **The ISP's receiving accounts**, in the order the page shows them: CLABE,
  card, phone — each `{ kind: "clabe" | "card" | "phone", value, bank }`, the
  ones that are set.

## `payments` — the second key and the account (D1, D3, D10, D25)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `reference_number` | text | yes | The referencia numérica this payment searches with: typed by the payer, or accepted from the readings. One to seven digits, as printed — leading zeros kept, never cast to a number (D12) |
| `beneficiary` | text (JSON) | yes | `{ kind, value, bank }` — the account this payment is checked against. Set at submission when the ISP has one account, or when the payer chose one; set from the engine's `beneficiaryUsed` otherwise |
| `beneficiary_candidates` | text (JSON) | yes | Array of the same objects: the ISP's accounts **at submission**, set only when there were more than one |

Rules:

- **A key is a clave or a reference.** The lifecycle's `accepted` test
  (two-eyes plan D17, D20) becomes: (`tracking_key` **or**
  `reference_number`) **and** `sender_bank` **and** `claimed_amount_cents`
  **and** `transfer_date` — **and**, when `beneficiary_candidates` is set,
  `beneficiary` (D23). An accepted row takes the transfer door with whichever
  keys it has; both travel when both are set.
- **An attempt reads the account from the payment, never the business**
  (FR-021). `beneficiary` set → that account on either door; else
  `beneficiary_candidates` → the receipt door with the list; else — a row
  born before this feature — today's fallback, the business's CLABE (FR-027).
- **Banxico's clave is adopted onto every confirmed row that has none** (D14):
  a row with `reference_number` and no `tracking_key` receives the CEP's clave
  when Banxico confirms, whatever its `proof_mode`. The existing unique index
  `payments_business_tracking_idx` then refuses a second row with that clave,
  racing ones included (direct-payment D8); the existing unique-violation
  branch turns the loser `invalid` with `TRANSFER_ALREADY_USED`.
- No index on `reference_number` (references repeat by design) or on
  `beneficiary` (nothing looks a payment up by account).
- **`disputed_fields`** (JSON, existing) gains `"referenceNumber"` (D13).
  **`last_error`** (existing) gains `REFERENCE_AMBIGUOUS` (D17): while it is
  set and the row has no clave, a slot does not call the provider.

## `extractions` — what each reading saw (D21)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `proof_key` | text | yes | The proof this row read; its prefix is the link id, which is what lets "how did an ask end" be a query |
| `reference_number` | text | yes | The reference our reader read, as printed, whether or not it passed the gate |
| `provider_reference_number` | text | yes | The reference the provider's picture reading returned, on the paid call's row |
| `destination_kind` | text | yes | `clabe \| card \| phone \| account` as the reader saw it |
| `destination_digits` | text | yes | The digits the reader could see, masks removed |

`outcome` gains two values — TypeScript only; the column is text with no
CHECK constraint:

| Outcome | When | Credits |
| --- | --- | --- |
| `key_missing` | A clear SPEI reading with neither a clave nor a reference (D16) | 0 |
| `wrong_destination` | A clear reading whose destination (≥ 3 visible digits) ends none of the ISP's accounts (D24) | 0 |

Written by the **read** path (`/read`, the free draft) and by the **receipt
door** when a client skipped the page; either way the row has no
`validation_id`. The ISP's accounts are never written on this table — only
what the reading itself saw.

## The reading, in the engine (no storage)

- `Reading` (`consta/extraction/reader.ts`) gains `referenceNumber: string |
  null` (`"referenciaNumerica"`) and `destination: { kind, digits }`
  (`"destino": { "tipo", "digitos" }`), asked in the same prompt — both
  prompts share `FIELDS`, so a PDF's text is asked the same questions.
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

`askBeforeCredit(extracted, accounts)` → `null | { reason: "no_key", fields:
AskField[] } | { reason: "wrong_destination" }`, with `AskField = "key" |
"amount" | "date" | "senderBank" | "account"`:

1. Not a reader reading, not a receipt, or not **clear** — `legibility ===
   "full"` on a picture, or a PDF's text (D16) → `null`.
2. `tieDestination(reading.destination, accounts)` (D24) is `"none"` →
   `wrong_destination`.
3. The gate's `trackingKey` is not `missing`, or its `referenceNumber` is not
   `missing` → `null`. (A malformed key is a reading, not an absence.)
4. Otherwise → `no_key` with `fields`: `"key"` first, then each of `amount`,
   `date`, `senderBank` the reading lacks, then `account` when the ISP has
   more than one and the destination did not tie — in the form's order.

`tieDestination(destination, accounts)` → `{ tied: account } | "unknown" |
"none"`: visible digits with everything but digits removed; fewer than three
→ `"unknown"`; forms per account — the CLABE's 18 digits and its 11-digit
account segment (positions 7–17), the card's 16, the phone's 10, narrowed by
`destination.kind` when known; the visible digits must **end** a form; exactly
one account → `tied`, more than one → `"unknown"`, none → `"none"`.

## State and transitions

No payment status is added or renamed.

- **The ask at the upload** happens before a payment exists. When a client
  skipped the page, the receipt door throws `RECEIPT_INCOMPLETE` or
  `RECEIPT_WRONG_DESTINATION`; the lifecycle's catch turns it into
  `retryLater(code)` with nothing billed; the row rides the schedule to
  `expired` as any row without a verdict does.
- **A reference that matches more than one transfer** (D17): `validating` →
  `validating` with `disputed_fields = ["trackingKey"]`, `last_error =
  REFERENCE_AMBIGUOUS`; no further provider call until the payer's correction
  supersedes the row with a clave (two-eyes D18), or the schedule ends in
  `expired`.
- **An unknown account** (D23): the row rides the receipt door with the list
  until an attempt ties it (`beneficiary` written from `beneficiaryUsed`) or a
  typed correction names it.
