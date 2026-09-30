# Data Model: payment-without-receipt

**Date**: 2026-09-30 · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

> **Amended 2026-09-30 by spec 017** ([`confirmation-hierarchy`
> data-model](../017-confirmation-hierarchy/data-model.md)): `payments`
> gains `tie_break` and `cep_records` an index on `(business_id,
> sender_account)`, both in this migration; "The ask" below is replaced by
> 017's table (`check_data`, `clave`, `tie_break`); in the state diagram,
> "several, typed — not tied" asks `tie_break` after the search, and an
> answer that fits nothing stays undecided with its candidates.

One additive migration, `0041_payment_without_receipt.sql`: three new
tables, five columns on `payments`, one on `businesses`. Nothing is dropped,
renamed or rebuilt; every existing row reads NULL or 0 on the new columns
and keeps today's meaning. (If `0041` is taken between planning and
implementation, the next free number is used and this line is amended.)

## `payer_references` — a person's number inside one business (D1, D3, D6, D26)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `id` | text | no | uuid |
| `business_id` | text | no | → `businesses.id`. Every read filters on it (constitution V) |
| `digits` | text | no | Exactly seven digits, first digit 1–9, never generic (`isGenericReference`), never the last seven of a registered receiving account (D3) |
| `origin` | text | no | `phone` — the last seven digits of the phone of the first person to receive them (D4); `assigned` — drawn at random by Devolada, no pattern (D6). An `assigned` row becomes `phone` when it passes to the phone's owner (D26) |
| `previous_reference_id` | text | yes | → `payer_references.id`: set on a row that passed to a phone's owner — the new row its previous holder moved to (D26) |
| `transition_ends_at` | integer (ms) | yes | 60 days after the row passed; set to now when the previous holder confirms with their new number. FR-041 applies while it is ahead |
| `created_at` | integer (ms) | no | |
| `changed_at` | integer (ms) | yes | When the row passed to the phone's owner (D26); NULL otherwise |

No state column: nothing retires a reference — the panel has no action
over one (clarified 2026-09-30) — so a row lives as long as the business.

Index: **unique `(business_id, digits)`** — digits are
never reused in a business, so a new number can never catch an old
transfer. The one way digits change hands is D26: the same row passes to
the phone's owner, with the transition that guards it.

The whole phone is never stored (D1), and neither is a name.

## `payer_reference_customers` — who holds a reference (D1, D4, D5)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `business_id` | text | no | → `businesses.id` |
| `reference_id` | text | no | → `payer_references.id` |
| `source` | text | no | `panel` \| `api` — as `payment_links.source` |
| `customer_key` | text | no | The usuario (panel) or the customerRef (API): the same identity a link carries |
| `created_at` | integer (ms) | no | |

Primary key `(business_id, source, customer_key)`; index `(reference_id)`.
A customer holds one reference at a time, and a reference's customers are
one person: the same phone and the same name when it was assigned (D4,
compared live, never stored). Only the machine writes this table:
`ensurePayerReference` adds a customer, and the D26 pass moves a previous
holder's customers to their new row. Nobody moves a customer by hand
(clarified 2026-09-30).

Keyed by customer, not by link: a link pruned and made again
(`links/prune.ts`) finds the same number (D1).

## `provider_quota` — the provider's remaining calls (D19)

A platform row, like `platform_settings`: no `business_id`.

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `provider` | text | no | Primary key. `apicep` |
| `remaining` | integer | no | `X-RateLimit-Remaining` of the latest answer that carried it |
| `observed_at` | integer (ms) | no | When that answer came |

Upserted by the adapter; read only by the platform operator's screen.

## `businesses` — one column (D20)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `pay_by_reference` | integer | no | Default 0. 1 turns the feature on for this business (FR-039); `settings: update` |

## `payments` — five columns (D8, D14, D16, D17, D23)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `reference_source` | text | yes | `own` — the payer's reference, written by the server (D8); `typed` — "No puse la referencia" (D11). NULL on a clave, a receipt, and every row of a business with the feature off |
| `ladder_round` | integer | no | Default 0. Rounds that got a provider answer, carried from the row a correction supersedes (D14). Read only on rows with a `reference_source` |
| `correction_count` | integer | no | Default 0. Corrections along the chain that spent a search (D16) |
| `clave_tail` | text | yes | Four characters the payer typed to choose among kept candidates (D17); never searched at Banxico |
| `confirmation` | text (JSON) | yes | `{ preselectedBank, preselectedDay, days }` — what the page offered, and every day the rounds searched (D14, D23) |

The existing columns keep their meaning and carry the new paths:
`reference_number` (the digits searched, own or typed), `sender_bank`,
`transfer_date` (the day the payer gave), `claimed_amount_cents` ("Pagué
otra cantidad"), `sender_tail` (the four digits the payer typed, D11),
`supersedes_id`, `match_trail` (gains `by: "learned_account" | "earliest" |
"sender_tail" | "clave_tail"`), `last_error`, `disputed_fields`.

No new `status` word. No new `last_error` word on the row: the asks are
derived (below).

## `cep_records` — no column; one more writer (D13)

Every `valid` a business receives now writes its record through
`storeSingleRecord`, clave searches included. The table, its unique
`(business_id, clave)` and its rules are spec 013's.

## Derived, never stored

**A customer's reference** — `payer_reference_customers` joined to its
row. None while `pay_by_reference` is 0, or before
`ensurePayerReference` could count the phone (D5).

**"Proven"** (FR-010) — any confirmed or partial payment with
`reference_source = 'own'` among the customers who share the reference.

**Learned banks** (D12, per person) — the distinct `sender_bank` of the
confirmed or partial payments of every customer holding the reference,
most recent `confirmed_at` first, three at most.

**Learned accounts** (D12, per service) — `cep_records.sender_account` (and
its type) where `clave` equals the `tracking_key` of a confirmed or
partial payment of that one customer's links.

**Bank order** (D7) — the business's confirmed payments of the last 90
days, grouped by `sender_bank`, most first, five at most.

**The ask** (D15), on a `validating` row with a `reference_source`:

| Condition | `ask` |
| --- | --- |
| typed row without `sender_tail`, candidates kept, none tied by a learned account | `sender_tail` |
| own row during a transition (D26), a candidate from an account not learned for this person, no `sender_tail` | `sender_tail` |
| `last_error = 'CEP_UNDECIDED'`, typed row, `sender_tail` given, several candidates still fit | `clave_tail` |
| typed row, `sender_tail` given, no candidate fits (FR-033) | `clave` |
| `last_error = 'TRANSFER_NOT_FOUND'`, `ladder_round ≥ 4` | `clave` |
| `last_error = 'TRANSFER_NOT_FOUND'`, `ladder_round = 3` | `check_data` |
| otherwise | null |

Read top to bottom; the first row that holds wins. The account's four
digits are asked before the clave's four characters (D15).

**Used by** (D24) — for a row refused as `TRANSFER_ALREADY_USED`: the
payment holding that clave in the business, when its customer holds the
same reference as this payment's customer — its confirmation day in the
business's timezone and its `received_cents`. Otherwise nothing.

## State of a confirmation

```text
confirm ──► validating ─┬─ one match ───────────────► confirmed | partial (existing settle)
 (round 1)              ├─ several, own ────────────► confirmed (learned account, else earliest)
                        ├─ several, typed ─┬─ tied ─► confirmed
                        │                  └─ not ──► validating: ask sender_tail | clave_tail (no call, no expiry)
                        ├─ validated before ────────► TRANSFER_ALREADY_USED (existing)
                        └─ not found ─► round 2 ─► round 3 (neighbours) ─► ask check_data
                                        ─► round 4 ─► ask clave ─► rounds 5, 6 ─► expired
   a correction ──► new row, supersedes, carries ladder_round and correction_count, searches at once
   a clave / receipt ──► today's paths, on the same chain
```

## Validation rules (from the requirements)

- Seven digits, first 1–9, not generic, not a receiving tail, unique per
  business for ever, except a row passing to its phone's owner (FR-001,
  FR-002, FR-040, D3, D6, D26).
- A reference's customers are one person — one phone and one name, decided by the system alone (FR-001–FR-003).
- A payer never receives a sending account, whole or in part, in any
  schema (FR-019).
- The day of an `own` or `typed` confirmation is between today − 30 and
  today in the business's timezone (D8).
- A `typed` reference that is another person's is refused (FR-034), except the payer's own previous reference during a transition (FR-041).
- Amounts are integer cents, compared exactly (FR-036).
