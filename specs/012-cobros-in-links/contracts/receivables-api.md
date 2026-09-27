# Contract: `GET /payment-requests` — the Por cobrar list in blocks

`cobros-in-links` D1–D7 and D18. The schema lives in
`apps/api/src/routes/payment-requests/schema.ts` and is exported as
`@devolada/api/payment-requests-schema` (constitution III). Fixtures in MSW
handlers and Playwright stubs are validated against it.

## Request

`GET /payment-requests?limit=<n>&cursor=<opaque>`

| Param | Rule |
| --- | --- |
| `limit` | integer, clamped to 10–50, default 20 (the Links band, D4) |
| `cursor` | optional, opaque (D2); absent means the first block |

**Auth**: a business session. Every role reads, as today: `requireSession`, no
`requireArea` (`cobros-live` D4). A non-business actor gets
`403 AUTHENTICATION_ERROR`.

## Responses

### 200: a block

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "externalId": 1042,
        "customerUsuario": "greyes@wifiplus",
        "customerName": "Janely",
        "amountCents": 79800,
        "invoiceDate": "2026-09-23",
        "dueDate": "2026-10-03",
        "periodCents": 49900,
        "carriedCents": 29900,
        "period": "Periodo del 15/Sept./2026 al 15/Oct./2026"
      }
    ],
    "nextCursor": "aW52OjIwMjYtMDMtMjk6MjAyNi0wOS0yNjoyMDoyMA",
    "total": 193,
    "integration": "ok"
  }
}
```

- `results` follows the provider's order and holds one row per invoice.
  The client groups them by customer (D6).
- `nextCursor` is `null` in two cases: the provider's `next` was null (the
  walk has ended), or `integration` is `unavailable`.
- `total` is the provider's `count` for the window. It is `null` when the
  envelope lacks it (FR-007).
- `integration` names no provider (constitution IX). It says whether the
  business's integration answered.

### 200: provider away (D7)

```json
{ "success": true, "data": { "results": [], "nextCursor": null, "total": null, "integration": "unavailable" } }
```

This is **never** read as "nobody has an open invoice". "Nobody" is
`integration: "ok"` with no rows and `nextCursor: null`.

### Errors

| Status | `error.code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | unreadable cursor, or a limit that is not an integer |
| 403 | `AUTHENTICATION_ERROR` | the actor is not a business |
| 409 | `NOT_CONFIGURED` | no integration, or one without the `receivables` capability (the page falls back to the customer view, D13) |
| 503 | `INTEGRATION_AUTH_FAILED` | the provider refused the key: a setup problem, sent to Integraciones |

## Who asks the provider

The core handler asks the integration's `receivables` capability for one
page and passes the cursor through untouched (D18). It builds no
provider path and imports nothing from `wisphub/`.

The WispHub adapter answers with exactly one call per request:

`/facturas/?estado=1&tipo_fecha=fecha_emision&desde=<d>&hasta=<h>&limit=<n>[&offset=<o>|&page=<p>]`

- **The window.** `desde` and `hasta` come from the adapter's cursor, or, on the
  first block, from today's rule: 180 days back, one day ahead.
- **Never the sweep's copy.** It reads no snapshot, no `wisphubPages` row
  and no display cache (D3, SC-006).
