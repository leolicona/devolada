# Phase 0 Research: automated-collections-api

**Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

Every decision below is numbered `D<n>` and is cited from the code that
implements it as `automated-collections-api D<n>` (constitution I).

Where a claim was checked against the code or the live API, the date says so.

---

## The finding that shapes everything else

**Measured 2026-09-12**: a business cannot collect by SPEI today without a
WispHub key. `speiAvailable()` at `apps/api/src/direct-payments/validation.ts:77`
requires `integration?.apiKey`, and the validation path refuses outright at
`validation.ts:530` with `WISPHUB_NOT_CONFIGURED`.

Nothing about the money needs that. The payer transfers to the business's CLABE;
Consta validates against Banxico. WispHub is needed for one thing only: it is
where the *ask* comes from, because the panel's links read the debt live.

So the ISP assumption is not spread through the product — it sits in two gates
and one table. That is what makes Q2 (any company, not only ISPs) a change of a
few hundred lines rather than a rewrite.

---

## D1 — The public API lives in `apps/api`, under a versioned path

**Decision**: a new area `apps/api/src/routes/v1/` with its own key middleware.
Not a new Worker.

**Rationale**: it reads and writes the same D1 — `payment_links`, `payments`,
`businesses`. Consta is its own Worker because it is its own service with its own
database; this is the product API with a second front door. The path carries
`/v1` because, unlike every other route in this repo, outside consumers now
depend on its shape and cannot be redeployed with it.

**Alternatives rejected**: a fourth Worker (would need cross-Worker access to the
product database, or a duplicate of it — the exact drift the one-contract rule
exists to prevent). An unversioned path (fine while Devolada owns every caller;
this feature is the moment that stops being true).

**Consequence**: `/v1/*` must be excluded from the CORS allow-list in
`apps/api/src/index.ts`. It is server-to-server, like Consta — a browser calling
it with a secret key is a mistake, not a use case.

---

## D2 — One `payment_links` table, widened. Not a second table

**Decision**: API links are rows in `payment_links` with new columns, not a new
`api_payment_links` table.

**Rationale**: the payer's page resolves a link by token
(`resolveLink`, `routes/direct-payments/handler.ts:123`) and `payments`
references `payment_links.id`. A second table forks the token space, the payer
path, the payment foreign key and every reader. One table keeps one lookup.

**Alternatives rejected**: a parallel table (two of everything downstream); a JSON
blob column (unqueryable, and the money law wants real integer columns).

---

## D3 — `source` and `mode`, and two columns become nullable

**Decision**: add to `payment_links`:

| column | meaning |
| --- | --- |
| `source` | `panel` \| `api` — who created it (FR-011), and where the ask comes from |
| `mode` | `reusable` \| `one_time` — the lifecycle (FR-027) |
| `customer_ref` | the caller's own identifier (API only) |
| `ask_cents` | the amount to collect (API only) |
| `label` | the display name the payer sees (API only, optional) |
| `expires_at` | the deadline (one-time only) |
| `closed_at` | when it stopped accepting payments |
| `is_test` | a test-mode link (FR-034) |

and make `wisphub_customer_id` and `customer_usuario` **nullable**.

**Rationale**: an API link has no WispHub customer. The alternative is writing a
sentinel into a `NOT NULL` column — a value that means "not applicable" while
claiming to be an identifier. This repo's whole comment discipline exists to stop
that kind of lie, and `customer_usuario` is surfaced to the payer as
`reference`, so a sentinel would reach a customer's screen.

`mode` is stored rather than inferred from `expires_at IS NULL`. Two kinds that
the spec names in words should be named in the data; a reader asking "which kind
is this?" should not have to know that a null deadline means reusable.

**Cost, stated plainly**: SQLite cannot relax `NOT NULL` in place. drizzle-kit
generates the standard table rebuild (create, copy, drop, rename), so this
migration is **not purely additive** — the one departure from the constitution's
`Data` row. It is one table, at pilot scale, and production already archives a D1
export before migrating. Logged in the plan's Complexity Tracking.

---

## D4 — Two partial unique indexes replace one

**Decision**: drop `payment_links_business_usuario_idx` and create

- `unique (business_id, customer_usuario) where source = 'panel'`
- `unique (business_id, customer_ref) where source = 'api' and mode = 'reusable'`

**Rationale**: FR-033 wants one reusable link per customer reference, which is
the same shape the panel already has for a WispHub usuario. Making it one index
over both namespaces would let an ISP's WispHub usuario collide with its own API
customer reference — two different people, one row. One-time links are excluded
because a customer can legitimately have many.

SQLite supports partial unique indexes and Drizzle exposes `.where()` on them.

---

## D5 — The channel gate splits from the WispHub gate

**Decision**: `speiAvailable()` becomes three predicates (the third split out
on 2026-09-17, clarification on FR-009).

```
businessConfigured(business)           CLABE + known bank — the business's to fix;
                                       the only cause of CHANNEL_UNAVAILABLE
validationAvailable(env)               the environment's provider token — a platform
                                       condition: a `VALIDATION_UNAVAILABLE` notice on
                                       a created link, the channel-unavailable state on
                                       the payer's page, a platform notice in the panel;
                                       never a refusal of a link
askAvailable(link, integration)        panel link → needs the WispHub key
                                       api link   → needs nothing more
```

Why the third is not a refusal: after `004-consta-api-merge` the provider
credential is planted per environment, not per business. Refusing a link for
it would tell a developer to fix a setting they do not have, and would punish
the business for Devolada's own outage. The link is theirs; the honesty is
ours.

**Rationale**: this is the whole of Q2 in one change. Today "no WispHub key"
means "this business cannot collect", which was true when every business was an
ISP. Under Q2 it is the normal state of most businesses, and it must mean only
"this business has no WispHub links".

**Constitution effect**: Principle VIII says an absent optional secret turns *its
feature* unavailable. That still holds — it just turns out WispHub's feature is
the panel's live-debt link, not the SPEI channel. This is a restatement, not an
amendment.

**Where it lands**: `validation.ts:77` (the predicate), `validation.ts:530` (the
refusal), and `getLinkStatus` / `submitPayment` in
`routes/direct-payments/handler.ts`.

---

## D6 — The payer's page is not touched at all

**Decision**: an API link produces the same `LinkStatusResponse` the payer's page
already renders: `status: "debt"`, the ask in `invoiceCents`, the fee, the CLABE,
`reference` = the caller's reference, `cobros: []`.

**Rationale**: FR-032 (the payer cannot tell the kinds apart) is free if the
contract is identical. `apps/pago` needs no change, so it inherits every
accessibility, contrast, motion and mobile rule already proven there — and the
browser layer's existing assertions keep covering it.

**Consequence**: a closed or expired one-time link needs one new status value
(`closed`) and its es-MX copy (FR-031). That is the only payer-facing addition,
and it is a `<Pending>`-free static state.

---

## D7 — The validation seam sits after the CEP, before the WispHub half

**Decision**: `runValidation` branches on `link.source` immediately after the
tracking key is adopted (around `validation.ts:528`).

**Rationale**: read top to bottom, that function is already two halves. The first
— claim the row, ask Consta, reconcile the CEP, adopt the key — *is* the SPEI
validation and is identical for both link kinds. The second half is entirely
WispHub: re-read the debt, classify, dispatch the action.

For an API link the second half becomes: the ask is `link.ask_cents`, classify
against it with the business's tolerance, set the outcome, enqueue the webhook.
No WispHub client is constructed, which is how FR-029 is enforced structurally
rather than by remembering.

**The null guard the seam must keep** (analyze finding, 2026-09-12): the
function receives `integration: Integration | null`, and every read of it in
the WispHub half — `thresholdPercent` and `floorCents` at the settlement,
`actionForClass(integration, klass)`, and the observation gate
`if (!integration.actionsEnabled)` — is safe today only because the line
`if (!integration?.apiKey) return retryLater("WISPHUB_NOT_CONFIGURED", base)`
returns first and narrows the type. An API link for a gym has no integration
row at all, so `integration` is `null` on that path. Therefore the API branch
returns **before** that guard, and the guard itself stays a hard return for the
panel half — it is never softened into a condition on `link.source`, because
that would let a `null` reach the observation gate. T046 states this, and
T037 proves it with a business that has no integration row.

**Alternatives rejected**: a separate validation function for API payments
(duplicates the CEP reconciliation, the hardest and most measured code in the
repo, and would drift the moment one of them is fixed).

---

## D8 — Webhook deliveries are a D1 table swept by the existing cron

**Decision**: a `webhook_deliveries` table, a first attempt inline at the verdict
via `waitUntil`, and retries claimed by a lease in a new sweep that rides the
every-minute `scheduled` handler in `apps/api/src/index.ts`.

**Rationale**: this is the reconnection queue's shape, proven in this repo
(`reconnection/queue.ts`): the row is the queue, a lease stops overlapping
sweeps, a backoff array bounds the attempts, and the sweep speaks only when it
did something. The constitution's "one Worker trigger" rule requires riding the
existing cron rather than adding one.

**Alternatives rejected**: Cloudflare Queues (not in the fixed stack; adds a
binding, a consumer and a second failure mode for a retry schedule D1 already
models). Delivering synchronously at the verdict with no store (FR-016 and FR-041
both need the attempt history, and FR-017 forbids the payment waiting on it).

**Backoff**: `[1, 5, 15, 60, 240]` minutes — the same five waits the reconnection
queue uses, so the product has one retry rhythm rather than two to explain.

**Timeout** (set by the developer, 2026-09-17): an attempt waits **10 seconds**
for a `2xx`, via `AbortSignal.timeout`, and no answer counts as a failure like
any other. Ten seconds is generous for an endpoint that only records an event,
and short enough that one dead destination cannot hold the every-minute sweep
past its own cadence with the whole schedule in flight. FR-016 carries the
number.

---

## D9 — The payload is frozen when the delivery is enqueued

**Decision**: the webhook body is rendered once, at enqueue, and stored.

**Rationale**: the same instinct as `hypothesisOf` in
`integrations/dispatch.ts` — "the policy may move; the record must not". A retry
four hours later must deliver what the verdict said, not what the row looks like
now. It also makes FR-041 (re-send after a fixed endpoint) trivially correct: the
re-sent message is byte-identical, so its event id still holds; the signature
is computed at send time with the key active then (D10).

---

## D10 — Asymmetric signatures: ES256 with a published key set, never a shared secret

**Decision** (the developer's, 2026-09-17, replacing the HMAC design): every
delivery is signed with Devolada's **own private key** — ECDSA P-256 with
SHA-256, `ES256` — over `"<timestamp>.<raw body>"`, and carries the key's
`kid`. The public keys are published as a JSON Web Key Set at
`GET /.well-known/jwks.json` on the API origin. One key set for the whole
platform; the business holds no secret at all.

**Rationale**: with a shared HMAC secret, anyone who holds it can mint a
"confirmed" webhook — the business's own staff, a contractor, a compromised
server, a leaked `.env`. The business's system would credit a customer on a
message it forged itself, and Devolada could not tell. With a private key
that never leaves Devolada, proof of origin means what it says. It also
removes an entire surface: no secret shown once, no per-business rotation
endpoint, no rotation window to explain, nothing for the panel to hide.
The JWKS shape is what every JOSE library already reads, and ES256 is the
algorithm every JWT verifier ships with, so a gym's developer verifies with
the library they already have rather than with a recipe from our reference.

**Where the private key lives**: the Worker secret `WEBHOOK_SIGNING_KEYS`, a
JSON array of private JWKs each with a `kid` and an optional `retiredAt`. The
one without `retiredAt` is active; the others are retired and kept so their
public halves stay published. Secrets move by `wrangler secret put` after the
deploy (TD-011), so retiring a key is a deploy, behind the same gate as every
other secret — which is right for a key whose compromise would touch every
business at once. Never a D1 row: a private key is not a credential the
product sends to a provider, and the Principle V rule for those does not
cover it. Signing uses WebCrypto (`crypto.subtle.sign("ECDSA", …)`), native
in workerd, no dependency.

**Retiring a key**: add the new key as active and mark the old one retired.
Devolada signs only with the active key from that moment; a re-send under
FR-041 is re-signed with it too, same event id, same body (D9). The retired
key stays in the JWKS for **7 days** after `retiredAt` — the retry schedule
ends 5 h 21 min after the first attempt, and a caller that caches the set for
five minutes needs the old `kid` to keep resolving well past that. Seven days
is the safe margin, chosen here rather than measured; a caller that meets an
unknown `kid` re-fetches the set once, so even that margin is belt and braces.
Nothing on the business's side changes, which is what FR-039 now promises.

**What "unset" means** (constitution VIII): with `WEBHOOK_SIGNING_KEYS`
absent, outcomes are still recorded and deliveries still enqueued, but no
attempt is made — an unsigned webhook would break FR-015. Each such row
carries `last_error = SIGNING_KEY_MISSING`, the sweep warns once per run, the
panel's health line says signing is not configured, and the JWKS answers an
empty `keys` array. Local dev and the test layer plant a fixed key pair, the
tests in `vitest.config.ts` so `.dev.vars` can never swap it.

**Alternatives rejected**: HMAC-SHA256 with a per-business secret and two
signatures during a rotation window (the design this replaces — cheap to
verify, but the forgery problem above, plus a secret to show once, store,
rotate and explain); Ed25519 (`EdDSA`) — smaller and faster, but PHP and
older Java verifiers need an extra library where ES256 needs none, and the
callers are businesses whose stacks we do not choose; a per-business key pair
(no benefit — the business verifies, it never signs — and a key set to
publish per tenant); signing the parsed JSON (key order is not stable, so the
caller cannot reproduce it); a bearer token in a header (proves the sender
knew a secret, not that *this message* is unaltered).

---

## D11 — API credentials mirror Consta's key pattern exactly

**Decision**: `dk_<32 hex>`, SHA-256 stored, plaintext returned once, revoked by
timestamp — the pattern in `apps/consta/src/auth/api-key.ts`, with the row
carrying `business_id` and `is_test`.

**Rationale**: it is already written, already tested and already the posture the
constitution settled for tenant credentials (Principle V: "Consta keys are stored
as SHA-256 only"). Inventing a second key format would mean two things to audit.

**Note**: the WispHub and Consta keys on the business row are stored in plain
text because Devolada must *send* them to those providers. Ours is only ever
compared, so it is hashed. The asymmetry is deliberate and worth a comment.

---

## D12 — Test mode is a property of the credential

**Decision**: a credential is real or test. A test credential creates test links,
whose payments are test payments. `POST /v1/test/payments/:id/advance` moves a
test payment to a chosen verdict without calling Consta, and fires the real
webhook.

Test records exist and are readable through the API — so a developer can test
their own status polling and history — and are excluded from anything real:

- **the fee** — one guard in `debitValidationFee`
  (`credit/index.ts:87`), which is already the single place a payment costs
  money, and already idempotent per payment;
- **the panel** — the feed and the direct-payment reads
  (`routes/payments/handler.ts`, `routes/direct-payments/handler.ts`);
- **the sweeps** — a test payment never reaches Consta or WispHub.

**Rationale**: FR-034 needs a developer at a gym to reach a confirmed verdict
without a bank transfer, and there is no way to simulate a real Banxico CEP.
Advancing the payment by API is the only honest simulation: it exercises the
caller's whole integration and lies about nothing except the transfer.

**Rationale for records existing**: the alternative — test mode that synthesizes
a webhook and stores nothing — cannot answer FR-019 or FR-020 in test mode, so a
developer could not test the two endpoints most likely to be wrong.

**Risk, named**: this is the requirement most likely to leak. `payments.is_test`
must be filtered at every business-facing read, and the enforcement is a shared
predicate plus a test that asserts a test payment is invisible to the panel — not
a rule to remember at 22 call sites.

---

## D13 — Rate limiting by D1 counters, not a new binding

**Decision**: a `rate_counters` table keyed by business and minute bucket; the
sweep deletes old buckets. The budget is **120 requests per minute per
business**, every `/v1` endpoint counted together (set by the developer,
2026-09-17). The refusal is `RATE_LIMITED` with `Retry-After` in seconds — the
rest of the current minute — so a caller can tell a limit from an outage
(FR-024). Two a second is far above what a billing run needs and far below
what a looping integration would cost the platform.

**Rationale**: the repo's existing budgets (`HOURLY_ATTEMPT_BUDGET`,
`UPLOAD_HOURLY_BUDGET`) count rows in D1 over a window, so this is the house
pattern. It runs on real D1 in the test layer, which means the limit can be
asserted deterministically — a rate limiter nobody can test is a rate limiter
nobody can trust.

**Alternatives rejected**: Cloudflare's rate-limiting binding (not in the fixed
stack, and not deterministic in workerd tests); KV (eventually consistent, which
is the one property a counter must not have).

---

## D14 — Idempotency keys live in their own table

**Decision**: `idempotency_keys` — unique on `(business_id, key)`, storing the
first response, swept after 24 hours.

**Rationale**: FR-008 must return *the first response*, not merely avoid a second
write, so the answer has to be stored. Keeping it off `payment_links` means a
key that failed validation is also remembered, which is the case that otherwise
creates duplicates on a retried network failure.

---

## D15 — The API honours `businesses.status`, which leaves the admissions hook free

**Decision**: every `/v1` write reads `businesses.status` and refuses a suspended
business, exactly as the payer's page already does
(`routes/direct-payments/handler.ts:176`, `:253`).

**Rationale**: consistency — a suspended business must not collect through a new
door that the old door closes. This is required by the existing rule, not new
policy.

**Consequence, recorded for later**: the admissions question the developer left
open on 2026-09-12 (who may be admitted, and whether identity is checked) needs
no new data. The enforcement point already exists and is already wired into the
money path; what is missing is an endpoint to flip it — the platform panel reads
`status` (`routes/platform/schema.ts:23`) but cannot change it. Adding that
endpoint is **not in this feature's scope**; this decision only records that
choosing a policy later costs a screen, not a migration.

---

## D16 — "Unapplied" means validated but not applied — never "a deposit we never saw"

**Decision**: FR-022 and User Story 4, scenario 4 are narrowed. The history shows
money **Devolada validated** that settled nothing — a payment on a closed or
expired one-time link, or one that arrived against an ask of zero. It does not
show deposits into the business's account that Devolada was never told about.

**Rationale**: Devolada has no bank feed. It learns that a transfer happened
because the payer submits a proof on the payment page, and then verifies that
proof against Banxico. A transfer nobody submitted is invisible by construction.

**Why this matters enough to write down**: read the other way, US4 scenario 4
promises full bank reconciliation — a different product, needing bank
connectivity Devolada does not have. Better to narrow the promise here than to
ship an endpoint a finance person will quietly mistrust.

**Spec follow-up**: FR-022's wording should be amended to "a validated transfer
that was not applied". Raised with the developer rather than edited silently.

---

## D17 — The API speaks the payment row's status words, all of them

**Decision**: `status` on `/v1/payments` is exactly `payments.status` from
`apps/api/src/db/schema.ts` — `validating`, `queued_for_credit`, `confirmed`,
`partial`, `unapplied`, `invalid`, `expired`, `superseded` — and the webhook
type is `payment.<status>` for each terminal one. The contract's earlier
`short` status is gone; `short` remains only as a value of `match`, which is
the reconciliation class (`classes.ts`), a different axis.

**Rationale**: the spec's own dependency says the API reports the existing
verdict vocabulary and does not invent a second set of names. Each word in
`payments.status` was chosen against a specific wrong reading (`partial` is not
`confirmed`, because the payer would see a green tick and no service; not
`invalid`, because that means "your transfer does not exist"). A synonym on
the wire would force every integrator to keep a translation table, and the
first bug report would be a developer asking why the panel says one thing and
the webhook another.

**Why every word, not the five the contract first listed** (analyze finding,
2026-09-12): `queued_for_credit` and `superseded` are real states a payment
reaches today (prepaid-credit D8; the `superseded` comment on `payments.status` in `schema.ts`). A business system that
asks "did this customer pay?" must never receive a value its integration has
never heard of, and a `GET /v1/payments?customerRef=` that hides two of the
eight would show a gap where a row exists.

**Which are announced**: every one, each time the row enters it (the
developer's decision in the clarification session of 2026-09-17, replacing
the earlier "terminal only"). The business's system learns that a claim
exists the moment the customer's proof is accepted — through either door,
receipt image or typed details — and learns why nothing moves when credit is
paused. `superseded` is announced because a caller that heard `validating`
deserves to hear the row is closed; the corrected attempt arrives as its own
payment with its own events. One rule, no list of exceptions to maintain.

**What the early message carries**: `claimedCents` — the amount on the
receipt or in the typed form, the row's existing `claimed_amount_cents` — and
`proofDoor`, the row's `proof_mode` as the code defines it: `transfer` when
the customer confirmed or typed the details (the reader's draft, corrected
or not, with the image attached), `receipt` when the image alone was
submitted and the CEP fills the fields. The event fires when the row is
born, which is when the customer submits — never at upload or at the
reader's draft, because no payment exists yet and the reader cannot refuse
anyone. `receivedCents`, `match` and `folio` are `null`, not guessed,
until the verdict. The name is the safeguard: a caller reading `claimedCents`
as money received has misread a word the reference defines in one line
(FR-036), and the verdict message is the only one that carries an amount
received. The support use case ("the customer says they sent $500, did the
claim arrive?") needs the number; the risk is a naming problem, not a data
problem.

**Alternatives rejected**: a friendlier public synonym with a documented
mapping (two vocabularies to keep in step forever, for the sake of one word);
folding `superseded` and `queued_for_credit` into neighbours (`invalid` and
`validating`) — rejected because each fold tells the caller something false
about whose fault the wait is.
