# Contract: what a search result owes, and the search's panel-only filter

`cobros-in-links` D8–D11. The schemas live in
`apps/api/src/routes/direct-payments/schema.ts`, exported as
`@devolada/api/direct-payments-schema`.

## `GET /direct-payments/customers/debt?usuario=<usuario>`

**Auth**: `requireSession`, `requireArea("payments", "read")`, the same as
the customers door. A viewer reads it too.

### Request

| Param | Rule |
| --- | --- |
| `usuario` | required, trimmed, at least one character. A query parameter, not a path segment: usuarios carry `@` |

### What it asks the provider

Two calls, in order, inside one operation budget (D9):

1. `/clientes/?usuario=<usuario>&limit=10`, the exact filter (`getCustomer`).
   It gives the fresh `saldo`, `estado_facturas` and `id_servicio`.
2. `/clientes/<id_servicio>/saldo/`, the open invoices (D10). Only its
   `facturas[]` is used. Its own `saldo` and `url_pago` are ignored
   (FR-015).

### 200

```json
{
  "success": true,
  "data": {
    "usuario": "greyes@wifiplus",
    "state": "owes",
    "totalCents": 79800,
    "invoiceCents": 79800,
    "carriedBalanceCents": 0,
    "invoices": [
      { "invoiceId": 1042, "invoiceDate": "2026-09-23", "dueDate": "2026-10-03", "totalCents": 79800 }
    ]
  }
}
```

The same customer the day before the billing run reads `state: "owes"`,
`invoiceCents: 0`, `carriedBalanceCents: 29900`, `totalCents: 29900` and
`invoices: []`. That is the short-payer, found (SC-008).

| `state` | Carries |
| --- | --- |
| `owes` | every amount field; `totalCents` > 0 |
| `none` | every amount field; `totalCents` = 0 and proven (`nothingOwedIsProven`) |
| `unconfirmed` | `usuario` and `state` only. Covers four cases: WispHub timed out or failed, the customer no longer exists, the balance door's body is unreadable, or zero is not proven |

### Errors

| Status | `error.code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `usuario` missing or blank |
| 401 / 403 | `AUTHENTICATION_ERROR` / `FORBIDDEN_FOR_ROLE` | no session or not a business, or no `payments:read` |
| 409 | `NOT_CONFIGURED` | no WispHub integration |
| 503 | `WISPHUB_AUTH_FAILED` | WispHub refused the key: the page shows the setup message |

An outage is **never** a 5xx on this door. It is `unconfirmed`, so one row
says so and the others keep working.

## `GET /direct-payments/customers`: one new optional parameter

| Param | Rule |
| --- | --- |
| `channel` | optional, `"panel"` only. When present, API links are skipped on every path: search, browse and the offline fallback. Absent means today's behaviour exactly |

Everything else about the door is unchanged (`links-on-demand-search`
contracts).
