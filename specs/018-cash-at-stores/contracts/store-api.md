# Contract: the shopkeeper's API

`cash-at-stores` D2–D5, D8, D14–D20, D24–D25. The schemas live in
`apps/api/src/routes/store/schema.ts`, exported as
`@devolada/api/store-schema`. They are imported by `apps/red`, its MSW
handlers and the Playwright stubs.

Every answer wears the one envelope, with `UPPER_SNAKE` codes. These are
browser-facing routes, so they never carry `message` or `retryable`
(constitution III).

**Auth.** `requireStore` (D2) guards every route below except the two
invitation routes:
- no session → 401 `AUTHENTICATION_ERROR`;
- a business member → 403 `WRONG_ACTOR`;
- a suspended store → 403 `STORE_SUSPENDED`, and the session row is
  deleted.

**The business, at the counter.** The counter routes (search, quote,
record) always serve the one business with the channel on (D7), and take
no `businessId` from the client:
- no business with the channel on → 409 `CHANNEL_OFF`;
- that business's integration lacks a capability → 409 `NOT_CAPABLE`.

**The business, in the cash book.** The cash-book routes are
`/store/cashbox`, `/store/ledger`, `/store/handovers`,
`/store/collections/:id` and its receipt. They serve every business this
store has movements with, **whether or not its channel is still on**. This
is what lets a store hand over cash after the channel is switched off (the
spec's edge case). A `businessId` they take must be one of those
businesses; otherwise the route answers 404 `NOT_FOUND`. They never answer
`CHANNEL_OFF`. *(Corrected 2026-10-01, /speckit-analyze H1.)*

Neither should happen while the operator's guard holds. Both are answers,
not crashes.

---

## Invitation (session-less)

### `GET /store/invitations/:token`

Rate-limited 30/min per IP.

```json
{ "success": true, "data": { "state": "open", "storeName": "Abarrotes Lupita", "phoneTail": "5678" } }
```

`state` is one of:
- `open`;
- `invalid`, covering unknown, accepted, replaced, expired, or a
  suspended store (D4).

`phoneTail` shows the last four digits, so the shopkeeper can recognise
their own number. With `invalid`, only `state` is sent.

### `POST /store/invitations/:token/accept`

Rate-limited 5/min per IP.

| Body field | Rule |
| --- | --- |
| `email` | a valid email, trimmed, lower-cased |
| `password` | 8–128 characters |

- **201** `{ "email": "…" }`. The verification code has been sent. The
  app then calls Better Auth's `POST /auth/email-otp/verify-email
  {email, otp}`, which signs the shopkeeper in
  (`autoSignInAfterVerification`).
- **400 `INVALID_INVITATION`.**
- **409 `EMAIL_TAKEN`** (D5: an existing user, or an operator's address).

### Sign-in and recovery: Better Auth's own endpoints

The clients call these through `baPost` (constitution III's exemption):

- `POST /auth/sign-in/username {username: <10-digit phone>, password}`;
- `POST /auth/email-otp/send-verification-otp {email, type}`, with `type`
  either `forget-password` or `email-verification`;
- `POST /auth/email-otp/reset-password`;
- passkey sign-in and enrolment through `@better-auth/passkey`'s client.

### `GET /auth/me`

It answers a union. For a shopkeeper:

```json
{ "success": true, "data": { "type": "store", "storeId": "…", "name": "Abarrotes Lupita", "businessName": "WiFi Plus" } }
```

`businessName` is the business with the channel on, or null.

---

## The counter

### `GET /store/customers?q=<text>` (D8, D24)

- `q` is trimmed. Fewer than three characters → 400 `QUERY_TOO_SHORT`.
- The limit is fixed at 10.

```json
{ "success": true, "data": {
  "rows": [ { "usuario": "greyes@wifiplus", "name": "Guadalupe Reyes", "zone": "Centro" } ],
  "more": false,
  "integration": "ok"
} }
```

`integration` is `ok` or `unavailable`. With `unavailable`, `rows` is
empty: the app says the business's system is not answering, and never
"sin resultados" (FR-028).

There is no phone, address or provider id in the answer (FR-017).

### `GET /store/customers/debt?usuario=<usuario>` (D14)

```json
{ "success": true, "data": {
  "usuario": "greyes@wifiplus", "name": "Guadalupe Reyes", "zone": "Centro",
  "state": "owes",
  "debtCents": 79800, "invoiceCents": 49900, "carriedBalanceCents": 29900,
  "feeCents": 1500, "totalCents": 81300
} }
```

| `state` | Carries |
| --- | --- |
| `owes` | every field, and `reconnectsFromCents` (below) |
| `none` | every field; `debtCents` = 0. The app shows *Sin adeudo* (FR-018) |
| `unavailable` | `usuario` and `state` only. The integration failed, or zero is not proven (D14) |

*(Added at implementation, 2026-10-01.)* `reconnectsFromCents` on `owes`:
the smallest amount that brings the service back under the business's own
rule (class → mapped action, threshold, floor; D13 with no fee), or `null`
when no amount does at the counter (the whole debt maps to register-only,
or the business keeps its actions in observation). It is how the app "says
so before confirming" in the spec's edge case on a short payment below the
threshold; the contract had no other way to know it before the record.

### `POST /store/collections` (D11, D13–D16, D25)

| Body field | Rule |
| --- | --- |
| `usuario` | required |
| `amountCents` | integer, > 0 |
| `expectedDebtCents` | integer ≥ 0: the debt the payer was shown |
| `expectedFeeCents` | integer ≥ 0: the fee the payer was shown |
| `collectionKey` | UUID, generated once per confirm screen |

**201**, or **200** for a `collectionKey` already recorded (D15):

```json
{ "success": true, "data": { "id": "…", "folio": "DV-7K2Q9M" } }
```

The first action attempt runs after the answer (D25).

| Error | When |
| --- | --- |
| 409 `AMOUNT_CHANGED` | the fresh debt or the fee differs from the expected ones. `error` carries no data, and the app re-reads the quote (FR-021) |
| 409 `NOTHING_DUE` | the fresh debt is zero |
| 400 `AMOUNT_ABOVE_DEBT` | `amountCents` > the fresh debt (FR-019) |
| 503 `INTEGRATION_UNAVAILABLE` | the debt could not be read or proven (D14) |
| 409 `CHANNEL_OFF`, `NOT_CAPABLE` | see Auth |

### `GET /store/collections/:id`

Only the store's own rows; any other id → 404 `NOT_FOUND`. The app polls
it every 3 s while `outcome` is `queued`.

```json
{ "success": true, "data": {
  "id": "…", "folio": "DV-7K2Q9M", "createdAt": 1790000000000,
  "customerName": "Guadalupe Reyes", "amountCents": 79800, "feeCents": 1500,
  "class": "exact", "remainingCents": 0,
  "outcome": "reconnected"
} }
```

`outcome` is one of six values. It is mapped from the row's
`actionOutcome` and the action decided for its class (FR-025,
/speckit-analyze H2):

| `outcome` | Row | Decided action |
| --- | --- | --- |
| `reconnected` | `done` | `register_and_reconnect` |
| `registered` | `done` | `register_only` (the business's own rule) |
| `queued` | `queued` | any |
| `not_reconnected_short` | `withheld` | register, below the threshold |
| `observation` | `observation` | any |
| `failed` | `failed` | any |

Each outcome is shown as icon + text. A cash row is never `review` (D13).

### `GET /store/collections/:id/receipt` (D18, D31)

The app calls it only when the shopkeeper taps *Enviar comprobante*.

```json
{ "success": true, "data": { "text": "Comprobante de pago · WiFi Plus\n\nFolio: DV-7K2Q9M\n…", "waLink": "https://wa.me/525512345678?text=…", "hasPhone": true } }
```

- **`text`** is the operator's `store_receipt_template`, filled in for
  this payment (D31).
- **`waLink`** carries the customer's phone, read at this moment through
  the integration's `customersWithPhone.phoneOf`. **It is not written
  anywhere** (constitution V, v1.9.0).
- **With no phone** (no capability, none on file, a number that is not
  ten readable digits, or no answer in time),
  `waLink` is `https://wa.me/?text=…` and `hasPhone` is `false`. The app
  asks the shopkeeper for a number and builds
  `https://wa.me/52<digits>?text=<text>` itself. **That number is never
  sent to the API** (FR-027).
- **Another store's payment** → 404 `NOT_FOUND`.

---

## The cash book

### `GET /store/cashbox`

```json
{ "success": true, "data": { "businesses": [ {
  "businessId": "…", "businessName": "WiFi Plus",
  "heldCents": 435000, "feesSinceHandoverCents": 4500,
  "lastHandover": { "cents": 300000, "status": "confirmed", "at": 1790000000000, "note": null },
  "pendingHandover": null
} ] } }
```

There is one entry per business the store holds cash for, or collects
for.

### `GET /store/ledger?cursor=<opaque>`

Newest first, 20 per page.

```json
{ "success": true, "data": {
  "rows": [ { "kind": "collection", "cents": 79800, "at": 1790000000000, "businessName": "WiFi Plus", "folio": "DV-7K2Q9M", "customerName": "Guadalupe Reyes", "reason": null } ],
  "nextCursor": null
} }
```

### `POST /store/handovers`

| Body field | Rule |
| --- | --- |
| `businessId` | one of the businesses in `/store/cashbox` |
| `cents` | integer, > 0 |

- **201** `{ id, status: "pending" }`.
- **409 `HANDOVER_PENDING`.**
- **400 `AMOUNT_EXCEEDS_HELD`.**
