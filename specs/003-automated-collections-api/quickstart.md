# Quickstart & Validation: automated-collections-api

**Date**: 2026-09-12 | **Contract**: [contracts/public-api.md](./contracts/public-api.md)

How to run this feature locally and prove each story works. Scenario numbers
match the spec's acceptance scenarios.

## Setup

Point the API at the sandbox and give it a signing key, in `apps/api/.dev.vars`
(git-ignored; every key's "unset" meaning is in CLAUDE.md and `env.ts`):

```sh
APICEP_TOKEN=sandbox                        # any value: the sandbox checks nothing
APICEP_BASE_URL=http://localhost:8789       # the mock below, instead of the real provider
WEBHOOK_SIGNING_KEYS=[{...}]                # mint one with the one-liner under US2
```

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local
pnpm --filter @devolada/api dev            # 8787 — the API and, inside it, the validation engine
pnpm --filter @devolada/api sandbox        # 8789, apiCEP mock — no provider token needed
pnpm --filter @devolada/admin dev          # 5174, the panel (optional: the seed issues the credentials)
pnpm --filter @devolada/pago dev           # 5175, the payer's page
```

(`wrangler dev --local` if the machine has no Cloudflare login: the receipt
reader's AI binding is remote by default and needs one; the reader degrades,
nothing else changes. Walked 2026-09-18.)

Seed a business, its CLABE and its credentials in one step:

```sh
curl -sX POST localhost:8787/dev/seed      # demo@devolada.app / devolada123
# → { admin: { email, password }, api: { key: "dk_…", testKey: "dk_…" } }
```

The seeded business has a CLABE, so the channel is available. **Do not connect
WispHub** — running without it is the point: it proves D5, that the SPEI channel
no longer depends on a WispHub key.

## The credential

The seed answered with a real key and a test key (T070); each seed replaces
the previous pair. Or issue one by hand in Admin → Integraciones → API and copy
it — it is shown once.

```sh
export DK=dk_...................................
export DK_TEST=dk_..............................
export API=http://localhost:8787
```

---

## US1 — Create a link

**Reusable** (scenarios 1, 2, 5):

```sh
curl -sX POST $API/v1/payment-links \
  -H "Authorization: Bearer $DK" -H 'Content-Type: application/json' \
  -d '{"customerRef":"CLI-4471","askCents":49900,"label":"Ana Ruiz"}'
```

Open the returned `url` in a browser. Expect: $499.00 plus the service fee, the
business's CLABE, `CLI-4471` as the reference, es-MX copy, no mention of a
service or a subscriber.

Re-price it and reload the page — the new amount is there (scenario 2):

```sh
curl -sX PATCH $API/v1/payment-links/<id> \
  -H "Authorization: Bearer $DK" -H 'Content-Type: application/json' \
  -d '{"askCents":52000}'
```

Repeat the create call with the same `customerRef`: same link back, not a second
one (scenario 5).

**One-time** (scenarios 3, 4): create with
`"mode":"one_time","expiresAt":<now + 1h>`. Pay it (below), then reopen — the page
explains in es-MX that it is closed, and offers no CLABE. Create another with a
deadline in the past and open it — same treatment, expired wording.

**Refusals** (scenarios 7, 8): clear the business's CLABE in Configuración and
create again → `CHANNEL_UNAVAILABLE` naming the CLABE. Call with a junk key →
`AUTHENTICATION_ERROR` revealing nothing.

**Isolation** (scenario 9): seed a second business, use its key with the first
one's `customerRef`, and confirm the link belongs to the caller only.

---

## US2 — The webhook

Point the webhook at anything that records requests and can be made to fail. A
tiny local listener is enough; what matters is that you can read the headers.

```sh
curl -sX PUT $API/v1/webhook \
  -H "Authorization: Bearer $DK" -H 'Content-Type: application/json' \
  -d '{"url":"https://localhost:9000/hooks"}'
```

Drive a payment to a verdict — either by submitting a proof on the payer's page
against the Consta sandbox, or with a test credential and
`POST /v1/test/payments/:id/advance`.

Expect (scenarios 1, 2, 10):

- a `payment.validating` delivery arrives when the proof is submitted, through
  either door, carrying `claimedCents` and `proofDoor` and null verdict fields;
- the verdict delivery arrives within seconds, carrying `customerRef`, `askedCents`,
  `receivedCents`, `match`, `folio`, `confirmedAt` and `eventId`;
- `Devolada-Signature` verifies as `ES256` over
  `"<Devolada-Timestamp>.<raw body>"` against the key in
  `GET $API/.well-known/jwks.json` whose `kid` equals `Devolada-Key-Id`;
- delivering the same event twice is recognisable by `eventId` alone.

**Retries** (scenario 3): make the listener answer 500. Watch the attempt count
rise on `GET /v1/webhook/deliveries`; the sweep runs every minute, so advance the
clock in tests rather than waiting five hours by hand. After the schedule is
spent the delivery is `failed` and the panel's health line says so.

**Re-send** (scenario 5): fix the listener, then
`POST /v1/webhook/deliveries/:id/retry`. Same `eventId`, same body; the
signature is fresh, under the key active now.

**Key retirement** (scenario 7): in `.dev.vars`, add a second key to
`WEBHOOK_SIGNING_KEYS` and give the first one a `retiredAt`. Restart, deliver
again, and confirm the new delivery names the new `kid`, that the JWKS still
lists both, and that a listener verifying against the JWKS accepts both the
old delivery and the new one without having changed anything.

To mint a key for `.dev.vars` (Node 22, no dependency):

```sh
node -e 'crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]).then(async k=>console.log(JSON.stringify([{...await crypto.subtle.exportKey("jwk",k.privateKey),kid:"dev-1"}])))'
```

**Timeout** (scenario 4): make the listener sleep 15 seconds before answering.
The attempt fails at 10, the payment is still `confirmed`, and the payer's
page still shows success.

**Nothing reaches WispHub** (scenario 9): connect WispHub with actions enabled,
pay an API link, and assert zero WispHub calls. In the API suite this is the
strongest assertion available — `fetchMock` at `api.wisphub.net` with
`assertNoPendingInterceptors`, so a single call fails the test.

---

## US3 — Ask about a payment

```sh
curl -s "$API/v1/payments?customerRef=CLI-4471" -H "Authorization: Bearer $DK"
```

Walk it through the states: while validating (scenario 1), after confirmation
with the folio (scenario 2), a reference that never paid → `{"payments":[]}`,
not an error (scenario 3), and another business's payment → `NOT_FOUND`
(scenario 4).

---

## US4 — Reconcile

```sh
curl -s "$API/v1/transfers?from=2026-09-01&to=2026-09-30&limit=2" \
  -H "Authorization: Bearer $DK"
```

Confirm payments across three days, then walk the pages with `limit=2` and
`nextCursor`. Every payment appears exactly once even when a new one is
confirmed mid-walk (scenario 2).

For the timezone (scenario 3): set the business to `America/Tijuana`, confirm a
payment at 23:30 local, and check which day it lands in.

For unapplied money (scenario 4): pay a one-time link after it closed. It shows
as `unapplied`. Note the narrowed promise — this is validated money that settled
nothing, not a feed of the business's bank account (research D16).

---

## Test mode

With the **test** credential, run the whole flow above with no bank transfer —
under its own customer references (`TEST-…`): a reference is one namespace per
business across both modes, so `CLI-4471`, which already holds a real reusable
link, is refused to the test key with a `VALIDATION_ERROR` that says so
(walked 2026-09-18). Submit a proof on the test link's page: it stays
`validating` and the sandbox is never called. Then name the verdict:

```sh
curl -sX POST $API/v1/test/payments/<id>/advance \
  -H "Authorization: Bearer $DK_TEST" -H 'Content-Type: application/json' \
  -d '{"to":"confirmed","receivedCents":51400}'
```

Then prove the isolation that FR-035 demands:

- the panel's Pagos feed does not list it;
- the business's credit balance did not move — no validation fee;
- `GET /v1/transfers` with the **real** credential does not return it;
- Consta received nothing.

---

## Gates before this feature is done

```sh
pnpm -r --if-present typecheck
pnpm --filter @devolada/api test
pnpm --filter @devolada/admin test
node scripts/spec-lint.mjs        # every new test cites automated-collections-api US<n>
node scripts/pending-lint.mjs     # the new panel screens' waits sit inside <Pending>
node scripts/contrast-lint.mjs
pnpm e2e                          # the payer's closed/expired state in both themes
```

The payer's page is otherwise untouched (research D6), so the browser layer's
existing contrast, focus and 360px assertions keep covering it without new
specs — except the one new state, which needs its own.
