# Research: Cash at Stores

**Feature**: [spec.md](./spec.md) · **Date**: 2026-10-01

Code cites these decisions as `cash-at-stores D<n>` (constitution I). Three
sources bound everything here:

- **The code on `main` today**, as of `77bc503`:
  - the session and the actor (`apps/api/src/auth/{better,middleware,role-matrix}.ts`, `env.ts`);
  - the payment row and the path a confirmed payment takes
    (`direct-payments/{validation,partial,classes}.ts`,
    `integrations/{dispatch,registry,capabilities}.ts`,
    `reconnection/queue.ts`, `wisphub/reconnection.ts`, `credit/index.ts`);
  - the operator panel (`routes/platform/`, `platform/settings.ts`,
    `apps/admin/src/features/operator/`);
  - the four Workers' CI (`.github/workflows/`).
- **The store network built before the pivot**, read-only in
  `leolicona/devolada-red`. Its specs are history, not law. Where a
  decision below keeps one of them, it names it (`charge-record D1`,
  `receipt D2`…), and this feature re-specifies it.
- **The spec's clarifications** of 2026-09-30 and 2026-10-01.

---

## D1 — The shopkeeper's app is a fifth Worker in this monorepo: `apps/red`

The app lives at `apps/red`. It is an assets-only Worker with an SPA
fallback, like `apps/admin` and `apps/pago`:

- `devolada-red-dev` serves `red.dev.devoladapago.com`;
- `devolada-red` serves `red.devoladapago.com`.

It calls `apps/api` directly with `VITE_API_URL` baked in at build. It
never proxies the API through Vite.

It belongs here, not in a repository of its own, for two reasons:

- **It needs the contracts.** It imports the zod schemas from
  `@devolada/api` (constitution III).
- **It renders the shared atoms.** It uses `@devolada/ui`, and a copy of
  an atom in another repository is the drift constitution VI forbids.

The only alternative would be to publish both packages and version them,
for one frontend.

**Alternatives considered**:
- `devolada-red` with its own backend. Rejected in the spec's
  clarifications: the business would have two accounts, and cash would be
  invisible in Pagos.
- The store screens inside `apps/admin`. Rejected for three reasons:
  - the panel is desktop-first at 40px and the counter is a phone at 48
    and 64px;
  - the panel's session would land a shopkeeper in the business wizard
    (`NO_BUSINESS` → `/nuevo-negocio`);
  - FR-012 gives the shopkeeper an address of their own.

**Departure**: the stack table lists two React apps, and the quality gates
count four Workers. This is amendment 3 in the plan's Complexity Tracking.

## D2 — A store is a second kind of actor, never a member

A shopkeeper is a Better Auth user who belongs to no organization. There
is a precedent for a second kind of caller: `ApiClient`
(`type: "api"`, `automated-collections-api D11`). Following it:

- **A new type.** `env.ts` gains `StoreActor { type: "store", storeId,
  userId, name, status }`, and `Variables` gains `store`.
- **Its own middleware.** `requireStore` (`auth/middleware.ts`) resolves
  the session, then the store row by `stores.user_id`. It checks the
  store's status on every request: a suspended store has its session row
  deleted and gets 403 `STORE_SUSPENDED` (FR-014, the same shape as a
  suspended business today). A user without a store row gets 403
  `WRONG_ACTOR`.
- **Business routes refuse it.** `requireSession` refuses a user with a
  store row, with 403 `WRONG_ACTOR`, *before* `findActor`. Without this,
  the shopkeeper falls into `NO_BUSINESS`, and the panel turns that into
  the business wizard (FR-013).
- **`/auth/me` answers both kinds.** It returns `type: "business"` or
  `type: "store"`. The admin already throws `WRONG_ACTOR` on anything
  else; it gains a screen for it: *"Esta cuenta es de una tienda. Entra
  en red.devoladapago.com."*, with a sign-out button. `apps/red` mirrors
  it: *"Esta cuenta no es de una tienda."*
- **A store user cannot create a business.**
  - `POST /businesses` refuses it (403 `WRONG_ACTOR`).
  - So does Better Auth's own organization create, through the
    organization plugin's `allowUserToCreateOrganization`, given a
    function that returns false for a store user.
  - Both doors are open to any session today.
- **A store user is never a platform operator.** The store actor carries
  no `platformOperator`, and acceptance refuses an email listed in
  `PLATFORM_OPERATOR_EMAILS` (D5).

Admin and red share one session cookie in the same browser: it is
host-only on the API host (better-auth D7). The actor type keeps them
apart, not the cookie.

**Alternatives considered**:
- A store as a Better Auth organization with a `store` role. Rejected.
  `findActor`, the role matrix and every business query would have to
  tell two kinds of organizations apart. That is the leak constitution V
  exists to prevent.
- A separate cookie or a separate auth instance. Rejected: two session
  systems in one API for one more kind of user.

**Departure**: constitution V says the actor is resolved from membership,
and that every business table carries `business_id`. This is amendment 2.

## D3 — Sign-in by phone uses Better Auth's `username` plugin; only acceptance writes the phone

The shopkeeper signs in with phone and password (FR-009, FR-010). Better
Auth 1.6.29, the version the lockfile pins, ships `better-auth/plugins/username`:

- `POST /auth/sign-in/username {username, password}`;
- two columns on `user`, `username` (unique) and `display_username`;
- it honours `requireEmailVerification`.

The old store network used the same plugin (devolada-red
`auth/better.ts:63`).

The phone is the username: ten national digits, normalised by the core's
`nationalPhone` (`apps/api/src/phone.ts`, `payment-without-receipt` D2).
That is the same rule the payer's reference and WhatsApp links use. A
store phone that does not normalise to ten digits is refused when the
store is created or edited (/speckit-analyze L5).

**Only the acceptance route writes a username.** Today `/auth/sign-up/email`
is open. With the plugin installed, anyone could sign up with a stranger's
phone as their username and block that store's invitation forever. Two
rules close this:

- A Better Auth `hooks.before` refuses `username` in the body of
  `/sign-up/email` and `/update-user`.
- The acceptance route (D5) writes the column directly, after the user is
  created.

**Alternatives considered**:
- The `phone-number` plugin. Rejected: it is built around an SMS code
  (`sendOTP`), which costs money and needs a new provider.
- An email-only sign-in for shopkeepers. Rejected: the creator chose phone
  and password, the way the old app worked.

**To measure before building** (quickstart M1):
- the plugin's migration columns on D1;
- that the `hooks.before` refusal holds for both endpoints;
- that `requireEmailVerification` blocks an unverified shopkeeper's
  sign-in.

## D4 — The store invitation: its own table, a hashed token, seven days, replaced on resend

`store_invitations` holds the store, the SHA-256 of a random token, a
status (`sent`, `accepted`, `replaced`), `expires_at` (seven days, FR-002)
and who issued it.

- **The token is hashed.** The product only ever compares it, so
  constitution V's credential rule applies. The old network stored it in
  plain text; this feature does not.
- **The plaintext is shown once**, as the link
  `${RED_BASE_URL}/invitacion/<token>`, in the operator's create and
  resend answers. The operator copies it or opens WhatsApp to the
  shopkeeper's phone (`wa.me/52<phone>?text=…`).
- **Resending issues a new token** and marks the open one `replaced`
  (FR-004).
- **Every bad token gets the same answer.** Unknown, accepted, replaced
  and expired all answer 400 `INVALID_INVITATION`, as the old network did
  (devolada-red `routes/auth.ts`). The log records which one it was.

`RED_BASE_URL` is a new var, declared in `env.ts` with the same "unset"
treatment as `PAGO_BASE_URL`.

**Alternatives considered**: Better Auth's organization invitation.
Rejected: it invites a *member* of an organization, by email, for 48
hours. A store is neither a member nor reached by email.

## D5 — Acceptance: email, password, a code, then signed in

`POST /store/invitations/:token/accept {email, password}` runs in this
order:

1. Checks the token (D4).
2. Refuses an email that already has a user (409 `EMAIL_TAKEN`), or that
   is in `PLATFORM_OPERATOR_EMAILS` (also `EMAIL_TAKEN`, so an operator's
   address is not revealed).
3. Creates the user with `signUpEmail` and no username.
4. Writes `username` (the store's phone) directly (D3), sets
   `stores.user_id`, and marks the invitation `accepted`.
5. Sends the email-verification code with the existing `sendAuthCode`
   template.

The store app then calls Better Auth's own
`/auth/email-otp/verify-email`. With `autoSignInAfterVerification`, the
shopkeeper lands signed in (FR-009).

If step 3 or 4 fails, the user is removed and the invitation stays
`sent`. That is the old network's rollback (devolada-red
`routes/auth.ts:172-236`).

A shopkeeper who leaves before typing the code signs in later with phone
and password. Sign-in answers `EMAIL_NOT_VERIFIED`, and the app offers to
send the code again. Recovery (FR-011) is the existing `forget-password`
code, sent to that email.

## D6 — Stores are platform rows; every movement of a business's money carries `business_id`

The **`stores`** table holds:
- name, a free-text address, the shopkeeper's name and phone (unique,
  FR-002);
- `user_id` (unique, nullable until accepted);
- `status` (`invited`, `active`, `suspended`);
- who created it, and when.

It has **no `business_id`**: a store belongs to the platform, like
`platform_settings`, and may later serve several businesses (FR-006).

Everything that moves a business's money carries **`business_id`**:
- the payment (as every payment does);
- the cash book's movements (D19);
- the hand-overs (D20).

So the business side keeps filtering by the actor's business, exactly as
constitution V requires.

The old network let a hand-over reach its ISP through the store
(`confirm-cash-drop D3`). That held only because a store had one ISP.

**Departure**: "every business table carries `business_id`" does not
cover a platform-level table that a non-member actor uses. This is
amendment 2.

## D7 — The channel switch: two columns on `businesses`, a capability check, one business at a time

`businesses` gains two columns:
- `store_channel_on` (boolean, default false);
- `store_channel_since` (timestamp, nullable): set the first time the
  channel is switched on, and never cleared.

The operator switches the channel with `PATCH /platform/businesses/:id
{ storeChannel: boolean }`. The handler refuses in two cases:
- **409 `NOT_CAPABLE`** when the business's integration lacks any of
  `customerSearch`, `customerDebt` or `paymentActions` (D8, D9). The
  panel names what is missing (FR-007).
- **409 `ONE_BUSINESS_AT_A_TIME`** when another business already has the
  channel on (FR-006). The guard lives in the handler, beside the rule
  it protects. Lifting it is the deferred decision, not a setting.

`store_channel_since` serves two purposes. It decides whether the panel
shows **Puntos de pago** (FR-034), with no extra query per request (D23).
It also records that the channel ran here once, even after it is
switched off.

**Alternatives considered**:
- A history table for the switch. Rejected: the spec asks for no history
  of the switch, and the operator panel shows the current state.
- Reading "any cash held" on every session to decide the menu. Rejected:
  that is one more query per request on the hot path.

## D8 — Two capabilities for the counter: `customerSearch`, and `customerDebt` that names the customer

The counter asks the business's integration two questions (spec,
Context), by capability, never by provider (constitution IX).

**`customerSearch.find(text, limit)`** is new. It returns
`{ usuario, name, zone, providerCustomerId }[]` and a `more` flag.
- The WispHub adapter fills it with its existing `searchCustomers`: the
  four `__contains` filters on nombre, apellido, usuario and telefono,
  measured case- and accent-insensitive on 2026-09-20
  (`links-on-demand-search`).
- The phone is a search key, but it **never comes back** (FR-017).
- There is no fallback to Devolada's own links when the provider is down.
  For a store, an outage is "no disponible", never a partial list (FR-028).

**`customerDebt.of(usuario)`** exists (`cobros-in-links` D9). Its `owes`
and `none` answers gain a `customer` block: `{ providerCustomerId, name,
zone }`. It carries no phone: the receipt reads that live, when it is sent
(D18).
- The adapter already reads the customer record in that operation
  (`getCustomer`), so this costs no extra call.
- The payment row needs it: the denormalised identity that keeps the
  queue independent of the provider (`schema.ts` comment on
  `wisphub_customer_id`).
- The action needs `providerCustomerId` for the auto-activate step
  (`wisphub/reconnection.ts`).

The Links page does not change: it keeps calling the adapter directly
through `listCustomers`, which is registered debt. Moving it to
`customerSearch` is a later payment of that debt, not this feature's
job.

**Alternatives considered**: reusing `GET /direct-payments/customers` for
stores. Rejected for three reasons:
- it is a business-session door;
- it answers phones, link URLs and payer references;
- it falls back to Devolada's links.

A store needs none of that.

## D9 — `paymentActions`: the action half of `core-reads-provider-directly` is paid here

A confirmed cash payment must run the path a SPEI payment runs (FR-024).
Today that path calls `wisphubFor` and `attemptReconnection` by name, in
three places:

- `validation.ts` (`settlePanelPayment`);
- `routes/payments/handler.ts` (execute and retry);
- `reconnection/queue.ts` (the sweep).

Adding a fourth caller would add a leak, which constitution IX forbids.
So this feature pays the action half of the debt:

- **The capability.** `paymentActions.attempt({ usuario,
  providerCustomerId, registeredCents, invoiceId, paymentRegistered,
  reconnect })` returns the core's `ActionAttempt`. The WispHub adapter
  wraps `attemptReconnection` in it.
- **The error codes.** The adapter's `WISPHUB_AUTH_FAILED` and
  `WISPHUB_UNAVAILABLE` become the core's `INTEGRATION_AUTH_FAILED` and
  `INTEGRATION_UNAVAILABLE` at the boundary. The admin's reason map
  (`FeedScreen.tsx`) learns both words.
- **The three call sites** switch to the capability.
- **The name is declared.** `paymentActions` joins
  `WISPHUB_CAPABILITY_NAMES`, so the session lists it.

The debt entry gets a note: the action anchors are paid. The read anchors
(`listCustomers`, `createLink`, the SPEI debt reads, the snapshot sweep)
stay open.

## D10 — A bug to fix first: a retried action forgets whether to reconnect

Research found this while reading the queue (2026-10-01).

**The bug.** The sweep retries `queued` rows with `attemptReconnection(…)`
and no `reconnect` argument. That argument defaults to true
(`queue.ts:119-138`, `reconnection.ts:46`). `retryAction` hard-codes
`register_and_reconnect` (`routes/payments/handler.ts:627`).

**What goes wrong.** A payment whose action should only register is
retried as register *and reconnect* if its first attempt met an outage.
That covers a short payment under the threshold (`withheld`) and a class
mapped to `register_only`. The customer gets the service back against the
business's own rule. No test or bug entry covers it today.

**Why it blocks this feature.** A short cash payment relies on that queue.
It takes the lite path **before** D9 lands:

- `/speckit-bug-assess`, then `-fix`, then `-test`, under
  `.specify/bugs/queue-retry-forgets-action/`;
- the fix keeps the decided action on the row (`observedAction`, or a
  sibling column if that one is taken) and reads it back on every retry.

## D11 — A cash payment hangs off the customer's own link

`payments.payment_link_id` is NOT NULL. Every payment belongs to a link,
and the link is the core's identity for a customer: no `customers` table,
on purpose (`schema.ts`). A cash payment is a payment of that customer.
So at the moment of recording it:

- the collection ensures the customer's **panel link** exists, with the
  existing `ensureLink` (`onConflictDoNothing` on
  `payment_links_panel_usuario_idx`);
- the payment row points to that link.

**This amends `links-on-demand-search` FR-008**, recorded here. That rule
says a link is born only from the operator's act (copy or WhatsApp),
"never merely on being shown". A confirmed cash payment is an act on that
customer, not a showing: its link is not stray. The amendment is one
clause: *"…or when a store records a cash payment for that customer."*

`proof_mode` is NOT NULL too. A cash row carries no proof, so that
TypeScript-only enum gains `none` (`receipt | transfer | none`). No
migration touches the column, and no reader mistakes a cash row for a
transfer (data-model).

The payer's page does not change (FR-041).
- `getLinkStatus` shows the debt, read live, and never a list of the
  link's payments. A cash payment shows up there only as a smaller or
  settled debt.
- A link born this way is a panel link like any other. Where the business
  has *pago con referencia* on, the every-minute backfill
  (`backfillPayerReferences`) gives it a payer reference, as it does every
  panel link without one. *(Amended 2026-10-01, `/speckit-converge` T099:
  this said the link "has no payer reference until the payer's own flow
  asks for one". The backfill never worked that way, and keeping the link
  out would need a mark on it; a link row stays identity-only
  (`payment-without-receipt` D1). The reference is the business's own
  rule for its customers, and the page it shows is the one every customer
  of that business sees, so FR-041 holds.)*

**Alternatives considered**:
- **Making `payment_link_id` nullable.** Rejected for three reasons:
  - SQLite needs a table rebuild, the departure from the additive rule
    that `automated-collections-api` D3 took once, on `payment_links`;
  - 39 uses in 12 files become nullable, including the feed's inner
    join, which would silently drop every cash row;
  - the fee helpers key on the link.
- **One counter link per business.** Rejected: a link that names no
  customer is a word used against its meaning.
- **A separate `cash_payments` table.** Rejected: "one row for the whole
  life of a payment" and one Pagos list (FR-031).

## D12 — The link's SPEI rules skip cash rows

Hanging cash off the customer's link (D11) touches three rules that read
"every payment of this link". Each one gets `channel = 'spei'` in its
filter, with a comment citing this decision:

- **The attempt budget** (`direct-payments/handler.ts`, one hour). A cash
  payment is not a payer's attempt, and must not spend the payer's SPEI
  budget.
- **Refunding fees for contradicted verdicts**
  (`credit/index.ts::reverseContradictedFees`). It assumes the earlier
  `invalid` verdict was contradicted by a fresh valid CEP of the same
  link. A cash payment contradicts no CEP, so it must not refund a SPEI
  row's fee. `debitValidationFee` skips the reversal for a cash row.
- **The incident history of a provisional release**
  (`direct-payments/provisional.ts`). It reads the link's own SPEI
  attempts.

The one-open-attempt rule (`openAttempts`) needs no change: it reads
`validating` and `queued_for_credit`, and a cash row is never either.

## D13 — One settlement function for every confirmed payment

`settlePanelPayment` keeps its SPEI-only parts:
- the debt read;
- the snapshot of pending invoices;
- the CEP.

The rest becomes an exported core function, `settleConfirmed`:
- folio and customer identity;
- `settle()` and `classifyPayment()`;
- the observation gate. The review hold stays in the SPEI path: its
  reasons (a retired account, no clave) belong to proofs, and a cash row
  never has them (/speckit-analyze H2);
- `actionForClass`;
- `recordDispatch`, the first attempt, `outcomeOf` and `settleDispatch`;
- the final write.

The SPEI path and the cash path both call `settleConfirmed`.

**The cash path feeds it:**
- `settle({ receivedCents: applied, ispDebtCents: debt, serviceFeeCents:
  0, thresholdPercent, floorCents })`;
- `classifyPayment({ receivedCents: applied, askedCents: debt,
  toleranceCents })`.

**The fee stays out of the arithmetic on purpose.** `settle()` lets the
SPEI fee cover a shortfall's remainder, because on that channel the fee
travels inside the transfer (`partial-payment` D3). At the counter, the
store fee is the store's own cash. Feeding it in would let a $15 fee
quietly turn a $490 payment of a $500 debt into a registered $500.

So, on a cash row:
- `service_fee_cents` is 0;
- the store's fee goes to the new `store_fee_cents` column (data-model).

Every existing derivation — the feed's asked, missing and surplus, the
class, the payer's page — then reads a cash row correctly with no special
case.

The applied amount is never above the debt (FR-019), so a cash payment
is `exact` or `short`, never `over`. Its status is `confirmed` or
`partial`, as `settle()` decides (`partial-payment` D6).

## D14 — The debt is read live, twice, and a changed amount refuses the record

- **The quote** (`GET /store/customers/debt`) asks `customerDebt.of`,
  live: never the snapshot that SPEI validation may read.
- **The record** (`POST /store/collections`) asks again. The request
  carries `expectedDebtCents` and `expectedFeeCents`. If the fresh debt or
  the current network fee differs, nothing is written: 409
  `AMOUNT_CHANGED`. The error carries only its code (constitution III: a
  browser route's error is `{ code }`). The app then reads the quote again
  and shows the new amounts (FR-021, the spec's edge case on a changed
  fee). *(Corrected 2026-10-01, /speckit-analyze C2: this said "with the
  new quote in the body".)*
- **An unproven zero is not zero.** If `customerDebt` answers
  `unconfirmed`, the record is refused with 503 `INTEGRATION_UNAVAILABLE`.
  An unproven zero is never read as "nothing owed"
  (`nothingOwedIsProven`, `debt-truth`).

This is `charge-record` D1, re-specified: the server computes the amount.
The client's numbers are only a check that the payer saw the same ones.

## D15 — Recording twice is impossible: a client key with a unique index

The confirm screen generates a `collectionKey` (UUID) once.
- `payments.collection_key` has a partial unique index on
  `(store_id, collection_key) WHERE collection_key IS NOT NULL`.
- The insert goes first. On a unique violation, the handler returns the
  row that key already made, with 200 instead of 201 (FR-023).

The house already uses this pattern:
`payments_business_tracking_idx` plus `isUniqueViolation`
(`direct-payments/handler.ts`). It is safe under races.

`idempotency_keys` and its middleware are tied to `/v1`. They replay a
stored response, and are racy by design (`v1/middleware.ts`), so they
are not used here.

## D16 — The fee: the existing debit, whatever the credit's state

A confirmed or partial cash row calls `debitValidationFee` once, from
`settleConfirmed`'s writer. The unique index on `payment_id` makes a
second call a no-op.

The credit's pause is checked only where a SPEI proof is submitted
(`direct-payments/handler.ts`), never in the debit. So FR-029 holds by
construction: the cash path never asks whether the business is paused.
The business still gets its crossing emails (`notifyCrossings`) when the
debit takes it across the cap.

## D17 — The folio is the house folio

`makeFolio()` (`DV-` plus six base-36 characters) moves out of
`routes/payments/handler.ts` into a core helper, `src/folio.ts`. The SPEI
path and the cash path both call it. The unique `folio` column stays the
guard. Collisions are not retried today, and this feature does not
change that.

## D18 — The receipt: the operator's message, the business's phone read live, nothing kept

*Rewritten 2026-10-01 after /speckit-analyze C1. The creator chose option B
("no necesitamos guardar el teléfono"), and constitution v1.9.0 admits it.
The first version of this decision copied the phone onto the payment row;
that is gone.*

`GET /store/collections/:id/receipt` returns `{ text, waLink, hasPhone }`.
The app calls it only when the shopkeeper taps *Enviar comprobante*, never
when the result screen opens. The phone is read only when it is needed.

**Rules kept from the old receipt:**
- **D2: the API owns the text.** It reads the same wherever it is sent
  from. The text is now the operator's template (D31), filled in by the
  API.
- **D3: no phone is not a dead end.** Without a phone, the link is
  `wa.me/?text=…`, and WhatsApp opens its contact picker.
- **D5: the status line tells the truth** about the action. It covers
  six outcomes:
  - reconnected;
  - registered without reconnecting, by the business's rule;
  - queued;
  - not done because the payment is short;
  - held for the business;
  - failed.

  It fills the template's `{estado}` placeholder.

**The phone (constitution V, v1.9.0):**
- The handler checks that the payment belongs to this store (404
  otherwise).
- It asks `customersWithPhone.phoneOf(usuario)`. That is the live read
  `payment-without-receipt` D4 already uses, and it stores nothing.
- It builds the link with the helpers the SPEI channel already uses, in
  `apps/api/src/receipt/index.ts`:
  - `toWhatsAppPhone(raw)`: `52` plus `nationalPhone`'s ten digits, or
    null when the number cannot be read with confidence;
  - `whatsAppLink(text, phone)`: `wa.me/<phone>?text=…`, or the contact
    picker when the phone is null.

  The phone exists only in that answer. A phone on file that is not ten
  readable digits counts as no phone: `hasPhone: false`, and FR-027
  applies (/speckit-analyze U1, L3).
- It is **never written**:
  - `payments.customer_phone` stays null on a cash row;
  - there is no per-customer table;
  - there is no hash.
- If the integration has no `customersWithPhone`, no phone for the
  customer, or does not answer in time, the response says `hasPhone:
  false` with the contact-picker link. The app then asks the shopkeeper
  for a number and builds the link itself. That number never reaches the
  server (FR-027).

**Why not copy the phone at record time,** as SPEI payments do and the
old receipt did (`receipt` D4)? The old reason was that a receipt should
still work while WispHub is down. The contact-picker fallback covers that
case, and the creator asked for the phone not to be kept. A copy on the
row would be a phone kept per payment, which v1.9.0's "never stored"
forbids.

**FR-027's history stays recorded.** At planning, the spec stopped
remembering a typed phone per customer (`payment-without-receipt` D1/D4,
`links-on-demand-search` FR-010). The creator's choice keeps that: option
C, keeping typed numbers, was rejected.

## D19 — The cash book: `store_ledger`, append-only, one store and one business per row

| Movement | Amount | Linked to |
| --- | --- | --- |
| `collection` | + the amount applied | the payment (unique per payment) |
| `handover` | − the amount handed over | the hand-over (unique per hand-over), written only on confirmation |
| `correction` | ± the amount | the payment, with a reason (3–280 characters) and its author |

- **What the store holds** for a business is `SUM(cents)` over that pair,
  never stored. This is the house rule `credit_entries` follows
  (`prepaid-credit` D3). The same SUM feeds the store's *Mi caja* and the
  business's *Puntos de pago*, so the two always agree (FR-039, SC-005).
- **Only `store-ledger/index.ts` writes it**, as `ledger/index.ts` was
  the old network's only writer.
- **The fee is not a movement.** The store fee is the store's money, never
  the business's. What the store earned since the last confirmed
  hand-over is derived from `payments.store_fee_cents` (FR-037). This is
  `cashbox` D5's cycle, re-specified per business.

## D20 — Hand-overs: declared by the store, confirmed or disputed by the business

`store_handovers` holds:
- store, business and amount;
- `status` (`pending`, `confirmed`, `disputed`);
- the note;
- who declared it and when;
- who resolved it and when.

Five rules:

1. **One pending per store and business.** A partial unique index on
   `(store_id, business_id) WHERE status = 'pending'` enforces it.
   Declaring a second answers 409 `HANDOVER_PENDING` (`cash-drop` D2).
2. **The amount is above zero and at most what is held.** Otherwise 400
   `AMOUNT_EXCEEDS_HELD` (`cash-drop` D3).
3. **Declaring writes no movement.** Confirming writes the `handover`
   movement (`cash-drop` D1).
4. **A dispute is terminal.** It needs a note of 3 to 280 characters and
   writes nothing (`confirm-cash-drop` D2). The store sees the note in
   *Mi caja* (`confirm-cash-drop` D7).
5. **Confirming takes two taps**, the second in a dialog naming the store
   and the amount. The write cannot be undone (`confirm-cash-drop` D6).

Confirming and disputing need `requireArea("payments", "operate")`. A
viewer reads only (FR-035).

## D21 — Corrections: the operator's, with a reason, never an undo

`POST /platform/stores/:id/ledger/:businessId/corrections` takes
`{ paymentId, cents, reason }`.

- It writes a `correction` movement (D19).
- The payment's detail shows it to the business and to the operator:
  amount, reason, author and date (FR-030).
- Nothing is deleted, and the payment row is not touched.

Returning Devolada's fee is a separate act, through the existing
`POST /platform/businesses/:id/adjustments`. Its reason names the folio.

## D22 — The network fee is one platform setting

`platform/settings.ts` gains `store_fee_cents`: type `cents`, born at
1500, range 0–5000. The operator's Reglas tab shows it as *"Cargo por
servicio en tiendas"*.

- It is read at quote and again at record (D14).
- It is copied onto `payments.store_fee_cents`.
- Changes keep author and date, like every platform setting (FR-008).

The SPEI `serviceFeeCents` on `businesses` stays untouched. The two fees
answer different questions: the business's fee to its payer, and the
store's fee at the counter.

## D23 — The business's panel: the channel in Pagos, and a Puntos de pago page

**Pagos.**
- The feed's `channel` enum becomes `["spei", "store"]`, and its query
  gains `channel`.
- The row's `storeName` (always null today) is filled through a left join
  on `stores`.
- A cash row's channel line reads *"Efectivo · <tienda>"* with a store
  icon. The SPEI line keeps *"Pago directo · SPEI"*.
- A filter chip offers *Todos / SPEI / Efectivo* (FR-031).
- The expanded row adds the store, the store fee and any correction
  (FR-032, FR-030).
- Retry and *Ejecutar ahora* work unchanged on a cash row, through
  `paymentActions` (D9).

**Puntos de pago.**
- A new route, `/puntos-de-pago`. The menu shows it when the actor's
  business has `store_channel_since` set (D7).
- It is one list: each store holding this business's cash, with the
  amount held, the last confirmed hand-over and the pending one, if any.
  Each pending hand-over has *Confirmar* and *Disputar* (D20).
- Its API is `GET /cash-points` and `POST
  /cash-points/handovers/:id/{confirm,dispute}`.

The statuses render through `StatusBadge`, which still carries the old
network's entries:
- `pending` *"Entrega pendiente"*, `confirmed` *"Entrega confirmada"*,
  `disputed` *"En disputa"*;
- `invited`, `storeActive`, `storeSuspended`.

No new status word is needed.

## D24 — The counter shows the minimum, and only after a search

The search follows the links rule (`links-on-demand-search` FR-002):
- nothing is shown before typing;
- it starts at three characters, after a short pause;
- results are capped at 10. When more match, the app says so and asks for
  a more specific search (FR-016).

A result shows name, usuario and zone, and nothing else (FR-017,
`customer-search` D2). The store app has no customer list, no paging and
no "recent customers".

## D25 — Record first, answer at once, act in the background

`POST /store/collections` writes the payment (D11, D13), the `collection`
movement and the fee debit. It answers 201 with the folio. The first
action attempt then runs in `waitUntil`, the shape `two-eyes-receipt` D4
gave the payer's pay request.

The app polls `GET /store/collections/:id` every 3 seconds while the
outcome is `queued` (the old `ResultScreen`). It shows each outcome as
icon plus text (FR-025).

Why not run the attempt inline before answering: at the counter, the
customer and the shopkeeper are waiting. A WispHub outage would hold the
answer until the operation's deadline (12 s, `provider-latency` D1). A
folio in the shopkeeper's hand at once is the promise of
`charge-record` D2: record first, reconnect second.

## D26 — `apps/red`: its screens, and how it is installed

The routes, in es-MX:

| Route | Screen | FR |
| --- | --- | --- |
| `/entrar` | phone, password, *huella o rostro* | FR-010 |
| `/recuperar` | code to the recovery email | FR-011 |
| `/invitacion/$token` | email, password, then the code | FR-009 |
| `/` | *Cobrar*: the business's name, the search box | FR-015, FR-016 |
| `/cobro/$usuario` | the quote: debt, fee, total; the amount field; *Cobrar $X* (64px) | FR-018 to FR-021 |
| `/cobros/$id` | folio, the outcome as it changes, *Enviar comprobante* | FR-025, FR-026 |
| `/caja` | *Mi caja*: the amount held, the fees, the last hand-over, *Registrar entrega* | FR-037 |
| `/caja/entrega` | declare a hand-over | FR-038 |
| `/movimientos` | the cash book, newest first, *Cargar más* | FR-037 |

- **Navigation.** Three tabs: *Cobrar*, *Caja*, *Movimientos*, taken from
  the old `TabLayout`. Signing out and enabling a passkey live in *Caja*
  (`cashbox` D3). *(Amended 2026-10-01, D32: from 1024 px the tabs become
  a side menu, and the routes above stay the same.)*
- **Installing.** A web manifest, so the app can be added to the home
  screen (FR-012). There is no service worker: offline work is out of
  scope, because a collection needs the debt live. The "sin conexión"
  banner stays. Quickstart M2 measures how it installs on Android Chrome
  and iOS Safari without one.
- **The old code is reference, not source.** The old app's screens and
  copy are the starting point. Its code is rewritten against today's
  atoms: `decisive` not `critical`, `standard` not `md`, and
  `ListError` without `retrying`. Every waiting label goes inside
  `<Pending>`.

## D27 — Words

| es-MX (screen) | English (code) | Never |
| --- | --- | --- |
| Tienda | `store` | "punto" in code, "sucursal" |
| Tendero (operator's copy only) | shopkeeper (prose), `store_user` | — |
| Cobrar (the shopkeeper's verb) | `collection` | "cobro" on anything the payer reads |
| Efectivo · <tienda> | `channel: "store"` | "cash" in code identifiers |
| Cargo por servicio | `store_fee_cents` | "comisión" in the payer's receipt |
| Mi caja | cash book, `store_ledger` | "saldo" (that is the prepaid credit) |
| Entrega | `handover` | "corte", "depósito" |
| Puntos de pago | `cash-points` (route) | — |
| Efectivo en tiendas | `store_channel_on` | — |

## D28 — Tests, by the layer that can answer

- **API** (`apps/api/test/cash-at-stores*.test.ts`, workerd with a real
  D1, WispHub through `fetchMock`). It covers:
  - the store actor and every refusal (FR-013, FR-014);
  - acceptance, and the username refusal on public endpoints (D3, D5);
  - the operator's stores, switch, guard and corrections;
  - search and quote through the capabilities;
  - the record, with exact and short payments, `AMOUNT_CHANGED`, the
    idempotent retry, a paused credit, observation mode, an outage after
    recording, and the retried action keeping its decision (D10);
  - the cash book SUMs;
  - hand-overs, and tenant isolation between two businesses at one store.
- **Component** (`apps/red/test`, `apps/admin/test`, happy-dom, MSW with
  schema-validated fixtures, axe): every red screen and the two admin
  surfaces.
- **Browser** (`tests/e2e`):
  - red's screens join `contrast.spec.ts` and `responsive.spec.ts` at
    360, 768 and 1280, and the touch-target check;
  - *Puntos de pago* joins both too;
  - `stubRedApi` is validated by the new schemas.
- **Passkey** (`tests/passkey`): one case, enrolling and signing in on
  red's origin against a real API.

Every file cites `cash-at-stores US<n>`.

## D29 — Shipping the fifth Worker

| Place | Change |
| --- | --- |
| `apps/red/wrangler.jsonc` | `devolada-red[-dev]`, routes `red[.dev].devoladapago.com` |
| `apps/api/wrangler.jsonc` | `RED_BASE_URL` per env; `ALLOWED_ORIGINS` gains `http://localhost:5177`, `https://red.dev.devoladapago.com` plus the preview pattern `*-devolada-red-dev.devoladapago-14b.workers.dev`, and `https://red.devoladapago.com` |
| `.github/workflows/ci.yml` | a preview build and upload for red |
| `deploy-dev.yml` | build and deploy red |
| `deploy-prod.yml` | build and deploy red; `red` in the "what landed" loop; a smoke probe on `PROD_RED_URL` |
| `rollback-prod.yml` | `red` in the options and in the config `case` |
| `playwright.config.ts` | `RED_PORT` 4177 and a webServer |
| `scripts/pending-lint.mjs`, `scripts/contrast-lint.mjs` | `apps/red/src` added to their roots |
| `CLAUDE.md` | "five Workers", the `red` dev command on port 5177 |

The passkey RP ID (`devoladapago.com`) already covers `red.`. The origin
list Better Auth trusts comes from `ALLOWED_ORIGINS`, so the one change
feeds CORS, `trustedOrigins` and the passkey origin.

Better Auth ignores `*` patterns, so a preview build of red can render
but cannot sign in. Admin has the same limit today. The quickstart walks
on `red.dev`.

## D30 — Two things outside this repository, and one debt

- **The no-cap pilot** is registered with `/speckit-debt-log` by T003,
  before any of its code lands. That is the constitution's "the same day"
  the shortcut is taken. Slug: `store-cash-no-cap`. Exit condition: a cap
  per store, with a warning before it and collections blocked at it,
  before a second store or a second business joins.
- **`devolada-red`'s deploy workflows are turned off** before this ships.
  Its Worker, database and bucket names collide with this account's
  Workers (measured 2026-09-30). It is a change in that repository, done
  by hand.
- **The pilot's agreements** (spec Assumptions) are signed before the
  first real collection. Nothing in the code waits on them, and the
  quickstart's last step lists them.

## D31 — The receipt message is a platform template the operator edits

*Added 2026-10-01: the creator asked for the message to be a default that
can be changed from `/operador`.*

`platform/settings.ts` gains `store_receipt_template`, with a new setting
type, `template`: multi-line text of 20–1000 characters.

- It follows every setting's rules: append-only, author and date, the
  current value is the latest row, and the birth value is the default
  below (FR-043).
- The Reglas tab edits it in a text area, with the placeholders listed
  and a preview filled with sample data.

**Placeholders** are in Spanish because the operator reads them, and are
written between braces:

| Placeholder | Filled with |
| --- | --- |
| `{negocio}` | the business's name |
| `{tienda}` | the store's name |
| `{folio}` | the payment's folio. **Required**: a template without it is refused |
| `{cliente}` | the customer's name, from the payment row |
| `{monto}` | the amount applied to the debt |
| `{cargo}` | the store fee |
| `{total}` | amount + fee |
| `{fecha}`, `{hora}` | the payment's time, in the business's timezone |
| `{pendiente}` | "Queda por pagar: $X" after a short payment; empty otherwise |
| `{estado}` | the outcome's sentence (D18) |

**Rules:**
- The renderer is `renderReceipt(template, values)` in
  `apps/api/src/receipt/index.ts`, beside `toWhatsAppPhone` and
  `whatsAppLink`. That module's own comment says the store receipt text
  "retired to devolada-red", and this is where it returns. A
  `src/receipt.ts` beside the `src/receipt/` folder would make
  `./receipt` ambiguous, so it is not created (/speckit-analyze U1).
- Money goes through the money law's formatter: es-MX, MXN.
- A line that is empty once filled in is dropped, so `{pendiente}` costs
  nothing on a whole payment.
- An unknown placeholder, or a missing `{folio}`, is refused at save with
  400 `INVALID_SETTING`, as every other setting is refused today. The
  panel names the problem.

**The default** (es-MX: the customer reads *pago*, never *cobro*):

```text
Comprobante de pago · {negocio}

Folio: {folio}
Cliente: {cliente}
Pagaste: {monto}
Cargo por servicio: {cargo}
Total: {total}
{pendiente}
Tienda: {tienda}
Fecha: {fecha}, {hora}

{estado}
Guarda este folio como comprobante.
```

**The outcome sentences** live in code, in es-MX, like the rest of the
product's copy. They are not settings in this feature. An operator who
does not want them leaves `{estado}` out of the template.

**The template applies when a receipt is asked for.** A receipt re-opened
for an old payment uses the template current at that moment. Receipts are
never stored (`receipt` D7: no "sent" record), so there is no older
version to keep.

**Alternatives considered**:
- A template per business. Rejected: the creator placed the setting in
  `/operador`, and the network's fee is one value too (D22).
- Each outcome sentence as its own setting. Deferred: five more fields
  before anyone asked to change them.

## D32 — The store app on a computer

*(Added 2026-10-01. After `/design`, the creator chose to build the
canvas's desktop artboards now; FR-012 is amended to match.)*

A store may keep a computer at the counter. It is the same app at the
same address. From 1024 px it uses the width:

| Screen | Phone (D26) | From 1024 px |
| --- | --- | --- |
| The frame | three tabs at the bottom, 64px | a side menu (15rem): *Devolada*, the store's name, the three sections at 48px; no bar at the bottom |
| *Cobrar* (`/`, `/cobro/$usuario`, `/cobros/$id`) | one screen at a time | the search stays on the left; the debt, then the payment, show on the right. The chosen customer is marked in the results, and the search empties once a payment is recorded |
| *Mi caja* | the cards, then the passkey | the cards and the passkey on the left; the hand-overs to each business on the right (T080's history, disputes and notes included) |
| *Registrar entrega* | the form | the business's card on the left, the form on the right |
| *Movimientos* | a list per day | a table per day: *Hora*, *Movimiento*, *Folio*, *Tu cargo*, *Monto* |
| The ways in (`/entrar`, `/recuperar`, `/invitacion`), the suspended and wrong-account screens | a centred card | the same card |

**Rules:**
- **One breakpoint**: Tailwind's `lg`, 64rem (1024 px). Below it the
  phone layout holds at any width, so a tablet keeps the tabs.
- **Sizes do not shrink.** A counter computer may have a touch screen,
  so the store app keeps 48px targets and the 64px decisive action at
  every width. The 40px compact size stays the panel's (constitution VI).
- **The frame is CSS; the screens are composed in code.** Both menus are
  in the page and CSS shows one, as the panel's shell does, with two
  landmark names: *Secciones* and *Secciones, barra inferior*. Where a
  screen itself differs (a heading level, a table instead of a list, a
  half beside another), one hook, `useWide()` (`apps/red/src/lib/wide.ts`),
  reads the same media query. So no hidden copy of a screen sits in the
  page, with its own focus and its own live region.
- **Headings.** On a phone each screen's own title is the `h1` (*Pago
  registrado*, the customer's name). On a computer the section is the
  `h1` (*Cobrar*, *Mi caja*), and each half is an `h2`.
- **Nothing new in the API.** Both widths read the same routes.

**Alternatives considered**:
- **A separate desktop app.** Rejected: two apps drift, and FR-012 gives
  the store one address.
- **CSS only, both versions of every screen in the page.** Rejected: two
  search boxes and two quotes in the DOM, two `h1`s, and focus and live
  regions inside the hidden copy.
- **Two halves from 768 px.** Rejected: beside the menu, each half would
  be about 220px, narrower than the 360px phone floor. At 1024 px each
  half is about 350px, a phone's width.

## Measurements to take before code (quickstart §0)

| # | What | Decides |
| --- | --- | --- |
| M1 | The username plugin on a local D1: its migration columns; sign-in by username with `requireEmailVerification`; the `hooks.before` refusal on `/sign-up/email` and `/update-user` | D3, D5 |
| M2 | Adding `red.dev` to the home screen on Android Chrome and iOS Safari, with a manifest and no service worker | D26 |
| M3 | On the pilot, read-only: `searchCustomers` returns `zona` on its rows, and `getCustomer` returns `telefono` and `zona` | D8 |

If M1 shows the plugin cannot be held to the acceptance route, **stop and
take it to the creator**. Signing in by email is the fallback, and it
changes a decision the creator made.

### Results (T001)

- **M1 — measured 2026-10-01, holds (D3, D5 stand).** On the workerd local
  D1 of the API suite (`apps/api/test/cash-at-stores-access.test.ts`, the
  "M1" block), against Better Auth 1.6.29:
  - the plugin's columns are `user.username` (text, unique) and
    `user.display_username` (text) — migration `0044_cash_at_stores.sql` (0043 at first; renumbered 2026-10-01 when spec 017 took 0042 on `main` and the retry fix moved to 0043);
  - a user whose `username` was written in the DB signs in with
    `POST /auth/sign-in/username {username, password}` (200, session cookie),
    and `/auth/me` answers the store branch;
  - the same user unverified gets 403 `EMAIL_NOT_VERIFIED`: the plugin
    honours `requireEmailVerification` because no `sendVerificationEmail`
    is configured (the house uses the email-OTP plugin);
  - the `hooks.before` refusal holds on `/sign-up/email` and `/update-user`
    (400 `USERNAME_NOT_ALLOWED`).

  **Two doors the plan did not name, found reading 1.6.29's dist:**
  `/sign-in/email-otp` creates a user from any extra body field (so it
  would take a `username`), and the plugin's own sign-up hook copies a
  `displayUsername` into `username`. The refusal therefore covers every
  path except `/sign-in/username`, and both fields; the user hook runs
  before every plugin hook (`getHooks`). `/is-username-available` is
  turned off (`disabledPaths`): whether a phone is a store's is nobody's
  to probe. The username stays the acceptance route's alone — no stop.
- **M2 — not run here.** It needs an Android phone with Chrome and an
  iPhone with Safari against `red.dev`. The app ships a manifest
  (standalone, 192/512 PNG icons, an SVG, `apple-touch-icon`) and no
  service worker (D26). To measure on the first dev deploy, before the
  pilot (T065); if one platform fails, the app still works in its browser.
- **M3 — not run on the pilot.** It needs the pilot tenant's key, which
  this session does not have. What the code already shows: both reads use
  the `/clientes/` list rows (`searchCustomers` through `listPage`,
  `getCustomer` by `usuario=`), and one mapping (`mapCustomer`) reads
  `zona.nombre` and `telefono` from them — measured on the demo tenant by
  `links-on-demand-search` (2026-09-20). If the pilot's rows carry no
  `zona`, a result shows name and usuario and the zone is null (FR-017:
  "when the integration has one"); nothing breaks. To confirm read-only on
  the pilot before its first collection.
