# Feature Specification: receipt-reader-tuning

**Feature Branch**: `claude/comprobante-tracking-key-validation-jtknpt`

**Created**: 2026-09-25

**Status**: Specified — clarifications settled on 2026-09-25; ready for
`/speckit-plan`

**Input**: User description: "1. El modelo se puede elegir desde el
administrador de la plataforma. Ruta /operador. 2. Optimizamos el prompt.
3. Hago pruebas de recibos reales en dev con mistral, Gemini 4."

## Clarifications

### Session 2026-09-25

- The creator asked to go step by step and to start with what makes the
  receipt be **read correctly**. Everything the investigation of the same day
  found downstream of the reading (asking for the bank before the first
  credit, the night-time date, trying the reference after a clave that finds
  nothing) is kept under Out of Scope as the next steps.
- "Gemini 4" is read as **Gemma 4 26B A4B**, Google's open model in the
  Workers AI catalog, the one named in the model survey of the same session.
  Gemini itself is not in Workers AI (Assumptions). Confirmed by the creator
  the same day: "Me refería a Gemma 4."
- Q: May the reader discard a sending bank that equals the destination's
  bank, since SPEI cannot run inside one bank? → A: No. A payer may
  legitimately transfer from the same bank the ISP receives at — an ISP with
  an Azteca CLABE paid from an Azteca account — and that payment is real.
  What matters is identifying the **sending bank and the receiving bank
  correctly**, each from its own side of the receipt, and never altering
  what was read. D5 was rewritten from "discard it" to "read both banks and
  flag the same-bank pair". What the product does with a same-bank payment,
  which Banxico's CEP cannot confirm, is a next step (Out of Scope).
- Q: How are the models compared (D6)? → A: Option B, a test bench in
  `/operador`. The operator uploads a receipt, and every allowed model reads
  it side by side, with no payment and no credit. The operator marks each
  field, and the bench adds up the marks per model and question version.
  The real payment flow (A) and both (C) were not chosen.

## Where this comes from

On 2026-09-24 and 2026-09-25 the creator paid an ISP on dev with real
transfers and real captures. The readings were checked against the dev
database and against what Banxico answered:

1. **Nu, the Folio taken for the clave.** Nu's detail screen prints
   "Número de referencia 250926" and "Folio QVSBGOD7L", and no clave de
   rastreo. The reader answered `claveDeRastreo: "QVSBGOD7L"`. The gate
   passed it, since 9 letters and digits fit its 6–30 range, and no Nu clave
   shape exists yet (0 Nu transfers confirmed on dev or prod). The provider's
   own reading saw nothing, so ours was accepted as it was. After one paid
   call to the image door, four paid searches with the folio all came back
   `not_found`, with more scheduled. The correct reference never travelled,
   because a clave was present (receipt-triage D1).
2. **Banco Azteca, the destination's bank taken for the sender's.** The
   capture shows "Cuenta origen: Guardadito ***8301" and "Cuenta destino:
   Leo Licona, Bbva Mexico ***417". The name "Azteca" appears nowhere. In
   **7 readings of 5 different captures** of these transfers, the reader
   answered `banco: "BBVA MEXICO"`. On the capture with no clave, every
   retry was refused by the engine's own rule that SPEI cannot run inside
   one bank (validation spec D17). The payment rode its schedule and ended
   `expired`, and the payer was never asked anything.
3. **Banco Azteca, the trailing "I".** Azteca's claves end in the letter I
   (`260925071144368901I`). The reader read that "I" as a "1" twice and
   dropped it once (3 of 3 wrong). The provider read all three right, which
   is the only reason those payments were confirmed.
4. **The questions were never measured.** receipt-triage added two questions
   to the reader (the reference and the destination) and shipped them
   unmeasured (`.specify/debt/receipt-triage-reader-unmeasured/`). The last
   measurement of the reader (proof-extraction D5, 2026-08-19: 30/30 claves
   right) measured the clave alone. Every failure above is a failure to
   tell **which field is which**, plus one look-alike character.

The reader today is Mistral Small 3.1 24B on Workers AI, set per environment
by deploy. The Workers AI catalog of September 2026 offers newer models that
read images. The one the creator chose to test is Gemma 4 26B A4B (April
2026), which Cloudflare lists for document parsing and OCR, and prices below
today's model. Neither model is on Cloudflare's deprecation list.

## Summary

Three things, in the creator's order:

1. **The platform operator chooses the reader model** in `/operador`, from
   the models the environment allows. The change applies from the next
   reading, with no deploy.
2. **The reader's questions are rewritten** so the three failures above stop.
   The reader identifies **both banks**: the sending bank from the sender's
   side, and the receiving bank from the destination's side. A same-bank
   pair is kept as read and flagged, never altered.
3. **The creator compares the models on real receipts on dev** (Mistral Small
   3.1 and Gemma 4), on a **test bench in `/operador`**. The bench reads one
   uploaded receipt with every allowed model side by side, creates no
   payment and spends no credit. Its tally decides which model production
   uses and closes the receipt-triage measurement debt.

Every reading records the model that read it and the version of the
questions it answered, so each result can be traced to its cause.

## Decisions taken in session (2026-09-25)

- **D1 — One reader model per environment, chosen in `/operador`.** It is
  platform-wide, not per business. The operator picks it from the
  environment's **list of allowed models**, and that list is set by deploy,
  because model ids are configuration (constitution VIII). Adding a model to
  the list takes a deploy; switching between listed models takes one action
  in the panel. With no choice made, the environment's **default model**
  reads, which is today's behaviour. Dev lists Mistral Small 3.1 and Gemma 4
  26B A4B. Prod lists Mistral Small 3.1 only, until another model passes
  SC-005 on dev.
- **D2 — The questions stay in the product, and carry a version.** The
  operator chooses the model, not the wording. A change to the questions is
  a release like any other code. Each set of questions carries a version
  label, and every reading records the label it answered.
- **D3 — A failed answer never costs the payer the reading.** When the
  chosen model gives an error or an answer that cannot be used, the same
  receipt is read once more by the environment's default model. Examples of
  a failure: the model is unavailable, retired by Cloudflare or too slow, or
  it answers without the expected answer shape. The record names the model
  that actually read the receipt and marks the fallback, so a comparison
  never credits one model with another's reading. When the default fails
  too, today's degradation holds: the file goes to the provider unread
  (two-eyes-receipt D15). A **wrong** answer is not a failure: a confident
  misread cannot be detected at that moment, and the fallback does not cover
  it. Against misreads, the protections are the comparison (Story 3) and the
  bar a model must pass before it becomes active in prod (SC-005). How long
  the chosen model may take before it counts as too slow is decided in the
  plan. It must keep the payer's total wait within SC-005.
- **D4 — Three rules for the questions**, one per failure:
  - The clave de rastreo is taken only from the field the receipt labels as
    the clave. A folio, an authorisation or operation number, a reference or
    an account number is never a clave.
  - A clave is copied character by character. Look-alike characters are not
    swapped, and a clave that ends in a letter keeps that letter.
  - The sending bank is taken only from what the receipt says about the
    sender: a sending-bank field, the bank of the origin account, or the
    name of the bank that issued the receipt. The bank printed beside the
    destination account is never the sending bank. When the receipt does
    not show the sending bank, the reading says so.
- **D5 — Both banks, each from its own side, and a same-bank pair is
  information, not an error** (rewritten on 2026-09-25 after the creator's
  objection, Clarifications). The reader answers one more question: the
  **receiving bank**, read only from the destination's side. The record
  keeps both banks as read. The reader and the gate never alter one bank
  because of the other. When the two are the same institution, the reading
  is **flagged as a same-bank pair**. That is true of two different
  situations, and the reading cannot tell them apart:
  - A **misread**: the destination's bank taken for the sender's, the
    measured Azteca case. The rules of D4 exist to stop it.
  - A **real same-bank payment**: an ISP with an Azteca CLABE paid from an
    Azteca account. The money is real, but no SPEI ran, so Banxico has no
    CEP to confirm it. The engine refuses to search for that pair before
    spending a credit (validation spec D17).

  The flag makes both cases countable and visible from the first reading.
  Handling them, today a silent ride to `expired`, is the next step (Out of
  Scope). The receiving bank also cross-checks the destination: when the
  receipt's digits tie to one of the ISP's accounts (receipt-triage D24), the
  receiving bank read should be that account's bank, and a difference is
  recorded as a sign that one of the two readings is off.
- **D6 — A test bench in `/operador`** (the creator's choice, option B,
  2026-09-25). The operator uploads a receipt, a picture or a PDF, and
  **every model in the environment's list reads it at once**, with the
  current questions. The results sit side by side, next to the receipt,
  field by field, with the time each model took. The operator marks each
  field right or wrong, and the bench adds up the marks per model and per
  question version. That tally is the dated measurement that decides the
  prod model and closes `receipt-triage-reader-unmeasured`.
  - The bench creates **no payment**, spends **no validation credit** and
    never calls the provider. Its readings are kept apart from payer
    readings and count in no payer measurement.
  - The bench **does not fall back** (D3 is for payers): a model that fails
    shows as failed, because the bench exists to measure each model as it
    is.
  - A receipt stays on the bench for the same time as a payment proof. In
    that time the operator can **read it again**, for example after a
    change to the questions, and compare question versions on the same
    files.
  - The bench belongs to no ISP, so the destination is shown as read and is
    not tied to anyone's accounts. The same-bank flag of D5 shows as it
    would for a payer.
  - Rejected: the real payment flow (option A), because each test would need
    a real transfer, cost validation credits, and mean uploading every
    receipt once per model. Both (option C) was also rejected: watching the
    models against Banxico in production can be a later step.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The operator chooses which model reads receipts (Priority: P1)

The platform operator opens `/operador` and sees which model reads receipts
in this environment, since when, and who chose it. They pick another model
from the environment's list and save. The next receipt any payer uploads is
read by that model. Going back takes the same single action.

**Why this priority**: The creator can only test a model on real receipts if
switching is cheap. Today switching takes a code change and a deploy. It
also lets production change model later without a release, and go back in
one action if a model misbehaves.

**Independent Test**: As the operator on dev, switch from Mistral Small 3.1
to Gemma 4. Upload a receipt through a dev payment link, and confirm that
the reading record names Gemma 4 and the current question version. Switch
back, upload again, and confirm that the record names Mistral.

**Acceptance Scenarios**:

1. **Given** no choice has ever been made in an environment, **When** the
   operator opens `/operador`, **Then** the panel shows the environment's
   default model as the active one, marked as the default.
2. **Given** the dev list holds Mistral Small 3.1 and Gemma 4, **When** the
   operator chooses Gemma 4 and saves, **Then** the next reading on dev is
   made by Gemma 4. The panel shows the change with its author and time, and
   keeps the earlier choices in the history.
3. **Given** the prod list holds only Mistral Small 3.1, **When** the operator
   opens the choice in prod, **Then** only Mistral is offered. No other model
   can be entered by any means.
4. **Given** a signed-in user who is not the platform operator, **When** they
   try to see or change the reader model, **Then** they are refused, as for
   every other operator rule.
5. **Given** Gemma 4 is chosen and answers with an error for one receipt,
   **When** that receipt is read, **Then** the default model reads it. The
   payer gets a reading as usual, and the record names Mistral and marks
   the fallback.
6. **Given** a payer's draft reading was made by Mistral, **When** the
   operator switches to Gemma 4 before the payer pays, **Then** the paid
   attempt reuses the Mistral reading (two-eyes-receipt D14), and its record
   still names Mistral.

---

### User Story 2 - The receipt is read right: the clave, the sending bank, every character (Priority: P1)

A payer uploads a capture that shows a folio but no clave, one that shows
only the destination's bank, or one whose clave ends in a letter. The reading
names no clave for the first. For the second it names the receiving bank as
the receiving bank, and never as the sending bank. For the third it gives
the exact clave. Nothing that reads right today reads wrong afterwards.

**Why this priority**: This is the product value. A misread key buys paid
searches that can never succeed, and a misread bank ends in a silent
expiry. Both were measured on real payments on 2026-09-25. It helps with
whatever model is active, including today's.

**Independent Test**: Read the known real receipts (Where this comes from,
plus receipts 1 and 2 of receipt-triage) with the new questions, and compare
each field with the truth on the receipt and with Banxico's answer where one
exists.

**Acceptance Scenarios**:

1. **Given** the Nu capture with "Folio QVSBGOD7L", "Número de referencia
   250926" and no clave, **When** it is read, **Then** the reading has no
   clave, and the reference is `250926`.
2. **Given** the Azteca capture with "Cuenta origen: Guardadito ***8301" and
   "Cuenta destino: … Bbva Mexico ***417", **When** it is read, **Then** the
   receiving bank is BBVA MEXICO. The sending bank is either Banco Azteca, if
   the receipt identifies its own bank, or "not shown", and never BBVA
   MEXICO.
3. **Given** an ISP whose cuenta de cobro is an Azteca CLABE, and a payer who
   transferred from an Azteca account with a receipt that shows it, **When**
   it is read, **Then** the sending bank is Azteca and the receiving bank is
   Azteca. Both are kept as read, and the reading is flagged as a same-bank
   pair (D5). Nothing is discarded or changed.
3a. **Given** a reading flagged as a same-bank pair, **When** the operator
   looks at the reading records, **Then** they can count the flagged
   readings and see both banks as they were read.
4. **Given** an Azteca capture whose clave is `260925071144368901I`, **When**
   it is read, **Then** the clave is `260925071144368901I`, exactly, with its
   final letter.
5. **Given** receipt 1 (Banorte summary, no clave, no reference) and receipt
   2 (Azteca, "Referencia 038195", destination "***195") of receipt-triage,
   **When** they are read, **Then** each reads at least as right as with
   today's questions: no key and CLABE ending 8195 for receipt 1, and
   reference `038195` with its zero plus destination `195` for receipt 2.
6. **Given** a receipt that shows a labelled "Clave de rastreo", **When** it
   is read, **Then** the clave is read as today: no regression on the
   receipts that already read right.

---

### User Story 3 - The creator compares the models on real receipts, on a test bench (Priority: P2)

On dev, the creator opens the test bench in `/operador` and uploads a real
receipt from their phone. Mistral Small 3.1 and Gemma 4 read it at the same
time. The receipt shows beside the two readings, field by field, with the
time each took. The creator marks each field right or wrong. After ten or
twenty receipts, the bench shows per model how many fields were right, and
the creator decides which model production uses. No payment is created, no
credit is spent, and no payer measurement moves (D6).

**Why this priority**: Without the comparison, choosing a model is a guess,
and the questions of Story 2 stay as unmeasured as the ones that failed. It
comes after Stories 1 and 2 because it compares their result.

**Independent Test**: As the operator on dev, upload ten real receipts,
including the known failures, to the bench. Mark every field. Check that the
tally per model and question version matches the marks. Then check that no
payment, no validation record and no payer reading appeared.

**Acceptance Scenarios**:

1. **Given** Mistral Small 3.1 and Gemma 4 in the dev list, **When** the
   operator uploads a receipt to the bench, **Then** both models read it,
   and the bench shows the receipt beside each model's clave, reference,
   sending bank, receiving bank, amount, date, destination, legibility and
   same-bank flag, plus the time each reading took.
2. **Given** a bench reading, **When** the operator marks each field as
   right, wrong or "not on the receipt", **Then** the marks are saved with
   the model and the question version that produced the reading.
3. **Given** marked readings of several receipts, **When** the operator
   opens the tally, **Then** they see per model and per question version the
   number of fields right out of those marked, the fields each model gets
   wrong most, and the reading time within which 9 of 10 readings finished
   (SC-005).
4. **Given** one model fails on a bench receipt, **When** the results show,
   **Then** that model's column says it failed, and no other model's
   reading takes its place (D6).
5. **Given** a bench receipt read with question version 1, **When** the
   questions change to version 2 and the operator reads the receipt again,
   **Then** both versions' readings show for that receipt, each with its own
   marks.
6. **Given** any number of bench readings, **When** anyone looks at payments,
   validation records, credits or the payer reading measurements, **Then**
   nothing from the bench appears in them.
7. **Given** a user who is not the platform operator, **When** they try to
   open the bench or upload to it, **Then** they are refused.

---

### Edge Cases

- **A model in the list stops existing.** Cloudflare may retire a model.
  If it is the chosen one, readings fall back to the default (D3), and the
  panel shows the failures, so the operator can switch.
- **A deploy removes the chosen model from the list.** The environment's
  default reads from then on, and the panel says the choice no longer
  applies.
- **Two operators change the model at nearly the same time.** The last
  change wins, and both appear in the history, like every other rule.
- **The default model fails too.** Today's degradation holds (D3): the file
  goes to the provider unread, and the record says why.
- **A slow model.** The payer waits for the reading at the upload. A model
  that is right but slow is not eligible for prod (SC-005). The bench shows
  the time of every reading.
- **A PDF.** The PDF's text is asked the same questions as a picture, apart
  from legibility, with any model (two-eyes-receipt D1). The rules of D4
  apply to the text as well.
- **The sending bank is not read and the receipt shows no key.** The existing
  "ask before any credit" rule for a clear capture with no key is unchanged
  (receipt-triage D4). This feature adds no new stop.
- **The destination is not tied** (fewer than three digits, or no destination
  read). The receiving bank is still read from the receipt and recorded.
  There is simply no account to cross-check it with (D5).
- **A real same-bank payment** (an ISP with an Azteca CLABE, paid from
  Azteca). Both banks are read and kept, and the reading is flagged. The
  payment is legitimate, but Banxico's CEP cannot confirm it, and today it
  ends `expired` without anyone being told. Fixing that is the next step
  (Out of Scope). This feature only makes the case visible and never
  changes what was read.
- **The receiving bank read differs from the bank of the account the digits
  tie to.** One of the two readings is off. It is recorded for the
  comparison and the measurement, and no flow changes because of it.
- **The receipt does not show the receiving bank** (only digits, or only a
  name). The reading says it is not shown, like any other field.
- **A receipt read before this feature.** Its record keeps what it had, and
  shows no model version rather than a guessed one.
- **The same file uploaded twice to the bench.** It is one bench receipt,
  and the second upload offers to read it again rather than duplicating it.
- **The bench in prod.** It works the same way, with prod's list (only
  Mistral at launch). It measures prod's model on real receipts, and nothing
  touches a payer.
- **A bench receipt past its keeping time.** The file is gone. Its readings,
  marks and tally stay, because they hold no image, only what was read.
- **A receipt that is not a receipt,** or an illegible one, on the bench.
  Each model's answer shows as it is ("no es comprobante", "ilegible"), and
  it can be marked like any other field.

## Requirements *(mandatory)*

### Functional Requirements

**The model choice (Story 1)**

- **FR-001**: Each environment MUST have a list of allowed reader models and
  a default model among them, both set by deploy (D1).
- **FR-002**: The platform operator MUST be able to see, in `/operador`, the
  active reader model of the environment, whether it is the default, who
  chose it and when, and the recent history of choices.
- **FR-003**: The platform operator MUST be able to choose any model of the
  environment's list, and only those. The choice applies to every reading
  that starts after it is saved, with no deploy.
- **FR-004**: With no choice made, or when the chosen model is no longer in
  the list, the default model MUST read, and the panel MUST say which of the
  two cases applies.
- **FR-005**: Only the platform operator MAY see or change the choice. Every
  other actor is refused, as for the other operator rules.
- **FR-006**: When the chosen model gives an error or an unusable answer, the
  receipt MUST be read once more by the default model. When the default fails
  too, the file goes to the provider unread, as today (D3).
- **FR-007**: Every reading record MUST name the model that actually read the
  receipt, the version of the questions it answered, how long the reading
  took, and whether it was a fallback.
- **FR-008**: A reused draft reading (two-eyes-receipt D14) MUST keep the
  model and question version of the reading it reuses.

**Reading right (Story 2)**

- **FR-009**: The reader MUST take the clave de rastreo only from a field the
  receipt labels as the clave. A folio, an authorisation or operation number,
  a reference or an account number MUST never be read as the clave (D4).
- **FR-010**: The reader MUST copy the clave character by character. It keeps
  a final letter, and never swaps look-alike characters (D4).
- **FR-011**: The reader MUST take the sending bank only from what the
  receipt says about the sender. The bank printed beside the destination
  account MUST never be read as the sending bank. When the receipt does not
  show the sending bank, the reading MUST say it is not shown (D4).
- **FR-012**: The reader MUST read the receiving bank only from the
  destination's side of the receipt, and the record MUST keep both banks as
  read. Neither bank may be altered or discarded because of the other (D5).
- **FR-012a**: When the sending bank and the receiving bank read are the same
  institution, the reading MUST be flagged as a same-bank pair. The flag
  MUST be recorded and countable, and it changes no other part of the flow
  in this feature (D5).
- **FR-012b**: When the receipt's digits tie to one of the ISP's accounts
  (receipt-triage D24) and the receiving bank read is a different
  institution from that account's bank, the record MUST note the difference
  (D5).
- **FR-013**: The questions MUST be the same for a picture and for a PDF's
  text, apart from legibility, and MUST carry a version label (D2).
- **FR-014**: Every field that reads right today on the test set MUST still
  read right: the reference with its leading zeros, the amount, the date,
  the destination's digits and kind, legibility, and whether the file is a
  receipt at all.

**The test bench (Story 3)**

- **FR-015**: The platform operator MUST be able to upload a receipt, a
  picture or a PDF, to a test bench in `/operador`. Every model in the
  environment's list reads it at once with the current questions (D6).
- **FR-016**: For each bench receipt, the bench MUST show the receipt beside
  each model's reading, field by field: clave, reference, sending bank,
  receiving bank, amount, date, destination, legibility, the same-bank flag,
  and the time the reading took.
- **FR-017**: The operator MUST be able to mark each field of each bench
  reading as right, wrong or "not on the receipt". The mark is kept with the
  model and the question version that produced the reading.
- **FR-018**: The bench MUST add up the marks per model and per question
  version: fields right out of those marked, the most frequent wrong
  fields, and the reading time within which 9 of 10 readings finished. The
  tally at a given date is the reader's measurement (FR-020).
- **FR-019**: The bench MUST create no payment, spend no validation credit,
  make no provider call, and never fall back to another model. Its readings
  MUST count in no payer measurement (D6).
- **FR-020**: The bench MUST keep each uploaded receipt for as long as a
  payment proof is kept. In that time the operator can read it again with the
  current questions, and each reading stays tied to its question version.
  The tally at a given date is what closes `receipt-triage-reader-unmeasured`.
- **FR-021**: Only the platform operator MAY open, upload to or read the
  bench.

### Key Entities

- **Reader model choice**: The active reader model of one environment, who
  chose it and when, and its history. It lives with the other operator
  rules.
- **Allowed model list**: The models one environment may use, and which of
  them is the default. It is set by deploy and cannot be changed from a
  screen.
- **Question version**: A label that names one set of questions asked of the
  reader. It changes whenever the questions change.
- **Reading record** (existing): What one reading of one receipt produced.
  It gains the model that actually read, the question version, the time the
  reading took, whether it was a fallback, the receiving bank as read, the
  same-bank flag, and whether the receiving bank matched the tied account's
  bank.
- **Bench receipt**: A receipt the operator uploaded to the test bench. It
  belongs to no ISP and is kept as long as a payment proof.
- **Bench reading**: What one model read from one bench receipt with one
  question version, how long it took, or that it failed.
- **Field mark**: The operator's verdict on one field of one bench reading:
  right, wrong or not on the receipt.
- **Bench tally**: The marks added up per model and per question version.
  It is the measurement the prod model choice rests on.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the test set (the dev captures of 2026-09-24 and 2026-09-25,
  plus receipts 1 and 2 of receipt-triage), the model chosen for prod, with
  the new questions, reads **zero** folios as a clave and **zero**
  destination banks as the sending bank, and copies **3 of 3** Azteca claves
  exactly. It names the receiving bank right on every receipt that shows it.
  Its sending bank is either right or "not shown", and never wrong.
- **SC-002**: On the same set, no field that read right with today's model
  and questions reads wrong with the chosen ones.
- **SC-003**: Switching the reader model takes one action in `/operador`, and
  the very next reading uses the new model with no deploy. Switching back
  takes the same one action.
- **SC-004**: 100% of readings made after launch name the model that read
  them and their question version.
- **SC-005**: A model becomes active in prod only when, on the test set, it
  meets SC-001 and SC-002, and reads at least 9 of 10 receipts in under 5
  seconds. Today's model was measured at about 2.7 s (proof-extraction D5).
- **SC-006**: Zero payers are left without a reading because of the chosen
  model: every failed answer from it is followed by a reading from the
  default model.
- **SC-007**: 100% of readings whose two banks are the same institution
  carry the same-bank flag. The number of same-bank payments, real or
  misread, can be counted from the records per week and per ISP.
- **SC-008**: The creator can compare two models on ten real receipts,
  marks included, in under 15 minutes, with **zero** payments created,
  **zero** validation credits spent and **zero** payer readings counted.
- **SC-009**: The measurement debt `receipt-triage-reader-unmeasured` is
  closed with the dated result of the comparison.
- **SC-010**: Every new test cites `receipt-reader-tuning US<n>`, and no
  decision citation already in the code is lost.

## Assumptions

- "Gemini 4" in the request means Gemma 4 26B A4B on Workers AI, as the
  creator confirmed (Clarifications). Gemini, GPT and Claude are reachable only through an
  external provider, which would change the constitution's stack table
  (Out of Scope).
- The reader stays on Workers AI. The constitution fixes it there and makes
  the model a configuration value (stack table, VIII). D1 keeps both: the
  list is configuration, and the panel picks from it.
- Each model may need to be asked in its own format. The questions, the
  rules of D4 and the answer shape stay the same across models.
- Cost does not decide the choice. Every candidate costs a fraction of a
  cent per reading (Workers AI pricing, September 2026). What decides is
  accuracy per field and reading time.
- The creator keeps the real receipts on their phone. Dev keeps payment
  proofs for 15 days, so the captures of 2026-09-24 and 2026-09-25 expire
  around 2026-10-09 unless they are kept elsewhere for the test.
- The vision model may recognise the issuing bank from its name or brand on
  the receipt (Azteca's app shows its own logo). That is measured, not
  assumed. When it cannot, "not read" is the correct answer (FR-011).
- The panel follows the existing operator-rule pattern: a typed field, its
  history, and the operator guard (operator-panel D1–D4). The model choice
  and the bench live together in `/operador`. Where exactly they sit is a
  design decision for the plan.
- The bench's readings hold no payer's name: the reader is never asked for
  names. The only personal data on the bench is the uploaded image itself,
  kept as long as a payment proof (15 days) and then deleted.
- The creator marks the fields against the receipt on screen. No Banxico
  answer is needed to mark them, so the bench never spends a credit.

## Out of Scope

Found in the investigation of 2026-09-25 and kept here as the next steps:

- **What happens to a same-bank payment.** Today a pair the engine refuses
  (validation spec D17) rides its schedule to `expired` and nobody is told.
  That covers both the misread and the real case (D5). The candidates, for
  the creator to decide in their own spec: ask the payer to confirm the
  sending bank before any credit, and when they confirm the same bank, hold
  the payment for the ISP's review, since Banxico cannot confirm it.

- Asking the payer for the sending bank **before** the first credit, when a
  clear capture does not show it.
- The night-time date: a receipt dated 24 Sep 23:40 that Banxico records on
  25 Sep, and searches by typed or read data that use the receipt's date.
- Trying the reference when a clave keeps coming back `not_found`, which
  would change receipt-triage D1.
- Models outside Workers AI (Gemini, GPT, Claude through AI Gateway).
- Editing the questions from the panel, a model per business, choosing the
  model automatically, and reading every payer's receipt with two models.
- Any change to the provider's own reading.

## Dependencies

- The operator panel `/operador` and its rule pattern (operator-panel
  D1–D4), with the operator named by deploy (constitution V).
- The reader, its PDF route and its degradation (proof-extraction D5,
  two-eyes-receipt D1, D15); the gate (proof-extraction D4, receipt-triage
  D12); the draft reuse (two-eyes-receipt D14).
- The same-institution rule (validation spec D17) and the destination tie
  (receipt-triage D24).
- Workers AI: Mistral Small 3.1 24B and Gemma 4 26B A4B, both available and
  not scheduled for deprecation on 2026-09-25.
