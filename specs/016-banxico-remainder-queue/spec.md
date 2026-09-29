# Feature Specification: banxico-remainder-queue

**Feature Branch**: `claude/spec-016-banxico-remainder-queue`

**Created**: 2026-09-29

**Status**: Draft — carved on 2026-09-29 out of spec 012
(`payment-without-receipt`), where it was User Story 4; written from the
creator's decisions of 2026-09-26; one clarification open (how far an
uploaded CEP is trusted)

**Input**: User description: "Hagamos la implementación la historia 1 y 2.
La historia 3 y 4, cada una con su propio spec." The story this spec
carries, as spec 012 put it on 2026-09-26: "(2) Devolada's own people
validate what is left directly at Banxico, invisible to the ISP."

## Where this comes from

Spec 012 decided that the payer stops sending captures and that validation
comes in three layers: **instant** with the provider (spec 012), **free**
with the business's own bank statement (spec 015), and **human** with
Banxico for whatever is left (this spec). The creator fixed the order: 1,
then 3, then 2. This is the last layer. It scales with people, so it
takes only what the two automatic layers could not.

Other specs already send payments here:

- **Spec 013** (`cep-bundle-match`) leaves a payment whose bundle does not
  decide in an undecided state that asks the payer for the clave and never
  expires "until the platform's human queue (spec 012 US4) exists and takes
  it" (013 clarification, 2026-09-27). That queue is this spec.
- **Spec 012** routes a registered payer's several-matches payment to the
  same undecided path, and lets a payment the instant path never found
  expire.
- **Spec 015** leaves credits nobody expected ("abonos sin cliente") and
  keeps every clave it reads for this spec's batch.

What Banxico offers (measured by the creator, 2026-09-26,
`.specify/bugs/reference-finds-other-transfer/measurement.md`):

- Banxico's own CEP query is **free**. One at a time it takes a reference,
  but it has an image captcha per query and runs 09:30–23:00.
- **By batch** (`cep-scl`) it takes a text file of up to 500 lines, one
  captcha per file, and mails back a link to a ZIP of signed CEPs, valid
  for 9 days. It searches **only by clave de rastreo**, never by
  reference. The creator's batch of 30 lines came back the same day with
  16 PDFs and a `resumen.txt`.
- Banxico finds a transfer by its **printed day** (the *fecha de abono*)
  and never by the operation day it files it under: 16 of 16 against 0 of
  14.
- Banxico's batch names each PDF `[<credit day>]<clave>.pdf` (spec 013,
  research R3).

What limits trust (spec 013, research R2, measured 2026-09-27): **a CEP's
seal cannot be verified today.** The CEP names its signing certificate by
a number only, the certificate behind that number cannot be obtained, and
the seal did not verify with the only certificate found (0 of 8). Spec 013
left open "how far a file uploaded by a person is trusted, with no
verifiable seal" for this spec to decide (013 FR-012).

## Clarifications

### Carried from spec 012, session 2026-09-26

- Q: Who runs the manual Banxico queries? → A: **Devolada's own
  people**, as platform operators. Never the business's staff. The
  business sees only validated payments; that human work *is* the service
  Devolada sells.
- Q: Does Devolada query Banxico by machine? → A: **No.** Banxico's forms
  carry a captcha; a person solves it. Devolada prepares everything up to
  and after that click.
- Q: In what order are the three layers delivered? → A: **1, then 3,
  then 2.** This spec is layer 2, delivered last: after specs 012 and 015.

### Session 2026-09-29

- Q: Is the remainder queue part of spec 012? → A: **No.** It is its own
  spec, built after specs 012 and 015.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Devolada operator closes a payment at Banxico, one at a time (Priority: P1)

A Devolada platform operator opens the remainder queue: payments no layer
could close. For each one, Devolada shows why it is there and the exact
data Banxico's form asks for (date, reference or clave, sending bank,
receiving bank, account, amount), in Banxico's format, ready to copy. The
operator runs the query at Banxico by hand, solves the captcha, downloads
the CEP, and uploads it into Devolada. Devolada matches the CEP to its
payment, confirms it with the source "Banxico, validado por Devolada",
and the business's action fires. The business never sees this queue; it
sees its payment go from "en revisión" to confirmed.

**Why this priority**: it is the smallest version of the service Devolada
sells — the business never has to look at a doubtful payment. One query
at a time already works for every reason a payment lands here, including
payments that hold only a reference.

**Independent Test**: put one undecided payment in the queue; open the
queue as a platform operator and see its reason and the six fields in
Banxico's format; upload a CEP PDF for that transfer and see the payment
confirmed with the source "Banxico, validado por Devolada", its clave and
credit time, and the action queued. Open the business's panel and see no
queue, only the payment.

**Acceptance Scenarios**:

1. **Given** payments in the remainder queue, **When** a platform operator
   opens it, **Then** each shows why it is there and the six fields
   Banxico asks for, in Banxico's format and bank codes, ready to copy.
2. **Given** a CEP uploaded for a queued payment (PDF or XML), **When**
   Devolada reads it, **Then** it matches the CEP to the payment by clave,
   or by reference + amount + credit day, confirms it with the source
   "Banxico, validado por Devolada", the clave and the credit time, and
   fires the business's action.
3. **Given** an undecided payment that holds a bundle (spec 013), **When**
   the operator uploads the CEP of one of its candidates, **Then** that
   candidate decides the payment, with no provider call.
4. **Given** an operator of a business, **When** they use the panel,
   **Then** nothing of this queue is visible to them; their payment shows
   "en revisión" until it is confirmed or ends.
5. **Given** a payer whose payment is in the queue, **When** they send the
   clave the undecided path asked for (spec 013), **Then** the payment
   leaves the queue by that path; the queue never holds a payment that is
   already confirmed.

---

### User Story 2 - A batch file closes the payments that hold a clave, many at a time (Priority: P2)

Many queued payments already hold a clave: a receipt that printed it, a
statement credit (spec 015), a candidate the bundle kept. For them,
Devolada produces a ready-made batch file for Banxico's bulk service, up
to 500 lines. The operator uploads it at Banxico with one captcha,
receives the ZIP by mail, and uploads it back into Devolada. Devolada
opens every CEP and confirms every payment that matches.

**Why this priority**: one captcha for up to 500 payments is what keeps
the service affordable as businesses grow. It needs payments that hold a
clave, so it comes after the one-at-a-time path.

**Independent Test**: put two payments that hold a clave in the queue;
download the batch file and see two lines with the right fields and bank
codes; upload a ZIP holding both CEPs and see both payments confirmed
with their credit times.

**Acceptance Scenarios**:

1. **Given** queued payments that hold a clave, **When** the operator asks
   for the batch file, **Then** Devolada produces the text file in
   Banxico's layout (date, clave, sending bank code, receiving bank code,
   account, amount), at most 500 lines, with the printed day as the date,
   and records which payments went into it and when.
2. **Given** Banxico's answer uploaded (a ZIP of PDFs, with or without its
   summary), **When** Devolada reads it, **Then** every CEP is matched to
   its payment by clave, matched payments are confirmed with the source
   "Banxico, validado por Devolada", and the batch shows which of its
   lines came back and which Banxico could not locate.
3. **Given** more than 500 payments that hold a clave, **When** the
   operator asks for the batch, **Then** Devolada produces as many files
   as needed, each within the limit, and no payment goes into two open
   batches.
4. **Given** a batch produced more than 9 days ago with no answer, **When**
   the operator opens it, **Then** Devolada shows that Banxico's link has
   expired and offers to produce the file again.

---

### User Story 3 - CEPs nobody was waiting for are matched or listed (Priority: P3)

An answer from Banxico can hold more than the payments that were asked
for: a shared Azteca reference brings the CEPs of other customers of the
same business. Each CEP is matched on its own. The ones that match other
pending payments confirm those; the rest are listed for the operator
with reference, amount and credit time, and the operator can assign one
to a customer by hand.

**Why this priority**: the answer is already paid for in a person's time;
using all of it closes payments nobody asked about yet. It comes after the
main paths are right.

**Independent Test**: upload a file holding three CEPs, one for a queued
payment, one for another customer's pending payment of the same business,
and one that matches nothing; see two payments confirmed and one CEP
listed as unmatched.

**Acceptance Scenarios**:

1. **Given** a CEP in the answer that matches another pending payment of
   the same business, **When** the file is read, **Then** that payment is
   confirmed too, with the same source.
2. **Given** a CEP that matches no payment, **When** the file is read,
   **Then** it is listed as unmatched with its reference, amount and
   credit time, and the operator can assign it to a customer by hand.
3. **Given** a CEP whose clave already confirmed a payment, **When** the
   file is read, **Then** it confirms nothing and is shown as already
   used.

---

### Edge Cases

- **A payment is in the queue for more than one reason** (undecided, and
  its payer's bank also dropped the reference). It appears once, with
  every reason.
- **A CEP the operator uploads cannot be read** (a scanned PDF, a
  different layout). It confirms nothing and is flagged; the rest of the
  file is still read.
- **A CEP is for another business's account.** It confirms nothing, is
  flagged, and its data is not kept under any business.
- **The CEP's amount differs from the payment's** (the payer sent $300 of
  $350). The payment is confirmed with the amount the CEP carries, and the
  existing partial-payment rules apply.
- **Banxico's service is closed** (outside 09:30–23:00 for single
  queries). The queue still shows everything; the operator runs the
  queries later. Nothing in Devolada depends on Banxico's hours.
- **Banxico answers a line with "No se pudo localizar el pago".** The
  payment stays in the queue with that answer recorded, and its date is
  shown so the operator can check it was the printed day.
- **A statement credit with no customer (spec 015) has a clave.** It can
  go into a batch; its CEP adds the sender's account and the credit time
  to the second, which may let it match a pending payment.
- **Two operators work the queue at once.** A payment confirmed by one is
  gone from the other's view; the second upload of the same CEP confirms
  nothing twice.

## Requirements *(mandatory)*

### Functional Requirements

**Queue (platform operators only)**

- **FR-001**: Payments no layer closed MUST appear in a queue visible only
  to platform operators, each with its reasons: undecided (spec 013 and
  spec 012), nothing found after the retries (on any path), and a
  statement credit without a customer (spec 015).
- **FR-002**: Each queued item MUST show the six fields Banxico's form
  asks for (date, reference or clave, sending bank, receiving bank,
  account, amount), in Banxico's format and bank codes, with the printed
  day as the date, ready to copy.
- **FR-003**: A business's operators MUST see nothing of the queue; a
  queued payment MUST show "en revisión" to them until it is confirmed or
  ends.
- **FR-004**: Devolada MUST NOT query Banxico's forms by machine.

**Answers**

- **FR-005**: A platform operator MUST be able to upload Banxico's answer
  as a PDF, an XML, or a ZIP of several, recognised by its content and not
  by its name.
- **FR-006**: Devolada MUST match every CEP in an answer to a payment by
  clave, or by reference + amount + credit day, confirm what matches with
  the source "Banxico, validado por Devolada", the clave and the credit
  time, and fire the business's existing action.
- **FR-007**: A CEP whose clave already confirmed a payment MUST NOT
  confirm another; a CEP for another business's account or one that
  cannot be read MUST confirm nothing and MUST be flagged.
- **FR-008**: How far an uploaded CEP is trusted before it confirms a
  payment: [NEEDS CLARIFICATION: the seal cannot be verified today (spec
  013 R2). Does a CEP a platform operator uploads confirm on its own,
  with the uploader recorded and the seal kept as not verified, as spec
  013 trusts the provider's ZIP; or must a second platform operator
  approve it first; or does it need something more?]
- **FR-009**: CEPs that match another pending payment of the same business
  MUST confirm it; CEPs that match nothing MUST be listed with reference,
  amount and credit time, and a platform operator MUST be able to assign
  one to a customer by hand.
- **FR-010**: The matching MUST be spec 013's: the same reading of a CEP,
  the same rules for used claves and for other senders' data, with the
  statement's or the payment's own data standing in for a receipt (013
  FR-012).

**Batch**

- **FR-011**: For queued payments that hold a clave, Devolada MUST produce
  Banxico's batch text file (date, clave, sending bank code, receiving
  bank code, account, amount; at most 500 lines per file; the printed day
  as the date) and record which payments each file holds and when it was
  produced. A payment MUST NOT sit in two open batches.
- **FR-012**: A batch MUST show whether its answer came back, which of its
  lines were found and which were not, and, after 9 days without an
  answer, that Banxico's link has expired, with a way to produce the file
  again.

**Across the feature**

- **FR-013**: Every confirmation from this layer MUST record who uploaded
  the answer, which file it came from, the clave and the credit time.
- **FR-014**: Amounts MUST be exact to the cent in every match; no
  tolerance.
- **FR-015**: Data read from CEPs (sender names, accounts, RFC) MUST be
  kept only under the business that received the money, shown only to
  that business's operators and to platform operators, and never to a
  payer.

### Key Entities

- **Remainder item**: a payment (or a statement credit) waiting for a
  person — its reasons, the Banxico form fields, the batch it went into,
  and the answer that closed it.
- **Banxico batch**: a produced text file — the payments it holds, when it
  was produced, whether an answer came back, and what each line returned.
- **Banxico answer**: one uploaded file — who, when, how many CEPs, and
  the fate of each: confirmed a payment, already used, unmatched,
  unreadable, or flagged.
- **Payment** (existing): gains the source "Banxico, validado por
  Devolada" and the answer that confirmed it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A platform operator closes a batch of 100 queued payments
  that hold claves — file out, Banxico, answer in — in under 15 minutes of
  their own time.
- **SC-002**: A business never has to act on a doubtful payment: 0 queue
  items shown to a business's operators, and every queued payment shows
  "en revisión" to them.
- **SC-003**: No payment is confirmed twice from Banxico's answers: 0
  double confirmations over a month of pilot.

## Assumptions

- Specs 012 and 015 ship first; spec 013's undecided path is in place.
  Without them, the queue holds only spec 013's undecided payments.
- Platform operators are the people named by `PLATFORM_OPERATOR_EMAILS`;
  no new role is created.
- Banxico's batch service keeps its layout (date, clave, sending bank
  code, receiving bank code, account, amount; 500 lines; answer by mail
  link for 9 days). A change there is a change to this feature.
- Banxico's answer to a batch is a ZIP of PDFs named by credit day and
  clave, with a summary (measured 2026-09-26). Whether it can carry XML is
  not measured; an XML is read if it comes.
- The one-at-a-time query answers with a downloadable CEP the operator can
  upload. Its exact files are measured before planning.
- The queue is a screen for platform operators with a download of the
  batch file, not a file alone.
- The existing payment life cycle, statuses, action queue, partial and
  overpayment rules, spec 013's matching and undecided path, and the
  receipt path stay as they are; this feature adds a confirmation source
  in front of them.
- Out of scope: any machine query to Banxico; bank APIs; seal
  verification, until Banxico says how bank certificates are obtained
  (spec 013 R2).
