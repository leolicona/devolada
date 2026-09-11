# Feature Specification: automated-collections-api

**Feature Branch**: `claude/devoladapago-wisphub-integration-cqz6xp`

**Created**: 2026-09-11

**Status**: Draft — 3 open questions

**Input**: User description: "We are going to develop an API that allows other services to generate payment links to send to customers, verify customer payments directly from their own platforms, receive automated notifications once transfers are validated, and view the history of received transfers. The goal is to automate customer collections without manual intervention, reconcile bank transfers in real time, and streamline customer support."

## Summary

Today a person collects. Someone opens the panel, finds the customer, copies the
link, sends it, and later comes back to see whether the money arrived. Devolada
already does the hard half — the permanent link, the SPEI transfer to the
business's own CLABE, the Banxico validation — but a human still starts it and a
human still watches it.

This feature gives that whole loop to the business's own software. Its system
asks for a link, sends it however it already talks to its customers, and is told
the moment Banxico confirms the transfer. Nobody opens Devolada to collect, and
nobody opens Devolada to find out whether a customer paid.

The money never changes hands differently: the payer still transfers to the
business's CLABE, Consta still validates it against Banxico, and Devolada still
holds no money at any point. What is new is who does the asking and who gets
told.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The caller's own system creates the payment link (Priority: P1)

A business connects its platform to Devolada once: it turns the API on in the
panel and gets a credential. From then on, when its system decides a customer
owes money, it asks Devolada for a payment link with its own customer reference
and the amount. It gets back a link it can put in its own WhatsApp message, its
own portal, or its own invoice email.

The payer's experience does not change at all: the same page, the same CLABE,
the same concept, the same es-MX copy.

**Why this priority**: it is the one that removes the manual step the feature
exists to remove. A business that can only do this much already stops copying
links by hand — it can still watch outcomes in the panel while the rest arrives.

**Independent Test**: issue a credential in the panel, call the API with a
customer reference and an amount, open the returned link in a browser, and see
the right amount and the business's own CLABE. Needs nothing from the other
stories.

**Acceptance Scenarios**:

1. **Given** a business with a credential and a configured CLABE, **When** its
   system asks for a link for customer reference `CLI-4471` owing $499.00 MXN,
   **Then** it receives a link, and opening that link shows a payment page
   asking for that amount against that business's CLABE.
2. **Given** the same business, **When** it asks a second time for the same
   customer reference with the same amount and its own idempotency key, **Then**
   it receives the same link rather than a second one.
3. **Given** a business whose CLABE is not configured, **When** its system asks
   for a link, **Then** the request is refused with a reason the developer can
   act on, and no link that would show an empty CLABE is created.
4. **Given** a business without a credential, **When** a request arrives with no
   or an unknown credential, **Then** it is refused and nothing about the
   business is revealed.
5. **Given** a credential belonging to business A, **When** it asks for a link
   using a customer reference that exists in business B, **Then** a link is
   created for business A only, and nothing of business B is read or returned.

---

### User Story 2 - The caller is told the moment the transfer is validated (Priority: P2)

The business registers one address where Devolada should announce outcomes. When
a payment reaches its verdict, Devolada calls that address with what happened:
which customer reference, how much arrived, whether it matched what was asked,
and the folio. The caller's system does the rest on its own — marks the invoice
paid, restores the service, thanks the customer — without anybody watching.

An announcement that fails is retried. An announcement that keeps failing is
never lost: it stays readable, and the business can see that its endpoint is the
thing that is broken.

**Why this priority**: this is what "without manual intervention" means. US1
still requires someone to ask "did they pay?"; this closes the loop.

**Independent Test**: register a receiving address, drive one payment to a
confirmed verdict, and assert the announcement arrives with the payment's facts,
carries proof it came from Devolada, and is retried when the address answers with
an error.

**Acceptance Scenarios**:

1. **Given** a business with a receiving address registered, **When** a payment
   on an API-created link is confirmed, **Then** the address is called within
   seconds with the customer reference, the amount that arrived, the amount that
   was asked, the match result, the folio, and the moment of the verdict.
2. **Given** the same announcement, **When** the caller checks it, **Then** it
   can prove the message came from Devolada and was not altered, and can tell
   whether it has already seen this exact event.
3. **Given** a receiving address that answers with an error, **When** Devolada
   announces, **Then** it retries on a widening schedule, and stops after the
   schedule is spent with the failure visible to the business.
4. **Given** a receiving address that never answers in time, **When** the
   announcement times out, **Then** the payment's own record is unaffected — the
   money stays confirmed and the payer sees success.
5. **Given** a payment that ends in a verdict other than confirmed (it arrived
   short, it arrived against no debt, it was never validated), **Then** the
   caller is told about that outcome too, named so its system can tell the
   difference.
6. **Given** a business with no receiving address registered, **When** a payment
   is confirmed, **Then** nothing is announced and nothing fails.

---

### User Story 3 - The caller asks about a payment at any moment (Priority: P3)

Someone at the business — a support agent inside its own tool, or its system
after a restart — needs to know whether a specific customer paid. It asks
Devolada by its own customer reference or by the payment's identifier and gets
the current state in one answer.

This is also the safety net under US2: an announcement that was missed while the
caller's platform was down is never a hole, because the state can always be
asked for.

**Why this priority**: it makes support answerable without leaving the tool the
agent already has open, and it is what makes the notification path safe to
depend on.

**Independent Test**: create a link, drive a payment through each of its states,
and at every step ask the API for its state and get the truth.

**Acceptance Scenarios**:

1. **Given** a customer reference with one payment under validation, **When**
   the caller asks, **Then** it is told the payment is still being validated and
   what it was asked to be.
2. **Given** the same reference after confirmation, **When** the caller asks,
   **Then** it is told the payment is confirmed, with the folio, the amount that
   arrived, and the moment of the verdict.
3. **Given** a customer reference with no payment at all, **When** the caller
   asks, **Then** it is told plainly that nothing was received — not an error.
4. **Given** a credential from another business, **When** it asks about this
   payment, **Then** it is told the payment does not exist, and nothing about it
   leaks.

---

### User Story 4 - The business reconciles the transfers it received (Priority: P4)

At the end of a day, a week or a month, the business's system pulls every
transfer Devolada validated for it, in a stable order, and matches it against its
own books. A support agent looking for "that payment on Tuesday for about $500"
can narrow the list without knowing the folio.

**Why this priority**: reconciliation is the reason a finance person trusts the
channel, but it is the last thing needed — the first three stories already
collect money and act on it.

**Independent Test**: confirm several payments across several days, pull the
history with a date range and with a page size, and assert every payment appears
exactly once across the pages, in a stable order.

**Acceptance Scenarios**:

1. **Given** a business with payments across three days, **When** its system
   asks for the transfers received between two dates, **Then** it gets exactly
   those, each with its customer reference, amount received, match result, folio
   and verdict moment.
2. **Given** a history longer than one page, **When** the caller walks the
   pages, **Then** every payment appears exactly once and none is skipped, even
   when new payments arrive while it is walking.
3. **Given** a date range expressed in days, **When** the business is in
   `America/Mexico_City`, **Then** "Tuesday" means Tuesday in the business's
   timezone and never the caller's or the server's.
4. **Given** a transfer that arrived but matched no link, **When** the business
   pulls its history, **Then** that money is visible too, marked as not applied
   to any customer, so the books can be squared.

---

### Edge Cases

- **The payer sends the wrong amount.** The link asked for $499.00 and $450.00
  arrives. The payment is real and the money is the business's; the caller is
  told what arrived, what was asked, and that it fell short. Devolada does not
  decide what the business does about it — the caller's system does.
- **The payer pays twice.** Two transfers against one link are two payments with
  two identifiers, each announced on its own. A caller must never see the second
  as a repeat of the first.
- **The same announcement arrives twice.** A retry after a delivery that
  actually landed is possible. Every announcement carries an identity the caller
  can use to recognise a repeat, so a customer is never credited twice.
- **The caller asks for the same link twice.** Asking again for a link that is
  still open returns the link that already exists, never a second one — so a
  retried request after a network failure cannot leave two links chasing one
  customer.
- **The receiving address is slow or down.** The announcement waits, retries and
  eventually gives up; the payment itself is never held back, never rejected,
  and never re-validated because of it.
- **The credential is revoked while links are live.** The API stops answering
  immediately. Links already in a customer's hands keep working — the business
  asked for that money and the payer must not meet a dead page.
- **A transfer arrives that matches no link at all.** The money is real and
  already in the business's account. It appears in the history as unapplied, and
  the caller is told so it can be chased, rather than discovered a month later.
- **An amount of zero or a negative amount.** Refused at creation, with a reason.
- **A customer reference the caller made up on the spot.** Accepted — the
  reference is the caller's to define, and Devolada never validates it against
  anything it does not own.
- **The caller floods the API.** Requests are limited per business, and hitting
  the limit is answered in a way that tells the developer to slow down rather
  than looking like an outage.
- **The payer never pays.** Covered by the answer to Q1 below.

## Requirements *(mandatory)*

### Functional Requirements

**Access and credentials**

- **FR-001**: A business MUST be able to turn the API on from the panel and
  obtain a credential without help from Devolada.
- **FR-002**: Every API request MUST be attributed to exactly one business, and
  every answer MUST contain only that business's data.
- **FR-003**: The panel MUST show that a credential exists and enough of it to
  recognise which one, and MUST never show the credential again after it is
  issued.
- **FR-004**: A business MUST be able to revoke a credential and issue a new one
  at any time, and revocation MUST take effect immediately.
- **FR-005**: A request with a missing, unknown or revoked credential MUST be
  refused without revealing whether the business, the customer reference or the
  payment exists.

**Creating a payment link**

- **FR-006**: A caller MUST be able to create a payment link by supplying its own
  customer reference and the amount to collect, and MAY supply a display name and
  a description the payer will see.
- **FR-007**: The created link MUST show the payer the same page Devolada already
  serves, with the business's own CLABE, in es-MX.
- **FR-008**: Repeating a create request with the same caller-supplied
  idempotency key MUST return the link the first request created, never a second
  link.
- **FR-009**: The system MUST refuse to create a link when the business cannot
  actually collect — no CLABE, no validation credential — and MUST say which of
  those is missing.
- **FR-010**: Amounts MUST be exchanged as whole cents, and an amount that is not
  a positive whole number of cents MUST be refused.
- **FR-011**: A link created through the API MUST be distinguishable, in the
  panel and in the data, from one created by a person, so the business can tell
  which of its channels is collecting.

**Announcing outcomes**

- **FR-012**: A business MUST be able to register one address to receive
  outcome announcements, and to change or remove it.
- **FR-013**: The system MUST announce every payment verdict on an API-created
  link — confirmed, short, arriving against no debt, or never validated — naming
  the outcome so the caller's system can branch on it.
- **FR-014**: Every announcement MUST carry the customer reference, the payment
  identifier, the amount asked, the amount received, the match result, the folio
  when there is one, the verdict moment, and its own event identity.
- **FR-015**: Every announcement MUST carry proof of origin that the caller can
  verify without trusting the network.
- **FR-016**: A failed announcement MUST be retried on a widening schedule, and
  MUST stop after a bounded number of attempts, leaving the failure visible to
  the business.
- **FR-017**: No announcement, however slow or however broken its destination,
  may change, delay or reverse the payment's own verdict.
- **FR-018**: A business MUST be able to see, in the panel, that announcements
  are failing and why — an endpoint the business broke is the business's to fix.

**Asking and reading**

- **FR-019**: A caller MUST be able to read the current state of a payment by its
  identifier, and the payments of a customer by its own reference.
- **FR-020**: A caller MUST be able to read the transfers received in a date
  range, in a stable order, in pages, with every payment appearing exactly once
  across the pages.
- **FR-021**: A date range MUST be interpreted in the business's timezone.
- **FR-022**: A transfer that matched no link MUST be readable in the history,
  marked as unapplied.
- **FR-023**: Asking about something that belongs to another business MUST be
  answered as not found.

**Behaviour under load and failure**

- **FR-024**: The API MUST limit how often one business may call it, and MUST
  make a caller that hits the limit able to tell that from an outage.
- **FR-025**: Every failure MUST be answered with a stable, machine-readable
  reason a developer can branch on, and a caller MUST be able to tell "retry
  this" from "fix your request".
- **FR-026**: The system MUST keep a record of every announcement attempt and
  its result, so a disagreement between the two systems can be settled.

**Open questions**

- **FR-027**: A payment link created through the API MUST
  [NEEDS CLARIFICATION: Q1 — be a permanent link per customer reference, reusable
  for every future charge, or a one-time link for one charge that closes when it
  is paid or when it expires?]
- **FR-028**: The API MUST be available to
  [NEEDS CLARIFICATION: Q2 — businesses already onboarded to Devolada only, or
  also to companies that never use the panel and exist purely as API consumers?]
- **FR-029**: When a business has WispHub connected and a payment on an
  API-created link is confirmed, the system MUST
  [NEEDS CLARIFICATION: Q3 — announce only and never touch WispHub, or also run
  the configured WispHub action when the caller supplies the WispHub customer?]

### Key Entities

- **API credential**: proves a request belongs to one business. Issued in the
  panel, shown once, revocable, never shared between businesses.
- **Caller customer reference**: the caller's own identifier for the person who
  owes money. Devolada stores it, echoes it back on every answer and
  announcement, and never interprets it.
- **API payment link**: a link created by the caller rather than by a person,
  carrying the amount to collect and the caller's reference instead of a WispHub
  customer.
- **Payment**: unchanged from today — one transfer and its whole life, from proof
  to verdict. Gains the caller's reference when it came in through an API link.
- **Outcome announcement**: one attempt to tell the caller about one verdict,
  with its own identity, its proof of origin, its attempt count and its result.
- **Receiving address**: where a business wants its announcements sent, with the
  secret used to prove they came from Devolada.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A business using the API collects with **zero** manual steps: no
  person opens Devolada to create a link, and no person opens Devolada to learn
  that a customer paid.
- **SC-002**: A validated transfer reaches the caller's system within **30
  seconds** of its verdict for 99% of payments.
- **SC-003**: A support agent answers "did this customer pay?" from inside their
  own tool in under **30 seconds**, without opening Devolada.
- **SC-004**: A developer who has never seen Devolada goes from credential to a
  first working payment link in under **30 minutes** using the published
  reference alone.
- **SC-005**: Across 1,000 announcements including forced retries, a caller that
  follows the documented duplicate check credits **zero** customers twice.
- **SC-006**: A month of received transfers reconciles against the business's own
  books with **100%** of validated transfers accounted for, unapplied money
  included.
- **SC-007**: **Zero** requests ever return data belonging to another business,
  under every tested combination of credential and identifier.
- **SC-008**: A receiving address that is down for an hour and then recovers
  loses **zero** outcomes: every one is either delivered by retry or readable
  afterwards.
- **SC-009**: A business whose endpoint is failing learns it from the panel
  without contacting support.

## Assumptions

- The API serves businesses that already collect through Devolada's existing
  SPEI channel: the payer transfers to the **business's own CLABE**, Consta
  validates against Banxico, and Devolada holds no money at any moment. This
  feature changes who asks and who is told — never where the money goes.
- The payer's page is unchanged. A link created by the API opens the same page,
  with the same copy, the same accessibility floor and the same mobile-first
  rules as one created by a person.
- The business's service fee policy, reconciliation tolerance and timezone apply
  to API-created links exactly as they do today. This feature introduces no new
  pricing surface.
- The caller owns the debt. Devolada is told an amount to collect; it does not
  read, compute or hold the caller's balances, and it never decides what the
  caller should do when a payment falls short — it reports the match and lets the
  caller act.
- One receiving address per business is enough for the first version. Multiple
  addresses, per-event subscriptions and event replay are deliberately out of
  scope.
- Announcements are outbound only. Devolada never accepts an inbound call that
  moves money or changes a verdict.
- The panel remains the business's own surface: everything the API can do, a
  person can still see, and credential and endpoint health live there rather than
  in a separate developer console.
- Reading a published reference is how a developer integrates. A sandbox that
  simulates a Banxico-validated transfer is valuable but is not assumed here —
  it is a scope decision that follows from Q2.
- Existing WispHub-backed links, the panel's own link list and everything that
  collects today keep working untouched. This feature adds a channel; it
  replaces nothing.

## Dependencies

- The existing SPEI validation path (Consta → Banxico) and the business's
  validation credential. Without it a business cannot collect at all, by API or
  by hand.
- The business's CLABE and bank, already configured today.
- The existing payment record and its verdict vocabulary. The API reports those
  outcomes; it does not invent a second set of names for them.
