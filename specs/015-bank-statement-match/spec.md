# Feature Specification: bank-statement-match

**Feature Branch**: `claude/spec-015-bank-statement-match`

**Created**: 2026-09-29

**Status**: Draft — carved on 2026-09-29 out of spec 012
(`payment-without-receipt`), where it was User Story 3; written from the
creator's decisions of 2026-09-26; no clarification open

**Input**: User description: "Hagamos la implementación la historia 1 y 2.
La historia 3 y 4, cada una con su propio spec." The story this spec
carries, as spec 012 put it on 2026-09-26: "(3) the ISP uploads its bank
statement and Devolada does the match."

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

### Edge Cases

- **The file holds movements that are not SPEI credits** (cash deposits,
  card payments, outgoing transfers, fees). They are skipped, counted as
  skipped, and not kept.
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
  file names its account and it is not the business's collection CLABE,
  the file is refused with that reason and nothing is imported.

## Requirements *(mandatory)*

### Functional Requirements

**Upload and read**

- **FR-001**: An operator of the business allowed to operate payments MUST
  be able to upload a bank movement export in the panel. BBVA Net Cash's
  export is the first supported format; an unsupported bank or layout MUST
  be refused with the list of supported banks, and nothing imported.
- **FR-002**: Devolada MUST read every SPEI credit from the file (date,
  amount, sender, reference, and clave when present) and MUST skip every
  other movement without keeping it.
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

### Key Entities

- **Statement import**: one uploaded bank file — bank, format, when, by
  whom, and the counts of read / matched / unmatched / skipped /
  unreadable.
- **Statement credit**: one SPEI credit read from an import — date,
  amount, sender, reference, clave, and its fate: matched a payment,
  already reconciled, or "sin cliente" (and, if assigned, by whom).
- **Payment** (existing): gains the sources "estado de cuenta" and
  "estado de cuenta, asignado a mano", and the credit that confirmed it.

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

## Assumptions

- Spec 012 (the payer's profile and the instant path) ships first. Without
  a profile, a credit can only match by clave.
- The pilot business banks with BBVA and can export from Net Cash. A real
  export from the pilot is measured before planning, the way spec 013
  measured the provider's ZIP; the format is taken from that file, never
  from documentation alone. Other banks are added one by one as their
  exports are seen.
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
- The existing payment life cycle, statuses, action queue, partial and
  overpayment rules, spec 013's undecided path, and the receipt path stay
  as they are; this feature adds a confirmation source in front of them.
- Out of scope: bank APIs and automated feeds (per-company enterprise
  contracts); any query to Banxico (spec 016); matching by the sender's
  name.
