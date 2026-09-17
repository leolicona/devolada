# Feature Specification: automated-collections-api

**Feature Branch**: `claude/devoladapago-wisphub-integration-cqz6xp`

**Created**: 2026-09-11

**Status**: Draft — clarified, ready for `/speckit-plan`

**Input**: User description: "We are going to develop an API that allows other services to generate payment links to send to customers, verify customer payments directly from their own platforms, receive automated notifications once transfers are validated, and view the history of received transfers. The goal is to automate customer collections without manual intervention, reconcile bank transfers in real time, and streamline customer support."

## Summary

Today a person collects. Someone opens the panel, finds the customer, copies the
link, sends it, and later comes back to see whether the money arrived. Devolada
already does the hard half — the permanent link, the SPEI transfer to the
business's own CLABE, the Banxico validation — but a human still starts it and a
human still watches it.

This feature gives that whole loop to the business's own software. Its system
asks for a link, sends it however it already talks to its customers, and is told
by webhook the moment Banxico confirms the transfer. Nobody opens Devolada to
collect, and nobody opens Devolada to find out whether a customer paid.

It also widens who Devolada is for. Until now the product assumed the business
runs an internet service and that WispHub is where the outcome lands. From this
feature on, **the business is any company in Mexico that collects by SPEI** — a
gym, a school, a software company — and **WispHub is one integration among
several**, not the reason the product exists. The API never mentions a
subscriber, a service or a router.

The money never changes hands differently: the payer transfers to the
**business's own CLABE**, Consta validates it against Banxico, and Devolada holds
no money at any moment. That is what keeps the widening affordable — Devolada is
not becoming a place where money sits. What is new is who does the asking and who
gets told.

## Clarifications

### Session 2026-09-11

- Q: Is an API payment link permanent per customer, or one link per charge? →
  **A: Both, chosen by the caller.** A *reusable* link belongs to a customer
  reference, stays open forever and is re-priced for each new charge — the shape
  that already works for recurring service. A *one-time* link carries one amount,
  closes when it is paid and expires on a deadline — the shape a single invoice
  needs. The payer cannot tell them apart; the kind is the caller's bookkeeping.
  (FR-027, FR-030 – FR-033)
- Q: Who may consume the API — existing Devolada businesses, or any company? →
  **A: Any company in Mexico that wants to collect by SPEI.** Devolada becomes a
  collections platform and WispHub becomes one integration among several. This
  amends the constitution's opening sentence, adds a test mode a developer can
  integrate against without moving real money, and forbids any ISP vocabulary in
  the API surface. (FR-028, FR-034 – FR-036, and *Constitution Impact* below)
- Q: Does a confirmed payment on an API link also run the WispHub action? →
  **A: No. Announce only.** Devolada performs no registration, no reconnection
  and no payment promise for an API payment, whatever the business configured for
  its panel links. The webhook is the outcome, and the caller's system decides
  what to do with it. Panel links keep their WispHub behaviour untouched.
  (FR-029, FR-037)
- Q: How are the automated notifications delivered? → **A: Webhooks.** Devolada
  calls an address the business registers, signs the message so the caller can
  prove it came from Devolada, retries a failed delivery on a widening schedule,
  and gives every message an identity so a repeat is recognisable. Not email, not
  polling-only — polling exists as the safety net underneath (US3), never as the
  mechanism. (FR-012 – FR-018, FR-038 – FR-041)

### Session 2026-09-17

- Q: Which rule should decide what the webhook announces: every state a
  payment enters, or only the start of validation plus the verdict? → **A:
  Every state the payment enters is announced, named with the payment
  record's own status word.** First when the customer's receipt is accepted
  and validation begins (`validating`), `queued_for_credit` if the business's
  validation credit is paused, then the verdict. One rule, no exceptions, so
  a state added later fits it instead of breaking an integration.
  (FR-013, US2 scenario 10)
- Q: Which submissions count as "the receipt is accepted and validation
  begins": only an uploaded receipt image, or also typed transfer details? →
  **A: Both doors.** Any submission the payer's page accepts — a receipt
  image or the tracking key and amount typed by hand — is announced as
  `validating`, and the message says which door it came through. The
  business's system cares that a claim exists and is being checked, not how
  the customer entered it. (FR-013, FR-014, US2 scenario 10)
- Q: Should the early `validating` message carry how much the customer claims
  to have transferred, before Banxico has confirmed anything? → **A: Yes,
  under its own name.** The message carries the claimed amount as a claim,
  never as money received; the amount received, the match and the folio stay
  absent until the verdict, and the published reference says in one line that
  nothing before the verdict is money. (FR-014, FR-036, US2 scenario 10, edge
  case "the business credits a claim")
- Q: Where should a link created through the API appear in the panel, so the
  business can tell which channel is collecting? → **A: On the same links
  screen as the panel's own links, one list per business.** Separation is by
  business, through the switcher the panel already has — a person who runs a
  school and a gym switches business, never channel. Within one business every
  link lives in the same list, marked with its channel as icon + text
  ("Panel" / "API"), an API row showing the caller's reference where a panel
  row shows the usuario, and search covering that reference. WispHub-specific
  copy appears only on panel rows. (FR-011, US1 scenario 11)
- Q: Which webhook delivery should a payment's "did the thing after the money
  happen?" outcome reflect, now that one payment produces several deliveries?
  → **A: The verdict's delivery only.** Pre-verdict deliveries never touch
  that outcome; their failures are visible in the delivery record and on the
  panel's health line, where endpoint trouble belongs. (FR-026)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The caller's own system creates the payment link (Priority: P1)

A business connects its platform to Devolada once: it turns the API on in the
panel and gets a credential. From then on, when its system decides a customer
owes money, it asks Devolada for a payment link with its own customer reference
and the amount. It gets back a link it can put in its own WhatsApp message, its
own portal, or its own invoice email.

It chooses the kind of link it needs. A company billing the same customer every
month asks for a **reusable** link once and re-prices it each cycle. A company
sending one invoice asks for a **one-time** link that closes when it is paid.

The payer's experience does not change at all, and does not differ between the
two kinds: the same page, the same CLABE, the same es-MX copy.

**Why this priority**: it is the one that removes the manual step the feature
exists to remove. A business that can only do this much already stops copying
links by hand — it can still watch outcomes in the panel while the rest arrives.

**Independent Test**: issue a credential in the panel, call the API with a
customer reference and an amount, open the returned link in a browser, and see
the right amount and the business's own CLABE. Repeat for both link kinds. Needs
nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** a business with a credential and a configured CLABE, **When** its
   system asks for a reusable link for customer reference `CLI-4471` owing
   $499.00 MXN, **Then** it receives a link, and opening that link shows a
   payment page asking for that amount against that business's CLABE.
2. **Given** that reusable link, **When** the caller re-prices it to $520.00 next
   month, **Then** the same link now asks for $520.00, and a payer who kept the
   old message still sees the current amount.
3. **Given** a one-time link for $1,200.00 with a deadline, **When** the payer
   pays it, **Then** the link closes and a second payer opening it meets a clear
   es-MX explanation rather than a broken page or a zero.
4. **Given** a one-time link whose deadline has passed, **When** anyone opens it,
   **Then** it says so in es-MX and offers no CLABE to transfer to.
5. **Given** the same business, **When** it asks twice for a reusable link for
   `CLI-4471`, **Then** it receives the same link both times rather than a second
   one.
6. **Given** any create request repeated with the same caller-supplied
   idempotency key, **When** the first one already succeeded, **Then** the second
   returns that same result and creates nothing new.
7. **Given** a business whose CLABE is not configured, **When** its system asks
   for a link, **Then** the request is refused with a reason the developer can
   act on, and no link that would show an empty CLABE is created.
8. **Given** a business without a credential, **When** a request arrives with no
   or an unknown credential, **Then** it is refused and nothing about the
   business is revealed.
9. **Given** a credential belonging to business A, **When** it asks for a link
   using a customer reference that exists in business B, **Then** a link is
   created for business A only, and nothing of business B is read or returned.
10. **Given** a company that is not an ISP, **When** it reads any request,
    answer or error the API produces, **Then** nothing names a subscriber, a
    service, a router or WispHub.
11. **Given** a business with one link created in the panel and one created
    through the API, **When** a person opens the panel's links screen, **Then**
    both appear in the same list, each marked with its channel as icon and
    text, the API row shows the caller's reference, searching for that
    reference finds it, and nothing on the API row mentions WispHub.

---

### User Story 2 - The webhook tells the caller the transfer was validated (Priority: P2)

The business registers one address where Devolada should announce what happens
to a payment. Devolada calls that address every time the payment enters a new
state: first when the customer's receipt is accepted and validation begins, so
the caller's system knows a claim exists before the money is proven; then at
the verdict, with what happened — which customer reference, how much arrived,
whether it matched what was asked, and the folio. The caller's system does the
rest on its own — marks the invoice paid, opens the gym door, thanks the
customer — without anybody watching.

The message is signed, so the caller can prove it came from Devolada. It carries
its own identity, so a repeat is recognisable. A delivery that fails is retried
on a widening schedule, and one that keeps failing is never lost: it stays
readable, the business can see in the panel that its own endpoint is the thing
that is broken, and it can ask for the delivery again once it is fixed.

**Why this priority**: this is what "without manual intervention" means. US1
still requires someone to ask "did they pay?"; the webhook closes the loop.

**Independent Test**: register a receiving address, drive one payment to a
confirmed verdict, and assert the webhook arrives with the payment's facts,
carries verifiable proof of origin, and is retried when the address answers with
an error.

**Acceptance Scenarios**:

1. **Given** a business with a receiving address registered, **When** a payment
   on an API-created link is confirmed, **Then** the address is called within
   seconds with the customer reference, the amount that arrived, the amount that
   was asked, the match result, the folio, and the moment of the verdict.
2. **Given** the delivered message, **When** the caller checks it, **Then** it
   can prove the message came from Devolada and was not altered, and can tell
   whether it has already seen this exact event.
3. **Given** a receiving address that answers with an error, **When** Devolada
   delivers, **Then** it retries on a widening schedule, and stops after the
   schedule is spent with the failure visible to the business.
4. **Given** a receiving address that never answers in time, **When** the
   delivery times out after 10 seconds, **Then** the payment's own record is
   unaffected — the money stays confirmed and the payer sees success.
5. **Given** a business that has fixed its endpoint after a run of failures,
   **When** it asks for a failed delivery to be sent again, **Then** it is
   delivered, carrying the same event identity as the attempts that failed.
6. **Given** a payment that ends in a verdict other than confirmed (it arrived
   short, it arrived against no debt, it was never validated), **Then** the
   caller is told about that outcome too, named so its system can tell the
   difference.
7. **Given** Devolada retiring the key that signs its webhooks and adopting a
   new one, **When** the change happens between two payments, **Then** no
   delivery is lost, the business changes nothing on its side, and a caller
   that verifies against Devolada's published keys accepts both the message
   before and the message after.
8. **Given** a business with no receiving address registered, **When** a payment
   is confirmed, **Then** nothing is delivered and nothing fails.
9. **Given** a confirmed payment on an API link for a business that has WispHub
   connected, **When** the verdict lands, **Then** the webhook is sent and
   **nothing at all** is written to WispHub.
10. **Given** a customer who submits a proof on an API link — a receipt image
    or the transfer details typed by hand — and the page accepts it, **When**
    validation begins, **Then** the address is called with the `validating`
    state, the customer reference, the payment identifier, the amount asked,
    the amount the customer claims to have sent, and which door the proof
    came through — with no amount received, no match and no folio, because
    none exists yet — and later the verdict arrives as its own message for
    the same payment identifier.

---

### User Story 3 - The caller asks about a payment at any moment (Priority: P3)

Someone at the business — a support agent inside its own tool, or its system
after a restart — needs to know whether a specific customer paid. It asks
Devolada by its own customer reference or by the payment's identifier and gets
the current state in one answer.

This is the safety net under US2: a webhook missed while the caller's platform
was down is never a hole, because the state can always be asked for.

**Why this priority**: it makes support answerable without leaving the tool the
agent already has open, and it is what makes the webhook safe to depend on.

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
- **The business credits a claim.** The `validating` message says the customer
  claims to have sent $500.00; nothing has been proven. A caller that credits
  the customer on that message has given away the money it was meant to
  collect. The claim is named so it cannot be read as money received, the
  verdict message is the only one that carries an amount received, and the
  reference says so in one line.
- **The same webhook arrives twice.** A retry after a delivery that actually
  landed is possible. Every message carries an identity the caller can use to
  recognise a repeat, so a customer is never credited twice.
- **A payer pays a one-time link seconds before it expires.** The money is real
  and the payment is honoured; a deadline closes the link to *new* payers, it
  never voids a transfer already on its way. Money that lands after the link
  closed is unapplied, not lost.
- **A reusable link is re-priced while a payer has the page open.** The payer
  sees the current amount from the moment the change lands. A transfer already
  sent against the old amount is reconciled against what was asked at the time.
- **The caller asks for the same link twice.** A reusable link is unique per
  customer reference — asking again returns the one that exists. Any request
  repeated with the same idempotency key returns the first result. A retried
  request after a network failure can never leave two links chasing one customer.
- **The receiving address is slow or down.** The webhook waits 10 seconds,
  retries and eventually gives up; the payment itself is never held back, never
  rejected, and never re-validated because of it.
- **The credential is revoked while links are live.** The API stops answering
  immediately. Links already in a customer's hands keep working — the business
  asked for that money and the payer must not meet a dead page.
- **A transfer arrives that matches no link at all.** The money is real and
  already in the business's account. It appears in the history as unapplied, and
  the caller is told, so it can be chased rather than discovered a month later.
- **A test-mode payment reaches a business's real reconciliation.** It must not.
  Test records live apart from real ones everywhere they could be counted: the
  history, the panel totals, the fees.
- **An amount of zero or a negative amount.** Refused at creation, with a reason.
- **A customer reference the caller made up on the spot.** Accepted — the
  reference is the caller's to define, and Devolada never validates it against
  anything it does not own.
- **The caller floods the API.** Requests are limited per business, and hitting
  the limit is answered in a way that tells the developer to slow down rather
  than looking like an outage.

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
  which of its channels is collecting. In the panel this means the same links
  screen, one list per business: every row carries its channel as icon + text
  ("Panel" / "API"), an API row shows the caller's reference in the place a
  panel row shows the usuario, search covers that reference, and copy that
  names WispHub appears only on panel rows. A person running more than one
  business separates them with the panel's existing business switcher, never
  by channel.

**Announcing outcomes by webhook**

- **FR-012**: A business MUST be able to register one address to receive outcome
  webhooks, and to change or remove it.
- **FR-013**: The system MUST announce every state a payment on an API-created
  link enters, naming it with the payment record's own status word so the
  caller's system can branch on it: `validating` when the customer's proof —
  a receipt image or typed transfer details, both doors alike — is accepted
  and validation begins, `queued_for_credit` when the business's
  validation credit is paused, and every verdict — confirmed, partial,
  arriving against no debt, never validated, or superseded by a corrected
  attempt. One rule, no exceptions.
- **FR-014**: Every webhook MUST carry the customer reference, the payment
  identifier, the amount asked, the amount received, the match result, the folio
  when there is one, the verdict moment, and its own event identity. A message
  announcing a state before the verdict carries what is known so far: the
  amount the customer claims to have sent, named as a claim and never as
  money received, and which door the proof came through. The amount received,
  the match and the folio are absent, not invented, until the verdict.
- **FR-015**: Every webhook MUST carry proof of origin that the caller can verify
  without trusting the network, against a public key Devolada publishes — so
  nothing the business holds, and nothing that could leak from the business,
  can forge a message.
- **FR-016**: A delivery that is not answered with success within 10 seconds
  MUST count as failed. A failed delivery MUST be retried on a widening
  schedule, and MUST stop after a bounded number of attempts, leaving the
  failure visible to the business.
- **FR-017**: No webhook, however slow or however broken its destination, may
  change, delay or reverse the payment's own verdict.
- **FR-018**: A business MUST be able to see, in the panel, that deliveries are
  failing and why — an endpoint the business broke is the business's to fix.

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

- **FR-024**: The API MUST limit one business to 120 requests per minute, and
  MUST make a caller that hits the limit able to tell that from an outage and
  know how long to wait.
- **FR-025**: Every failure MUST be answered with a stable, machine-readable
  reason a developer can branch on, and a caller MUST be able to tell "retry
  this" from "fix your request".
- **FR-026**: The system MUST keep a record of every webhook attempt and its
  result, so a disagreement between the two systems can be settled. A
  payment's own after-money outcome — done, queued or failed — reflects the
  verdict's delivery only; a delivery announcing an earlier state that fails
  is visible in that record and in the panel, never on the payment's outcome.

**Link lifecycle** *(Q1 → both kinds)*

- **FR-027**: A caller MUST choose, at creation, between a **reusable** link tied
  to its customer reference that never expires, and a **one-time** link that
  carries one amount, closes when it is paid, and expires on a deadline.
- **FR-030**: A caller MUST be able to change the amount on a reusable link, and
  the payer's page MUST show the new amount from the moment the change lands.
- **FR-031**: A closed or expired one-time link MUST refuse new payments and MUST
  explain itself to the payer in es-MX — never a broken page, never a zero
  amount, never a CLABE that would invite a transfer nobody will apply.
- **FR-032**: Both kinds MUST be indistinguishable to the payer: same page, same
  CLABE, same copy. The kind is the caller's bookkeeping.
- **FR-033**: A reusable link MUST be unique per business and customer reference;
  asking for one that exists MUST return it rather than create a second.

**Any business, not only ISPs** *(Q2 → open platform)*

- **FR-028**: The API MUST serve any business collecting by SPEI in Mexico and
  MUST NOT assume the caller operates an internet service. No request, answer,
  webhook or error message may require or imply a subscriber, a service, a router
  or WispHub.
- **FR-034**: A developer MUST be able to exercise the whole flow — create a
  link, reach a confirmed verdict, receive the webhook — in a clearly marked test
  mode, without moving real money and without a real bank transfer.
- **FR-035**: Test-mode records MUST never appear in a business's real history,
  real reconciliation, real panel totals or real fees.
- **FR-036**: A published reference MUST document every request, every answer,
  every error reason and the webhook contract — including how to verify origin,
  how to recognise a repeat, and that nothing announced before the verdict is
  money — and MUST be readable by a developer who has never heard of WispHub.

**WispHub stays out of it** *(Q3 → announce only)*

- **FR-029**: A payment on an API-created link MUST NOT trigger any WispHub
  action. Devolada performs no registration, no reconnection and no payment
  promise for it, whatever the business has configured. The webhook is the
  outcome.
- **FR-037**: A business that has WispHub connected MUST keep its panel links and
  their WispHub behaviour completely unchanged by this feature.

**What a webhook needs to be trustworthy**

- **FR-038**: The system MUST refuse a receiving address that cannot protect the
  message in transit.
- **FR-039**: Devolada MUST be able to retire the key that signs its webhooks
  and adopt a new one without the business doing anything and without losing a
  single delivery. A retired key MUST stay verifiable for as long as a message
  signed with it can still arrive. The business never holds, stores or rotates
  a signing secret.
- **FR-040**: Every webhook MUST carry the moment of the state it announces,
  so a caller that receives two messages for one payment out of order can
  still tell which is newer. The verdict moment travels on the verdict
  message; a message before the verdict carries the moment its state began.
- **FR-041**: A business MUST be able to ask for a failed delivery to be sent
  again once its endpoint is fixed, and the re-sent message MUST carry the same
  event identity as the attempts that failed.

### Key Entities

- **API credential**: proves a request belongs to one business. Issued in the
  panel, shown once, revocable, never shared between businesses. Carries whether
  it acts in real or test mode.
- **Caller customer reference**: the caller's own identifier for the person who
  owes money. Devolada stores it, echoes it back on every answer and webhook, and
  never interprets it.
- **API payment link**: a link created by the caller rather than by a person,
  carrying the amount to collect and the caller's reference instead of a WispHub
  customer. Reusable or one-time; a one-time link also carries its deadline and
  whether it is still open.
- **Payment**: unchanged from today — one transfer and its whole life, from proof
  to verdict. Gains the caller's reference when it came in through an API link.
- **Webhook delivery**: one attempt to tell the caller about one verdict, with
  its own event identity, its proof of origin, its attempt count and its result.
- **Receiving address**: where a business wants its webhooks sent. It carries
  no secret: proof of origin comes from Devolada's own key, not from anything
  the business holds.
- **Signing key**: Devolada's, one set for the whole platform, never per
  business. Its public half is published where any caller can fetch it; its
  private half never leaves Devolada. Retiring one and adopting the next is a
  platform action the business does not see.

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
- **SC-005**: Across 1,000 webhook deliveries including forced retries, a caller
  that follows the documented duplicate check credits **zero** customers twice.
- **SC-006**: A month of received transfers reconciles against the business's own
  books with **100%** of validated transfers accounted for, unapplied money
  included.
- **SC-007**: **Zero** requests ever return data belonging to another business,
  under every tested combination of credential and identifier.
- **SC-008**: A receiving address that is down for an hour and then recovers
  loses **zero** outcomes: every one is either delivered by retry, or re-sent on
  request, or readable afterwards.
- **SC-009**: A business whose endpoint is failing learns it from the panel
  without contacting support.
- **SC-010**: A developer completes the entire flow — link, payment, verdict,
  webhook — in test mode with **zero pesos** moved and **zero** test records
  reaching any real total.
- **SC-011**: A company that does not run an internet service integrates end to
  end without encountering a single ISP term in any request, answer, webhook,
  error or page of the reference.

## Constitution Impact

Answer Q2 widens the product beyond what the constitution currently says, so this
feature cannot be planned without naming the amendment. The constitution's own
governance rule applies: *"When a principle blocks a feature, the feature's plan
says so and proposes the amendment; it does not route around it."*

- **The opening sentence** — "Devolada lets a Mexican ISP (the *business*, or
  Negocio) collect its customers' payments by SPEI, validate the transfer through
  Consta, and act on it in the ISP's own system" — no longer describes the
  product. The business is any company collecting by SPEI; acting in the
  business's own system is one thing that can follow a verdict, not the
  definition.
- **Principle V (Tenant Isolation)** gains a second kind of actor. Today an actor
  is a person resolved from a Better Auth membership; the API's actor is a
  credential. The rule that every query filters by the actor's business is
  unchanged and now carries more weight.
- **Principle VIII (Absent configuration degrades)** already covers the WispHub
  key being unset. Under Q2 that is no longer a degraded state to warn about — it
  is the normal state of most businesses. What "unset" means needs restating, not
  re-deciding.
- **Nothing else moves.** The money law, the one-contract rule, the test layers,
  the visual foundations and the citation rules apply to this feature exactly as
  written.

**What Q2 does *not* cost, measured against the code on 2026-09-11**: the
`businesses` table holds no ISP-specific column — name, contact email, timezone,
CLABE, bank, beneficiary, fee, tolerance, Consta key. The WispHub key already
moved out to its own `integrations` table with a `provider` enum. A gym fits the
existing tenant shape without a schema change. The ISP assumption survives in one
load-bearing place: `payment_links` requires a WispHub customer on every row. That
is this feature's real work, and `/speckit-plan` owns how it is done.

## Assumptions

- The API serves businesses that collect through Devolada's existing SPEI
  channel: the payer transfers to the **business's own CLABE**, Consta validates
  against Banxico, and Devolada holds no money at any moment. This feature
  changes who asks and who is told — never where the money goes. It is also what
  keeps Q2 affordable: opening to any company does not make Devolada a place
  where other people's money sits.
- A business account still comes into being through Devolada's existing signup.
  The API never creates a business. A company that will live entirely in the API
  still visits the panel once, to sign up, set its CLABE and take its credential.
  Self-service onboarding designed for developers is a later feature, not this
  one.
- Whatever identity checks Devolada performs at signup today are what a new
  business meets. Opening to companies outside the ISP world may justify more,
  and that is a decision to take on its own evidence — this spec neither assumes
  nor designs it.
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
  addresses, per-event subscriptions, and replaying arbitrary history are
  deliberately out of scope. Re-sending a *failed* delivery is in scope (FR-041);
  it is what makes a fixed endpoint recoverable.
- Webhooks are outbound only. Devolada never accepts an inbound call that moves
  money or changes a verdict.
- The panel remains the business's own surface: everything the API can do, a
  person can still see, and credential and endpoint health live there rather than
  in a separate developer console.
- Everything that collects today keeps working untouched: WispHub-backed links,
  the panel's link list, the reconnection queue. This feature adds a channel; it
  replaces nothing and removes nothing.

## Dependencies

- The existing SPEI validation path (Consta → Banxico) and the business's
  validation credential. Without it a business cannot collect at all, by API or
  by hand.
- The business's CLABE, bank and beneficiary name, already configured today.
- The existing payment record and its verdict vocabulary. The API reports those
  outcomes; it does not invent a second set of names for them.
- The constitution amendment named above, proposed by this feature's plan.
