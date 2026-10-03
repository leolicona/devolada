# Data Model: bank-statement-match

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Migrations are additive (constitution, Data row). Phase A adds **no
column**; Phase B adds two tables and one column. The enums below are
TypeScript-only, as every enum in `db/schema.ts` (no CHECK constraint,
`db/schema.ts:448-451`), so a new value needs no migration.

## Phase A — the same-bank payment

### `payments` (existing) — new values, no new column

| Field | Change | Meaning for this feature |
| --- | --- | --- |
| `status` | — | A same-bank payment stays `validating` while it waits (R3) and ends `expired` when it did not arrive (R5). No new word. |
| `next_validation_at` | — | `NULL` while it waits: the sweep never selects it, so it never expires by the clock (R3). Two minutes ahead while an operator's decision holds the row: a lease the sweep reclaims if the decision never finishes (R6). |
| `last_error` | new codes | `SAME_BANK` — waiting for the business; `BANK_CHECKING` — claimed by an operator's decision in flight, under its two-minute lease (R6); `NOT_RECEIVED` — on an `expired` row, ended because the money did not arrive (R5). None is a public payer code. |
| `reviewed_by`, `reviewed_at` | comment widens | Who decided the row by hand: receipt-triage's review **or** this feature's bank check (R6). |
| `provisional_release_at`, `release_evidence`, `release_kind` | — | Written at recognition when the release applies; evidence `human` (R4). |
| `sender_bank`, `beneficiary` | — | The two banks compared (R2). `beneficiary.bank` is the snapshot of the collection account — CLABE, card or phone. |

The status comment (`db/schema.ts:414-427`) gains:

> `expired` with `NOT_RECEIVED` (bank-statement-match D5): a same-bank
> payment the business, or its statement, says never arrived. Not
> `invalid` — that word is Banxico's "your transfer does not exist", it
> charges the fee and a later CEP refunds it; this is the business's word
> about its own account. The payer reads it as any payment we could not
> confirm.

### State of a same-bank payment

```text
                 payer confirms naming the business's bank
                                   │
                                   ▼
        validating · SAME_BANK · next_validation_at NULL
        (release evaluated once, evidence human)
              │                    │                      │
   operator "Sí, llegó"   statement credit (Phase B)   operator "No llegó"
   or "No llegó" claims   ref + amount + day           or a statement covering
   → BANK_CHECKING                                      its day without it
              │                    │                      │
              ▼                    ▼                      ▼
   confirmed | partial | unapplied            expired · NOT_RECEIVED
   (D14 re-check, folio, action, fee)          (no fee; counts as a burned
                                                ride only if released)
```

A claim that cannot reach the business's system goes back to `SAME_BANK`
(R6, step 4); one whose decision never finishes goes back when the sweep
reclaims its lease. A payer's correction supersedes the row as today and
the new row is recognized again, or searched if the bank changed. After
"no llegó", the payer's same data makes a **new** row that waits again,
and the ended row offers no retry (D17).

```text
   pending decision ──lease ends (2 min)──► sweep ► pre-check ► SAME_BANK
```

### Copies of the payment vocabulary — untouched

Because no status word is added, none of these change: `PAYMENT_STATUSES`
(`routes/payments/schema.ts:10-19`), the `/v1` webhook schema, `VERDICTS`
(`webhooks/events.ts:17-24`), `RELEASED` (`cep-match.ts:27`), the
tracking-key index predicate (`db/schema.ts:683-690`), `FEE_STATUSES`
(`credit/index.ts:19`), `lifecycleBadge` (`FeedScreen.tsx:105-112`) and the
page's switch (`PaymentPage.tsx`). The panel reads `lastError` to tell a
same-bank row from another `validating` or `expired` one.

### Contract additions (see contracts/panel.md)

- `feedQuery.awaiting`: `"bank"` (optional).
- `feedCharge.bankCheck`: `{ state: "waiting" | "received" | "not_received",
  by: string | null }` or `null` — derived, never stored.
- `feedCharge.release`: **new** — the feed carries no release today.
  `{ kind: "reconnect" | "protect", lapsed: boolean }` or null, from
  `provisionalReleaseAt` / `releaseKind`; `lapsed` from
  `promiseDeadline(createdAt)` against today in the business's timezone.
- `bankCheckBody`: `{ received: boolean }`; refusals `NOT_AWAITING_BANK`
  (409) and `INTEGRATION_UNAVAILABLE` (503).
- `StatusBadge` kinds: `awaitingBank` ("Por confirmar") and
  `notReceived` ("No llegó").

The payer's status contract (`directPaymentStatusResponse`) is unchanged:
nothing in it says "same bank" (R7).

## Phase B — the statement

### `statement_imports` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | |
| `business_id` | text, not null | tenant (constitution V) |
| `bank` | text, not null | from `BANKS` |
| `format` | text, not null | the reader's id, e.g. `bbva_netcash_v1` |
| `account_tail` | text | last four digits the file names, when it names one (spec Edge Cases: another account is refused) |
| `period_from`, `period_to` | text `YYYY-MM-DD` | the days the file covers — what "a statement covering its day" means (FR-023) |
| `uploaded_by` | text, not null | the operator |
| `read_count`, `matched_count`, `unmatched_count`, `skipped_count`, `unreadable_count`, `already_count` | integer | FR-003, FR-013 |
| `created_at` | integer ms | |

### `statement_credits` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | |
| `business_id` | text, not null | tenant |
| `import_id` | text, not null | the import that first read it |
| `identity` | text, not null | R13; **unique** with `business_id` |
| `kind` | text | `spei` \| `same_bank` |
| `operation_date` | text `YYYY-MM-DD` | the day matched (R12) |
| `amount_cents` | integer, not null | money law |
| `sender_name`, `sender_account`, `reference`, `concept`, `clave`, `folio` | text, nullable | as printed; `clave` only on SPEI |
| `fate` | text | `matched` \| `already` \| `unmatched` \| `assigned` \| `held_undecided` — the list of `unmatched` answers `canAssign` per business (D18) |
| `payment_id` | text, nullable | the payment it confirmed or belongs to |
| `named_customer` | text, nullable | the customer a registered reference names (FR-011) |
| `assigned_by`, `assigned_at` | nullable | FR-012 |
| `created_at` | integer ms | |

Indexes: `(business_id, identity)` unique; `(business_id, fate)`;
`(business_id, operation_date)`.

### `payments` (existing) — one column

| Column | Notes |
| --- | --- |
| `statement_credit_id` | text, nullable — the credit that confirmed the payment. With `reviewed_by` it gives the source: credit alone → "estado de cuenta"; credit + operator → "estado de cuenta, asignado a mano"; operator alone on a same-bank row → "confirmado a mano por el negocio". |

### Validation rules (from the spec)

- Amounts exact to the cent in every match (FR-010).
- A credit confirms at most one payment; a payment is confirmed at most
  once (FR-009, R6's claim).
- A credit dated before the amount was first asked never creates a
  payment (FR-006).
- A 013 undecided row is never decided by a credit (FR-005).
- Statement rows are read only by the business's operators and platform
  operators; no payer contract carries a statement field (FR-015).
