# Feature Specification: payment-without-receipt

**Feature Branch**: `claude/spec-012-payment-without-receipt`

**Created**: 2026-09-26

**Status**: Draft — written from the creator's decisions of 2026-09-26; one
clarification open (the reference format)

**Input**: User description: "Pago sin comprobante. The payer registers a
recurring payment profile (sending bank + unique reference from their
phone); then (1) the payer only confirms the payment and its date, (2)
Devolada's own people validate what is left directly at Banxico, invisible
to the ISP, and (3) the ISP uploads its bank statement and Devolada does the
match. Order: 1, then 3, then 2."

## Where this comes from

Today a payment is proven by a **capture** of the bank's receipt. The
reader reads it, the provider searches Banxico with what was read, and two
bugs of 2026-09-26 showed the weak spot: a receipt that prints only a
reference can be confirmed with **somebody else's** transfer
(`reference-finds-other-transfer`), and a weekend transfer is searched on
days that cannot hold it (`reference-search-business-day`). Banco Azteca
makes the first one the common case: its default reference is the last
seven digits of the receiving CLABE, so every Azteca payer of one ISP shares
it.

On 2026-09-26 the creator measured the provider directly, 15 paid calls,
and read three of Banxico's answers whole
(`.specify/bugs/reference-finds-other-transfer/measurement.md`). What holds
this spec up:

- A reference plus **amount plus sending bank plus day** separates
  transfers. Same reference at $3.00 and $3.01, or from Azteca and from Nu,
  each returned its own CEP. Only the *time* is not a filter.
- When several transfers still match, the provider does not pick one and
  does not refuse: it answers "invalid, Banxico confirmed" and hands over a
  **ZIP with one signed Banxico CEP per match**, each with its credit time
  to the second.
- A CEP validated before comes back again, marked as validated before.
- The **printed day** of a transfer (the day the money moved) found every
  transfer; the business day Banxico files it under missed once.
- Banxico's own CEP query is **free**. One at a time it takes a reference
  but has an image captcha per query and runs 09:30–23:00. **By batch**
  (`cep-scl`) it takes a text file of up to 500 lines, one captcha per file,
  and mails back a ZIP of signed CEPs — but only by **clave de rastreo**,
  never by reference.
- The ISP's bank can hand over its movements. BBVA's export from Net Cash
  lists every SPEI credit with date, amount, sender, reference and clave.
  BBVA's automated feeds exist but are per-company enterprise contracts
  (tens of thousands of pesos to set up, thousands a month), out of reach
  for the ISPs Devolada serves.

The creator's decision: **the payer stops sending captures.** They register
once how they pay, and from then on validation is layered — instant with
the provider, free with the ISP's statement, and human with Banxico for
whatever is left. The receipt path stays as the fallback for payers who
never registered.

## Clarifications

### Session 2026-09-26

- Q: Who runs the manual Banxico queries? → A: **Devolada's own
  people**, as platform operators. Never the ISP's staff. The ISP sees only
  validated payments; that human work *is* the service Devolada sells.
- Q: Does Devolada query Banxico by machine? → A: **No.** Banxico's forms
  carry a captcha; a person solves it. Devolada prepares everything up to
  and after that click.
- Q: Does option 3 start with a bank API? → A: **No.** The ISP uploads the
  export by hand in its panel. A large ISP that has its own bank feed may
  bring it later; not in this feature.
- Q: In what order are the three layers delivered? → A: **1, then 3,
  then 2.** Each is independently useful and each is a user story below in
  that order.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The payer registers how they pay (Priority: P1)

A customer of the ISP opens their permanent payment link (or answers the
ISP's WhatsApp) and, instead of uploading a capture, tells Devolada **which
bank they pay from** and receives **their own reference number** to put on
every transfer from now on. The page shows them, in their bank's words,
where that number goes ("Referencia numérica", "Concepto/Referencia") and
that the amount is always the one on their invoice. From then on their
payment link opens on "¿Ya pagaste?" instead of "Sube tu comprobante".

**Why this priority**: nothing else in this feature works without a
registered payer. A unique reference per customer is what removes the
shared-reference ambiguity at its root, and it is the only thing that has
to change on the payer's side.

**Independent Test**: register a payer with bank + reference on a fresh
ISP, reopen their link, and see the confirmation screen with their
reference and bank; try to register a second payer of the same ISP with the
same reference and be refused. Delivers value alone: the ISP can already
tell its Azteca customers apart by reference on any receipt.

**Acceptance Scenarios**:

1. **Given** a customer with a payment link and no profile, **When** they
   pick their sending bank and confirm, **Then** Devolada shows them a
   reference that is unique inside that ISP, tells them where to type it
   in that bank's app, and their link now opens on the confirmation screen.
2. **Given** a registered payer, **When** they open their link from
   another device, **Then** their reference and bank are shown again, with
   a way to change the bank.
3. **Given** a reference already assigned to another customer of the same
   ISP, **When** a second customer would receive it, **Then** Devolada
   assigns a different one and never shows a shared reference.
4. **Given** a registered payer who uploads a capture anyway, **When** the
   capture's reference differs from their registered one, **Then** the
   payment is still accepted on the receipt path and the payer is reminded
   of their reference.

---

### User Story 2 - The payer confirms and is reconnected (Priority: P1)

The registered payer transfers the invoice amount with their reference,
opens their link (or writes "ya pagué" on WhatsApp) and confirms **that
they paid and on which day**. Devolada asks the provider with the
reference, the invoice amount, the registered bank and the day the payer
gave. If Banxico has exactly that transfer, the payment is confirmed and
the reconnection fires as today. If it is not there yet, Devolada keeps
looking on its own for a bounded time and tells the payer so. If more than
one transfer matches, Devolada does not guess; the payment waits for the
human layer with a visible status.

**Why this priority**: this is the instant path — one confirmation, one
paid provider call, the reconnection in seconds — and it retires the
capture and the reader from the main flow.

**Independent Test**: with a registered payer and a transfer made with
their reference, confirm with the right day and see the payment confirmed
and the action queued; confirm with a day where nothing exists and see the
"seguimos buscando" status and the later retry.

**Acceptance Scenarios**:

1. **Given** a registered payer whose transfer Banxico holds for the day
   given, **When** they confirm "ya pagué" with that day, **Then** the
   payment is confirmed with that CEP, the credit time is recorded, and the
   reconnection fires.
2. **Given** a confirmation for a day where Banxico holds nothing, **When**
   the first search returns nothing, **Then** the payer sees that Devolada
   is still looking, the search is retried on the next plausible day
   without asking the payer again, and the payment expires with a clear
   status if it is never found.
3. **Given** a reference, amount, bank and day that match **several**
   transfers (the payer paid twice that day), **When** the provider answers
   with the bundle of CEPs, **Then** no payment is confirmed automatically,
   the bundle is kept with the payment, and the payment appears in the
   human queue (User Story 4) with the status "en revisión".
4. **Given** a transfer already used to confirm another payment, **When**
   it comes back marked as validated before, **Then** it does not confirm a
   second payment and the payer is told which payment already used it.
5. **Given** a payer who confirms the wrong day (the day before, a
   weekend), **When** Banxico finds nothing on that day, **Then** the retry
   asks the days a transfer of that date can be filed under, and the payer
   is not asked to upload anything.
6. **Given** a payer who confirms with the amount wrong (their invoice is
   $350 and they sent $300), **When** the search by the invoice amount finds
   nothing, **Then** the payment is not confirmed, the payer is told the
   amount Devolada looked for, and the partial-payment rules that already
   exist apply once the human layer finds the transfer.

---

### User Story 3 - The ISP uploads its bank statement and Devolada matches it (Priority: P2)

An ISP operator exports the account movements from its bank (BBVA Net
Cash first) and uploads the file in the panel. Devolada reads every SPEI
credit — date, amount, sender, reference, clave when printed — and matches
each one against the payments it expects: registered payers by reference +
amount + date, and any pending payment by clave when the statement prints
one. Matched payments are confirmed with the strongest proof there is (the
money is in the ISP's account) and their reconnection fires. Credits that
match no expected payment are listed for the operator. The claves
collected feed the human layer's Banxico batch.

**Why this priority**: free, no captcha, no provider, and it closes what
the instant path did not (the payer who never confirmed, the search that
found nothing). It waits for the upload, so it is second, not first.

**Independent Test**: upload a BBVA export that holds three credits with
known references and amounts; see two matching payments confirmed, one
credit listed as unmatched, and the claves stored on the confirmed rows.

**Acceptance Scenarios**:

1. **Given** a BBVA Net Cash export, **When** the operator uploads it,
   **Then** Devolada shows how many credits it read, how many matched, how
   many did not, and confirms the matched payments.
2. **Given** a credit whose reference, amount and date match one pending
   payment of a registered payer, **When** the file is processed, **Then**
   that payment is confirmed with source "estado de cuenta" and its clave
   recorded.
3. **Given** a credit that matches a payment already confirmed, **When**
   the file is processed, **Then** nothing changes and the credit is shown
   as "ya conciliado".
4. **Given** the same file uploaded twice, **When** it is processed again,
   **Then** no payment is confirmed twice and the operator sees it was
   already imported.
5. **Given** a credit that matches no expected payment, **When** the file
   is processed, **Then** it appears in an "abonos sin cliente" list with
   its sender, amount and reference, and the operator can assign it to a
   customer by hand.
6. **Given** an export from a bank Devolada cannot read yet, **When** it is
   uploaded, **Then** the operator is told which banks are supported and
   nothing is imported.

---

### User Story 4 - Devolada's people validate the remainder at Banxico (Priority: P3)

A Devolada platform operator opens the remainder queue: payments no layer
could close — no confirmation received, nothing found after the retries,
several matches, a credit without a customer. For each, Devolada shows the
exact data Banxico's form asks for (date, reference or clave, sending
bank, receiving bank, account, amount) ready to copy, and, for every
payment that already has a clave, a **ready-made batch file** for Banxico's
bulk service (up to 500 per file). The operator runs the queries by hand,
solves the captcha, and uploads Banxico's answer — a PDF, an XML or a ZIP
of several — back into Devolada. Devolada matches every CEP in it to its
payment by clave, or by reference + amount + credit time, checks the seal,
confirms what matches, and shows what did not. The ISP never sees this
queue; it sees payments become confirmed.

**Why this priority**: it is what makes the service complete — the ISP
never has to look at a doubtful payment — but it scales with people, so it
comes after the two automatic layers have taken everything they can.

**Independent Test**: put two payments in the queue, one with a clave and
one with only a reference; download the batch file and see one line with
the right fields and bank codes; upload a ZIP holding the CEPs of both and
see both confirmed with credit time and a seal check recorded.

**Acceptance Scenarios**:

1. **Given** payments in the remainder queue, **When** the operator opens
   it, **Then** each shows why it is there and the six fields Banxico asks
   for, in Banxico's format, ready to copy.
2. **Given** queued payments that hold a clave, **When** the operator asks
   for the batch file, **Then** Devolada produces the text file in
   Banxico's layout (date, clave, sending bank code, receiving bank code,
   account, amount), at most 500 lines, and records which payments went
   into it.
3. **Given** Banxico's answer uploaded (PDF, XML or a ZIP of several),
   **When** Devolada reads it, **Then** every CEP is matched to a payment by
   clave, or by reference + amount + credit time; matched payments are
   confirmed with source "Banxico, validado por Devolada" and the
   reconnection fires.
4. **Given** a CEP in the answer that matches no queued payment, **When**
   the file is read, **Then** it is listed as unmatched with its reference,
   amount and time, and the operator can assign it by hand.
5. **Given** a CEP whose seal does not verify, **When** the file is read,
   **Then** it confirms nothing and is flagged for the operator.
6. **Given** an ISP operator, **When** they use the panel, **Then** nothing
   of this queue is visible to them; their payment shows "en revisión"
   until it is confirmed or expires.

---

### Edge Cases

- **Two customers of one ISP have phone numbers that end in the same
  digits.** The reference must still be unique inside the ISP; Devolada
  assigns a different one to the second and tells them.
- **The payer's bank app does not let them set the reference, or resets it
  to a default.** The payer's transfer arrives with the wrong reference;
  neither the instant path nor the statement match by reference find it.
  It reaches the remainder queue by "no confirmation / nothing found", and
  the operator can match it by amount, sender and time. The profile should
  record the bank so the ISP can see which banks fail this way.
- **The payer changes bank.** The profile keeps one current bank; the
  search uses it. A transfer from another bank is not found by the instant
  path and falls to the statement or the human layer.
- **The payer pays twice the same day with the same reference.** Several
  matches: the bundle is kept, nothing is confirmed automatically, the
  human layer picks by credit time, and the second transfer is a credit
  without an invoice (an overpayment the existing rules already name).
- **The payer confirms before the transfer is filed.** A confirmation
  minutes after the transfer may find nothing yet; the retry on the next
  plausible day covers it without a second confirmation.
- **The invoice amount changes between the transfer and the confirmation.**
  The search uses the invoice amount at confirmation time; a mismatch falls
  to the statement, which matches by the actual amount.
- **A statement holds credits from customers who never registered.** They
  match by clave when a pending capture payment recorded one; otherwise
  they are "abonos sin cliente" for the operator.
- **Banxico's ZIP holds CEPs for other customers than the one queued** (the
  shared Azteca reference). Each CEP is matched on its own; the ones that
  match other pending payments confirm those; the rest are listed.
- **The provider's monthly quota runs out.** The instant path degrades to
  "seguimos buscando" and the payment waits for the statement or the human
  layer; the platform operator sees the quota state.
- **Banxico's batch link expires (9 days).** The batch record shows when it
  was produced; an operator who missed the window produces the file again.

## Requirements *(mandatory)*

### Functional Requirements

**Profile**

- **FR-001**: A payer MUST be able to register, from their payment link and
  without a session, the bank they pay from and receive a numeric reference
  that is unique inside their ISP and fits what SPEI accepts (at most 7
  digits).
- **FR-002**: The reference MUST be derived from the payer's phone number
  where that yields a unique value inside the ISP, and assigned by Devolada
  otherwise; the payer always sees which number is theirs. [NEEDS
  CLARIFICATION: is the default the last 7 digits of the phone, so a payer
  can guess it, or a short number Devolada assigns, so it is never
  guessable and never collides? See Q1.]
- **FR-003**: The profile MUST show the payer, in their bank's own
  wording, where the reference goes, and that the amount is the invoice's.
- **FR-004**: The ISP operator MUST be able to see, per customer, whether a
  profile exists, its bank and reference, and to reset it.
- **FR-005**: A registered payer's link MUST open on the confirmation
  screen; the receipt path MUST remain reachable from it.

**Instant path**

- **FR-006**: A registered payer MUST be able to confirm a payment with
  only the day it was made, from the payment page and from WhatsApp.
- **FR-007**: On confirmation Devolada MUST search by reference, invoice
  amount, registered bank and the day given, spending one provider call.
- **FR-008**: A single valid match MUST confirm the payment and fire the
  existing action; the credit time MUST be recorded with it.
- **FR-009**: Nothing found MUST NOT ask the payer again: Devolada retries
  on the days a transfer of that date can be filed under, within the
  bounded life of a payment, and shows "seguimos buscando".
- **FR-010**: Several matches MUST NOT confirm anything; the bundle of CEPs
  MUST be kept with the payment and the payment MUST enter the remainder
  queue with status "en revisión".
- **FR-011**: A CEP marked as validated before MUST NOT confirm a second
  payment.
- **FR-012**: The provider quota MUST be visible to the platform operator,
  and running out MUST degrade to "seguimos buscando", never to an error
  shown to the payer.

**Statement**

- **FR-013**: An ISP operator MUST be able to upload a bank movement export
  in the panel; BBVA Net Cash's export is the first supported format, and
  an unsupported one is refused with the list of supported banks.
- **FR-014**: Devolada MUST read every SPEI credit from the file — date,
  amount, sender, reference, clave when present — and match it to expected
  payments by reference + amount + date for registered payers, and by clave
  for any pending payment.
- **FR-015**: A matched credit MUST confirm its payment with the source
  "estado de cuenta", record the clave, and fire the action; a credit
  matching an already-confirmed payment MUST change nothing.
- **FR-016**: The same file uploaded again MUST confirm nothing twice.
- **FR-017**: Credits that match nothing MUST be listed with sender,
  amount, reference and date, and the operator MUST be able to assign one
  to a customer by hand.
- **FR-018**: The import MUST report what it read, matched, skipped and
  could not read.

**Remainder queue (platform operator only)**

- **FR-019**: Payments no layer closed MUST appear in a queue visible only
  to platform operators, each with its reason and the six fields Banxico's
  form asks for, in Banxico's format and bank codes.
- **FR-020**: For queued payments that hold a clave, Devolada MUST produce
  Banxico's batch text file (date, clave, sending bank code, receiving bank
  code, account, amount; at most 500 lines) and record which payments it
  holds and when it was produced.
- **FR-021**: The operator MUST be able to upload Banxico's answer as PDF,
  XML or a ZIP of several; Devolada MUST match every CEP by clave, or by
  reference + amount + credit time, verify the seal, confirm what matches
  with the source "Banxico, validado por Devolada", and list what does not.
- **FR-022**: Devolada MUST NOT query Banxico's forms by machine.
- **FR-023**: An ISP operator MUST see nothing of the queue; the payment
  shows "en revisión" until confirmed or expired.

**Across all**

- **FR-024**: Every confirmation MUST record its source (provider,
  statement, Banxico by Devolada, receipt) and, where known, the clave and
  the credit time, so a payment can be traced to the transfer that paid it.
- **FR-025**: Amounts MUST be exact to the cent in every match; no
  tolerance.
- **FR-026**: Data from statements and CEPs (sender names, accounts) MUST
  be kept only under the ISP it belongs to and shown only to that ISP's
  operators and to platform operators.

### Key Entities

- **Payer profile**: a customer's way of paying — sending bank, unique
  reference inside the ISP, when it was registered, from which channel.
- **Confirmation**: a payer's "ya pagué" — the day given, the channel, and
  the search it triggered.
- **Statement import**: one uploaded bank file — bank, format, when, by
  whom, counts of read / matched / unmatched / skipped.
- **Statement credit**: one SPEI credit read from an import — date, amount,
  sender, reference, clave, and the payment it matched or "sin cliente".
- **Remainder item**: a payment waiting for a person — reason, the
  Banxico form fields, the batch file it went into, the answer that closed
  it.
- **Banxico batch**: a produced text file — the payments it holds, when it
  was produced, whether an answer came back.
- **Payment** (existing): gains a confirmation source, a clave and a credit
  time on every confirmation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A registered payer is reconnected within 1 minute of
  confirming a transfer Banxico already holds, with no capture uploaded.
- **SC-002**: For registered payers, no payment is ever confirmed with a
  transfer that belongs to another customer: 0 wrong-customer
  confirmations in a month of pilot, measured against the ISP's statement.
- **SC-003**: The instant path spends at most 2 provider calls per payment
  on average over a month.
- **SC-004**: A statement upload of one month of a 1,000-customer ISP is
  matched and reported in under 2 minutes, and confirms at least 90% of the
  credits whose payers are registered.
- **SC-005**: A platform operator closes a batch of 100 queued payments
  that hold claves — file out, Banxico, answer in — in under 15 minutes of
  their own time.
- **SC-006**: Within two months of launch at the pilot ISP, at least 70% of
  confirmed payments come through the profile paths (instant, statement,
  Banxico) rather than a capture.

## Assumptions

- The payer's bank app lets them set a numeric reference and keeps it for
  a saved contact; where it does not, the payment falls to the statement
  or human layers. Which banks keep it is measured at the pilot, not
  assumed.
- The invoice amount comes from WispHub as today; the profile never stores
  an amount.
- The day the payer gives is the day the money moved (the date their app
  prints); Devolada derives the days Banxico may file it under and asks the
  printed day first (measured 2026-09-26: it never missed).
- The provider is the one the engine already uses; its answer to several
  matches (invalid + Banxico confirmed + a ZIP) is the measured behaviour
  of 2026-09-26 and this feature relies on it; its quota is a plan setting
  the platform operator watches.
- BBVA Net Cash's export is the first statement format; other banks are
  added one by one as their exports are seen.
- Banxico's batch service keeps its layout (date, clave, sending bank
  code, receiving bank code, account, amount; 500 lines; answer by mail
  link for 9 days). A change there is a change to this feature.
- The existing payment life cycle, statuses, action queue, partial and
  overpayment rules, and the receipt path stay as they are; this feature
  adds confirmation sources in front of them, it does not replace them.
- The remainder queue is a screen for platform operators with a download
  of the batch file, not a file alone.
- WhatsApp as a channel for the profile and the confirmation follows the
  WhatsApp decision of 2026-09-22 (one shared Devolada number, two-way);
  this feature defines what is said there, not the channel itself.
- Out of scope: bank APIs and automated feeds (per-ISP enterprise
  contracts), any machine query to Banxico, a reference typed by the payer
  on the page (it is registered once, not per payment), and changes to the
  reader.
