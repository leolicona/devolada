# Feature Specification: cep-bundle-match

**Feature Branch**: `claude/spec-013-cep-bundle-match`

**Created**: 2026-09-26

**Status**: Draft — the flow is the creator's decision of 2026-09-26; two
clarifications open (the time window, and where a payment goes when the
bundle does not decide)

**Input**: User description: "Cuando varias transferencias coinciden,
apiCEP no rechaza la consulta: responde con el ZIP de comprobantes
firmados. Flujo sugerido: 1. Llega el ZIP para el pago de un cliente
conocido; Devolada abre cada CEP, lee la cadena original y verifica el
sello. 2. Quita los CEP cuya clave ya confirmó otro pago. 3. Si el recibo
muestra cuenta origen, quita los CEP cuyo final no coincide. 4. Si el
recibo muestra hora, se queda con el CEP más cercano dentro de la ventana.
5. Queda uno: se confirma con esa clave. Queda cero o más de uno: se pide
la clave al pagador o va a la cola de tu gente."

## Where this comes from

A payer uploads a capture of their receipt. Many receipts print only a
**reference**, no clave de rastreo. Devolada searches Banxico through the
provider with what the receipt shows: reference, amount, sending bank and
the printed day. When exactly one transfer matches, the payment is
confirmed. When **several** match, the provider does not refuse and does
not pick: it answers "invalid, Banxico confirmed" and hands over a **ZIP
holding one complete, signed CEP per matching transfer** (measured
2026-09-26, `.specify/bugs/reference-finds-other-transfer/measurement.md`:
E1 held three, F1 two).

Today Devolada reads that answer as "not found", retries on other days
that answer the same, and never opens the ZIP. The one path that asks the
payer for the clave waits for a "duplicate reference" refusal that the
provider never sends (24 calls, none). So a repeated transfer cannot be
validated, and the ZIP that would settle it sits unopened on the row.

This is the common case, not the corner: Banco Azteca's default reference
is the last seven digits of the receiving CLABE, so **every Azteca payer of
one ISP shares the same reference**, and any two of them who pay the same
amount on the same day are "several matches".

What each CEP in the bundle carries, as plain text in its *cadena
original*: operation day, credit day, **credit time to the second**,
sending bank, **the sender's full CLABE**, receiving bank, destination
account, amount, and the clave de rastreo — plus the receiving bank's
digital seal. What the receipt carries, when it does: the time the
payer's bank printed (seconds included on Azteca), and the sender's
account, masked ("Guardadito ***8301").

Two measured facts shape the matching:

- The receipt's time and the CEP's time are **never equal**. The receipt
  prints the payer's bank clock; the CEP prints the moment the ISP's bank
  credited the money. Measured gaps: 8 s, 22 s, about a minute.
- The four digits a receipt shows are the end of the **account number**,
  not always the end of the CLABE. Azteca's "***8301" is positions 14–17
  of CLABE `127180016171583010`, the digits before the check digit.

And two rules the creator fixed: **no step looks at names** — the CEP's
sender may be a relative paying for the customer — and the account digits
are compared **receipt against CEP**, never against who the customer is.
The link already identifies the customer.

## Clarifications

### Session 2026-09-26

- Q: Does the CEP carry the time the receipt prints? → A: No. The search
  takes a day, never a time, and the CEP carries one time: the credit at
  the ISP's bank. Matching is receipt-time against CEP-time within a
  window, never equality.
- Q: May the sender's name in the CEP confirm the customer? → A: No,
  neither as a filter nor as a confirmation. A relative may pay from their
  own account. The link identifies the customer; nothing in the bundle
  re-proves it.
- Q: Does resolving the bundle need another provider call? → A: No. Each
  CEP is signed by the receiving bank; the seal is the proof. The chosen
  clave is recorded and the payment becomes a clave-known payment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A shared reference resolves to the payer's own transfer (Priority: P1)

An Azteca customer pays the ISP and uploads a capture that shows the
reference, the amount, the time and "Guardadito ***8301". Another Azteca
customer paid the same amount the same day with the same default
reference. The provider answers with a ZIP of two CEPs. Devolada opens
both, drops the one whose sender account does not end in 8301, is left
with one, verifies its seal, confirms the payment with that clave and
credit time, and reconnects the customer. The other customer's CEP is
kept for when they upload theirs.

**Why this priority**: it is the case that today confirms the wrong
customer's transfer or refuses a real payment as "already used". With
Azteca's shared reference it is the everyday case for that bank.

**Independent Test**: seed a payment whose receipt reads reference,
amount, time 07:10:58 and account tail 8301; answer the provider call with
a ZIP of two CEPs (tails 8301 and 4417, times 07:11:20 and 11:40:47); see
the payment confirmed with the 8301 clave and the reconnection queued.

**Acceptance Scenarios**:

1. **Given** a receipt with a reference, amount, day, time and account
   tail, **When** the provider answers with a bundle of several CEPs,
   **Then** Devolada opens every CEP, verifies each seal, and confirms the
   payment with the one CEP whose sender account ends as the receipt shows
   and whose credit time is nearest the receipt's within the window.
2. **Given** the same, **When** the account tail leaves exactly one CEP,
   **Then** the time is not needed to decide and the payment confirms.
3. **Given** a confirmed payment resolved from a bundle, **When** the
   operator opens it, **Then** it shows the clave, the credit time, the
   source "varias coincidencias, resuelto por cuenta/hora", and the bundle
   it came from; the payer sees only "pago confirmado".
4. **Given** a bundle where one CEP's seal does not verify, **When**
   Devolada reads it, **Then** that CEP confirms nothing, is flagged, and
   the rest are still considered.

---

### User Story 2 - The same payer twice on one day is told apart by time (Priority: P1)

A customer pays twice the same day by mistake, 83 seconds apart, same
reference and amount, and uploads the second receipt. The bundle holds two
CEPs from the same account; the account tail cannot tell them apart. The
receipt's time picks the nearest one within the window; the payment
confirms with that clave, and the other transfer stays free for its own
receipt or the overpayment rules.

**Why this priority**: the second everyday duplicate — one payer, two
transfers — is the case the account tail cannot resolve and only the time
can.

**Independent Test**: seed a receipt with time 11:43:36 and tail 8301;
answer with two CEPs from tail 8301 at 11:42:13 and 11:43:36; see the
11:43:36 clave chosen. Repeat with the receipt time 11:42:20 and see the
other one chosen.

**Acceptance Scenarios**:

1. **Given** two CEPs that survive the account filter, **When** the
   receipt shows a time, **Then** the CEP nearest that time within the
   window is chosen, and the distance is recorded with the confirmation.
2. **Given** two surviving CEPs both within the window and closer to each
   other than a set margin, **When** the nearest is not clearly nearest,
   **Then** Devolada does not decide and the payment goes to the undecided
   path (User Story 3).
3. **Given** a receipt with no time, **When** two CEPs survive, **Then**
   Devolada does not decide.

---

### User Story 3 - When the bundle does not decide, the payment says so and asks for the clave (Priority: P2)

The bundle leaves zero or several CEPs: every clave already used, no tail
or time on the receipt, or two transfers too close to call. Devolada does
not guess. The payment shows a clear status, keeps the bundle, stops
spending provider calls, and asks the payer for the clave de rastreo (the
existing ask), which resolves it on the clave path. Payments that reach the
platform's human queue (spec 012, US4) arrive with the bundle already
opened and the surviving candidates listed.

**Why this priority**: an honest "we could not tell" beats both a wrong
confirmation and an endless retry; it is what turns today's silent loop
into a visible, resolvable state.

**Independent Test**: seed a receipt with no time and no tail; answer with
three CEPs; see the payment marked as undecided, no further provider calls
scheduled, and the clave ask shown to the payer.

**Acceptance Scenarios**:

1. **Given** a bundle whose every CEP was already used by other payments,
   **When** Devolada resolves it, **Then** the payment is marked undecided
   with the reason "todas las coincidencias ya se usaron" and the payer is
   told which transfer of theirs may already be confirmed.
2. **Given** a bundle that leaves several candidates, **When** the receipt
   shows neither time nor account tail, **Then** the payment is marked
   undecided, no more provider calls are scheduled for it, and the payer
   is asked for the clave. [NEEDS CLARIFICATION: when the bundle does not
   decide, does the payment ask the payer for the clave first and reach
   the human queue only if the clave never comes, or does it go to the
   human queue at once with the payer told "en revisión"? See Q2.]
3. **Given** an undecided payment whose payer then sends the clave,
   **When** the clave matches one of the kept candidates, **Then** the
   payment confirms from the kept CEP without a new provider call.

---

### User Story 4 - Other customers' CEPs in the bundle confirm their own pending payments (Priority: P3)

The bundle for one customer's payment also holds the CEPs of other
customers who share the reference. When one of those CEPs matches, by
clave, a pending payment of another customer of the same ISP, that
payment is confirmed too. The rest are kept under the ISP, listed for the
operator as transfers received without a payment to attach to.

**Why this priority**: the bundle is paid for once and holds proof for
several customers; using it saves calls and closes payments nobody
uploaded yet. It comes after the primary flow is right.

**Independent Test**: seed two pending payments of two customers, one
with a clave known from its receipt; answer the first customer's search
with a bundle that holds both CEPs; see both payments confirmed.

**Acceptance Scenarios**:

1. **Given** a bundle CEP whose clave matches a pending payment of another
   customer of the same ISP, **When** the bundle is resolved, **Then**
   that payment confirms with its CEP and its own reconnection fires.
2. **Given** a bundle CEP that matches no pending payment, **When** the
   bundle is resolved, **Then** it is kept under the ISP and listed for
   the operator with amount, credit time and account tail — never shown to
   any payer.

---

### Edge Cases

- **The receipt's time is on the other side of midnight** from the CEP's
  credit time (a 23:59:50 transfer credited 00:00:20). The window spans
  the day boundary; the day asked stays the printed one.
- **The receipt prints hours and minutes only.** The window applies to
  the minute; two transfers within the same minute are "too close to
  call".
- **Two banks print the tail differently**: the end of the CLABE or the
  end of the account inside it. Both are compared; a CEP survives if
  either matches.
- **The receipt shows a tail that matches no CEP** (a misread digit). Zero
  candidates: undecided, the clave is asked; the bundle is kept so a later
  clave resolves without a call.
- **The bundle holds one CEP only.** The provider should have answered
  "valid"; Devolada treats it as a single match and confirms it if the
  seal verifies.
- **A CEP in the bundle is for another amount or another receiving
  account** (the provider filtered wrongly). It is dropped and flagged.
- **The provider's ZIP link expires or fails to download.** The payment
  keeps the link, retries the download a bounded number of times, and
  goes undecided with the reason "no se pudo leer el archivo".
- **The bundle arrives on the Banxico batch path** (spec 012 US4). The
  same matching runs, with the operator's statement data as the "receipt"
  side (credit day, amount, tail when the statement prints it).
- **Reuse**: a CEP chosen from a bundle is recorded as used, so the same
  transfer cannot confirm a second payment from another bundle later.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Devolada MUST recognise the provider's "several matches"
  answer (invalid, Banxico confirmed, a bundle to download) as a distinct
  outcome, not as "not found", and MUST NOT schedule further searches for
  that payment on that basis.
- **FR-002**: Devolada MUST download the bundle, keep it with the payment,
  open every CEP in it, read its cadena original (operation day, credit
  day, credit time, sending bank, sender account, receiving bank,
  destination account, amount, clave) and verify its digital seal; a CEP
  whose seal fails confirms nothing and is flagged.
- **FR-003**: Devolada MUST drop every CEP whose clave already confirmed a
  payment.
- **FR-004**: When the receipt shows the sender's account tail, Devolada
  MUST keep only the CEPs whose sender account ends with it, comparing
  against both the end of the CLABE and the end of the account number
  inside the CLABE.
- **FR-005**: When the receipt shows a time, Devolada MUST choose, among
  the surviving CEPs, the one whose credit time is nearest the receipt's
  time within a window of 3 minutes [NEEDS CLARIFICATION: is 3 minutes the
  window? Wider absorbs clock drift; narrower separates back-to-back
  payments. See Q1], and MUST NOT choose when two candidates are within
  30 seconds of each other.
- **FR-006**: Devolada MUST NOT use the sender's name for any step.
- **FR-007**: Exactly one surviving CEP MUST confirm the payment with its
  clave, credit day and credit time, mark that clave as used, record the
  source "varias coincidencias" and how it was decided (tail, time, or
  both), and fire the existing action — without another provider call.
- **FR-008**: Zero or several surviving CEPs MUST leave the payment in a
  visible undecided state with its reason, keep the candidates, stop
  provider calls for it, and ask the payer for the clave (the existing
  ask); a clave that matches a kept candidate MUST confirm from it without
  a new call.
- **FR-009**: A bundle CEP whose clave matches another pending payment of
  the same ISP MUST confirm that payment; every other unmatched CEP MUST
  be kept under the ISP and listed for the operator with amount, credit
  time and account tail.
- **FR-010**: Data of other senders read from a bundle (name, CLABE, RFC)
  MUST be stored only under the ISP that received the money and MUST
  never be shown to a payer.
- **FR-011**: The reader MUST keep the receipt's time with seconds when
  the receipt prints them, and MUST read the sender's account tail when
  the receipt shows one.
- **FR-012**: The same resolution MUST serve a bundle that comes from the
  human path (spec 012 US4), with the statement's credit day, amount and
  tail standing in for the receipt.
- **FR-013**: Every decision MUST be recorded on the payment so the
  operator can see which CEPs were dropped and why.

### Key Entities

- **Bundle**: the provider's (or Banxico's) answer with several CEPs —
  where it came from, when, how many CEPs, which payment asked for it.
- **Bundle CEP**: one signed CEP read from a bundle — clave, credit day
  and time, sending bank, sender account (tail exposed, full value kept
  under the ISP), amount, seal result, and its fate: chosen, dropped
  (reason), matched another payment, or kept unmatched.
- **Payment** (existing): gains the undecided state with its reason, the
  chosen clave and credit time, and the decision trail.
- **Receipt reading** (existing): gains the account tail and the time
  with seconds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A payment whose receipt shows a time or an account tail, and
  whose reference matches several transfers, is confirmed with its own
  transfer within 2 minutes of upload, with no clave asked.
- **SC-002**: No payment is confirmed with another customer's transfer: 0
  wrong-customer confirmations over a month at the pilot ISP, checked
  against its bank statement.
- **SC-003**: A "several matches" answer costs one provider call, never a
  retry loop: at most 1 call per payment for that outcome.
- **SC-004**: Every undecided payment shows its reason to the operator and
  asks the payer for the clave within 1 minute of the bundle arriving.
- **SC-005**: At least 80% of Azteca receipts that print only a reference
  are confirmed without asking the payer for the clave, over a month at
  the pilot ISP.

## Assumptions

- The provider's "several matches" answer keeps the measured shape
  (invalid + Banxico confirmed + a downloadable ZIP of CEP PDFs). A change
  there is a change to this feature.
- Each CEP's cadena original is readable as text from the file, and the
  seal can be verified against the receiving bank's certificate named in
  the CEP.
- The receipt's day is the day asked; the search rule of
  `reference-search-printed-day` is in place.
- The account tail on receipts is four digits; banks that print more are
  compared on their full printed tail.
- The window is measured from the receipt's time forward and backward
  equally.
- Bundles are kept for as long as the payment they came with, then
  removed with it.
- The existing clave ask, action queue, partial and overpayment rules are
  unchanged; this feature adds a decision in front of them.
- Out of scope: any name matching; any change to the reader's model; the
  human queue's screens (spec 012); the Banxico batch file itself.
