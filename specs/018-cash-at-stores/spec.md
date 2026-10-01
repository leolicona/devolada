# Feature Specification: Cash at Stores

**Feature Branch**: `018-cash-at-stores`

**Created**: 2026-09-30

**Status**: Draft — clarified 2026-09-30 in three rounds with the creator
(where the channel is switched on, the money, the counter) and on
2026-10-01 (a paused credit, a mistaken payment). One decision is deferred
on purpose: which businesses each store collects for (FR-006).

**Input**: User description: "Si quisiera asumir el puente con api.devoladapago.com para este scope: 1. Las tiendas las administra (alta, edición, baja) devolada desde el perfil /operator. 2. El ISP lo activa desdes integraciones. 3. Los pagos en efectivo se lista con los pagos SPEI. 4. El frontend red.devoladapago.com es el mismo" — then, after three rounds of questions: "Si, un ISP quiere probarlo."

## Context

Today a customer can pay a business on Devolada in one way: a SPEI transfer
to the business's own CLABE, validated against Banxico. A customer who pays
in cash has nowhere to go. One ISP wants to try a second way: the customer
pays in cash at a neighbourhood store, the store records it on its phone,
and the customer's service comes back as it does after a SPEI payment.

This feature adds that channel for a pilot: **one business, one or a few
stores, run by Devolada.**

- **Devolada runs the network.** The platform operator creates, edits and
  suspends stores from `/operador`, and turns the channel on for a
  business. The business does not recruit or manage stores.
- **The shopkeeper has an app of their own**, at `red.devoladapago.com`. It
  is designed for a phone. It is neither the business's panel nor the
  payer's page.
- **A cash payment is a payment.** It is recorded as the same kind of
  payment a validated SPEI transfer is. It appears in the business's Pagos
  list beside SPEI payments, and it runs the same actions in the business's
  system, such as registering the payment and reconnecting the customer.
- **The cash stays in the store until it is handed over.** The store hands
  it to the business in person. The business confirms or disputes each
  hand-over on a new page of its panel, **Puntos de pago**. The money never
  touches Devolada.

### What a cash payment is, and is not

A SPEI payment is proven by Banxico. A cash payment is proven by nobody but
the shopkeeper: it is true because the store says the money is in its
drawer. This feature does not pretend otherwise. What protects the business
is:

- the hand-over, confirmed or disputed by the business;
- the cash book, which shows at all times how much of the business's money
  each store holds;
- the operator's power to suspend a store at once.

The pilot runs **without a cap** on the cash a store may hold (creator,
2026-09-30). That is a shortcut, registered as debt (see Assumptions).

### Core and adapter (constitution IX)

The store channel is **core**. It serves any business whose integration can
answer three things, by capability, never by provider name:

1. find a customer by a typed text;
2. read what one customer owes now;
3. run the actions a confirmed payment triggers (register it, reconnect).

Today only the WispHub adapter answers all three, so the pilot business is a
WispHub ISP. The counter never builds a provider's request, reads a
provider's field names or carries a WispHub rule. The actions run through
the same path a confirmed SPEI payment uses. Registering a payment and
reconnecting are not declared capabilities yet: the action path still calls
the WispHub adapter directly (open debt `core-reads-provider-directly`). This
feature must not add a second such call (see Dependencies).

### What this asks of the constitution

Three parts of the constitution do not describe this feature yet. The plan
proposes the amendment; this spec only names the gaps:

- **Purpose**: "collect payments by SPEI and validates every transfer". A
  cash payment is not a transfer and is confirmed by a store, not Banxico.
- **Principle V**: every actor today is a member of one business. A store is
  a new kind of user. It works for businesses it does not belong to, sees a
  minimum of their customers' data, and only for the businesses the
  operator connected it to.
- **Technology Stack**: a fifth Worker (the store app), where the table and
  the quality gates count four.

### What this replaces

A store network was built before the pivot and left with it. It is kept
read-only in the `devolada-red` repository (apps `tienda` and `admin`, the
`US-C`, `US-K` and `US-E` stories). Nothing of it runs in production, and no
store ever took real money with it. Its screens, rules and measured WispHub
facts are the starting point of this feature. Its code is not: it was built
for a store belonging to one ISP, on tables the pivot renamed.

Everything this feature keeps from it is specified again here (constitution
I):

- charge only what is owed, read fresh (`debt-truth`);
- the folio and the WhatsApp receipt;
- a phone captured once;
- the hand-over that the store declares and the business confirms or
  disputes;
- the append-only cash book.

## Clarifications

### Session 2026-09-30

- Q: Is the store network a product of its own, or a channel of Devolada?
  → A: A channel of Devolada. It reaches the business's system through
  `api.devoladapago.com`, and cash payments are listed with SPEI payments.
  Rejected: an independent product with its own backend (the ISP would keep
  two accounts, paste its key twice, and see its cash payments nowhere in
  Devolada).
- Q: Where does a business turn the channel on? → A: In the pilot, it does
  not: the platform operator turns it on for the business in `/operador` →
  Negocios. The business's panel gets no new setting. Rejected: a card in
  Integraciones, and a "Formas de pago" section in Configuración. Both are
  deferred until a second business asks.
- Q: Who creates and manages stores? → A: Devolada, from a Tiendas section
  in `/operador`: create, edit, suspend. Rejected: each business managing
  its own stores. That model keeps each store tied to one business, and
  every future business would have to recruit its own stores.
- Q: Which customers are told they can pay in cash? → A: None, through the
  link. The payer's link page does not change. Customers learn about the
  store from a sticker in the store, or from the business. Rejected:
  offering it on every link, on links of chosen zones, or on chosen links.
- Q: How does the shopkeeper find what to collect? → A: By searching name,
  surname, phone number or usuario, as the Links page searches. Refinement
  proposed in the same session, not objected to: the app shows nothing
  before the shopkeeper types. There is no list to scroll, so a store
  cannot browse a business's customers. Rejected: scanning the QR of the
  payer's link (the payer would need a phone and their link at hand).
- Q: When is the customer reconnected? → A: At once, when the store records
  the payment, through the same actions a confirmed SPEI payment runs.
  Rejected: waiting until the cash reaches the business (the customer could
  wait days, which defeats paying at the corner store).
- Q: How does the cash reach the business? → A: In person, as in the old
  store network. The store declares "entregué $X" in its app. The business
  confirms or disputes it on a new page of its panel, which also shows how
  much cash each store holds. Rejected: the store transferring by SPEI,
  validated by Devolada (deferred), and the operator recording hand-overs
  by hand.
- Q: Who pays and who earns? → A: The payer pays a service fee on top of
  what they pay toward their debt. The store keeps all of it as its
  commission. Devolada charges the business its usual fee per confirmed
  payment, from its prepaid credit, as for SPEI. Rejected: the business
  paying the store's commission out of the cash, and the old split of the
  fee between store and platform (two money books).
- Q: Who sets the service fee? → A: The operator, as one value for the
  whole network, in `/operador` → Reglas. Rejected: per store, and per
  business.
- Q: Is there a cap on the cash a store may hold? → A: Not in the pilot.
  The cost was named and accepted: the business's exposure has no ceiling.
  Only the Puntos de pago page bounds it, by showing it. Registered as
  debt, to be paid before a second store or a second business joins.
- Q: What amount may the shopkeeper collect? → A: The whole debt, or a
  smaller amount the shopkeeper types. A smaller amount is a short payment
  under the business's own reconciliation policy, and reconnects only as
  the business's rule for short payments says. Rejected: the whole debt
  only.
- Q: How does the payer get a receipt? → A: By WhatsApp, from the store's
  phone, with the folio. If the business's system has no phone for the
  customer, the shopkeeper types it once. Rejected: the folio on screen
  only; automatic SMS (a cost per message and a new provider).

### Session 2026-10-01

- Q: Does every active store collect for every business with the channel
  on, or does the operator connect each store to specific businesses? → A:
  Deferred. The pilot has one or two stores and one business, so the answer
  changes nothing yet. To keep the question open rather than decided by
  accident, the channel is on for at most one business at a time until it
  is answered (FR-006). With one business, every active store collects for
  it.
- Q: The business's prepaid credit is paused (below the negative cap). What
  happens to a cash collection? → A: It proceeds. The payment is recorded,
  its actions run, and the fee is debited even though the credit goes
  further below the cap. The payer and the cash are already at the
  counter, and a paused credit never punishes the payer. Rejected: holding
  the reconnection until the business tops up, as a SPEI proof waits (the
  customer would pay and stay without service); refusing the collection
  (the customer leaves without paying).
- Q: How is a payment recorded by mistake (wrong customer or amount)
  corrected? → A: There is no undo in the pilot, and the payment stays in
  the record:
  - the business corrects its own system by hand;
  - the operator records a correction in the store's cash book, with an
    amount and a reason, linked to the payment;
  - the operator returns Devolada's fee through the existing credit
    adjustment, when it applies.

  Nothing is deleted, and who corrected what, and why, stays visible.
  Rejected: an undo by the shopkeeper for a few minutes. The actions run at
  once, so it would almost never apply, and it adds a state to the payment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Collect cash at the counter (Priority: P1)

A customer walks into the store and says they want to pay their internet.
The shopkeeper opens the app and types part of the customer's name. The
results show just enough to tell people apart. The shopkeeper picks the
customer. The app shows what they owe, the service fee and the total. The
customer hands over the cash, and the shopkeeper confirms. The app shows a
folio, then says the service is back on. The shopkeeper taps WhatsApp and
the receipt goes to the customer's phone.

**Why this priority**: this is the feature. Everything else exists so this
can happen, and it is the moment the customer feels the value: paid in cash
around the corner, service back in minutes.

**Independent Test**: with one active store connected to a business that has
the channel on and a working integration, sign in as the shopkeeper. Search
a customer with an open invoice, collect the whole debt, and check four
things. The payment is recorded as confirmed with a folio. The business's
system receives the payment and reconnects the customer. The receipt opens
in WhatsApp. A second search shows the customer owes nothing.

**Acceptance Scenarios**:

1. **Given** a signed-in shopkeeper, **When** they open the app, **Then**
   they see a search box and no list of customers.
2. **Given** fewer than three characters typed, **When** the shopkeeper
   pauses, **Then** nothing is searched and the app says at least three
   characters are needed.
3. **Given** three or more characters that match customers by name, surname,
   phone number or usuario, **When** the search answers, **Then** each result
   shows the customer's name, usuario and zone, and nothing else about them.
4. **Given** a result is chosen, **When** the app reads the debt, **Then** it
   shows what the customer owes now (open invoices plus any carried balance),
   the service fee, and the total to collect.
5. **Given** the customer owes nothing, **When** the result is chosen,
   **Then** the app says *Sin adeudo* and offers no collection.
6. **Given** the shopkeeper confirms the whole debt, **When** the payment is
   recorded, **Then** it is confirmed at once with a unique folio, and the
   business's actions for a complete payment run: register it, and
   reconnect the customer.
7. **Given** the shopkeeper types a smaller amount than the debt, **When** they
   confirm, **Then** the payment is recorded as short. The app shows what
   remains owed. Reconnection follows the business's rule for short
   payments, and the app says whether it will happen.
8. **Given** the shopkeeper types more than the debt, **When** they try to
   confirm, **Then** the app refuses and says the most they can collect.
9. **Given** the debt changed between choosing the customer and confirming
   (for example, a SPEI payment arrived), **When** the shopkeeper confirms,
   **Then** nothing is recorded yet, the app shows the new amount and asks
   again. If nothing is owed any more, it says *Sin adeudo*.
10. **Given** a recorded payment, **When** the business's system is
    unreachable, **Then** the payment stays recorded. The action waits and
    retries, and the app shows that the reconnection is queued, never that
    the payment failed.
11. **Given** a recorded payment, **When** the shopkeeper taps WhatsApp,
    **Then** WhatsApp opens on the store's phone with a message addressed to
    the customer. The message carries the folio, the business's name, the
    amount paid, the service fee, the date and time, and what remains owed
    if any.
12. **Given** the business's system has no phone for the customer, **When**
    the shopkeeper taps WhatsApp, **Then** they are asked for the number
    once. Their next cash payment uses it without asking.
13. **Given** a lost signal after the shopkeeper confirmed, **When** they
    confirm again, **Then** no second payment is recorded, and the app shows
    the first one.

---

### User Story 2 - The operator sets up a store and connects a business (Priority: P1)

The platform operator opens `/operador` and goes to a new Tiendas tab. They
create a store with its name, its address and the shopkeeper's name and
mobile phone. They send the invitation by WhatsApp. In Negocios, they open
the pilot ISP and switch on *Efectivo en tiendas*. In Reglas, they set the
network's service fee.

**Why this priority**: without a store and a connected business, the counter
has nothing to do. It is the operator's whole job in the pilot.

**Independent Test**: as a platform operator, create a store, check that it
is listed as *Invitada* with a working invitation, switch the channel on for
a business with a capable integration, and set the fee. Then check three
things. A business without such an integration cannot be switched on. A
non-operator cannot reach any of it. Suspending the store ends the
shopkeeper's access on their next action.

**Acceptance Scenarios**:

1. **Given** the operator panel, **When** the operator opens Tiendas, **Then**
   every store is listed with its name, address, the shopkeeper's phone, its
   status (*Invitada*, *Activa*, *Suspendida*, each as icon + text) and the
   businesses it collects for.
2. **Given** a new store's name, address, shopkeeper name and mobile phone,
   **When** the operator creates it, **Then** it is listed as *Invitada*, and
   the operator can copy its invitation or open WhatsApp with it.
3. **Given** a phone already used by another store, **When** the operator
   creates or edits a store with it, **Then** the operator is told and
   nothing is saved.
4. **Given** an invitation not yet accepted, **When** the operator re-sends
   it, **Then** a new invitation is issued and the previous one stops
   working.
5. **Given** an active store, **When** the operator suspends it, **Then** the
   shopkeeper's next action is refused with a screen that says the store is
   suspended. The store's history and the cash it holds stay visible to the
   operator and to the businesses. The operator can reactivate it.
6. **Given** a business whose integration can search customers, read a
   debt and run payment actions, **When** the operator switches *Efectivo en
   tiendas* on, **Then** the business's customers can be collected at the
   stores connected to it.
7. **Given** a business without such an integration, **When** the operator
   looks at the switch, **Then** it cannot be turned on, and the panel says
   why.
8. **Given** the Reglas tab, **When** the operator sets the network's service
   fee, **Then** every collection after that moment charges the new fee, and
   the change keeps its author and date.
9. **Given** a user who is not a platform operator, **When** they reach any of
   these screens or actions, **Then** they are refused.
10. **Given** the channel is on for one business, **When** the operator tries
    to switch it on for a second business, **Then** the switch refuses and
    says the question of which stores serve which business must be decided
    first (FR-006).
11. **Given** a payment a store recorded by mistake, **When** the operator
    opens that store's cash book for the business and records a correction
    with an amount and a reason, **Then** four things hold. The store's
    balance for that business changes by that amount on both screens. The
    payment's detail shows the correction, its reason, who made it and
    when. The payment itself stays in the record. Nothing is deleted.

---

### User Story 3 - The shopkeeper gets in and stays in (Priority: P1)

The shopkeeper receives the invitation on WhatsApp and opens it. They set a
password and a recovery email, and verify the email with a code. From then
on they sign in with their mobile phone and password, or with their
fingerprint or face once they enable it. They stay signed in on their phone
for weeks.

**Why this priority**: a store that cannot get in cannot collect. The
counter must not ask a shopkeeper to sign in again every day.

**Independent Test**: accept an invitation. Sign out, then sign in with phone
and password. Enable fingerprint or face and sign in with it. Recover
access with a code sent to the recovery email. Then check that a suspended
store's session ends on its next action, and that the store's account
cannot open the business panel or the operator panel.

**Acceptance Scenarios**:

1. **Given** a valid invitation, **When** the shopkeeper opens it, **Then**
   they set a password and a recovery email, verify the email with a code,
   and land in the app signed in.
2. **Given** an invitation that was used, replaced or is older than seven
   days, **When** it is opened, **Then** it says it no longer works and to
   ask Devolada for a new one.
3. **Given** a shopkeeper, **When** they sign in with their mobile phone and
   password, **Then** they are in, and stay signed in on that device through
   at least 30 days of regular use.
4. **Given** a signed-in shopkeeper, **When** they enable *huella o rostro*,
   **Then** they can sign in with it from then on, with no password.
5. **Given** a forgotten password, **When** the shopkeeper asks for help,
   **Then** a code goes to their recovery email and lets them set a new one.
6. **Given** a store's account, **When** it tries the business panel or the
   operator panel, **Then** it is refused. **Given** a business member's
   account, **When** it tries the store app, **Then** it is refused.

---

### User Story 4 - The business sees cash payments with its SPEI payments (Priority: P2)

The ISP's staff open Pagos, as every morning. Yesterday's cash payments are
there, among the SPEI payments, each marked *Efectivo* with the store's
name. They filter by channel to see only cash. They open one and see the
store, the folio, the amount, the fee and whether the customer was
reconnected. Their prepaid credit shows the usual fee for each one.

**Why this priority**: the business must see what was collected in its name,
in the place it already looks. It comes after the counter because the
counter works, and the customer is served, without it.

**Independent Test**: record a whole and a short cash payment for a business.
Open Pagos as an operator member and check four things. Both appear among
SPEI payments, marked with channel and store. The channel filter works.
The detail shows store, folio, amount, fee, class and action outcome. The
business's credit shows one fee per payment.

**Acceptance Scenarios**:

1. **Given** cash payments exist, **When** a member opens Pagos, **Then** they
   appear in the same list as SPEI payments, in time order, each marked
   *Efectivo · <store>* with an icon and text.
2. **Given** the list, **When** a member filters by channel, **Then** they can
   see only cash payments, only SPEI payments, or both.
3. **Given** a cash payment, **When** a member opens it, **Then** they see the
   store, the folio, the amount applied to the debt, the service fee, the
   class (exact or short), and the action's outcome. The payment can be
   retried or run now exactly as a SPEI payment can.
4. **Given** a confirmed cash payment, **When** the business's credit is read,
   **Then** it shows one fee for that payment, the same fee a confirmed SPEI
   payment costs, and never a second one for the same payment.

---

### User Story 5 - Handing over the cash (Priority: P2)

At the end of the week the shopkeeper opens *Mi caja*. It shows how much of
the ISP's money they hold, and what they earned in fees. They take the
cash to the ISP and declare in the app "entregué $4,350". At the ISP,
someone opens Puntos de pago, sees the store holding $4,350 with a
hand-over waiting, counts the cash, and confirms. The store's balance
drops to zero on both screens. If the cash came short, they dispute the
hand-over with a note instead, and both sides see the same history.

**Why this priority**: until the hand-over, the money is in the store's
drawer. The business must be able to see that and close it. It is P2
because the first week of the pilot can collect before the first
hand-over.

**Independent Test**: record cash payments at a store for a business, then
declare a hand-over from the store app. Confirm it from Puntos de pago and
check that both screens show the same new balance. Declare another and
dispute it, and check that the balance does not move and that both sides
see the dispute and its note.

**Acceptance Scenarios**:

1. **Given** cash payments at a store, **When** the shopkeeper opens *Mi
   caja*, **Then** they see, for each business they collect for, the cash they
   hold for it and the fees they earned since the last confirmed
   hand-over. Every number opens into the movements behind it.
2. **Given** cash held, **When** the shopkeeper declares a hand-over for an
   amount no larger than what they hold, **Then** it is recorded as
   *Pendiente*, and the balance does not move until the business confirms.
3. **Given** a pending hand-over for a business, **When** the shopkeeper tries
   to declare another for the same business, **Then** they are told to wait
   for the pending one.
4. **Given** a business with the channel on, or with cash still held by any
   store, **When** a member opens Puntos de pago, **Then** they see each store
   holding its cash: the amount held, the last confirmed hand-over and any
   pending one.
5. **Given** a pending hand-over, **When** a member who can operate payments
   confirms it, **Then** the store's balance for that business drops by that
   amount on both screens, and the hand-over shows who confirmed and when.
6. **Given** a pending hand-over, **When** such a member disputes it with a
   note of 3 to 280 characters, **Then** the balance does not move, and both
   the store and the business see the dispute and the note.
7. **Given** a viewer member, **When** they open Puntos de pago, **Then** they
   see everything and can confirm or dispute nothing.
8. **Given** a store that holds cash for two businesses (the channel moved
   from one business to the other while the first still had cash there),
   **When** either business opens Puntos de pago, **Then** it sees only its
   own cash at that store, never the other business's.

---

### Edge Cases

- **The integration is down during the search or the debt read.** The app
  says it cannot reach the business's system right now and offers no
  collection. It never shows an amount it did not just read, and never
  reads "no results" as "nobody owes".
- **The integration goes down after the payment is recorded.** The payment
  stays confirmed. Its action waits and retries on the existing schedule,
  and the shopkeeper and the business see it as queued, then done or
  failed.
- **The business has observation mode on.** The payment is recorded and no
  action runs, exactly as for SPEI. The app tells the shopkeeper the
  business will reconnect the customer by hand.
- **A short payment below the business's threshold.** It is recorded and
  registered, and the customer is not reconnected. The app says so before
  and after confirming, so the shopkeeper can tell the customer.
- **The channel is switched off while stores hold the business's cash.** No
  new collections for that business. Hand-overs can still be declared,
  confirmed and disputed until nothing is held, and Puntos de pago stays
  visible while any cash is held.
- **The store is suspended while holding cash.** It cannot collect, and its
  shopkeeper cannot sign in. Its balance stays on Puntos de pago. Recovering
  the cash is outside the software (see Assumptions).
- **Two shopkeepers of the same store?** Not in the pilot: one store has one
  shopkeeper account (see Assumptions).
- **The same customer pays in cash and by SPEI on the same day.** Each
  collection reads the debt fresh right before it is recorded
  (scenario 1.9), so the second one finds what is left, or nothing. A SPEI
  transfer made after the debt was paid in cash takes the SPEI path's
  existing course for a payment with nothing to apply to.
- **The customer has a phone in the business's system that is wrong.** The
  shopkeeper can type another number for this receipt. It is remembered as
  this channel's number for that customer. The business's system is never
  written.
- **The service fee changes while a shopkeeper is at the confirm screen.** The
  fee recorded is the one the payer was shown. If it changed, the app shows
  the new total and asks again, as for a changed debt.
- **The business's credit is paused** (below the negative cap). The
  collection proceeds and the fee is debited anyway (FR-029). The business
  gets the same notices it gets today when its credit crosses the cap.
- **A shopkeeper records the wrong customer or amount.** There is no undo.
  The business corrects its own system by hand. The operator records a
  correction in the store's cash book and, when it applies, returns the fee
  (FR-030).

## Requirements *(mandatory)*

### Functional Requirements

**The operator (`/operador`)**

- **FR-001**: The operator panel MUST gain a **Tiendas** tab that lists every
  store with its name, address, the shopkeeper's name and phone, its status
  (*Invitada*, *Activa*, *Suspendida*, each as icon + text) and the
  businesses it collects for. Only platform operators may reach it.
- **FR-002**: The operator MUST be able to create a store from a name, a
  free-text address, and the shopkeeper's name and mobile phone. A phone
  MUST belong to one store only. Creating a store MUST issue a single-use
  invitation, valid seven days, that the operator can copy or open in
  WhatsApp.
- **FR-003**: The operator MUST be able to edit a store's name, address and
  shopkeeper details. Changing the phone MUST change the shopkeeper's
  sign-in phone, and MUST be refused if another store uses it.
- **FR-004**: The operator MUST be able to re-send an invitation that has not
  been accepted. The new one replaces the old, which MUST stop working.
- **FR-005**: Removing a store MUST be a suspension, never a deletion. A
  suspended store MUST lose access on its next action. It keeps its
  payments, its cash book and its pending hand-overs, and can be
  reactivated.
- **FR-006**: In this feature, every active store MUST collect for the
  business that has the channel on. The channel MUST be on for at most one
  business at a time. Switching it on for a second business MUST be
  refused, saying that which stores serve which business must be decided
  first. That decision is deferred by the creator (2026-10-01): every store
  for every business, or the operator connecting each store to specific
  businesses. It MUST be taken, with its effect on what a store may
  search, before the guard is lifted.
- **FR-007**: The operator MUST be able to switch **Efectivo en tiendas** on
  and off for each business, from that business's entry in Negocios. The
  switch MUST refuse to turn on for a business whose integration cannot
  search customers, read one customer's debt and run payment actions, and
  MUST say why.
- **FR-008**: The operator MUST set the network's **service fee** in Reglas:
  one amount in cents for every store and every business. It MUST follow
  the platform rules' existing record, keeping author and date. A change
  applies only to collections confirmed after it.

**The shopkeeper's access**

- **FR-009**: A shopkeeper MUST get in through the invitation. They set a
  password and a recovery email, and verify the email with a code. Their
  mobile phone is their sign-in name.
- **FR-010**: A shopkeeper MUST be able to sign in with phone and password,
  and MAY enable the device's fingerprint or face (*huella o rostro*) and
  sign in with it. A shopkeeper MUST stay signed in on their device through
  at least 30 days of regular use.
- **FR-011**: A shopkeeper MUST be able to recover access with a code sent to
  the recovery email. Copy MUST say *código*, never "token" or "OTP", and
  MUST never send a link.
- **FR-012**: The store app MUST live at its own address,
  `red.devoladapago.com`, apart from the business panel and the payer's
  page. It MUST be usable on a 360 px phone and installable on the home
  screen.
- **FR-013**: A store's account MUST NOT open the business panel or the
  operator panel. A business member's account MUST NOT open the store app.
- **FR-014**: The store's status MUST be checked on every action, so a
  suspension takes effect immediately, even mid-session.

**The counter**

- **FR-015**: The app MUST open on the search for the one business the store
  collects for, with that business's name in view. A choice between
  businesses arrives with the FR-006 decision, not in this feature.
- **FR-016**: The app MUST show no customers until the shopkeeper types. It
  MUST search only from three characters, after a short pause, and match
  name, surname, phone number and usuario, as the Links search does. Results
  MUST be capped. When more match, the app MUST ask for a more specific
  search rather than page through them.
- **FR-017**: Each result MUST show only the customer's name, usuario and
  zone (when the integration has one). It MUST NOT show address, phone,
  email, plan, payment history, or any customer of a business the store
  does not collect for.
- **FR-018**: Choosing a result MUST read what the customer owes at that
  moment: open invoices plus any carried balance (`debt-truth` D7). The app
  MUST show three amounts: the debt, the service fee and the total. When
  nothing is owed, it MUST say *Sin adeudo* and offer no collection.
- **FR-019**: The shopkeeper MUST be able to collect the whole debt, or type
  any smaller amount above zero. The app MUST refuse an amount above the
  debt.
- **FR-020**: The service fee MUST be added to every collection, whole or
  partial. It MUST be shown to the payer as part of the total before the
  shopkeeper confirms.
- **FR-021**: Right before recording, the debt and the fee MUST be read again.
  If either changed, nothing MUST be recorded: the app shows the new
  amounts and asks again. If nothing is owed, nothing MUST be recorded.
- **FR-022**: Confirming MUST record one payment for the business that is
  confirmed at once. It MUST carry:
  - the cash channel;
  - the store and the shopkeeper;
  - the amount applied to the debt;
  - the service fee;
  - a unique folio;
  - its class under the business's own reconciliation policy (exact, or
    short when less than the debt).
- **FR-023**: Confirming twice, retrying after a lost signal, or two taps
  MUST NOT record a second payment.
- **FR-024**: A cash payment MUST follow the same action path as a confirmed
  SPEI payment, whatever the business's integration configures for its
  class:
  - a complete payment registers and reconnects;
  - a short payment reconnects only at or above the business's threshold
    and floor;
  - observation mode holds every action;
  - a failure of the business's system never undoes the payment: the action
    waits and retries with a visible status.
- **FR-025**: The result screen MUST show the folio and the action's outcome
  as it changes, each outcome as icon + text: reconnected, queued (and
  retrying), not reconnected because the payment is short, held by
  observation mode, or failed. It MUST say what remains owed after a short
  payment.
- **FR-026**: The result screen MUST offer to send the receipt by WhatsApp
  from the shopkeeper's phone. The message MUST carry the folio, the
  business's name, the amount paid, the service fee, the date and time in
  the business's timezone, and what remains owed if any. Money MUST be
  formatted as es-MX pesos.
- **FR-027**: When the business's system has no phone for the customer, the
  app MUST ask for one when the shopkeeper taps WhatsApp. It MUST remember
  that number for this channel's next receipts to that customer. The
  business's system MUST never be written.
- **FR-028**: When the business's system cannot be reached during a search
  or a debt read, the app MUST say so and offer no collection. It MUST NOT
  offer to collect when the store is suspended, the business's channel is
  off, or the store does not collect for that business.
- **FR-029**: When the business's prepaid credit is paused (below the
  negative cap), a cash collection MUST proceed. The payment is recorded,
  its actions run, and the fee is debited even though the credit goes
  further below the cap. A paused credit MUST never hold a cash payment's
  actions or refuse a collection.
- **FR-030**: A recorded cash payment MUST NOT be undone or deleted, by the
  shopkeeper or anyone else. The operator MUST be able to open a store's
  cash book for a business and record a correction: an amount, a reason of
  3 to 280 characters, and the payment it refers to. The payment's detail
  MUST show the correction to the business and to the operator. Returning
  Devolada's fee for such a payment uses the existing credit adjustment.
  Correcting the business's own system is the business's job, by hand.

**The business**

- **FR-031**: Cash payments MUST appear in Pagos in the same list as SPEI
  payments, marked *Efectivo · <store>* with icon and text. The list MUST
  offer a channel filter: cash, SPEI, or both.
- **FR-032**: A cash payment's detail MUST show the store, the folio, the
  amount applied to the debt, the service fee, the class and the action's
  outcome. The business MUST be able to retry its action or run it now
  under the same roles and rules as a SPEI payment.
- **FR-033**: Every confirmed cash payment MUST debit the business's prepaid
  credit once, by the same fee a confirmed SPEI payment costs. It MUST
  never charge per attempt or per retry.
- **FR-034**: The business panel MUST gain a **Puntos de pago** page, shown
  while the channel is on or while any store holds the business's cash. For
  each store, it MUST show the cash held for this business, the last
  confirmed hand-over and any pending one.
- **FR-035**: A member who can operate payments MUST be able to confirm a
  pending hand-over, or dispute it with a note of 3 to 280 characters. A
  viewer MUST see the page and act on nothing. Confirming lowers the
  store's balance for this business by the declared amount. Disputing
  leaves the balance where it is.
- **FR-036**: The business panel MUST gain no setting for the channel in this
  feature. Only the operator switches it on and off (FR-007).

**The store's cash book**

- **FR-037**: The store app MUST show *Mi caja*: for each business the store
  collects for, the cash held for it (the amounts applied to debts, minus
  confirmed hand-overs) and the fees earned since the last confirmed
  hand-over. Every number MUST open into the movements behind it.
- **FR-038**: The shopkeeper MUST be able to declare a hand-over to one
  business for an amount above zero and no larger than what they hold for
  it. It stays *Pendiente* until the business confirms or disputes it. Only
  one hand-over per store and business may be pending at a time.
- **FR-039**: The cash book MUST be append-only. A collection, a confirmed
  hand-over and a correction each add a movement, and none is ever edited
  or removed. The store's screen and the business's screen MUST derive
  their amounts from the same movements and agree to the cent.
- **FR-040**: A store MUST be able to hold any amount of a business's cash in
  this feature (no cap), and the business MUST see that amount at all
  times (FR-034).

**Everyone else**

- **FR-041**: The payer's link page MUST NOT change. It MUST NOT announce
  stores or cash payment.
- **FR-042**: No business MUST ever see another business's payments,
  collections or cash at a store, even when both use the same store.

### Key Entities

- **Store**: a place that collects cash for businesses. It has a name, an
  address, a status (invited, active, suspended) and one shopkeeper
  account. It is created and managed by the platform operator and never
  deleted.
- **Shopkeeper**: the person who signs in to the store app. The mobile phone
  is their sign-in name, and they have a verified recovery email and
  optionally a passkey. A shopkeeper is not a member of any business.
- **Store invitation**: a single-use, seven-day way in for a store's
  shopkeeper. It is replaced when re-sent.
- **Store connection**: the relation that says a store collects for a
  business. In this feature, it is every active store for the one business
  with the channel on (FR-006).
- **Channel switch**: per business, whether its customers can be collected at
  stores. Set by the operator only.
- **Cash payment**: a payment of the business, with the cash channel, the
  store, the shopkeeper, the amount applied to the debt, the service fee, a
  folio, a class and an action outcome. It lives in the same record and
  list as SPEI payments.
- **Cash book movement**: an append-only entry between one store and one
  business. It is a collection (adds to the amount held), a confirmed
  hand-over (subtracts), or an operator's correction (either sign, with a
  reason, an author and the payment it refers to). Balances are sums of
  movements, never stored.
- **Hand-over**: an amount a store declares it gave a business. It is
  pending, then confirmed or disputed (with a note), and records who acted
  and when.
- **Network service fee**: one platform rule, in cents, charged to the payer
  on each cash collection and kept by the store. Its changes keep author and
  date.
- **Receipt phone**: the phone a shopkeeper typed for a customer who had
  none. It is kept for this channel's receipts only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A shopkeeper goes from typing a customer's name to a recorded
  payment with its folio in under 60 seconds, when the business's system
  answers.
- **SC-002**: A customer who paid their whole debt in cash is reconnected
  within 2 minutes of the payment on 95% of payments, when the business's
  system is up.
- **SC-003**: No cash payment is ever lost or undone because the business's
  system failed after it was recorded. 100% keep a visible action status
  until done or failed.
- **SC-004**: Collecting the same customer twice in a row never takes more
  than the debt: the second collection finds what is left, or *Sin adeudo*,
  100% of the time.
- **SC-005**: At any moment, the cash a store holds for a business is the
  same, to the cent, on the store's screen and on the business's screen.
- **SC-006**: A suspended store can do nothing after its suspension. Its
  next action is refused 100% of the time.
- **SC-007**: A store sees no customer until it types a search, and never a
  customer of a business it does not collect for: 0 such exposures.
- **SC-008**: Every cash payment appears in the business's Pagos list within
  one minute of being recorded, and costs the business exactly one fee.
- **SC-009**: In the pilot's first four weeks, every hand-over is confirmed
  or disputed within seven days of being declared.

## Assumptions

- **The pilot is one business and one or a few stores.** Everything here is
  built to hold more, but choices that only matter at scale are deferred:
  - how a business switches the channel on for itself;
  - a map or list of stores for payers;
  - the store paying by SPEI instead of in person;
  - several shopkeeper accounts per store.
- **No cap is debt, not design.** The creator chose no cap for the pilot
  (2026-09-30). It is registered with `/speckit-debt-log` the day this
  feature is planned. Its exit condition: a cap per store, with a warning
  before it and collections blocked at it, before a second store or a
  second business joins.
- **The cash is the business's risk.** With no cap, a store that keeps the
  cash costs the business what the store held. The written agreement
  between Devolada and the pilot business says so. Recovering cash from a
  store is outside the software.
- **Agreements outside the software.** Three are signed before the first
  real collection, and none is built here:
  - with the business: that network stores may search its customers
    (FR-016, FR-017), and that the cash is its risk;
  - with the store: that the service fee is its whole commission;
  - a legal check on collecting cash for third parties.
- **One shopkeeper account per store.** An employee uses the owner's
  account. Separate accounts are a later feature.
- **The receipt goes out through the shopkeeper's own WhatsApp**, by opening
  a prepared message. Nothing is sent automatically and nothing costs per
  message.
- **The service fee is charged on every collection, whole or partial.** A
  payer who pays in two visits pays the fee twice. The receipt and the
  confirm screen show it each time.
- **Nothing more than the debt.** Advance payments and overpayments at the
  counter are out of scope. A customer with nothing owed cannot pay in
  cash.
- **The integration's actions are the business's existing configuration.**
  Mapping, threshold, floor and observation mode are the ones the business
  already set for SPEI. This feature adds no setting there.
- **Search matches what the Links search matches.** The same provider
  question serves both. What the store sees of each result is narrower
  (FR-017).
- **The old copy on the payer's page is a separate bug.** When SPEI is
  unavailable, the page says *"Paga en tu punto de cobro más cercano"*. That
  copy predates this feature and contradicts FR-041. It is fixed through the
  lite path, not here.
- **`devolada-red` stays archived.** Nothing is deployed from it. Its Worker,
  database and domain names collide with Devolada's in the same Cloudflare
  account (measured 2026-09-30), so its deploy workflows are turned off
  before this feature ships.

## Dependencies

- **Constitution amendment** (Purpose, V, Technology Stack), proposed by the
  plan before any code (see Context).
- **The action path reached through the adapter's entry point.** Registering
  a payment and reconnecting are reached by capability, so the counter adds
  no direct call to WispHub. This pays the action half of
  `core-reads-provider-directly`, or is built so it adds nothing to it.
- **The pilot business has an integration that answers all three
  capabilities** (today: WispHub, connected, with a working key).
