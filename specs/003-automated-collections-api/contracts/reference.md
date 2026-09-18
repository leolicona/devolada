# Devolada collections API — developer reference

**Version**: `/v1` · **Date**: 2026-09-18 · **Source of truth**: the zod schemas in
`apps/api/src/routes/v1/<area>/schema.ts`, exported as `@devolada/api/v1-schema`.
The shape summary for reviewers is [public-api.md](./public-api.md); this is the
document a developer integrates from (FR-036).

Devolada lets a business in Mexico collect a payment by SPEI transfer and tells
you, by webhook and on request, whether the money really arrived. Your system
creates a **payment link** for a customer, the customer transfers to the
business's account from the page the link opens, and Devolada validates the
transfer against Banxico's own record (the CEP) before saying so. You never see
a bank credential, and Devolada never sees your customer beyond the reference
you give it.

---

## 1. Getting started

### The credential

Someone with access to the business's Devolada panel issues a credential under
**Integraciones → API**. It is shown once, as `dk_` followed by 32 hex
characters. Store it in your secret store; Devolada keeps only a hash and can
never show it again. The panel can issue several, names them, and revokes any
of them with immediate effect.

A credential is either **real** or **test** (section 8). It belongs to exactly
one business.

### Every request

```
Authorization: Bearer dk_0123456789abcdef0123456789abcdef
Content-Type: application/json
```

Base URL: `https://api.devoladapago.com` in production,
`https://api.dev.devoladapago.com` on the shared dev environment. Server to
server only: there is no CORS and no cookie, and a browser holding a `dk_`
key is a mistake.

### Every answer

```jsonc
{ "success": true,  "data": { … } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "retryable": false, "message": "askCents: must be a positive integer" } }
```

`error.code` is one of the codes in section 9 and nothing else. `retryable`
tells you whether waiting can help: `true` means try the same request again
later, `false` means the request itself must change. `message` is present when
a field or a piece of configuration can be named; it is for your logs, not your
users.

### Conventions

- **Money is integer cents**, always in a field ending in `Cents`. `49900` is
  $499.00 MXN.
- **Time is milliseconds since the Unix epoch**, UTC. The two exceptions are the
  `from`/`to` dates on the transfer history, which are calendar days in the
  business's own timezone.
- **Identifiers**: links are `lnk_` plus 32 hex characters; events are `evt_`
  plus 32 hex characters; a payment id is the identifier Devolada assigned it
  and is opaque. Treat all of them as opaque strings.
- **Idempotency**: any `POST` accepts an `Idempotency-Key` header (1–255
  characters, your choice, unique per request you consider "the same"). A
  repeat with the same key from the same business replays the first answer
  verbatim — status and body — and carries `Idempotency-Replayed: true`. A
  refusal is replayed too. Keys live 24 hours. Use it on every create you
  might retry after a network failure.
- **Rate limit**: 120 requests per minute per business, every endpoint counted
  together, real and test credentials sharing the budget. Past it,
  `RATE_LIMITED` with a `Retry-After` header saying how many seconds to wait.
- **Words you will never see**: nothing in this API assumes what the business
  sells. The customer is whoever owes money, named by your `customerRef`.

---

## 2. Payment links

A payment link is the address of a page where the customer pays. It carries the
amount to collect and your reference for the customer.

Two kinds:

| kind | opens | closes | typical use |
| --- | --- | --- | --- |
| `reusable` | forever | never | one link per customer, re-priced every period |
| `one_time` | until `expiresAt` | when it is paid, when the deadline passes, or when you close it | one link per invoice |

Both look identical to the customer. A reusable link is **unique per business
and customer reference**: asking for one that exists returns the existing one,
not a second link and not an error.

### Create — `POST /v1/payment-links`

```jsonc
{
  "customerRef": "CLI-4471",        // required, 1–128 characters, your own id for the customer
  "askCents": 49900,                // required, positive integer
  "mode": "reusable",               // "reusable" (default) | "one_time"
  "expiresAt": 1760000000000,       // required for one_time, forbidden for reusable
  "label": "Ana Ruiz",              // optional, up to 120 characters, shown to the customer
  "concept": "Mensualidad octubre"  // optional, up to 200 characters, shown to the customer
}
```

`201` with the link:

```jsonc
{
  "id": "lnk_2f8c…",
  "url": "https://link.devoladapago.com/p/kq7m2x9d4tbn3wpa",
  "customerRef": "CLI-4471",
  "askCents": 49900,
  "mode": "reusable",
  "expiresAt": null,
  "state": "open",                  // open | paid | expired
  "closedAt": null,
  "label": "Ana Ruiz",
  "concept": "Mensualidad octubre",
  "isTest": false,
  "createdAt": 1759998000000,
  "notices": []
}
```

Put `url` in your own message to the customer. The page is mobile-first, in
Mexican Spanish, and shows the amount, the business's CLABE and bank, and the
reference the customer must type in the transfer's *concepto* so the business
can recognise it.

**The amount the customer is asked for** is `askCents` plus the transfer fee
the business configured in its panel, if any. That total is what the
validation compares the arriving money against (section 4).

`200` instead of `201` when a reusable link for that `customerRef` already
existed: the answer is that link.

**`notices`** is empty unless a platform condition applies. Today the only
notice is `{ "code": "VALIDATION_UNAVAILABLE" }`: Devolada's own transfer
validation is not available in this environment. The link is still created —
there is nothing for you to fix and nothing to retry — and the customer's
page says the channel is unavailable until the condition lifts.

Refusals: `VALIDATION_ERROR` (a bad amount, a one-time link without a
deadline, a deadline on a reusable link), `CHANNEL_UNAVAILABLE` with
`message` naming what the **business** has not configured (`clabe` or
`bank`), `BUSINESS_SUSPENDED`.

### Read — `GET /v1/payment-links/:id` · list — `GET /v1/payment-links?customerRef=`

The read answers the link as above; a link of another business, or one that
does not exist, is `NOT_FOUND`. The list answers `{ "links": [ … ] }` for your
customer reference, newest first, and an empty list when there is none.

### Re-price or close — `PATCH /v1/payment-links/:id`

```jsonc
{ "askCents": 52000 }   // reusable only: the next payment is asked the new amount
{ "close": true }       // one_time only; idempotent
```

Re-pricing a one-time link is `VALIDATION_ERROR` — its amount is the thing it
is; create another. Re-pricing a closed link is `LINK_CLOSED`. Closing a
**reusable** link is `VALIDATION_ERROR`: it never expires and is always open —
re-price it, or simply stop sending it. Closing a one-time link that is
already paid or expired changes nothing and answers the link as it is.

### States

`state` is derived, never stored, so it is always current:

| `state` | meaning |
| --- | --- |
| `open` | accepts payments |
| `paid` | a one-time link that was paid, or that you closed (`closedAt` is set) |
| `expired` | a one-time link whose `expiresAt` passed unpaid |

A closed or expired link's page explains itself to the customer and shows no
account to transfer to.

---

## 3. What happens when the customer pays

The customer transfers from their own bank to the business's CLABE, then comes
back to the page and either confirms the transfer's details (the tracking key,
the sending bank, the date, the amount) or uploads the receipt. That creates a
**payment** — one record for the whole life of that attempt — and Devolada
starts validating it against Banxico.

Validation takes seconds when the CEP is already published, and can take
hours when it is not yet; Devolada keeps asking on a widening schedule for up
to six hours before it gives up. Your system does not wait: it is told each
time the payment changes state (section 5) and can ask at any moment
(section 4).

### The payment's `status`

Every value is a word Devolada's own record uses; the API invents no second
vocabulary.

| `status` | final | meaning for you |
| --- | --- | --- |
| `validating` | no | the customer's proof was accepted and is being checked against Banxico. A claim exists; **nothing is money yet** |
| `queued_for_credit` | no | the business's validation credit with Devolada is paused; nothing is asked of Banxico until a top-up lifts it, and the payment then continues as `validating`. You see why nothing is moving |
| `confirmed` | yes | the money arrived and covered the ask (`match` is `exact` or `over`) |
| `partial` | yes | the money arrived but fell short of the ask (`match` is `short`). The business decides what to do; the link stays open so the customer can complete it |
| `unapplied` | yes | the money arrived and was validated, but settled nothing: the link had already closed (section 6) |
| `invalid` | yes | Banxico's record contradicts the claim — no such transfer, or one already used to pay |
| `expired` | yes | validation gave up: the transfer was never found in time |
| `superseded` | yes | Devolada misread a receipt and the customer corrected it; the corrected attempt is a **new payment with its own id**. Not an error and never money — ignore it, or use it to tidy your own record |

`match` is a different axis — how the arriving money compared to the ask,
within the business's configured tolerance — and is `null` until a money
verdict.

---

## 4. Asking about a payment

### `GET /v1/payments/:id`

```jsonc
{
  "id": "…",
  "status": "confirmed",
  "paymentLinkId": "lnk_2f8c…",
  "customerRef": "CLI-4471",
  "askedCents": 49900,             // what the link asked when the customer submitted
  "claimedCents": 51400,           // what the receipt or the typed form said — a claim, never money
  "proofDoor": "transfer",         // "transfer": the customer confirmed or typed the details | "receipt": the image alone
  "receivedCents": 51400,          // null until a money verdict
  "match": "exact",                // exact | short | over — null until a money verdict
  "folio": "DV-3K8Q2M",            // Devolada's own receipt number — null until a money verdict
  "confirmedAt": 1759999000000,    // the verdict moment — null until a money verdict
  "createdAt": 1759998000000,
  "isTest": false
}
```

The same facts the webhook carries, rendered by the same code, plus `status`
and `createdAt`. Whatever your system missed, this is the truth to reconcile
against. A payment of another business, or of a link not created through this
API, is `NOT_FOUND`.

### `GET /v1/payments?customerRef=CLI-4471`

`{ "payments": [ … ] }`, newest first. A reference with nothing received
answers an empty list, never `NOT_FOUND` — "nothing arrived" is an answer, not
an error. `customerRef` is required.

---

## 5. The webhook

Register one address and Devolada posts to it every time a payment enters a
state. Your system then needs no polling.

### Register — `PUT /v1/webhook`

```jsonc
{ "url": "https://gym.example/hooks/devolada" }
```

`https` is required; anything that cannot protect the message in transit is
`INSECURE_URL`. One address per business — a second `PUT` replaces the first.
The answer is the endpoint as `GET /v1/webhook` reads it:

```jsonc
{
  "url": "https://gym.example/hooks/devolada",
  "createdAt": 1759990000000,
  "consecutiveFailures": 0,        // attempts in a row that did not get a 2xx
  "lastFailureAt": null,
  "lastSuccessAt": 1759999001000
}
```

There is **no shared secret** to copy and nothing for you to rotate.
Deliveries are signed with Devolada's own key, whose public half is published
(below). `DELETE /v1/webhook` removes the address and answers
`{ "removed": true }` (`false` when there was none); a delivery still pending
at that moment ends as `failed` with `ENDPOINT_REMOVED`, readable, never lost.

### The message

`POST` to your address, JSON body, these headers:

```
Devolada-Event-Id: evt_01J…
Devolada-Timestamp: 1759999000000
Devolada-Key-Id: 2026-09-a
Devolada-Signature: v1=<base64url>
Content-Type: application/json
```

```jsonc
{
  "eventId": "evt_01J…",
  "type": "payment.confirmed",     // "payment." + the payment's status, see section 3
  "createdAt": 1759999000000,      // the moment of the state it announces
  "data": {
    "paymentId": "…",
    "paymentLinkId": "lnk_2f8c…",
    "customerRef": "CLI-4471",
    "askedCents": 49900,
    "claimedCents": 51400,
    "proofDoor": "transfer",
    "receivedCents": 51400,        // null before the verdict
    "match": "exact",              // null before the verdict
    "folio": "DV-3K8Q2M",          // null before the verdict
    "confirmedAt": 1759999000000,  // null before the verdict
    "isTest": false
  }
}
```

`data` is the payment exactly as `GET /v1/payments/:id` answers it, minus
`status` (that is `type`) and `createdAt`. A `payment.validating` message
carries the claim and the door with the four verdict fields `null`; every
later message for the same payment carries them too, so a message you missed
costs you nothing.

### What your endpoint must do

1. **Verify the signature before parsing anything.** Fetch
   `GET /.well-known/jwks.json`, pick the key whose `kid` equals
   `Devolada-Key-Id`, and verify `Devolada-Signature` (after `v1=`) as
   ECDSA P-256 with SHA-256 — `ES256` — over the string
   `"<Devolada-Timestamp>.<raw request body>"`. The signature is base64url
   without padding, in the raw `r || s` form JOSE uses. An unknown `kid`
   means fetch the key set again once; still unknown means reject. Reject a
   timestamp older than your own tolerance.

   ```js
   // Node 22, no dependency
   import { createPublicKey, verify } from "node:crypto";

   export function verifyDevolada(headers, rawBody, jwks) {
     const jwk = jwks.keys.find((k) => k.kid === headers["devolada-key-id"]);
     if (!jwk) return false;
     const sig = headers["devolada-signature"] ?? "";
     if (!sig.startsWith("v1=")) return false;
     const key = createPublicKey({ key: jwk, format: "jwk" });
     const signed = Buffer.from(`${headers["devolada-timestamp"]}.${rawBody}`);
     const signature = Buffer.from(sig.slice(3), "base64url");
     return verify("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, signature);
   }
   ```

   Keep the raw body: any re-serialisation changes the bytes and the
   signature no longer matches.

2. **Recognise a repeat by `eventId`.** Devolada guarantees *at least once*,
   never exactly once. A retry after a delivery that actually landed is
   normal: if you have already processed this `eventId`, answer `2xx` and do
   nothing. Never credit a customer twice.

3. **Answer `2xx` within 10 seconds.** Do the minimum — record the event —
   and process it afterwards. Anything other than `2xx`, or no answer in
   time, is a failed attempt.

4. **Order by `createdAt`, not by arrival.** Retries can deliver a
   `payment.validating` after its verdict was already delivered; the newer
   `createdAt` wins.

5. **Nothing before the verdict is money.** `claimedCents` is what the
   customer says. Only a verdict message — `payment.confirmed`,
   `payment.partial`, `payment.unapplied` — carries `receivedCents`. Credit
   the customer on `payment.confirmed` (and on `payment.partial`, by your own
   policy), never on `payment.validating`.

### Retries, failures and re-sends

A failed attempt is retried after 1, 5, 15, 60 and 240 minutes — six attempts
over about five hours — then the delivery is `failed` and stays readable. A
re-send is signed with the key active at that moment, so its `kid` may be newer
than the first attempt's; its `eventId` and its body are byte-identical.

A payment's verdict never waits on your endpoint: the customer sees their
result whether or not you answered.

`GET /v1/webhook/deliveries?status=&limit=` — every attempt's result, newest
first, up to 200 (default 50), optionally filtered by `pending | delivered |
failed`:

```jsonc
{
  "deliveries": [
    {
      "id": "…",
      "eventId": "evt_01J…",
      "type": "payment.confirmed",
      "paymentId": "…",
      "status": "failed",
      "attempts": 6,
      "nextAttemptAt": null,
      "responseStatus": 500,       // what your endpoint answered last; null when it never answered
      "lastError": "HTTP_500",
      "keyId": "2026-09-a",        // the kid that signed the last attempt
      "deliveredAt": null,
      "createdAt": 1759999000000
    }
  ]
}
```

`POST /v1/webhook/deliveries/:id/retry` — once your endpoint is fixed, ask for
a failed delivery again. It goes back to pending with the **same event id and
the same body**. Only a `failed` delivery can be re-sent; anything else is
`VALIDATION_ERROR`.

The business's panel shows the same health line — consecutive failures and
the last success — so an endpoint that is down is noticed without a support
ticket.

### `GET /.well-known/jwks.json`

Devolada's public signing keys, one set for the whole platform, in the JSON
Web Key Set shape every JOSE library reads. No credential, no business data,
`Cache-Control: public, max-age=300`.

```jsonc
{
  "keys": [
    { "kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig",
      "kid": "2026-09-a", "x": "…", "y": "…" }
  ]
}
```

Cache it by `kid`. When Devolada retires a key, the retired one stays
published for 7 days so a delivery signed just before the change still
verifies; you need to change nothing.

---

## 6. The transfer history

### `GET /v1/transfers?from=2026-09-01&to=2026-09-30&limit=50&cursor=`

For reconciling your books against what arrived. `from` and `to` are calendar
days in the **business's timezone**, both inclusive; `to` before `from` is
refused. `limit` is 1–200, default 50.

```jsonc
{ "transfers": [ … ], "nextCursor": "MTc1OTk5OTAwMDAwMDo…" }
```

Each transfer is a payment exactly as `GET /v1/payments/:id` answers it, so any
row here can be asked about by id. Ordered oldest verdict first, then by id.
`nextCursor` is `null` on the last page and opaque otherwise — pass it back as
`cursor` to continue. A cursor this history never handed out is
`VALIDATION_ERROR`. A payment confirmed while you are walking the pages appears
once, later, and nothing is skipped or repeated.

**Only validated money is history**: `status` here is `confirmed`, `partial` or
`unapplied`, and the range is on the **verdict moment** (`confirmedAt`), which
is what lines up with a bank statement. A claim still validating, a
contradicted one, an expired one or a superseded reading is not money and is
not listed.

**`unapplied` means validated but not applied**: a transfer that arrived and
was confirmed by Banxico for a link that had already closed. It is real money
the business received that settled nothing in Devolada's record — yours to
apply by hand.

**What this is not**: a feed of the business's bank account. Devolada has no
connection to the bank and learns of a transfer only when a customer submits
its proof on the page. A deposit nobody ever submitted will never appear here.

---

## 7. A complete integration, in order

1. Issue a credential in the panel; store it.
2. `PUT /v1/webhook` with your `https` address.
3. For each customer who owes money, `POST /v1/payment-links` with your
   `customerRef` and the amount, with an `Idempotency-Key`. Send the `url` to
   the customer.
4. On `payment.confirmed` (verified, deduplicated by `eventId`): mark the
   customer paid, keep `folio` as the receipt number. On `payment.partial`:
   your policy. On `payment.invalid` or `payment.expired`: the customer's
   claim did not hold; nothing arrived.
5. Each period, re-price the reusable link with `PATCH`, or create a fresh
   one-time link.
6. Each month, walk `GET /v1/transfers` for the month and compare against your
   books. Look at every `unapplied` row.
7. If your endpoint was down: read `GET /v1/webhook/deliveries?status=failed`
   and re-send each one, or reconcile from `GET /v1/payments/:id` — the truth
   is the same either way.

---

## 8. Test mode

A **test credential** — issued in the panel with "Modo prueba" on — runs the
whole flow above with no bank transfer and no money. Test links, test
payments and test deliveries exist and are readable through the API with the
test credential, exactly like real ones, and every one of them carries
`"isTest": true`. They never appear in the business's panel, its totals, its
fees, or in anything the real credential reads.

Because there is no way to fake a transfer, **you name the verdict**:

### `POST /v1/test/payments/:id/advance`

```jsonc
{ "to": "confirmed", "receivedCents": 51400 }
```

Moves a test payment to the state named in `to` — any `status` from section 3
— exactly as the validation would have, and fires the real webhook through the
real queue, signed with the real key. The answer is the payment as
`GET /v1/payments/:id` reads it.

- A customer submitting a proof on a **test** link creates the payment as
  `validating` (and `payment.validating` is sent) and it stays there: nothing
  is asked of Banxico. It moves only when you advance it.
- `receivedCents` is read by `confirmed`, `partial` and `unapplied`, and
  refused on any other `to`. Omitted, it is the amount asked (an exact
  match).
- `match` is computed by the same rule as a real validation, so
  `confirmed` with an amount below the ask is refused (that verdict is
  `partial`), and `partial` with an amount that covers it is refused (that
  is `confirmed`). `unapplied` is classed `over`.
- A verdict is final: a payment that already ended cannot be moved again.
  Create a fresh test payment per verdict you want to rehearse.
  `validating` and `queued_for_credit` can be rehearsed in either order
  before the verdict.
- `confirmed` closes a one-time link, so `LINK_CLOSED` and the closed page
  can be rehearsed too.

A **real** credential calling this endpoint gets `NOT_FOUND`: for it the route
does not exist. A test credential cannot move a real payment, nor another
business's.

One thing the two modes share: the customer reference of a reusable link is
one namespace per business. A reference that already holds a real reusable
link cannot hold a test one (`VALIDATION_ERROR`, naming which credential holds
it), and the other way round. Use references of your own for testing, such as
`TEST-…`.

---

## 9. Error codes

| code | HTTP | retryable | meaning |
| --- | --- | --- | --- |
| `AUTHENTICATION_ERROR` | 401 | no | missing, malformed, unknown or revoked credential. The answer reveals nothing else |
| `VALIDATION_ERROR` | 400 | no | the request is wrong; `message` names the field |
| `NOT_FOUND` | 404 | no | does not exist, is not yours, or is not for this credential |
| `LINK_CLOSED` | 409 | no | the link was paid, expired or closed |
| `CHANNEL_UNAVAILABLE` | 409 | no | the business has not configured its account; `message` says which piece (`clabe` or `bank`). Never a platform condition — that is a `notices` entry on a success |
| `BUSINESS_SUSPENDED` | 409 | no | the business is suspended on Devolada |
| `INSECURE_URL` | 400 | no | the webhook address cannot protect the message in transit |
| `RATE_LIMITED` | 429 | **yes** | more than 120 requests this minute; `Retry-After` says how many seconds |
| `INTERNAL_SERVER_ERROR` | 500 | **yes** | Devolada's, not yours |

---

## 10. Glossary

- **SPEI** — Mexico's interbank transfer system. The customer pays by
  transferring from their bank to the business's CLABE.
- **CLABE** — the 18-digit account number a transfer is sent to.
- **CEP** — Banxico's own proof that a transfer settled. Devolada validates a
  payment by finding its CEP; a payment is money only once it has.
- **Tracking key** (*clave de rastreo*) — the identifier a bank assigns to a
  transfer; it is what Devolada asks Banxico about.
- **Ask** — the amount a link asks for, plus the transfer fee the business
  configured. `askedCents` on a payment is the ask frozen at the moment the
  customer submitted.
- **Verdict** — the final state of a payment: `confirmed`, `partial`,
  `unapplied`, `invalid`, `expired` or `superseded`. The three money verdicts
  are the first three.
