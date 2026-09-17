# Contract: the public collections API (`/v1`)

**Date**: 2026-09-12 | **Research**: [research.md](../research.md)

The zod schemas in `apps/api/src/routes/v1/<area>/schema.ts` are the contract
(constitution III); this file is the human-readable shape they must produce.
Exported from `@devolada/api` as `./v1-schema` so the panel, the MSW handlers and
the Playwright stubs validate against the same definition.

## Shape rules

- **Envelope**: `{ success: true, data }` or
  `{ success: false, error: { code, retryable } }`, `UPPER_SNAKE` codes.
  `retryable` is present on this surface, as it is on Consta's: FR-025 requires a
  caller to tell "retry this" from "fix your request", and a code list alone
  cannot say which is which. Logged in the plan's Complexity Tracking.
- **Auth**: `Authorization: Bearer dk_…`. No cookies, no CORS — server to server.
- **Money**: integer cents, always named `*Cents`.
- **Time**: milliseconds since epoch. Date-only filters are days in the
  business's timezone (FR-021).
- **Idempotency**: any POST accepts `Idempotency-Key`; repeating it replays the
  first response (FR-008).
- **Limit**: 120 requests per minute per business, every endpoint counted
  together (FR-024, D13). Past it, `RATE_LIMITED` with a `Retry-After` header
  in seconds — the rest of the current minute.

---

## `POST /v1/payment-links`

Create a link (US1).

```jsonc
{
  "customerRef": "CLI-4471",        // required, 1–128 chars, the caller's own id
  "askCents": 49900,                // required, positive integer
  "mode": "reusable",               // "reusable" | "one_time", default "reusable"
  "expiresAt": 1760000000000,       // required when one_time, else forbidden
  "label": "Ana Ruiz",              // optional, shown to the payer
  "concept": "Mensualidad octubre"  // optional, shown to the payer
}
```

Answers `{ id, url, customerRef, askCents, mode, expiresAt, state, isTest }`.

`state` is `open | paid | expired` (derived, see data-model).

Asking again for a **reusable** link with the same `customerRef` returns the
existing one (FR-033) — not an error, and not a second link.

Refusals: `VALIDATION_ERROR` (bad amount, one-time without a deadline),
`CHANNEL_UNAVAILABLE` with which piece is missing — CLABE, bank or validation
credential (FR-009), `BUSINESS_SUSPENDED`, `AUTHENTICATION_ERROR`,
`RATE_LIMITED`.

## `PATCH /v1/payment-links/:id`

Re-price or close (FR-030).

```jsonc
{ "askCents": 52000 }   // reusable only
{ "close": true }       // either kind; idempotent
```

Re-pricing a one-time link is `VALIDATION_ERROR` — its amount is the thing it
is. Re-pricing a closed link is `LINK_CLOSED`.

## `GET /v1/payment-links/:id` · `GET /v1/payment-links?customerRef=…`

Read one, or find a customer's links.

---

## `GET /v1/payments/:id` · `GET /v1/payments?customerRef=…`

The verify path (US3).

```jsonc
{
  "id": "pay_…",
  "customerRef": "CLI-4471",
  "status": "confirmed",       // the payment row's own word — see the table below
  "askedCents": 49900,
  "receivedCents": 49900,
  "match": "exact",            // exact | short | over — null while validating
  "folio": "DV-000412",        // null until confirmed
  "confirmedAt": 1759999000000,
  "createdAt": 1759998000000,
  "isTest": false
}
```

**`status` is the payment row's own vocabulary** (research D17). The API
invents no second set of names: every value below is a value of
`payments.status` in `apps/api/src/db/schema.ts`, with the meaning the schema
comment gives it. `match` is a different axis — the reconciliation class
(`exact | short | over`, `classes.ts`) — and `short` belongs there, never in
`status`.

Every state is announced the moment the payment enters it, as
`payment.<status>` (FR-013, clarified 2026-09-17).

| `status` | terminal | announced as | meaning for the caller |
| --- | --- | --- | --- |
| `validating` | no | `payment.validating` | the customer's proof was accepted and is with Banxico. A claim exists; nothing is money yet |
| `queued_for_credit` | no | `payment.queued_for_credit` | the business's validation credit is paused; nothing is asked of Banxico until a top-up lifts it, and the payment then continues as `validating` (announced again). The caller sees why nothing is moving |
| `confirmed` | yes | `payment.confirmed` | the money arrived and covered the ask (`match` is `exact` or `over`) |
| `partial` | yes | `payment.partial` | the money arrived but fell short of the ask (`match` is `short`); the business's to decide |
| `unapplied` | yes | `payment.unapplied` | validated, but settled nothing — the link had closed, or the ask was zero (D16) |
| `invalid` | yes | `payment.invalid` | Banxico found no such transfer, or it was already used |
| `expired` | yes | `payment.expired` | validation gave up: the transfer was never found in time |
| `superseded` | yes | `payment.superseded` | a silent attempt whose reading the payer then corrected; the corrected attempt is a new payment with its own id and its own verdict. Not an error — Devolada was the one that read it wrong |

A `customerRef` with nothing received answers `{ payments: [] }` — an empty
list, never `NOT_FOUND` (FR-019, US3 scenario 3).

A payment belonging to another business answers `NOT_FOUND` (FR-023).

## `GET /v1/transfers?from=2026-09-01&to=2026-09-30&limit=&cursor=`

The reconciliation path (US4). `from`/`to` are days in the business's timezone.

Answers `{ transfers: [...], nextCursor }`. The cursor is keyed on
`(confirmedAt, id)` so a payment confirmed while the caller is walking the pages
cannot make it skip or repeat one (FR-020).

`unapplied` here means **validated but not applied** — a payment on a link that
had closed, or against an ask of zero. It is not a feed of the business's bank
account; Devolada has no bank connection and learns of a transfer only when a
payer submits its proof (D16).

---

## `PUT /v1/webhook` · `GET /v1/webhook` · `DELETE /v1/webhook`

Register where outcomes go (FR-012).

```jsonc
{ "url": "https://gym.example/hooks/devolada" }
```

Answers `{ url, createdAt }`. There is no secret to copy and nothing to rotate:
deliveries are signed with Devolada's own key, whose public half is published
at the JWKS endpoint below (FR-015, FR-039, D10).

`POST /v1/webhook/deliveries/:id/retry` re-sends a failed delivery, same event id
and same body (FR-041).

`GET /v1/webhook/deliveries` lists attempts with their results (FR-026).

Refusals: `INSECURE_URL` for anything that cannot protect the message in transit
(FR-038).

## `GET /.well-known/jwks.json`

Devolada's public signing keys, in the JSON Web Key Set shape every JOSE
library reads. No credential, no business data, cacheable
(`Cache-Control: public, max-age=300`).

```jsonc
{
  "keys": [
    { "kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig",
      "kid": "2026-09-a", "x": "…", "y": "…" }
    // a retired key stays listed for 7 days after retirement (D10)
  ]
}
```

One key set for the whole platform, never one per business. Cache it by
`kid`; when a delivery names a `kid` you do not have, fetch the set again once.

---

## The webhook Devolada sends

`POST` to the registered URL.

**Headers**

```
Devolada-Event-Id: evt_01J…
Devolada-Timestamp: 1759999000000
Devolada-Key-Id: 2026-09-a                  // the kid in /.well-known/jwks.json
Devolada-Signature: v1=<base64url>          // ES256 over "<timestamp>.<raw body>"
Content-Type: application/json
```

**Signature**: ECDSA P-256 with SHA-256 (`ES256`) over the string
`"<timestamp>.<raw body>"`, base64url without padding, signature in the raw
`r || s` form JOSE uses (D10). Verify with the public key whose `kid` matches,
before parsing the body, and reject a timestamp older than your own tolerance.
Nothing the business holds can produce this signature.

**Body**

```jsonc
{
  "eventId": "evt_01J…",
  "type": "payment.confirmed",
  "createdAt": 1759999000000,
  "data": {
    "paymentId": "pay_…",
    "paymentLinkId": "lnk_…",
    "customerRef": "CLI-4471",
    "askedCents": 49900,
    "receivedCents": 49900,
    "match": "exact",
    "folio": "DV-000412",
    "confirmedAt": 1759999000000,
    "isTest": false
  }
}
```

**Types**: `payment.<status>` for every state in the table above —
`payment.validating`, `payment.queued_for_credit`, `payment.confirmed`,
`payment.partial`, `payment.unapplied`, `payment.invalid`, `payment.expired`,
`payment.superseded` — one event each time the payment enters a state, named
with the row's own word (FR-013, research D17).

**Before the verdict** the body carries what is known so far. A
`payment.validating` message looks like this:

```jsonc
{
  "eventId": "evt_01J…",
  "type": "payment.validating",
  "createdAt": 1759998000000,
  "data": {
    "paymentId": "pay_…",
    "paymentLinkId": "lnk_…",
    "customerRef": "CLI-4471",
    "askedCents": 49900,
    "claimedCents": 49900,      // what the receipt or the typed form says — a claim, not money
    "proofDoor": "transfer",    // the row's proof_mode: "transfer" = the customer confirmed or typed the details (an image may be attached) | "receipt" = the image alone, the CEP fills the fields
    "receivedCents": null,      // absent until the verdict
    "match": null,
    "folio": null,
    "confirmedAt": null,
    "isTest": false
  }
}
```

`claimedCents` and `proofDoor` ride on every later message for the same
payment too, so a caller that missed the first one still has them.

**What a caller must do**

1. Fetch `/.well-known/jwks.json`, pick the key named by `Devolada-Key-Id`,
   and verify the signature. An unknown `kid` means fetch the set again once;
   still unknown means reject.
2. Check `eventId` against what you have already processed. A retry after a
   delivery that actually landed is normal and must not credit a customer twice
   (FR-014, SC-005).
3. Answer `2xx` within 10 seconds. Anything else, or no answer in time, is
   retried on `[1, 5, 15, 60, 240]` minutes, then stops and stays readable.
   A re-send is signed with the key active at that moment, so its `kid` may be
   newer than the first attempt's; its event id and body are the same.
4. Order by `createdAt`, not arrival (FR-040). A `payment.validating` retried
   after its verdict was delivered is normal; the newer `createdAt` wins.
5. **Nothing before the verdict is money.** `claimedCents` is what the
   customer says; only a verdict message carries `receivedCents`. Credit a
   customer on `payment.confirmed` (or `partial`, by your own policy), never
   on `payment.validating` (FR-036).

**What Devolada guarantees**: at least once, never exactly once. A payment's
verdict never waits on your endpoint (FR-017).

---

## `POST /v1/test/payments/:id/advance`

Test credentials only (D12). Moves a test payment to a verdict without calling
Consta, and fires the real webhook.

```jsonc
{ "to": "confirmed", "receivedCents": 49900 }
```

`to` accepts any status from the table above. Creating a test payment fires
`payment.validating` like a real one, so a developer can rehearse every
webhook type, `payment.superseded` included.

A real credential calling it gets `NOT_FOUND` — the route does not exist for it.
Test records are readable through the API and are excluded from every real total
and from the validation fee (FR-035).

---

## Error codes

| code | retryable | meaning |
| --- | --- | --- |
| `AUTHENTICATION_ERROR` | no | missing, unknown or revoked credential |
| `VALIDATION_ERROR` | no | the request is wrong; the message says which field |
| `NOT_FOUND` | no | does not exist, or is not yours |
| `LINK_CLOSED` | no | the link was paid or expired |
| `CHANNEL_UNAVAILABLE` | no | the business cannot collect yet; names what is missing |
| `BUSINESS_SUSPENDED` | no | |
| `INSECURE_URL` | no | the webhook destination cannot protect the message |
| `RATE_LIMITED` | **yes** | more than 120 requests this minute; `Retry-After` says how many seconds to wait |
| `INTERNAL_SERVER_ERROR` | **yes** | ours, not yours |

Nothing in this surface names a subscriber, a service, a router or WispHub
(FR-028, SC-011).
