# Feature Specification: payment-method-per-channel

**Feature Branch**: `claude/spec-019-devolada-as-collector` (the directory was
`019-devolada-as-collector` until the feature moved from a user to payment
methods, the same day)

**Created**: 2026-10-01 · **Rewritten**: 2026-10-01

**Status**: Draft — no clarification open; three facts about the provider
to measure before the plan (M1–M3).

**Input**: User description, in the creator's words (2026-10-01): "Para el
piloto mi cliente quiere que registremos los pagos en wisphub a nombre de
devolada pago para que pueda descargar la lista de facturas pagadas a
través del link de pago." After the measurements below: "Me parece
inviable crear muchos usuarios con permisos de administrador para cada
tienda", and then "Sí, reescribe la spec 019 con formas de pago".

## Where this comes from

When a payment is confirmed, Devolada records it in the business's system
through the integration. Today it records every payment the same way: with
the business's own cash payment method. That holds for SPEI and for cash
at a store (spec 018), and for every way a payment gets there: the
verdict, "Ejecutar ahora", a retry from the queue, a partial payment. In
the pilot's system, Devolada's payments therefore look exactly like the
cash the business collects at its counter. The business cannot list "what
came in through Devolada", so it cannot reconcile Devolada against its
bank, nor a store's cash against what the store handed over.

The pilot first asked for Devolada's payments to appear under a user of
its system created for Devolada (`DEVOLADAPAGO`). Measured on the
provider's demo on 2026-10-01 (R1–R3 below), that route does not work:
Devolada cannot name the user a payment is recorded under, in every case
seen the user was the owner of the key, and the business may not be able
to get a key for a new user on its own. One user per store would multiply
the problem.

What does work (R4–R7): the payment method is chosen with every payment,
the business's system keeps it, and its list of paid invoices filters by
it. So this feature keeps one promise: **every payment Devolada records in
a business's system carries the payment method the business chose for
where the money came in — one for SPEI, one for each store — and a
reference that ties it back to Devolada.** The business filters its own
system by that method and downloads the list.

## The words

- **Payment method**: the label a business's system puts on a recorded
  payment to say how the money came in ("Efectivo", "Transferencia"). The
  business creates and names its methods in its own system. Devolada only
  reads the list and picks one. It is the core's word; the provider's own
  word for it belongs to the adapter.
- **Channel**: where a payment came in. SPEI (the payment link) is one
  channel. For this feature, each store of the network (spec 018) is a
  channel of its own.
- **The cash method**: the method Devolada uses today for every payment,
  found in the business's system the way it is found today. It stays the
  fallback.
- **Fallback**: recording a payment with the cash method because the
  method chosen for its channel cannot be used.
- **Reference**: a short free text the business's system keeps on a
  recorded payment.

## What was measured (2026-10-01)

On the provider's demo tenant, with payments of $1 recorded as "only
register" (no router touched). The details belong to the adapter
(constitution IX); they are recorded here because they decided the
feature, so nobody needs to run them again.

| # | Question | Answer |
| --- | --- | --- |
| R1 | Can Devolada name the user a payment is recorded under? | No. A payment accepts five values: payment method, action, date, amount and reference (a validation probe of 74 field names, and the provider's own documentation). Six real payments named another user — by id, by username and as an object, an administrator and a cashier, at invoice creation and at payment — and all six landed under the owner of the key. An invoice's user is read-only, at creation and on edit. |
| R2 | Can Devolada create users in the business's system? | No. The list of users is read-only. |
| R3 | Under which user does a payment appear? | The owner of the key that recorded it, in every case seen. A user with the cashier role cannot generate a key, and a new administrator did not see the option either. Not proven with a second key. |
| R4 | Can Devolada choose the payment method of each payment? | Yes. A payment recorded as a bank transfer, with the same key, kept that method. |
| R5 | Does the business's system filter paid invoices by payment method? | Yes, through the provider's documented list filter. It returned exactly that payment; the cash method returned the other 36. It combines with the filter by user. |
| R6 | Can Devolada create payment methods? | No. The list is read-only: the business creates them. |
| R7 | Does the system keep a reference on a payment? | Yes. Free text up to 200 characters, kept on the invoice and returned when it is read. It is not a filter of the list. |

## What must be measured before the plan

These facts decide *how* the promise is kept, and each belongs to the
adapter (constitution IX). The plan measures them on the demo tenant before
any code, never with a test write on the pilot's live billing.

| # | Question | What the answer decides |
| --- | --- | --- |
| M1 | What does the business's system answer when a payment names a method that does not exist, or one that was deleted? | How Devolada knows it must fall back (FR-007) without leaving the action waiting. |
| M2 | Does the system's own screen filter paid invoices by payment method, and does its download carry the method and the reference? | The outcome the business asked for (US1, SC-002). R5 measured the provider's list filter, not the screen the owner uses. |
| M3 | Does the system's screen show the reference on a paid invoice? | Whether the owner reads the folio and the clave de rastreo in its own system, or only in a download (US3). |

## Clarifications

### Session 2026-10-01

- Q: How should Devolada's payments be told apart in the business's system?
  → A: First, under a user the business created for Devolada
  (`DEVOLADAPAGO`). **Replaced the same day** by payment methods, after
  R1–R3: "Sí, reescribe la spec 019 con formas de pago".
- Q: Cash at stores — one payment method for all stores, one per store, or
  the same as SPEI? → A: **One per store.** Chosen against the
  recommendation of one for all stores. The creator accepts the cost: each
  business creates one method per store by hand in its own system, and
  one more each time a new store starts collecting for it (R6).
- Q: What does Devolada write in the reference? → A: The payment's DV-
  folio on every payment; for SPEI, also the clave de rastreo when
  Devolada knows it; for store cash, also the store's name.
- Q: When the chosen method no longer exists in the business's system
  (someone deleted it), does Devolada record the payment with the cash
  method so the action never waits, or keep it in the queue until the
  business fixes it? → A: **Record with the cash method**, mark the
  payment, and ask the business on the integration's screen to choose
  another method. The spec applies the same rule to a store with no
  method in a business that set up its stores (FR-007); a part the
  business never set up stays as today, unmarked (FR-003).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The business downloads what came in by SPEI (Priority: P1)

The owner creates a payment method in their own system, for example
"Devolada · Transferencia". In Devolada's Integraciones, on the
integration's screen, they choose it for SPEI payments. From then on, every
SPEI payment Devolada records carries that method. In their own system,
the owner filters the paid invoices by that method and a date range, and
downloads the list. Every SPEI payment Devolada recorded in that range is
in it, and nothing collected at the counter is.

**Why this priority**: It is the pilot's whole request. Without it, the
business cannot tell Devolada's payments from its counter's, and it cannot
reconcile either.

**Independent Test**: On the demo tenant, create a method in the system
and choose it for SPEI. Pay two links by SPEI, and collect one invoice at
the counter with the cash method. Filter the paid invoices by the chosen
method: the two links' invoices are there and the counter's is not.

**Acceptance Scenarios**:

1. **Given** a business that chose a method for SPEI, **When** a payer
   pays a link and Devolada records the payment, **Then** the business's
   system shows that method on the payment.
2. **Given** the same business, **When** a payment is recorded and leaves
   the service cut in place (a partial payment), **Then** it carries the
   method too.
3. **Given** a payment whose recording waited in the queue because the
   system was down, **When** a retry or "Ejecutar ahora" records it,
   **Then** it carries the method chosen at that moment.
4. **Given** payments recorded before the business chose a method, **When**
   the business filters by it, **Then** those payments are not in the
   list. Devolada never edits a payment already recorded (FR-005).
5. **Given** the business changes the method for SPEI, **When** the next
   payment is recorded, **Then** it carries the new method, and every
   earlier payment keeps the one it was recorded with.
6. **Given** the chosen method was deleted in the business's system,
   **When** the next SPEI payment is confirmed, **Then** Devolada records
   it with the cash method, the action runs without waiting, the payment
   is marked in Pagos, and the integration's screen asks for another
   method.

---

### User Story 2 - Each store's cash under its own method (Priority: P2)

For a business with the store channel on, the owner creates one method per
store in their own system, for example "Tienda Abarrotes Lupita", and
chooses it for that store in Integraciones. Every cash payment that store
records for the business is recorded with that store's method. The owner
filters by it to see one store's cash in their system, and checks it
against the hand-overs in Puntos de pago.

**Why this priority**: SPEI is the pilot's request and the larger flow.
The store channel is newer (spec 018), and splitting it by store is the
creator's decision on top of the SPEI split.

**Independent Test**: On the demo tenant, with two stores collecting for
the business and one method chosen for each, record one cash payment at
each store. Filter by each method: each invoice appears under its own
store's method, and neither appears under the SPEI method.

**Acceptance Scenarios**:

1. **Given** store A with its method chosen, **When** store A records a
   cash payment for the business, **Then** the business's system shows
   store A's method on it.
2. **Given** a business that chose methods for its stores, and a store
   that can collect for it with no method chosen yet, **When** that store
   records a cash payment, **Then** Devolada records it with the cash
   method, the action runs without waiting, the payment is marked in
   Pagos, and the integration's screen names that store as needing a
   method.
3. **Given** the business chooses the same method for two stores, **When**
   both record payments, **Then** both carry that method. Nothing forbids
   it.
4. **Given** a business whose store channel is off, **When** a member opens
   the integration's screen, **Then** no store is offered.

---

### User Story 3 - Each recorded payment says where it came from (Priority: P3)

The owner opens a paid invoice in their system and reads its reference:
Devolada's folio, and for SPEI the clave de rastreo, or for store cash the
store's name. With the folio they find the payment in Devolada's Pagos;
with the clave, the matching line in their bank statement.

**Why this priority**: It adds detail to the reconciliation. The list of
US1 and US2 works without it.

**Independent Test**: On the demo tenant, pay one link by SPEI and record
one cash payment at a store. Read both invoices: the SPEI one carries the
folio and the clave de rastreo; the store one carries the folio and the
store's name.

**Acceptance Scenarios**:

1. **Given** an SPEI payment whose clave de rastreo Devolada knows,
   **When** Devolada records it, **Then** its reference carries the folio
   and the clave de rastreo.
2. **Given** an SPEI payment whose clave de rastreo Devolada does not know,
   **When** Devolada records it, **Then** its reference carries the folio
   alone.
3. **Given** a store cash payment, **When** Devolada records it, **Then**
   its reference carries the folio and the store's name as it was at that
   moment.
4. **Given** a store whose name is long, **When** the reference would pass
   the system's limit, **Then** the store's name is shortened; the folio
   and the clave de rastreo are never cut.

---

### Edge Cases

- **A business that never chooses** sees no change: its payments are
  recorded with the cash method as today, with no mark and no warning
  (constitution VIII).
- **The business chooses its own cash method for SPEI.** Allowed. Its
  payments are recorded exactly as today, with no mark.
- **Someone at the counter uses one of Devolada's methods by hand.** Those
  payments appear in the list too, and Devolada cannot tell them apart.
  The screen asks the business to use these methods only for Devolada
  (FR-010).
- **A new store starts collecting for a business that set up its
  stores.** Its first payments fall back to the cash method and are
  marked; the screen names the store until the business chooses a method
  for it (US2 scenario 2).
- **A business sets up SPEI only.** Its store cash is recorded as today,
  with no mark (FR-003).
- **A store collects for two businesses.** Each business chooses its own
  method for that store in its own system. A method is never shared
  between businesses (FR-012).
- **The business's system cannot be reached when the screen opens.** The
  screen says so and keeps the saved choices; it does not offer an empty
  list (constitution VIII).
- **The business connects another account of its system** (a new key or a
  new address). The saved methods may not exist there: each payment that
  meets a missing method falls back and is marked, and the screen asks for
  new choices.
- **A payment that needs an invoice Devolada creates to carry it** (the
  customer owes only a carried balance). The payment carries the method
  and the reference like any other.
- **The amount in the list** is the amount Devolada records today: the debt
  the payment settled, without Devolada's fee. This feature does not
  change it.
- **A business in observation mode** records nothing in its system.
  Unchanged.
- **A business with no integration, or whose integration cannot list its
  methods or record a payment under one,** is not offered any of this
  (constitution IX). Its payments are recorded, if at all, as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the business's integration can list the business's
  payment methods and record a payment under a chosen one, the
  integration's screen MUST let the members who manage integrations choose
  one payment method for SPEI payments, from the methods that exist in the
  business's system.
- **FR-002**: When the store channel is on for the business, the same
  screen MUST let those members choose one payment method for each store
  that can collect for the business. Several stores MAY share a method.
- **FR-003**: SPEI and stores are set up apart. For each of the two, a
  business that has chosen nothing MUST see no change: those payments are
  recorded with the cash method, exactly as today, without a mark. A
  business may set up SPEI and leave its stores as today.
- **FR-004**: Every payment Devolada records in the business's system MUST
  carry the method chosen for its channel at the moment it is recorded.
  This holds for every way a payment gets there: the verdict, "Ejecutar
  ahora", a retry from the queue, a partial payment, and a payment carried
  by an invoice Devolada creates.
- **FR-005**: Devolada MUST NOT change, move or record again a payment
  already recorded in the business's system when the business changes a
  choice. Payments recorded before keep the method they were recorded
  with.
- **FR-006**: The screen MUST show the methods with the names the
  business's system gives them, read when the screen opens. When the
  system cannot be reached, the screen MUST say so and keep the saved
  choices.
- **FR-007**: Devolada MUST record a payment with the cash method, exactly
  as today, when the method chosen for its channel no longer exists in the
  business's system, or when the business has chosen methods for its
  stores but none for the store that recorded the payment. The action MUST
  NOT wait for the business to fix its choice.
- **FR-008**: A payment recorded under FR-007 MUST be marked in Pagos with
  the reason, and the integration's screen MUST name the choice that needs
  attention — the SPEI method, or which store — until the business chooses
  a method that exists. Payments of a part the business never set up are
  never marked (FR-003).
- **FR-009**: When the integration can attach a reference to a recorded
  payment, every payment Devolada records MUST carry one. It starts with
  the payment's folio. For SPEI it adds the clave de rastreo when Devolada
  knows it; for store cash it adds the store's name. It MUST NOT carry the
  payer's name, phone or account. It MUST fit the system's limit, and only
  the store's name may be shortened to fit.
- **FR-010**: The screen MUST tell the business how to set this up, in
  es-MX product copy: create the methods in its own system (one for SPEI,
  one per store), choose them here, and never use them for payments taken
  at the counter.
- **FR-011**: Devolada MUST NOT create, edit or delete payment methods in
  the business's system. The business owns them.
- **FR-012**: A business MUST see and choose only the methods of its own
  system. A store's method is a choice of each business: the same store
  has a different method in each business it collects for.
- **FR-013**: The choice MUST be offered because the business's
  integration has the capability, never because of which provider it is
  (constitution IX). The provider's name appears only in the copy of that
  integration's own screen.

### Key Entities

- **Method choice** (new, per business): the payment method chosen for
  SPEI, and one per store. Each is remembered by the identity the
  business's system gives the method, plus the name last read, so the
  screen can show the choice while the system is unreachable.
- **Recorded payment** (exists, spec 018 and before): a payment already
  carries its channel, its folio and, for SPEI, its clave de rastreo when
  known. It gains the mark of FR-008 and its reason.
- **Store** (exists, spec 018): a store of the network. Its name feeds the
  reference.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the moment a business chooses its SPEI method, 100% of
  the SPEI payments Devolada records carry it, except the ones that fall
  back, and each of those is marked. Checked on the pilot's first 30
  payments after the switch.
- **SC-002**: For any month after the switch, the number of paid invoices
  in the business's own download, filtered by the SPEI method, equals the
  number of SPEI payments Devolada's Pagos shows as recorded with it: zero
  missing, zero extra.
- **SC-003**: The owner gets that download in under 2 minutes with their
  system's own filter, without asking Devolada for anything.
- **SC-004**: Setting up SPEI and one store takes the business under 10
  minutes, creating the methods included, with nothing from Devolada's
  team.
- **SC-005**: No action waits because of a payment method: zero payments
  queued for a missing or unchosen method.
- **SC-006**: For any store with a method of its own and any period, the
  cash recorded under that method in the business's system equals the
  cash Devolada's Pagos shows for that store in the same period.

## Assumptions

- **The names are the business's.** Any method names work; nothing in
  Devolada depends on them.
- **One method per store is a cost the creator accepted.** Each business
  creates the methods by hand (R6), one more for every new store. The
  fallback (FR-007) keeps a new store's first payments safe meanwhile.
- **Every store of the network can collect for a business whose store
  channel is on** (spec 018), so the screen offers every such store,
  including one that has not collected yet.
- **The cash method stays the fallback**, found as today.
- **The reference is written once**, at recording. A store renamed later
  does not change payments already recorded (FR-005).
- **The download is the business's own tool.** This feature adds no
  download to Devolada's panel.
- **A business that issues electronic invoices from its system** may see
  its SPEI payments change from cash to the method it chose. That is the
  business's own setup, and arguably more correct; this feature does not
  measure it.
- **The amount and the date Devolada sends may be ignored in silence.**
  The provider's documentation says the system ignores both when the
  key's user lacks two rights. That is true today, before this feature,
  and unmeasured with a limited user. It deserves its own look; this
  feature does not change it.
- **The route of a user for Devolada is out of scope.** R1–R3 stay in this
  record. If a business one day wants its own user as well, that is a
  separate feature, and it needs a key for that user.
- **Out of scope**: moving or relabelling payments recorded before a
  choice; creating the business's methods for it; a download in Devolada's
  panel.

## Dependencies

- **Spec 018 (cash at stores)**: the stores, their names, the store
  channel switch and Puntos de pago. US2 needs it; US1 does not.
- **Open debt `core-reads-provider-directly`**: recording a payment is not
  a declared capability yet, and the action path calls the adapter
  directly. This feature MUST NOT add a second such call. Listing the
  business's payment methods, and recording a payment under one with a
  reference, are new capabilities; the plan declares them, and decides
  whether doing so pays part of that debt.
