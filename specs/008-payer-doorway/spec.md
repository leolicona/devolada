# Feature Specification: The Payer's Doorway

**Feature Branch**: `claude/paid-links-evaluation-6mmzzq`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "We will take on both fronts to integrate manual link creation and recurring charges tailored for gyms and schools without proprietary software, complementing it with the development of the session-less live switcher to power the lightweight wallet." — narrowed by the creator the same day: "If we build for what exists now and defer in a next feature the support to customers without software, just build the part link.devoladapago.com."

## Context

`link.devoladapago.com` is where a payer lands when a business sends them their
payment link. The device already keeps every link it was handed, so a payer who
returns to the bare address finds a shortcut instead of a dead end: one saved
link opens straight through, several show a chooser.

The chooser shows names. Nothing else.

This feature is that one change: make it show **what is owed**. A payer holding
a link from their ISP and a link from their gym should see which one wants money
from a single screen, without opening either.

Nothing else moves. No new way to make a link — this works with the links that
exist today, from the ISP panel and from the collections API, and any channel
added later inherits it for free. No account, no login, no identity. The device
keeps what it was given, and that stays the only thing tying a payer to a
payment.

**Why "doorway" and not "wallet".** A wallet holds your things and follows you
to a new phone. This holds only what somebody sent to *this* device, it grants
nothing the payer did not already have, and a new phone starts empty. Calling it
a wallet would promise a recovery story that does not exist. It is a doorway:
the way back in, for a device that has already been through it.

**What is deliberately not here.** Making links by hand from the panel, and
charging them every month — the gym-and-school half of this conversation — is a
larger feature that needs the panel and deserves its own spec. This half can be
built against what already exists, and it is the half a payer feels.

## Clarifications

### Session 2026-09-18

- Q: How does a payer learn that they owe money? → **A: Their own doorway is the
  notice.** Devolada sends nothing to anyone who did not ask for it, and the
  business is not required to send anything for a debt to become visible. A
  payer who saved their link can see what they owe by opening the address they
  already have. This is the whole reason the feature exists.
- Q: Should the device also raise its hand when something falls due? → **A: Yes,
  but not here.** Devolada can reliably tell a payer only about a change it
  caused itself. Today a debt changes inside a business's own provider or its
  own software, where the product would have to go looking to notice. Once the
  product raises the charge itself, the moment to notify is exactly known. The
  notice therefore ships with the periodic charges, not with the doorway — see
  *Deferred*.
- Q: Does this need links made by hand from the panel first? → **A: No.** The
  doorway reads the links that exist today. Building it now means the payer-side
  half lands without waiting on the panel-side half, and the panel-side half
  inherits a working doorway on the day it lands.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The doorway shows what is owed (Priority: P1)

A customer pays their ISP through Devolada and also pays their gym through it.
Both links are on their phone. They open the bare address and read two rows:
the ISP wants $499.00, the gym wants nothing this month. They tap the ISP and
pay it.

They were asked for nothing to make this happen — no account, no password, no
phone number. The device already held both links because somebody sent them.

**Why this priority**: it is the feature. Everything else here protects it.

**Independent Test**: put two links from two businesses on one device, open the
bare address, and read both balances without opening either link. Needs nothing
from the other stories.

**Acceptance Scenarios**:

1. **Given** a device holding links from two businesses, **When** the payer opens
   the bare address, **Then** each row names the business, says who the payment
   is for, and shows the amount owed at that moment.
2. **Given** a row showing an amount, **When** the payer opens that link,
   **Then** the payment page asks for the same amount — the row never disagrees
   with the page behind it.
3. **Given** a device holding a link with nothing to pay, **When** the payer
   opens the bare address, **Then** that row says so plainly and cannot be
   mistaken for one that owes money.
4. **Given** a device holding two links that happen to name the same person —
   the payer themselves, at two businesses — **When** the payer opens the bare
   address, **Then** the two rows are told apart at a glance, because each names
   its business.
5. **Given** a device holding several links where only some owe money, **When**
   the payer opens the bare address, **Then** what is owed is read first.
6. **Given** a device holding exactly one link, **When** the payer opens the bare
   address, **Then** they land on that payment as they do today and never meet
   the list.
7. **Given** a device holding no links, **When** the payer opens the bare
   address, **Then** they read the same invitation to ask their business for the
   link, with no field, search or lookup of any kind.

---

### User Story 2 - The list stays true (Priority: P2)

Months pass. A link the payer paid once and a link their business deleted are
both still on the phone. Neither should be offered again, and the payer should
never have to tidy up after the product.

**Why this priority**: a list that fills with dead rows stops being read. It is
P2 rather than P1 because a doorway with stale rows still beats a doorway with
only names — but only for a while.

**Independent Test**: pay a single-amount link, return to the bare address, and
confirm the row is gone without the payer removing it. Needs US1.

**Acceptance Scenarios**:

1. **Given** a device holding a single-amount link that the payer has paid,
   **When** they open the bare address, **Then** that row is gone.
2. **Given** a device holding a link whose deadline has passed, **When** they
   open the bare address, **Then** that row is gone.
3. **Given** a link the business has deleted, **When** the payer opens the bare
   address, **Then** the row is dropped from this device.
4. **Given** a row that is simply not theirs — a link sent to the wrong person —
   **When** the payer says so, **Then** it is removed from this device and does
   not return on the next visit.
5. **Given** a business that changed an amount since the payer last looked,
   **When** they open the bare address, **Then** they read the new amount, never
   the one this device saw last time.

---

### User Story 3 - The doorway never becomes a dead end (Priority: P3)

The payer is on the metro with one bar of signal, or their ISP's system is down.
The doorway must still get them to a payment, and must never look broken.

**Why this priority**: it is the difference between a screen a payer trusts and
one they stop opening. It is last because the first two have to exist to be
protected, and because a payer on good signal never sees any of it.

**Independent Test**: make every balance unreadable and confirm the payer can
still reach and open all of their links, with nothing reading as an error.
Needs US1.

**Acceptance Scenarios**:

1. **Given** a device holding links and no usable connection, **When** the payer
   opens the bare address, **Then** the rows still appear with the names the
   device knows, every link still opens, and nothing reads as broken or empty.
2. **Given** two links from two businesses where one balance can be read and the
   other cannot, **When** the payer opens the bare address, **Then** the readable
   row shows its amount and the other says its state is unknown, and neither
   blocks the other.
3. **Given** one business that answers quickly and one that is slow, **When** the
   payer opens the bare address, **Then** the fast row appears without waiting
   for the slow one.
4. **Given** a row whose balance is still being read, **When** the payer looks at
   it, **Then** it shows that it is working — breathing, never spinning — and
   the payer can open it anyway.
5. **Given** a device whose saved list has been damaged or cleared, **When** the
   payer opens the bare address, **Then** it behaves exactly as a device holding
   nothing, and never fails.

---

### Edge Cases

- **A row and its page disagree.** The payer reads $499 on the doorway, opens
  it, and the page says $612 because an invoice landed in between. The page is
  the truth; the doorway must never be the number a transfer is built on.
- **A business changes an amount while the doorway is open.** The payer must not
  have a number swap under their eyes without the screen saying something moved.
- **A device holding many links** — twenty, from years of use. The doorway must
  stay readable, must not read every one of them at once, and must not make the
  payer scroll past dead rows to reach a live one.
- **A link that was never real.** A made-up address must read exactly like a
  deleted one; nothing about it may reveal whether it ever existed.
- **A stolen or borrowed phone.** Whoever holds the device sees what the owner
  owes — which is already true of every saved link today. The doorway must not
  make it worse by adding anything the links themselves do not carry.
- **A business is suspended, or has no bank account set.** The row says the
  payment cannot be taken right now rather than showing an amount nobody can
  pay.
- **A payer who removed a link and then opens it again** from the original
  message. It comes back, as it should — opening a link is how a device is
  given one.
- **Every balance is unknown at once.** The screen must still read as a list of
  the payer's payments, not as an error page with rows on it.
- **A payer with one saved link that has nothing to pay.** They still go
  straight through, and the payment page tells them there is nothing owed — the
  doorway does not invent a reason to show a list of one.

## Requirements *(mandatory)*

### Functional Requirements

#### What the doorway shows

- **FR-001**: The doorway MUST show, for every link this device holds: the
  business's name, who the payment is for, the amount owed at that moment, and
  the link's state — as icon and text, never colour alone.
- **FR-002**: Every row MUST name its business. Two links that happen to carry
  the same person's name MUST be distinguishable without opening either.
- **FR-003**: The amount on a row MUST be the amount that link's own payment page
  would show at the same moment, read from the same source. The doorway
  introduces no second opinion about what anyone owes.
- **FR-004**: A link with nothing to pay MUST say so plainly, and MUST NOT be
  presented in a way that can be read as owing money.
- **FR-005**: A link that cannot take a payment right now — a suspended business,
  a business with no account set — MUST say that, rather than showing an amount.
- **FR-006**: Rows MUST be ordered so that what is owed is read first.
- **FR-007**: The doorway MUST be the way back, never the place a transfer is
  built: the payment page remains the only screen that states the amount to
  transfer and the account to send it to.

#### What the doorway is not

- **FR-008**: The doorway MUST require no account, no session, no password and no
  identification of any kind.
- **FR-009**: The doorway MUST offer no way to find a link this device was not
  given — no search, no lookup by phone, name, reference or amount.
- **FR-010**: The doorway MUST return, for each link, only what that link's own
  payment page already shows to whoever opens it, and nothing further about the
  business it belongs to.
- **FR-011**: A link that does not exist MUST be indistinguishable from one that
  was deleted or was never this device's. Nothing in the answer may reveal
  whether an address was ever real.
- **FR-012**: A device holding exactly one link MUST go straight to that payment,
  and a device holding none MUST read the same invitation to ask the business —
  both unchanged from today.

#### Staying true

- **FR-013**: A link that is closed, expired or deleted MUST disappear from the
  doorway without the payer having to remove it.
- **FR-014**: The payer MUST be able to remove a link from this device by hand,
  and a link removed that way MUST NOT return on the next visit.
- **FR-015**: Opening a link MUST be what gives this device that link, so a payer
  who removed one by mistake gets it back from the original message.
- **FR-016**: The doorway MUST read every balance fresh on arrival; an amount
  this device saw on a previous visit MUST NOT be presented as current.

#### Never a dead end

- **FR-017**: When no balance can be read at all, the rows MUST still appear with
  the names the device already knows, every link MUST still open, and nothing
  MUST read as broken, empty or errored.
- **FR-018**: A partial failure MUST be partial: an unreadable row says its state
  is unknown while every other row shows its amount.
- **FR-019**: Rows MUST appear as they resolve. A slow business MUST NOT delay a
  fast one, and the payer MUST be able to open any link before every balance has
  arrived.
- **FR-020**: A row still being read MUST show that it is working, using the
  product's existing waiting vocabulary — nothing on the payer's screen spins or
  bounces.
- **FR-021**: The doorway MUST bound how many links it reads at once; links
  beyond that bound MUST still be listed and openable, and MUST resolve when the
  payer asks for them.
- **FR-022**: A saved list that is unreadable, damaged or refused by the device
  MUST be treated as holding nothing, and the doorway MUST work from there.

### Key Entities

- **A saved link**: one payment link this device has been handed, kept on the
  device alone. It carries only what the device needs to find its way back —
  never a name, an amount or a state remembered from last time, because those
  are read fresh (FR-016).
- **A doorway row**: one saved link resolved to what it owes right now — the
  business, the person, the amount, the state. It exists only while the screen
  is open, and it is a reading, never a truth a transfer is built on (FR-007).
- **The payer's doorway**: what the bare address shows — the rows for the links
  this device holds. It is not an account: it holds nothing this device was not
  already given, it grants nothing the payer did not already have, and a new
  phone starts empty.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A payer holding links from three businesses learns which of them
  owe money from one screen, without opening any of them.
- **SC-002**: Every amount on the doorway equals what that link's own page shows
  at the same moment — no row ever disagrees with the page behind it.
- **SC-003**: A payer who has paid a single-amount link never sees it again, and
  never opens a link that cannot take a payment.
- **SC-004**: For a device holding five links, the first row is readable within 1
  second and every reachable balance within 3 seconds.
- **SC-005**: With every balance unreadable, 100% of saved links still open, and
  the screen reads as a list of the payer's payments rather than as an error.
- **SC-006**: No two rows on one device read identically; a payer can always tell
  which payment is which at a glance.
- **SC-007**: Nothing on the doorway can be reached without a link this device
  was given: no search, no enumeration, and no answer that reveals whether an
  unknown address was ever real.
- **SC-008**: A device holding one link, or none, behaves exactly as it does
  today — no new screen, no new step, no new wait.
- **SC-009**: A payer on a phone at 360px reads every row without horizontal
  scroll, and every row's action meets the product's touch size.

## Constitution Impact

- **Principle V (tenant isolation)** — the doorway reads several links at once,
  and those links may belong to different businesses. This is not a query that
  crosses businesses: each link the device holds authorises exactly itself, and
  the answer for it carries only what the payer can already see by opening it.
  It is several single-link reads the payer could make one at a time. The
  reading is written here so nobody later mistakes it for an exception; FR-010
  and FR-011 are its enforceable form.
- **Principle VI (visual foundations)** — the doorway is the payer's screen, so
  its rules apply in full: status is icon plus text from the one status
  representation, a row that is still reading breathes rather than spins, the
  list holds at 360px, and the copy is es-MX.
- **Principle VIII (absent configuration degrades)** — a business whose debt
  source cannot be reached makes its row unknown, loudly and in words. The
  doorway keeps working around it, and no payer meets a void.
- **Purpose** — no amendment needed, and none is implied. This feature adds no
  channel, no automation and no custody; it reads what the product already knows
  and shows it to the person it is about.
- No principle is added, removed or redefined by this feature.

## Assumptions

- **The doorway stays per-device.** A new phone starts empty and the business's
  original message is the way back. This is the trade the payment page already
  made by having no session, and this feature does not reopen it.
- **It works with the link channels that exist today** — the ISP panel and the
  collections API — and any channel added later inherits it without new work.
- **A payer holds a handful of links.** Two or three is the normal case; ten is
  the stress case; twenty is the reason FR-021 exists.
- **A labelled stale reading beats a spinner.** Where a balance cannot be had
  right now, saying so is better than making the payer wait for it — the payer
  came here to reach a payment, not to watch one load.
- **Nothing is added to what a saved link already exposes.** Whoever holds the
  device could already open every one of these links and read the same numbers;
  the doorway saves them the taps and nothing more.
- **The business's own timezone still owns every deadline**, as it does
  everywhere else in the product; the payer's phone never decides whether a link
  is still open.

## Dependencies

- The links that exist today, and the per-link page that already resolves one of
  them. This feature adds a way to read several at once; it invents no link, no
  payment flow and no source of truth.
- Each business's own debt source stays the truth behind its rows — a
  provider-backed link still reads its provider, an API link still reads what
  its caller set.
- What the device already saves. This feature makes those saved links live; it
  does not invent the saving.

## Deferred

Each of these was specified in this branch's earlier history and deliberately
taken back out, so the doorway could ship against what exists. The work is in
the git history of `specs/008-collections-without-software`, and is the starting
point when each is specified on its own.

- **Links made by hand from the panel, and charges that repeat every period** —
  the gym-and-school half. A business with no provider and no software of its
  own still has no door into Devolada; this is the feature that opens it. Its
  open decisions were already answered: an unpaid period accumulates or replaces
  by the business's choice per link, and members are added one at a time with
  volume left to the collections API.
  **Brought back by**: being specified next, on its own.
- **A device raising its hand when a period falls due.** Answered yes, and moved
  here for a reason worth keeping: the product can reliably tell a payer only
  about a change it caused itself. While the amount changes inside a business's
  provider or its own software, there is no moment the product owns to notify
  about. Once the product raises the charge, there is.
  **Brought back by**: the periodic charges above, which make it easy.
- **Devolada messaging payers directly**, by WhatsApp or SMS. The only thing
  that removes the monthly work completely, and the largest: a provider, a real
  cost per message, consent to collect and keep, and Devolada speaking to people
  who never signed up with it.
  **Brought back by**: evidence that the doorway and the device notice are not
  reaching enough payers to collect.
- **A payer identity that survives a new phone.** It would need a login, and the
  payment page's whole design rests on having none.
  **Brought back by**: a payer who loses their links often enough to matter, and
  a decision to accept an account on the payer's side.

## Out of Scope

- An account, login, password or any recovery for the payer.
- Any way to find a link that was not given to this device.
- Paying from the doorway without opening the link; the payment page stays the
  one place a transfer is built.
- Devolada sending anything to a payer on any channel.
- Any new way to create a link, or any change to how an amount is decided.
- Card payments, cash, or Devolada holding money at any moment.
