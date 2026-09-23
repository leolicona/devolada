# Feature Specification: receipt-triage

**Feature Branch**: `claude/payment-receipt-info-handling-bhqn5o`

**Created**: 2026-09-23

**Status**: Draft — scope narrowed by the product creator on 2026-09-23;
ready for `/speckit-plan`

**Input**: User description: "The scope would be summarized in integrating
the additional receiving accounts (16-digit card and 10-digit phone) as new
valid identifiers for the SPEI consultation in Banxico; implement a
preventive UI screen that visually instructs the user on the correct capture
before uploading it; display a clear and contextual feedback indicating which
specific fields are missing or if you should enter the data manually; and
enable the verification of SPIN transfers only when they operate as SPEI/STP
interbank transfers registered in Banxico."

## Clarifications

### Session 2026-09-23

- The first draft of this spec (commit on this branch, same day) carried six
  items: search by tracking key, reference or phone/card; early detection;
  fintech support; a review flow for same-bank and cash payments; fraud and
  cost control; a preventive capture guide. Q: What is in scope? → A: Four
  things only — the card and the phone as receiving identifiers, the
  preventive capture guide, feedback that names the missing fields or sends
  the payer to typing, and Spin verified only when it went through SPEI.
  Everything else is listed under Out of Scope, so it is not lost.
- The three questions the first draft asked (the service while a same-bank or
  cash payment waits, the paid-call cap per receipt, the fee on a hand
  confirmation) belonged to items now out of scope, and are withdrawn.

## Where this comes from

On 2026-09-23 the product creator brought four real receipts that customers
of one ISP sent as proof of payment. Two of them are what this feature is
for:

1. **Banorte, summary screen.** "¡Tu transferencia fue exitosa!", $300.00, to
   BBVA CLABE ****8195, 09/09/2026 18:10:02. A SPEI transfer, clear and
   readable, with no clave de rastreo on screen: the app shows it one tap
   away, behind "Ver más detalles".
2. **Banco Azteca, photographed with a second phone.** $350.00, 09/Sep/2026,
   to "Bbva Mexico ***195". A SPEI transfer with no clave de rastreo on
   screen, photographed through glare and a cracked screen.

Today, read from the code on 2026-09-23: both go to the provider anyway
(two-eyes-receipt D2, D3), because missing fields are not a reason to stop.
The provider finds no clave either. The payer is then asked to "confirm the
clave de rastreo looking at your receipt" — a receipt that does not show it —
and is never told where their bank keeps it. Meanwhile the payment re-sends
the same picture at every retry.

The other two receipts — a BBVA-to-BBVA transfer and two cash deposits — never
touched SPEI. Handling them is out of scope here (see Out of Scope).

## Decisions taken in session (2026-09-23)

Recorded here so the plan and the code can cite them as
`receipt-triage D<n>`.

- **D1 — A debit card and a phone number join the CLABE as receiving
  identifiers.** An ISP may register a 16-digit debit card and a 10-digit
  phone number next to its CLABE, each with its bank. A SPEI transfer to any
  of them is recorded by Banxico, and the provider can check it when told
  which identifier received the money (apiCEP's documented beneficiary types,
  read in session). The CLABE stays required; the card and the phone are
  optional, at most one of each.
- **D2 — The check learns the identifier from the receipt, never by
  guessing.** The destination the receipt shows ties the payment to one
  identifier. When it cannot, the provider's own reading of the capture
  receives every identifier as a candidate, and a payer who types their data
  is asked which one they sent to. A credit is never spent trying identifiers
  one after another.
- **D3 — The payer sees a good capture before taking one.** The "Envía tu
  comprobante" step shows, above the upload button, what the capture must
  include and how to take it. It is part of the step, not a screen in front
  of it: the upload stays one tap away.
- **D4 — Missing fields are named, with where to find them, and typing is
  always offered.** When the payer is asked for something, the page names
  each field that is missing or in doubt — and only those — says where the
  payer's bank shows it when the product knows, and offers typing with
  everything else already filled in. A clear capture that does not show the
  clave de rastreo is asked about *before* any paid call: this narrows
  two-eyes-receipt D2 and FR-005 for that one case. "Missing fields go to the
  provider" stays true when the clave may be hidden under a blur, and stops
  being true when the receipt simply does not print it — the provider cannot
  read what is not there. (Carried from the creator's first input:
  "detect when the image lacks a key before spending credits".)
- **D5 — Spin is verified only as SPEI.** A Spin transfer that went out
  through SPEI is checked against the institution Banxico records for Spin's
  transfers, which may be Spin by OXXO or STP. A movement that stays inside
  Spin, or cash put into Spin, has no Banxico record: it is never sent to the
  provider and costs no credit, and the payer is told to contact their
  provider.

## Summary

Payers send what their bank app shows them, and many apps show a summary
without the clave de rastreo. Today the product pays to learn that, then asks
the payer for a field their capture does not have, without telling them where
to find it.

This feature works on both sides of the upload. Before it, the payer sees
what a good capture looks like. After it, a clear capture with no clave is
caught for free, and the payer is told exactly what is missing, where their
bank shows it, and that they can type it instead.

It also widens what can be checked. An ISP can publish a debit card and a
phone number next to its CLABE, and transfers to them are checked with
Banxico like transfers to the CLABE. And Spin receipts are checked against
the institution Banxico actually records — when, and only when, the Spin
movement went through SPEI.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The payer is told exactly what is missing, and how to fix it (Priority: P1)

A payer uploads the summary screen of their bank app. It is clear, and it
does not show the clave de rastreo. Before anything is spent, the page says
so: "Tu captura no muestra la clave de rastreo." If the product knows the
bank, it says where the clave is ("En Banorte, toca *Ver más detalles* y
captura esa pantalla"). The payer can upload that screen, or type the clave
with the amount, date and bank already filled in. The same kind of message
appears whenever the product later needs a field from the payer: it names the
field and says where to find it.

**Why this priority**: it fixes the most common gap in the receipts at hand,
it stops a credit being spent to learn nothing, and it replaces a question
the payer cannot answer with one they can.

**Independent Test**: upload, against a stubbed reader and an intercepted
provider, a clear SPEI capture with no clave from a bank with a hint, one
from a bank without a hint, a partly legible one, and one with a clave. Count
the credits spent and read the payer's screen in each case. Then upload a
second capture without a clave for the same payment and read the screen
again. Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** a capture the reader calls fully legible, a SPEI receipt, with no
   clave de rastreo, **When** the payer uploads it, **Then** no credit is
   spent, and the page says that the clave de rastreo is missing, with two
   ways forward: upload another capture, or type the data.
2. **Given** that capture, and the reader recognises a bank the product holds
   a hint for, **When** the payer sees the message, **Then** it says where
   that bank's app shows the clave.
3. **Given** a bank the product holds no hint for, **When** the payer sees
   the message, **Then** it gives the generic hint: open the detail of the
   transfer in the app and capture the screen that shows the clave de
   rastreo.
4. **Given** the payer chooses to type, **When** the form opens, **Then** the
   amount, date and bank the capture showed are filled in, and only the
   missing field is asked for.
5. **Given** a second capture for the same payment that still does not show
   the clave, **When** it is uploaded, **Then** the page leads with typing:
   the form comes first, with another capture as the second option.
6. **Given** a check that later needs a field from the payer — a field in
   dispute or missing after the provider's reading (two-eyes-receipt D8, plan
   D20) — **When** the page asks, **Then** it names each field in doubt, and
   only those, with where the payer's bank shows it when known, and offers
   typing with the rest filled in.
7. **Given** a capture the reader calls partly legible, with no clave read,
   **When** the payer submits it, **Then** it goes to the provider as today:
   the clave may be under the blur (two-eyes-receipt D2 stands for this
   case).
8. **Given** the reader is down, or its answer cannot be parsed, **When** the
   payer uploads, **Then** nothing is asked and the file follows today's flow
   (constitution VIII).
9. **Given** a text PDF whose text shows no clave, **When** it is uploaded,
   **Then** it is handled exactly like a picture (two-eyes-receipt D1); a
   scanned PDF with no text follows today's silent path to the provider.

---

### User Story 2 - The payer sees what a good capture shows before taking it (Priority: P2)

On the "Envía tu comprobante" step, above the upload button, the payer sees a
small picture of a receipt with the fields that matter marked — the clave de
rastreo first, then the amount, the date and the account the money went to —
and three short rules: capture the transfer's detail, not the summary; the
whole screen, without cropping; and if it is a photo, without glare. Tips for
the common banks are one tap away.

**Why this priority**: it prevents what Story 1 repairs, at no cost per
payment. It ranks below Story 1 because some payers will still send the
summary screen, so the repair must exist first.

**Independent Test**: render the step at 360px, 768px and 1280px in both
themes; check the visual, the rules and the tips, and that the upload button
is one tap from the start of the step. Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** the upload step, **When** it renders, **Then** above the upload
   button it shows a visual of a receipt with the clave de rastreo, the
   amount, the date and the destination account marked, and says in text what
   the capture must include.
2. **Given** the visual, **When** it renders at 360px in either theme,
   **Then** it is legible, it causes no horizontal scroll, and no field is
   marked by colour alone.
3. **Given** the step, **When** it renders, **Then** it shows the three rules:
   the detail, not the summary; the whole screen; a photo without glare.
4. **Given** a payer who wants to know where their bank shows the clave,
   **When** they open the tips, **Then** they reach the common banks in one
   tap, with the same hints Story 1 uses.
5. **Given** the visual, the rules and the tips, **When** the step renders,
   **Then** the upload button is still one tap from the start of the step;
   nothing is placed in front of it.

---

### User Story 3 - An ISP can be paid at a debit card or a phone number as well as its CLABE (Priority: P2)

An ISP adds its debit card and its phone number in Cuenta, next to the CLABE
it already has. The payment page shows all three. A payer who transfers to
the card or to the phone is checked with Banxico exactly like a payer who
transfers to the CLABE, because the check names the identifier the money went
to.

**Why this priority**: many small ISPs already tell customers "transfiere a
mi tarjeta" or share a number for transfers; today those payments cannot be
checked at all. It ranks with Story 2 and not above Story 1 because it is
larger — the ISP's setup, the page and the check all change — and serves
fewer payers at first.

**Independent Test**: configure an ISP with a CLABE, a card and a phone at an
intercepted provider; submit a receipt to each and check the identifier each
search names; submit a receipt whose destination cannot be read, and a typed
submission; submit a clear receipt to an account that is none of the three.
Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** an ISP with only a CLABE, **When** this feature ships, **Then**
   nothing changes for it or its payers.
2. **Given** an ISP member who may configure the business, **When** they open
   Cuenta, **Then** they can add, change or remove one debit card (16 digits)
   and one phone number (10 digits), each with its bank; the CLABE stays
   required.
3. **Given** a card number with the wrong length or a failing check digit, or
   a phone number that is not 10 digits, **When** it is saved, **Then** it is
   refused with a message that names the problem.
4. **Given** an ISP with a card or a phone, **When** the payment page renders,
   **Then** it shows the CLABE and, labelled and copyable, the card and the
   phone.
5. **Given** a receipt whose destination the reader ties to the card, the
   phone or the CLABE, **When** it is checked, **Then** the search names that
   identifier.
6. **Given** a receipt whose destination cannot be tied to one identifier,
   **When** the provider reads the capture, **Then** it receives every
   identifier of the ISP as a candidate.
7. **Given** a payer who types their data and an ISP with more than one
   identifier, **When** they fill the form, **Then** they choose which one
   they sent to, shown masked.
8. **Given** a fully legible receipt whose destination matches none of the
   ISP's identifiers, **When** it is uploaded, **Then** no credit is spent and
   the payer is told the transfer went to a different account. Digits the
   receipt masks are not a mismatch.
9. **Given** an identifier changed or removed, **When** a payment already
   submitted to it is checked, **Then** it is checked against the identifier
   it was sent to.

---

### User Story 4 - Spin transfers are verified when, and only when, they went through SPEI (Priority: P3)

A payer sends a receipt from Spin by OXXO. When the transfer left Spin through
SPEI, the check asks Banxico with the institution Banxico records for Spin's
transfers — which may not be the name printed on the receipt. When the
movement stayed inside Spin, or was cash put into Spin, Banxico has no record
of it: the product spends nothing and tells the payer to contact their
provider.

**Why this priority**: a wrong sending bank is answered by the provider with
the same faceless "not found" a missing transfer gets (measured 2026-08-19,
validation.spec.md D12), so every Spin payment sent under the wrong name is
lost silently, at a credit each. It ranks P3 because the institution Banxico
records must be measured on real Spin receipts first.

**Independent Test**: submit, against a stubbed reader and an intercepted
provider, a Spin SPEI receipt, a Spin receipt of a movement inside Spin, and
a Spin cash-in; check the institution the first search names and the credits
spent. Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** a Spin receipt of a SPEI transfer, **When** it is checked,
   **Then** the search names the institution Banxico records for Spin's SPEI
   transfers.
2. **Given** a Spin receipt for which that institution is not established,
   **When** it is checked, **Then** no institution is guessed for a paid
   search; the first call is the provider's own reading of the capture, as
   today.
3. **Given** a Spin receipt of a movement inside Spin, or of cash put into
   Spin, **When** it is uploaded, **Then** it is not sent to the provider, no
   credit is spent, and the payer is told in es-MX that Banxico does not
   record this kind of Spin movement and to contact their provider with the
   receipt.
4. **Given** a confirmed Spin payment, **When** its record is read, **Then**
   it shows the name printed on the receipt and the institution Banxico
   returned.
5. **Given** a Spin receipt that does not show the clave, **When** it is
   uploaded, **Then** Story 1 applies unchanged.

---

### Edge Cases

- **A receipt that prints a clave de rastreo but looks like a movement inside
  Spin.** A clave on the receipt means Banxico may have it: the SPEI road
  wins.
- **The ISP registers a Spin card or phone as an identifier.** A payer
  sending from Spin to it moves money inside Spin: Story 4, scenario 3.
- **A transfer to the ISP's card or phone from the same bank.** It never goes
  through SPEI, so Banxico has no record of it. This feature does not change
  what happens to it (Out of Scope: same-bank and cash payments).
- **A receipt that shows a referencia numérica and no clave** (receipt 2's
  kind). The reference is not used here (Out of Scope); the payer is asked
  for the clave as in Story 1.
- **The bank the reader recognises is not the bank that sent the money** (a
  fintech inside a bank's app). The hint may point to the wrong app; typing is
  always one tap away.
- **A card that is a credit card.** It cannot be told apart by its digits. The
  setup labels the field "tarjeta de débito" and says that the card must
  receive transfers; the ISP answers for it.
- **A payment born before this feature, validating at cut-over.** It finishes
  under the flow it started in.

## Requirements *(mandatory)*

### Functional Requirements

**Saying what is missing (Story 1, D4)**

- **FR-001**: A capture the reader calls fully legible, a SPEI receipt, that
  shows no clave de rastreo MUST NOT reach a paid call; the payer MUST be told
  on the same screen that the clave de rastreo is missing.
- **FR-002**: Whenever the payer is asked for data — at the upload (FR-001) or
  later in the check (two-eyes-receipt D8, plan D20) — the page MUST name each
  field that is missing or in doubt, and only those.
- **FR-003**: When the reader recognises the bank or app and a hint exists
  for it, the message MUST say where that app shows the field; otherwise it
  MUST give the generic hint.
- **FR-004**: The message MUST offer two ways forward: another capture, or
  typing. The typing form MUST be filled in with what the capture showed and
  MUST ask only for the fields named.
- **FR-005**: When a second capture for the same payment still does not show
  the clave de rastreo, the page MUST lead with typing.
- **FR-006**: A partly legible capture with no clave read MUST still go to the
  provider (two-eyes-receipt D2). When the reader is down, its answer cannot
  be parsed, or a PDF yields no text, nothing is asked and the file MUST
  follow today's flow.

**Before the upload (Story 2, D3)**

- **FR-007**: The upload step MUST show, above the upload button, a visual of
  a receipt marking the clave de rastreo, the amount, the date and the
  destination account, with text saying what the capture must include.
- **FR-008**: The visual MUST be legible at 360px in both themes, cause no
  horizontal scroll, and mark no field by colour alone.
- **FR-009**: The step MUST show three rules: the detail, not the summary; the
  whole screen; a photo without glare.
- **FR-010**: Tips for the common banks MUST be one tap away, and MUST come
  from the same hints as FR-003.
- **FR-011**: Nothing this story adds may stand in front of the upload button:
  it stays one tap from the start of the step.

**Card and phone (Story 3, D1, D2)**

- **FR-012**: A member who may configure the business MUST be able to add,
  change or remove one debit card (16 digits, passing the card check digit)
  and one phone number (10 digits), each with a bank from the provider's
  vocabulary. The CLABE MUST stay required for the channel.
- **FR-013**: The payment page MUST show the CLABE and, when registered, the
  card and the phone, each labelled and copyable. An ISP with only a CLABE
  MUST see no change on its page.
- **FR-014**: A search MUST name the identifier the receipt shows as
  destination.
- **FR-015**: When the destination cannot be tied to one identifier, the
  provider's reading of the capture MUST receive every identifier of the ISP
  as a candidate, and a typed submission MUST ask the payer which identifier
  they sent to, shown masked.
- **FR-016**: A fully legible receipt whose destination matches none of the
  ISP's identifiers MUST be refused before any credit, telling the payer the
  transfer went to a different account. Masked digits MUST NOT count as a
  mismatch.
- **FR-017**: Changing or removing an identifier MUST NOT change the
  identifier a submitted payment is checked against.

**Spin (Story 4, D5)**

- **FR-018**: A Spin receipt of a SPEI transfer MUST be searched with the
  institution Banxico records for Spin's SPEI transfers, never with the name
  printed when the two differ.
- **FR-019**: When that institution is not established for the receipt, no
  institution MUST be guessed for a paid search; the first call MUST be the
  provider's own reading of the capture.
- **FR-020**: A Spin movement that stayed inside Spin, or cash put into Spin,
  MUST NOT be sent to the provider and MUST spend no credit; the payer MUST be
  told in es-MX that Banxico does not record it and to contact their provider
  with the receipt.
- **FR-021**: A confirmed Spin payment MUST record the name printed on the
  receipt and the institution Banxico returned.

**Across the feature**

- **FR-022**: Payments validating at cut-over MUST finish under the flow they
  started in.
- **FR-023**: The product MUST make countable from its records, with no
  further instrumentation: captures stopped for a missing clave, by bank;
  asks by field and how they ended (new capture, typing, abandoned);
  payments by the identifier that received them; destinations that matched
  no identifier; Spin receipts by kind (SPEI, inside Spin, cash).
- **FR-024**: Nothing else changes: what a Banxico verdict means, the fee,
  partial settlement, the schedule, the platform's top-ups, and the fields of
  the manual door apart from the identifier choice (FR-015).

### Key Entities

- **Receiving identifier**: where a business is paid — its CLABE (required),
  and optionally one debit card and one phone number — each with its bank. A
  payment remembers the identifier it was sent to.
- **Ask**: a request to the payer for data, with the fields it names and how
  it ended.
- **Bank hint**: for a bank or app, where it shows the clave de rastreo and
  what to tap, with the receipt or document it was verified against; es-MX
  copy kept by hand, used by the ask and by the tips.
- **Spin classification**: whether a Spin receipt is a SPEI transfer, a
  movement inside Spin, or cash put into Spin.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A clear SPEI capture that shows no clave spends zero credits,
  and the payer learns what is missing within the same interaction.
- **SC-002**: When the payer is asked, the number of fields asked is exactly
  the number missing or in doubt — never the whole form.
- **SC-003**: For every bank on the hint list, a payer asked for the clave is
  told where that bank's app shows it, and every entry on the list names the
  real receipt or the bank's own documentation it was verified against. At
  launch the list holds every bank whose detail screen has been seen that way
  (amended 2026-09-23, research R9: production has no confirmed payments yet,
  so "every bank in the product's confirmed payments" could not be measured).
- **SC-004**: The share of payers who, once asked, send a new capture or type
  the data — rather than abandon — can be read from the records, so the ask
  can be judged on numbers.
- **SC-005**: A transfer to an ISP's card or phone that Banxico has published
  is confirmed with the same number of paid calls as a transfer to its CLABE.
- **SC-006**: A clear receipt whose destination matches none of the ISP's
  identifiers spends zero credits.
- **SC-007**: A Spin movement that did not go through SPEI spends zero
  credits.
- **SC-008**: On the upload step, the upload button is one tap from the start
  of the step, and the page has no horizontal scroll at 360, 768 and 1280px in
  either theme.
- **SC-009**: An ISP with only a CLABE sees no change in its setup, and its
  payers see no change on the transfer step.
- **SC-010**: For every outcome that exists today, a receipt that shows its
  clave and was sent to the CLABE ends in the same status with the same words
  as today.
- **SC-011**: Every new test carries its story citation (`receipt-triage
  US<n>`), and the count of decision citations lost in the change is zero.

## Assumptions

- **apiCEP accepts a debit card and a phone as the receiving identifier**, and
  a list of candidates when it reads the picture. Documented by the provider
  and read in session on 2026-09-23; never measured by us. Whether its answer
  says which candidate matched is unknown; the plan MUST find out, because a
  later retry that types the data needs to name one identifier.
- **The ISP's phone number receives transfers** — it is registered with its
  bank for transfers to a phone — and its card is a debit card that receives
  SPEI. The setup says so; the ISP answers for it.
- **The institution Banxico records for Spin's SPEI transfers** depends on
  the payer's own account: Spin is a SPEI participant in its own right (code
  90728, `SPIN BY OXXO`), and accounts not yet moved send through STP (90646).
  So FR-018 applies only when the receipt shows which of the two the origin
  account belongs to; otherwise FR-019 applies (amended 2026-09-23, research
  R8, from public sources on Spin's direct connection to SPEI).
- **The reader can read the destination** (its kind and the digits shown)
  **and tell a Spin SPEI transfer from a movement inside Spin.** Both MUST be
  measured on real receipts at plan time; when the reader cannot tell, the
  receipt takes today's flow.
- **"Clear" is the reader's own "fully legible"** (two-eyes-receipt D2): a
  field the bank did not print is not a legibility problem.
- **The bank hints are kept by hand**, as es-MX copy, and an entry is added
  only from a real receipt or the bank's own documentation. The first entry is
  Banorte, from receipt 1 (amended 2026-09-23, research R9).
- **The capture guide is part of the existing step**, not a screen of its
  own (D3), so that no payer takes an extra tap to reach the upload.
- **One card and one phone per business.** More identifiers, or a second
  CLABE, are out of scope.

## Out of Scope

Narrowed on 2026-09-23 (Clarifications). Kept here so none of it is lost:

- Searching Banxico by the referencia numérica.
- Same-bank transfers and cash deposits: sorting them, keeping them away from
  Banxico, and a review flow for the ISP in the panel (receipts 3 and 4). They
  keep today's flow.
- Keeping Banxico's clave for every key, flags for a capture used twice, and a
  cap on the paid calls a receipt can buy.
- A second CLABE, more than one card or phone, and steering payers to an
  account at another bank.
- Fintechs other than Spin by OXXO.
- A reference assigned by the page to each customer.
- Reading the ISP's own bank movements.

## Dependencies

- The provider (apiCEP): the card and phone receiving identifiers, and the
  candidate list when it reads a picture.
- The two-eyes flow (two-eyes-receipt D1–D3, D8 and plan D20), which this
  feature narrows in one case (D4) and whose asks it rewords.
- The provider's bank vocabulary, which already names both SPIN BY OXXO and
  STP.
- The Cuenta settings where the CLABE is configured today, and the role
  allowed to change them.
- The receipt reader and its PDF text route (two-eyes-receipt D1, D2).
