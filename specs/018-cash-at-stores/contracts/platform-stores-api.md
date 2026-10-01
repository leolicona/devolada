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
- `status: "active"` on a store with no `user_id` (suspended before its
  shopkeeper accepted) returns it to `invited`. Its open invitation works
  again while it is within its seven days; otherwise the operator re-sends
  it. *(Settled 2026-10-01, /speckit-analyze M6.)*

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

## The network fee and the receipt message: platform settings

Both go through the existing `GET /platform/settings` and `POST
/platform/settings/:key {value}`, with no new route.

| Key | Type | Reglas label | Rule |
| --- | --- | --- | --- |
| `store_fee_cents` | `cents` | *"Cargo por servicio en tiendas"* | born at 1500, range 0–5000 (D22) |
| `store_receipt_template` | `template` | *"Mensaje del comprobante (WhatsApp)"* | born at research D31's default; 20–1000 characters; `{folio}` required; only D31's placeholders |

- `settingItem.type` gains `"template"`.
- A refused template answers 400 `INVALID_SETTING`, as every invalid
  setting does today. The panel checks the same rules before saving, so it
  can name the problem: a missing `{folio}`, an unknown placeholder, or
  the length (FR-043).
- The Reglas tab renders `template` as a text area, with the placeholders
  listed beside it and a preview filled with sample data.
