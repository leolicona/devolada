# Research: payment-method-per-channel

Every decision below is cited in code as `payment-method-per-channel D<n>`.
The provider facts it rests on are the spec's R1–R13, measured on the demo
tenant on 2026-10-01 and 2026-10-02. None of them is re-measured here.

The Technical Context left no NEEDS CLARIFICATION: the spec closed its four
measurements (M1–M4) before this plan.

---

## D1 — Devolada's two names live in the WispHub adapter, as constants

**Decision**: `apps/api/src/wisphub/payment-methods.ts` declares
`SPEI - LINK.DEVOLADAPAGO` (the SPEI channel) and `CASH - RED.DEVOLADAPAGO`
(the store channel). Nothing in the core carries them. The admin shows
them through the integration's own contract (D8), never as literals of its
own.

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
payment methods (`id`, `nombre`) instead of the single cash id, with the
same key (business + installation address, provider-address-per-isp
T046) and the same ten minutes (provider-latency D5). The adapter picks the
channel's method and the cash method from that one read.

**Rationale**: One read already happens per recording today; the list is
the same call without `find()`, paged with `limit` and `offset` while the
provider reports more. Today's call reads only the provider's first page;
how many methods fit on it was not measured, and a business with many
methods could have Devolada's on the second. A method the business creates appears at
the latest ten minutes later, the same promise the cash method has had
since provider-latency D5.

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
   not one of Devolada's. Still none → the first method, which is today's
   behaviour for a business that has only Devolada's methods.

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
method**, inside the same attempt. Any other 400 stays what it is today
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
in `…`; the folio and the clave are never cut. With no folio (not expected:
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

## D11 — No migration, no new table, no mark in Pagos

**Decision**: nothing in the database changes. A payment that fell back is
not marked one by one; the integration's screen carries the setup state
(D8).

**Rationale**: the spec's Key Entities and Assumptions. The reason for a
fallback is a setup state of the business, not of the payment.

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
- Existing suites keep their `formas-de-pago` stub (`efectivo`, id 7):
  with no Devolada method the adapter records exactly as today, which is
  FR-003's "no change" and keeps them green.

Every test cites `payment-method-per-channel US<n>` (constitution VII).
