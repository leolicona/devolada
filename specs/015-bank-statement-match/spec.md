# Feature Specification: bank-statement-match

**Feature Branch**: `claude/spec-015-bank-statement-match`

**Created**: 2026-09-29

**Status**: Draft — carved on 2026-09-29 out of spec 012
(`payment-without-receipt`), where it was User Story 3; written from the
creator's decisions of 2026-09-26; revised on 2026-10-02 with same-bank
payments (User Story 4); no clarification open

**Input**: User description: "Hagamos la implementación la historia 1 y 2.
La historia 3 y 4, cada una con su propio spec." The story this spec
carries, as spec 012 put it on 2026-09-26: "(3) the ISP uploads its bank
statement and Devolada does the match."

Revised 2026-10-02, in the creator's words: "Está spec es también la
solución a los pagos interbancarios, ejemplo: BBVA a BBVA, correcto?" —
then: "Se reconoce el pago, se registra el pago, para el adaptador de
wisphub se hace la reconexion al cliente si el negocio dejo activada esta
opcion mientras se valida el pago (sin pagar dar por pagada la factura en
wisphub), una vez validado se registra la factura como paga".

## Where this comes from

Spec 012 decided that the payer stops sending captures and that validation
comes in three layers: **instant** with the provider when the payer says
"ya pagué" (spec 012), **free** with the business's own bank statement
(this spec), and **human** with Banxico for whatever is left (spec 016).
The creator fixed the order: 1, then 3, then 2. This is layer 3.

What makes it worth a layer (measured and priced by the creator,
2026-09-26, spec 012):

- The business's bank can hand over its movements. BBVA's export from Net
  Cash lists every SPEI credit with **date, amount, sender, reference and
  clave de rastreo**.
- BBVA's automated feeds exist, but they are per-company enterprise
  contracts: tens of thousands of pesos to set up and thousands a month.
  That is out of reach for the businesses Devolada serves, so the file is
  uploaded by hand.
- The statement costs no provider call and no captcha, and it is the
  strongest proof there is: the money is already in the business's
  account.

What it closes that the instant path cannot:

- **The payer who never said "ya pagué".** Their money arrived; nobody
  asked Banxico.
- **The search that found nothing.** The payer's bank dropped the
  reference, the payer gave the wrong day, the amount changed, or the
  provider's quota ran out. The payment expired, or is still retrying.
- **A receipt payment still waiting** whose capture showed a clave.
- **The same-bank payment** (added 2026-10-02). A transfer from a BBVA
  account to a business that collects at BBVA never goes through SPEI: the
  bank moves the money inside itself, so Banxico has no CEP and there is
  no clave de rastreo. Neither the instant path nor Banxico (spec 016) can
  ever confirm it. The engine already refuses to search such a pair before
  spending a credit (validation spec D17), but nobody is told: the payment
  rides its schedule to `expired` in about six hours, honest or not. Specs
  010 and 011 left it out of scope "for its own spec" (receipt-triage Out
  of Scope; receipt-reader-tuning D5 and Out of Scope). The money does
  show in the business's statement, so the statement is the one place it
  can be confirmed without a person.

Spec 012 gives each registered payer a reference that is unique inside
their business. That is what makes a credit's reference point to one
customer, so a match by reference is safe here. A credit from a payer
with no profile can only be matched by its clave.

## Clarifications

### Carried from spec 012, session 2026-09-26

- Q: Does option 3 start with a bank API? → A: **No.** The business
  uploads the export by hand in its panel. A large business that has its
  own bank feed may bring it later; not in this feature.
- Q: In what order are the three layers delivered? → A: **1, then 3,
  then 2.** This spec is layer 3: after spec 012, before spec 016.

### Session 2026-09-29

- Q: Is the statement part of spec 012? → A: **No.** It is its own spec,
  built after spec 012's User Stories 1 and 2.

### Session 2026-10-02

- Q: Does this spec also solve same-bank payments (BBVA to BBVA)? → A:
  **Yes, in this spec** (User Story 4). As first written it skipped them
  with every other non-SPEI movement.
- Q: The flow? → A: **Recognize, record, then validate.** The payment is
  recognized as same-bank when the payer confirms it, recorded with what
  the statement will show, and validated later by the statement or by the
  business. What the payer gives is their word, not proof.
- Q: What happens to the service while the payment waits? → A: **The
  provisional release, under today's rules and for the same time as a
  payment searched at Banxico.** Where the business turned it on (for an
  ISP on WispHub, the reconnection while the payment is validated), the
  service is restored without the invoice being paid; the invoice is paid
  only when the payment is confirmed. When the release lapses, the
  business's normal cut applies, as today.
- Q: Can the business confirm a same-bank payment by hand, before the
  statement? → A: **Yes.**
- Q: When does a same-bank payment stop waiting? → A: **Never by the
  clock.** It ends when it is confirmed, or when a statement that covers
  its day shows it did not arrive.
- Q: What does the payer read about a same-bank payment? → A: **The same
  as for any payment being validated: its state, never how.** In the
  creator's words: *"Avisarle que su pago está en validación como hasta
  ahora, sin ser específicos; el cómo no es relevante para el cliente,
  solo el estado de su pago. El pagador, cliente del negocio, debe
  recibir únicamente la información necesaria, no detalles de cómo se
  valida."* The payer is never told that the banks are the same, that the
  business's statement or bank decides, or that someone confirms by hand
  (FR-019). It extends spec 017 User Story 4.
- Q: The bank file cannot be measured yet. What moves now? → A: **The
  same-bank part that needs no file goes first**: recognition, the wait,
  the provisional release, the operator's confirmation and "no llegó"
  (User Story 4 without scenarios 4 and 6). Then the statement's core
  around a generic credit, then each bank's reader as its real file
  arrives. The real file is measured before its **reader** is built, not
  before planning.
- Q: The defaults User Story 4 added while specifying (checklist)? → A:
  **Confirmed** ("Sí, continúa").
- Q: A same-bank payment the business confirms is registered in its
  system with which method? Spec 019 kept `SPEI - LINK.DEVOLADAPAGO` for
  payments Banxico confirmed. → A: **The SPEI method.** In the creator's
  words: *"Dentro de SPEI - LINK.DEVOLADAPAGO, ya que es un pago que
  también se registra a través de LINK."* Spec 019 carries the amendment.
- Q: Does a same-bank payment the business confirms cost the validation
  fee? → A: **Yes, when it is confirmed**, like any confirmed payment and
  like cash at a store. One that ends "no llegó" never costs it, like a
  payment that expires today.
- Q: When the collection account is a card or a phone at the payer's bank,
  is it a same-bank payment too? → A: **Yes, like a CLABE.** It never
  reaches SPEI either. The line that left card and phone out of scope is
  withdrawn.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The business uploads its statement and the payments it was waiting for are confirmed (Priority: P1)

An operator of the business exports the account movements from its bank
(BBVA Net Cash first) and uploads the file in the panel. Devolada reads
every SPEI credit (date, amount, sender, reference, and the clave when
the file prints one) and matches each credit against the payments it is
waiting for:

- a registered payer's pending payment, by reference + amount + date;
- any pending payment that holds a clave, by that clave.

Each matched payment is confirmed with the source "estado de cuenta" and
its clave, and the business's action fires (for an ISP, the
reconnection). The operator sees what was read, matched and skipped.

**Why this priority**: it is the whole layer in its smallest form. It is
free, needs no captcha and no provider, and it confirms payments the
instant path is still looking for.

**Independent Test**: seed two pending payments, one of a registered payer
still "seguimos buscando" and one receipt payment holding a clave; upload
a BBVA export that holds both credits and a third one nobody expects. See
the two payments confirmed with the source "estado de cuenta" and their
claves, and a report of 3 read, 2 matched and 1 not matched.

**Acceptance Scenarios**:

1. **Given** a BBVA Net Cash export, **When** the operator uploads it,
   **Then** Devolada shows how many credits it read, how many matched, how
   many did not, and how many movements it skipped, and confirms the
   matched payments.
2. **Given** a credit whose reference, amount and date match one pending
   payment of a registered payer, **When** the file is processed, **Then**
   that payment is confirmed with the source "estado de cuenta", its clave
   is recorded, its retries stop, and the business's action fires.
3. **Given** a credit whose clave matches a pending receipt payment,
   **When** the file is processed, **Then** that payment is confirmed with
   the source "estado de cuenta" and the amount the credit carries, and
   the existing partial and overpayment rules apply.
4. **Given** a credit that matches a payment already confirmed, by any
   path, **When** the file is processed, **Then** nothing changes and the
   credit is shown as "ya conciliado".
5. **Given** the same file uploaded twice, or two files whose dates
   overlap, **When** they are processed, **Then** no payment is confirmed
   twice and the operator sees which credits were already imported.
6. **Given** an export from a bank Devolada cannot read yet, **When** it
   is uploaded, **Then** the operator is told which banks are supported
   and nothing is imported.

---

### User Story 2 - The statement closes what the instant path left open (Priority: P2)

A registered payer transferred with their reference and never said "ya
pagué". Another one said it, but the search found nothing and the payment
expired. When the business's statement shows either transfer, Devolada
confirms it: for the first payer it creates the payment from the credit,
and for the second it confirms the payment that had expired. The business
does not have to look for either one.

**Why this priority**: these are the payments that otherwise reach a
person (spec 016). Closing them from a file the business already has is
the cheapest way to shrink that queue. It comes after User Story 1
because it creates or revives payments, not only confirms waiting ones.

**Independent Test**: seed a registered payer whose link asks $350 and who
has no payment, and a registered payer whose payment expired unfound;
upload a statement with a $350 credit carrying the first payer's
reference and a credit matching the second payment's reference, amount
and day. See one payment created and confirmed, one expired payment
confirmed, and both actions queued.

**Acceptance Scenarios**:

1. **Given** a credit carrying a registered payer's reference and exactly
   the amount their link asks, and no payment of theirs waiting, **When**
   the file is processed, **Then** Devolada creates the payment from the
   credit, confirms it with the source "estado de cuenta" and its clave,
   and fires the business's action.
2. **Given** a registered payer's payment that expired because nothing
   was found, **When** a credit matches its reference, amount and day,
   **Then** that payment is confirmed with the source "estado de cuenta".
3. **Given** a credit carrying a registered payer's reference, **When**
   the payer's link asks nothing now (the debt was paid another way) or
   asks a different amount, **Then** no payment is created and the credit
   is listed with the customer named (User Story 3).
4. **Given** a credit dated before the amount it would pay was first
   asked (for an ISP, before the invoice was issued), **When** the file is
   processed, **Then** it does not pay that amount and is listed with the
   customer named.

---

### User Story 3 - Credits nobody expected are listed and assigned by hand (Priority: P3)

Some credits match nothing: a customer who never registered and uploaded
no receipt, a payer whose bank dropped the reference, a transfer from a
relative's account. Devolada lists them as "abonos sin cliente" with the
sender, amount, reference and date. When the reference belongs to a
registered payer, the list names that customer. The operator can assign a
credit to a customer, and that confirms a payment for that customer.

**Why this priority**: it turns the rest of the file into a short list
the business can clear itself, instead of a statement it has to read line
by line. It comes last because it needs a person.

**Independent Test**: upload a statement with one credit that matches
nothing; see it in "abonos sin cliente" with its sender, amount,
reference and date; assign it to a customer and see a payment confirmed
for them with the source "estado de cuenta, asignado a mano" and the
operator recorded.

**Acceptance Scenarios**:

1. **Given** a credit that matches no expected payment, **When** the file
   is processed, **Then** it appears in "abonos sin cliente" with its
   sender, amount, reference and date.
2. **Given** a listed credit, **When** the operator assigns it to a
   customer, **Then** a payment for that customer is confirmed with the
   credit's amount and clave, the source "estado de cuenta, asignado a
   mano", and who assigned it; the partial and overpayment rules apply,
   and the business's action fires.
3. **Given** a credit already assigned, or matched by a later file,
   **When** the operator opens the list, **Then** it is no longer listed
   as unmatched and cannot be assigned twice.

---

### User Story 4 - A same-bank payment waits for the business instead of expiring (Priority: P1)

A payer of a business that collects at BBVA transfers from their own BBVA
account and says "ya pagué", naming BBVA as their bank. Both banks are the
same, so the money never left the bank and Banxico will never have it.
Devolada does not search. It records the payment with the amount,
reference and day the payer confirmed. The payer's page reads exactly as
it does for any payment being validated: the payer learns the state of
their payment, never how it is validated. If the business turned on the
provisional release, the service comes back while the payment waits (for
an ISP, the reconnection), for the same time as any payment being
validated, and the invoice stays unpaid. The payment is confirmed when an
operator who checked the bank confirms it by hand, or when the business's
statement shows the credit. Only then does the business's action fire
(for an ISP, the payment is registered and the invoice is paid).

**Why this priority**: today every same-bank payment expires in silence,
honest or not, and the payer who paid is never marked as paid. Nothing
else can ever confirm it. Its part without a file (recognition, the wait,
the provisional release, the operator's confirmation and "no llegó") is
delivered first, before any bank file can be read (Session 2026-10-02);
its statement scenarios (4 and 6) arrive with User Story 1.

**Independent Test**: for a business whose collection account is at BBVA,
with the provisional release on, confirm a $350 payment from BBVA. See no
search spent, the payer's page reading as any payment being validated,
the service restored and the invoice still unpaid; wait past the time a
Banxico search would expire and see the payment still waiting. Confirm it
by hand from "Por confirmar en tu banco" and see it confirmed with the
operator recorded and the invoice paid. Repeat with a second payment
marked "no llegó" by hand. Once User Story 1 ships, repeat with a
statement that holds the credit, and with one that covers the day without
it.

**Acceptance Scenarios**:

1. **Given** a business whose collection account (CLABE, card or phone) is
   at a bank, **When** a
   payer confirms a payment naming that same bank as theirs, **Then** no
   search is spent and the payment is recorded as a same-bank payment with
   the amount, reference and day confirmed.
2. **Given** a same-bank payment, **When** the payer's page shows it, at
   any moment, **Then** it reads in the words spec 017 gives every
   payment (017 FR-020, FR-022), and nothing in it says how the payment is
   validated: not that the banks are the same, not the business's bank or
   statement, not that someone confirms it by hand.
3. **Given** a same-bank payment of a business with the provisional
   release on, and a payer whose history does not revoke it, **When** the
   payment is recorded, **Then** the service is restored under today's
   rules, for the same time as a payment searched at Banxico, and the
   invoice is not paid; when that time lapses with the payment still
   waiting, the business's normal cut applies and the payment keeps
   waiting.
4. **Given** a same-bank payment waiting, **When** a statement holds a
   same-bank credit with its reference, amount and day, **Then** the
   payment is confirmed with the source "estado de cuenta" and the
   business's action fires.
5. **Given** a same-bank payment waiting, **When** an operator opens "Por
   confirmar en tu banco" and confirms it, **Then** the payment is
   confirmed with the source "confirmado a mano por el negocio" and who
   confirmed it, and the business's action fires.
6. **Given** a same-bank payment waiting, **When** a statement covers its
   day and holds no credit with its reference and amount on any day of the
   file, **Then** the payment ends as "no llegó" in the business's panel;
   the payer reads it as any payment that could not be confirmed, sent to
   the business by its name (017 FR-021, FR-022); when the service had
   been restored for it, it counts against the payer's history like any
   release whose money never came.
7. **Given** a same-bank payment waiting, **When** an operator who checked
   the bank marks it "no llegó", **Then** it ends as in scenario 6, and
   who marked it is recorded.
8. **Given** a same-bank payment waiting, **When** the time a Banxico
   search would take has passed, **Then** the payment does not expire; the
   payer's page keeps reading as a payment being validated, and the
   business's panel shows it in "Por confirmar en tu banco".

---

### Edge Cases

- **The file holds movements that are neither SPEI credits nor same-bank
  transfer credits** (cash deposits, card payments, outgoing transfers,
  fees). They are skipped, counted as skipped, and not kept.
- **A credit carries no clave** (a bank that does not print it). It can
  still match a registered payer by reference + amount + date, and it is
  told apart from other credits by its date, amount, reference and
  sender, so a second upload does not import it twice.
- **Two credits of one registered payer on the same day, same amount.**
  The payer paid twice. The first pays what the link asks; the second is
  listed as a credit without an invoice (an overpayment the existing rules
  already name).
- **A credit matches a registered payer's reference but the amount
  differs** (they sent $300 of $350). No payment is created on the
  reference alone. The credit is listed with the customer named, and the
  operator can assign it; the partial-payment rules apply.
- **A credit's clave was already used by a payment on another path.** It
  is "ya conciliado"; it never confirms a second payment.
- **A payment waits in spec 013's undecided state** (several transfers
  matched and nothing decided between them). The statement does not decide
  it either: Devolada does not guess. The payment stays undecided for the
  payer's clave or for spec 016, and the credits whose claves are among its
  candidates are listed as belonging to that payment, not as "sin
  cliente".
- **The statement covers several months.** Every credit is read. Pending
  and expired payments match on their own day; a payer with no waiting
  payment is paid only by a credit dated on or after the amount was first
  asked.
- **A file from the right bank in an unexpected layout** (the bank changed
  its export). It is refused like an unsupported bank, with the reason,
  and nothing is imported.
- **The operator uploads the statement of another account.** When the
  file names its account and it is not the business's collection account,
  the file is refused with that reason and nothing is imported.

**Same-bank payments** (User Story 4)

- **A same-bank credit is a credit like any other**, except that it never
  has a clave. It confirms a waiting payment, creates a payment for a
  payer who never said "ya pagué" (User Story 2) or is listed "sin
  cliente" (User Story 3) under the same rules, always by reference +
  amount + date or by an operator's assignment.
- **The payer names the wrong bank.** A payer who says BBVA but paid from
  another bank waits for the statement instead of a search, and the
  statement finds the SPEI credit by its reference, amount and day. A
  payer who names another bank but paid from BBVA is searched at Banxico,
  found nowhere, and the statement closes it as any search that found
  nothing.
- **The payer gave the wrong day.** The statement holds a same-bank credit
  with the payment's reference and amount on another day. The payment is
  not confirmed on a day the payer did not give, and does not end "no
  llegó" either: it keeps waiting, and the credit is listed with the
  customer named, beside the waiting payment, for the operator to assign.
- **A receipt shows the same bank on both sides.** The reading may be a
  misread (receipt-reader-tuning D5: the destination's bank taken for the
  sender's), so the reading alone never makes a payment same-bank. Before
  any search, the payer is asked which bank they paid from; naming the
  business's bank makes it a same-bank payment, naming another sends the
  search with that bank.
- **The business's bank cannot be read yet.** A business whose collection
  CLABE is at a bank whose export Devolada does not read still gets
  same-bank payments recognized and waiting; only its operators confirm
  them or mark them "no llegó", from "Por confirmar en tu banco".
- **The business changes its collection account** while a same-bank payment
  waits. The payment stays what it was when the payer confirmed it.
- **A same-bank payment never reaches spec 016's Banxico queue**: Banxico
  has no record of it to give.
- **The payer sent a different amount** ("Pagué otra cantidad", spec 012
  FR-009). The payment waits for that amount; the statement matches it
  exactly, and the partial and overpayment rules settle it on
  confirmation.

## Requirements *(mandatory)*

### Functional Requirements

**Upload and read**

- **FR-001**: An operator of the business allowed to operate payments MUST
  be able to upload a bank movement export in the panel. BBVA Net Cash's
  export is the first supported format; an unsupported bank or layout MUST
  be refused with the list of supported banks, and nothing imported.
- **FR-002**: Devolada MUST read every SPEI credit and every same-bank
  transfer credit from the file (date, amount, sender, reference, and
  clave when present), and MUST skip every other movement without keeping
  it.
- **FR-003**: The import MUST report what it read, matched, left
  unmatched, skipped, and could not read.
- **FR-004**: A credit MUST be imported once: the same file uploaded
  again, or two files that overlap, MUST NOT create a second copy of a
  credit nor confirm anything twice. A credit is identified by its clave,
  or, without one, by its date, amount, reference and sender.

**Match**

- **FR-005**: Devolada MUST match a credit to a registered payer's pending
  payment (spec 012) by reference + amount + date, and to any pending
  payment that holds a clave by that clave. A payment in spec 013's
  undecided state MUST NOT be decided by a statement.
- **FR-006**: A credit carrying a registered payer's reference and exactly
  the amount their link asks, with no payment of theirs waiting, MUST
  create that payer's payment and confirm it, provided the credit is dated
  on or after the day the amount was first asked.
- **FR-007**: A registered payer's payment that expired because nothing
  was found MUST be confirmed when a credit matches its reference, amount
  and day.
- **FR-008**: A matched credit MUST confirm its payment with the source
  "estado de cuenta" and its clave, stop any retry of that payment, and
  fire the business's existing action.
- **FR-009**: A credit matching a payment already confirmed, or whose
  clave another payment already used, MUST change nothing and MUST be
  shown as "ya conciliado". A clave confirmed from a statement MUST count
  as used for every other path.
- **FR-010**: Amounts MUST be exact to the cent in every match; no
  tolerance.

**Unmatched credits**

- **FR-011**: Credits that match nothing MUST be listed as "abonos sin
  cliente" with sender, amount, reference and date, and with the customer
  named when the reference belongs to a registered payer.
- **FR-012**: The operator MUST be able to assign a listed credit to a
  customer. The assignment MUST confirm a payment for that customer with
  the credit's amount and clave, the source "estado de cuenta, asignado a
  mano" and who assigned it, and the existing partial and overpayment rules
  MUST apply. A credit MUST NOT be assigned twice.

**Across the feature**

- **FR-013**: Every import MUST record the bank, the format, when, who
  uploaded it, and its counts.
- **FR-014**: The claves read from a statement MUST stay with their
  credits and payments, so spec 016's Banxico batch can use them.
- **FR-015**: Data from statements (sender names, accounts, references)
  MUST be kept only under the business it belongs to and shown only to
  that business's operators and to platform operators; never to a payer.

**Same-bank payments**

- **FR-016**: When a payer confirms a payment (spec 012 FR-007) naming as
  their bank the bank of the business's collection account — its CLABE,
  card or phone, whichever payers are shown — Devolada MUST
  recognize it as a same-bank payment and MUST NOT spend a search on it.
  The payment is recorded with the amount, reference and day the payer
  confirmed.
- **FR-017**: A receipt whose reading shows the same bank on both sides
  MUST NOT make a payment same-bank by itself: before any search, the
  payer MUST be asked which bank they paid from, and naming the business's
  bank makes it same-bank (FR-016).
- **FR-018**: A same-bank payment MUST NOT expire by time. It waits,
  visible to the business, until it is confirmed (FR-021, FR-022) or ends
  "no llegó" (FR-023).
- **FR-019**: What the payer reads about a same-bank payment MUST be
  what they read about any payment in the same state, in spec 017's words
  (017 FR-020 – FR-022): its state, never how it is validated. No text the
  payer reads may say that the banks are the same, name the business's
  bank or statement, or say that someone confirms the payment by hand.
- **FR-020**: Where the business's integration can restore the service
  while a payment is validated and the business has turned that on, a
  same-bank payment MUST count as the payer's own evidence under today's
  rules and history revocation (spec 012 FR-014), with the restore taken
  at the confirmation, since no search will run, and for the same time as
  a payment searched at Banxico. The restore MUST NOT pay the invoice or
  fire the business's action. When it lapses with the payment still
  waiting, the business's normal cut applies, as today, and the payment
  keeps waiting.
- **FR-021**: A same-bank credit matching a waiting same-bank payment by
  reference + amount + day MUST confirm it with the source "estado de
  cuenta" and fire the business's action (for an ISP, the payment is
  registered and the invoice paid).
- **FR-022**: An operator allowed to operate payments MUST see the
  waiting same-bank payments in "Por confirmar en tu banco" (customer,
  amount, reference, day, and whether the service was restored for it),
  and MUST be able to confirm one by hand. The confirmation MUST record
  the source "confirmado a mano por el negocio" and who confirmed, and
  fire the business's action. A payment MUST NOT be confirmed twice, by
  hand and by a statement.
- **FR-023**: A same-bank payment MUST end "no llegó" when a statement
  covering its day holds no credit with its reference and amount on any
  day of the file, or when an operator marks it so (recording who). The
  business sees "no llegó"; the payer reads it as any payment that could
  not be confirmed (FR-019). When the service had been restored for it,
  it MUST count against the payer's history like any release whose money
  never came.

### Key Entities

- **Statement import**: one uploaded bank file — bank, format, when, by
  whom, and the counts of read / matched / unmatched / skipped /
  unreadable.
- **Statement credit**: one credit read from an import, SPEI or same-bank
  — date, amount, sender, reference, clave (SPEI only), and its fate:
  matched a payment, already reconciled, or "sin cliente" (and, if
  assigned, by whom).
- **Payment** (existing): gains the sources "estado de cuenta", "estado de
  cuenta, asignado a mano" and "confirmado a mano por el negocio", and the
  credit or the operator that confirmed it. A same-bank payment is one of
  them, recognized at the payer's confirmation: it waits without a clock
  and can end "no llegó", by a statement or by an operator.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A statement upload of one month of a 1,000-customer business
  is matched and reported in under 2 minutes, and confirms at least 90% of
  the credits whose payers are registered.
- **SC-002**: No payment is ever confirmed twice from statements: 0 double
  confirmations over a month of pilot, with the same period uploaded at
  least twice.
- **SC-003**: No credit confirms a payment of a customer other than the
  one its reference or clave names: 0 wrong-customer confirmations over a
  month of pilot.
- **SC-004**: No same-bank payment ends in silence: over a month of pilot,
  every one is confirmed, ends "no llegó", or is shown waiting; 0 expire
  by the clock.

## Assumptions

- Spec 012 (the payer's profile and the instant path) ships first. Without
  a profile, a credit can only match by clave.
- The pilot business banks with BBVA and can export from Net Cash. A real
  export from the pilot is measured before its reader is built, the way
  spec 013 measured the provider's ZIP; the format is taken from that
  file, never from documentation alone. Other banks are added one by one
  as their exports are seen. Everything else is built around a generic
  credit and does not wait for the file (Session 2026-10-02).
- What is known so far (shown by the creator, 2026-10-02, without the
  pilot's file): a BBVA same-bank receipt ("Transferencia a terceros")
  carries a "Folio de la operación" and a "Concepto", and no "Referencia
  numérica"; a BBVA monthly statement in PDF prints, per SPEI line, the
  reference glued to the concept, the counterpart's CLABE, the clave de
  rastreo and a name, and per same-bank line the concept and a ten-digit
  "Referencia"; every line carries an operation date and a settlement
  date, which differ on weekends. BBVA's web banking for individuals shows
  the day's movements and two months back; whether it exports them is not
  yet known. Net Cash is paid (an activation fee and a monthly fee).
- The statement's date for a credit is the day the money arrived in the
  business's account, the same day the payer's app prints and the CEP
  calls the *fecha de abono* (spec 012, measured 2026-09-26).
- "The day the amount was first asked" comes from the business's
  integration when it can tell (for an ISP, the invoice's issue date) or
  from the link when it stores the amount (`/v1`); when neither can tell,
  no payment is created from the reference alone and the credit is listed
  with the customer named.
- The business uploads a file about its own money. A statement edited by
  hand could confirm a payment that never arrived, and that harms only the
  business that uploaded it; the import records who uploaded each file.
- The pilot's export lists same-bank transfer credits with the reference
  the payer set, as it does SPEI credits. Measured on the same real file;
  if BBVA drops the reference on a same-bank credit, those credits can
  only be confirmed by an operator (FR-022) or assigned by hand (FR-012).
- A same-bank transfer is told apart by the two banks: the one the payer
  names and the one the business's collection account belongs to,
  whether that account is a CLABE, a card or a phone (Session
  2026-10-02). None of them reaches SPEI when both banks are the same.
- An operator who confirms or marks a same-bank payment by hand speaks
  for the business's own money, like an uploaded statement, and who did it
  is recorded.
- The existing payment life cycle, statuses, action queue, partial and
  overpayment rules, spec 013's undecided path, and the receipt path stay
  as they are; this feature adds a confirmation source in front of them.
  The one addition is the same-bank payment's wait without a clock and its
  "no llegó" end (User Story 4); the plan names it against the comment on
  the payment's statuses before choosing a word.
- Out of scope: bank APIs and automated feeds (per-company enterprise
  contracts); any query to Banxico (spec 016); matching by the sender's
  name.
