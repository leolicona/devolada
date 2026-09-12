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
  "status": "confirmed",       // validating | confirmed | short | unapplied | invalid | expired
  "askedCents": 49900,
  "receivedCents": 49900,
  "match": "exact",            // exact | short | over — null while validating
  "folio": "DV-000412",        // null until confirmed
  "confirmedAt": 1759999000000,
  "createdAt": 1759998000000,
  "isTest": false
}
```

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

Answers `{ url, secret, secretTail, rotatedAt }` — the secret in full **only**
on the response that creates or rotates it.

`POST /v1/webhook/rotate-secret` opens a rotation window: both secrets sign every
delivery until the window closes (FR-039).

`POST /v1/webhook/deliveries/:id/retry` re-sends a failed delivery, same event id
and same body (FR-041).

`GET /v1/webhook/deliveries` lists attempts with their results (FR-026).

Refusals: `INSECURE_URL` for anything that cannot protect the message in transit
(FR-038).

---

## The webhook Devolada sends

`POST` to the registered URL.

**Headers**

```
Devolada-Event-Id: evt_01J…
Devolada-Timestamp: 1759999000000
Devolada-Signature: v1=<hex>, v1=<hex>     // one per live secret during rotation
Content-Type: application/json
```

**Signature**: `HMAC-SHA256(secret, "<timestamp>.<raw body>")`, hex (D10). Verify
before parsing, compare in constant time, and reject a timestamp older than your
own tolerance.

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

**Types**: `payment.confirmed`, `payment.short`, `payment.unapplied`,
`payment.invalid`, `payment.expired` (FR-013 — every verdict, named).

**What a caller must do**

1. Verify the signature.
2. Check `eventId` against what you have already processed. A retry after a
   delivery that actually landed is normal and must not credit a customer twice
   (FR-014, SC-005).
3. Answer `2xx` quickly. Anything else is retried on
   `[1, 5, 15, 60, 240]` minutes, then stops and stays readable.
4. Order by `createdAt`, not arrival (FR-040).

**What Devolada guarantees**: at least once, never exactly once. A payment's
verdict never waits on your endpoint (FR-017).

---

## `POST /v1/test/payments/:id/advance`

Test credentials only (D12). Moves a test payment to a verdict without calling
Consta, and fires the real webhook.

```jsonc
{ "to": "confirmed", "receivedCents": 49900 }
```

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
| `RATE_LIMITED` | **yes** | slow down; the response says for how long |
| `INTERNAL_SERVER_ERROR` | **yes** | ours, not yours |

Nothing in this surface names a subscriber, a service, a router or WispHub
(FR-028, SC-011).
