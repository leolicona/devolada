# Contract: the operator's stores, switch and corrections

`cash-at-stores` D4, D6, D7, D21, D22. The schemas extend
`apps/api/src/routes/platform/schema.ts` (`@devolada/api/platform-schema`).

**Auth**: `requireSession` + `requirePlatformOperator`, the router's
existing guard. Anyone else gets 403 `NOT_PLATFORM_OPERATOR` (FR-001,
spec US2 scenario 9).

## Stores

### `GET /platform/stores`

```json
{ "success": true, "data": { "stores": [ {
  "id": "…", "name": "Abarrotes Lupita", "address": "Av. Juárez 12, Centro",
  "shopkeeperName": "Lupita Hernández", "phone": "5512345678",
  "status": "active", "createdAt": 1790000000000,
  "collectsFor": [ { "businessId": "…", "businessName": "WiFi Plus", "heldCents": 435000 } ]
} ] } }
```

`collectsFor` lists the business with the channel on, plus every business
this store still holds cash for.

### `POST /platform/stores`

| Body field | Rule |
| --- | --- |
| `name` | 2–80 characters |
| `address` | 5–200 characters |
| `shopkeeperName` | 2–80 characters |
| `phone` | 10 digits once spaces and dashes are dropped |

**201**:

```json
{ "success": true, "data": { "store": { "…": "…" }, "invitation": { "url": "https://red.devoladapago.com/invitacion/<token>", "expiresAt": 1790604800000, "waLink": "https://wa.me/525512345678?text=…" } } }
```

The plaintext URL appears only in this answer and in a resend's (D4).

- **409 `PHONE_TAKEN`.**

### `PATCH /platform/stores/:id`

| Body field | Rule |
| --- | --- |
| `name`, `address`, `shopkeeperName`, `phone` | optional, same rules as create |
| `status` | optional, `active` or `suspended`; `invited` is never set by hand |

Rules:
- Changing `phone` on an accepted store also changes the user's
  `username`, in the same batch (FR-003).
- Suspending deletes the shopkeeper's session rows (FR-005, FR-014).
- `active` is accepted only for a store that has a `user_id`. A store
  suspended before accepting returns to `invited`.

Errors:
- **409 `PHONE_TAKEN`.**
- **404 `NOT_FOUND`.**

### `POST /platform/stores/:id/invitation`

Resends the invitation: it issues a new one and replaces the open one.
**201** returns the same `invitation` block as create.

- **409 `ALREADY_ACCEPTED`.**

### `GET /platform/stores/:id/ledger/:businessId?cursor=`

The store's cash book for one business. The rows have the shape of the
store's `/store/ledger`, plus `paymentId` and `authorEmail` on
corrections.

### `POST /platform/stores/:id/ledger/:businessId/corrections`

| Body field | Rule |
| --- | --- |
| `paymentId` | a cash payment of this store and this business |
| `cents` | integer ≠ 0, signed |
| `reason` | 3–280 characters |

- **201** `{ id, cents, reason, createdAt }`.
- **404 `NOT_FOUND`** when the payment is not of this store and business.

## The channel switch: `PATCH /platform/businesses/:id`

The body gains `storeChannel: boolean`, optional beside today's
`feeOverrideCents`.

| Answer | When |
| --- | --- |
| 200 with the business row | switched; `store_channel_since` is set the first time |
| 409 `NOT_CAPABLE` | the integration lacks a capability. `error` carries no data; the panel reads `businessRow.capabilities` to name what is missing |
| 409 `ONE_BUSINESS_AT_A_TIME` | another business has the channel on (FR-006) |

`businessRow` gains three fields:
- `storeChannel: { on: boolean; since: number | null }`;
- `capabilities: CapabilityName[]`, from `capabilityNames`, with no
  network call;
- `storeHeldCents`: the SUM over every store.

## The network fee: a platform setting

`SETTINGS` gains `store_fee_cents`: type `cents`, born at 1500, range
0–5000 (D22). It goes through the existing `POST /platform/settings/:key`,
with no new route. The Reglas tab labels it *"Cargo por servicio en
tiendas"*.
