# Data Model: consta-api-merge

**Feature**: 004 · **Date**: 2026-09-12 · **Phase**: 1

Two tables move into the product's database with a new owner column; one
column on an existing table is retired in place; nothing else changes shape.
Money stays integer cents, timestamps stay milliseconds (constitution II).

---

## Validation record — `validations`

One row per provider call that returned an answer, billed failures included
(validation spec D6, amended by D15). Append-only: never `UPDATE`, never
`DELETE`. The count of paid calls is a `SUM` over this table.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text PK | The engine's record of one attempt. `payments.consta_validation_id` and `top_ups.consta_validation_id` point here — same column, same meaning as before, now a local key |
| `business_id` | text NULL → `businesses.id` | **New.** Who the call was made for. `NULL` = the platform's own transaction, a top-up (prepaid-credit D6). Replaces `api_key_id` (research R2) |
| `mode` | `transfer` \| `receipt` | Which door |
| `status` | `valid` \| `pending` \| `invalid` \| NULL | NULL = the call failed before any verdict existed (D15) |
| `reason` | `contradicted` \| `not_found` \| NULL | Which kind of `invalid` (D11) |
| `already_validated` | boolean | The provider's replay flag (D4) |
| `tracking_key`, `sender_bank`, `reference_number`, `amount_cents`, `transfer_date`, `beneficiary_bank` | | What was claimed or read (learned-retry D2 for the receiving side) |
| `provider_validation_id`, `cep_status` | | Provider breadcrumbs |
| `provider_http_status`, `provider_ms`, `quota_remaining` | | Cost and latency (D14); NULL on failures, which carry no headers |
| `customer_ref` | text NULL | **Meaning changed.** The link's own customer identity — `payment_links.customer_usuario` for a panel link, `payment_links.customer_ref` for an API link once `003-automated-collections-api` adds it — no longer an HMAC (research R4). NULL on top-ups |
| `payment_ref` | text NULL | `payments.id`, chaining the attempts of one payment (trust-layer D1). NULL on top-ups |
| `created_at` | integer ms | |

**Indexes**: `(business_id, created_at)`, `(business_id, customer_ref)` —
the engine's two indexes, re-keyed.

**Reads, and who may see what** (constitution V, research R3):

| Read | Scope | Returns |
| --- | --- | --- |
| Trust block (trust-layer D3–D8) | `business_id = ?` and `customer_ref IS NOT NULL` | A measured history for one payer, baseline for one business |
| Shape rules (proof-extraction D14) | **all businesses** — `status = 'valid'`, bank and clave present | Per-bank clave patterns; rules, never rows (`consta-api-merge D4`) |
| Retry cells (learned-retry D2–D4) | **all businesses** — last 28 days, clave and status present | Percentiles per bank pair; a moment, never a row (`consta-api-merge D4`) |
| Latency report (`scripts/cep-latency-report.mjs`) | operator, read-only, whole table joined to `payments` by clave | A markdown report |

**State**: none. A row is written once, complete.

---

## Reading record — `extractions`

One row per receipt read, whatever the outcome — including the ones that
spent nothing (proof-extraction D9). Holds what was read and a fingerprint of
the file, never the file (D8).

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text PK | |
| `business_id` | text NULL → `businesses.id` | **New.** As on `validations` |
| `source` | `reader` \| `provider-ocr` | Which reader saw the file (D2) |
| `outcome` | `passed` \| `gated` \| `not_a_receipt` \| `unreadable` \| `refused` \| `routed` | |
| `model` | text NULL | The reader's model id |
| `proof_sha256`, `media_type`, `byte_size` | | The fingerprint, never the bytes |
| `tracking_key`, `sender_bank`, `amount_cents`, `transfer_date`, `receipt_status` | | What was read — reported, never authoritative (D3) |
| `gate_tracking_key`, `gate_sender_bank` | | The gate's verdict per field (D4) |
| `shape`, `suggested_bank` | | The soft signals (D15/D16) |
| `raw_output` | text NULL | The model's answer, verbatim |
| `validation_id` | text NULL → `validations.id` | Set once, after the reading bought a provider call (D8). The one write after insert this table has, and the row it points at is never touched |
| `created_at` | integer ms | |

**Index**: `(business_id, created_at)`.

**Lifecycle**:

```text
inserted (validation_id NULL) ──the reading bought a call──▶ linked (validation_id set)
```

---

## Business — `businesses` (one column retired)

| Column | Change |
| --- | --- |
| `consta_api_key` | **Retired in place.** Never read, never written. Stays declared so `db:generate` emits no `DROP COLUMN` (research R10); registered as debt `retired-consta-key-column`, paid by one drop migration once no deployed version selects it |

Everything else on the row — CLABE, bank, beneficiary, fee, tolerance,
timezone — is untouched. `003-automated-collections-api`'s reading of this
table ("no ISP-specific column") still holds.

---

## Payment — `payments` and `top_ups` (unchanged)

| Column | Note |
| --- | --- |
| `consta_validation_id` | Now a local key into `validations.id`. Rows written before the cut-over hold the old service's ids; they are history, not joins — nothing follows them |
| `consta_status` | Unchanged vocabulary |
| `validation_attempts` | Lives on the payment, which is why a payment in flight at cut-over keeps its retry carve-out (direct-payment D8) without a data step |
| `last_error` | **Vocabulary changed** (research R5): the engine's own codes replace `CONSTA_UNAVAILABLE`, `CONSTA_AUTH_FAILED`, `CONSTA_NOT_CONFIGURED`. No screen reads it |
| `trust_snapshot` | Unchanged shape; its `customerRef` field now echoes the link's customer identity rather than an HMAC |

---

## Owner — the engine's caller

Not a table: the value every engine call carries.

```text
{ businessId: string }      a business's validation or reading
{ platform: true }          the platform's own top-up
```

It decides `business_id` on every row the engine writes, and it is the only
way to write one. There is no key, no token, and no third kind of owner.

---

## Removed

| Was | Now |
| --- | --- |
| `api_keys` (Consta) | Gone with the service. Tenant identity is the business |
| `validations.api_key_id`, `extractions.api_key_id` | `business_id` |
| Consta's eight migrations | Not replayed. One additive migration in `apps/api/migrations/` creates the two tables above; the API's database never held them |
| The Consta dev database | Exported to a CI artifact, then deleted (research R12). Nothing is carried across (spec Q2) |
