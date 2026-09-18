# Feature Specification: Collections Without Software

**Feature Branch**: `claude/paid-links-evaluation-6mmzzq`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "We will take on both fronts to integrate manual link creation and recurring charges tailored for gyms and schools without proprietary software, complementing it with the development of the session-less live switcher to power the lightweight wallet."

## Context

Devolada can collect for a business two ways today, and both of them need
something the business already owns. The ISP panel makes a link out of a
WispHub customer. The collections API makes a link out of the business's own
software. A gym with 300 members and a notebook has neither, so it has no
door at all.

This feature opens that door, and closes the loop on the payer's side:

1. A business creates a payment link **by hand**, from the panel, for a person
   it names itself — no provider connection, no software, no developer.
2. That link can **charge again every period** without anyone touching it, so a
   monthly membership or a monthly tuition asks for itself.
3. The payer's doorway stops being a list of names and becomes **a list of what
   is owed**.

The third is not decoration. Once a payer holds a gym link and a school link,
"which of these do I owe this month?" is a question they cannot answer today
without opening every one of them. And a business that has no way to message
its members is the business that most needs the payer to be able to come back
on their own.

What does not change: the money never touches Devolada. The payer transfers to
the **business's own account** and the transfer is validated against Banxico.
Nothing new happens automatically after a validated payment either — a hand-made
payment tells the business, and the business decides what it means. Devolada
does not open a gym door or enrol a student.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The business creates a payment link by hand (Priority: P1)

A gym owner signs in, types a member's name and what they owe, and gets a link
to send by WhatsApp. That is the whole flow. No integration to configure, no
customer list to import first, nothing to install.

The same form makes both kinds of link: one that **stays open** and is re-priced
whenever the amount changes, and one that carries **a single amount and a
deadline** and closes as soon as it is paid.

**Why this priority**: it is the only thing in this feature a business cannot do
at all today. Everything else here improves a link that already exists; this one
is the difference between having a product for a gym and not having one.

**Independent Test**: sign up a business with a bank account and no provider
connection, create a link from the panel for a named person and an amount, open
that link on a phone, see the amount against that business's account, pay it,
and find the payment in the panel. Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** a business with its bank account set and no provider connection,
   **When** it creates a link for "Ana Ruiz" for $650.00, **Then** it receives a
   shareable link, and opening that link shows $650.00 against that business's
   account with "Ana Ruiz" named on the page.
2. **Given** that link, **When** the business changes the amount to $700.00,
   **Then** the same link asks for $700.00, and a payer who kept the original
   message sees the new amount without being sent anything.
3. **Given** a link created with a single amount and a deadline, **When** the
   payer pays it, **Then** the link closes, and anyone opening it afterwards
   reads a clear es-MX explanation and is offered no account to transfer to.
4. **Given** a business that has never connected a provider, **When** it opens
   the panel's links screen, **Then** it sees its own hand-made links, and no
   refusal, error or empty state that names a provider it does not have.
5. **Given** a hand-made link whose payment is confirmed, **Then** the business
   sees the payment and its receipt, and no provider action is attempted,
   queued or promised anywhere — including when that business also has a
   provider connected for its other links.
6. **Given** a hand-made link and a contact number typed with it, **When** the
   business shares it, **Then** a ready message opens with the link and words
   that name no internet service.
7. **Given** a business that already has a hand-made link under the reference
   `SOC-118`, **When** it creates another under the same reference, **Then** the
   request is refused with a clear reason rather than silently producing a
   second link for one person.

---

### User Story 2 - The charge comes back every period by itself (Priority: P2)

The gym charges the same $650 on the 1st of every month. The owner sets that
once, on the member's link, and then does nothing. Each month the link asks for
the month's amount on its own.

**Why this priority**: it is what turns a link into a membership. It is P2 rather
than P1 because a business can survive the first weeks by re-pricing its links
by hand — US1 already gives it that — but it cannot survive that way at 300
members.

**Independent Test**: put a monthly charge on a hand-made link, move the clock
across a period boundary, and see the link asking for the new period's amount
with nobody having touched it. Needs US1 for the link, nothing else.

**Acceptance Scenarios**:

1. **Given** a hand-made reusable link with a monthly charge of $650.00 on day
   1, **When** day 1 arrives in the business's timezone, **Then** the link asks
   for that period's $650.00 without anyone acting.
2. **Given** that charge, **When** the business changes its amount to $700.00
   mid-period, **Then** the period already running is untouched and the next
   period asks $700.00.
3. **Given** a charge set on day 31, **When** a month without a 31st arrives,
   **Then** the charge is raised on that month's last day, exactly once.
4. **Given** a link with a monthly charge, **When** the business stops the
   charge, **Then** the link stays open and usable and no further period is
   ever raised.
5. **Given** a charge with an end date, **When** that date has passed, **Then**
   no further period is raised and the panel says the charge has ended rather
   than showing it as live.
6. **Given** a link the business has closed, **When** its next period would
   fall due, **Then** nothing is raised.
7. **Given** any link carrying a charge, **When** the business looks at it in
   the panel, **Then** it reads when the next period falls and what it will
   ask.

---

### User Story 3 - The payer's doorway shows what is owed (Priority: P3)

A member of the gym is also a parent at the school. Their phone holds two links.
Opening the bare address shows both, each with the business's name, who the
payment is for, and how much is owed right now — so they can pay the one that is
due and ignore the other.

Nothing is asked of them: no account, no password, no phone number. The device
already holds these links because someone sent them.

**Why this priority**: it needs saved links to be worth listing, which the first
two stories create, and a payer holding a single link never sees this screen at
all. It is last, and it is the reason the other two are worth building together.

**Independent Test**: put two links from two businesses on one device, open the
bare address, and read both balances without opening either link. Then pay one
and watch it fall off the list. Needs US1 for the second business's link.

**Acceptance Scenarios**:

1. **Given** a device holding links from two businesses, **When** the payer
   opens the bare address, **Then** each row names the business, says who the
   payment is for, and shows the amount owed at that moment.
2. **Given** a device holding a link with nothing to pay, **When** the payer
   opens the bare address, **Then** that row says so plainly and cannot be
   mistaken for one that owes money.
3. **Given** a device holding a single-amount link that was paid or whose
   deadline passed, **When** the payer opens the bare address, **Then** that row
   is gone and the payer is never offered a dead link.
4. **Given** a device holding exactly one link, **When** the payer opens the
   bare address, **Then** they land on that payment as they do today and never
   meet the list.
5. **Given** a device holding no links, **When** the payer opens the bare
   address, **Then** they read the same invitation to ask the business for their
   link, with no field, search or lookup of any kind.
6. **Given** a device holding links, **When** the balances cannot be read at all
   — the phone is offline — **Then** the rows still appear with their names, the
   payer can still open any of them, and nothing reads as broken.
7. **Given** a device holding links from two businesses, **When** one business's
   row cannot be read and the other can, **Then** the readable row shows its
   amount and the other says its state is unknown, and neither blocks the other.
8. **Given** a link the business has deleted, **When** the payer opens the bare
   address, **Then** the row is dropped from this device.

---

### Edge Cases

- **A period falls due while the payer has the page open.** The payer is looking
  at last period's amount and transfers it. The page must not silently swap the
  number under them, and the transfer they make must be reconciled against what
  they were shown.
- **The member pays the same reusable link twice in one period.** The second
  transfer is real money that arrived; it must be visible to the business and
  never rejected as a duplicate.
- **Two periods pass with nothing paid.** What the link asks on the third is the
  open question this spec carries — see FR-024.
- **A deadline set in the past at creation.** A legitimate way to make a link
  that is closed from birth; the page explains it rather than erroring.
- **The business has no bank account set.** The link exists but the page says the
  channel is unavailable, as it already does for every other channel.
- **The business has run out of prepaid balance.** The payment is accepted and
  held, exactly as it is today for any other link; it is not refused, and the
  payer is told it is still being checked rather than shown a failure.
- **The business is suspended.** No period is raised and the page says so
  instead of collecting transfers into limbo.
- **A business with a provider connection makes a hand-made link.** The link
  belongs to nobody in that provider, so no action follows its payment, and the
  panel does not offer one.
- **Two members with the same name.** Both links are valid and must be
  distinguishable in the panel by something other than the name.
- **A device holding many links** — twenty, say, from years of use. The doorway
  must stay readable and fast, and must not make the payer scroll past dead rows
  to reach a live one.
- **The payer's device clock is wrong.** A deadline belongs to the business's
  timezone; the payer's phone never decides whether a link is still open.
- **A period's day is set to 29 February.** The rule that handles a missing day
  must survive a non-leap year without skipping or doubling.

## Requirements *(mandatory)*

### Functional Requirements

#### Links made by hand

- **FR-001**: A business MUST be able to create a payment link from the panel
  without any provider connection and without software of its own.
- **FR-002**: Creating a link MUST require only the payer-facing name and the
  amount. A description, a reference of the business's own, and a contact number
  are optional.
- **FR-003**: The business MUST choose, at creation, between a **reusable** link
  that stays open and is re-priced, and a **single-amount** link that carries a
  deadline and closes when it is paid — the same two kinds the collections API
  already offers.
- **FR-004**: A single-amount link MUST carry a deadline; a reusable link MUST
  NOT carry one, and asking for one MUST be refused rather than ignored.
- **FR-005**: The business MUST be able to change the amount on a reusable
  hand-made link at any time, and a payer opening the link MUST see the current
  amount whatever message brought them there.
- **FR-006**: The business MUST be able to close a hand-made link. A closed link
  MUST refuse new payments, explain itself in es-MX, and offer no account to
  transfer to.
- **FR-007**: A payer MUST NOT be able to tell a hand-made link from one made by
  the ISP panel or by the collections API — the same page, the same steps, the
  same words.
- **FR-008**: A confirmed payment on a hand-made link MUST perform no provider
  action and MUST promise none, in any configuration, including a business that
  has a provider connected for its other links.
- **FR-009**: The panel's links list MUST show hand-made links beside links from
  every other channel, each row naming its channel as icon and text, and MUST
  NOT refuse, warn or mention a provider to a business that has none.
- **FR-010**: A business MUST be able to give a hand-made link a reference of its
  own, unique per business among reusable links; a repeat MUST be refused with a
  reason, never silently duplicated.
- **FR-011**: Sharing a hand-made link MUST produce a ready message that carries
  the link and names no internet service.
- **FR-012**: An amount MUST be a positive whole amount of money; a fractional
  or zero amount MUST be refused naming the field.
- **FR-013**: Creating, re-pricing and closing a hand-made link MUST be governed
  by the same area and action that governs operating payments, never by a named
  screen or button.
- **FR-014**: A hand-made link MUST be visible only to its own business, and MUST
  never appear in another business's panel, list, search or export.

#### Charges that repeat

- **FR-015**: A business MUST be able to attach a recurring charge to a reusable
  hand-made link: an amount, and the day of the month it falls due.
- **FR-016**: Each period MUST be raised exactly once, on its day, in the
  **business's timezone** — never the payer's, never the server's.
- **FR-017**: When the chosen day does not exist in a month, the charge MUST be
  raised on that month's last day, once.
- **FR-018**: Changing a charge's amount MUST take effect from the next period;
  the period already running MUST NOT change under a payer.
- **FR-019**: A business MUST be able to stop a charge at any time. Stopping it
  MUST leave the link open and usable and raise no further period.
- **FR-020**: A business MUST be able to give a charge an end date, after which
  no period is raised and the panel shows the charge as ended rather than live.
- **FR-021**: No period MUST be raised on a link that is closed, or for a
  business that is suspended.
- **FR-022**: The panel MUST show, for every link carrying a charge, when the
  next period falls due and what it will ask.
- **FR-023**: A recurring charge MUST be attachable only to a reusable hand-made
  link. A link whose amount comes from a provider or from the business's own
  software keeps that source as its only truth.
- **FR-024**: When a period falls due and the previous period was not paid, the
  link MUST [NEEDS CLARIFICATION: do unpaid periods accumulate on the link so
  the member owes the sum, or does each new period replace the last so only the
  current one is ever asked for? A gym and a school answer this differently, and
  the answer decides whether a link can ever show a growing debt.]
- **FR-025**: When a new period falls due, the payer MUST learn about it by
  [NEEDS CLARIFICATION: the business sending the link itself from the panel as
  it does today; the payer's own doorway being the notice, so they check it;
  or Devolada messaging the payer directly, which would be a new channel, a new
  cost and a new consent to obtain.]

#### The payer's doorway

- **FR-026**: The doorway MUST show, for every link this device holds: the
  business's name, who the payment is for, the amount owed at that moment, and
  the link's state — as icon and text, never colour alone.
- **FR-027**: The doorway MUST require no account, no session, no password and
  no identification of any kind.
- **FR-028**: The doorway MUST offer no way to find a link this device was not
  given — no search, no lookup by phone, name, reference or amount.
- **FR-029**: A link that is closed, expired or deleted MUST disappear from the
  doorway without the payer having to remove it.
- **FR-030**: The payer MUST still be able to remove a link from this device by
  hand, for a link that is simply not theirs.
- **FR-031**: The doorway MUST remain usable when the balances cannot be read:
  the rows appear with the names the device already knows, every link still
  opens, and nothing reads as broken or empty.
- **FR-032**: A partial failure MUST be partial: an unreadable row says its state
  is unknown while every other row shows its amount.
- **FR-033**: A device holding exactly one link MUST go straight to that payment,
  and a device holding none MUST read the same invitation to ask the business —
  both unchanged from today.
- **FR-034**: The doorway MUST return, for each link, only what that link's own
  payment page already shows to whoever opens it, and nothing further about the
  business it belongs to.
- **FR-035**: A business MUST be able to bring in its existing members
  [NEEDS CLARIFICATION: one at a time only in the first version, leaving volume
  to the collections API; or by pasting or uploading a list of names, references
  and amounts that becomes many links at once. A school with 400 students cannot
  adopt this feature one form at a time.]

### Key Entities

- **Hand-made link**: a payment link a business created in the panel for a person
  it names itself. Carries the payer-facing name, the amount, and optionally a
  description, the business's own reference and a contact number. Comes in the
  same two kinds as a link from the collections API, and is one row for the whole
  life of the payments made against it.
- **Recurring charge**: the rule that puts an amount back on a reusable hand-made
  link every period. Carries the amount, the day it falls due, when it starts,
  when it ends if ever, and when it last ran — so a period can never be raised
  twice or skipped in silence.
- **The payer's doorway**: what a device shows at the bare address — one row per
  link this device has been handed, each carrying what it owes right now. It is
  not an account: it holds nothing this device was not already given, and a new
  phone starts empty.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A business with no software and no provider connection goes from
  signing in to a shareable payment link in under 2 minutes, unaided and without
  reading documentation.
- **SC-002**: A business charging the same 50 people every month takes zero
  actions between one month and the next, and every one of those 50 links asks
  for the new period's amount on the right day.
- **SC-003**: A payer holding links from three businesses learns which ones owe
  money from one screen, without opening any of them.
- **SC-004**: A payer who has paid a single-amount link never sees it again, and
  never opens a link that cannot take a payment.
- **SC-005**: 100% of hand-made links show the payer the same page as a link from
  any other channel — no differing word, screen, step or delay.
- **SC-006**: No confirmed payment on a hand-made link triggers or promises a
  provider action, in any configuration of the business.
- **SC-007**: The doorway shows its balances within 2 seconds for a device
  holding 10 links, and still opens every link when no balance can be read.
- **SC-008**: Across a simulated year, every recurring charge is raised exactly
  once per period on the correct day in the business's timezone, including
  months lacking the chosen day and a non-leap February — zero skips, zero
  doubles.
- **SC-009**: A business can correct a wrong amount, a wrong name or a wrong
  person on a hand-made link without the payer needing a new link.

## Constitution Impact

- **Principle V (tenant isolation)** — the doorway reads several links at once,
  and those links may belong to different businesses. This is not a query that
  crosses businesses: each link the device holds authorises exactly itself, and
  the answer for it carries only what the payer can already see by opening it.
  It is several single-link reads the payer could make one at a time. The
  reading is written here so nobody later mistakes it for an exception; FR-034
  is its enforceable form.
- **Purpose** — no amendment needed. The purpose already reads "Mexican
  businesses collect payments by SPEI, with dedicated downstream automation for
  ISPs" since v1.2.0. A gym and a school are inside it, and FR-008 is exactly
  what "dedicated to ISPs" means: the automation does not follow them.
- **Principle VI (visual foundations)** — the doorway becomes a screen that
  carries status, so status is icon plus text and comes from the single status
  representation; the list must hold at 360px and the decisive action keeps its
  size.
- **Principle VIII (absent configuration degrades)** — a business with no bank
  account still creates links; the payer's page says the channel is unavailable
  rather than showing an account nothing can validate.
- No principle is added, removed or redefined by this feature.

## Assumptions

- **Monthly is the only period in the first version.** Both named cases — a gym
  membership and a school tuition — are monthly. Weekly, fortnightly and annual
  are deferred, not designed out.
- **The payer pays the same service fee and the business spends the same
  prepaid balance per validation as on any other link.** This feature changes
  who can make a link, not what a payment costs.
- **No payer identity is created.** The link the business sent stays the only
  thing tying a payer to a payment. A new phone starts empty and the business's
  message is the way back — the same trade this product already made.
- **Hand-made links do not join any provider's customer list.** They are the
  business's own record, and a provider never learns about them.
- **A hand-made link's payment is announced, never acted on** — the same rule
  the collections API already carries for the same reason.
- **The business's own timezone owns every due date**, defaulting to
  `America/Mexico_City`, as "today" already does everywhere else in the product.
- **Businesses are admitted by open sign-up**, as they are today. Who may be
  admitted, and whether identity is checked before anyone collects, remains the
  open question the constitution carries — this feature widens who finds the
  product useful, not who is let in.
- **A member's name is the payer-facing label**, and two members may share one.
  The business's own reference, when it gives one, is what makes them distinct.

## Dependencies

- The business has set its own bank account — without it, a hand-made link
  exists but its page says the channel is unavailable.
- The panel's links screen, the payer's payment page, and the validation path
  are all reused as they are; this feature adds a way to make links and a way to
  list them, not a second payment flow.
- Charges fall due on their own, with nobody opening a screen — the product
  already does unattended periodic work and this joins it rather than standing
  up something of its own.
- The payer's doorway builds on what the device already saves; this feature makes
  those saved links live, it does not invent the saving.

## Out of Scope

- A payer account, login, or any identity that survives changing phones.
- Any automatic action after a hand-made payment — opening a door, enrolling a
  student, granting access, printing a card.
- Card payments, cash, or Devolada holding money at any moment.
- Late fees, interest, dunning ladders, or any penalty raised automatically.
- A customer roster separate from links; the link is the record for this channel,
  as it already is for the collections API.
- Weekly, fortnightly, quarterly and annual periods.
- Reminders sent by Devolada on any channel, unless FR-025 is answered that way.
