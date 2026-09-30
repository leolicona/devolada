# Data Model: payment-without-receipt

**Date**: 2026-09-30 · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

One additive migration, `0041_payment_without_receipt.sql`: three new
tables, six columns on `payments`, one on `businesses`. Nothing is dropped,
renamed or rebuilt; every existing row reads NULL or 0 on the new columns
and keeps today's meaning. (If `0041` is taken between planning and
implementation, the next free number is used and this line is amended.)

## `payer_references` — a person's number inside one business (D1, D3, D6)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `id` | text | no | uuid |
| `business_id` | text | no | → `businesses.id`. Every read filters on it (constitution V) |
| `digits` | text | no | Exactly seven digits, first digit 1–9, never generic (`isGenericReference`), never the last seven of a registered receiving account (D3) |
| `origin` | text | no | `phone` — the last seven digits of a phone the customers share; `assigned` — drawn by Devolada (D6) |
| `state` | text | no | `active` → `retired` (reset) · `blocked` (a phone's digits kept out of use: more than three customers, or marked not personal) |
| `state_reason` | text | yes | `reset`, `not_personal`, `shared_by_many` |
| `changed_by_user_id` | text | yes | → `user.id`: who reset or marked it; NULL when the machine blocked it |
| `created_at`, `changed_at` | integer (ms) | no / yes | |

Index: **unique `(business_id, digits)` over all states** — digits are
never reused in a business, so a reset can never catch an old transfer.

The whole phone is never stored (D1). A `blocked` row carries the digits
alone; a later customer whose phone ends in them gets an assigned number.

## `payer_reference_customers` — who holds a reference (D1, D4, D5)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `business_id` | text | no | → `businesses.id` |
| `reference_id` | text | no | → `payer_references.id`, an `active` one |
| `source` | text | no | `panel` \| `api` — as `payment_links.source` |
| `customer_key` | text | no | The usuario (panel) or the customerRef (API): the same identity a link carries |
| `created_at` | integer (ms) | no | |

Primary key `(business_id, source, customer_key)`; index `(reference_id)`.
A customer holds one reference at a time. A `phone` reference holds at most
three customers — checked at assignment against the live count (D4), not by
the database. A reset moves one customer to a new `assigned` reference; a
not-personal mark moves every holder, each to its own.

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

## `payments` — six columns (D8, D12, D14, D16, D17, D23)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `reference_source` | text | yes | `own` — the payer's reference, written by the server (D8); `typed` — "No puse la referencia" (D11). NULL on a clave, a receipt, and every row of a business with the feature off |
| `ladder_round` | integer | no | Default 0. Rounds that got a provider answer, carried from the row a correction supersedes (D14). Read only on rows with a `reference_source` |
| `correction_count` | integer | no | Default 0. Corrections along the chain that spent a search (D16) |
| `clave_tail` | text | yes | Four characters the payer typed to choose among kept candidates (D17); never searched at Banxico |
| `sender_account_new` | integer | yes | 1 when the confirming CEP's account was never seen for this customer and the customer had one learned (FR-020). NULL when nothing was learned before |
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
`active` row. None while `pay_by_reference` is 0, or before
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
| `last_error = 'CEP_UNDECIDED'`, typed row, candidates kept | `clave_tail` |
| typed row without `sender_tail`, candidates kept, none tied by a learned account | `sender_tail` |
| `last_error = 'TRANSFER_NOT_FOUND'`, `ladder_round ≥ 4` | `clave` |
| `last_error = 'TRANSFER_NOT_FOUND'`, `ladder_round = 3` | `check_data` |
| otherwise | null |

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
  business for ever (FR-001, FR-002, D3, D6).
- A phone reference is shared by at most three customers (FR-001–FR-003).
- A payer never receives a sending account, whole or in part, in any
  schema (FR-019).
- The day of an `own` or `typed` confirmation is between today − 30 and
  today in the business's timezone (D8).
- A `typed` reference that is another person's is refused (FR-034).
- Amounts are integer cents, compared exactly (FR-036).
