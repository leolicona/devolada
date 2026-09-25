# Data Model: Cobros On-Demand Search

**Feature**: `010-cobros-on-demand-search` | **Date**: 2026-09-22

## No schema change

This feature adds no table, no column and no migration. Devolada stores no
debt and no receipt — `cobros-live D6` decided that and it still holds. What
follows are the shapes that travel and the two stored tables that are
**read**.

## Shapes that travel

### `CobroRow` — one debtor on screen

| Field | Type | Meaning |
| --- | --- | --- |
| `usuario` | `string` | the customer's identity, and the link's |
| `name` | `string \| null` | as the provider answers it now; null falls back to `usuario` |
| `totalCents` | `int \| null` | what this row owes. `null` only with `debt: "unknown"` |
| `debt` | `"owed" \| "none" \| "unknown"` | D5: a zero that is proven, and a zero that is not, are different answers |
| `receipts` | `Receipt[]` | the pending receipts this row accounts for; empty when the debt is carried in the running account alone |
| `oldestDue` | `string \| null` | `YYYY-MM-DD`, for order and the overdue mark |

`debt` is the field FR-008 turns on. `"none"` is *Sin adeudo*; `"unknown"`
is *No pudimos confirmar* and renders no amount. A browse row is always
`"owed"` — it exists because a receipt exists.

### `Receipt` — one pending invoice

| Field | Type | Meaning |
| --- | --- | --- |
| `externalId` | `int` | WispHub's invoice id — the only id there is |
| `amountCents` | `int` | integer cents (constitution II); the provider's JSON number converts by `amountToCents` |
| `invoiceDate` | `string \| null` | `YYYY-MM-DD` |
| `dueDate` | `string \| null` | `YYYY-MM-DD`; null belongs to no due-date tab (D7) |

Unchanged from today's `cobroRow` except that `customerUsuario` and
`customerName` move up to the `CobroRow` that owns it — the row was already
grouped by customer in the browser, and grouping it in the contract is what
lets a search answer a customer who has no receipt at all.

### Response

| Field | Type | Meaning |
| --- | --- | --- |
| `rows` | `CobroRow[]` | the block, or the search's results |
| `nextCursor` | `string \| null` | opaque (D2). `null` on a search — a search answers one block (`009 D5`) |
| `total` | `int \| null` | provider's `count` for this walk; null when it did not answer one (D8) |
| `matched` | `int \| null` | search only: a floor, never a total (D4) |
| `source` | `"live" \| "snapshot"` | which read answered (D12) |
| `readAt` | `int \| null` | ms. Present only when `source` is `"snapshot"` — a live block has no age to report (D12) |
| `wisphub` | `"ok" \| "unavailable"` | D9. Refusal and absence are errors, not states |

`complete` is **gone** (D8), and with it the "la lista puede estar
incompleta" warning.

### Request

| Param | Type | Rule |
| --- | --- | --- |
| `q` | `string?` | trimmed; empty → absent. Refused below 3 characters (FR-003) |
| `limit` | `int?` | clamped 10–50 server-side, as `009 D3` clamps the Links block |
| `cursor` | `string?` | opaque; only the server builds one. Rejected with `VALIDATION_ERROR` if unreadable |
| `filter` | `"all" \| "overdue" \| "upcoming"?` | default `all`. Decides the provider walk (D7), never a filter over loaded rows |

`q` and `cursor` together are a contradiction — a search answers one block —
and the door refuses the pair rather than silently ignoring one.

## The cursor

Opaque to the client, two shapes inside (D2, D3):

- **live**: the provider path the walk continues from — WispHub's own `next`,
  trimmed to the API path exactly as `pendingInvoicesPage` already trims it.
- **snapshot**: the offset into the served pass's rows.

The cursor carries the `filter` it was created under. A cursor from another
walk is refused: FR-015 says a filter change starts its own walk, and
silently continuing the old one would put rows outside the tab into it.

## Stored tables this feature reads

Read-only. No write, no migration.

| Table | Why | Owner |
| --- | --- | --- |
| `wisphub_sweeps`, `wisphub_pages` | the served pass, when a snapshot answers (D3) | `snapshot.ts` |
| `payments` | the invoices Devolada already registered are subtracted from a snapshot block, and `MAX(payment_registered_at)` keys the display cache | `snapshot.ts`, `cache.ts` |
| `integrations` | the tenant's key and installation | `integrations/store.ts` |
| `payment_links` | not read by this door. The row's link is created by the act, through `POST /direct-payments/links` (`009 D8`) | — |

## Derived values, and where they are decided

| Value | Decided by | Notes |
| --- | --- | --- |
| what a customer owes | `debtFor` (`wisphub/debt.ts`) | invoices + `saldo`, credit netted. Unchanged |
| whether a zero is believable | `nothingOwedIsProven` | drives `debt: "none"` vs `"unknown"` |
| overdue | `dueDate < today` in the **business timezone** | FR-025, unchanged |
| the four search filters | `searchCustomers` (`wisphub/client.ts`) | unchanged from `009 D4` |
| the block's provider path | `pendingInvoicesPath` + `tipo_fecha` / window per filter | D7 |
