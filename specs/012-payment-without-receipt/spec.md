# Feature Specification: payment-without-receipt

**Feature Branch**: `claude/spec-012-payment-without-receipt`

**Created**: 2026-09-26

**Status**: Draft — written from the creator's decisions of 2026-09-26;
narrowed 2026-09-29 to the payer's profile and the instant path (User
Stories 1 and 2); one clarification open (the reference format)

**Input**: User description: "Pago sin comprobante. The payer registers a
recurring payment profile (sending bank + unique reference from their
phone); then (1) the payer only confirms the payment and its date, (2)
Devolada's own people validate what is left directly at Banxico, invisible
to the ISP, and (3) the ISP uploads its bank statement and Devolada does the
match. Order: 1, then 3, then 2."

## Where the other layers went

On 2026-09-29 the creator split this feature. This spec keeps layer 1: the
payer registers how they pay (User Story 1) and then confirms with only the
day (User Story 2). The other two layers each have their own spec:

- **The business uploads its bank statement and Devolada matches it** —
  User Story 3 of this spec until 2026-09-29, now
  [`specs/015-bank-statement-match`](../015-bank-statement-match/spec.md).
- **Devolada's people validate the remainder at Banxico** — User Story 4
  of this spec until 2026-09-29, now
  [`specs/016-banxico-remainder-queue`](../016-banxico-remainder-queue/spec.md).

Documents written before the split cite "spec 012 US4", "the human queue
(spec 012)" or "spec 012's Banxico batch" (spec 013, its research and data
model, and a few code comments around the bundle): those now mean spec 016.
"Spec 012, scenario 5" (bug `reference-search-printed-day`) still means
User Story 2, scenario 5, below.

## Where this comes from

Today a payment is proven by a **capture** of the bank's receipt. The
reader reads it, the provider searches Banxico with what was read, and two
bugs of 2026-09-26 showed the weak spot: a receipt that prints only a
reference can be confirmed with **somebody else's** transfer
(`reference-finds-other-transfer`), and a weekend transfer is searched on
days that cannot hold it (`reference-search-printed-day`). Banco Azteca
makes the first one the common case: the creator's Azteca receipts carry,
by default, the last seven digits of the receiving CLABE as the reference,
so Azteca payers of one business who keep the default share it.

On 2026-09-26 the creator measured the provider directly (24 paid calls)
and Banxico by batch (30 claves)
(`.specify/bugs/reference-finds-other-transfer/measurement.md`). What holds
this spec up:

- A reference plus **amount plus sending bank plus day** separates
  transfers. Same reference at $3.00 and $3.01, or from Azteca and from Nu,
  each returned its own CEP. The request has no field for the time.
- When several transfers still match, the provider does not pick one and
  does not refuse: it answers "invalid, Banxico confirmed" and hands over a
  **ZIP with one signed Banxico CEP per match**, each with its credit time
  to the second.
- A CEP validated before comes back again, marked as validated before.
- The **printed day** of a transfer — the day the money moved, which the
  CEP calls the *fecha de abono* — is the date a search must carry.
  Amended 2026-09-27 (lot 3 and Banxico's batch answer, same
  `measurement.md`): Banxico found 16 of 16 transfers with the printed
  day and **0 of 14** with the operation day it files them under, Saturday
  transfers included. apiCEP also answered the Monday (and, by reference,
  the Sunday) for Saturday transfers; that is the provider's own,
  undocumented behaviour, and this spec does not rely on it.
  One answer is not explained: asked by reference with the printed day
  of a Friday, apiCEP returned one of three matching transfers and left
  out the two made after 18:00 (one call; `measurement.md`, "What these
  answers do not tell").

The creator's decision: **the payer stops sending captures.** They register
once how they pay, and from then on validation is layered — instant with
the provider (this spec), free with the business's statement (spec 015),
and human with Banxico for whatever is left (spec 016). The receipt path
stays as the fallback for payers who never registered, and, until specs
015 and 016 ship, for any registered payer whose transfer the instant path
does not find.

Since this spec was written, spec 013 (`cep-bundle-match`) taught Devolada
to open the provider's several-matches bundle, and to leave a payment that
the bundle does not decide in a visible undecided state that asks the payer
for the clave and never expires. This spec reuses that path for the
several-matches case (FR-010).

## Clarifications

### Session 2026-09-26

- Q: In what order are the three layers delivered? → A: **1, then 3,
  then 2.** Each is independently useful. *Amended 2026-09-29*: layer 1
  is this spec; layer 3 is spec 015 and layer 2 is spec 016, delivered in
  that order.
- Three other answers of this session — who runs the Banxico queries
  (Devolada's own people), whether Devolada queries Banxico by machine
  (no), and whether the statement starts with a bank API (no) — moved with
  the stories they govern, to specs 015 and 016.

### Session 2026-09-29

- Q: What does this feature cover? → A: **User Stories 1 and 2** — the
  profile and the instant path — and they are built next. The statement
  and Devolada's people at Banxico each get their own spec (015 and 016).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The payer registers how they pay (Priority: P1)

A customer of a business opens their permanent payment link (or answers
Devolada's WhatsApp) and, instead of uploading a capture, tells Devolada
**which bank they pay from** and receives **their own reference number**
to put on every transfer from now on. The page shows them, in their bank's
words, where that number goes ("Referencia numérica",
"Concepto/Referencia") and that the amount is always the one their link
asks. From then on their payment link opens on "¿Ya pagaste?" instead of
"Sube tu comprobante".

**Why this priority**: nothing else in this feature works without a
registered payer. A unique reference per customer is what removes the
shared-reference ambiguity at its root, and it is the only thing that has
to change on the payer's side.

**Independent Test**: register a payer with bank + reference on a fresh
business, reopen their link, and see the confirmation screen with their
reference and bank; try to register a second payer of the same business
with the same reference and be refused. Delivers value alone: the business
can already tell its Azteca customers apart by reference on any receipt.

**Acceptance Scenarios**:

1. **Given** a customer with a payment link and no profile, **When** they
   pick their sending bank and confirm, **Then** Devolada shows them a
   reference that is unique inside that business, tells them where to type
   it in that bank's app, and their link now opens on the confirmation
   screen.
2. **Given** a registered payer, **When** they open their link from
   another device, **Then** their reference and bank are shown again, with
   a way to change the bank.
3. **Given** a reference already assigned to another customer of the same
   business, **When** a second customer would receive it, **Then** Devolada
   assigns a different one and never shows a shared reference.
4. **Given** a registered payer who uploads a capture anyway, **When** the
   capture's reference differs from their registered one, **Then** the
   payment is still accepted on the receipt path and the payer is reminded
   of their reference.

---

### User Story 2 - The payer confirms and the business's action fires (Priority: P1)

The registered payer transfers the amount their link asks, with their
reference, opens their link (or writes "ya pagué" on WhatsApp) and confirms
**that they paid and on which day**. Devolada asks the provider with the
reference, that amount, the registered bank and the day the payer gave. If
Banxico has exactly that transfer, the payment is confirmed and the
business's action fires as today (for an ISP, the reconnection). If it is
not there yet, Devolada keeps looking on its own for a bounded time and
tells the payer so. If more than one transfer matches, Devolada does not
guess: the payment shows "en revisión" and asks the payer for the clave,
the way spec 013 already handles a bundle it cannot decide.

**Why this priority**: this is the instant path — one confirmation, one
paid provider call, the business's action in seconds — and it retires the
capture and the reader from the main flow.

**Independent Test**: with a registered payer and a transfer made with
their reference, confirm with the right day and see the payment confirmed
and the action queued; confirm with a day where nothing exists and see the
"seguimos buscando" status and the later retry.

**Acceptance Scenarios**:

1. **Given** a registered payer whose transfer Banxico holds for the day
   given, **When** they confirm "ya pagué" with that day, **Then** the
   payment is confirmed with that CEP, the credit time is recorded, and the
   business's action fires.
2. **Given** a confirmation for a day where Banxico holds nothing, **When**
   the first search returns nothing, **Then** the payer sees that Devolada
   is still looking, the search is retried **on the same day given**
   without asking the payer again, and the payment expires with a clear
   status if it is never found; the payer's link then offers the receipt
   path.
3. **Given** a reference, amount, bank and day that match **several**
   transfers (the payer paid twice that day), **When** the provider answers
   with the bundle of CEPs, **Then** no payment is confirmed automatically,
   the bundle is kept with the payment, and the payment takes spec 013's
   undecided path: it shows "en revisión", spends no more provider calls,
   asks the payer for the clave, and does not expire.
4. **Given** a transfer already used to confirm another payment, **When**
   it comes back marked as validated before, **Then** it does not confirm a
   second payment and the payer is told which payment already used it.
5. **Given** a payer who confirms the wrong day (the day before, the day
   after), **When** Banxico finds nothing on that day, **Then** a retry asks
   the neighbouring calendar days — never the operation day Banxico files
   the transfer under, by which Banxico finds nothing (measured 2026-09-26)
   — and the payer is not asked to upload anything.
6. **Given** a payer who sent a different amount (their link asks $350 and
   they sent $300), **When** the search by the amount the link asks finds
   nothing, **Then** the payment is not confirmed, the payer is told the
   amount Devolada looked for, and they can upload their receipt, where the
   partial-payment rules that already exist apply.

---

### Edge Cases

- **Two customers of one business have phone numbers that end in the same
  digits.** The reference must still be unique inside the business;
  Devolada assigns a different one to the second and tells them.
- **The payer's bank app does not let them set the reference, or resets it
  to a default.** The payer's transfer arrives with the wrong reference and
  the instant path does not find it. The payment expires with its status
  and the payer's link offers the receipt path; once specs 015 and 016
  ship, the statement or Devolada's people can match it by amount, sender
  and time. The profile records the bank so the business can see which
  banks fail this way.
- **The payer changes bank.** The profile keeps one current bank; the
  search uses it. A transfer from another bank is not found by the instant
  path; the payer can change the bank on their link (User Story 1,
  scenario 2) or fall back to the receipt path.
- **The payer pays twice the same day with the same reference.** Several
  matches: the bundle is kept, nothing is confirmed automatically, and the
  payment takes spec 013's undecided path. The clave the payer gives picks
  the transfer; the other one is a credit without an invoice (an
  overpayment the existing rules already name).
- **The payer confirms before the transfer is filed.** A confirmation
  minutes after the transfer may find nothing yet; a retry on the same day
  covers it without a second confirmation.
- **The amount the link asks changes between the transfer and the
  confirmation.** The search uses the amount at confirmation time; a
  mismatch is not found, and the payer falls back to the receipt path (and,
  once spec 015 ships, to the statement, which matches by the amount that
  actually arrived).
- **The provider's monthly quota runs out.** The instant path degrades to
  "seguimos buscando"; the payment keeps its bounded life and its retries,
  and the platform operator sees the quota state.

## Requirements *(mandatory)*

### Functional Requirements

**Profile**

- **FR-001**: A payer MUST be able to register, from their payment link and
  without a session, the bank they pay from and receive a numeric reference
  that is unique inside their business and fits what SPEI accepts (at most
  7 digits).
- **FR-002**: The reference MUST be derived from the payer's phone number
  where that yields a unique value inside the business, and assigned by
  Devolada otherwise; the payer always sees which number is theirs. [NEEDS
  CLARIFICATION: is the default the last 7 digits of the phone, so a payer
  can guess it, or a short number Devolada assigns, so it is never
  guessable and never collides? See Q1.]
- **FR-003**: The profile MUST show the payer, in their bank's own
  wording, where the reference goes, and that the amount is the one their
  link asks.
- **FR-004**: The business's operator MUST be able to see, per customer,
  whether a profile exists, its bank and reference, and to reset it.
- **FR-005**: A registered payer's link MUST open on the confirmation
  screen; the receipt path MUST remain reachable from it.

**Instant path**

- **FR-006**: A registered payer MUST be able to confirm a payment with
  only the day it was made, from the payment page and from WhatsApp.
- **FR-007**: On confirmation Devolada MUST search by reference, the amount
  the link asks, the registered bank and the day given, spending one
  provider call.
- **FR-008**: A single valid match MUST confirm the payment and fire the
  existing action; the credit time MUST be recorded with it.
- **FR-009**: Nothing found MUST NOT ask the payer again: Devolada retries
  on the day given (and, for a day the payer may have misremembered, the
  neighbouring calendar days — never the operation day), within the bounded
  life of a payment, and shows "seguimos buscando".
- **FR-010**: Several matches MUST NOT confirm anything. The bundle of CEPs
  MUST be kept with the payment, and the payment MUST take the undecided
  path spec 013 gives a bundle it cannot decide (013 FR-008): "en revisión"
  with its reason, no further provider calls, the payer asked for the
  clave, a clave that fits one kept CEP confirming without a call, and no
  `expired` end. Devolada's people take such payments once spec 016 ships.
- **FR-011**: A CEP marked as validated before MUST NOT confirm a second
  payment.
- **FR-012**: The provider quota MUST be visible to the platform operator,
  and running out MUST degrade to "seguimos buscando", never to an error
  shown to the payer.

**Across the feature**

- **FR-013**: Every confirmation of a registered payer's payment MUST
  record its source — the instant path, told apart from the receipt path —
  and the clave and the credit time, so a payment can be traced to the
  transfer that paid it. Specs 015 and 016 add their own sources to the
  same record.
- **FR-014**: Amounts MUST be exact to the cent in every match; no
  tolerance.
- **FR-015**: Data read from CEPs (sender names, accounts) MUST be kept
  only under the business it belongs to and shown only to that business's
  operators and to platform operators.

### Key Entities

- **Payer profile**: a customer's way of paying — sending bank, unique
  reference inside the business, when it was registered, from which
  channel.
- **Confirmation**: a payer's "ya pagué" — the day given, the channel, and
  the search it triggered.
- **Payment** (existing): gains a confirmation source, a clave and a credit
  time on every confirmation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A registered payer's payment is confirmed and the business's
  action fires within 1 minute of confirming a transfer Banxico already
  holds, with no capture uploaded.
- **SC-002**: For registered payers, no payment is ever confirmed with a
  transfer that belongs to another customer: 0 wrong-customer
  confirmations in a month of pilot, checked against the pilot business's
  bank statement.
- **SC-003**: The instant path spends at most 2 provider calls per payment
  on average over a month.
- **SC-004**: Within two months of launch at the pilot business, at least
  70% of confirmed payments come through a profile path rather than a
  capture. This spec's instant path counts from launch; the statement and
  Banxico paths count once specs 015 and 016 ship.

## Assumptions

- The payer's bank app lets them set a numeric reference and keeps it for
  a saved contact; where it does not, the payer falls back to the receipt
  path (and, later, to the layers of specs 015 and 016). Which banks keep
  it is measured at the pilot, not assumed.
- The amount searched is the one the payer's link asks: read through the
  business's integration as today when the link was made in the panel (for
  an ISP, its open invoices), or stored on the link when it was made
  through `/v1`. The profile never stores an amount.
- The day the payer gives is the day the money moved (the date their app
  prints, the CEP's *fecha de abono*), and it is the only day Devolada asks
  (amended 2026-09-27: Banxico found 16 of 16 by that day and 0 of 14 by
  the operation day, measured 2026-09-26). The operation day Banxico files
  a transfer under is recorded and compared, never asked.
- The provider is the one the engine already uses; its answer to several
  matches (invalid + Banxico confirmed + a ZIP) is the measured behaviour
  of 2026-09-26, spec 013 already reads it, and this feature relies on it;
  its quota is a plan setting the platform operator watches.
- A registered payer's several-matches payment asks the payer for the
  clave, as spec 013 does for a receipt, rather than waiting silently for
  spec 016. Chosen 2026-09-29 while narrowing: without spec 016 nothing
  else would ever close it. The creator confirms or changes it at
  `/speckit-clarify`.
- The existing payment life cycle, statuses, action queue, partial and
  overpayment rules, spec 013's undecided path, and the receipt path stay
  as they are; this feature adds a confirmation source in front of them,
  it does not replace them.
- WhatsApp as a channel for the profile and the confirmation follows the
  WhatsApp decision of 2026-09-22 (one shared Devolada number, two-way);
  this feature defines what is said there, not the channel itself.
- Out of scope: the bank statement upload and match (spec 015); the
  remainder queue, Banxico's batch file and any query to Banxico (spec
  016); a reference typed by the payer on the page (it is registered once,
  not per payment); and changes to the reader.
