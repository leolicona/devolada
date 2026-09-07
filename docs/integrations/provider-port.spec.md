---
status: proposed
stories: [US-I04]
domain: integrations
updated: 2026-09-07
debt: []
---

# Spec: Provider port — the base behavior, with and without an adapter

The oracle (validation, classes, credit, the dispatch ledger, observation,
the feed) was built against one operated system, and the coupling shows:
eleven `new WispHub(` sites, `WISPHUB_*` reasons on payment rows, a
`wisphub_customer_id` column on two tables, and a debt calculation that
lives in `src/wisphub/`. The pivot already says an ISP is one kind of
business and integrations are chosen (pivot D9/D10, integrations-hub D10).
This spec draws the line: **what Devolada does is the base; what a
system does is an adapter behind a port.** It defines the port, the
adapter-declared capabilities, the null provider (a business with no
integration), and the vocabulary the rows, the API and the screens use so
that no provider name leaks past the adapter.

Decided with the owner in the provider-port interview (2026-09-07), after
PR #167 (presence freshness) exposed the coupling in the D1 load review.

What the pivot already fixed and this spec only inherits: the
reconciliation class is computed at the verdict against the fresh debt
(payments-and-classes D3); three fixed mapping rows, adapter-declared
actions, `invalid`/`not_found`/`expired`/`unapplied` never dispatch
(pivot D9); one integration per business (D10); no outgoing webhooks in
v1 (D17); the adapter is bidirectional — SOURCE synchronous inside the
reconciliation path, ACTIONS through the acknowledged dispatch (pivot Open
item 5); observation is zero writes (integrations-hub D4).

## Decisions

- **D1 — The base is the oracle, in port vocabulary; the null provider
  is a legitimate implementation (owner decision).** A business with no
  integration is not a broken business: it is a business whose provider
  is **null** — declares no capabilities, sources no customers and no
  receivables, executes no action. Everything else runs unchanged: the
  permanent link, the proof, Consta validation, classification, the
  credit debit, the ledger, observation, the feed. Concretely, `Cobros`
  and `Links` answer `PROVIDER_NOT_CONFIGURED` (409) and render the empty
  state with the shell banner's own words (integrations-hub D10: "Conecta
  el sistema con el que cobras", button "Ver integraciones"); a payment
  that reaches the verdict for such a business is never lost — it retries
  with the same reason, exactly as today. **Said in the open**: the null
  provider is a *transitional state of a business*, not a kind of
  business. The business that wants Devolada without any operated system
  is pivot D2's deferred manual source ("cóbrale $650 a Juan"): with this
  port in place it is a second `ProviderSource` whose customers and
  receivables live in Devolada's own tables, with an empty action
  catalog — its own spec (`charges/manual-charges.spec.md`, amending
  pivot D2's "one source only"), sequenced after this one. This spec
  keeps the door open (D5: refs may be Devolada's own identity; D9: "no
  actions" is a first-class catalog; `integrations.provider` reserves
  `manual`) and builds nothing of it. **Rejected**: folding the manual
  source into this spec (it re-decides pivot D2 by accident); accepting a
  payment with no receivable as class `unapplied` for the null provider
  (breaks direct-payment D1/D8's premise that a link belongs to a customer
  with a known debt).

- **D2 — Two ports and a capability sheet, not one interface.**
  `ProviderSource` is the read side: customer lookup, the customer's
  account (receivables + carried balance), the roster, search, a probe. It
  runs **synchronously inside the reconciliation path** (the verdict's
  fresh read, the payer's quote, Cobros) and behind the display cache
  (D10). `ProviderActions` is the write side: register a payment,
  reconnect, grant/revoke a provisional release. It runs **only through
  the dispatch ledger** (integrations-hub D6) with an acknowledged
  outcome, and never under observation (D4). `ProviderCapabilities` is a
  static constant per adapter (D9). The split is pivot Open item 5 made
  literal, and it is what lets the null provider and a future read-only
  adapter (D17's inbound webhook) exist without methods that throw.
  **Rejected**: one `Provider` interface with optional methods (the null
  provider becomes a bag of `undefined`s and every caller re-checks);
  source-only now, actions later (the hub's action catalog stays
  hardcoded to WispHub, which is the coupling this spec exists to remove).

- **D3 — The second implementation is the null provider plus a
  `FakeProvider` in tests (owner decision).** A port carved from one
  adapter is that adapter in disguise; the honest second implementation
  is the one that has to exist anyway. The null provider is production
  code (D1). The `FakeProvider` is an in-memory `Source`+`Actions` pair
  the oracle's tests inject through the factory (D11): validation,
  classes, the reconnection queue, provisional release and the sweeps
  stop knowing WispHub URLs. The WispHub adapter keeps its own tests at
  the `fetch` boundary — the measured contract of
  `docs/integrations/wisphub.md` is tested where it is real. **Rejected**:
  shaping the port for a second ISP system nobody has chosen (guesswork
  with a migration cost); the inbound-webhook adapter as the second
  implementation (D17 deferred it and it has no consumer).

- **D4 — The vocabulary is generic: `PROVIDER_*`, and the screen names
  the provider from the integration row (owner decision; amends
  integrations-hub D10).** Rows, the API envelope and the reconnection
  budget speak `PROVIDER_NOT_CONFIGURED`, `PROVIDER_UNAVAILABLE`,
  `PROVIDER_AUTH_FAILED` and `PROVIDER_ACTION_UNSUPPORTED` (D9). The
  provider's own name appears exactly once per screen: interpolated from
  `integration.provider` into a **single copy map** shared by admin and
  pago ("{Proveedor} no respondió. Lo seguimos intentando." /
  "{Proveedor} rechazó la llave. Revísala en Integraciones."). HTTP
  status is one per code, everywhere: `NOT_CONFIGURED` → **409**
  (Cobros answered 409 and Links 503 for the same fact — BUG-019 fixed
  the stalled case, this closes the configured case), `UNAVAILABLE` →
  **503**, `AUTH_FAILED` → **502**, `ACTION_UNSUPPORTED` → **409**. The
  rows already written with `WISPHUB_*` are **rewritten by the
  migration** (`payments.last_error`, `payments.action_error`,
  `top_ups.last_error`): these columns are attempt state, not money
  history, and `payments` rows are updated on every attempt already
  (ARCHITECTURE house rule untouched). Hub D10's reason for keeping
  `WISPHUB_*` — "they only ever fire for a WispHub row" — stops being
  true the day a second adapter fires them. **Rejected**: per-provider
  prefixes (`WISPHUB_*`, `X_*`) with a copy map per provider (two
  vocabularies forever, in tests and specs); read-time mapping that
  leaves old rows as they are (the same two vocabularies, hidden).

- **D5 — Provider identity columns are renamed, all of them, in the
  migration PR (owner decision).** `payment_links.wisphub_customer_id` →
  `provider_customer_ref` (text, not null), `payments.wisphub_customer_id`
  → `provider_customer_ref` (text), `payments.wisphub_invoice_id` →
  `provider_receivable_ref` (**text**: the adapter owns the format — an
  integer id today, an opaque string tomorrow), and `customer_usuario` →
  `customer_handle` on both tables (the human key the provider shows and
  the ISP types; the unique index `payment_links_business_usuario_idx`
  becomes `payment_links_business_handle_idx`). Precedent: pivot D14
  renamed three tables in one PR. The golden rule does not admit a
  column named after one provider under a port that promises none.
  Under the manual source (D1) both refs are Devolada's own ids — the
  columns already fit. **Rejected**: renaming only the `wisphub_*`
  columns and leaving `customer_usuario` (it is WispHub's word for the
  handle; one word per concept); a TD instead of the rename (the lint
  and every spec keep the wrong vocabulary until an unspecified day).

- **D6 — `Source.account()` returns the raw account; the oracle computes
  the debt (owner decision).** The port returns
  `Account { customer, receivables, carriedBalanceCents, complete }` in
  domain shape and **nothing computed**. `debtOf` and `billingStatusOf`
  move from `src/wisphub/debt.ts` to `src/direct-payments/debt.ts`
  **without changing a line of logic**: the sum of pending receivables
  plus the carried balance (debt-truth D7), the credit netted and never
  shown as money (D12), every pending receivable at once (direct-payment
  D21) are product rules — the promise Devolada cannot honour is the same
  under any provider. A provider without a running account returns
  `carriedBalanceCents: 0` and the rules hold. `billingStatusOf`'s
  fallback to the provider's label (debt-truth D4/D14) becomes
  `Account.complete` plus `customer.billingHint` — the adapter says
  whether the receivable list was cut off and what its own label claims;
  the oracle decides what to believe, as today. **Rejected**: the adapter
  returns a computed `Debt` (D12 and D21 re-implemented per adapter, and
  the FakeProvider would have to copy them for the oracle's tests to stay
  true).

- **D7 — The vehicle belongs to the adapter (owner decision).** Which
  receivable a payment is applied to, and what to do when nothing is
  pending, "depends on how each system is configured — it is the
  adapter's". So the port carries an **opaque handshake**, not a rule:
  `Actions.registerPayment({ customerRef, amountCents, reconnect,
  receivableRef })` takes `receivableRef: null` the first time and
  **returns the ref it used**; the oracle persists it on the row
  (`provider_receivable_ref`) **immediately**, and every retry and
  "Ejecutar ahora" passes the same ref back. The adapter's contract is
  idempotence given the same ref. If the adapter mints something and
  fails afterwards, the thrown `ProviderActionError` **carries the ref**
  so the oracle persists it anyway — TD-009's guard (never two zero-total
  invoices for one payment) survives without Devolada knowing what a
  zero-total invoice is. For WispHub, debt-truth D15 lives whole inside
  the adapter: oldest pending invoice, or a `total: 0.00` vehicle when
  nothing is pending, never an invoice sized to the carried balance.
  The verdict still reads the account fresh (D6) and still records the
  customer identity and the settled amount (payments-and-classes D3); it
  simply no longer computes a vehicle. **Rejected**: the oracle picks
  "the oldest pending receivable" as a product rule (it is a fact about
  WispHub's running account, and another system may apply a payment to
  the account, to the newest period, or by its own configuration); no
  persistence, re-resolve on every attempt (measured risk: two vehicles,
  or a payment applied to the next period after a month boundary).

- **D8 — Registering the amount that arrived is an entry requirement of
  the port, not a capability (owner decision).** partial-payment D1/D5
  are law: a short payment is recorded, never refused, and the real
  amount is always registered. A system that only accepts an invoice
  paid whole cannot implement `register_payment` and therefore cannot
  connect — written down as a precondition, decided with the real case
  in front of us if one ever arrives. **Rejected**: an
  `acceptsPartialPayment` flag with a new `manual` outcome and its feed
  copy for a short payment (a state and a screen with no user).

- **D9 — Capabilities are a static catalog the hub reads and validates
  (owner decision).** Each adapter exports
  `capabilities: { actions: readonly ("register_payment" | "reconnect")[],
  provisionalRelease: boolean, absorbsOverpayment: boolean, roster: boolean,
  search: boolean }`. The hub's mapping rows (integrations-hub D3) offer
  `register_and_reconnect` only when `actions` includes `reconnect`; a
  `PATCH` that maps a class to an undeclared action fails with
  `PROVIDER_ACTION_UNSUPPORTED`; the provisional switch (hub D8) is not
  rendered when `provisionalRelease` is false — pivot Open item 1's "an
  adapter only declares whether it offers a provisional action" becomes
  code; `effectiveOverTreatment` reads `absorbsOverpayment` from the
  capability sheet of the *business's* provider instead of the WispHub
  constant (payments-and-classes D2 unchanged in meaning); `Links` and
  the Cobros search read `roster`/`search` and degrade to the D1 empty
  state when false. WispHub declares everything true and both actions;
  the null provider declares `actions: []` and every flag false. An
  empty catalog is first-class (D1's manual source). **Rejected**: only
  `absorbsOverpayment` + `provisionalRelease` (an adapter that registers
  but cannot reconnect would be offered a select it cannot honour —
  hub D3's "the select's floor is honesty" cuts both ways).

- **D10 — The display cache wraps the `Source`, keyed by provider; the
  pulse stays where PR #167 left it.** `src/wisphub/cache.ts` becomes
  `src/integrations/cache.ts`: a decorator over any `ProviderSource`
  whose Cache API keys carry `provider:businessId:version` (presence-
  freshness D5/D6 inherit unchanged; provider-latency D3's "the verdict
  never takes the display cache" inherits as the `fresh` flag on
  `account()`). The registered-payments pulse remains
  `MAX(payment_registered_at)` per tenant — one index seek since
  migration 0027 — and no per-tenant revision column is introduced: the
  moment the cached list goes stale is still "the dispatch that told the
  provider", whatever the provider. **Rejected**: a `revision` column on
  `integrations` bumped at every ack (a second source of truth for a
  fact the payments table already states).

- **D11 — One factory, per-provider environment, generic routes.**
  `providerFor(integration, env)` returns `{ source, actions,
  capabilities }` for a connected row and the null provider for none; it
  replaces every `new WispHub(` (eleven sites today) and is the seam the
  tests use to inject the `FakeProvider` (D3). The WispHub adapter moves
  to `src/integrations/wisphub/` (client, money, reconnection mechanics
  behind `Actions`); `src/wisphub/` disappears. Provider environment is
  per adapter (`WISPHUB_BASE_URL` stays; a second adapter brings its
  own). The hub's routes go generic: `PATCH /integrations/:provider` and
  `POST /integrations/:provider/test` (the latter calls
  `Source.probe()`, which returns the sample customer count settings D2
  measured); `:provider` outside the catalog → 404. The catalog itself
  (`GET /integrations`) lists every registered adapter with its
  capability sheet, so the "Integración genérica" dead card (hub D1) is
  replaced by whatever the registry says — today, one card. The ISP
  never sees a mechanism change: same page, same copy.

- **D12 — Delivery is a spec PR and two code PRs (owner decision).**
  **PR 1** (this): the spec in `proposed`, US-I04 reserved, the
  amendments below. **PR 2**: the port, the factory, the null provider,
  the `FakeProvider`, `debtOf` moved, the cache decorator, the adapter
  under `src/integrations/wisphub/` — **zero behavior change**: no schema,
  no code rename, every existing test green with the oracle's tests
  migrated to the fake; the spec turns `in development`. **PR 3**: the
  migration (D5 renames, D4 rewrite), the `PROVIDER_*` vocabulary in API
  and both apps' copy maps, the generic routes (D11); the spec turns
  `current` once the DoD's deployed checks close. Each PR verifiable on
  its own: a migration timeout in preview (CICD D7's ceiling, seen on PR
  #167) never blocks the pure refactor. **Rejected**: one PR with the
  migration inside (two unrelated risks in one review); spec and port in
  one PR (the spec would be born `in development` before the interview's
  decisions were reviewable on their own).

## Schema

Migration (PR 3, one file):

```sql
-- D5: provider identity is the port's, not WispHub's
ALTER TABLE payment_links RENAME COLUMN wisphub_customer_id TO provider_customer_ref;
ALTER TABLE payment_links RENAME COLUMN customer_usuario TO customer_handle;
DROP INDEX payment_links_business_usuario_idx;
CREATE UNIQUE INDEX payment_links_business_handle_idx ON payment_links (business_id, customer_handle);
ALTER TABLE payments RENAME COLUMN wisphub_customer_id TO provider_customer_ref;
ALTER TABLE payments RENAME COLUMN customer_usuario TO customer_handle;
ALTER TABLE payments RENAME COLUMN wisphub_invoice_id TO provider_receivable_ref;  -- integer → text via recreate (drizzle)
-- D4: attempt-state columns speak the port's vocabulary
UPDATE payments SET last_error   = replace(last_error,   'WISPHUB_', 'PROVIDER_') WHERE last_error   LIKE 'WISPHUB_%';
UPDATE payments SET action_error = replace(action_error, 'WISPHUB_', 'PROVIDER_') WHERE action_error LIKE 'WISPHUB_%';
UPDATE top_ups  SET last_error   = replace(last_error,   'WISPHUB_', 'PROVIDER_') WHERE last_error   LIKE 'WISPHUB_%';
```

`integrations.provider` keeps its enum `["wisphub"]` in PR 3; the value
`manual` is **reserved by name** for D1's follow-up spec and added by it.
No new table, no new column: the port is code, and the two refs the row
needs already exist under their old names.

## Contract

The port (`apps/api/src/integrations/port.ts`; TypeScript is the
contract, this table is its meaning):

| Member | Side | Meaning |
|---|---|---|
| `Source.customer(handle)` | read | `Customer { ref, handle, displayName, serviceStatus: "active" \| "suspended" \| "unknown", billingHint: "due" \| "paid" \| "unknown" } \| null` |
| `Source.account(handle, { fresh })` | read | `Account { customer, receivables: Receivable[], carriedBalanceCents, complete }`; `Receivable { ref, amountCents, issuedAt }`; `fresh: true` bypasses the display cache (provider-latency D3) |
| `Source.roster()` | read | `{ customers: Customer[], complete }` — `capabilities.roster` |
| `Source.search(q)` | read | `Customer[]` — `capabilities.search` |
| `Source.probe()` | read | `{ sampleCustomerCount }` — the key test (settings D2) |
| `Actions.registerPayment(input)` | write | `{ customerRef, amountCents, reconnect, receivableRef: string \| null }` → `{ receivableRef, serviceStatus }`; idempotent given the same `receivableRef` (D7); `reconnect: false` records and leaves the cut in place (partial-payment D5) |
| `Actions.grantProvisional(input)` / `revokeProvisional(input)` | write | provisional-release D3/D5 mechanics — `capabilities.provisionalRelease` |
| `capabilities` | static | D9's sheet |
| `ProviderError` | — | `code: "PROVIDER_UNAVAILABLE" \| "PROVIDER_AUTH_FAILED"`, `status?`; `ProviderActionError` adds `receivableRef?` (D7) |
| `providerFor(integration, env)` | factory | connected row → the adapter; no row / no key → `NULL_PROVIDER` (`actions: []`, every read answers empty, every write throws `PROVIDER_NOT_CONFIGURED`) |

Routes (PR 3; every other route keeps its shape and swaps codes per D4):

| Route | Actor | Notes |
|---|---|---|
| `GET /integrations` | `integrations: manage` | the catalog from the registry: one card per adapter with its capability sheet and the business's row state |
| `PATCH /integrations/:provider` | `integrations: manage` | hub's `PATCH /integrations/wisphub` generalized; unknown `:provider` → 404; undeclared action in the mapping → 409 `PROVIDER_ACTION_UNSUPPORTED` |
| `POST /integrations/:provider/test` | `integrations: manage` | `Source.probe()`; failures come back as `data.ok = false` with a `PROVIDER_*` code, as settings D2 shaped it |
| `GET /payment-requests`, `GET /direct-payments/links`, `…/roster` | `payments: read` | null provider → 409 `PROVIDER_NOT_CONFIGURED`; stalled → 503 `PROVIDER_UNAVAILABLE`; the body's `provider` field names the adapter for the copy map |

## UI Contract

- **One copy map** (`packages/ui` or each app's `lib/provider-copy.ts`,
  one source, es-MX), keyed by `PROVIDER_*` and taking the provider's
  display name: "{Proveedor} no respondió. Lo seguimos intentando." /
  "{Proveedor} rechazó la llave. Revísala en Integraciones." / "Falta
  conectar tu sistema en Integraciones." The feed's reason column, the
  Links and Cobros error strips, the WispHub detail's test result and the
  payer's queue state all read from it. `WISPHUB_*` appears nowhere in
  either app after PR 3.
- **Cobros and Links under the null provider**: the page renders, the
  nav entry stays, the body is the honest empty state with the banner's
  words (hub D10) and "Ver integraciones" — never an empty list that
  claims there is nothing to collect (list-states US-P01).
- **Integraciones**: the catalog renders one card per registered adapter
  (today: WispHub) from the registry; the detail hides the
  `register_and_reconnect` option and the provisional switch when the
  sheet says so (D9). Nothing else on the page moves.
- **Pagos / feed**: unchanged shape; the reason column speaks through the
  copy map.

## Scenarios

1. **Null provider, Cobros.** Business with no integration row opens
   Cobros → API 409 `PROVIDER_NOT_CONFIGURED` → the page shows "Conecta el
   sistema con el que cobras" + "Ver integraciones"; the nav still lists
   Cobros and Links. (US-I04)
2. **Null provider, a payment reaches the verdict.** A link minted while
   connected, the key later removed: the sweep answers
   `retryLater("PROVIDER_NOT_CONFIGURED")`, the row keeps `pending`, the
   payer's page keeps its state; the key restored → the next sweep settles
   it. Nothing lost, exactly today's behavior with the new word.
3. **Fake provider, the verdict.** With `FakeProvider` seeded with one
   customer, two receivables (100.00, 60.00) and `carriedBalanceCents
   1000`: the quote asks 170.00 + fee; a transfer of 170.00 + fee is
   `exact`; `registerPayment` receives `receivableRef: null`, returns
   `"r-1"`, the row stores `provider_receivable_ref = "r-1"`; a forced
   retry passes `"r-1"` back and the fake asserts it was called once per
   ref. (payments-and-classes D3, D7)
4. **Vehicle minted then failed.** The fake throws
   `ProviderActionError("PROVIDER_UNAVAILABLE", { receivableRef: "r-9" })`
   on the first call: the row stores `"r-9"`, outcome `queued`; the retry
   passes `"r-9"` and succeeds; the fake never saw a second null. (D7,
   TD-009's guard)
5. **Short and over stay what they were.** Same seed, transfer of 100.00
   + fee → `short`, `reconnect` obeys threshold + floor, `registerPayment`
   called with `reconnect: false` below → outcome `withheld`; a transfer of
   200.00 + fee → `over`, treatment `credit` because the fake declares
   `absorbsOverpayment: true`; with the flag false → `flag`. (D6, D9)
6. **Capability gate on the mapping.** `PATCH /integrations/wisphub` with
   `exactAction: "register_and_reconnect"` against a fake whose `actions`
   is `["register_payment"]` → 409 `PROVIDER_ACTION_UNSUPPORTED`; the
   detail renders the `short` row's select with one option. (D9)
7. **Vocabulary migration.** A row with `action_error = "WISPHUB_UNAVAILABLE"`
   before the migration reads `"PROVIDER_UNAVAILABLE"` after; the feed
   shows "WispHub no respondió. Lo seguimos intentando." from the copy
   map, the string `WISPHUB_` absent from both apps' bundles. (D4)
8. **The WispHub adapter, at its boundary.** Existing `fetch`-level tests
   (provider-latency, reconnection-queue's `registrar-pago` shapes,
   debt-truth's `saldo` cases) pass unchanged against
   `src/integrations/wisphub/`, and `debtOf` moved to
   `src/direct-payments/debt.ts` gives the same numbers for the same
   fixtures. (D3, D6)
9. **Same list, same cache.** Two Cobros reads within the window hit the
   cache under key `wisphub:<business>:<version>`; a registered payment
   moves the pulse and the next read misses — presence-freshness
   scenarios 1–4 unchanged. (D10)

## Definition of Done

- [ ] PR 2 merged: port, factory, null provider, `FakeProvider`, cache
      decorator, `debtOf` moved, adapter under `src/integrations/wisphub/`,
      no `new WispHub(` outside the adapter; every existing test green,
      the oracle's tests no longer import WispHub or mock its URLs.
- [ ] PR 3 merged: migration 00NN (D5 renames + D4 rewrite) applied to
      dev; `PROVIDER_*` in API and both apps' copy maps; generic hub
      routes; `rg WISPHUB_ apps/` returns only the adapter and its tests.
- [ ] Scenarios 1–9 covered by tests citing US-I04 (and the story of the
      spec each scenario inherits from).
- [ ] Deployed check (dev, live tenant): Cobros, Links, a real
      registration and a forced retry behave as before the port; the
      feed's reason copy reads through the map.
- [ ] Amendments landed: integrations-hub D10 note; pivot Open item 5
      note; ARCHITECTURE.md adapter bullet; SPEC.md US-I04 and index.
- [ ] `charges/manual-charges.spec.md` reserved as the next spec (D1),
      not written here.

## Amendments this spec makes

- **integrations-hub D10** — "provider words stay where the provider is:
  … the per-payment reasons (`WISPHUB_*`)" is amended by D4: the reasons
  are `PROVIDER_*`, the provider's name is interpolated once from the
  integration row.
- **pivot Open item 5** — the bidirectional adapter is executed as D2
  (two ports); the event-bus constraints stand.
- **pivot Open item 1** — "an adapter only declares whether it offers a
  provisional action" is executed as D9's `provisionalRelease`.
- **payments-and-classes D2** — `absorbsOverpayment` is read from the
  business's provider capability sheet, not from a WispHub constant
  (meaning unchanged).
- **debt-truth D7/D12/D15** — unchanged in substance; D7/D12 move to the
  oracle (D6), D15 stays whole inside the WispHub adapter (D7).
- **ARCHITECTURE.md, Code organization** — the adapter bullet names the
  port: adapters implement `ProviderSource`/`ProviderActions` behind
  `providerFor`; nothing outside `src/integrations/<provider>/` speaks a
  provider's API or vocabulary.
