# Data Model: Cash at Stores

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

**One migration, additive only.** It creates four tables and adds nullable
or defaulted columns to `user`, `businesses` and `payments`. No table is
rebuilt and no column is dropped or narrowed. The per-PR preview can
apply it to the live dev database while the deployed Worker keeps serving
(constitution, Data row). Enums are TypeScript-only, as everywhere in
`schema.ts`: no CHECK constraint changes.

All money is integer cents (constitution II). Every timestamp is ms.

## New tables

### `stores`: a place that collects cash (D6)

A platform row: it has **no `business_id`**.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text PK | uuid |
| `name` | text NOT NULL | 2–80 characters, trimmed |
| `address` | text NOT NULL | free text, 5–200 characters |
| `shopkeeper_name` | text NOT NULL | 2–80 characters |
| `phone` | text NOT NULL **UNIQUE** | 10 national digits; also the shopkeeper's sign-in `username` |
| `user_id` | text NULL **UNIQUE** → `user.id` | set at acceptance (D5) |
| `status` | text NOT NULL default `invited` | `invited` \| `active` \| `suspended` |
| `created_by_user_id` | text NOT NULL → `user.id` | the operator |
| `created_at`, `updated_at` | int NOT NULL | |

**Status transitions**:
- `invited → active`: when the invitation is accepted;
- `active ⇄ suspended`: by the operator (FR-005);
- `invited → suspended`, and back to `invited`: the same operator act. A
  suspended store's open invitation is not accepted (400
  `INVALID_INVITATION`).

No transition deletes anything.

### `store_invitations`: the shopkeeper's way in (D4)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text PK | |
| `store_id` | text NOT NULL → `stores.id` | |
| `token_hash` | text NOT NULL **UNIQUE** | SHA-256 hex of the random token; the plaintext is never stored |
| `status` | text NOT NULL default `sent` | `sent` \| `accepted` \| `replaced` |
| `expires_at` | int NOT NULL | issued + 7 days |
| `created_by_user_id` | text NOT NULL → `user.id` | |
| `created_at` | int NOT NULL | |

Index: `(store_id, status)`. A store has at most one `sent` invitation:
issuing a new one marks the open one `replaced` in the same batch.

### `store_ledger`: the cash book, append-only (D19)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text PK | |
| `store_id` | text NOT NULL → `stores.id` | |
| `business_id` | text NOT NULL → `businesses.id` | tenant filter for the business side (D6) |
| `kind` | text NOT NULL | `collection` \| `handover` \| `correction` |
| `cents` | int NOT NULL | signed: `collection` > 0, `handover` < 0, `correction` ≠ 0 |
| `payment_id` | text NULL → `payments.id` | required for `collection` and `correction` |
| `handover_id` | text NULL → `store_handovers.id` | required for `handover` |
| `reason` | text NULL | `correction` only, 3–280 characters |
| `author_user_id` | text NULL → `user.id` | `correction`: the operator |
| `created_at` | int NOT NULL | |

Indexes:
- `(store_id, business_id, created_at)`;
- UNIQUE `(payment_id) WHERE kind = 'collection'`: one movement per
  payment;
- UNIQUE `(handover_id) WHERE kind = 'handover'`.

**Never UPDATE or DELETE.** Only `apps/api/src/store-ledger/index.ts`
writes it.

**Derived values, never stored:**
- `heldCents(store, business) = SUM(cents)`;
- `feesSinceHandoverCents(store, business) = SUM(payments.store_fee_cents)`
  over the store's confirmed or partial cash payments for that business
  since the last `handover` movement's `created_at` (from the start, if
  there is none).

### `store_handovers`: cash the store says it gave (D20)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | text PK | |
| `store_id` | text NOT NULL → `stores.id` | |
| `business_id` | text NOT NULL → `businesses.id` | |
| `cents` | int NOT NULL | > 0 and ≤ `heldCents` at declaration |
| `status` | text NOT NULL default `pending` | `pending` \| `confirmed` \| `disputed` |
| `note` | text NULL | required for `disputed`, 3–280 characters |
| `declared_by_user_id` | text NOT NULL → `user.id` | the shopkeeper |
| `declared_at` | int NOT NULL | |
| `resolved_by_user_id` | text NULL → `user.id` | the business member |
| `resolved_at` | int NULL | |

Indexes:
- `(business_id, status, declared_at)`;
- UNIQUE `(store_id, business_id) WHERE status = 'pending'`: one pending
  hand-over per store and business.

**Status transitions**:
- `pending → confirmed`: writes the `handover` movement with `−cents`, in
  one batch with the status change;
- `pending → disputed`: terminal, and writes nothing.

Each transition happens once: a second request answers 409
`HANDOVER_NOT_PENDING`.

## Changed tables

### `user` (Better Auth, `db/auth-schema.ts`): the `username` plugin (D3)

| Column | Type | Rule |
| --- | --- | --- |
| `username` | text NULL **UNIQUE** | written only by the store acceptance route; the store's phone |
| `display_username` | text NULL | same value |

Better Auth's public endpoints refuse `username` in a request body (D3).

### `businesses`: the channel switch (D7)

| Column | Type | Rule |
| --- | --- | --- |
| `store_channel_on` | int (boolean) NOT NULL default 0 | set by the operator only |
| `store_channel_since` | int NULL | the first time the channel was switched on; never cleared |

**Invariant (FR-006).** At most one row has `store_channel_on = 1`. The
operator's handler enforces it (D7). It is not a unique index, because
lifting it is a product decision, not a migration.

### `payments`: the cash row (D11, D13, D15)

New columns, all nullable:

| Column | Type | Rule |
| --- | --- | --- |
| `store_id` | text NULL → `stores.id` | set only on `channel = 'store'` |
| `store_user_id` | text NULL → `user.id` | the shopkeeper who recorded it |
| `store_fee_cents` | int NULL | the network fee the payer paid at the counter; the store's money |
| `collection_key` | text NULL | the client's key for this confirmation (D15) |

New index: UNIQUE `(store_id, collection_key) WHERE collection_key IS NOT NULL`.

The TypeScript enum `channel` becomes `["spei", "store"]`. The column and
its default `'spei'` are unchanged.

**How a cash row fills the existing columns:**

| Column | Cash value |
| --- | --- |
| `payment_link_id` | the customer's panel link, ensured at record (D11) |
| `business_id` | the business with the channel on |
| `amount_cents`, `received_cents` | the amount applied to the debt |
| `invoice_cents`, `carried_balance_cents` | the fresh debt's two halves (D14) |
| `service_fee_cents` | **0**: the store fee lives in `store_fee_cents` (D13) |
| `proof_mode` | `none`: a new value of the TypeScript enum (`receipt` \| `transfer` \| `none`). The column stays NOT NULL with no CHECK, so no migration touches it |
| `status` | `confirmed` or `partial`, from `settle()` |
| `reconciliation_class` | `exact` or `short` |
| `folio` | `makeFolio()` (D17) |
| `wisphub_customer_id`, `customer_usuario`, `customer_name`, `customer_zone` | from `customerDebt`'s `customer` block (D8) |
| `customer_phone` | **null, always** on a cash row. The receipt reads the phone live and never writes it (D18, constitution V v1.9.0) |
| `registered_cents` | `settle().ispRegisteredCents` |
| `action_outcome` and its columns | as `settleConfirmed` writes them for any payment (D13) |
| `confirmed_at` | the record's time |
| every proof, CEP, reading and provisional column | null |

**`proof_mode` on a cash row.** The column says how a proof arrived, and
a cash row has none. Enums here are TypeScript-only, so `none` joins the
enum with no migration. That is more honest than writing `transfer`. Two
readers learn the new value:
- the proof door (`GET /payments/:id/proof`) answers 404 for a row with no
  proof, as it does today for a row with no file;
- the proof schema's `proofMode` keeps `receipt | transfer`, because a
  cash row never reaches it.

## Platform settings (no table change)

Two keys join `platform_settings`, the existing append-only table, with
author and date on every change:

| Key | Type | Birth value | Rule |
| --- | --- | --- | --- |
| `store_fee_cents` | `cents` | 1500 | 0–5000 (D22) |
| `store_receipt_template` | `template` (new type) | the default in research D31 | 20–1000 characters; must contain `{folio}`; only the placeholders D31 lists (D31, FR-043) |

## Derived and in-memory shapes

### Capability answers (D8, D9): core words, filled by the adapter

| Capability | Core call | Answer |
| --- | --- | --- |
| `customerSearch` (new) | `find(text, limit)` | `{ rows: { usuario, name, zone, providerCustomerId }[], more: boolean }` |
| `customerDebt` (gains `customer`) | `of(usuario)` | `owes` / `none` gain `customer: { providerCustomerId, name, zone }`, with no phone; `unconfirmed` is unchanged |
| `paymentActions` (new) | `attempt(input)` | `ActionAttempt { registered: boolean; reconnected: boolean; invoiceId: number \| null; error: "INTEGRATION_UNAVAILABLE" \| "INTEGRATION_AUTH_FAILED" \| "NOT_ACTIVE_YET" \| null }` |

All three live in `integrations/capabilities.ts`. The WispHub adapter fills
them in `wisphub/`, and `registry.ts` is the only core file that imports
it.

### The store actor (D2)

```text
StoreActor = { type: "store"; storeId; userId; name; status: "active" }
```

It is resolved by `requireStore` from `stores.user_id`. A store whose
status is not `active` never becomes an actor: it gets 403
`STORE_SUSPENDED`, or, for `invited`, `WRONG_ACTOR`.

### The quote (D14)

```text
Quote = { usuario; name; zone; state: "owes" | "none";
          debtCents; invoiceCents; carriedBalanceCents;
          feeCents; totalCents = debtCents + feeCents }
```

## Validation rules (from the spec)

| Rule | Where | FR |
| --- | --- | --- |
| phone: 10 digits, unique among stores | create and edit a store | FR-002, FR-003 |
| amount: integer cents, 0 < amount ≤ fresh debt | record | FR-019 |
| expected debt and fee equal the fresh ones | record | FR-021 |
| a confirmed record per `(store, collection_key)` at most once | record | FR-023 |
| a hand-over: 0 < cents ≤ held; one pending per store and business | declare | FR-038 |
| a dispute note: 3–280 characters | dispute | FR-035 |
| a correction: cents ≠ 0, reason 3–280 characters, a payment of that store and business | correct | FR-030 |
| the channel: capable integration; at most one business on | switch | FR-006, FR-007 |
