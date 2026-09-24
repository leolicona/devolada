# Data Model: receipt-triage


**Date**: 2026-09-24 · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

One additive migration, `0036_receipt_triage.sql`: `ADD COLUMN`s on four
existing tables and one non-unique index, no new table, nothing dropped,
renamed or rebuilt (re-planned 2026-09-24 for the rescoped Story 3). The PR
preview applies it to the live dev database; every existing row reads NULL
on the new columns and keeps today's meaning. (If `0036` is taken between
planning and implementation, the next free number is used and this line is
amended, as two-eyes-receipt did for `0030`.)

## `businesses` — the registered accounts and the cuenta de cobro (D9, D29, D30, D32)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `spei_card` | text | yes | 16 digits, passes the Luhn check. A debit card that receives SPEI |
| `spei_card_bank` | text | yes | A name from the provider's vocabulary (`BANKS`). Set iff `spei_card` is set |
| `spei_phone` | text | yes | 10 digits. A phone registered with its bank to receive transfers |
| `spei_phone_bank` | text | yes | A name from `BANKS`. Set iff `spei_phone` is set |
| `spei_collect_kind` | text | yes | `clabe \| card \| phone` — the cuenta de cobro. NULL reads as `clabe`, so every business born before this feature keeps its CLABE (D29) |
| `spei_retired_accounts` | text (JSON) | yes | Array of `{ kind, value, bank, removedAt }` — every number the ISP changed or cleared, appended by the settings handler in the same write (D30). Read only to recognise a receipt paid to a removed account |

- In the `clabe` area (owner only), like `spei_clabe`
  (business-and-memberships D3). Roles that cannot update settings read the
  numbers masked to the last four digits.
- `spei_clabe` becomes optional (D32): **`configured`** = the cuenta de cobro
  is registered and its bank is one the provider knows. For a business with
  a CLABE and `spei_collect_kind` NULL this is exactly today's test.
- **The registered accounts**: each `{ kind: "clabe" | "card" | "phone",
  value, bank }` that is set. **The cuenta de cobro**: the one whose kind is
  `spei_collect_kind ?? "clabe"`.

## `payments` — the second key, the account, the review (D1, D3, D25, D30, D31)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `reference_number` | text | yes | The referencia numérica this payment searches with: typed by the payer, or accepted from the readings. One to seven digits, as printed — leading zeros kept, never cast to a number (D12) |
| `beneficiary` | text (JSON) | yes | `{ kind, value, bank }` — the account this payment is checked against. Set at submission to the cuenta de cobro; replaced by the engine's `beneficiaryUsed` when the receipt's digits tie to another registered or retired account (D30), and by the account Banxico's CEP names when it ties (D22) |
| `registered_accounts` | text (JSON) | yes | The ISP's accounts **at submission**, each with `retired: boolean` — current ones and those in `spei_retired_accounts`. What every attempt ties the destination against, so a later edit never moves a payment in flight (FR-021) |
| `review_reason` | text | yes | `retired_account \| no_clave` — why a confirmed payment is held for the ISP (D31) |
| `reviewed_by`, `reviewed_at` | text, integer (ms) | yes | Who decided a held payment, and when |

Rules:

- **A key is a clave or a reference.** The lifecycle's `accepted` test
  (two-eyes plan D17, D20) becomes: (`tracking_key` **or**
  `reference_number`) **and** `sender_bank` **and** `claimed_amount_cents`
  **and** `transfer_date`. An accepted row takes the transfer door; when both
  keys are set only the clave travels (D1) and the reference stays on the
  row. There is no account condition any more: every row has its
  `beneficiary` from submission (the candidate list and D23 are retired).
- **An attempt reads the account from the payment, never the business**
  (FR-021). `beneficiary` set → that account; NULL — a row born before this
  feature — today's fallback, the business's CLABE, with `legacy` (D27).
- **Banxico's clave is adopted onto every confirmed row that has none** (D14),
  whatever its `proof_mode`; the unique index `payments_business_tracking_idx`
  refuses a second row with that clave (direct-payment D8). When the CEP
  carries **no** clave (never observed; FR-006 guard): `tracking_key` stays
  NULL, the occurrence is logged as unexpected, and the row confirms only if
  the provider's replay flag is `false` **and** the shared-reference lookup
  finds no *confirmed* payment with the same five data; the flag `true` or a
  match → `invalid`, `TRANSFER_ALREADY_USED`; the flag unknown (`null`) →
  held, `review_reason = "no_clave"` (D31).
- **A retired account**: a row whose `beneficiary` is a `retired` entry and
  that Banxico confirms is held, `review_reason = "retired_account"` (D31).
- One non-unique index, `payments_business_reference_idx` on
  (`business_id`, `reference_number`, `transfer_date`), for the shared
  reference lookup (D7, clarified 2026-09-24): another payment of the same
  business, from another link and not `superseded`, with the same reference,
  transfer date, sending bank, amount and receiving account. Never unique —
  references repeat by design.
- **`disputed_fields`** (JSON, existing) gains `"referenceNumber"` (D13).
  **`last_error`** (existing) gains `REFERENCE_AMBIGUOUS` (D17),
  `REFERENCE_SHARED` (D7) and `REJECTED_BY_BUSINESS` (D31).
- **`action_outcome`** (existing, text) gains `review` (D31) — TypeScript
  only.

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
| `wrong_destination` | A clear reading whose destination (≥ 3 visible digits) ends none of the ISP's registered accounts, current or retired (D24) | 0 |

Written by the **read** path (`/read`, the free draft) and by the **receipt
door** when a client skipped the page; either way the row has no
`validation_id`. The ISP's accounts are never written on this table — only
what the reading itself saw.

## The reading, in the engine (no storage)

- `Reading` (`consta/extraction/reader.ts`) gains `referenceNumber: string |
  null` (`"referenciaNumerica"`) and `destination: { kind, digits }`
  (`"destino": { "tipo", "digitos" }`), asked in the same prompt — both
  prompts share `FIELDS`, so a PDF's text is asked the same questions.
- `Gate` gains `referenceNumber: "ok" | "malformed" | "generic" | "missing"`
  — `generic` is a well-formed reference that is a single digit repeated ("0", "0000", "1111111") or a run of consecutive digits ("123", "1234567", "7654321") (D2, clarified 2026-09-24);
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
"amount" | "date" | "senderBank"` — never the account (re-planned
2026-09-24: the form does not ask for it):

1. Not a reader reading, not a receipt, or not **clear** — `legibility ===
   "full"` on a picture, or a PDF's text (D16) → `null`.
2. `tieDestination(reading.destination, accounts)` (D24) is `"none"` →
   `wrong_destination`.
3. The gate's `trackingKey` is not `missing`, or its `referenceNumber` is
   neither `missing` nor `generic` → `null`. (A malformed key is a reading,
   not an absence; a generic reference is an absence — D2.)
4. Otherwise → `no_key` with `fields`: `"key"` first, then each of `amount`,
   `date`, `senderBank` the reading lacks, in the form's order.

`tieDestination(destination, accounts)` → `{ tied: account } | "unknown" |
"none"`, over the payment's `registered_accounts` (current **and** retired,
D30): visible digits with everything but digits removed; the last four of
them (or three when only three are visible) are compared; fewer than three
→ `"unknown"`; forms per account — the CLABE's 18 digits and its 11-digit
account segment (positions 7–17), the card's 16, the phone's 10; the visible
digits must **end** a form. `destination.kind`, when known, only decides the
order: the forms of that kind are tried first, and exactly one fit among them
ties it; otherwise every form of every account is tried — exactly one
account → `tied`, more than one → `"unknown"`, none → `"none"`. A kind the
reader got wrong can never turn a fit into a mismatch (D24, clarified
2026-09-24).

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
- **A disputed clave that fell back to the reference** (D13, clarified
  2026-09-24): `validating` → `validating` with `tracking_key` NULL,
  `reference_number` set and `disputed_fields` NULL; the next slot takes the
  transfer door with the reference. Banxico confirms → the clave is adopted
  (D14) — written before the confirmation, so the unique index refuses a
  clave already used before the row can confirm (FR-006). The search returns
  `not_found` → `disputed_fields = ["trackingKey", "referenceNumber"]`: the
  payer is asked for the clave or the reference, either one enough, and the
  slots keep searching with the reference meanwhile. The 422 is D17's case.
- **A receipt paid to another registered account** (D30): at the first
  receipt-door attempt the engine ties the destination; tied to an account
  other than the cuenta de cobro → the provider call names it and
  `beneficiary` is rewritten from `beneficiaryUsed`. Unknown → the cuenta de
  cobro, as the spec's edge case accepts. (D23's list door is retired.)
- **Held for the ISP** (D31): `validating` → `confirmed` with
  `action_outcome = "review"` and `review_reason`; the ISP's `accept` →
  `action_outcome = "queued"` (the queue takes it as any confirmed row);
  `reject` → `invalid`, `REJECTED_BY_BUSINESS`. No webhook announces the
  verdict while it is held.
- **A row born before this feature** (D27, FR-027): `beneficiary` and
  `registered_accounts` are both NULL — no row born after can have that
  shape, because every submission snapshots both. Its receipt-door
  requests carry `legacy: true`; the engine reads the file as today and skips
  the ask and the destination tie, so the row finishes under today's flow
  (amended 2026-09-24, analyze G1).
