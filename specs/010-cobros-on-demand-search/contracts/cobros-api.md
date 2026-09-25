# Contract: `GET /payment-requests`

**Feature**: `010-cobros-on-demand-search` | **Date**: 2026-09-22

One door, browse and search (D1). Session only — the panel's Cobros screen
is its only caller. `apps/api/src/routes/payment-requests/schema.ts` is the
contract (constitution III); the admin, the MSW handlers and the Playwright
stubs derive from it.

**Auth**: `requireSession`. No `requireArea` — every member reads Cobros
(`cobros-live D4`), and the handler still refuses a non-business actor.

## Request

```
GET /payment-requests?limit=20&filter=overdue
GET /payment-requests?limit=20&cursor=<opaque>
GET /payment-requests?q=mar&limit=20
```

| Param | Type | Default | Rules |
| --- | --- | --- | --- |
| `q` | string | — | trimmed; `""` → absent. `< 3` chars → `VALIDATION_ERROR` |
| `limit` | int | 20 | clamped to 10–50 server-side |
| `cursor` | string | — | opaque; unreadable → `VALIDATION_ERROR` |
| `filter` | enum | `all` | `all` \| `overdue` \| `upcoming` |

`q` **with** `cursor` → `VALIDATION_ERROR`. A search answers one block, so a
cursor alongside it can only be a client bug.

`filter` is ignored when `q` is present: a search answers the whole debt of
a customer, which no due-date window describes.

## Response — browse

```jsonc
{
  "success": true,
  "data": {
    "rows": [
      { "usuario": "jperez",
        "name": "Juan Pérez",
        "totalCents": 149700,
        "debt": "owed",
        "oldestDue": "2026-09-10",
        "receipts": [
          { "externalId": 4821, "amountCents": 49900,
            "invoiceDate": "2026-09-01", "dueDate": "2026-09-10" }
        ] }
    ],
    "nextCursor": "eyJ2IjoxLCJmIjoiYWxsIiwicCI6Ii9mYWN0dXJhcy8_…",
    "total": 812,
    "matched": null,
    "source": "live",
    "readAt": null,
    "wisphub": "ok"
  }
}
```

- `nextCursor: null` means the walk ended. The page stops and says how many
  receipts the ISP has (`total`).
- `readAt` is present **only** with `source: "snapshot"` (D12): a live block
  is read when it renders and has no age to report.

## Response — search

```jsonc
{
  "success": true,
  "data": {
    "rows": [
      { "usuario": "mgarcia", "name": "María García",
        "totalCents": 6000, "debt": "owed", "oldestDue": null,
        "receipts": [] },
      { "usuario": "mrivera", "name": "Mario Rivera",
        "totalCents": 0, "debt": "none", "oldestDue": null,
        "receipts": [] },
      { "usuario": "mlopez", "name": "Marta López",
        "totalCents": null, "debt": "unknown", "oldestDue": null,
        "receipts": [] }
    ],
    "nextCursor": null,
    "total": null,
    "matched": 904,
    "source": "live",
    "readAt": null,
    "wisphub": "ok"
  }
}
```

The first row is the case this feature exists for: `receipts` is empty and
`totalCents` is 6000 — a customer who short-paid, whose remainder lives in
the running account and who appears on no list the browse can draw.

`matched` is a **floor**, not a total (D4): the page says "más de 904" and
asks for more characters.

`debt: "unknown"` carries `totalCents: null`. A client that renders an
amount for it is a client bug — the zero is exactly what could not be
proven.

## Errors

| Code | Status | When | What the screen does |
| --- | --- | --- | --- |
| `AUTHENTICATION_ERROR` | 403 | actor is not a business | — |
| `VALIDATION_ERROR` | 400 | `q` under 3 chars, `q` with `cursor`, unreadable cursor, bad `filter` | — |
| `NOT_CONFIGURED` | 409 | no WispHub key | "Conecta WispHub" → Integraciones |
| `WISPHUB_AUTH_FAILED` | 503 | key refused | Integraciones, **no Reintentar** |
| `WISPHUB_UNAVAILABLE` | 503 | outage or deadline, **and nothing to answer with** | error block with Reintentar, or the quiet note when rows are already on screen |

`WISPHUB_UNAVAILABLE` and `WISPHUB_AUTH_FAILED` stay separate codes — folding
them is what `bug: cobros-installation-fallback` was.

### The one asymmetry with Links

`009 D10` lets a Links search answer under a quiet note when the provider is
away, because Devolada holds links to answer with. **Devolada holds no
debt.** A Cobros search with the provider away has nothing true to say, and
an empty list would read as "nobody owes" — so it answers
`WISPHUB_UNAVAILABLE` and the page says the search needs WispHub (D9,
FR-020). It never renders an empty result under a note.

A *browse* that already has rows keeps them under the note, as today: those
rows were true when they arrived.

## What is unchanged

- `GET /payments/pulse` — untouched. The page still re-reads its first block
  when the tenant's last registered payment moves.
- `POST /direct-payments/links` — untouched. It remains the only thing that
  creates a panel link, and both buttons on a Cobros row press it
  (`009 D8`, `009 FR-025`).
- The envelope, the `UPPER_SNAKE` codes, and the rule that a browser-facing
  route carries no `message` and no `retryable` (constitution III).
