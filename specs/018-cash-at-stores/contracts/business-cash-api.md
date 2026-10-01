# Contract: what the business sees of its cash

`cash-at-stores` D7, D20, D21, D23.

## Pagos: `GET /payments/feed` (changed)

The schemas live in `apps/api/src/routes/payments/schema.ts`
(`@devolada/api/payments-schema`). The route's auth is unchanged:
`requireArea("payments", "read")`.

**Query**: `feedQuery` gains `channel`, which is `spei` or `store` and
optional. When absent, both are listed (FR-031).

**Row changes** in `feedCharge`:

| Field | Change |
| --- | --- |
| `channel` | `z.enum(["spei", "store"])` |
| `storeName` | filled for `store` rows (a left join on `stores`); null for `spei` |
| `storeFeeCents` | new, nullable: the fee the payer paid at the counter |
| `corrections` | new, `{ cents, reason, author, at }[]`; empty for every SPEI row (D21) |
| `proofMode` | the enum gains `none` (data-model) |

A cash row's money fields read with no special case:
- `serviceFeeCents` is 0;
- `askedCents` is the debt;
- `missing` and `surplus` follow (D13).

**Retry and run-now are unchanged**:
- `POST /payments/:id/retry-action`;
- `POST /payments/:id/execute-action`.

Both reach the integration through `paymentActions` (D9), and a cash row
follows the same rules as any other.

## Puntos de pago (new area)

The router is `apps/api/src/routes/cash-points/{index,handler,schema}.ts`,
exported as `@devolada/api/cash-points-schema`. Every query filters by the
actor's business (constitution V).

### `GET /cash-points`

`requireArea("payments", "read")`; a viewer reads it too (FR-035).

```json
{ "success": true, "data": {
  "channelOn": true,
  "stores": [ {
    "storeId": "…", "storeName": "Abarrotes Lupita", "address": "Av. Juárez 12, Centro",
    "storeStatus": "active",
    "heldCents": 435000,
    "lastConfirmed": { "cents": 300000, "at": 1790000000000 },
    "pending": { "id": "…", "cents": 435000, "declaredAt": 1790100000000 }
  } ]
} }
```

The list holds every store with a movement for this business (FR-034).
It never shows another business's cash at the same store (FR-042,
SC-007).

### `POST /cash-points/handovers/:id/confirm`

`requireArea("payments", "operate")`.

- **200** returns the hand-over: `status: "confirmed"`, `resolvedAt`, and
  `resolvedBy` (an email).
- **409 `HANDOVER_NOT_PENDING`.**
- **404 `NOT_FOUND`**, also when the hand-over belongs to another
  business.

### `POST /cash-points/handovers/:id/dispute`

`requireArea("payments", "operate")`. The body is `{ note }`, 3–280
characters.

- **200** with `status: "disputed"` and the note.
- **409 `HANDOVER_NOT_PENDING`.**
- **404 `NOT_FOUND`.**

### `GET /cash-points/stores/:storeId/history?cursor=`

`requireArea("payments", "read")`. Returns this business's hand-overs at
that store, newest first: confirmed, disputed and pending.

## Session: `GET /auth/me` (business branch)

The business actor gains `storeChannel: { on: boolean; since: number |
null }`, read from the `businesses` row the middleware already loads (D7).
The panel shows *Puntos de pago* in the menu when `since` is not null.
