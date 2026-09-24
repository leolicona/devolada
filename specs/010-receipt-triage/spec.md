# Feature Specification: receipt-triage

**Feature Branch**: `claude/payment-receipt-info-handling-bhqn5o`

**Created**: 2026-09-23 · **Rescoped**: 2026-09-24

**Status**: Draft — scope settled by the product creator on 2026-09-24;
ready for `/speckit-plan`

**Input**: User description: "1. Previous guide on how to upload a payment
receipt. 2. Validate transfer receipts by payment reference number. Mandatory
if trackingKey is not sent. 3. Feedback of missing data to the user. You have
to define the how." — then, the same day: "The ISP can register in the system
1 16-digit card and 1 10-digit phone in addition to its 18-digit CLABE. The
consultation in Banxico will use the data that appears as destination on the
receipt."

## Clarifications

### Session 2026-09-23

- The first draft carried six items (search by tracking key, reference or
  phone/card; early detection; fintech support; a review flow for same-bank
  and cash payments; fraud and cost control; a capture guide). The creator
  narrowed it to four: card and phone as receiving identifiers, the capture
  guide, missing-field feedback, and Spin verified only as SPEI. The three
  questions the first draft asked belonged to items dropped then, and were
  withdrawn.

### Session 2026-09-24

- Q: What is in scope now? → A: Four things — the capture guide before the
  upload; validation by the referencia numérica, required when there is no
  clave de rastreo; feedback that tells the payer which data is missing; and
  one debit card (16 digits) and one phone (10 digits) that the ISP can
  register beside its CLABE (18 digits). Spin leaves the scope. Everything
  dropped is listed under Out of Scope.
- Q: Which of the ISP's accounts does the check ask Banxico about? → A: The
  one the receipt shows as its destination.
- Q: How should the missing-data feedback work? → A: The creator left the
  design to this spec ("you have to define the how"). It is decided in D5 and
  D6 below and is the part of this spec most worth the creator's review.
- After `/speckit-analyze` (2026-09-24), the creator decided the two open
  points: the message also names a missing account ("ni a cuál cuenta
  transferiste", finding I1), and the capture guide labels the reference
  "número de referencia (Referencia numérica)", the words most banks print
  (finding T2). Findings G3 and I4 were folded in below with this date.
- Q: When a payment has both a clave and a reference, which one travels to
  Banxico? → A: Only the clave de rastreo. The reference travels only when
  there is no clave (D1, FR-003).
- Q: When a payment has both keys and Banxico finds nothing with the clave,
  do the retries try the reference? → A: No — retries keep the clave, as
  today, and the reference stays on the payment as a record. One exception:
  when the two readings disagree on the clave (and the bank's clave shape
  does not settle it) but agree on a reference that passed the gate, that
  reference is a trustworthy key and the next attempt searches with it,
  asking the payer nothing. If that search does not confirm either, the
  payer gets today's question for the clave (D1, FR-003, FR-004).
- Q: What counts as the reference "failing", and what is the payer asked
  then? → A: Failing is Banxico finding nothing with the reference (most
  often, not published yet). The payer is then asked to correct the clave
  **or** the reference — whichever they find easier; the reference is
  shorter to type. When Banxico confirms, its real clave is stored only
  after checking this business has not used it already (D3, FR-006). A
  reference matching more than one transfer is a separate case (D7).
- Q: What happens with a generic reference — the default a bank app fills
  in, which payers rarely change? → A: The reading gate discards it: a single digit repeated ("0", "0000", "1111111") or a run of consecutive digits ("123", "1234567", "7654321") is not a reference (letters already are not, D2). A
  capture whose only key is a generic reference therefore has no key, and is
  asked about before any credit, for the clave (D4). On the typing form the
  page says so beside the field and requires the clave. If a reference that
  passed still matches more than one transfer, the payer is asked for the
  clave (D7).
- Q: Should the product look in its own records for a reference already used
  on the same day, before asking Banxico? → A: Yes, with the five data
  Banxico searches by. When another payment of the same business, from another link and not `superseded`, with the same reference, transfer date, sending bank, amount and receiving account (the account ruling nothing out while either side's is unknown) exists, Banxico would find more than
  one transfer: the payer is asked for the clave before any credit — at the
  upload for a capture, on the form (the clave becomes required) for typed
  data. Finding nothing proves nothing: the product only knows the payments
  it received, so the provider's answer stays the last word (D7).
- Q: When the reader says what kind of account the destination is (card,
  CLABE, phone), is the destination compared only with that kind? → A: No.
  The ISP's CLABE, card and phone are all known; if the visible digits end
  any of them, the destination is the ISP's. The kind only decides which is
  tried first. A mismatch means the digits fit none of the ISP's accounts
  (D10, FR-020).

### Session 2026-09-24 (`/speckit-specify`, rescoping Story 3)

- Input: "Validar los últimos 4 dígitos de la cuenta destino; esto debe
  coincidir con lo que tiene registrado el negocio. Incluir las tres opciones
  (CLABE, tarjeta y teléfono) incrementa las decisiones del usuario que paga
  y con esto la dificultad. Sería más factible dar la opción de registrarlas,
  pero el negocio debería elegir una." → Story 3 rescoped: the ISP may
  register a CLABE, a debit card and a phone, and **chooses one** — its
  *cuenta de cobro* — which is the only one its payers see and the one every
  check asks Banxico about. The destination on a receipt is checked by its
  **last digits** (three or four) against the ISP's registered accounts. D9, D10,
  Story 3, FR-016–FR-021, SC-006 and the Receiving account entity rewritten
  below; the plan and tasks follow once the open points are settled.
- Q: Is a transfer to a registered account other than the cuenta de cobro
  accepted? → A: Yes, and it is checked against that account — but only if
  that account is registered when the payment is submitted. A number the ISP
  removed is "a different account" (D10, FR-019, FR-020) — superseded below:
  a removed account goes to the ISP's decision.
- Q: Must an ISP paid at its card or phone still register a CLABE? → A: No.
  An ISP can collect by SPEI once its cuenta de cobro is registered, whatever
  its kind (D9, FR-016).
- Q: How many digits are enough, and what does the payer hear when they fit
  nothing? → A: Three or four: the last visible digits of the destination,
  up to four and at least three, are compared; fewer than three stop
  nothing. A clear receipt whose digits fit none of the ISP's accounts is
  discarded before any credit, and the payer is told so honestly and kindly,
  with a way forward (D10, FR-019, FR-020).
- Q: What happens when the digits fit an account the ISP has removed? → A:
  The check runs against that removed account (one credit). If Banxico
  confirms the transfer, the payment is held for the ISP, who decides once,
  with Banxico's confirmation in hand, whether to accept it (and collect the
  service) or reject it. Nothing is reconnected until the ISP decides; the
  payer is told the payment is being reviewed by the ISP (D10, FR-020a).
- Q: On the typing form, must the payer enter the destination account? →
  A: No. Typed data is always checked against the cuenta de cobro (FR-018).
- Q: Should the typing form ask for the reference rather than the clave? →
  A: Yes: the reference is shorter and easier to type, so the form leads with
  "Número de referencia" and offers the clave as the alternative ("¿No
  tienes número de referencia? Escribe tu clave de rastreo"). Either one is
  enough; the clave becomes required only where the reference cannot find
  the transfer alone — a generic reference (D2) or one already used that day
  (D7) (FR-005).
- Q: What if Banxico confirms a transfer found by its reference and its
  record carries no clave? → A: No clave is ever invented: the payment keeps
  its clave empty and records the reference, date, amount, sending bank and
  account, and Banxico's confirmation. It confirms only when two guards
  agree it is new — the provider says this CEP was never validated before,
  and no other confirmed payment of the ISP holds the same reference, date,
  sending bank, amount and account. When the provider cannot say, the
  payment is held for the ISP to accept or reject, as in FR-020a. When
  either guard finds it used, it is refused as already used (FR-006).

## Where this comes from

On 2026-09-23 the product creator brought four real receipts that customers
of one ISP sent as proof of payment. Two of them are what this feature is
for:

1. **Banorte, summary screen.** "¡Tu transferencia fue exitosa!", $300.00, to
   BBVA CLABE ****8195, 09/09/2026 18:10:02, concepto "Sin información". A SPEI
   transfer, clear and readable, with **neither a clave de rastreo nor a
   referencia** on screen: the app shows them one tap away, behind "Ver más
   detalles".
2. **Banco Azteca, photographed with a second phone.** $350.00, 09/Sep/2026
   18:05:43, to "Bbva Mexico ***195", concepto "Cf354", **"Referencia
   038195"** and no clave de rastreo. Banxico can find a transfer by its
   referencia numérica.

Today, read from the code on 2026-09-23: both go to the provider (two-eyes-
receipt D2, D3). The provider finds no clave in either. The reference printed
on receipt 2 is never read, compared or sent, although the validation engine
already accepts one. The payer is then asked to "confirm the clave de rastreo
looking at your receipt" — a receipt that does not show it — and is never told
where it is. Meanwhile the payment re-sends the same picture at every retry.

Both receipts also show where the money went — "CLABE ****8195", "***195" —
and that is all the product has to tell which of an ISP's accounts received
a payment. Today an ISP can only publish a CLABE; many small ISPs also tell
their customers "transfiere a mi tarjeta" or share a phone number for
transfers, and those payments cannot be checked at all.

The other two receipts — a BBVA-to-BBVA transfer and two cash deposits — never
touched SPEI and are out of scope.

## Decisions taken in session (2026-09-23, 2026-09-24)

Recorded here so the plan and the code can cite them as
`receipt-triage D<n>`. This list replaces the earlier ones; no code cites the
earlier numbers.

- **D1 — Two keys find a transfer: the clave de rastreo or the referencia
  numérica.** Every check carries exactly one. The reference travels only
  when there is no clave; when both exist, only the clave travels, and the
  retries keep it — the reference stays on the payment as a record. A clave
  the two readings dispute, with no tiebreak, counts as no clave: when both
  readings agree on a reference that passed the gate, the next attempt
  searches with it before the payer is asked anything (clarified
  2026-09-24).
  This is the provider's own rule for its direct mode ("`referenceNumber` —
  required if `trackingKey` is not sent"), made the product's.
- **D2 — A reference is the SPEI referencia numérica: up to seven digits, as
  printed.** Leading zeros are kept ("038195" stays "038195"). A longer
  number on a receipt — a folio, an authorisation number, an account — is not
  a reference, and is never sent as one. Nor is a **generic reference** —
  a single digit repeated ("0", "0000", "1111111") or a run of consecutive digits ("123", "1234567", "7654321") — the default many bank apps fill in and payers rarely change: it
  would match many transfers of the same day and amount, so it never counts
  as a key and never travels (clarified 2026-09-24).
- **D3 — Banxico's own clave is kept for every confirmation.** A transfer
  found by its reference comes back from Banxico with its real clave de
  rastreo. The payment records it, so the rule "one transfer pays once"
  (direct-payment D8) holds whatever key found it, typed or read.
- **D4 — A clear capture with neither key is asked about before any credit.**
  A receipt the reader can read in full that shows no clave and no reference
  is stopped before the first paid call — the provider cannot read what is
  not printed. This narrows two-eyes-receipt D2 and FR-005 for that one case:
  a partly legible receipt, a malformed clave, and a picture whose legibility
  the reader did not judge still go to the provider as today.
- **D5 — How the missing-data feedback works.** (Designed here.)
  - *When*: the moment the free reading comes back, before any payment
    exists and before any credit; and later, whenever the check needs a field
    from the payer, with the same pattern.
  - *Where*: at the top of the "Envía tu comprobante" step, in the same
    warning message that already refuses a picture that is not a receipt,
    with icon and text; the upload control stays open under it, and focus
    moves to the message so a screen reader announces it.
  - *What it says*, in three short sentences: which key is missing ("Tu
    captura no muestra la clave de rastreo ni el número de referencia."); which
    other data the typing form will need that the capture did not show, and
    only those ("Tampoco vemos la fecha."); and where to find it — the payer's
    bank's own screen when the product has a verified hint for it ("En
    Banorte, toca «Ver más detalles» y captura esa pantalla."), the general
    one otherwise ("Abre el detalle de la transferencia en tu app y captura la
    pantalla donde aparecen estos datos.").
  - *What the payer can do*: two buttons. "Subir otra captura" comes first.
    "Escribir los datos" opens the form with everything the capture did show
    already filled in; each empty field says in text, under it, that it was
    missing from the capture.
  - *When one capture is not enough*: a second capture without a key in the
    same visit puts the form first, with the upload as the second option.
- **D6 — The same pattern later.** When the check needs something from the
  payer after the paid call — a field the two readings disagree on, a date
  nobody read (two-eyes D8, D20), or a reference that matches more than one
  transfer — the page names the field, says where to find it, and offers the
  pre-filled form. It never asks for a field it already has.
- **D7 — A reference that matches more than one transfer asks for the clave.**
  The provider says so explicitly. The product does not ask again with the
  same data; it asks the payer for the clave de rastreo alone. It also
  foresees the case from its own records: a reference already used by
  another of the ISP's payments with the same date, sending bank, amount and
  receiving account is asked about the same way, before any credit
  (clarified 2026-09-24).
- **D8 — The capture guide lives inside the upload step.** Above the upload
  button, a small drawing of a receipt marks what the capture must show, with
  three short rules. It adds no tap before the upload.
- **D9 — An ISP registers up to three receiving accounts and chooses one to
  be paid at.** A CLABE (18 digits), a debit card (16) and a phone (10), each
  with its bank. One of them is the *cuenta de cobro*: the only account the
  payment page shows, so a payer never has to choose where to send the money.
  A SPEI transfer to any of the three is recorded by Banxico, and the
  provider can check it when told which account received it (apiCEP's
  documented beneficiary types: CLABE, card, phone). The CLABE is no longer
  required: an ISP can collect by SPEI once its cuenta de cobro is
  registered, whatever its kind (rescoped and clarified 2026-09-24).
- **D10 — The check asks Banxico about the cuenta de cobro, and the
  receipt's last digits must match what the ISP registered.** The last
  visible digits of the receipt's destination — up to four, at least three —
  are compared with the end of the ISP's registered accounts (a CLABE also by
  the account number inside it, as receipt 3 prints it; receipt 2's "***195"
  counts). Fewer than three visible digits prove nothing and stop nothing.
  When a clear capture's digits fit none of the ISP's
  accounts, the payer is told before any credit that the transfer went to a
  different account. A receipt whose digits fit a registered account
  that is **not** the cuenta de cobro — a customer paying where they always
  paid — is accepted and checked against that account, but only if it is
  registered when the payment is submitted. A receipt whose digits fit an
  account the ISP has **removed** is checked against that account, and a
  transfer Banxico confirms is held for the ISP to accept or reject — the
  money may or may not still reach the ISP, and only the ISP knows.
  Otherwise every check names the cuenta de cobro. A
  credit is never spent trying accounts one after another (rescoped and
  clarified 2026-09-24). The digits are compared with every account the ISP registered —
  CLABE, card and phone — whatever kind of account the receipt's label seems
  to name, so a misread label never turns the ISP's own account into
  "another account" (clarified 2026-09-24).

## Summary

Payers send what their bank app shows them, and many apps show a summary
without the clave de rastreo. Some show a referencia numérica instead, which
Banxico can also search by, but the product ignores it. So today the product
pays to learn that a capture has no clave, then asks the payer for a field
their capture does not have, without telling them where to find it.

This feature works on both sides of the upload. **Before it**, the payer sees
what a good capture looks like. **After it**, the product reads the reference
as well as the clave and searches Banxico with whichever the receipt shows. A
clear capture with neither is caught for free, and the payer is told exactly
what is missing, where their bank shows it, and that they can type it
instead.

It also widens what can be checked. An ISP can publish a debit card and a
phone next to its CLABE, and the check asks Banxico about the account the
receipt shows the money went to.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The referencia numérica finds the transfer when the clave is missing (Priority: P1)

A payer uploads a receipt that shows a referencia numérica and no clave de
rastreo, like receipt 2. The product reads the reference and asks Banxico with
it, along with the date, the amount, the sending bank and the ISP's account.
The payment confirms, and the payer is asked nothing. A payer who types their
data can give the short reference instead of a clave of up to 30 characters.

**Why this priority**: it turns a receipt the product cannot use today into a
confirmation, with a search the engine already supports. It comes first
because Story 2's rule — stop when a capture shows *no key* — depends on the
reference counting as a key; built in the other order, receipt 2 would be
stopped instead of confirmed.

**Independent Test**: submit, against a stubbed reader and an intercepted
provider, a receipt read with a reference and no clave; a typed submission
with only a reference; a receipt where the provider says the reference matches
more than one transfer; and a second payment whose search returns a clave
already used. Count the paid calls and the questions. Needs nothing from the
other stories.

**Acceptance Scenarios**:

1. **Given** a receipt whose reading shows a reference and no clave, **When**
   the check reaches Banxico's transfer search, **Then** the search carries
   the reference with the date, the amount, the sending bank and the
   receiving account, and the payer is asked nothing.
2. **Given** a receipt with both, **When** it is checked, **Then** the search
   carries the clave alone; the reference does not travel.
3. **Given** neither reading found a clave, and both read the same reference,
   **When** Banxico has nothing yet, **Then** the readings count as agreed,
   exactly as two matching claves do today (two-eyes-receipt D5–D6), and the
   retries carry the reference.
4. **Given** neither reading found a clave and they disagree on the
   reference, **When** Banxico has nothing yet, **Then** the payer is asked
   for the reference alone, as for a disputed clave today (two-eyes D8).
5. **Given** a number on the receipt longer than seven digits — a folio, an
   authorisation number — **When** it is read, **Then** it is not taken as a
   reference.
6. **Given** a payer on the manual door ("No tengo el comprobante a la mano"),
   **When** they fill the form, **Then** they may give a clave, a reference or
   both, and at least one is required.
7. **Given** Banxico finds the transfer by its reference, **When** the
   payment confirms, **Then** the payment records the clave from Banxico's
   record; **and when** a later payment of the same business finds the same
   transfer by any key, **Then** it is refused as already used.
8. **Given** the provider answers that the reference matches more than one
   transfer, **When** the answer arrives, **Then** no further paid call is
   made with the same data, and the payer is asked for the clave de rastreo
   alone.
9. **Given** a receipt with both keys whose clave search finds nothing,
   **When** the payment retries, **Then** every retry carries the clave, as
   today, and the reference is only recorded on the payment.
10. **Given** the two readings disagree on the clave, the bank's clave shape
    does not settle it, and both read the same reference that passed the
    gate, **When** the next attempt runs, **Then** it searches with that
    reference and the payer is asked nothing; **and when** Banxico finds
    nothing with it, **Then** the payer is asked to correct the clave or the
    reference, either one being enough, while the retries keep searching
    with the reference. (A reference that matches more than one transfer is
    scenario 8.)

---

### User Story 2 - The payer is told exactly what is missing, and how to fix it (Priority: P2)

A payer uploads the summary screen of their bank app, like receipt 1. It is
clear, and it shows neither a clave de rastreo nor a referencia. Before
anything is spent, the page says so, names anything else the capture lacks,
and says where the payer's bank shows it. The payer can upload the right
screen or type the data, with everything the capture did show already filled
in. The same kind of message appears whenever the check later needs a field
from the payer.

**Why this priority**: it stops a credit being spent to learn nothing, and it
replaces a question the payer cannot answer with one they can. It follows
Story 1 because its rule needs the reference to count as a key.

**Independent Test**: upload, against a stubbed reader and an intercepted
provider, a clear SPEI capture with no key from Banorte, one from a bank
without a hint, a partly legible one, one with a malformed clave, and one
with a reference only. Count the credits and read the payer's screen in each
case; then upload a second capture without a key and read the screen again.
Needs nothing from the other stories: that a reference counts as a key is
part of reading the capture, which every story shares (amended 2026-09-24,
analyze I4).

**Acceptance Scenarios**:

1. **Given** a capture the reader calls fully legible, a SPEI receipt, with
   no clave and no reference, **When** the payer uploads it, **Then** no
   credit is spent, and the message at the top of the step says that the
   capture shows neither the clave de rastreo nor the número de referencia,
   with two buttons: "Subir otra captura" and "Escribir los datos".
2. **Given** that capture also lacks the date, **When** the message renders,
   **Then** it names the date as well; **and given** it shows the amount and
   the bank, **Then** it does not mention them.
3. **Given** the reader recognises a bank the product holds a verified hint
   for (Banorte), **When** the message renders, **Then** it says where that
   bank's app shows the data; **and given** a bank with no hint, **Then** it
   gives the general hint.
4. **Given** the payer chooses to type, **When** the form opens, **Then**
   every field the capture showed is filled in, and each empty field says, in
   text under it, that it was missing from the capture.
5. **Given** a second capture in the same visit that still shows no key,
   **When** it is read, **Then** the form comes first and the upload is the
   second option.
6. **Given** the message appears, **When** it renders, **Then** focus moves
   to it and it is announced to assistive technology; it carries an icon and
   text, never colour alone.
7. **Given** a capture that shows a reference and no clave, **When** it is
   uploaded, **Then** nothing is asked: it goes on to the check (Story 1).
8. **Given** a capture the reader calls partly legible, or whose legibility
   it did not judge, or with a malformed clave, **When** the payer submits
   it, **Then** it goes to the provider as today (two-eyes D2 stands for
   these).
9. **Given** the reader is down, or its answer cannot be parsed, **When** the
   payer uploads, **Then** nothing is asked and the file follows today's flow
   (constitution VIII).
10. **Given** the check later needs a field from the payer — a disputed
    field, a missing date, or a reference that matched more than one
    transfer — **When** the page asks, **Then** it names each field it needs,
    and only those, says where to find them when it knows the bank, and
    offers the pre-filled form.

---

### User Story 3 - An ISP chooses the account it is paid at: CLABE, debit card or phone (Priority: P2)

An ISP registers in Cuenta the accounts it has — a CLABE, a debit card, a
phone — and picks one as its *cuenta de cobro*. The payment page shows that
one account, so the payer copies one number and never has to decide where to
send the money. Every check asks Banxico about that account, and the receipt's
last three or four digits confirm the money went to the ISP.

**Why this priority**: many small ISPs are paid at a card or a phone today,
and those payments cannot be checked at all. It ranks with Story 2 and not
above it because the ISP's setup, the page and the check all change.

**Independent Test**: configure an ISP with a CLABE, a card and a phone and
choose each in turn as the cuenta de cobro, against an intercepted provider;
check which account the page shows and which account each search names;
submit a clear receipt whose last four digits fit the cuenta de cobro, one
showing only three digits that fit it, one whose digits fit none of the
ISP's accounts, and one showing only two digits. Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** an ISP with only a CLABE, **When** this feature ships, **Then**
   nothing changes for it or its payers: the CLABE is its cuenta de cobro.
2. **Given** an ISP member who may change the CLABE, **When** they open
   Cuenta, **Then** they can add, change or remove a debit card (16 digits)
   and a phone (10 digits), each with its bank, and choose which registered
   account is the cuenta de cobro.
3. **Given** a card number of the wrong length or with a failing check digit,
   a phone that is not 10 digits, or a number without its bank, **When** it
   is saved, **Then** it is refused with a message that names the problem.
4. **Given** a member who may not change the CLABE, **When** they open
   Cuenta, **Then** they cannot change the accounts or the choice, and they
   see them exactly as they see the CLABE — masked to the last four digits
   when their role cannot update the settings.
5. **Given** any ISP, **When** the payment page renders, **Then** it shows
   exactly one account — the cuenta de cobro, labelled by its kind ("CLABE",
   "Tarjeta de débito", "Celular") with its bank, copyable — and asks the
   payer to choose nothing.
6. **Given** a receipt, **When** it is checked, **Then** the search names the
   cuenta de cobro the payment was submitted under — unless its last digits
   fit another of the ISP's registered accounts, in which case the
   search names that account.
7. **Given** an ISP that registered a card but collects at its CLABE, and a
   customer who still pays to the card, **When** their clear receipt shows
   the card's last digits, **Then** the payment is accepted and checked
   against the card; **and when** the ISP had removed the card before the
   payment was submitted, **Then** the check runs against the removed card,
   and a transfer Banxico confirms is held until the ISP accepts it (the
   service is collected) or rejects it; the payer is told "Tu pago está en
   revisión con {ISP}", and nothing is reconnected before the ISP decides.
8. **Given** a fully legible receipt whose last three or four visible digits
   fit none of the ISP's registered accounts, **When** it is uploaded,
   **Then** it is discarded with no credit spent, and the payer is told —
   honestly and kindly, never as an accusation — that the transfer seems to
   have gone to another account, which account the ISP receives at, and that
   they can send another capture or type their data if the reading is wrong.
9. **Given** a receipt that shows fewer than three digits of its destination,
   **When** it is checked, **Then** the destination neither stops it nor
   confirms it; the check goes on with the cuenta de cobro.
10. **Given** an ISP with only a card or only a phone, **When** it chooses it
    as its cuenta de cobro, **Then** it can collect by SPEI with no CLABE.
11. **Given** the ISP changes its cuenta de cobro, **When** a payment already
   submitted is checked, **Then** it is checked against the account it was
   submitted under.

---

### User Story 4 - The payer sees what a good capture shows before taking it (Priority: P3)

On the "Envía tu comprobante" step, above the upload button, the payer sees a
small drawing of a receipt with the data that matters marked — the clave de
rastreo or the número de referencia, the amount, the date and the account the
money went to — and three short rules: capture the transfer's detail, not the
summary; the whole screen, without cropping; and if it is a photo, without
glare.

**Why this priority**: it prevents what Story 2 repairs, at no cost per
payment. It comes last because some payers will still send the summary
screen, so the repair must exist first.

**Independent Test**: render the step at 360px, 768px and 1280px in both
themes; check the drawing, the text and the rules, and that the upload button
is one tap from the start of the step. Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** the upload step, **When** it renders, **Then** above the upload
   button a drawing of a receipt marks, with numbers named in text, the clave
   de rastreo or número de referencia, the amount, the date and the
   destination account.
2. **Given** the drawing, **When** it renders at 360px in either theme,
   **Then** it is legible, causes no horizontal scroll, and marks nothing by
   colour alone.
3. **Given** the step, **When** it renders, **Then** it shows the three
   rules.
4. **Given** a payer who wants to know where their bank shows the data,
   **When** they open the tips, **Then** they reach them in one tap, with the
   same hints Story 2 uses.
5. **Given** the drawing, the rules and the tips, **When** the step renders,
   **Then** the upload button is still one tap from the start of the step.

---

### Edge Cases

- **A reference of "0" or "1234567".** Common defaults. The search still
  carries the date, amount, banks and account; if the provider says it
  matches more than one transfer, the payer is asked for the clave (D7).
- **Two customers of one ISP pay the same amount, the same day, from the same
  bank, with the same reference** (an app that fills in the same default for
  everyone). The second is asked for the clave before any credit, because
  the first is already in the ISP's records (FR-007). A payer re-uploading
  or correcting their own payment is the same link, never a match.
- **A receipt with a reference and a malformed clave.** The reference is a
  key, so nothing is asked at the upload; the clave travels as read, and the
  comparison treats it as today.
- **The reader takes a folio for a reference.** Anything longer than seven
  digits is dropped (D2); a seven-digit folio could still pass, and then the
  search finds nothing and the comparison asks the payer, as for any misread.
- **A payer who types a reference whose Banxico record carries a clave
  already used by this business.** Refused as already used (D3), exactly as
  if they had typed that clave.
- **A receipt that shows the ISP's account number, not its CLABE** (receipt 3
  prints "•3819 Cuenta"). The account number is part of the CLABE, so it ties
  the payment to the CLABE; it is never a mismatch.
- **A transfer to the ISP's card or phone from the same bank.** It never goes
  through SPEI, so Banxico has no record of it. This feature does not change
  what happens to it (Out of Scope: same-bank payments).
- **A customer pays to a registered account that is not the cuenta de cobro
  and either types their data or sends a receipt showing fewer than three
  digits.** Nothing tells the product which account received the money, so
  the check names the cuenta de cobro and Banxico finds nothing; the payment
  rides its schedule and ends in the usual way. The payer was never shown
  that account, so this is the rare case, and it asks the payer no extra
  question by design (rescoped 2026-09-24).
- **A card that is a credit card.** It cannot be told apart by its digits. The
  setup labels the field "tarjeta de débito" and says it must receive
  transfers; the ISP answers for it.
- **A platform top-up with neither key, or sent to another account.** Both
  stops apply in the engine, as the two-eyes refusals do for top-ups, with the
  platform's CLABE as the only account: no provider credit; the top-up rides
  its schedule and the remedy is a new upload (amended 2026-09-24, analyze
  G3). A top-up with a reference only
  keeps today's flow, and top-ups keep the platform's single CLABE.
- **A payment born before this feature, validating at cut-over.** It finishes
  under the flow it started in.

## Requirements *(mandatory)*

### Functional Requirements

**The referencia numérica (Story 1, D1–D3, D7)**

- **FR-001**: The reader MUST read the referencia numérica as well as the
  clave de rastreo, as printed, leading zeros kept.
- **FR-002**: A reference MUST be one to seven digits; a longer number MUST
  NOT be taken as a reference. A generic reference — a single digit repeated ("0", "0000", "1111111") or a run of consecutive digits ("123", "1234567", "7654321") — MUST NOT count
  as a key, whether read or typed: a capture whose only key is one is asked
  about as a capture with no key (FR-008), naming the clave; on the typing
  form the page MUST say beside the field that this reference is shared by
  many transfers and MUST require the clave de rastreo.
- **FR-003**: Every search of Banxico's transfer records MUST carry exactly one
  key: the clave when there is one, the reference only when there is no
  clave. When both exist, the reference MUST NOT travel, and retries MUST
  keep the clave; the reference is recorded on the payment. A clave the two
  readings dispute with no tiebreak counts as no clave (FR-004).
- **FR-004**: The comparison of the two readings (two-eyes-receipt D5–D8)
  MUST treat the reference as it treats the clave when neither reading found
  a clave: agreed, disputed or blind, and the payer asked only for the field
  in doubt. When the readings dispute the clave, the bank's clave shape does
  not settle it and the clave is the only field in doubt, a reference both
  readings agree on and that passed the gate MUST be the next attempt's key
  before the payer is asked; only when Banxico finds nothing with it MUST the
  payer be asked, and then for the clave or the reference, either one being
  enough.
- **FR-005**: The manual door and the typing form MUST accept a clave, a
  reference or both, and MUST require at least one. The form MUST lead with
  the reference ("Número de referencia") and offer the clave as the
  alternative; it MUST require the clave only when the reference cannot find
  the transfer alone (a generic reference, D2; one already used that day,
  D7). The form MUST NOT ask for the destination account (FR-018).
- **FR-006**: Every payment Banxico confirms MUST record the clave from
  Banxico's record, whatever key found it, read or typed. Before the payment
  is confirmed, the product MUST check that no other payment of the same
  business already holds that clave; a payment whose check returns a clave
  already used MUST be refused as already used, and never confirmed. When
  Banxico's record carries no clave, the product MUST NOT invent one: the
  payment keeps its clave empty and MUST confirm only when the provider says
  the CEP was never validated before and no other confirmed payment of the
  business holds the same reference, date, sending bank, amount and account;
  when the provider cannot say, the payment MUST be held for the ISP as in
  FR-020a; when either guard finds it used, it MUST be refused as already
  used.
- **FR-007**: When the provider answers that a reference matches more than one
  transfer, the product MUST NOT make another paid call with the same data
  and MUST ask the payer for the clave de rastreo alone. Before any paid call
  that would search by a reference, the product MUST look for another payment of the same business, from another link and not `superseded`, with the same reference, transfer date, sending bank, amount and receiving account (the account ruling nothing out while either side's is unknown); when
  one exists it MUST ask the payer for the clave instead of calling —
  at the upload for a capture, and on the typing form, where the clave then
  becomes required. Finding none MUST NOT be read as proof the reference is
  unique.

**Missing-data feedback (Story 2, D4–D6)**

- **FR-008**: A capture the reader calls fully legible, a SPEI receipt, that
  shows neither a clave nor a reference — a generic reference counting as
  none (FR-002) — MUST NOT reach a paid call.
- **FR-009**: The payer MUST be told on the same screen, at the top of the
  step, that the capture shows neither key; the message MUST also name every
  other field the typing form needs that the capture did not show, and MUST
  NOT name fields the capture showed.
- **FR-010**: The message MUST say where to find the data: the bank's own
  screen when a verified hint exists for the bank the reader recognised, the
  general hint otherwise.
- **FR-011**: The message MUST offer "Subir otra captura" first and "Escribir
  los datos" second; the form MUST be filled in with every field the capture
  showed, and each empty field MUST say in text that it was missing from the
  capture.
- **FR-012**: A second capture with no key in the same visit MUST put the form
  first.
- **FR-013**: The message MUST receive focus and be announced to assistive
  technology, with an icon and text.
- **FR-014**: When the check later needs a field from the payer (two-eyes D8,
  D20, and FR-007), the page MUST name each field it needs and only those,
  say where to find them when it knows the bank, and offer the pre-filled
  form.
- **FR-015**: A partly legible capture, one whose legibility the reader did
  not judge, one with a malformed clave, and any capture read while the
  reader is down or answering nonsense MUST follow today's flow.

**The cuenta de cobro (Story 3, D9, D10)**

- **FR-016**: A member who may change the CLABE MUST be able to register,
  change or remove a CLABE, a debit card (16 digits, passing the card check
  digit) and a phone (10 digits), each with a bank from the provider's
  vocabulary, and MUST choose exactly one registered account as the cuenta de
  cobro. Any other member MUST see them exactly as they see the CLABE today,
  masked to the last four digits when their role cannot update the settings.
  No kind of account is required: the channel is available once the cuenta
  de cobro is registered, whatever its kind.
- **FR-017**: The payment page MUST show exactly one account — the cuenta de
  cobro — labelled by its kind, with its bank, copyable, and MUST NOT ask the
  payer to choose an account. An ISP with only a CLABE MUST see no change.
- **FR-018**: Every search MUST name the cuenta de cobro the payment was
  submitted under, except when the receipt's last digits fit another
  account the ISP had registered when the payment was submitted: then the
  search MUST name that account. Typed data MUST be checked against the
  cuenta de cobro.
- **FR-019**: The last visible digits of a receipt's destination — up to
  four, at least three — MUST be compared with the end of every account the
  ISP registered (a CLABE also by the account number inside it). Fewer than
  three visible digits MUST neither
  stop nor confirm anything. No credit MUST be spent trying accounts one
  after another.
- **FR-020**: A fully legible receipt whose last three or four visible digits
  fit none of the ISP's registered accounts MUST be discarded before any
  credit. The payer MUST be told honestly and kindly — never as an
  accusation — that the transfer seems to have gone to another account,
  shown the account the ISP receives at, and offered another capture or
  typing their data. The kind of account a receipt's label seems to name MUST NOT turn a fit
  into a mismatch.
- **FR-020a**: A receipt whose digits fit an account the ISP removed MUST be
  checked against that account. When Banxico confirms the transfer, the
  payment MUST be held — no reconnection, no settlement of the debt — until
  a member who may operate payments accepts or rejects it, seeing Banxico's
  confirmation and which removed account received it; the payer MUST be
  told the payment is being reviewed by the ISP. When Banxico does not
  confirm it, the payment follows the usual schedule.
- **FR-021**: Changing the cuenta de cobro, or changing or removing any
  account, MUST NOT change the account a submitted payment is checked
  against.

**The capture guide (Story 4, D8)**

- **FR-022**: The upload step MUST show, above the upload button, a drawing of
  a receipt marking with numbers, named in text, the clave de rastreo or
  número de referencia, the amount, the date and the destination account.
- **FR-023**: The drawing MUST be legible at 360px in both themes, cause no
  horizontal scroll, and mark nothing by colour alone.
- **FR-024**: The step MUST show three rules: the detail, not the summary; the
  whole screen; a photo without glare.
- **FR-025**: Tips on where each bank shows the data MUST be one tap away, and
  MUST come from the same hints as FR-010.
- **FR-026**: Nothing this story adds may stand in front of the upload button.

**Across the feature**

- **FR-027**: Payments validating at cut-over MUST finish under the flow they
  started in.
- **FR-028**: The product MUST make countable from its records, with no
  further instrumentation: captures stopped for having no key, by bank; how
  each ask ended (new capture, typed data, abandoned); searches by reference
  and how they ended (found, not found, matched more than one); payments by
  the account that received them; destinations that fit none of the ISP's
  accounts.
- **FR-029**: Nothing else changes: what a Banxico verdict means, the fee,
  partial settlement, the schedule, and the top-up flow apart from the stop
  (Edge Cases).

### Key Entities

- **Key**: what finds a transfer in Banxico — a clave de rastreo, a
  referencia numérica, or both — with where each came from: our reading, the
  provider's, the payer's hand, or Banxico's record.
- **Receiving account**: an account an ISP registered — a CLABE, a debit
  card or a phone — each with its bank. Exactly one is the **cuenta de
  cobro**, the only one its payers see. A payment remembers the account it
  was submitted under.
- **Ask**: a request to the payer for data, with the fields it named and how
  it ended.
- **Bank hint**: for a bank, where its app shows the clave and the reference,
  with the real receipt or the bank's own document it was verified against;
  es-MX copy kept by hand, used by the ask and by the guide's tips.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A clear SPEI capture that shows neither key spends zero credits,
  and the payer learns what is missing within the same interaction.
- **SC-002**: A receipt that shows a reference and no clave, for a transfer
  Banxico has published, is confirmed with no question to the payer and at
  most two paid calls.
- **SC-003**: When the payer is asked, the number of fields named is exactly
  the number missing or in doubt — never the whole form.
- **SC-004**: The count of payments of one business confirmed with the same
  Banxico clave is zero, whatever key found them.
- **SC-005**: A reference that matches more than one transfer costs at most
  one paid call before the payer is asked for the clave.
- **SC-006**: A transfer to an ISP's cuenta de cobro that Banxico has
  published is confirmed with the same number of paid calls whether that
  account is a CLABE, a card or a phone; the payer makes zero choices about
  where to send the money.
- **SC-007**: A clear receipt whose destination fits none of the ISP's
  accounts spends zero credits.
- **SC-008**: An ISP with only a CLABE sees no change in its setup, and its
  payers see no change on the transfer step.
- **SC-009**: Every entry on the bank-hint list names the real receipt or the
  bank's own document it was verified against. At launch the list holds
  Banorte (receipt 1) and every bank whose detail screen has been seen that
  way before implementation.
- **SC-010**: On the upload step, the upload button is one tap from the start
  of the step, and the page has no horizontal scroll at 360, 768 and 1280px in
  either theme.
- **SC-011**: The share of payers who, once asked, send a new capture or type
  the data — rather than abandon — can be read from the records.
- **SC-012**: For every outcome that exists today, a receipt that shows its
  clave and was sent to the CLABE ends in the same status with the same words
  as today.
- **SC-013**: Every new test carries its story citation (`receipt-triage
  US<n>`), and the count of decision citations lost in the change is zero.

## Assumptions

- **The provider's direct mode finds a transfer by reference alone.**
  Documented by the provider and read in session on 2026-09-23 ("required if
  `trackingKey` is not sent"); never measured by us. Its answer to a
  reference that matches more than one transfer — published as a refusal that
  asks for the tracking key — is likewise unmeasured.
- **Whether the provider's picture reading searches by a reference it reads**
  is unknown. The design does not depend on it: if it does not, the reference
  both readings agree on travels on the next attempt, which is why SC-002
  allows two paid calls.
- **The provider accepts a debit card and a phone as the receiving account**,
  and a list of accounts to choose from when it reads a picture. Documented,
  unmeasured. Whether its answer says which account matched is unknown; the
  design does not depend on it.
- **The ISP's phone is registered with its bank to receive transfers**, and
  its card is a debit card that receives SPEI. The setup says so; the ISP
  answers for it.
- **The referencia numérica has at most seven digits**, as SPEI defines it and
  as bank apps ask for it; the provider's own example carries seven.
- **"Clear" is the reader's own "fully legible"**, or the text of a PDF: a
  field the bank did not print is not a legibility problem.
- **The bank hints are kept by hand**, as es-MX copy, and an entry is added
  only from a real receipt or the bank's own documentation. The first is
  Banorte, from receipt 1.
- **The capture guide is part of the existing step**, not a screen of its
  own, so no payer takes an extra tap to reach the upload.
- **One card and one phone per ISP.** More accounts, or a second CLABE, are
  out of scope.
- **Production has no traffic yet** (measured 2026-09-23), so how often a
  capture lacks both keys is unknown today; FR-028 makes it countable.

## Out of Scope

Narrowed on 2026-09-23 and 2026-09-24 (Clarifications). Kept here so none of
it is lost:

- A second CLABE, more than one card or phone, and steering payers to an
  account at another bank.
- Spin by OXXO and other fintechs: checking against the institution Banxico
  records for them.
- Same-bank transfers and cash deposits: sorting them, keeping them away from
  Banxico, and a review flow for the ISP (receipts 3 and 4).
- Flags for a capture used twice, and a cap on the paid calls a receipt can
  buy.
- A reference assigned by the page to each customer.
- Searching by reference, and receiving at a card or phone, for platform
  top-ups.
- Reading the ISP's own bank movements.

## Dependencies

- The provider (apiCEP): its direct mode with a `referenceNumber`, the
  reference its picture reading returns, the card and phone receiving
  accounts, and the list of accounts it chooses from when it reads a picture.
- The two-eyes flow (two-eyes-receipt D1–D8 and plan D20), which this feature
  narrows in one case (D4) and whose asks it rewords (D6).
- The one-transfer-pays-once rule (direct-payment D8), extended to every key
  (D3).
- The Cuenta settings where the CLABE is configured today, and the role
  allowed to change it.
- The receipt reader and its PDF text route (two-eyes-receipt D1, D2).
