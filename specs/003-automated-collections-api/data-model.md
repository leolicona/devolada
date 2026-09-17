# Phase 1 Data Model: automated-collections-api

**Date**: 2026-09-12 | **Research**: [research.md](./research.md)

Money is integer cents; timestamps are milliseconds (constitution II). Every
table carries `business_id` and every query filters by the actor's business
(constitution V).

---

## Changed: `payment_links`

Widened rather than twinned (D2). Existing rows are panel links and stay exactly
as they are.

| column | type | notes |
| --- | --- | --- |
| `source` | `panel` \| `api` | **new**, not null, default `panel` — FR-011, and it decides where the ask comes from (D5) |
| `mode` | `reusable` \| `one_time` | **new**, not null, default `reusable` — FR-027 |
| `customer_ref` | text, null | **new** — the caller's own identifier, stored and echoed, never interpreted |
| `ask_cents` | integer, null | **new** — the amount to collect. Null for panel links, whose ask is read live from WispHub |
| `label` | text, null | **new** — display name the payer sees; falls back to the business name |
| `concept` | text, null | **new** — the payer-facing description the caller may supply (FR-006) |
| `expires_at` | integer ms, null | **new** — one-time only |
| `closed_at` | integer ms, null | **new** — when it stopped accepting payments |
| `is_test` | boolean | **new**, not null, default false — D12 |
| `wisphub_customer_id` | text, **null** | *was not null* — an API link has no WispHub customer (D3) |
| `customer_usuario` | text, **null** | *was not null* — same reason; surfaced to the payer as `reference`, so a sentinel would reach a customer's screen |

**Indexes** (D4): the single `unique (business_id, customer_usuario)` is replaced by

- `unique (business_id, customer_usuario) where source = 'panel'`
- `unique (business_id, customer_ref) where source = 'api' and mode = 'reusable'`

**Invariants**, enforced at the write path and stated in the schema comment:

- `source = 'api'` ⟹ `customer_ref` and `ask_cents` are present
- `source = 'panel'` ⟹ `customer_usuario` and `wisphub_customer_id` are present
- `mode = 'one_time'` ⟹ `expires_at` is present
- `mode = 'reusable'` ⟹ `expires_at` is null and `closed_at` stays null
- `ask_cents > 0` always (FR-010)

**Link state**, derived rather than stored:

```
open       closed_at is null and (expires_at is null or expires_at > now)
paid       closed_at is not null          (a one-time link that was paid)
expired    closed_at is null and expires_at <= now
```

A reusable link is always `open`. Only `open` links accept a payment (FR-031).

**Migration note**: relaxing two `NOT NULL` columns forces SQLite's table
rebuild, so this migration is not purely additive. One table, pilot scale, and
production archives a D1 export before migrating.

---

## Changed: `payments`

| column | type | notes |
| --- | --- | --- |
| `customer_ref` | text, null | **new** — denormalised at submission, same reason as the WispHub customer fields beside it: the history and the webhook must not depend on the link row |
| `asked_cents` | integer, null | **new** — what was asked at submission. The classification compares against this, and a retry days later compares against the same number |
| `is_test` | boolean | **new**, not null, default false — D12 |

`action_outcome` gains no new value. An API payment's mapped action *is* the
**verdict's** webhook, so it reads `done` when that delivery was accepted,
`queued` while it is being retried, `failed` when the schedule is spent. The
deliveries announcing earlier states (`validating`, `queued_for_credit`) never
write this column: their failures live on `webhook_deliveries` and on the
panel's health line (clarified 2026-09-17). That keeps one vocabulary for "did
the thing after the money happen?" across both channels (integrations-hub D7's
generalisation, used as intended).

---

## New: `api_credentials`

Mirrors the engine's former key table (`apps/consta/src/db/schema.ts`, deleted by 004 — read it in git history before #200) (D11).

| column | type | notes |
| --- | --- | --- |
| `id` | text | |
| `business_id` | text → businesses | |
| `name` | text | what the business called it |
| `key_hash` | text, unique | SHA-256 of `dk_<32 hex>`. The plaintext exists only in the issuing response |
| `key_tail` | text | last 4 characters, so the panel can name which credential it is (FR-003) |
| `is_test` | boolean | D12 — a credential is real or test, never both |
| `last_used_at` | integer ms, null | so a business can retire one it no longer recognises |
| `revoked_at` | integer ms, null | revocation is a timestamp, never a delete — FR-004 |
| `created_at` | integer ms | |

---

## New: `api_webhooks`

One per business (spec assumption).

| column | type | notes |
| --- | --- | --- |
| `id` | text | |
| `business_id` | text → businesses, unique | |
| `url` | text | must protect the message in transit — FR-038 |
| `consecutive_failures` | integer, default 0 | what the panel's health line reads — FR-018 |
| `last_failure_at` | integer ms, null | |
| `last_success_at` | integer ms, null | |
| `created_at` | integer ms | |

**No secret on this row.** Deliveries are signed with Devolada's own private
key, one set for the platform, held in the Worker secret
`WEBHOOK_SIGNING_KEYS` and never in a business table (D10). The business has
nothing to store, nothing that can leak, and nothing to rotate; the row is an
address and its health.

---

## New: `webhook_deliveries`

The queue is the row (D8), exactly as the reconnection queue is the payment row.

| column | type | notes |
| --- | --- | --- |
| `id` | text | |
| `business_id` | text → businesses | |
| `payment_id` | text → payments, null | null is possible for a future event that is not about one payment |
| `event_id` | text, unique | what the caller uses to recognise a repeat — FR-014 |
| `event_type` | text | `payment.<status>` for every `payments.status` the row enters — `validating`, `queued_for_credit`, `confirmed`, `partial`, `unapplied`, `invalid`, `expired`, `superseded` — the row's own word, never a synonym (D17) |
| `payload` | text | the body, rendered once at enqueue and never re-rendered — D9 |
| `key_id` | text, null | the `kid` that signed the latest attempt, for settling arguments — FR-026, D10 |
| `status` | `pending` \| `delivered` \| `failed` | |
| `attempts` | integer, default 0 | |
| `next_attempt_at` | integer ms, null | null = terminal, or a lease held by a running sweep |
| `response_status` | integer, null | what the endpoint answered, for the panel and for settling arguments — FR-026 |
| `last_error` | text, null | |
| `delivered_at` | integer ms, null | |
| `created_at` | integer ms | |

**Transitions**

```
pending ──delivered (2xx)──────────────► delivered
   │
   ├──non-2xx / no answer in 10 s, waits left──► pending, next_attempt_at = now + backoff
   │
   └──schedule spent─────────────────► failed
                                          │
                          business asks for a re-send (FR-041)
                                          │
                                          ▼
                                       pending, same event_id, same payload
```

Backoff `[1, 5, 15, 60, 240]` minutes — six attempts over about five hours, the
same rhythm the reconnection queue already uses (D8).

**Index**: `(status, next_attempt_at)` for the sweep's claim;
`(business_id, created_at)` for the panel.

---

## New: `idempotency_keys`

| column | type | notes |
| --- | --- | --- |
| `business_id` + `key` | unique together | D14 |
| `response` | text | the first response, replayed verbatim — FR-008 |
| `status_code` | integer | |
| `created_at` | integer ms | swept after 24 h |

---

## New: `rate_counters`

| column | type | notes |
| --- | --- | --- |
| `business_id` + `bucket` | unique together | `bucket` is the minute, as epoch minutes |
| `count` | integer | the request that takes it past 120 is refused — FR-024, D13 |

Old buckets are deleted by the same sweep that expires idempotency keys (D13).

---

## Entity relationships

```
businesses ─┬─< api_credentials        (many: real + test, rotated over time)
            ├─── api_webhooks          (one)
            ├─< payment_links          (panel links and api links, one table)
            └─< webhook_deliveries

payment_links ─< payments ─< webhook_deliveries
```

## What is deliberately absent

- **No `api_customers` table.** The caller's reference is a string Devolada
  stores and echoes. Giving it a table would invite Devolada to hold customer
  records it has no business holding, and would turn a caller's rename into a
  migration.
- **No amount history on a reusable link.** A re-price overwrites `ask_cents`.
  What was asked at the time of a payment lives on the payment
  (`asked_cents`), which is where a reconciliation needs it.
- **No admission or verification state.** Left open by the developer on
  2026-09-12. `businesses.status` already gates the money path, so the policy can
  arrive later without a migration (D15).
