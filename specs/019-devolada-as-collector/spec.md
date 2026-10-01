# Feature Specification: devolada-as-collector

**Feature Branch**: `claude/spec-019-devolada-as-collector`

**Created**: 2026-10-01

**Status**: Draft — two clarifications open (Q1 in FR-004, Q2 in FR-009),
and five facts about the provider to measure before the plan (M1–M5).

**Input**: User description, in the creator's words (2026-10-01): "Para el
piloto mi cliente quiere que registremos los pagos en wisphub a nombre de
devolada pago para que pueda descargar la lista de facturas pagadas a
través del link de pago." Then, after being offered two routes (a payment
method named after Devolada, or a user of its own in the business's
system): "Ya me registró. Usuario: DEVOLADAPAGO".

## Where this comes from

When a payment is confirmed, Devolada records it in the business's system
through the integration. Today it records every payment with the business's
own cash payment method, under whatever user the business's system
attributes an integration's writes to (M1). In the pilot's system,
Devolada's payments therefore look exactly like the cash the business
collects at its counter. The business cannot list "what came in through
Devolada" with its own tools, so it cannot reconcile Devolada against its
bank or its books.

The pilot's system filters its invoice list by payment method and by the
user who collected the payment (the provider's parameter listing,
2026-09-01, recorded in spec 014). On 2026-10-01 the creator was offered
both routes, and the pilot chose the user: it created a user for Devolada
in its own system, named `DEVOLADAPAGO`.

So this feature keeps one promise: **every payment Devolada records in a
business's system appears there under the user the business created for
Devolada**, so the business filters by that user and downloads the list
with its own system.

## The words

- **Collector**: the user of the business's system under whose name a
  payment appears there. It is the core's word; the provider's own word
  for it (cashier, "cobrado por") belongs to the adapter.
- **Devolada's user**: the collector a business created in its own system
  for Devolada. In the pilot, `DEVOLADAPAGO`. The name is the business's
  choice, and Devolada never depends on it.

## What must be measured before the plan

The session that wrote this spec could not reach the provider: the egress
policy blocks its hosts, as it did for `provider-address-per-isp` research
D7. These facts decide *how* the promise is kept, and every one of them
belongs to the adapter (constitution IX). The plan measures them on the
demo tenant before any code, never with a test write on the pilot's live
billing. M1 can also be answered by the pilot's first real payment after
it saves the new key, because that payment is the normal flow, not a test.

| # | Question | What the answer decides |
| --- | --- | --- |
| M1 | Does a payment recorded through the provider's API appear under the user who owns the key that recorded it? | If yes, the business keeps the promise by saving Devolada's user's key in Integraciones, and nothing in how Devolada records a payment changes. |
| M2 | If not, does the payment registration accept a field that names the collector? | If yes, Devolada names the collector on every payment. If neither M1 nor M2 holds, Q2 decides. |
| M3 | Does the system's filter by collector return those paid invoices, and does the system's own download carry them? | It is the outcome the business asked for (US1). |
| M4 | Can the provider say which user a key belongs to? | Whether the screen can show the collector's name (FR-005). |
| M5 | What does the provider answer when the key's user lacks the right to record a payment, create an invoice or edit a customer? | A new user may be created with fewer rights than the user it replaces. It decides the rights FR-006 lists and the words FR-008 shows. |

## Clarifications

### Session 2026-10-01

- Q: How should Devolada's payments be told apart in the business's system?
  → A: Under a user of the business's system created for Devolada
  (`DEVOLADAPAGO` in the pilot), not under a payment method. The pilot
  already created that user in its own system, so Devolada only uses it
  (FR-010).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The business downloads what came in through Devolada (Priority: P1)

The business owner opens their own system, filters the paid invoices by
Devolada's user and a date range, and downloads the list. Every payment
Devolada recorded in that range is in it, and nothing collected at the
counter is.

**Why this priority**: It is the whole request. Without it, the business
cannot tell Devolada's payments from its counter's, and it cannot
reconcile either.

**Independent Test**: On the demo tenant, with Devolada's user's key
saved, pay two links by SPEI and collect one invoice at the counter in the
system with another user. Filter the system's paid invoices by Devolada's
user: the two links' invoices are there, the counter's is not, and the
system's download carries the same two.

**Acceptance Scenarios**:

1. **Given** a business that saved Devolada's user's key, **When** a payer
   pays a link and Devolada records the payment, **Then** the business's
   system shows that payment under Devolada's user.
2. **Given** the same business, **When** an employee collects at the
   counter in the system with their own user, **Then** that payment does
   not appear under Devolada's user.
3. **Given** a payment that is recorded and leaves the service cut in
   place (a partial payment), **When** Devolada records it, **Then** it
   appears under Devolada's user too.
4. **Given** a payment whose recording waited in the queue because the
   system was down, **When** a retry records it, **Then** it appears under
   Devolada's user, with the date of the retry, as today.
5. **Given** payments recorded before the business switched, **When** the
   business filters by Devolada's user, **Then** those payments are not in
   the list. Devolada never edits a payment already recorded (FR-007).

---

### User Story 2 - The business switches to its own user and knows it worked (Priority: P2)

The owner creates the user in their system, gives it the rights Devolada
needs, and saves its key in Devolada's Integraciones. The screen tells
them under which user payments will appear and which rights that user
needs. If a right is missing, the first payment it affects says so
plainly, and the payer's money is never lost.

**Why this priority**: The switch itself already exists: a business can
replace its key today. This story makes the switch safe and clear. A user
created with fewer rights would leave payers without their reconnection,
and nobody would know why.

**Independent Test**: On the demo tenant, save the key of a user with every
right Devolada needs; the screen shows who payments are recorded under.
Then save the key of a user without the right to record payments and pay
a link: the payment is kept, its action waits in the queue, and the queue
names the missing right.

**Acceptance Scenarios**:

1. **Given** the integration's screen, **When** the owner reads the key
   section, **Then** it says in plain words that payments appear in their
   system under the user who owns the key, and recommends a user only for
   Devolada with the rights M5 lists.
2. **Given** the system can say who owns a key (M4), **When** the owner
   saves a key, **Then** the screen shows the name payments are recorded
   under (for the pilot, `DEVOLADAPAGO`).
3. **Given** the new user lacks the right to record payments, **When** the
   first payment arrives, **Then** the payment is kept, its action waits
   in the queue, and the queue says the user lacks a right and where to
   fix it, instead of only saying the key does not work.
4. **Given** a payment still waiting in the queue under the old key,
   **When** the owner saves the new key, **Then** the next retry records it
   with the new key, under Devolada's user.

---

### Edge Cases

- **A business that never switches** sees no change: its payments are
  recorded as today (constitution VIII).
- **A business that switches back** to a person's key: from then on its
  payments appear under that person again, and the screen says so (FR-005).
- **Someone at the business collects by hand with Devolada's user**: those
  payments appear in the list too, and Devolada cannot tell them apart.
  The screen asks the business never to do this (FR-006).
- **A payment that needs an invoice Devolada creates to carry it** (the
  customer owes only a carried balance): the list holds one paid invoice
  for that payment, under Devolada's user, like any other.
- **The amount in the list** is the amount Devolada records today: the
  debt the payment settled, without Devolada's fee. It can differ from what
  reached the bank by that fee or by an overpayment. This feature does not
  change it.
- **A business in observation mode** records nothing in its system, so
  nothing appears under any user. Unchanged.
- **A business with no integration**, or whose integration cannot record
  payments, is not offered any of this (constitution IX).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Once a business has set up Devolada's user, every payment
  Devolada records in that business's system MUST appear there under
  Devolada's user. This holds for every way a payment reaches the system:
  the verdict, "Ejecutar ahora", the queue's retries, and a partial
  payment that leaves the service cut in place.
- **FR-002**: The setup MUST be something the business does alone, in its
  own system and in Devolada's Integraciones, with no change by Devolada's
  team: no deploy, no setting only the platform operator can touch.
- **FR-003**: A business that has not set up Devolada's user MUST see no
  change: its payments are recorded exactly as today.
- **FR-004**: Cash collected at a store (spec 018) MUST be recorded
  [NEEDS CLARIFICATION Q1: under Devolada's user like every other payment,
  with or without a payment method of its own that lets the business split
  store cash from SPEI in the same list?]
- **FR-005**: The integration's screen MUST say under which user payments
  appear in the business's system: the user's name when the system can
  tell (M4), and otherwise "the user who owns the saved key".
- **FR-006**: The integration's screen MUST tell the business how to set
  it up, in es-MX product copy: create a user only for Devolada, give it
  the rights Devolada needs (the list M5 measures), save that user's key
  here, and never collect by hand with that user.
- **FR-007**: Devolada MUST NOT change, move or record again a payment
  already recorded in the business's system when the business switches
  users. Payments recorded before the switch stay where they are.
- **FR-008**: When the business's system refuses to record a payment
  because the user lacks a right, the payment MUST be kept, its action
  MUST wait in the queue, and the queue MUST say that the user lacks a
  right and where to fix it. When the system does not tell a missing right
  from a refused key (M5), the message MUST name both causes.
- **FR-009**: If the measurements show the business's system keeps the
  collector neither from the key (M1) nor from a field Devolada can send
  (M2), Devolada MUST [NEEDS CLARIFICATION Q2: record its payments with a
  payment method named after Devolada, created by the business, so the
  business filters by payment method instead; or stop and bring the
  findings back to the creator before building anything?]
- **FR-010**: Devolada MUST NOT create, edit or delete users in the
  business's system. The business owns its users.

### Key Entities

- **Collector**: the user of the business's system under whose name a
  payment appears there. Devolada stores nothing new for it: under M1 it
  follows from the key the business saves.
- **Integration key** (exists, spec 007): the credential the business saves
  in Integraciones. Under M1 it also decides the collector, so replacing it
  is how a business switches.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the moment a business saves Devolada's user's key, 100%
  of the payments Devolada records in its system appear under that user,
  checked on the pilot's first 30 payments after the switch.
- **SC-002**: For any month after the switch, the number of paid invoices
  in the business's own download, filtered by Devolada's user, equals the
  number of payments Devolada's Pagos shows as recorded in the business's
  system for that month: zero missing, zero extra.
- **SC-003**: The business owner gets that download in under 2 minutes
  with their system's own filter, without asking Devolada for anything.
- **SC-004**: The switch takes the business under 10 minutes, and needs
  nothing from Devolada's team.
- **SC-005**: No payer is left without their reconnection because of the
  switch going unnoticed: a missing right shows in the queue on the first
  payment it affects, with words that lead to the fix.

## Assumptions

- **The pilot's user is `DEVOLADAPAGO`.** Any name works; nothing in
  Devolada depends on it.
- **One Devolada user per business.** Every payment Devolada records for a
  business shares it, whatever channel it came from, unless Q1 splits
  store cash with a payment method.
- **The download is the business's own tool.** This feature adds no
  download to Devolada's panel. A list in Devolada's panel would be a
  separate feature, if the business wants one.
- **The payment method stays as today** (the business's cash method),
  unless Q1 or Q2 change it. Recording an SPEI payment with the cash
  method may matter to a business that issues electronic invoices from
  its system. That is not measured, it is out of scope, and it deserves
  its own look.
- **The demo tenant can hold a second user.** The measurements M1–M5 need
  two users with different rights in the same tenant.
- **Out of scope**: moving or relabelling payments recorded before the
  switch; creating the business's user for it; a download in Devolada's
  panel.
