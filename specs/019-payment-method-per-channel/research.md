# Research: payment-method-per-channel

Every decision below is cited in code as `payment-method-per-channel D<n>`.
D1–D15 come from the plan; D16 and the D14 refusal without a key from
the revision after `/speckit-analyze` (2026-10-02).
The provider facts it rests on are the spec's R1–R13, measured on the demo
tenant on 2026-10-01 and 2026-10-02. None of them is re-measured here.

The Technical Context left no NEEDS CLARIFICATION: the spec closed its four
measurements (M1–M4) before this plan.

---

## D1 — Devolada's two names live in the WispHub adapter, as constants

**Decision**: `apps/api/src/wisphub/payment-methods.ts` declares
`SPEI - LINK.DEVOLADAPAGO` (the SPEI channel) and `CASH - RED.DEVOLADAPAGO`
(the store channel), each with its description (D15). Nothing in the core
carries them. The admin shows them through the integration's own contract
(D8), never as literals of its own.

**Rationale**: The creator fixed the names (spec Clarifications
2026-10-02), and FR-011 puts them in the adapter: they are product copy the
business types into *its WispHub*, so they are a fact about this provider's
setup. Another adapter may name its methods differently, or have none.

**Alternatives considered**: a platform setting the operator can edit
(rejected: nothing asks for it, and a renamed constant would orphan every
business's already-created methods); names per business (rejected: that is
the choice screen the creator removed on 2026-10-02).

---

## D2 — The core hands the payment's channel and reference parts through the existing capability

**Decision**: `ActionAttemptInput` (`integrations/capabilities.ts`) gains
two fields in the core's words:

- `channel: "spei" | "store"` — the row's own `channel`.
- `recordReference: { folio, trackingKey, storeName }` — each nullable.

The three action call sites (`settleConfirmed`, `dispatchObserved` for
*Ejecutar ahora* and the held accept, and the queue sweep) fill them from
the payment row. No new capability is declared, and `CAPABILITY_NAMES` does
not change.

**Rationale**: FR-011. The action half of `core-reads-provider-directly`
was paid by `cash-at-stores` D9: every recording already goes through
`paymentActions.attempt`. Widening its input keeps that true. An adapter
must not read the core's tables to learn the channel, so the core passes
what the row already knows.

**Alternatives considered**: a second capability `recordPayment(method,
reference)` (rejected: it would split one provider call — the payment —
across two capabilities, and the adapter would still need the channel to
pick the method); passing a ready-made reference string (rejected: the
format and the 200-character limit are WispHub's, R7, so the adapter
writes it).

---

## D3 — One cached list of methods per business and address

**Decision**: `wisphub/cache.ts` caches the whole list of the business's
payment methods (`id`, `nombre`) instead of the single cash id, keyed the
same way (business + installation address, provider-address-per-isp
T046) plus the integration's `payment_methods_seen_at` as its version
(D16), and the same ten minutes (provider-latency D5). The entry has a
kind of its own, `payment-methods`: one left under the old kind holds a
single id, and read as a list it would break the first payment after the
deploy (found implementing T011). The adapter picks
the channel's method and the cash method from that one read.

**Rationale**: One read already happens per recording today; the list is
the same call without `find()`, paged with `limit` and `offset` while the
provider reports more. Today's call reads only the provider's first page;
how many methods fit on it was not measured, and a business with many
methods could have Devolada's on the second. A method the business
creates appears at the latest ten minutes later, the same promise the cash
method has had since provider-latency D5 — and at once once Devolada has
seen it, because the key also carries the moment it was last seen (D16).

**Alternatives considered**: no cache (rejected: one more provider call per
recording on the money path, provider-latency D5's reason); caching the
two ids separately (rejected: two keys that can disagree for ten minutes).

---

## D4 — The choice rule

**Decision**:

1. **The channel's method**: the methods whose name matches the channel's
   name after normalizing both (D5). Several match → the lowest id, always
   (FR-003).
2. **The cash method** (fallback, and every payment while no Devolada
   method exists): today's rule — the first name, in the provider's order,
   that says "efect" or "cash" — **skipping any name that matches one of
   Devolada's two names** (FR-012). None left → the first method that is
   not one of Devolada's. A business that has only Devolada's methods
   keeps today's rule whole, over the whole list: the first that says
   "efect" or "cash" (`CASH - RED.DEVOLADAPAGO` when listed), else the
   first. The first plan said "the first method" here, which is today's
   answer only when nothing says cash; the order of the list would then
   have picked the channel (`/speckit-analyze` C1, 2026-10-02).

Only Devolada's two names are set aside. A business's own method that
merely mentions Devolada (the demo has one, "Devoladapago") is not.

**Rationale**: R11 measured the risk on the demo itself: the provider
lists `CASH - RED.DEVOLADAPAGO` before "Cash", so today's rule records every
payment with it. Keeping the rest of today's rule keeps every business's
cash method exactly what it is today.

**Alternatives considered**: excluding every name containing "DEVOLADA"
(rejected: it would change the cash method of a business that has its own
"Devoladapago" method); asking the business to choose its cash method
(rejected: a choice screen, which the creator removed).

---

## D5 — Normalization for the match by name

**Decision**: both sides are compared after: Unicode NFD with accents
removed, upper case, runs of spaces collapsed to one, spaces around `-`,
`.` and `·` removed, ends trimmed. So `spei-link . devoladapago` matches
`SPEI - LINK.DEVOLADAPAGO`.

**Rationale**: R8 measured that the provider keeps a name exactly as typed,
so the tolerance is not for the provider: it is for the person typing the
name by hand (FR-003).

**Alternatives considered**: exact match only (rejected: one stray space
would send a business's payments to cash in silence; US4 shows it, but the
match should not create the problem); fuzzy match (rejected: two
near-names, e.g. a business's own "SPEI LINK" method, could be taken by
mistake).

---

## D6 — Falling back when the provider refuses the method

**Decision**: when `registrar-pago` answers **400 naming `forma_pago`** and
the payment was sent with one of Devolada's methods, the adapter drops the
cached list, and retries the same payment **once, at once, with the cash
method** chosen without the method just refused, inside the same attempt.
Leaving it out matters only for a business with only Devolada's methods,
where the cash rule could hand the refused one back and the action would
wait in the queue for nothing (FR-004; `/speckit-analyze` C1,
2026-10-02). Any other 400 stays what it is today
(`INTEGRATION_UNAVAILABLE`). The client keeps the field names of a 400 JSON
body on `WispHubError` (`fields`) so the adapter can tell.

**Rationale**: R9 measured the answer: 400, `{"forma_pago": ["Clave
primaria … inválida - objeto no existe."]}`, and the invoice stays pending
— nothing was recorded, so a second call cannot record twice. FR-004 and
SC-005: the action never waits for the business to fix a method.

**Alternatives considered**: queuing the action until the method exists
(rejected by the creator, 2026-10-01); treating every 400 as a missing
method (rejected: an amount or date refusal would be retried under another
method and hide the real error).

---

## D7 — The reference

**Decision**: the adapter writes WispHub's `referencia` on every recording,
fallback included (FR-007):

- SPEI: `<folio> · <clave de rastreo>`, or `<folio>` when the clave is not
  known.
- Store: `<folio> · <store name>`.

The separator is a space, the middle dot `·`, and a space. The whole text
is at most 200 characters (R7). Only the store's name is shortened, ending
in `…`; the folio and the clave are never cut.

The store's part is `stores.name`: the store's own name, 2 to 80
characters, which Devolada's operator sets when creating the store and
may edit (cash-at-stores, `routes/platform/schema.ts`). It is the name the
business already sees in Puntos de pago. Never the shopkeeper's name, the
store's phone or its address. With the folio's 9 characters (`DV-` and
six, `folio.ts`), a store reference is at most 92 characters and a SPEI
one about 42 (a clave de rastreo is at most 30), so the 200-character
guard never cuts anything today; it stays because the name's limit
belongs to another feature and can change. With no folio (not expected:
every confirmed row has one) the reference is omitted.

**Rationale**: R10 and R12: the middle dot survives the API and the
provider's invoice view and PDF. The folio finds the payment in Pagos; the
clave finds the bank line; the store's name tells which store holds the
cash (US3). Nothing about the payer goes in (FR-007).

**Alternatives considered**: a `|` or `-` separator (rejected: `-` already
appears inside the provider's own transaction line, "Forma de Pago: … -
Referencia: …", R12); the customer's name (rejected: FR-007).

---

## D8 — The setup state: one read for the screen, the same answer in "Probar conexión"

**Decision**:

- A new read, `GET /integrations/wisphub/payment-methods`, answers whether
  each of Devolada's methods exists in the business's WispHub: `found`,
  `missing`, or `duplicate` (more than one match). The network's line is
  present only when the business's store channel is on. When the provider
  cannot be reached the answer is `checked: false`, never `missing`
  (FR-009).
- The connection test's `payment_methods` probe reads the whole list
  instead of one row, and its answer carries the same block.
- The WispHub screen calls the read when it opens, with its own loading
  and error states, so the screen's main read (`GET /integrations`) keeps
  no provider call.
- The block sits right after the connection card and before the mapping
  and *Ejecución* cards: the creator's order is the connection, then the
  payment methods, then execution (spec Clarifications 2026-10-02).
- The setup read, the probe and the gate (D14) read the list fresh, never
  from the cache: a business that just created a method and comes back to
  check must see it. When the read is for the stored key and installation
  and the provider answered, it stamps the moment it was seen (D16), so
  the next payment, wherever it runs, reads the list again; the place that
  read it keeps it under the new stamp. A test of a candidate key or
  installation stamps nothing (it may be the door the business is walking
  away from).
- In "Probar conexión", the block follows the probe: the probe answered →
  the block; the probe ran and failed (refused, timed out) →
  `{ checked: false }`, never "missing" (FR-009); the test stopped before
  the probe → `null`, and the screen keeps the card it already shows.

**Rationale**: FR-008 and FR-009. Constitution VIII: a typo must not send
payments to cash in silence. Keeping it off `GET /integrations` keeps the
whole integrations screen from waiting on WispHub (the screen today renders
from Devolada's own rows).

**Alternatives considered**: only in "Probar conexión" (rejected: FR-008
asks the screen to show it when opened); inside `GET /integrations`
(rejected: provider latency and failure on the screen's main read).

---

## D9 — When the method is decided

**Decision**: at the moment the payment is recorded, in the attempt that
calls `registrar-pago`. A retry after the money landed never records again
(reconnection-queue D8, unchanged), so it never changes a method. A
payment recorded before the methods existed keeps the cash method
(FR-006): nothing re-records it.

**Rationale**: FR-005 and FR-006 follow from the existing two-phase attempt
without new state.

---

## D10 — The store's name is read when the payment is recorded

**Decision**: the call sites read `stores.name` for a store row when they
build `recordReference`. The queue sweep reads the names of its batch in
one query, as it already does for the businesses.

**Rationale**: US3 scenario 3: the name *as it was at that moment*. A store
renamed later does not touch payments already recorded (FR-006).

**Alternatives considered**: copying the store's name onto the payment row
(rejected: a new column for a value read once, and the spec adds no
entity).

---

## D11 — One additive column, no new table, no mark in Pagos

**Decision**: the only database change is D16's column on the
integration row, `payment_methods_seen_at`, nullable and additive. No
table, and a payment that fell back is not marked one by one; the
integration's screen carries the setup state (D8).

**Rationale**: the spec's Key Entities and Assumptions: the reason for a
fallback is a setup state of the business, not of the payment. The column
was added on 2026-10-02, after `/speckit-analyze`, when the creator chose
an exact switch-over (FR-014); the first plan had no migration.

---

## D12 — Rollout order

**Decision**: the release that carries D4 ships before any business
creates `CASH - RED.DEVOLADAPAGO`. The setup instructions (the screen's
copy, D8) reach businesses only with that release. The pilot creates
`SPEI - LINK.DEVOLADAPAGO` and `CASH - RED.DEVOLADAPAGO` after it.

**Rationale**: R11. Today's adapter is already affected on the demo, where
the methods exist: until this release, every payment Devolada dev records
there carries `CASH - RED.DEVOLADAPAGO`. That is acceptable on the demo and
not on the pilot's live books.

The gate (D14) does not touch a business whose execution is already on at
the release, the pilot included if it is executing: it keeps recording as
today until it creates the methods, then records with them.

---

## D13 — Tests

**Decision**:

- **API** (`apps/api/test/payment-method-per-channel.test.ts`, workerd with
  a real D1, WispHub intercepted at its origin with `fetchMock`): the
  `registrar-pago` body is asserted for `forma_pago` and `referencia` on
  each story's path — the SPEI verdict, a store's record, *Ejecutar
  ahora*, the queue sweep — plus the fallbacks (no method, refused method,
  R11's order), the tolerant match, the lowest id, and the reference
  limit. The setup read and the connection test are asserted for `found`,
  `missing`, `duplicate` and `checked: false`.
- **Component** (`apps/admin`, happy-dom + MSW + axe): the WispHub screen's
  block — both lines, the network's line hidden with the channel off, the
  setup copy, the unreachable state.
- **The gate** (API suite): turning execution on with the methods →
  saved; with one missing → `409 PAYMENT_METHODS_MISSING` and the row
  still observing; the network's method missing with the store channel on
  → refused, with it off → saved; WispHub timing out →
  `503 PAYMENT_METHODS_UNCHECKED`, row unchanged; turning off with no
  method → saved and no provider call; `actionsEnabled: true` on a row
  already on → saved and no provider call; a duplicate → saved. The
  component suite: the switch cannot be turned on while the block says
  missing, can always be turned off, and both refusals have es-MX copy.
- **Every way a payment is recorded** (FR-005): besides the verdict,
  *Ejecutar ahora* and the sweep, a partial payment (`reconnect: false`),
  a payment carried by an invoice Devolada creates (no pending invoice →
  `createInvoice`, then `registrar-pago` with the method), and a held
  payment the business accepts (`reviewDecision`'s accept).
- **Freshness** (D16): a list cached under an old stamp is not used once
  the stamp moves; a setup read with the stored key moves it; a test of a
  candidate key does not.
- Existing suites keep their `formas-de-pago` stub (`efectivo`, id 7):
  with no Devolada method the adapter records exactly as today, which is
  FR-003's "no change" and keeps them green.

Every test cites `payment-method-per-channel US<n>` (constitution VII).
The API suites that need execution on seed the row directly
(`seedBusiness({ actionsEnabled: true })`), so the gate does not touch
them. The admin's `integrations.test.tsx` renders the WispHub screen with
MSW on `onUnhandledRequest: "error"`, so it needs a handler for the new
read; its switch cases then run against a block that says found.

---

## D14 — The methods are a requirement for turning on automatic execution

**Decision**: `patchWisphub` checks the methods when, and only when, a
patch turns `actionsEnabled` from false to true:

1. It asks the adapter for the setup block (D8), with the key and
   installation the row will have after this patch, and with the
   business's `store_channel_on`.
2. Every required line must be `found` or `duplicate`: the SPEI line
   always, the network's line when the store channel is on.
3. A required line `missing` → `409 PAYMENT_METHODS_MISSING`; the provider
   not reached (`checked: false`) → `503 PAYMENT_METHODS_UNCHECKED`. Either
   way the whole patch is refused and nothing is saved, so a combined
   patch never half-applies.

Without a key after the patch, turning on is refused with
`409 WISPHUB_NOT_CONFIGURED`, the code the hub already answers for "no
key yet", before any provider call: there is nothing to check, and a
business that turned execution on first and connected afterwards would
skip the requirement (found by `/speckit-analyze`, 2026-10-02). A
successful check stamps `payment_methods_seen_at` in the same write (D16).

No check, and no provider call, when a patch turns execution off, leaves
it as it is, or sets it to true on a row already on. Nothing else writes
`actions_enabled` to true outside `/dev/seed`, which stays as it is
(dev only). Nothing in Devolada ever writes it to false on its own: not
the release, not a missing method, not the store channel switched on
later (FR-013).

In the panel, the *Ejecución* switch cannot be turned on while the
integration has no key ("Primero conecta WispHub"), while the block says a
required method is missing, or while the block could not be checked, and
says why; it can always be turned off. The API is the authority: the block on
screen can be ten minutes old (D3), so both refusals have es-MX copy too.

**Rationale**: the creator's decision of 2026-10-02 (spec FR-013, SC-007).
The existing switch (`integrations-hub` D4) is the moment a business asks
Devolada to start writing in its system, so it is the one place a missing
method can still be prevented rather than repaired: once a payment is
recorded as cash, FR-006 keeps it there. Collecting is untouched: a new
integration is born observing, so a business collects from the
connection on. Turning execution off, or keeping it on, never depends on
WispHub answering (constitution VIII).

**Alternatives considered**: gating collection (rejected by the creator:
it stops money for a reporting detail, and a business without this
provider has no methods at all, constitution IX); turning execution off
when a method disappears (rejected: it would stop reconnections for a
setup state, the opposite of FR-004); checking only in the panel
(rejected: the panel's block can be stale, and a second client of the
route would skip it); letting an unreachable provider through (rejected:
the gate would then pass on exactly the day nobody can see whether the
methods exist).

---

## D15 — The descriptions are Devolada's copy, given to copy, never checked

**Decision**: next to each name, `wisphub/payment-methods.ts` declares its
description, product copy in es-MX:

- SPEI: «Pagos SPEI validados por link de Devolada (bancos, Spin,
  Mercado Pago, CoDi, DiMo). Los registra Devolada; no usar en
  mostrador.»
- Network: «Pagos en efectivo en tiendas de la red Devolada. Los registra
  Devolada; no usar en mostrador.»

The setup block carries each line's `description` beside its `name`, and
the screen offers a copy button for each. The match never reads a
description.

**Rationale**: the creator decided Devolada names and describes the
methods, and asked that the SPEI one say «Pagos SPEI validados por link
de Devolada» (spec Clarifications 2026-10-02). The provider's API returns
no description (R8), so it cannot be checked; it is there for the
business's own staff, and «no usar en mostrador» repeats FR-008's
instruction where the counter staff will read it.

The SPEI description names the apps (the creator's choice, 2026-10-02):
every one of them is a SPEI participant or travels over SPEI, and
Devolada confirms only what Banxico recorded, so the list says nothing
the method does not already mean. Its cost is accepted: when another app
matters, the constant changes in one place; a business that already
typed the old text loses nothing, since the description is never read.

**Alternatives considered**: the description as a literal in the admin
(rejected: two places to change it, and the names already come from the
adapter, D1); checking the description (impossible through the API, R8);
«desde cualquier banco o app» instead of naming the apps (the creator
preferred the names, for the staff who read them).

---

## D16 — A method Devolada has seen is used by the next payment, everywhere

**Decision**: the integration row gains `payment_methods_seen_at`
(timestamp ms, nullable). Every fresh read of the methods for the stored
key and installation that the provider answers — the screen's read, the
test of the saved connection, the gate (D14) — stamps it with the moment
of the read. D3's cache key carries that stamp as its version, the way the
pending list's key carries the tenant's last registration
(presence-freshness D6): a new stamp is a new key in every data center,
so the next payment anywhere reads the list again. The adapter takes the
stamp from the integration row its caller already holds, so the recording
path makes no extra query.

A patch that saves a new key or a new installation stamps it too, with no
provider call. The cache key carries the address but not the key, so
another account on the same installation would otherwise be answered from
the old account's list for up to ten minutes — ids that mean nothing
there, or worse, another method (found by the second `/speckit-analyze`,
2026-10-02; today's cached cash id has the same gap, and this closes it).

**Rationale**: the creator's decision of 2026-10-02 (spec FR-014, SC-001).
`cache.delete` reaches one data center only (`wisphub/cache.ts`), so
writing the fresh list where the screen was read would leave the others
on the old one for up to ten minutes, and a payment recorded with the cash
method meanwhile stays so (FR-006). The pilot is the case: it will create
the methods while its execution is on. The stamp moves on every
successful read, found or not; the cost is one list read per data center
after each screen visit.

**Alternatives considered**: accepting up to ten minutes (rejected by the
creator: SC-001 would start ten minutes late); no cache (rejected: every
payment would wait on the business's system, provider-latency D5);
stamping only when the list changed (rejected: it needs the old list to
compare, which is what the cache cannot give across data centers); the
adapter stamping on a refused method (D6) (rejected: an adapter does not
write the core's rows, constitution IX; that payment falls back correctly
anyway, since the method does not exist).
