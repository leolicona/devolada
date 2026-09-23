# Feature Specification: Customers, One Section

**Feature Branch**: `011-customers-one-section`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "Clientes: Links and Cobros become one section. Today the ISP panel has five sections and two of them ask about the same person: Cobros ('who owes me', read from WispHub's pending-invoice list, grouped by customer, with the amount) and Links ('find a customer and send their payment link', read from WispHub's customer base one block at a time, with Copiar and WhatsApp on every row). The operator's goal is one thing: contact the customer to collect. The customer is the subject; the debt and the payment link are two facts about them. Two screens make the operator hold that in their head. Merge the two into a single section called 'Clientes'. One list of customers with a debt filter, the same two buttons on every row (Copiar link / WhatsApp), and a card that opens to the customer's pending invoices. The section opens with the debt filter already ON, because that is the work: the operator filters to customers who owe, and presses WhatsApp to send the payment reminder. They open a customer's card only to clarify a specific case. [...] Out of scope, and deliberately so — the next two features: sending anything from Devolada itself, scheduled reminders, WhatsApp Business API, reading replies, the per-ISP sending identity and contact-line settings, mass or bulk selection, delivery states (enviado / recibido), and any reminder cadence. Devolada still sends nothing in this feature: the operator's own WhatsApp sends, and Devolada records no delivery state. But build with the seams those features need. [...] What this feature owes them is: 'the set of customers who owe, right now' must be a thing the server can answer on its own — not a shape that only exists because a browser asked for a screen — because that set is what a scheduled reminder will walk. Say so in the design; do not build the queue."

## Context

The ISP panel has five sections. Two of them ask about the same person.

**Cobros** answers "who owes me". It reads the tenant's pending invoices,
groups them by customer, and shows what each one owes. **Links** answers
"find a customer and send their payment link". It reads the customer base
one block at a time and puts Copiar and WhatsApp on every row.

The operator's goal is one thing: **contact the customer to collect**. The
customer is the subject. The debt and the payment link are two facts about
them. Splitting those facts across two sections makes the operator hold the
join in their head — they read an amount in one place and press a button in
another, for the same person.

The two screens have already converged underneath. They create a link
through the same door (`links-on-demand-search` D14), they share the act
that copies and shares it, they show the same customer, and they answer a
refused WispHub key with the same sentence and the same door. What is left
apart is the heading above them.

This feature merges them. It adds exactly one new fact to a customer row —
what they owe — and that fact costs no new provider call: the customer-list
answer already carries the running balance, and the pending-invoice half is
the tenant list Devolada already reads to draw Cobros.

**What this feature deliberately does not do.** Devolada still sends
nothing. The operator presses WhatsApp and their own phone sends, and
Devolada records no delivery state. Scheduled reminders, the WhatsApp
Business API channel, reading replies, bulk selection and delivery states
are the next two features (creator's decision, 2026-09-22). What this
feature owes them is one seam, named in Requirements: **the set of customers
who owe must be something the server can answer on its own**, not a shape
that exists only because a browser asked for a screen. That set is what a
scheduled reminder will walk.

### What the provider actually answers (measured 2026-09-23)

Probed from this repo against the pilot's own installation with the ISP's
key. The network path to both provider hosts works from here, which retires
the "DNS-confirmed only, no HTTP request has verified it" note in
`apps/api/src/wisphub/installations.ts`.

| Question | Answer |
| --- | --- |
| How big is the customer base? | 6,522 customers |
| How many invoices are unpaid? | 193, across the whole tenant |
| Does the customer list carry money? | Yes — a running balance, a billing status with three values, the plan price and the cut-off date, all in the same answer at no extra call |
| Can the customer list be **filtered** by who owes? | **No.** Every billing filter tried came back with all 6,522 |
| Can the invoice list be narrowed to one customer? | Not by the parameter the customer record itself uses — that was ignored too. One other parameter is not ignored, but is still unproven |
| Is there a one-call answer for a single customer? | Yes — one call returns that customer's balance, their pending invoices and their service state |
| Do customers have an email? | The field exists and is **empty for 300 of 300** sampled; 298 of 300 have a phone |

**The trap this feature must not fall into**: the provider answers a filter
it does not recognise by *ignoring it and returning everything*. Three
filters that looked like they worked each handed back the entire customer
base. A narrowing is therefore never believed without an unfiltered control
beside it — otherwise a screen can announce "6,522 customers owe you money"
and be wrong about every one of them.

**What this settles for this feature**: the customer list can *show* what a
customer owes, but it cannot *find* the customers who owe. Only the tenant's
invoice list answers that, and it is small — 193 rows against 6,522
customers. So the second screen goes and the reading beneath it stays.

It also settles the shape of the debt: on the one sampled record carrying a
non-zero balance, the customer list said 600.00 while the same customer's
own balance call said 0 and listed no invoices. The case built on the demo
tenant the same day (next section) explains it: that customer paid short,
and the one-call door does not count a carried balance. Neither source is
the debt alone (FR-007).

### How a balance moves through one billing cycle (measured 2026-09-23, demo tenant)

Built step by step on WispHub's demo tenant (`api.wisphub.net`, one customer
on a 499.00 plan, zone "Zona dia 15"), reading the customer record, the
invoice list and the one-call balance door after each step:

| Step | Customer record `saldo` | Pending invoices | One-call door `saldo` | Invoices + `saldo` |
| --- | --- | --- | --- | --- |
| Invoice of 499.00 issued, paid 200.00 | **299.00**, "Pagadas" | none — the invoice closed as *Pagada*, `saldo_nuevo` 299.00 | **0**, no invoices | **299.00** |
| The zone's monthly "crear facturas" run | **0.00**, "Pendiente de Pago" | one: `sub_total` 499.00 + `saldo` 299.00 = `total` **798.00** | **798.00**, that invoice | **798.00** |

What it answers:

1. **The carried balance never counts twice.** The monthly run folds the
   carried balance into the new invoice and sets the customer's balance back
   to zero in the same moment. Pending invoices plus balance is right on both
   sides of the run. The invoice's own `saldo` field is the part of it that
   came from before; its line items show only the plan ("Plan de Internet:
   Plan 3M/1M 499.00 · Periodo del 15/Sept./2026 al 15/Oct./2026").
2. **The customer's balance does not include open invoices.** With 798.00
   open, the record said 0.00; the four other invoices of the same run carry
   `saldo` 0.
3. **The one-call balance door answers open invoices only.** It said 0 while
   the customer owed 299.00 — the 600.00-against-0 row above is that state
   on the pilot. It is never a source of what a customer owes. (Its payment
   URL also came back without a host, `http:///saldo/…`.)

What it settles for this feature: a customer whose whole debt is a carried
balance is invisible to any list drawn from pending invoices, **but only
until the next billing run** of their zone, which puts them back on it with
the balance inside the new invoice. WispHub's documentation adds that the
automatic cut needs an issued, pending invoice, so such a customer is not at
risk of suspension meanwhile (read from the docs, not measured). The gap is
bounded and not urgent, which is why the debt filter is named for what it
finds — open invoices — rather than read as "everyone who owes"
(Clarifications, 2026-09-23).

### Its relationship to 010, and one measurement that may change both

`specs/010-cobros-on-demand-search` (branch
`claude/clientes-facturas-endpoint-pafr4i`, specified 2026-09-22, planned
and broken into 47 tasks) proposes the opposite move: it **keeps** Cobros as
a screen and gives it its own on-demand search and paged blocks. This
feature removes that screen. **The two cannot both ship.** Which one
survives is the creator's decision, and it must be taken before either is
planned further.

010 carries one finding this feature depends on and does not restate: a
customer who pays less than their invoice has that invoice closed as *Pagada*
while the remainder moves to their running balance — so they owe money and
appear on no list drawn from pending invoices. The row measured here on
2026-09-23, a balance of 600.00 against a billing status of *Pagadas*, is
that case and not a stray test record.

What looked like it fit neither spec — the same customer's own balance call
answering 0 with no invoices — was explained the same day: the one-call door
counts open invoices only and leaves the carried balance out (previous
section). It under-reports exactly the short-payment case, and neither
feature may use it as the source of what a customer owes.

010's premise is that the invoice list has no customer filter — two
measurements, 2026-09-01 and 2026-08-16, agree. A probe on 2026-09-23 found
that the parameter the customer record itself uses is indeed ignored,
returning all 193 of the tenant's invoices. But a second, undocumented
parameter was **not** ignored: it answered 0 for a customer whose pending
list is genuinely empty, where an ignored filter would have answered 193.
One call against a customer who does owe settles whether a per-customer
invoice filter exists. If it does, this feature's card becomes one cheap
call and 010's central premise weakens.

## Clarifications

### Session 2026-09-23

- Q: When the operator opens Clientes on an ISP with a thousand or more
  customers who owe, should the section receive that whole debtor list at
  once, or a screen at a time? → A: Neither. There is no second list to
  deliver — the section is the existing customer list, read a block at a
  time, with the billing facts added to a row and a card that opens to the
  customer's invoices. Measured the same day: 193 unpaid invoices against
  6,522 customers, so how the debtor set travels is not a design problem.
- Q: How does a row show what a customer owes, when the two halves come
  from two readings that can disagree in freshness? → A: As its two parts,
  each by name, never folded into one figure: the carried balance (*Saldo*,
  from the customer record, which is never truncated) and the open invoices
  (how many and how much, or *no se puede confirmar*). Creator's decision.
- Q: What does the debt filter select, given that no provider list can find
  a customer whose only debt is a carried balance? → A: Customers with open
  invoices, and it is named that way (*Con facturas abiertas*), not
  "Deben". A balance-only customer is reached by search or by the
  whole-base list, where their row shows the balance. Measured the same day
  that this state ends at the zone's next billing run, which folds the
  balance into the new invoice. No background read of the whole customer
  base is added for it; that read belongs to the scheduled-reminder feature,
  if it needs one. Creator's decision.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Collect from the people who owe (Priority: P1)

The operator opens **Clientes**. The list is already filtered to customers
who owe, newest debt last, oldest first — the urgent ones at the top. Each
row shows who the customer is, what they owe, and the two buttons. The
operator presses WhatsApp and the message opens in the customer's own chat
with the payment link in it.

No filter to set, no second screen to visit, no amount to carry in their
head from one place to another.

**Why this priority**: this is the entire job the section exists for. Every
other story is a way of getting to it or clarifying it. If only this ships,
the ISP can collect.

**Independent Test**: seed a business with WispHub connected and customers
carrying pending invoices; open the section and confirm the debtors appear
with their amounts and that WhatsApp opens the right chat carrying the right
link — without touching search, the card, or the old addresses.

**Acceptance Scenarios**:

1. **Given** an ISP with customers who owe, **When** the operator opens
   Clientes, **Then** the list shows customers who owe, each with the amount
   they owe and the two buttons, without the operator setting a filter.
2. **Given** a customer who owes and has no payment link yet, **When** the
   operator presses WhatsApp, **Then** the link is created at that moment
   and the message opens in the customer's own chat carrying it.
3. **Given** a customer who owes and already has a link, **When** the
   operator presses WhatsApp or Copiar, **Then** the same permanent link is
   used — it is never replaced.
4. **Given** the operator's role is viewer, **When** they open Clientes,
   **Then** they see the customers and the amounts and there is nothing to
   press.
5. **Given** the business has not set its CLABE, **When** the operator opens
   Clientes, **Then** the customers and amounts read normally and the two
   buttons wait, with the reason said in words.

---

### User Story 2 - Find any customer, whether they owe or not (Priority: P2)

The operator needs a specific person who is not in the debt list — someone
who paid last week and lost their link, someone asking for it before the
invoice is issued. They turn the debt filter off, or they search, and reach
any of the ISP's customers.

**Why this priority**: without it the merged section is narrower than Links
was, and 6,509 customers minus the debtors become unreachable. It is second
only because the collecting work in US1 is what the ISP is paid for.

**Independent Test**: search for a customer who owes nothing, confirm they
are found, press Copiar, and confirm the link is created and copied.

**Acceptance Scenarios**:

1. **Given** the debt filter is off, **When** the operator scrolls,
   **Then** more customers load as they reach them, and the section says how
   many customers the ISP has.
2. **Given** the operator types three or more characters, **When** the
   search settles, **Then** customers matching by name, usuario or phone
   appear, and the section says how many matched and whether more remain.
3. **Given** a customer who owes nothing, **When** they are found by search
   and Copiar is pressed, **Then** their permanent link is created and
   copied.
4. **Given** the operator searched with the debt filter on, **When** they
   turn the filter off, **Then** the same search text is kept and re-run
   against the whole customer base.
5. **Given** the operator typed fewer than three characters, **When** they
   stop typing, **Then** the section says so and searches nothing, keeping
   what is already on screen.

---

### User Story 3 - Open a customer to see why they owe that much (Priority: P3)

A customer disputes the amount, or the operator wants to know what the debt
is made of before pressing send. They open the customer's card and see the
pending invoices behind the total, read fresh at that moment.

**Why this priority**: it is the clarification path, not the main work — the
operator opens it for one customer in twenty. It earns P3 because it is what
lets the operator answer a customer on the phone without opening WispHub.

**Independent Test**: open a debtor's card and confirm the invoices listed
and their sum match what WispHub holds for that customer right now.

**Acceptance Scenarios**:

1. **Given** a customer who owes, **When** the operator opens their card,
   **Then** the card shows each pending invoice and what it is for, and the
   total they add up to together with any carried balance.
2. **Given** the list's amount was read minutes ago and the customer has
   paid since, **When** the operator opens the card, **Then** the card shows
   the current, smaller amount and the row is corrected to agree with it.
3. **Given** the operator wants the customer's payment history, **When**
   they are in the card, **Then** the card points them to Pagos filtered to
   that customer rather than holding the history itself.
4. **Given** the card is open, **When** the operator presses Copiar or
   WhatsApp there, **Then** it behaves exactly as the same button on the row.

---

### User Story 4 - Nobody loses their way in (Priority: P4)

An operator has `/links` bookmarked. A colleague was sent a Links address
carrying a search. Both land in Clientes, on the right thing, not on a dead
route.

**Why this priority**: it costs little and protects every operator who
already learned the old panel. It is last because it changes no capability.

**Independent Test**: visit each old address, with and without a search, and
confirm where it lands.

**Acceptance Scenarios**:

1. **Given** an operator with the old Links address, **When** they open it,
   **Then** they land in Clientes.
2. **Given** an address carrying a search, **When** it is opened, **Then**
   Clientes opens on that search.
3. **Given** an operator with the old Cobros address, **When** they open it,
   **Then** they land in Clientes with the debt filter on.
4. **Given** the panel's navigation, **When** the operator looks at it,
   **Then** there are four sections and one of them is Clientes.

---

### Edge Cases

- **The tenant's invoice read could not be finished.** The open-invoice
  part of a row is then not knowable. It MUST say it cannot be confirmed. It
  MUST NOT show zero, and it MUST NOT show a guessed number such as the
  plan's price. (The rule `bug: pending-invoice-cap` established; this
  feature inherits it rather than re-deciding it.) The carried balance still
  shows: it comes from the customer record, which is never cut short.
- **A zone's billing run has just happened.** For a few minutes the
  customer record already reads balance 0 and "Pendiente de Pago" while the
  last finished invoice reading does not yet hold the new invoice. The open
  invoices part reads *no se puede confirmar*, never zero — the rule
  `nothingOwedIsProven` already applies (`apps/api/src/wisphub/debt.ts`).
- **The business never connected WispHub.** There is no debt to filter by
  and no customer base to browse. The section shows the links the business
  created through the API, says where links come from, and offers no debt
  filter at all.
- **WispHub refused the key.** This is setup, not weather: the section says
  the installation before the key and offers the Integraciones door. It
  never offers a retry that re-sends the same key to the same place.
- **WispHub is away.** A quiet note over the rows that are already there,
  never the error block. With the debt filter on, the last finished reading
  still answers. With it off, only the customers this session already saw
  can be found, and the note says so.
- **A customer who owes has no phone in WispHub.** WhatsApp falls back to
  its own contact picker with the message ready.
- **A customer in the debt list has no payment link yet.** Same two buttons
  as everyone else; pressing either is what creates the link. Being listed
  never creates one.
- **An API-channel link has no WispHub customer.** It cannot carry a WispHub
  debt. It appears when the debt filter is off, shows the amount it was
  created for, and never appears in the debt view as owing zero.
- **A customer's debt is settled between the list read and the card open.**
  The card says the customer owes nothing now, and the row agrees with it.
- **The operator searches with the debt filter on.** The search runs over
  the debtors already in hand: complete and instant. Turning the filter off
  re-runs the same text against the whole customer base, which is a walk.
  The section MUST NOT present these two as the same promise.
- **A customer appears in the debt list whose customer record WispHub no
  longer answers for.** The row shows what the invoice list knows — usuario,
  name, amount — and the actions still work.
- **The provider ignores a filter instead of refusing it.** Measured
  2026-09-23: asking the customer list for only the customers who owe
  returns all 6,522 of them, with nothing in the answer to say the filter
  was dropped. A count that equals the unfiltered whole MUST be treated as
  "not filtered", never as "everyone owes".
- **A customer owes only a carried balance.** Measured 2026-09-23: after a
  short payment the invoice closes as *Pagada* and the remainder lives in
  the customer's balance, so no open invoice names them. They are not in
  *Con facturas abiertas*; search and the whole-base list find them, and
  their row reads the balance. At the zone's next billing run the balance
  moves into the new invoice and they are back in the filter.
- **The one-call balance door disagrees with the customer record.** It
  counts open invoices only (measured 2026-09-23: 0 against a record
  balance of 299.00). The section never reads it as what a customer owes.

## Requirements *(mandatory)*

### Functional Requirements

**The section**

- **FR-001**: The panel MUST have one section, named *Clientes* in product
  copy, in place of the two sections previously named *Links* and *Cobros*.
  Navigation MUST offer four sections, not five.
- **FR-002**: Clientes MUST open with the debt filter already applied, so
  that an operator who opens the section is looking at the customers with
  open invoices without having set anything. The filter MUST be named for
  what it selects (*Con facturas abiertas*), because a customer whose only
  debt is a carried balance is not in it.
- **FR-003**: The operator MUST be able to widen the list to every customer
  of the ISP, and to narrow it to customers whose debt is past due.
- **FR-004**: A business with no WispHub connection MUST NOT be offered the
  debt filters at all; its section opens on its API-created links and says
  where links come from.

**The row**

- **FR-005**: Every customer row MUST show who the customer is — the name,
  the usuario and the phone as WispHub answers them at the time of reading —
  and which channel they belong to, rendered as icon and text and never as
  colour alone.
- **FR-006**: Every customer row MUST show what that customer owes,
  regardless of which filter is applied, as its two parts named separately:
  the carried balance and the open invoices (how many, and what they add up
  to). A customer who owes nothing MUST read as owing nothing, in words, and
  not as a blank.
- **FR-007**: What a customer owes MUST be their open invoices plus their
  carried balance. It MUST NOT be the plan's list price, it MUST NOT be
  either part presented as the whole, and it MUST NOT be read from the
  provider's one-call balance door, which counts open invoices only.
  (Measured 2026-09-23 on the demo tenant: the monthly billing run folds the
  balance into the new invoice and resets it to zero at once, so the sum
  never counts it twice.)
- **FR-008**: When the underlying invoice reading could not be completed,
  the open-invoice part of a row MUST say it cannot be confirmed. It MUST
  NOT show zero and MUST NOT show a substitute number. The carried balance
  is shown regardless.
- **FR-009**: Every customer row MUST carry the same two actions — copy the
  link, and open WhatsApp with the link in the message — with the same
  behaviour they have today, including creating the link on first use and
  opening the customer's own chat when a phone is known.
- **FR-010**: A row MUST NOT cause a payment link to exist merely by being
  listed. Only the operator's act creates one.
- **FR-011**: Both actions MUST be gated on the operator's authority to
  operate payments and on the business having a CLABE, exactly as they are
  today; a viewer sees the customer and the amount with nothing to press.

**Finding a customer**

- **FR-012**: The operator MUST be able to search by name, usuario or phone
  from one search box, whichever filter is applied.
- **FR-013**: The section MUST tell the operator what its current list can
  and cannot reach, and MUST NOT present the debtor search and the
  whole-base search as the same promise. Each state MUST say how many
  customers it is talking about and whether more remain.
- **FR-014**: The search text MUST live in the address, so that navigating
  away and back, the browser's back button, a reload and a pasted address
  all land on the same search.
- **FR-015**: Changing the filter MUST keep the operator's search text.

**The card**

- **FR-016**: The operator MUST be able to open a customer and see the
  pending invoices that make up their debt, each with what it is for (the
  period the invoice states), what it is worth, and — where an invoice
  carries a balance from before — that part named separately (*saldo
  anterior*), so its line items and its total never appear to disagree;
  plus any carried balance and the total they add up to.
- **FR-017**: The card MUST be read at the moment it is opened, so it is
  exact even when the list behind it is older. Its carried balance MUST come
  from the same customer record the row uses. Where the card and the row
  disagree, the card is right and the row MUST be corrected to agree.
- **FR-018**: The card MUST carry the same two actions as the row, behaving
  identically.
- **FR-019**: The card MUST NOT hold the customer's payment history; it
  points the operator to Pagos filtered to that customer.
- **FR-020**: An open card MUST have its own address, so an operator can
  send a colleague the customer they are talking about.

**Freshness and failure**

- **FR-021**: The section MUST say how old the reading behind the list is
  whenever that reading can be older than the moment, and MUST NOT present
  an older reading as current.
- **FR-022**: A provider that is away MUST be a quiet note over the rows
  already on screen, never an error block, and the note MUST say what the
  operator can still do.
- **FR-023**: A provider that refuses the business's credential MUST be
  treated as a setup problem with a door to the integration settings, never
  as a failure offering a retry.
- **FR-024**: A reading that fails with nothing to show MUST say so and
  offer a way to try again, and MUST NOT show an empty list as though the
  ISP had no customers.

**Continuity**

- **FR-025**: The addresses the two previous sections used MUST keep
  working, landing the operator in Clientes; an address carrying a search
  MUST open Clientes on that search, and the address that pointed at the
  debtor list MUST open Clientes with the debt filter applied.
- **FR-026**: Every behaviour the two previous sections had that this
  specification does not change MUST survive the merge, including the
  one-time link-cleanup notice and the empty state that explains where links
  come from for a business whose links are created through the API.

**The seam for what comes next**

- **FR-027**: "The customers who owe right now" MUST be answerable by the
  server on its own, independently of any screen having asked for it, so
  that a later scheduled reminder can walk that set without a browser. This
  feature MUST NOT build the reminder, the queue, the schedule, the channel,
  bulk selection or any delivery state. In this feature that set is the
  customers with open invoices; a customer whose only debt is a carried
  balance joins it at their zone's next billing run (measured 2026-09-23).
  Whether a reminder needs them sooner is that feature's decision.
- **FR-028**: This feature MUST NOT send anything to a customer and MUST NOT
  record that a message was sent. The operator's own device sends, as today.

**Never trust a narrowing you did not verify**

- **FR-029**: Any narrowing of a list that depends on the provider applying
  a filter MUST be verified against an unfiltered control before the result
  is presented as narrowed. Where the provider is known to ignore the
  filter, the narrowing MUST be done from a reading the product can account
  for, and never by asking the provider for it. A screen MUST NOT be able to
  present the unfiltered whole as though it were the filtered part.

### Key Entities

- **Customer**: the person the ISP serves and the subject of the section.
  Identified by their usuario. Carries a name, a phone, a service channel,
  a debt and, once an operator has acted, a payment link. Everything about
  the person is read live from the provider and stored nowhere.
- **Debt**: what one customer owes right now — their pending invoices plus
  their carried balance. Has three possible states: an amount, nothing owed,
  and *cannot be confirmed*. The third is not zero.
- **Pending invoice**: one line of a customer's debt — what it is for, what
  it is worth, when it was issued and when it is due.
- **Payment link**: the customer's permanent payment address. Exists or does
  not; is born from an operator's act, never from being listed; once born it
  is never replaced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From opening the panel, an operator reaches the point of
  sending one debtor their payment reminder in **two actions** — open the
  section, press the button — with no filter to set and no second screen.
- **SC-002**: The panel offers **four** sections where it offered five, and
  no capability that existed in the two merged sections is lost.
- **SC-003**: **100%** of the ISP's customers remain findable, debtors and
  non-debtors alike, on an ISP of at least 6,500 customers.
- **SC-004**: Every customer row states what that customer owes, and in
  **zero** cases does a row show a money amount that was guessed or
  substituted when the true amount could not be read.
- **SC-005**: Opening a customer's card answers "what is this debt made of"
  with figures that match the provider **at the moment of opening**, even
  when the list behind it was read minutes earlier.
- **SC-006**: **Zero** dead addresses: every address the two previous
  sections answered still lands the operator on the equivalent view,
  carrying its search when it had one.
- **SC-007**: Clientes opens **no slower** than the slower of the two
  sections it replaces, on an ISP of at least 6,500 customers — adding the
  amount to a row costs the operator no waiting.
- **SC-008**: The set of customers who owe can be produced without a browser
  session, demonstrated by asking for it outside the screen that displays
  it.

## Assumptions

Reasonable defaults chosen where the description did not decide. Each is a
candidate for `/speckit-clarify`.

- **The section opens on debtors.** Taken from the operator's own described
  workflow, whose second step is "filter to customers with outstanding
  balances" — opening pre-filtered removes that step. An operator who wants
  everyone is one press away.
- **The filter offers four states**: customers with open invoices
  (default, *Con facturas abiertas*), those past due, those not yet due, and everyone. The first three are the filters
  Cobros has today, kept so the merge loses nothing; the fourth is what
  Links was. They read as one strip because the operator thinks of them as
  one axis, even though the first three and the fourth are answered from
  different readings.
- **The debt is shown on every row, under every filter** — including while
  browsing the whole customer base. The premise of the merge is that debt is
  a fact about a customer, not a separate list, so a row without it would
  reopen the split this feature closes.
- **The row shows the two parts and no total; the card shows the total
  beside its breakdown.** A total on the row would fold two readings of
  different freshness into one figure (Clarifications, 2026-09-23); in the
  card, read fresh, the total is explained by the lines above it. Whether
  the row should also carry a total is open for `/speckit-clarify`.
- **The card has its own address** rather than appearing only as a layer
  over the list (FR-020), following the panel's existing rule that anything
  an operator would send to a colleague can be sent as an address.
- **Payment history stays in Pagos.** The read already exists and the card
  links to it. Bringing it into the card is a design problem — two lists in
  one card — worth its own decision later, not a free addition here.
- **Pagos remains its own section.** "What happened to this money" is a
  question about a payment, not about a customer; the customer's card points
  into it rather than absorbing it.
- **The section's route name is English** and its label is es-MX, following
  the panel's existing rule that addresses are English and copy is not.
- **Amounts on rows may be minutes old on a large ISP**, as the debtor list
  already is today, and the section says so rather than hiding it. The card
  is the fresh reading when exactness matters.
- **No data migration.** Links already created keep working untouched; this
  feature changes how customers are presented, not what is stored.

### Dependencies

- The provider reading that lists customers (which carries the balance),
  the reading that lists the tenant's pending invoices, the per-customer
  reading that lists one customer's open invoices in a single call — useful
  for the card's invoices, never for the balance, which it leaves out
  (measured 2026-09-23) — and the invoice detail, which separates a
  folded-in previous balance from the plan line.
- The existing act that creates a customer's payment link and prepares the
  WhatsApp message — shared by both merged sections today and unchanged by
  this feature.
- The existing payments list, which the customer card points into.
- The authorization rules for operating payments, and the CLABE gate.
