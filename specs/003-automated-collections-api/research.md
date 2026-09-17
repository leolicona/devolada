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

**Decision**: `speiAvailable()` becomes two predicates.

```
channelAvailable(env, business)        CLABE + known bank + Consta reachable
askAvailable(link, integration)        panel link → needs the WispHub key
                                       api link   → needs nothing more
```

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

---

## D9 — The payload is frozen when the delivery is enqueued

**Decision**: the webhook body is rendered once, at enqueue, and stored.

**Rationale**: the same instinct as `hypothesisOf` in
`integrations/dispatch.ts` — "the policy may move; the record must not". A retry
four hours later must deliver what the verdict said, not what the row looks like
now. It also makes FR-041 (re-send after a fixed endpoint) trivially correct: the
re-sent message is byte-identical, so its signature and event id still hold.

---

## D10 — Signature: HMAC-SHA256 over `timestamp.body`, both secrets during rotation

**Decision**: each delivery carries the event id, a timestamp, and
`HMAC-SHA256(secret, "<timestamp>.<raw body>")` in hex. During a rotation window
the header carries **one signature per live secret**.

**Rationale**: the timestamp inside the signed string is what stops a captured
delivery being replayed later; signing the raw body is what lets the caller
verify before parsing. The repo already has this exact WebCrypto shape in
`consta/refs.ts`, so there is one HMAC idiom rather than two.

Two signatures is what makes FR-039 honest: a caller who has updated only one
side of the rotation still verifies every message, so no delivery is lost to a
half-finished rotation.

**Alternatives rejected**: signing the parsed JSON (key order is not stable, so
the caller cannot reproduce it); a shared bearer token in a header (proves the
sender knew a secret, not that *this message* is unaltered).

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
sweep deletes old buckets.

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

**Which are announced**: terminal states only. `validating` and
`queued_for_credit` are waits, and a webhook says what happened; a caller that
wants to know *why* nothing has arrived reads the status. `superseded` is
announced because it is terminal: a caller that saw the row while it was
`validating` deserves to learn the row is closed, and the corrected attempt
arrives as its own payment with its own event. The cost is one event a caller
may ignore; the alternative is a row that silently stops changing.

**Alternatives rejected**: a friendlier public synonym with a documented
mapping (two vocabularies to keep in step forever, for the sake of one word);
folding `superseded` and `queued_for_credit` into neighbours (`invalid` and
`validating`) — rejected because each fold tells the caller something false
about whose fault the wait is.
