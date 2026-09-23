# Feature Specification: receipt-triage

**Feature Branch**: `claude/payment-receipt-info-handling-bhqn5o`

**Created**: 2026-09-23

**Status**: Draft — three questions open for the product creator (Q1–Q3,
marked in the requirements), then `/speckit-plan`

**Input**: User description: "1. Search fields in Banxico: Validate by
Tracking Key, Numerical Reference or Phone/Card Number (supporting multiple
receiving accounts by ISP). 2. Early detection and Feedback: Detect when the
image lacks a key/reference before spending credits and guide the user by
indicating which screen to upload or allowing him to write the data manually.
3. Fintech Support (Spin, Nu, etc.): Validate Spin transactions (or similar)
when the operation has been interbank via SPEI/STP and registered in Banxico.
4. Flow for Non-SPEI Payments (Same Bank / Cash): Automatically classify
intrabank or cash payments, omit Banxico and send them for manual validation
on the ISP panel with the extracted data (amount, time, concept). 5. Fraud and
Cost Control: Save the tracking key returned by Banxico to prevent the reuse
of vouchers and limit retries charged by voucher. 6. Preventive UI and
Automatic Identification: Show a simple visual indication before uploading the
voucher so that the capture includes the Tracking Key or Reference"

## Where this comes from

On 2026-09-23 the product creator brought four real receipts that customers
of one ISP sent as proof of payment. The ISP collects into a BBVA account: its
CLABE ends in …8195 and carries the account number …3819.

1. **Banorte, summary screen.** "¡Tu transferencia fue exitosa!", $300.00, to
   BBVA CLABE ****8195, 09/09/2026 18:10:02, concepto "Sin información". A SPEI
   transfer. The screen shows neither a clave de rastreo nor a referencia; both
   sit one tap away, behind "Ver más detalles".
2. **Banco Azteca, photographed with a second phone.** $350.00, 09/Sep/2026
   18:05:43, to "Inter Netsis Sa De Cv, Bbva Mexico ***195", concepto "Cf354",
   "Referencia 038195". A SPEI transfer with no clave on screen and a numeric
   reference that Banxico can search by.
3. **Same-bank transfer.** $330.00, from "Cuenta de Ahorro •3733" to "internet
   NETSIS •3819 Cuenta", "Tipo de operación: Transferencia a terceros", folio
   0082918812, 10 sep 2026 16:04. It went to the ISP's BBVA *account number*,
   not its CLABE: a BBVA-to-BBVA transfer that never touched SPEI.
4. **Two cash deposits at a BBVA ATM.** $200.00 at 16:39 and $100.00 at 16:37
   on 10/09/26, into account ****3819, in one photo. Cash; never SPEI.

What the product does with them today, read from the code on 2026-09-23:

- **1 and 2** read as fully legible with no clave, so they go to the provider
  anyway (two-eyes-receipt D2, D3). The provider finds no clave either, the
  payment is "blind on both sides", and the payer is asked to confirm a clave
  de rastreo without being told where it is. Meanwhile the payment re-sends the
  same picture at every retry: up to eight paid calls over twelve hours. The
  reference printed on receipt 2 is never read, compared or sent, although the
  validation engine already accepts one.
- **3 and 4** have no record in Banxico and never will. They take the same up
  to eight paid calls and then expire, telling a customer who paid that
  Banxico has no record of the transfer. Receipt 4 may instead be refused as
  "not a receipt", which leaves the payer no way forward. The engine already
  knows a same-bank pair can never produce a CEP and refuses to spend a credit
  on one when the data is typed (validation.spec.md D17); nothing uses that
  knowledge before the picture is sent.

Every BBVA customer of this ISP pays BBVA to BBVA. For an ISP that collects
into a large retail bank, that is a large share of its payers, not an edge
case.

## Decisions taken in session (2026-09-23)

Recorded here so the plan and the code can cite them as
`receipt-triage D<n>`. They come from the creator's input above and the
conversation that led to it, in which apiCEP's validation modes were read
(tracking key or reference to find a transfer; CLABE, card or phone to name
who received it; a list of candidate accounts when the provider reads the
picture).

- **D1 — Two keys find a transfer, either one.** Banxico finds a SPEI
  transfer by its clave de rastreo **or** its referencia numérica, together
  with the date, the amount, the sending bank and the receiving account. The
  product reads, compares, asks for and sends both; the clave leads when both
  exist. (Input item 1.)
- **D2 — An ISP may receive at more than one account.** Each account is a
  CLABE, a debit card or a phone number, at any bank. A check names the
  account the money went to. This is what lets an ISP offer its BBVA
  customers an account at another bank, so that their payment goes through
  SPEI and can be checked. (Input item 1.)
- **D3 — A key that is not printed is asked for before any credit.** A
  receipt the reader can read in full, that shows no clave and no reference,
  is stopped before the first paid call and the payer is asked. This narrows
  two-eyes-receipt D2 and FR-005 for that one case: "missing fields go to the
  provider" stays true when the key may be hidden under a blur (partly
  legible), and stops being true when the receipt simply does not print it —
  the provider cannot read what is not there. (Input item 2.)
- **D4 — The ask names the screen, and typing is always an option.** When
  the product recognises the bank or app, it says where that app shows the key
  ("En Banorte, toca *Ver más detalles*"). The payer can always type the key
  instead, with what the capture did show already filled in. (Input items 2
  and 6.)
- **D5 — A fintech's transfer is checked against the institution Banxico
  records.** A receipt may print a brand (Spin, Nu, Mercado Pago…) while
  Banxico records the transfer under the institution that sent it through
  SPEI, sometimes a different one (STP and similar). The check sends the
  institution Banxico records, never the brand as printed. (Input item 3.)
- **D6 — Same-bank and cash payments skip Banxico and go to the ISP.** They
  have no Banxico record, ever. They cost no credit, the payer is told the
  truth, and the ISP confirms or rejects them from the panel with what was
  read: amount, time, concepto. A confirmation by the ISP has the same
  consequences as a Banxico confirmation and is recorded as a person's.
  (Input item 4.)
- **D7 — One transfer pays once, and one receipt buys a bounded number of
  checks.** Banxico's own clave is kept for every confirmation, whatever key
  found it, and blocks any second payment claiming it. The paid checks a
  receipt can buy are capped, and re-uploading it does not restart the count.
  (Input item 5.)
- **D8 — Before the upload, the payer sees what the capture must show.** A
  simple visual says the capture must include the clave de rastreo or the
  referencia, and the tip for the payer's likely bank comes first. (Input
  item 6.)

## Summary

Today every receipt takes one road: to the provider, then to Banxico. That
road is right for a SPEI receipt that shows its key, and wrong for every other
kind. A receipt with no key costs credits to learn nothing; a same-bank
transfer or a cash deposit costs up to eight credits and ends by telling a
paying customer that their payment was not found.

This feature sorts the receipt first, with the reading the product already
does for free, and sends each kind to the check that can answer it:

- **SPEI with a key** — clave or reference — goes to Banxico as today, now
  also by reference.
- **SPEI without a key** stops before any credit. The payer is told which
  screen to upload, or types the key.
- **Same-bank and cash** skip Banxico. The ISP confirms them from the panel.

Around that sort, the ISP can receive at more than one account (a card, a
phone, a second bank), fintech receipts are checked against the right
institution, every confirmation keeps Banxico's clave so a receipt cannot be
used twice, a receipt's paid checks are capped, and the payment page shows
what a good capture looks like before the payer takes it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A receipt with no key never costs a credit (Priority: P1)

A payer uploads the summary screen of their bank app. It is clear, it is a
SPEI transfer, and it does not show a clave de rastreo or a referencia. The
product sees that before spending anything and tells the payer what to do:
upload the transfer's detail screen — naming where their bank shows it — or
type the key, with the amount, date and bank already filled in.

**Why this priority**: it is the most common gap in the receipts at hand, and
today it costs at least one credit, often eight, to reach a question the
payer cannot answer. It is also the base the other stories build on: the sort
that stops this receipt is the sort that routes a same-bank one.

**Independent Test**: upload, against a stubbed reader and an intercepted
provider, a fully legible SPEI receipt with no key, one with no key and a
blurred corner, and one with a clave; count the credits spent and read the
payer's screen in each case. Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** a receipt the reader calls fully legible, a SPEI transfer, with
   no clave and no reference, **When** the payer uploads it, **Then** no
   credit is spent and the payer sees, on the same screen, that the capture
   does not show the clave de rastreo or the referencia, with three ways
   forward: upload another capture, type the key, or say the payment was cash
   or between accounts of the same bank (Story 3).
2. **Given** that receipt, and the reader recognises the bank or app as one
   the product holds a hint for (Banorte, for example), **When** the payer
   sees the ask, **Then** it says where that app shows the key ("toca *Ver
   más detalles* y captura esa pantalla").
3. **Given** a bank or app the product holds no hint for, **When** the payer
   sees the ask, **Then** it gives the generic hint: open the detail of the
   transfer in the bank app and capture the screen that shows the clave de
   rastreo or the referencia.
4. **Given** the payer chooses to type, **When** the form opens, **Then** the
   amount, date and bank the capture showed are filled in, and the payer is
   asked only for the key — a clave or a reference.
5. **Given** the payer uploads the detail screen and it shows a key, **When**
   they submit, **Then** the payment follows today's flow; the first capture
   counted toward the hourly upload budget and never as a paid attempt.
6. **Given** a receipt the reader calls partly legible, with no key read,
   **When** the payer submits it, **Then** it goes to the provider as today:
   the key may be under the blur, and the provider may read it
   (two-eyes-receipt D2 stands for this case).
7. **Given** the reader is down, or its answer cannot be parsed, **When** the
   payer uploads, **Then** nothing is sorted and the file follows today's flow
   (constitution VIII).
8. **Given** a text PDF whose text shows no key, **When** it is uploaded,
   **Then** it is asked for exactly like a picture (two-eyes-receipt D1); a
   scanned PDF with no text follows today's silent path to the provider.

---

### User Story 2 - The referencia numérica finds the transfer when the clave is missing (Priority: P2)

A payer uploads a receipt that shows a referencia numérica and no clave de
rastreo. The product reads the reference and asks Banxico with it, along with
the date, the amount, the sending bank and the ISP's account. The payment
confirms with no question to the payer. A payer who types their data can give
the reference instead of a 30-character clave.

**Why this priority**: it turns receipt 2 from a question into a confirmation
with one paid call, using a search the validation engine already supports and
the product never uses. It ranks below Story 1 because Story 1 covers more
receipts.

**Independent Test**: submit a receipt the stubbed reader reads with a
reference and no clave against an intercepted provider that finds it by
reference; then one where the provider reports the reference matches more
than one transfer; then a typed submission with only a reference. Count the
calls and the questions. Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** a receipt with a reference and no clave, **When** it is checked,
   **Then** the search carries the reference with the date, the amount, the
   sending bank and the receiving account, and the payer is asked nothing.
2. **Given** a receipt with both, **When** it is checked, **Then** the clave
   leads and the reference travels beside it.
3. **Given** neither reading found a clave and the two readings disagree on
   the reference, **When** Banxico finds nothing, **Then** the comparison
   treats the reference as it treats the clave today: agreed, disputed or
   blind, with the payer asked only for the field in doubt
   (two-eyes-receipt D5–D8).
4. **Given** Banxico finds the transfer by reference, **When** the payment
   confirms, **Then** it records the clave from Banxico's record (Story 4).
5. **Given** the provider answers that the reference matches more than one
   transfer, **When** the answer arrives, **Then** the payer is asked for the
   clave only, and no further credit is spent until they answer.
6. **Given** a payer on the manual door ("No tengo el comprobante a la mano"),
   **When** they fill the form, **Then** they may give a clave, a reference or
   both, and at least one is required.
7. **Given** a reference and no date on either reading, **When** a retry would
   need one, **Then** the date is asked for on its own, as today
   (two-eyes-receipt plan D20).

---

### User Story 3 - Payments that never touched SPEI go to the ISP, not to Banxico (Priority: P2)

A payer sends a BBVA-to-BBVA transfer, or a cash-deposit ticket. The product
recognises it, spends nothing, and tells the payer the truth: Banxico does not
record this kind of payment, so their provider will confirm it. The ISP sees
the payment in the panel, marked as waiting for their review, with the capture
and what was read — amount, date and time, concepto, folio. They check their
own bank and tap "Sí llegó" or "No llegó". "Sí llegó" does everything a
Banxico confirmation does, including the reconnection.

**Why this priority**: today these payments burn up to eight credits and end
by telling a paying customer their transfer was not found. For an ISP that
collects into a large bank this is a large share of its customers, and no
improvement to reading can reach them: only the ISP's own statement knows.

**Independent Test**: upload a same-bank receipt and a cash ticket against a
stubbed reader; confirm there is no provider call, read the payer's screen,
then confirm one and reject the other from the panel and read both outcomes,
including the action in the ISP's system. Needs nothing from the other
stories.

**Acceptance Scenarios**:

1. **Given** a receipt that shows a transfer from the same bank as the
   account it was sent to — the same bank named on both ends, an internal
   operation type ("Transferencia a terceros", "mismo banco", "entre mis
   cuentas"), or a destination written as a plain account number rather than a
   CLABE, card or phone — **When** it is uploaded, **Then** it is sorted as
   same-bank and no credit is spent.
2. **Given** a cash-deposit ticket or voucher — a branch, an ATM, a
   convenience store, a cash-in to a fintech account — **When** it is
   uploaded, **Then** it is sorted as cash and no credit is spent.
3. **Given** a payment sorted as same-bank or cash, **When** the payer's page
   shows it, **Then** it says in es-MX that Banxico does not record this kind
   of payment and that their provider will confirm it, shows the waiting state
   with icon and text, and never shows the words used when Banxico finds
   nothing.
4. **Given** a payment waiting for review, **When** the ISP opens Pagos,
   **Then** it is marked as waiting for their review and shows the capture,
   the kind (same-bank or cash), the amount, the date and time, the concepto,
   the sender as printed, the folio or authorisation number and the receiving
   account; and the count of waiting reviews is visible from the panel's
   navigation.
5. **Given** a member whose role may operate payments, **When** they confirm,
   **Then** they are asked for the amount received, filled in with the
   reading, and the payment is confirmed with the same consequences as a
   Banxico confirmation: the debt, the too-small and above-debt rules, partial
   settlement, and the action in the ISP's system.
6. **Given** a confirmed review, **When** its record is read, **Then** it
   says who confirmed it and when, and it never reads as confirmed by
   Banxico.
7. **Given** a member rejects it, **When** the payer's page shows it, **Then**
   the payment has ended as not received, the record says who and when, and
   the payer is told to contact their provider.
8. **Given** a member whose role may only read payments, **When** they open a
   waiting payment, **Then** they see it and cannot confirm or reject it.
9. **Given** a payment of an API link sorted as same-bank or cash, **When** it
   enters the waiting state and when it is confirmed or rejected, **Then** the
   business's endpoint is told, as it is for every other state.
10. **Given** a waiting payment nobody reviews, **When** days pass, **Then** it
    keeps waiting; it does not expire on its own.

---

### User Story 4 - One transfer pays once, and one receipt buys a bounded number of checks (Priority: P2)

Whatever key found a transfer — a clave read or typed, a reference read or
typed — Banxico's record carries the real clave, and the payment keeps it. A
second payment claiming that clave is refused as already used. A capture sent
twice for two different payments is flagged. And the paid checks a receipt can
buy are capped: re-uploading the same receipt, or correcting it, does not buy
a fresh set.

**Why this priority**: Story 2 opens a way to confirm without a clave, and
Story 3 opens a way to confirm without Banxico. Both need this story's guard
before they are safe to ship. The cap turns the worst case of today's
schedule from a surprise into a number.

**Independent Test**: confirm a payment found by a typed reference, then try a
second payment whose search returns the same clave; upload the same capture
for two customers of one business and read both records; re-upload one
receipt three times against a provider that always answers "not found" and
count the paid calls. Needs Story 2 for the typed-reference case only.

**Acceptance Scenarios**:

1. **Given** a payment Banxico confirms, found by any key, **When** it
   confirms, **Then** it records the clave from Banxico's record.
2. **Given** a second payment of the same business whose check returns a
   clave already recorded on a confirmed payment, **When** it is checked,
   **Then** it is refused as already used, whatever key it was found by.
3. **Given** a capture identical to one already submitted to the same
   business for a different payment, **When** it is submitted, **Then** the
   payment is flagged; if it waits for review, the ISP sees the flag and the
   other payment it matches. A re-upload for the same payment is not flagged.
4. **Given** two waiting reviews whose captures show the same folio, amount
   and time, **When** the ISP opens either, **Then** they see a flag saying the
   other looks like the same payment, even when the files differ.
5. **Given** a receipt that has used up its paid checks, **When** it is
   uploaded again or corrected, **Then** no further paid call is made, and the
   payment ends as today's expired, with today's words.
6. **Given** a check that came back with nothing found and no key read by
   either side, **When** the next retry comes, **Then** the same request is
   not sent again; the payment waits for the payer's answer without spending.
7. **Given** the counts of this story, **When** the records are read, **Then**
   the paid calls per receipt and the refusals for reuse are countable.

---

### User Story 5 - The payer sees what the capture must show before they take it (Priority: P3)

On the "Envía tu comprobante" step, before the upload button, the payer sees a
small picture of a receipt with the clave de rastreo and the referencia
marked, and one line of text: the capture must show one of them. If the same
link has paid before, the tip for the bank used last time comes first. If the
payer's likely bank is the same as the ISP's receiving bank, they are told
before transferring that this payment will be confirmed by their provider, not
at once — or they are offered another account (Story 6).

**Why this priority**: it prevents what Story 1 repairs, at no cost, but it
cannot stand alone: some payers will still send the summary screen, so Story 1
has to exist. It ranks with the other P3 stories because it changes no
outcome, only how often the repair is needed.

**Independent Test**: render the step for a link with no history, a link
whose last payment came from Banorte, and a link whose last payment came from
the ISP's own bank; read the page at 360px in both themes and check that the
upload stays one tap from the step's start. Needs nothing from the other
stories.

**Acceptance Scenarios**:

1. **Given** the upload step, **When** it renders, **Then** a simple visual
   shows what the capture must include — the clave de rastreo or the
   referencia — with text as well as the picture, legible at 360px in both
   themes.
2. **Given** a link whose earlier payment came from a bank the product holds
   a hint for, **When** the step renders, **Then** that bank's tip comes
   first, and the page does not state the customer's history.
3. **Given** a link with no history, **When** the payer wants a tip for their
   bank, **Then** they can open the tips for the common banks in one tap.
4. **Given** the visual and the tips, **When** the step renders, **Then** the
   upload is still one tap from the start of the step; nothing is added in
   front of it.
5. **Given** a link whose earlier payment came from the same bank as the
   ISP's receiving account, **When** the transfer step renders, **Then** it
   says, before the transfer, that a payment between accounts of the same bank
   is confirmed by the provider and can take longer — or, when the ISP has an
   account at another bank, offers that account (Story 6).

---

### User Story 6 - An ISP can receive at more than one account (Priority: P3)

An ISP adds a debit card, a phone number or a second CLABE, at any bank, next
to the CLABE it already has, and marks one as primary. The payment page shows
the primary account and offers the others. A payer who banks where the primary
account is gets an account at another bank, so their payment goes through SPEI
and is checked by Banxico at once. The check names the account the receipt
shows as destination.

**Why this priority**: it is the only way to bring BBVA-to-BBVA payers back to
a payment Banxico can check, and the only way to accept a transfer to a card
or a phone. It is larger than the other stories — the ISP's setup, the page
and the check all change — and Story 3 already gives those payers a road, so
it can follow.

**Independent Test**: configure an ISP with a BBVA CLABE and a Banorte card;
upload a receipt to each against an intercepted provider and check the
account each search names; render the page for a payer whose last payment
came from BBVA; upload a receipt whose destination matches neither account.
Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** an ISP with one CLABE today, **When** this feature ships,
   **Then** that CLABE is its primary account and nothing changes for it or
   its payers.
2. **Given** an ISP in Cuenta, **When** it adds an account, **Then** it gives
   a CLABE (18 digits), a debit card (16) or a phone number (10), and the
   account's bank; it can mark any account as primary; exactly one is primary.
3. **Given** an ISP with more than one account, **When** the payment page
   renders, **Then** it shows the primary account, and each other account is
   one tap away.
4. **Given** an ISP with accounts at more than one bank, **When** the payer's
   likely bank is the primary account's bank, **Then** the page offers the
   account at another bank ("¿Tu cuenta es BBVA? Transfiere a esta otra para
   que tu pago se confirme al momento").
5. **Given** a receipt whose destination the reader ties to one of the ISP's
   accounts, **When** it is checked, **Then** the search names that account.
6. **Given** a receipt whose destination cannot be tied to one account,
   **When** the provider reads the capture, **Then** it receives every account
   of the ISP as a candidate; **and when** the payer types their data, they
   are asked which account they sent to — shown masked — instead of credits
   being spent guessing.
7. **Given** a fully legible receipt whose destination matches none of the
   ISP's accounts, **When** it is uploaded, **Then** no credit is spent and
   the payer is told that the transfer went to a different account.
8. **Given** same-bank sorting (Story 3), **When** the ISP has several
   accounts, **Then** it compares the sender's bank with the bank of the
   account the money went to.
9. **Given** an account removed or changed, **When** a payment already
   submitted to it is checked, **Then** it is checked against the account it
   was sent to.

---

### User Story 7 - Fintech receipts are checked against the institution Banxico records (Priority: P3)

A payer sends a receipt from Spin, Nu, Mercado Pago or a similar app. When the
transfer went out through SPEI, the product asks Banxico with the institution
Banxico records for that app's transfers — which may not be the brand printed
on the receipt. A transfer between two accounts of the same app, or cash put
into the app at a store, is not SPEI and goes to Story 3.

**Why this priority**: a wrong sending bank is answered by the provider with
the same faceless "not found" a missing transfer gets (measured 2026-08-19,
validation.spec.md D12), so every fintech whose brand and institution differ
loses its payments silently, at a credit each. It ranks P3 because it needs a
measured list, and the list starts small.

**Independent Test**: submit, against a stubbed reader and an intercepted
provider, a receipt printed with a brand whose institution differs, one whose
brand the list does not know, and one of a transfer inside the same app;
check the institution each search names, and that the unknown brand is not
guessed. Needs Story 3 for the same-app case only.

**Acceptance Scenarios**:

1. **Given** a receipt that prints a fintech brand the list knows, **When** it
   is checked, **Then** the search names the institution Banxico records for
   that brand's SPEI transfers.
2. **Given** a brand the list does not know, **When** the receipt is checked,
   **Then** no institution is guessed for a paid search: the first call is the
   provider's own reading of the capture, as today.
3. **Given** a confirmed payment from a fintech receipt, **When** its record
   is read, **Then** it shows the brand as printed and the institution Banxico
   returned, so the list can grow from evidence.
4. **Given** a transfer between two accounts of the same app, or a cash
   deposit into an app account, **When** it is uploaded, **Then** it is sorted
   as same-bank or cash (Story 3).
5. **Given** a fintech receipt with a reference and no clave, **When** it is
   checked, **Then** Story 2 applies unchanged.

---

### Edge Cases

- **A receipt that looks both ways.** It names an internal operation type but
  prints a clave de rastreo. A key on the receipt means Banxico may have it:
  the SPEI road wins, and a same-bank sort is only taken with no key printed.
- **The payer knows better than the sort.** The Story 1 ask offers a third way
  forward: "Pagué en efectivo o a una cuenta del mismo banco". It sends the
  payment to the ISP's review with the capture attached. Nothing is gained by
  misusing it: the ISP checks its own statement.
- **Two tickets in one photo** (receipt 4). The sort is cash; the ISP confirms
  the total it received, which the reading pre-fills where it can.
- **A photo of a phone screen** (receipt 2). Glare and a cracked screen are a
  legibility question, answered as today (two-eyes-receipt D2).
- **The ISP confirms an amount above the debt, or the debt was paid another
  way meanwhile.** The above-debt and unapplied rules apply as they would to a
  Banxico confirmation.
- **The business is paused for lack of credit** while a review waits. Whether
  a hand confirmation spends credit is Q3; the pause rules follow that answer.
- **A reference printed with leading zeros** ("038195"). It is kept exactly as
  printed.
- **A reference too common to be unique** (1234567). The search still carries
  the date, amount, banks and account; when the provider says it matches more
  than one transfer, the payer is asked for the clave (Story 2, scenario 5).
- **The receiving account's bank is outside the provider's vocabulary.** The
  ISP sees a configuration problem, as today (BUG-008); the new accounts are
  held to the same vocabulary when they are added.
- **A payer who typed a reference whose Banxico record carries a clave already
  used by this business.** Refused as already used (Story 4), exactly as if
  they had typed the clave.
- **A payment born before this feature, validating at cut-over.** It finishes
  under the flow it started in; only payments born after the cut-over are
  sorted. A record is never half one flow and half the other.
- **A platform top-up** with a receipt that has no key, or that is same-bank
  or cash. It gets the same keys, sort and ask; a same-bank or cash top-up is
  not sent to Banxico, and the operator resolves it with the existing manual
  adjustment.
- **The ISP removes the account a waiting review was paid into.** The review
  keeps showing the account the payment was sent to.

## Requirements *(mandatory)*

### Functional Requirements

**Sorting before spending (Story 1, D3)**

- **FR-001**: The product MUST sort every uploaded receipt, before any paid
  call and using only the reading it already does at no cost, into exactly one
  of: SPEI with a key, SPEI without a key, same-bank, cash, not a receipt, not
  legible. The last two keep today's meaning and messages.
- **FR-002**: A receipt the reader calls fully legible, sorted as SPEI without
  a key, MUST NOT reach a paid call; the payer MUST be asked (FR-004). A
  partly legible receipt with no key read MUST still go to the provider as
  today (two-eyes-receipt D2, FR-005, narrowed by D3).
- **FR-003**: When the reader is down, its answer cannot be parsed, or a PDF
  yields no text, the receipt MUST NOT be sorted and MUST follow today's flow.

**Asking for the key (Story 1, D4)**

- **FR-004**: The ask MUST offer, on one screen, three ways forward: upload
  another capture, type the key, or say the payment was cash or same-bank
  (which routes it to FR-018).
- **FR-005**: When the reader recognises the bank or app and the product holds
  a hint for it, the ask MUST say where that app shows the key; otherwise it
  MUST give the generic hint.
- **FR-006**: The typing form reached from the ask MUST be filled in with the
  amount, date and bank the capture showed, and MUST ask only for the key.

**Two keys (Story 2, D1)**

- **FR-007**: The reader MUST read the referencia numérica as well as the
  clave de rastreo. A reference is digits only, kept exactly as printed.
- **FR-008**: A search MUST carry the clave when there is one, the reference
  when there is no clave, and both when both exist.
- **FR-009**: The comparison of the two readings (two-eyes-receipt D5–D8) MUST
  treat the reference as it treats the clave when neither side read a clave.
- **FR-010**: When the provider answers that a reference matches more than one
  transfer, the product MUST ask the payer for the clave only and MUST NOT
  spend another credit until they answer.
- **FR-011**: The manual door and the typing form MUST accept a clave, a
  reference or both, and MUST require at least one.

**Same-bank and cash (Story 3, D6)**

- **FR-012**: A receipt MUST be sorted as same-bank when it shows the same
  bank on both ends, an internal operation type, or a destination written as a
  plain account number — and prints no key (Edge Cases, "looks both ways").
- **FR-013**: A receipt MUST be sorted as cash when it is a deposit ticket or
  voucher: branch, ATM, convenience store, or a cash-in to a fintech account.
- **FR-014**: Same-bank and cash payments MUST NOT be sent to the provider and
  MUST spend zero credits.
- **FR-015**: The payer's page MUST say in es-MX that Banxico does not record
  this kind of payment and that their provider will confirm it; it MUST show
  the waiting state with icon and text, and MUST NOT show the words used when
  Banxico finds nothing.
- **FR-016**: While a same-bank or cash payment waits for the ISP, the
  customer's service [NEEDS CLARIFICATION: Q1 — stays paused until the ISP
  confirms, may be reconnected on trust under the ISP's existing
  provisional-release switch, or follows a separate switch for these payments?]
- **FR-017**: A waiting payment MUST NOT expire on its own.
- **FR-018**: The ISP MUST see every waiting payment in Pagos, marked as
  waiting for their review, with the capture and what was read: kind, amount,
  date and time, concepto, sender as printed, folio or authorisation number,
  and the receiving account. The count of waiting reviews MUST be visible from
  the panel's navigation.
- **FR-019**: A member whose role may operate payments MUST be able to confirm
  or reject a waiting payment; a member who may only read MUST NOT.
  Confirming MUST ask for the amount received, filled in with the reading.
- **FR-020**: A confirmation by the ISP MUST have the same consequences as a
  Banxico confirmation — the debt, the too-small and above-debt rules,
  partial settlement, the action in the ISP's system — and MUST be recorded as
  confirmed by a person, with who and when. It MUST never read as confirmed by
  Banxico. The amount that decides money is the amount the ISP confirmed.
- **FR-021**: A rejection MUST end the payment as not received, record who and
  when, and tell the payer in es-MX to contact their provider.
- **FR-022**: A payment the ISP confirms by hand [NEEDS CLARIFICATION: Q3 —
  is charged the validation fee like a Banxico confirmation, is free, or is
  charged a lower fee?]
- **FR-023**: Every state a payment of an API link enters in this flow MUST be
  announced to the business's endpoint, as every other state is
  (automated-collections-api D7, D17).

**Reuse and cost (Story 4, D7)**

- **FR-024**: Every payment Banxico confirms MUST record the clave from
  Banxico's record, whatever key found it, read or typed; a second payment of
  the same business whose check returns that clave MUST be refused as already
  used (direct-payment D8, extended to every key).
- **FR-025**: A capture identical to one already submitted to the same
  business for a different payment MUST be flagged on the payment, and the ISP
  MUST see the flag and the payment it matches. A re-upload for the same
  payment MUST NOT be flagged.
- **FR-026**: Two waiting reviews whose captures show the same folio, amount
  and time MUST each carry a flag naming the other.
- **FR-027**: A receipt MUST NOT buy more than [NEEDS CLARIFICATION: Q2 — how
  many paid calls?] paid calls, counted across every payment that carries the
  same capture or the same key, re-uploads and corrections included.
- **FR-028**: A check that came back with nothing found and no key read by
  either side MUST NOT be sent again unchanged; the payment MUST wait for the
  payer's answer without spending.
- **FR-029**: A payment whose receipt has used its paid calls without a
  verdict MUST end as today's expired, with today's words and diagnosis.

**Before the upload (Story 5, D8)**

- **FR-030**: The upload step MUST show, before the upload control, a simple
  visual of what the capture must include — the clave de rastreo or the
  referencia — with text as well as the picture, legible at 360px in both
  themes.
- **FR-031**: When the same link has an earlier payment from a bank the
  product holds a hint for, that bank's tip MUST come first, and the page MUST
  NOT state the customer's history. The tips for the common banks MUST be one
  tap away.
- **FR-032**: The visual and the tips MUST NOT add a step: the upload stays one
  tap from the start of the step.
- **FR-033**: When the link's earlier payment came from the receiving
  account's bank, the transfer step MUST say, before the transfer, that such a
  payment is confirmed by the provider and can take longer — or offer an
  account at another bank when there is one (FR-036).

**More than one account (Story 6, D2)**

- **FR-034**: An ISP MUST be able to hold more than one receiving account.
  Each is a CLABE (18 digits), a debit card (16) or a phone number (10), with
  a bank from the provider's vocabulary; exactly one is primary. The existing
  CLABE MUST become the primary account with no action from the ISP.
- **FR-035**: The payment page MUST show the primary account, with each other
  account one tap away.
- **FR-036**: When the ISP has accounts at more than one bank, the page MUST
  offer an account at another bank to payers whose likely bank is the primary
  account's bank.
- **FR-037**: A search MUST name the account the receipt shows as destination.
  When the destination cannot be tied to one account and the ISP has more than
  one, the provider's reading of the capture MUST receive all of them as
  candidates, and a typed submission MUST ask the payer which account they
  sent to, shown masked.
- **FR-038**: A fully legible receipt whose destination matches none of the
  ISP's accounts MUST be refused before any credit, telling the payer the
  transfer went to a different account. Digits the receipt masks are not a
  mismatch.
- **FR-039**: Removing or changing an account MUST NOT change the account a
  submitted payment is checked against.
- **FR-040**: Same-bank sorting MUST compare the sender's bank with the bank of
  the account the money went to.

**Fintech (Story 7, D5)**

- **FR-041**: When a receipt prints a fintech brand, the search MUST name the
  institution Banxico records for that brand's SPEI transfers, from a
  maintained brand list; it MUST NOT name the brand as printed when the two
  differ.
- **FR-042**: A brand the list does not know MUST NOT be guessed for a paid
  search; the first call MUST be the provider's own reading of the capture.
- **FR-043**: A confirmed payment from a fintech receipt MUST record the brand
  as printed and the institution Banxico returned.

**Across the feature**

- **FR-044**: Platform top-ups MUST take the same keys, sort and ask; a
  same-bank or cash top-up MUST NOT be sent to Banxico, and the operator
  resolves it with the existing manual adjustment.
- **FR-045**: Payments validating at cut-over MUST finish under the flow they
  started; only payments born after it MUST be sorted.
- **FR-046**: The product MUST make countable from its records, with no
  further instrumentation: sorts by class; credits not spent because of a
  sort; asks and how they ended (new capture, typed key, declared cash or
  same-bank, abandoned); searches by reference and how they ended; reviews
  confirmed and rejected, and the time to decision; reuse flags raised; paid
  calls per receipt.
- **FR-047**: Nothing about what a Banxico verdict means, the fee for a
  Banxico-confirmed payment, partial settlement or the schedule's timing
  changes by this feature, except the cap (FR-027) and the stops (FR-002,
  FR-014, FR-028, FR-038).

### Key Entities

- **Sort**: what the product decided a receipt is — SPEI with a key, SPEI
  without a key, same-bank, cash, not a receipt, not legible — taken once per
  receipt, before any paid call, and recorded with the reading it came from.
- **Key**: what finds a transfer in Banxico — a clave de rastreo, a referencia
  numérica, or both — with where each came from: our reading, the provider's,
  the payer's hand, or Banxico's record.
- **Receiving account**: an account of the business — CLABE, debit card or
  phone number, with its bank — one of which is primary. Payments remember the
  account they were sent to.
- **Review**: the ISP's decision on a same-bank or cash payment — waiting,
  confirmed or rejected — with who decided, when, and the amount confirmed.
- **Reuse flag**: a mark on a payment that its capture, or its folio, amount
  and time, matches another payment of the same business, naming that
  payment.
- **Receipt budget**: the paid calls a receipt has bought, counted across every
  payment that carries its capture or its key.
- **Bank hint**: for a bank or app, where it shows the key and what to tap;
  es-MX copy, maintained by hand, starting with the banks in the product's own
  records.
- **Brand entry**: a fintech brand as it is printed on receipts, and the
  institution Banxico records for its SPEI transfers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A fully legible SPEI receipt that prints no key spends zero
  credits, and the payer sees the ask within the same interaction.
- **SC-002**: A same-bank or cash receipt spends zero credits, and appears in
  the ISP's review list within one minute of its upload.
- **SC-003**: The count of payers told that Banxico did not find their
  transfer, for a payment sorted as same-bank or cash, is zero.
- **SC-004**: A receipt with a reference and no clave, whose transfer Banxico
  has published, is confirmed with one paid call and no question to the
  payer.
- **SC-005**: For every bank on the hint list, a payer asked for a key is told
  where that bank's app shows it; the list at launch covers every sending bank
  that appears in the product's confirmed payments.
- **SC-006**: The count of payments of one business confirmed with the same
  Banxico clave is zero, whatever key found them.
- **SC-007**: The paid calls spent on any one receipt never exceed the cap,
  counting every re-upload and correction.
- **SC-008**: An ISP can confirm or reject a waiting payment from the review
  list in at most two actions, without leaving the panel for anything but
  their own bank.
- **SC-009**: The share of payers asked for a key who then submit a capture or
  a typed key, rather than abandoning, can be read from the records; so can
  every count in FR-046.
- **SC-010**: For every outcome that exists today — confirmed, pending,
  contradicted, not found, partial, above the debt, the manual door — a
  receipt that prints a clave ends in the same status with the same words as
  today.
- **SC-011**: An ISP with one CLABE sees no change in its setup, and its
  payers see no change on the transfer step.
- **SC-012**: Every new test carries its story citation (`receipt-triage
  US<n>`), and the count of decision citations lost in the change is zero.

## Assumptions

- **The reader can tell same-bank and cash from what the receipt shows.** The
  four receipts at hand carry clear marks: "Transferencia a terceros", a
  destination written as an account number, "Depósito en efectivo", an ATM
  ticket layout. The plan's research MUST measure the sort on these four and
  on more real receipts before relying on it; when the reader is unsure, the
  receipt is not sorted as same-bank or cash, and today's flow applies.
- **apiCEP's direct mode finds a transfer by reference alone.** Documented by
  the provider and read in session on 2026-09-23; never measured by us. Its
  answer to a reference that matches more than one transfer (published as HTTP
  as a refusal that asks for the tracking key) is likewise unmeasured.
- **apiCEP accepts a card or a phone as the receiving account**, and a list of
  candidates when it reads the picture. Documented, unmeasured. Whether its
  answer says which candidate matched is unknown; the plan MUST find out,
  because a later retry that types the data needs to name one account.
- **The brand list is kept by hand.** Learning "brand → institution" from
  confirmed payments across businesses would be a third cross-business
  statistic, which constitution V allows only by amendment. FR-043 records
  the evidence so the list can grow; growing it stays a human act.
- **The bank hints are kept by hand**, as es-MX copy, and start with the banks
  that appear in the product's confirmed payments.
- **The ISP's confirmation is the ISP's word.** Devolada does not verify a
  same-bank or cash payment; it presents the evidence and records who decided.
- **The existing CLABE becomes the primary account.** An ISP with one account
  keeps exactly today's setup and page.
- **The payer's likely bank is the bank of the link's last payment.** A link
  with no history has no likely bank, and the page does not ask for one.
- **The "cash or same-bank" way out of the ask is a proposed default**, not a
  decision of the creator's; it can be dropped at `/speckit-clarify` without
  touching the rest.
- **Waiting reviews do not expire** — a proposed default. The ISP can reject
  one that will never be confirmed.

## Out of Scope

- Reading the ISP's own bank movements (a statement upload or a bank
  connection) to confirm same-bank and cash payments automatically. It is the
  only road to automatic confirmation for them, and a feature of its own.
- A reference assigned by the page to each customer, to type in their bank
  app. Discussed in session as the stronger version of D1; left for a
  follow-up.
- A back-office report or chart of the new counts; this feature makes them
  countable, and a screen for them is its own feature.
- SPID, which the provider also supports.
- Changing how the bank clave shape is learned, what a Banxico verdict means,
  or the schedule's timing beyond the cap.
- Reprocessing payments born before the cut-over.

## Dependencies

- The provider (apiCEP): its direct mode with a reference, its card and phone
  receiving accounts, and its candidate list when it reads a picture.
- The two-eyes flow (two-eyes-receipt D2–D9 and plan D20), which this feature
  sorts in front of and narrows in one case (D3).
- The one-transfer-pays-once rule (direct-payment D8) and the provider's replay
  flag, extended to every key.
- Provisional release (provisional-release D1–D11), whose switch Q1 decides
  whether to reuse.
- Prepaid credit and the validation fee (prepaid-credit D2–D8), which Q3
  decides whether a hand confirmation spends.
- The announcement of every state to an API link's endpoint
  (automated-collections-api D7, D17).
- The action queue in the ISP's system, which a hand confirmation feeds like a
  Banxico one.
- The receipt reader and its PDF text route (two-eyes-receipt D1, D2).
