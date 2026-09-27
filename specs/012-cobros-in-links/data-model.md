# Data Model: Cobros in Links

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

**No table changes and no migration.** Devolada stores nothing new: open
invoices and debts are read from WispHub when they are shown, and are
never kept (spec Key Entities). The only stored thing this feature
touches is the payment link, and it is untouched: it is still born on
the act, identified by `usuario` (`links-on-demand-search` FR-008,
FR-009).

What follows are the shapes that exist in memory and on the wire.

## Core and adapter (D18, constitution IX)

The core defines the shapes below in its own words, in
`apps/api/src/integrations/capabilities.ts`. The WispHub adapter fills
them. The core handlers never see a WispHub row, path or cursor.

| Capability | Core call | WispHub fills it with |
| --- | --- | --- |
| `receivables` | `page(cursor: string \| null, limit) → ReceivablesPage \| "bad_cursor"` | one `/facturas/` call; the `inv:` cursor |
| `customerDebt` | `of(usuario) → CustomerDebtAnswer` | `getCustomer`, then `/clientes/{id}/saldo/` (GET only), composed with `debtFor` |

Failures reach the core as `IntegrationError`: `INTEGRATION_UNAVAILABLE`
or `INTEGRATION_AUTH_FAILED`. The session carries
`integrationCapabilities: ("receivables" | "customerDebt")[]` (D13).

## Open invoice (adapter → core)

The core's `OpenInvoice` carries the fields below. Inside the adapter,
`PendingInvoice` in `apps/api/src/wisphub/client.ts` gains the three
**optional** fields it needs to fill them (D5). The money paths read
`totalCents` only and are unaffected.

| Field | Type | From WispHub | Rule |
| --- | --- | --- | --- |
| `invoiceId` | int | `id_factura` | existing |
| `usuario` | string | `cliente.usuario` | existing; a row without it is dropped, as today |
| `customerName` | string \| null | `cliente.nombre` | existing |
| `totalCents` | int | `total` | existing; money law II |
| `invoiceDate` | `YYYY-MM-DD` \| null | `fecha_emision` | existing |
| `dueDate` | `YYYY-MM-DD` \| null | `fecha_vencimiento` | existing |
| `periodCents` | int \| null | `sub_total` | new; null when absent or unreadable |
| `carriedCents` | int \| null | the invoice's `saldo` | new; the *saldo anterior* (measured 299.00 of 798.00) |
| `period` | string \| null | the first line item text matching `Periodo del … al …` | new; the matched phrase, trimmed |

## Receivables block (API → admin)

This is the new body of `GET /payment-requests` (D1). See
[contracts/receivables-api.md](./contracts/receivables-api.md).

| Field | Type | Meaning |
| --- | --- | --- |
| `results` | `CobroRow[]` | the block's invoices, in the provider's order |
| `nextCursor` | string \| null | opaque (D2); null when the walk ends or the provider is away |
| `total` | int \| null | the provider's own count of open invoices in the window; null when absent (FR-007) |
| `integration` | `"ok"` \| `"unavailable"` | D7: `unavailable` with no rows is *could not read*, never *nobody owes* |

`CobroRow` keeps its six fields and gains `periodCents`, `carriedCents` and
`period`, all nullable.

### Receivables cursor (inside `nextCursor`, owned by the WispHub adapter)

`inv:<desde>:<hasta>:<offset>:<limit>`, base64url, the numbers the
provider's `next` carries (D2; M1 measured `offset` 2026-09-27).
The adapter rebuilds the provider path from the fixed filter
(`estado=1&tipo_fecha=fecha_emision`) and these values only.

The core passes it through untouched. The adapter refuses it, and the
core answers `400 VALIDATION_ERROR`, when:
- its prefix is not one this version writes;
- a date is not `YYYY-MM-DD`, or `desde > hasta`;
- a number is not a non-negative safe integer.

## Cobros row (admin, derived)

The screen groups the loaded `CobroRow`s by `usuario` (D6). This is
`groupCobros` without its sort. Named `CobroRow` in code; the spec calls it
the Por cobrar row.

| Field | Derived as |
| --- | --- |
| `usuario`, `name` | the first invoice seen; the name updates if a later one carries it |
| `totalCents` | sum of the loaded invoices' `totalCents` |
| `invoices` | the loaded invoices, oldest issue first |
| `oldestDue` | the earliest `dueDate`, else the earliest `invoiceDate` |
| `overdue` | some `dueDate` < today, in the business's timezone |

Rows keep the order in which each customer first appeared. A later block
only grows a row. It never moves it.

## Customer debt (API → admin)

This is the body of `GET /direct-payments/customers/debt?usuario=` (D9).
See [contracts/customer-debt-api.md](./contracts/customer-debt-api.md).

| Field | Type | Present when |
| --- | --- | --- |
| `usuario` | string | always |
| `state` | `"owes"` \| `"none"` \| `"unconfirmed"` | always (FR-018) |
| `totalCents` | int | `owes` (> 0) and `none` (0) |
| `invoiceCents` | int | `owes`, `none`; after a credit is netted (`debt-truth` D12) |
| `carriedBalanceCents` | int | `owes`, `none`; never negative |
| `invoices` | `{ invoiceId, invoiceDate, dueDate, totalCents }[]` | `owes`, `none`; every open invoice, with no window |

### State rules

The debt is `debtFor(record, { invoices, complete: true, source: "live" })`.

| Condition | `state` |
| --- | --- |
| both reads answered and `totalCents` > 0 | `owes` |
| both reads answered, `totalCents` = 0, and `nothingOwedIsProven` | `none` |
| a read failed, the record is gone, the balance door is unreadable, or zero is unproven | `unconfirmed` |

`unconfirmed` carries no amount and is never rendered as zero.

## View (admin, in the address)

`/links?view=receivables&q=…`. `view` is absent (customer view, the
default) or `receivables`. Any other value reads as absent. The `q` text
is shared by both views.

Local memory (`seen.ts`) and query keys include the view (D12).

## Retired

| Retired | Replaced by |
| --- | --- |
| `paymentRequestsResponse.cobros`, `.complete`, `.readAt` | `results`, `nextCursor`, `total`, `integration` |
| The admin route `/payment-requests` and `CobrosScreen` | the redirect, and the Por cobrar view in Links |
