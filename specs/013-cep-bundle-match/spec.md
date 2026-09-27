# Feature Specification: cep-bundle-match

**Feature Branch**: `claude/spec-013-cep-bundle-match`

**Created**: 2026-09-26

**Status**: Clarified 2026-09-27 — the flow is the creator's decision of
2026-09-26; the window, the undecided path, the single-match case, the
shared-reference stop and the seal were settled in session 2026-09-27

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

The business can be an ISP or any other business that collects by SPEI
through Devolada — from its panel or through the `/v1` API. What happens
after a confirmation is the business's own action: an ISP's WispHub
reconnection, an API business's webhook. Nothing in this feature depends
on which.

A payer uploads a capture of their receipt. Many receipts print only a
**reference**, no clave de rastreo. Devolada searches Banxico through the
provider with what the receipt shows: reference, amount, sending bank and
the printed day. When exactly one transfer matches, the provider answers
`valid` with that CEP. When **several** match, the provider does not
refuse and does not pick: it answers `invalid` with `banxicoConfirmed:
true` and a link to a **ZIP holding one CEP per matching transfer**
(measured 2026-09-26, `.specify/bugs/reference-finds-other-transfer/
measurement.md`: E1 held three, E6 three, F1 two). No field says how many.

Today Devolada reads that answer as "not found": the adapter does not read
`banxicoConfirmed`, and an `invalid` with no CEP is `not_found`. The row
rides the `not_found` schedule, about eight paid calls over twelve hours,
each returning the same ZIP, and ends `expired`. The link is never stored,
so the ZIP is never opened. The one path that asks the payer for the clave
waits for a "duplicate reference" refusal the provider never sends (24
calls, none).

This is the common case, not the corner: Banco Azteca's default reference
is the last seven digits of the receiving CLABE, so **every Azteca payer of
one business shares the same reference**, and any two of them who pay the same
amount on the same day are "several matches".

The single match is not safe either. A receipt printed 18:58 with no clave
was confirmed with the payer's own 07:19 transfer of the same day,
reference and amount: the provider answered one `valid`, and nothing
checked that it could be the receipt's transfer (bug
`reference-finds-other-transfer`, severity critical).

What the provider hands over (measured 2026-09-26 and 2026-09-27,
research.md R1):

- **The ZIP**: served as `application/pdf` with a `.pdf` name, but a ZIP.
  One file per match, `CEP-<operation day>-<clave>.pdf`, about 28 KB each.
  PDF only — no XML.
- **Each CEP** is Banxico's one-page comprobante, with extractable text:
  operation day, credit day, **credit time to the second** (Mexico City
  time, the CEP says so), amount, reference, clave, and for each side the
  bank, holder, RFC/CURP, account type and account. The *cadena original*
  repeats every field in one pipe-separated string — except the **clave
  and the reference, which are not in it**. The PDF prints the cadena
  wrapped over three lines.
- **The single match** (`valid`) carries the same data as JSON:
  `cepDetails.processingTime` (the credit time), `senderAccount`,
  `senderAccountType` and the cadena (`cdaChain`) in one line.

What the receipt carries, when it does: the time the payer's bank printed
(seconds included on Azteca), and the sender's account, masked
("Guardadito ***8301").

Three measured facts shape the matching:

- The receipt's time and the CEP's time are **never equal**. The receipt
  prints the payer's bank clock at sending; the CEP prints the moment the
  business's bank credited the money. Measured gaps: 8 s, 22 s, about a minute —
  the credit after the send every time.
- The four digits a receipt shows are the end of the **account number**,
  not always the end of the CLABE. Azteca's "***8301" is positions 14–17
  of the payer's CLABE, the digits before the check digit; the CLABE
  itself ends in 3010.
- The CEP's sender account is not always a CLABE. The CEP labels it
  "CLABE, Tarjeta de débito, Número de celular", and the cadena carries the
  account type beside it.

And **the seal cannot be verified** (measured 2026-09-27, research.md R2).
The CEP names its signing certificate by a number only. Three agencies
issue certificates under Banxico's security infrastructure (Banxico, SAT,
CECOBAN) and number them independently; the SAT's certificate under the
number all eight measured CEPs carry belongs to an unrelated person, and
the seal does not verify with it (0 of 8). Banxico publishes the agencies'
certificates, not the banks'. So a bundle is trusted exactly as every
`valid` is today: as the provider's answer. The seal arrives with every
`valid` and Devolada has never checked it.

Two rules the creator fixed: **no step looks at names** — the CEP's sender
may be a relative paying for the customer — and the account digits are
compared **receipt against CEP**, never against who the customer is. The
link already identifies the customer.

## Clarifications

### Session 2026-09-26

- Q: Does the CEP carry the time the receipt prints? → A: No. The search
  takes a day, never a time, and the CEP carries one time: the credit at
  the business's bank. Matching is receipt-time against CEP-time within a
  window, never equality.
- Q: May the sender's name in the CEP confirm the customer? → A: No,
  neither as a filter nor as a confirmation. A relative may pay from their
  own account. The link identifies the customer; nothing in the bundle
  re-proves it.
- Q: Does resolving the bundle need another provider call? → A: No. The
  chosen clave is recorded and the payment becomes a clave-known payment.
  *Amended 2026-09-27*: the reason is not the seal, which cannot be
  verified (R2). The ZIP comes from the same provider every confirmation
  already trusts; a second call by clave would ask that source again and
  add no trust — it would only buy the provider's "validated before" flag
  and the XML, at one more credit and about five seconds per payment.

### Session 2026-09-27

- Q: Can Devolada verify a CEP's seal itself? → A: No, not today. The
  certificate cannot be obtained from the number the CEP carries (R2). The
  seal is kept with the CEP, marked not verified. Asking Banxico how bank
  certificates are obtained is open; if it answers, verification returns,
  first where a person uploads the file (spec 012).
- Q: What window pairs the receipt's time with a CEP's credit time? → A:
  From 1 minute before to 3 minutes after the receipt's time: a credit
  cannot precede its send except by clock drift. Among the CEPs inside,
  the nearest is chosen, and none is chosen when the two nearest were
  credited within 30 seconds of each other. The distance is recorded with
  every confirmation so the window can be measured again.
- Q: When the bundle does not decide, does the payment ask for the clave
  first or go to the human queue at once? → A: The clave first. The
  payment stops calling and asks the payer for the clave; a typed clave is
  compared against the kept candidates, forgiving O for 0, I for 1 and one
  missing character, with no call. While it holds a bundle, the payment
  never ends `expired`: it stays visible as undecided until the clave
  arrives, or until the platform's human queue (spec 012 US4) exists and
  takes it.
- Q: Does the matching also apply when the provider answers a single
  `valid` for a search without a clave? → A: Yes. Every CEP found without a
  clave passes the same filter, one or several. A single CEP the receipt
  contradicts does not confirm; the clave is asked. This closes bug
  `reference-finds-other-transfer`.
- Q: What happens to the shared-reference stop (receipt-triage D7), which
  today asks the clave without calling when another payment of the business
  holds the same reference, day, bank and amount? → A: It stops the call
  only when the receipt shows neither a time nor an account tail. With
  either, the search runs and the bundle decides.
- Q: How is the account tail compared when the sender's account is not a
  CLABE? → A: By the account type the CEP names: for a CLABE, the end of
  the CLABE or the end of the account number inside it; for a debit card
  or a phone, the end of that number.
- Q: How does a business on the `/v1` API learn that a payment waits on the
  payer, now that an undecided payment never expires and no event
  announces it? → A: The payment it reads says what it awaits — the
  payer's clave — and why (all used, ambiguous, no match, unreadable), in
  two new fields that change nothing else. No status word, no new event.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A shared reference resolves to the payer's own transfer (Priority: P1)

An Azteca customer pays a business and uploads a capture that shows the
reference, the amount, the time and "Guardadito ***8301". Another Azteca
customer paid the same amount the same day with the same default
reference. The provider answers with a ZIP of two CEPs. Devolada opens
both, drops the one whose sender account does not end in 8301, is left
with one, confirms the payment with that clave and credit time, and
fires the business's action (for an ISP, the reconnection). The other customer's CEP is kept for when they
upload theirs.

The same filter guards the single match: when the provider answers one
`valid` for a search without a clave, the CEP confirms only if the receipt
does not contradict it.

**Why this priority**: it is the case that today refuses a real payment
after twelve hours of silence, or confirms a transfer that is not the
receipt's. With Azteca's shared reference it is the everyday case for that
bank.

**Independent Test**: seed a payment whose receipt reads reference,
amount, time 07:10:58 and account tail 8301; answer the provider call with
a ZIP of two CEPs (tails 8301 and 4417, credit times 07:11:20 and
11:40:47); see the payment confirmed with the 8301 clave, one provider
call, and the business's action queued. Then seed a receipt printed 18:58 with
no clave and answer a single `valid` credited 07:19:52; see the payment
not confirmed and the clave asked.

**Acceptance Scenarios**:

1. **Given** a receipt with a reference, amount, day, time and account
   tail, **When** the provider answers with a bundle of several CEPs,
   **Then** Devolada opens every CEP and confirms the payment with the one
   CEP whose sender account ends as the receipt shows and whose credit
   time is nearest the receipt's within the window — with no further
   provider call.
2. **Given** the same, **When** the account tail leaves exactly one CEP,
   **Then** the time is not needed to decide and the payment confirms.
3. **Given** a confirmed payment resolved from a bundle, **When** the
   operator opens it, **Then** it shows the clave, the credit time, the
   source "varias coincidencias, resuelto por cuenta/hora", and the bundle
   it came from; the payer sees only "pago confirmado".
4. **Given** a bundle where one CEP cannot be read, **When** Devolada
   reads it, **Then** that CEP confirms nothing, is flagged, and the rest
   are still considered.
5. **Given** a receipt with a time and no clave, **When** the provider
   answers a single `valid` whose credit time is outside the window (a
   receipt printed 18:58, a CEP credited 07:19:52), **Then** the payment
   does not confirm, the CEP is kept as a candidate, and the payer is asked
   for the clave.
6. **Given** a receipt with neither time nor account tail, **When** the
   provider answers a single `valid`, **Then** nothing contradicts it and
   the payment confirms as it does today.

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

**Independent Test**: seed a receipt with time 11:43:20 and tail 8301;
answer with two CEPs from tail 8301 credited 11:42:13 and 11:43:36; see
the 11:43:36 clave chosen. Repeat with the receipt time 11:42:05 and see
the other one chosen.

**Acceptance Scenarios**:

1. **Given** two CEPs that survive the account filter, **When** the
   receipt shows a time, **Then** the CEP nearest that time within the
   window is chosen, and the distance is recorded with the confirmation.
2. **Given** two surviving CEPs both within the window and credited within
   30 seconds of each other, **When** Devolada compares them, **Then** it
   does not decide and the payment goes to the undecided path (User
   Story 3).
3. **Given** a receipt with no time, **When** two CEPs survive, **Then**
   Devolada does not decide.

---

### User Story 3 - When the bundle does not decide, the payment says so and asks for the clave (Priority: P2)

The bundle leaves zero or several CEPs: every clave already used, no tail
or time on the receipt, or two transfers too close to call. Devolada does
not guess. The payment shows a clear undecided state with its reason,
keeps the bundle, stops spending provider calls, and asks the payer for the
clave de rastreo. A clave that fits one of the kept candidates confirms
the payment without a call. While it holds a bundle the payment never
expires; the platform's human queue (spec 012 US4) will take such payments
with the bundle already opened and the candidates listed.

**Why this priority**: an honest "we could not tell" beats both a wrong
confirmation and an endless retry; it is what turns today's silent loop
into a visible, resolvable state.

**Independent Test**: seed a receipt with no time and no tail; answer with
three CEPs; see the payment marked undecided, no further provider calls
scheduled, and the clave ask shown to the payer. Send a clave with an O in
place of a 0 of one candidate; see the payment confirmed from the kept CEP
with no provider call.

**Acceptance Scenarios**:

1. **Given** a bundle whose every CEP was already used by other payments,
   **When** Devolada resolves it, **Then** the payment is marked undecided
   with the reason "todas las coincidencias ya se usaron" and the payer is
   told a transfer of theirs may already be confirmed.
2. **Given** a bundle that leaves several candidates, **When** the receipt
   shows neither time nor account tail, **Then** the payment is marked
   undecided, no more provider calls are scheduled for it, and the payer
   is asked for the clave.
3. **Given** an undecided payment whose payer then sends the clave,
   **When** the clave fits exactly one of the kept candidates — as typed,
   or with O read as 0, I read as 1, or one character missing — **Then**
   the payment confirms from the kept CEP without a new provider call.
4. **Given** an undecided payment that holds a bundle, **When** its
   schedule would end, **Then** it does not become `expired`: it stays
   undecided and visible to the operator with its candidates.
5. **Given** an undecided payment of a business that uses the `/v1` API,
   **When** the business reads the payment, **Then** it sees that the
   payment awaits the payer's clave, and why; nothing else it reads
   changes.

---

### User Story 4 - Other customers' CEPs in the bundle confirm their own pending payments (Priority: P3)

The bundle for one customer's payment also holds the CEPs of other
customers who share the reference. When one of those CEPs matches, by
clave, a pending payment of another customer of the same business, that
payment is confirmed too, without a provider call of its own. The rest are
kept under the business, listed for the operator as transfers received without
a payment to attach to.

**Why this priority**: the bundle is paid for once and holds proof for
several customers; using it saves calls and closes payments nobody
uploaded yet. It comes after the primary flow is right.

**Independent Test**: seed two pending payments of two customers, one
with a clave known from its receipt; answer the first customer's search
with a bundle that holds both CEPs; see both payments confirmed and one
provider call in total.

**Acceptance Scenarios**:

1. **Given** a bundle CEP whose clave matches a pending payment of another
   customer of the same business, **When** the bundle is resolved, **Then**
   that payment confirms with its CEP and its own action fires.
2. **Given** a bundle CEP that matches no pending payment, **When** the
   bundle is resolved, **Then** it is kept under the business and listed for
   the operator with amount, credit time and account tail — never shown to
   any payer.

---

### Edge Cases

- **The receipt's time is on the other side of midnight** from the CEP's
  credit time (a 23:59:50 transfer credited 00:00:20). The window spans
  the day boundary; the day asked stays the printed one.
- **The receipt prints hours and minutes only.** The receipt's time is the
  whole minute; two transfers credited within the same minute are "too
  close to call".
- **Banks print the tail differently**: the end of the CLABE or the end of
  the account inside it. Both are compared; a CEP survives if either
  matches. A debit card or a phone is compared on its own end.
- **The receipt shows a tail that matches no CEP** (a misread digit). Zero
  candidates: undecided, the clave is asked; the bundle is kept so a later
  clave resolves without a call.
- **The bundle holds one CEP only.** It is a single match and passes the
  same filter as any other.
- **A CEP in the bundle is for another amount or another receiving
  account** (the provider filtered wrongly). It is dropped and flagged.
- **The file says PDF but is a ZIP.** It is recognised by its content,
  never by its name or its declared type.
- **The provider's ZIP link expires or fails to download.** Downloading is
  not a provider call. The payment keeps the link, retries the download a
  bounded number of times, and goes undecided with the reason "no se pudo
  leer el archivo".
- **A bundle too large to read in one attempt** (a due date at a large
  business). The payment goes undecided with its reason, and the clave is
  asked.
- **The receipt prints a time zone other than Mexico City's.** The CEP's
  credit time is Mexico City time. A receipt printed an hour off falls
  outside the window: undecided, the clave is asked — never a wrong pick.
- **The bundle arrives on the Banxico batch path** (spec 012 US4). The
  same matching runs, with the operator's statement data as the "receipt"
  side (credit day, amount, tail when the statement prints it). A file a
  person uploads carries no seal Devolada can verify; how far it is
  trusted is spec 012's decision.
- **Reuse**: a CEP chosen from a bundle is recorded as used, so the same
  transfer cannot confirm a second payment from another bundle later.
- **Two payments of one bundle are decided at the same moment** and both
  choose the same transfer. The second chooses again without it — it is
  never refused as "already used" for a transfer it only chose; with
  nothing left, it asks for the clave.
- **A single match the filter refused was marked "validated" by the
  provider** (a search by reference marks the clave as used). When its
  real owner's payment later finds it, the flag traces to Devolada's own
  search and is not read as a use outside Devolada.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Devolada MUST recognise the provider's "several matches"
  answer (`invalid`, `banxicoConfirmed: true`, a bundle link) as a
  distinct outcome, not as "not found", on either door, and MUST NOT make
  another provider call for that payment on that basis.
- **FR-002**: Devolada MUST download the bundle, keep it under the business
  with the payment, recognise it by its content, open every CEP in it, and
  read the CEP's clave and, from its cadena original, the operation day,
  credit day, credit time, sending bank, sender account type and account,
  receiving bank, destination account and amount. A CEP that cannot be
  read confirms nothing and is flagged. The seal is kept with the CEP and
  marked not verified.
- **FR-003**: Devolada MUST drop every CEP whose clave already confirmed a
  payment.
- **FR-004**: When the receipt shows the sender's account tail, Devolada
  MUST keep only the CEPs whose sender account ends with it, as the CEP's
  account type reads: for a CLABE, the end of the CLABE or the end of the
  account number inside it; for a debit card or a phone, the end of that
  number.
- **FR-005**: When the receipt shows a time, Devolada MUST keep only the
  CEPs credited from 1 minute before to 3 minutes after it, MUST choose the
  nearest of them, MUST NOT choose when the two nearest were credited
  within 30 seconds of each other, and MUST record the distance with the
  confirmation.
- **FR-006**: Devolada MUST NOT use the sender's name for any step.
- **FR-007**: Exactly one surviving CEP MUST confirm the payment with its
  clave, credit day and credit time, mark that clave as used, record the
  source "varias coincidencias" and how it was decided (tail, time, or
  both), and fire the existing action — without another provider call.
- **FR-008**: Zero or several surviving CEPs MUST leave the payment in a
  visible undecided state with its reason, keep the candidates, stop
  provider calls for it, and ask the payer for the clave. A typed clave
  that fits exactly one kept candidate — as typed, or with O read as 0, I
  read as 1, or one character missing — MUST confirm from it without a new
  call. A payment that holds a bundle MUST NOT end `expired`.
- **FR-009**: A bundle CEP whose clave matches another pending payment of
  the same business MUST confirm that payment; every other unmatched CEP MUST
  be kept under the business and listed for the operator with amount, credit
  time and account tail.
- **FR-010**: Data of other senders read from a bundle (name, account,
  RFC) MUST be stored only under the business that received the money and MUST
  never be shown to a payer. The bundle's link MUST never leave the API.
- **FR-011**: The reader MUST keep the receipt's time with seconds when
  the receipt prints them, and MUST read the sender's account tail when
  the receipt shows one.
- **FR-012**: The same matching MUST serve a bundle that comes from the
  human path (spec 012 US4), with the statement's credit day, amount and
  tail standing in for the receipt. How far a file uploaded by a person is
  trusted, with no verifiable seal, is decided in spec 012.
- **FR-013**: Every decision MUST be recorded on the payment so the
  operator can see which CEPs were dropped and why.
- **FR-014**: Every CEP found without a clave — a single `valid` or a
  bundle — MUST pass FR-003 to FR-005 before it confirms. A single CEP the
  receipt contradicts MUST NOT confirm: it is kept as a candidate and the
  payment goes the undecided way of FR-008.
- **FR-015**: Before a paid search by reference, another payment of the
  business with the same reference, day, bank and amount MUST stop the search
  only when the receipt shows neither a time nor an account tail.
- **FR-016**: A provider's "validated before" flag on a transfer that one
  of Devolada's own searches for the same business returned MUST NOT be read as
  a use outside Devolada.
- **FR-017**: A business reading its payments through the `/v1` API MUST
  see, on a payment that waits on the payer's clave, what it awaits and
  why; the fields are empty on every other payment, and no existing field,
  status or event changes.

### Key Entities

- **Bundle**: the provider's (or Banxico's) answer with several CEPs —
  where it came from, when, how many CEPs, which payment asked for it,
  whether it could be read.
- **Bundle CEP**: one CEP read from a bundle or from a single match —
  clave, operation day, credit day and time, sending bank, sender account
  type and account (tail shown, full value kept under the business), amount,
  destination account, the seal (kept, not verified), and its fate:
  chosen, dropped (reason), matched another payment, or kept unmatched.
- **Payment** (existing): gains the undecided state with its reason, the
  chosen clave and credit time, the distance to the receipt's time, and
  the decision trail.
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
  (`invalid` + `banxicoConfirmed: true` + a downloadable ZIP of CEP PDFs,
  no `cepDetails`, no `cepStatus`). A change there is a change to this
  feature.
- The receipt door's own "several matches" answer is unmeasured — every
  measured bundle came from a search by reference with a date. It is
  handled identically if it comes.
- Each CEP's cadena original is readable as text from its file, and the
  fields this feature uses (days, time, account type, accounts, amount)
  hold no spaces, so the three printed lines join without ambiguity. The
  seal is not verified (R2).
- The receipt's day is the day asked; the search rule of
  `reference-search-printed-day` is in place.
- The account tail on receipts is four digits; banks that print more are
  compared on their full printed tail.
- The CEP's credit time is Mexico City time, as the CEP prints; receipts
  are read as Mexico City time too.
- What is read from a bundle stays with the payment it came with. The
  bundle's file follows the receipts' retention — the proofs bucket keeps
  a file 15 days — so it is there for any doubt while the payment is
  young, and the records stay after it.
- The existing clave ask, action queue, partial and overpayment rules are
  unchanged; this feature adds a decision in front of them.
- The platform's own top-ups — a business buying prepaid credit pays
  Devolada, not a business — keep today's path: no bundle is read and no
  transfer is kept for them.
- Out of scope: any name matching; any change to the reader's model; the
  human queue's screens (spec 012); the Banxico batch file itself; seal
  verification, until Banxico says how bank certificates are obtained.
