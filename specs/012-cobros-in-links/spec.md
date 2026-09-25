# Feature Specification: Cobros in Links

**Feature Branch**: `012-cobros-in-links`

**Created**: 2026-09-25

**Status**: Draft — clarified 2026-09-25 (the chip's label and what search
does in its view)

**Input**: User description: "1. Cobros se lee desde Links, ya no se renombra… porque la página describe lo que contiene. 2. Inicia con Links tal cual está al día de hoy en dev. 3. Se accede a Cobros mediante una tab o chip, como si se aplicara un filtro, pero en realidad se hace el llamado a facturas. 4. Cobros se comporta exactamente como Links: sin sweep, llama directamente a WispHub, etc. 5. ¿Dejamos el nombre del chip como Cobros o pensamos en otro nombre más ad hoc?"

## Context

The panel has two sections for one job. **Links** finds any customer and
sends their payment link. **Cobros** shows who has unpaid invoices and sends
them the same link, through the same buttons (`links-on-demand-search` US4).
The operator reads a debt in one section and presses the button for the same
person in the other.

This feature puts Cobros inside Links. The page keeps its name, because the
page still describes what it holds: payment links, and the customers they
belong to. Cobros becomes a way of looking at that page — a chip beside the
search box, labelled **Por cobrar** — and not a section of its own.

**The page starts from Links as it is on `main` today** (after
`links-on-demand-search`, shipped in #236): a search box, the ISP's customers
read live from WispHub one block at a time as the operator scrolls, a search
that asks WispHub directly, the text in the address, and the Copiar and
WhatsApp buttons that create the link on first use. Nothing about that view
changes.

**The Por cobrar chip looks like a filter and is a different read.** WispHub's
customer list cannot be filtered by who owes money: every billing filter
tried on the pilot came back with the whole base of 6,522 customers
(measured 2026-09-23). Only the invoice list can say who has an unpaid
invoice. So pressing the chip does not narrow the customer list. It reads
the ISP's open invoices from WispHub, one block at a time, the same way the
customer view reads customers.

**It reads WispHub directly, like Links, and never a stored copy.** Today's
Cobros section reads the whole list of open invoices in one response. For a
large ISP that response comes from a copy that a background task (the
"sweep") rebuilds every few minutes. The Por cobrar view in this feature does
neither: it asks WispHub for the block it shows, when it shows it.

### What the provider answers (measured)

| Question | Answer | Source |
| --- | --- | --- |
| How many open invoices does the pilot have? | 193, against 6,522 customers | pilot, 2026-09-23 |
| Can the invoice list be filtered to one customer? | **No.** A customer parameter is ignored and the whole list comes back | pilot, 2026-08-16 and 2026-09-23 |
| What can it be filtered by? | Status (1 = open), a date window by issue, due or payment date, zone, payment method, cashier | provider's parameter listing, 2026-09-01 |
| Is there a default date window? | Yes, **the current month only**, unless a window is given | same listing |
| How does it page? | 100 at most per page, a link to the next page, and a total count | code in production since `bug: pending-invoice-cap` |
| What does one invoice row carry? | Customer usuario and name, issue and due dates, `sub_total` (this period), `saldo` (the carried part), `total`, and line items whose text names the period ("Periodo del 15/Sept./2026 al 15/Oct./2026") | demo, 2026-09-23 |

### How a balance moves through one billing cycle (measured 2026-09-23, demo tenant)

One customer on a 499.00 plan, read after each step:

| Step | Customer record `saldo` | Open invoices | WispHub's one-call balance answer |
| --- | --- | --- | --- |
| Invoice of 499.00, paid 200.00 | **299.00**, "Pagadas" | none: the invoice closed as *Pagada* | **0**, no invoices |
| The zone's monthly billing run | **0.00**, "Pendiente de Pago" | one: 499.00 + 299.00 carried = **798.00** | **798.00** |

Three things follow for this feature:

1. **A customer who paid short is not in the Por cobrar list until their next
   billing run.** Their invoice closed and the remainder moved to their
   balance. The next billing run folds it into a new open invoice, and the
   customer shows again. The gap is bounded by the billing cycle. A
   **search** in the view does find them, with what they owe (FR-010), so
   the operator who is looking for one debtor is never told a short-payer
   owes nothing. The chip's label says more than the list holds; the
   creator chose it knowing this (Clarifications), and the list's count
   names what it counts: open invoices (FR-007).
2. **The carried balance is never counted twice.** The billing run folds it
   in and sets the customer's balance to zero at the same moment.
3. **WispHub's one-call balance answer counts open invoices only.** It said
   0 while the customer owed 299.00. It is right about the open invoices —
   798.00 once the invoice existed — and silent about the carried balance.
   So it can give a search result its open-invoice part, and never, alone,
   the answer to "what does this customer owe" (FR-015).

### What this replaces

- **`specs/011-customers-one-section`** (PR #237, not merged) proposed renaming
  Links to *Clientes*, with one merged row per customer showing their
  balance and open invoices side by side. The creator chose this feature
  instead on 2026-09-25. The page keeps its name, and the two views stay two
  reads. Its measurements are carried above.
- **`specs/010-cobros-on-demand-search`** (branch
  `claude/clientes-facturas-endpoint-pafr4i`, not merged) kept Cobros as a
  section of its own, with paged blocks and search. It was set aside on
  2026-09-25. This feature takes four of its decisions: the next page is
  the provider's own link, blocks are grouped by customer as they arrive,
  the provider being away is never read as "nobody owes", and a debtor
  search asks the customer list and then works out each match's debt. It
  drops the one that relied on the sweep: 010 served a large ISP's blocks,
  and each match's open invoices, from the sweep's copy. This feature never
  does.

## Clarifications

### Session 2026-09-25

- Q: Does the page get a new name? → A: No. It stays **Links**, because the
  page describes what it holds. Cobros is read from inside it.
- Q: What is the starting point? → A: The Links page exactly as it is on
  `main` today. The customer view is not redesigned.
- Q: How does the operator reach Cobros? → A: Through a chip (or tab) beside
  the search box. It looks like a filter; underneath, it reads open
  invoices instead of customers.
- Q: Does the Por cobrar view read the sweep's stored copy? → A: No. It behaves
  like Links: it asks WispHub directly, block by block, and stores nothing.
- Q: What is the chip called? → A: **Por cobrar**. Chosen over *Con facturas
  abiertas* (exact but long) and *Cobros* (the old section's name). The cost
  was named and accepted: the label reads as "everyone who owes", and the
  list holds customers with open invoices, so a short-payer is missing from
  it until their next billing run. Search (next answer) and the count line
  (FR-007) carry the precision the label gives up.
- Q: What does the search box do while Por cobrar is chosen? → A: It finds
  customers exactly as the customer view does, and each result says what
  that customer owes: their open invoices plus their carried balance
  (`debt-truth` D7). Chosen over showing WispHub's billing label with no
  amount, and over filtering only the rows already loaded. The cost was
  named and accepted: one more WispHub read for each result shown. What it
  buys: any debtor can be found, including a short-payer and one whose open
  invoice is older than the list's 180-day window.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See who has open invoices without leaving Links (Priority: P1)

An operator opens Links to send a link, then wants to know who still has an
unpaid invoice this week. They press the chip beside the search box. The page
shows the first customers with open invoices, each with what those invoices
add up to and when the oldest one is due. They press WhatsApp on the first
one, then the next, working down the list. As they scroll, the next block
arrives.

**Why this priority**: this is the feature. It joins the two halves of
collecting — knowing who owes and sending them the link — on one page, with
the buttons the operator already knows.

**Independent Test**: on a connected ISP with open invoices, open Links,
press the chip, and confirm that the first block of customers with open
invoices appears, that scrolling brings more, that each row's WhatsApp opens
that customer's chat with a working link, and that the chip's count matches
the number of open invoices WispHub reports.

**Acceptance Scenarios**:

1. **Given** the Links page as it opens today, **When** the operator presses
   the Por cobrar chip, **Then** the page shows the first block of customers
   with open invoices, read from WispHub at that moment.
2. **Given** the Por cobrar view, **When** the operator scrolls toward the end
   of the block, **Then** the next block is read and added; **When** they do
   not scroll, **Then** nothing more is read.
3. **Given** a row in the Por cobrar view, **When** the operator reads it,
   **Then** it shows the customer's name and usuario, the total of their
   open invoices on screen, how many invoices that is, and the oldest due
   date as *Venció …* (past, with a warning icon) or *Vence …* (future). A
   past date is judged by the business's timezone.
4. **Given** a row, **When** the operator opens it, **Then** each open
   invoice shows its period, its total and, when it carries one, the part
   that came from before (*saldo anterior*).
5. **Given** a row, **When** the operator presses Copiar or WhatsApp,
   **Then** the same act as in the customer view happens: the link is
   created if it did not exist, and WhatsApp opens that customer's own chat
   when WispHub has a readable phone for them.
6. **Given** the Por cobrar view, **When** the operator presses the chip that
   returns to all customers, **Then** the customer view is exactly as the
   Links page is today.
7. **Given** a viewer, or a business with no CLABE configured, **When** they
   open the Por cobrar view, **Then** they see the rows with the buttons
   withheld, exactly as in the customer view.
8. **Given** an ISP with no open invoice, **When** the operator presses the
   chip, **Then** the page says nobody has an open invoice today, with no
   warning and no error.

---

### User Story 2 - The Cobros section folds into Links (Priority: P2)

The panel's menu no longer has a Cobros section. An operator who saved the
old address, or follows an old link to it, lands on Links with the Por cobrar
chip already chosen. The chip that was chosen survives leaving the page,
the back button and a reload, the way the search text already does.

**Why this priority**: one section instead of two is the point of the
change, and nobody should lose the page they relied on.

**Independent Test**: open the old Cobros address and confirm that Links
opens on the Por cobrar view; choose the Por cobrar view, go to Pagos and back,
press back, reload, and confirm that it is still chosen each time; confirm
that the menu has no Cobros entry.

**Acceptance Scenarios**:

1. **Given** the panel menu, **When** the operator looks at it, **Then**
   there is no Cobros entry, and Links is where Cobros used to be.
2. **Given** the old Cobros address, **When** it is opened, **Then** Links
   opens with the Por cobrar chip chosen.
3. **Given** the Por cobrar view chosen, **When** the operator leaves the page
   and returns, presses back, or reloads, **Then** the Por cobrar view is still
   chosen.
4. **Given** the Por cobrar view's address, **When** a colleague of the same
   business opens it, **Then** it opens on the Por cobrar view.

---

### User Story 3 - Find one debtor from the Por cobrar view (Priority: P2)

An operator in the Por cobrar view is looking for one customer who called about
their bill. They type part of the name, usuario or phone in the same search
box. The customers who match appear exactly as they would in the customer
view, and each one says what they owe right now — including a customer who
paid short last week and is on no list of open invoices.

WispHub cannot search the invoice list by customer, so the search asks the
customer list, as the customer view does, and then asks what each match owes.

**Why this priority**: an operator chasing one debtor must not have to
scroll through blocks to reach them. Today's Cobros section searches only the
rows already loaded, and never finds a short-payer at all.

**Independent Test**: on a connected ISP, search the Por cobrar view for a
customer who paid short — invoice closed, remainder in their balance — and
confirm they appear with the remainder as what they owe, although the Por
cobrar list does not contain them.

**Acceptance Scenarios**:

1. **Given** a customer with an open invoice, **When** the operator searches
   for them in the Por cobrar view, **Then** they appear with their usuario
   and what they owe: their open invoices plus their carried balance.
2. **Given** a customer who paid short, **When** the operator searches for
   them, **Then** they appear with the remainder as what they owe.
3. **Given** a customer whose only open invoice is older than 180 days,
   **When** the operator searches for them, **Then** they appear with that
   invoice in what they owe.
4. **Given** a matching customer who owes nothing, **When** results show,
   **Then** they appear marked *Sin adeudo* — never hidden, because a hidden
   customer reads as a customer who does not exist.
5. **Given** a matching customer whose debt WispHub did not answer for,
   **When** results show, **Then** the row says it could not confirm what
   they owe and shows no amount — never a zero.
6. **Given** a result, **When** the operator presses Copiar or WhatsApp,
   **Then** the same act as everywhere else happens.
7. **Given** fewer than three characters typed, **When** the operator
   pauses, **Then** nothing is searched and the page says three are needed,
   as in the customer view.
8. **Given** the operator types quickly, **When** answers arrive, **Then**
   only the answer for the text as it is now is shown.
9. **Given** a search in the Por cobrar view, **When** the operator leaves and
   returns, **Then** the same text and view come back.

---

### User Story 4 - WispHub away is never read as "nobody owes" (Priority: P3)

WispHub is slow or down while the Por cobrar view is chosen. Devolada keeps no
copy of anyone's debt, so there is nothing to show from memory. The page
says that it cannot read open invoices right now, instead of showing an
empty list that looks like "nobody owes".

**Why this priority**: an empty list with no reason is the one lie this view
must not tell. It is rare, so it ranks below the everyday flows.

**Independent Test**: with WispHub unreachable, choose the Por cobrar view and
confirm that no empty "nobody owes" state appears, that the note says open
invoices cannot be read right now, and that a retry becomes possible; with a
refused key, confirm that the page sends the operator to Integraciones.

**Acceptance Scenarios**:

1. **Given** WispHub unreachable, **When** the operator chooses the Por cobrar
   view, **Then** the page says open invoices cannot be read right now,
   offers to try again, and never says nobody owes.
2. **Given** rows already on screen and WispHub stops answering, **When** the
   next block fails, **Then** the rows stay, with the quiet note "Sin
   conexión a WispHub" the customer view already uses.
3. **Given** WispHub refuses the ISP's key, **When** the Por cobrar view reads,
   **Then** the page says it is a setup problem and links to Integraciones,
   as the customer view does.
4. **Given** a business with no WispHub connected, **When** it opens Links,
   **Then** the Por cobrar chip does not appear. There are no invoices to read,
   and the customer view is as it is today.

---

### Edge Cases

- **A customer with two open invoices in different blocks** shows once. When
  the second block arrives, its invoice joins the row that is already on
  screen, and the row's total and count grow.
- **The provider's order is not guaranteed.** A list that changes while the
  operator scrolls can show a customer twice or skip one between blocks. The
  view promises that a debtor with an open invoice can be found, not that the
  list reads the same twice. Rows are not sorted by due date across blocks.
  Only the whole list could sort them that way, and the view never reads the
  whole list.
- **A customer who paid short** has no open invoice until their zone's next
  billing run. They are not in the Por cobrar list in the meantime; a search
  in the view finds them with the remainder as what they owe (FR-010). See
  Context: the gap is bounded and measured, and the label's promise was
  accepted with it.
- **An open invoice older than the read window** (180 days by issue date,
  `debt-truth` D3) is not in the Por cobrar list. The same window applies
  today; this feature does not change it. A search finds that customer,
  because a result's debt read has no window (FR-017).
- **An invoice whose due date is yesterday by the business's timezone but
  today by the browser's** reads as *Venció*.
- **An invoice with no due date** shows its issue date instead, and never
  reads as overdue.
- **A payment lands while the operator is on the Por cobrar view.** The row stays
  until the view reads again: on return to the tab, at most once every 30
  seconds, exactly like the customer view. Pressing WhatsApp on it sends a
  link whose payer page shows the up-to-date debt.
- **The provider leaves out the total count**: the page says nothing about
  how many there are rather than printing a guess.
- **A search result's debt read is slow or fails** while the rest arrive:
  that row shows the customer at once, says it is still checking, and then
  either the amount, *Sin adeudo*, or that it could not confirm. One slow
  customer never holds back the others.
- **A customer with an open invoice and a carried balance at once** (for
  example, a short payment against one of two open invoices): a search
  result adds both. The list row shows only the open invoices, as it always
  does.
- **The operator switches views quickly**: only the answer for the view
  chosen now is shown. An answer for the other view that arrives late is kept
  for when they come back, never drawn over the wrong view.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Links page MUST keep its name, its place in the menu and,
  with the customer view chosen, every behaviour it has on `main` today
  (`links-on-demand-search` FR-001 to FR-028). The customer view MUST be what
  the page opens on by default.
- **FR-002**: The page MUST offer a chip (or tab) beside the search box,
  labelled **Por cobrar**, that switches to the Por cobrar view, and one
  that returns to the customer view.
- **FR-003**: The Por cobrar view MUST read the ISP's open invoices from WispHub
  at the moment it shows them, one block at a time. The first block MUST be
  no larger than what fills the screen, and the next MUST be read only when
  the operator scrolls toward it. The view MUST NOT read the whole invoice
  list on its own, and MUST NOT read any stored copy of it.
- **FR-004**: Every read MUST carry an explicit window: open invoices issued
  in the last 180 days, up to one day ahead (`debt-truth` D3). The
  provider's default window, the current month, silently drops older
  arrears and MUST never be relied on.
- **FR-005**: The view MUST group the invoices it has on screen by customer:
  one row per customer, showing name, usuario, the total of their open
  invoices on screen, how many invoices that is, and the oldest due date as
  *Venció …* or *Vence …*, judged by the business's timezone. Status MUST
  never be colour alone.
- **FR-006**: Opening a row MUST show each of its open invoices with its
  period, its total and, when the invoice carries one, the part that came
  from before (*saldo anterior*), all read from the invoice itself.
- **FR-007**: The view MUST say how many open invoices the ISP has, using the
  number WispHub reports. It MUST say invoices, not customers, and MUST say
  nothing when WispHub does not report one.
- **FR-008**: Copiar and WhatsApp on a Por cobrar row MUST be the same act as on
  a customer row: the link is created on first use and never on being shown
  (`links-on-demand-search` FR-008, FR-025), and WhatsApp opens the
  customer's own chat when the fresh read has a readable phone (its FR-028). The
  buttons MUST be withheld from a viewer and from a business with no CLABE,
  as in the customer view.
- **FR-009**: The chosen view MUST live in the page's address beside the
  search text, so that it survives leaving and returning, the back button,
  a reload and being sent to a colleague.
- **FR-010**: While the Por cobrar view is chosen, a search MUST find
  customers exactly as the customer view's search does
  (`links-on-demand-search` FR-003 to FR-006, FR-013: the same text, fields,
  blocks, timing and count line), and each result MUST say what that
  customer owes: their open invoices plus their carried balance
  (`debt-truth` D7). The search replaces the list while it is active, as it
  does in the customer view; a list row and a search result are never
  mixed on one screen. Links created through the collections API have no
  WispHub customer and no WispHub debt, so they MUST NOT appear in this
  view's results. When WispHub is away, the search answers from what the
  customer view can still reach (`links-on-demand-search` FR-014, FR-021),
  and every such result says it could not confirm what they owe (FR-018).
- **FR-011**: The Por cobrar view MUST re-read its first block when the operator
  returns to the tab, no more than once every 30 seconds, and MUST NOT show
  how old its rows are, exactly like the customer view
  (`links-on-demand-search` FR-027).
- **FR-012**: When WispHub cannot be reached, the Por cobrar view MUST NOT show
  the "nobody has an open invoice" state. With no rows yet, it MUST say
  open invoices cannot be read right now and offer to try again. With rows
  on screen, it MUST keep them under the quiet "Sin conexión a WispHub"
  note. A refused key MUST send the operator to Integraciones.
- **FR-013**: A business with no WispHub connected MUST NOT see the Por cobrar
  chip.
- **FR-014**: The Cobros section MUST leave the menu. Its old address MUST
  open Links with the Por cobrar view chosen.
- **FR-015**: No amount this feature shows MAY come from WispHub's one-call
  balance answer alone. It counts open invoices only and leaves out a
  carried balance (measured 2026-09-23).
- **FR-016**: The Por cobrar list (no search active) MUST show only what the
  invoice list answered. It MUST NOT add customers whose only debt is a
  carried balance, and MUST NOT read anything to find them. A search finds
  them (FR-010).
- **FR-017**: What a search result owes MUST be read from WispHub when the
  result is shown, with one read per result, and only for the results on
  screen: a block of search results costs its customer read plus one read
  per row, and nothing is read for a row that was never shown. The
  customer's open invoices for that read MUST cover every open invoice
  they have, with no date window, and the carried balance MUST come from
  the customer record the search already returned (FR-015).
- **FR-018**: A search result MUST say one of three things, never a guess:
  the amount owed, when it is above zero; *Sin adeudo*, when WispHub answered
  and the customer owes nothing; or that it could not confirm what they owe,
  with no amount, when the read for that customer failed. A customer who
  owes nothing MUST NOT be hidden from the results.

### Key Entities

- **Open invoice**: an unpaid invoice as WispHub lists it. It carries the
  customer's usuario and name, its issue and due dates, what this period
  bills, the part carried from before, its total, and line text naming the
  period. Devolada reads it and does not keep it.
- **Por cobrar row**: one customer and the open invoices of theirs that are on
  screen. The total and count cover what has loaded, and grow if a later
  block brings more of theirs.
- **Search result with debt**: a customer the search found, and what they
  owe: open invoices plus carried balance, or *Sin adeudo*, or "could not
  confirm". Read when shown; not kept.
- **View**: which read the page is showing: customers (the default) or open
  invoices. It is held in the address with the search text.
- **Payment link**: unchanged from `links-on-demand-search`. It is
  identified by usuario and born on first use, so a Por cobrar row and a
  customer row for the same person share one link.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can go from opening Links to sending a WhatsApp to
  a customer with an open invoice in under 10 seconds, without leaving the
  page.
- **SC-002**: The Por cobrar view's first block appears within three seconds of
  pressing the chip on 95% of presses, for an ISP of any size.
- **SC-003**: Opening the Por cobrar view and not scrolling reads exactly one
  block from WispHub, and the view never reads a block the operator did not
  scroll toward.
- **SC-004**: With WispHub unreachable, the Por cobrar view never shows "nobody
  has an open invoice": 100% of such reads say that WispHub could not be
  read.
- **SC-005**: Every return to the page — from another page, by the back
  button, by reload — comes back to the view and search text the operator
  left, 100% of the time.
- **SC-006**: The Por cobrar view reads nothing the sweep stored. Turning the
  sweep's invoice pass off changes nothing the view shows.
- **SC-007**: The panel has one section for sending links and seeing who has
  open invoices, not two.
- **SC-008**: A search in the Por cobrar view finds a customer who paid short,
  with the remainder as what they owe, 100% of the time WispHub answers.
- **SC-009**: A search that shows N results makes at most N debt reads, and
  a search whose results are never scrolled past the first block reads no
  debt beyond that block.

## Assumptions

- **The sweep stays; only the Por cobrar view stops reading it.** The same
  stored list of open invoices also feeds the payer's page, a payment's
  submission and validation, and the provisional promise. Those read it
  because a payer cannot wait for a slow read. Retiring the sweep would
  change those money paths, and that is a feature of its own. This one only
  makes sure the panel no longer depends on it (SC-006).
- **No Vencidas / Por vencer filters in this feature.** Today's Cobros
  section has them, as filters over a whole list it holds. Here, each row
  says *Venció* or *Vence* instead. WispHub can filter the invoice list by
  due date, so these filters can be added later as provider reads without
  changing anything this feature builds. Until then the operator loses
  them, and this spec says so.
- **No sort by oldest debt.** Today's section sorts the whole list by due
  date. Blocks arrive in the provider's order, and sorting them would need
  the whole list. Rows are grouped by customer as they arrive (FR-005).
- **The next block is WispHub's own link to its next page.** That link is
  measured on the invoice list. A computed page offset is not.
  (`cobros-on-demand-search` D2 reached the same conclusion.)
- **The row's total is its open invoices on screen, not the customer's
  whole debt.** The payer's page shows the whole debt (open invoices plus
  carried balance, `debt-truth` D7) when the customer opens the link. The
  row does not claim to be that number.
- **The customer view does not change.** It does not gain a debt column.
  That was `011-customers-one-section`'s proposal, which this feature
  replaces.
- **Roles, CLABE gating, the WhatsApp message and the link rules are those of
  `links-on-demand-search`**, unchanged.
- **The read budget per WispHub call stays what it is today.** A block is one
  call; a search result's debt is one call of its own.
- **A result's open invoices come from a per-customer read.** WispHub has a
  measured one-call answer that lists one customer's open invoices (798.00
  on the demo once the invoice existed), and the customer record carries
  the balance. Together they are the debt; either alone is not (FR-015).
  Which call the plan uses is a plan decision, held to FR-017.
- **The browse and the search tell different truths, by design.** The list
  is open invoices, grouped by customer from the blocks that have loaded.
  A search result is one customer's whole debt. They are never on the
  screen together (FR-010), so the operator never compares a partial total
  with a whole one.
