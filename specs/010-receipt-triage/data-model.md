# Data Model: receipt-triage

**Date**: 2026-09-23 · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

One additive migration, `0036_receipt_triage.sql`: ten `ADD COLUMN` across
three existing tables, no new table, nothing dropped, renamed or rebuilt. The
PR preview applies it to the live dev database; every existing row reads NULL
on the new columns and keeps today's meaning. (If `0036` is taken between
planning and implementation, the next free number is used and this line is
amended, as two-eyes-receipt did for `0030`.)

## `businesses` — two more receiving identifiers (D1, D13)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `spei_card` | text | yes | 16 digits, passes the Luhn check. A debit card that receives SPEI |
| `spei_card_bank` | text | yes | A name from the provider's vocabulary (`BANKS`). Set iff `spei_card` is set |
| `spei_phone` | text | yes | 10 digits. A phone registered with its bank to receive transfers |
| `spei_phone_bank` | text | yes | A name from `BANKS`. Set iff `spei_phone` is set |

- Belong to the `clabe` area (owner only), like `spei_clabe`
  (business-and-memberships D3). Roles that cannot update settings read them
  masked to the last four digits.
- `spei_clabe` stays required for the channel: `configured` is unchanged
  (`spei_clabe` set and `spei_bank` in the vocabulary). A card or a phone
  without a CLABE is stored but offers nothing on the page.
- **Receiving identifiers** of a business, in the order the page shows them:
  CLABE, card, phone — each `{ kind, value, bank }`, the ones that are set.

## `payments` — the identifier the money went to (D9, D10, D12)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `beneficiary` | text (JSON) | yes | `{ "kind": "clabe" \| "card" \| "phone", "value": "<digits>", "bank": "<BANKS name>" }` — the identifier this payment is checked against. Set at submission when the business has one identifier, or when the payer chose one on the manual door; set by the lifecycle from the engine's `beneficiaryUsed` otherwise |
| `beneficiary_candidates` | text (JSON) | yes | Array of the same objects: the business's identifiers **at submission**, set only when there were more than one |

Rules:

- **An attempt reads the payment, never the business** (FR-017). Beneficiary
  for the next attempt: `beneficiary` if set → the receipt or transfer door
  with it; else `beneficiary_candidates` → the receipt door with the list;
  else (a row born before this feature) → today's fallback, the business's
  CLABE (FR-022).
- **The transfer door needs a known beneficiary** (D10). The lifecycle's
  `accepted` test (clave, bank, amount, date — two-eyes plan D17, D20) gains
  a fifth condition when `beneficiary_candidates` is set: `beneficiary` is
  set. Until then the row keeps the receipt door with the candidate list.
- **A Spin sending bank must be established** (D14). Accepted data from a
  machine reading whose bank is `SPIN BY OXXO` counts as accepted only when
  the engine established the institution from the origin account's prefix —
  and then carries that institution (`SPIN BY OXXO` or `STP`). A typed bank
  always counts (two-eyes FR-015). `STP` read as such is untouched.
- The platform's own top-ups (`top_ups`) are unchanged: one CLABE, the
  platform's.

## `extractions` — what each reading saw (D15, D19)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `proof_key` | text | yes | The proof this row read. Its prefix is the link id, which is what lets "how did an ask end" be a query (R12). NULL for rows born before this feature and for readings with no proof key |
| `destination_kind` | text | yes | `clabe \| card \| phone \| account` as the reader saw it (Spanish on the wire: `clabe \| tarjeta \| celular \| cuenta`) |
| `destination_digits` | text | yes | The digits the reader could see, masks removed |
| `operation` | text | yes | `spei \| same_institution \| cash` as the reader saw it (wire: `spei \| misma_institucion \| efectivo`) |

`outcome` gains three values — TypeScript only, the column is text and has no
CHECK constraint:

| Outcome | When | Credits |
| --- | --- | --- |
| `key_missing` | A clear SPEI reading with no clave (D6, D7) | 0 |
| `not_spei` | A clear Spin reading of a movement inside Spin or a cash-in, with no clave printed (D15) | 0 |
| `wrong_destination` | A clear reading whose destination (≥ 3 visible digits) ends none of the business's identifiers (D11) | 0 |

These are written by the **read** path (`/read`, the free draft) and by the
**receipt door** when a client skipped the page; either way the row costs
nothing and has no `validation_id`.

## The reading, in the engine (no storage)

`Reading` (`consta/extraction/reader.ts`) gains three fields, asked in the
same prompt, English identifiers over Spanish JSON keys as today:

| Field | JSON key | Values |
| --- | --- | --- |
| `destination` | `destino` | `{ kind: "clabe" \| "card" \| "phone" \| "account" \| null, digits: string \| null }` |
| `originAccount` | `cuentaOrigen` | The origin account's digits as printed, leading digits included when visible; null otherwise |
| `operation` | `operacion` | `"spei" \| "same_institution" \| "cash" \| null` |

A text reading of a PDF asks the same three (the two prompts share `FIELDS`,
so they cannot drift).

## Stop verdict (no storage beyond the outcome)

`stopBeforeCredit(extracted, receivingAccounts)` →
`null | { reason: "key_missing" | "not_spei" | "wrong_destination", fields: Field[] }`
where `Field = "trackingKey" | "amount" | "date" | "senderBank"` lists every
field the capture does not show — the clave that blocks and the others the
typing form will ask for. Evaluated in this order, first match wins:

1. Not a clear reading (D7) → `null`.
2. `wrong_destination` — destination unknown is never a mismatch (D11).
3. `not_spei` — Spin sender, operation inside Spin or cash, no clave printed
   (D15).
4. `key_missing` — gate `trackingKey === "missing"` (D8: `malformed` is not
   missing).

## State and transitions

No payment status is added or renamed. The three stops happen before a
payment exists (the draft) or, when a client skipped the page, as an engine
failure the lifecycle already turns into `retryLater(code)` with nothing
billed — the row carries `RECEIPT_INCOMPLETE`, `RECEIPT_NOT_SPEI` or
`RECEIPT_WRONG_DESTINATION` as its `last_error`, rides the schedule without
spending (the draft's reading is reused, two-eyes D14) and ends `expired` as
any row with no verdict does.
