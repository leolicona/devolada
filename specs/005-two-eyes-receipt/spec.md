# Feature Specification: two-eyes-receipt

**Feature Branch**: `claude/pdf-vision-model-support-bv03j5`

**Created**: 2026-09-17

**Status**: Draft — decisions confirmed by the product creator in session, ready for `/speckit-plan`

**Input**: User description: "PDFs cannot be read by vision models in the first step, so they skip the generation of the initial draft and delegate their extraction directly to the provider's OCR later in the flow. Think of simple solutions so that the PDF flow goes through the validations of an image." — widened in the same session: direct consultation and image consultation cost the same credit, so the first paid call should carry both readings and contrast them on the clave de rastreo and the amount, with the shape rules as the tiebreaker and the payer asked only for the field actually in doubt.

## Clarifications

### Session 2026-09-17

- Q: How does a PDF get the edge reading — text extracted at the edge, or
  the PDF rendered to a picture on the payer's phone? → A: Text at the edge
  (Option A). The payer's page stays lightweight on a phone, and the reading
  reuses the reader that already exists instead of adding a rendering
  library or a rendering service. (D1, FR-001, US3)
- Q: What happens to a scanned PDF that yields no text? → A: It falls through
  to the provider's own reading silently. The payer is not asked for
  anything and sees no difference; the provider reads the file as it does
  today. Payer friction is the cost being avoided. (D1, FR-002, US3
  scenario 3)

### Amended 2026-09-18

- After `/speckit-analyze` (findings U1, C1, D1, U3): the "no date on
  either side" edge case now names its mechanism — the date is asked for as
  a disputed field on its own, while agreement stands (plan D20); US1
  scenario 11 says the classification is *recorded on the payment and its
  reading record*, not shown in the back office (no screen shows it today
  and this feature adds none, as Out of Scope already said); FR-016 is
  worded as the capability FR-011 relies on; the Assumptions say what
  happens to a refused top-up.

### Amended 2026-09-23

- D2 and FR-005 are narrowed by `receipt-triage D4` (specs/010-receipt-triage):
  a receipt the reader calls fully legible, a SPEI receipt, that prints
  neither a clave de rastreo nor a referencia numérica is stopped before the
  first paid call and the payer is asked. "Missing fields go to the provider"
  still holds for a partly legible receipt, a malformed clave, and a picture
  whose legibility the model omitted (receipt-triage D16, amended 2026-09-24
  when the reference joined the scope).
- Amended 2026-09-25, with the implementation: `receipt-triage D15/D24` add a
  second stop of the same kind — a clear receipt whose destination's last
  visible digits fit none of the ISP's registered accounts is stopped before
  the first paid call (`RECEIPT_WRONG_DESTINATION`). The numbers above did not
  move.

## Decisions taken in session (2026-09-17)

Recorded here so the plan and the code can cite them as `two-eyes-receipt D<n>`.

- **D1 — PDFs are read at the edge, as text.** A PDF is turned into text
  inside the product with the model binding the reader already uses, and
  the text is read by the same reader with a text variant of its prompt. The
  result goes through the same gate, the same shape rules, the same draft and
  the same flow as an image. Nothing new is installed. A scanned PDF with no
  text yields an empty reading on our side and follows the flow like an image
  our reader could not read, silently: no question to the payer, no visible
  difference. Rendering the PDF to a picture, on the payer's phone or at the
  edge, was considered and set aside: it adds a heavy library to a
  mobile-first page, or a paid rendering service, for the same outcome, and
  it would not reuse the reader pipeline that already exists. Confirmed by
  the product creator as "Option A".
- **D2 — The reader judges legibility, and only two verdicts block.** The
  reader says whether the file is a receipt, and whether it is fully legible,
  partly legible, or not legible at all. "Not a receipt" and "not legible at
  all" stop before any credit is spent and ask the payer for a clearer
  picture. Everything else goes on to the provider: partly blurry, missing
  fields, a reading the product could not parse, or a reader that is down.
- **D3 — The first paid call is the provider's own reading of the file.** The
  file goes to the provider's image door first, with our reading kept beside
  it for contrast. Both doors cost the same credit, so the first call buys a
  verdict *and* an independent second reading. Today the first call goes to
  the transfer door with our reading, and the provider's reading arrives only
  on a second call after a "not found".
- **D4 — The pay request never waits on the paid call.** The payer sees
  "verificando" at once; the first paid call runs after the answer is given,
  and the page keeps polling as it does today.
- **D5 — After "not found", the two readings are compared on clave and
  amount, at minute zero.** The comparison counts only fields where our
  reading passed the gate. The outcome is recorded on the payment as agreed,
  disputed or blind, the same three words the minute-two cross uses today.
- **D6 — Agreement stops the spending.** Two independent readers giving the
  same clave and the same amount is evidence the data is right and the
  transfer has not settled. No further credit is spent now; the deferred
  retries follow the existing schedule and go through the transfer door with
  the agreed structured data, never the picture again. Agreement is
  minute-zero evidence for the page's clock and for provisional release.
- **D7 — The shape rules judge both claves and break the tie.** When the two
  readings disagree, the bank's learned clave shape decides: if ours fits and
  the provider's does not, the next attempt sends ours through the transfer
  door; if the provider's fits and ours does not, the provider's reading is
  accepted as "awaiting settlement" and the deferred retries carry it, with no
  question to the payer. Until now the rules judged only our reading or the
  payer's typed clave.
- **D8 — The payer is asked only when the machines cannot decide, and only
  for the field in doubt.** No rule for the bank yet, or both claves fit, or
  neither: no further credit is spent and the payer is asked to fill in the
  disputed or missing fields. The attempt that follows carries the payer's
  data through the transfer door with no further contrast. In the early
  weeks most disputes will have no tiebreaker and go to the payer; that is
  the intended behaviour, not a defect.
- **D9 — The second attempt is never immediate.** When one side was blind
  and the other has complete data, or the shape rules favoured our clave, the
  transfer-door attempt rides the schedule's next slot. A retry fired in the
  same second would burn a credit against the same settlement latency.
- **D10 — The numbers this feature exists to reveal are counted from day
  one.** How often the two readings agree, dispute or leave one side blind on
  the first call, and how often the provider is blind on a receipt our reader
  read in full. There are no live numbers today.

## Summary

Today a payer uploads a picture of their SPEI receipt. The product reads it
at the edge, checks the fields, shows the payer a draft, and spends the first
provider credit on the transfer door with that reading. Only when Banxico
answers "not found" does a second credit send the picture to the provider's
own reader and compare the two readings. A PDF skips the edge reading
altogether: no draft, no field check, straight to the provider's reader, on
every attempt.

Both provider doors cost the same. So the second reading, which today costs a
second credit and arrives a minute late, can ride the first call for free.
This feature turns the order around: the file goes to the provider first, our
reading rides along, and when Banxico has nothing yet the two readings are
compared on the spot. If they agree, the data is right and the transfer has
not settled: the product stops spending and waits. If they disagree, the
bank's learned clave shape picks the winner. Only when nothing can decide is
the payer asked, and only for the field in doubt.

PDFs join the same flow. The product turns the PDF into text at the edge and
reads the text with the same reader, so a PDF receipt gets the same draft, the
same gate and the same protections as a picture.

And the gate learns to tell a bad photo from a bad receipt: a picture that is
not a receipt, or cannot be read at all, is stopped before any credit is
spent and the payer is asked for a clearer one. A picture that is merely
imperfect goes through, because the provider may read what we could not, and
the comparison catches what either side got wrong.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The first paid call carries two readings (Priority: P1)

A payer uploads a receipt. The product reads it, keeps the reading, and sends
the file to the provider's own reader as the first paid call. If Banxico
confirms the transfer, the payment is confirmed at once, as today. If Banxico
has nothing yet, the product compares what the provider read with what it
read itself, on the clave and on the amount. Two readers agreeing means the
data is right and the transfer has not settled: the product stops spending
and waits for the schedule. Two readers disagreeing means one of them is
wrong, and the bank's learned clave shape says which. The payer is asked only
when nothing can decide, and only for the field in doubt.

**Why this priority**: it is the feature. Every wrong reading, on either
side, is caught on the first paid call instead of the second; every agreed
reading stops spending a minute earlier; and the same first call is what
gives a PDF its second opinion.

**Independent Test**: submit a receipt image against an intercepted provider
and a stubbed reader, and walk the first call through every verdict: found,
pending, contradicted, not found with the readings agreeing, disagreeing with
a rule that favours ours, disagreeing with a rule that favours theirs,
disagreeing with no rule, provider blind, our side blind. Count the credits
spent and the questions asked in each case. Needs nothing from the other
stories.

**Acceptance Scenarios**:

1. **Given** a receipt image our reader read in full, **When** the payer
   submits it, **Then** the first paid call sends the file to the provider's
   reader, and the payment's record shows which door read it.
2. **Given** the provider confirms the transfer on that first call, **When**
   the verdict arrives, **Then** the payment is confirmed exactly as today: the
   amount and date that decide money come from Banxico's record, and the
   too-small and above-debt rules apply unchanged.
3. **Given** the provider says "pending", **When** the verdict arrives,
   **Then** the payment rides the schedule as today, with the same evidence
   for the page's clock and for provisional release.
4. **Given** the provider says the transfer was returned or otherwise
   contradicted, **When** the verdict arrives, **Then** the payment ends as
   today, and no second reading changes that.
5. **Given** "not found" and the provider's reading matches ours on clave and
   amount, **When** the verdict is processed, **Then** the payment is marked
   agreed at minute zero, no further credit is spent in that minute, and the
   retries that follow go through the transfer door with the agreed data.
6. **Given** "not found" and the readings disagree, with a learned shape for
   that bank that our clave fits and the provider's does not, **When** the
   verdict is processed, **Then** the payment is marked disputed, the payer is
   not asked, and the next scheduled attempt sends our data through the
   transfer door.
7. **Given** "not found" and the readings disagree, with a learned shape that
   the provider's clave fits and ours does not, **When** the verdict is
   processed, **Then** the provider's reading is accepted, the payer is not
   asked, and the retries carry the provider's data through the transfer
   door.
8. **Given** "not found" and the readings disagree, with no learned shape for
   that bank, or a shape that both or neither clave fits, **When** the
   verdict is processed, **Then** no further credit is spent and the payer is
   asked to fill in only the disputed fields; the attempt that follows carries
   the payer's data through the transfer door with no further contrast.
9. **Given** "not found" and the provider read no clave at all, while our
   reading is complete and passed the gate, **When** the verdict is processed,
   **Then** the payment is marked blind, the payer is not asked, and the next
   scheduled attempt sends our data through the transfer door.
10. **Given** "not found", the provider read no clave, and our reading is
    incomplete too, **When** the verdict is processed, **Then** no further
    credit is spent and the payer is asked for the missing fields.
11. **Given** a payment marked agreed, disputed or blind, **When** its
    record is read, **Then** the classification, the side that was blind,
    where the accepted data came from and the door that read the file are
    recorded on the payment and on its reading record — as the minute-two
    cross is recorded today. No screen shows them; that is a feature of its
    own (Out of Scope).
12. **Given** a payer who types their transfer data with no picture, **When**
    they submit, **Then** the flow is exactly today's: transfer door, no
    contrast, no second reading.

---

### User Story 2 - A bad photo never costs a credit, an imperfect one goes through (Priority: P2)

A payer uploads a picture. If it is not a receipt at all, or is so blurry
that nothing on it can be read, the product stops before spending anything
and asks for a clearer picture. If it is a receipt with a smudge over one
field, or a reading the product could not fully make out, it goes through to
the provider: the provider may read what we could not, and the comparison in
Story 1 catches what either side got wrong.

**Why this priority**: the gate is what keeps the first call from being
wasted. Measured on 2026-08-19, a screenshot of nothing sent to the provider
came back as a retryable error and rode the whole six-hour schedule at up to
seven paid calls. Blocking too much, on the other hand, sends payers away for
a photo the provider could have read.

**Independent Test**: upload a picture the stubbed reader calls "not a
receipt", one it calls "not legible", one it calls "partly legible", and one
it cannot parse at all; count the credits spent and the questions asked for
each. Needs nothing from the other stories.

**Acceptance Scenarios**:

1. **Given** a picture the reader says is not a receipt, **When** the payer
   uploads it, **Then** no credit is spent, the refusal is logged, and the
   payer is asked for a picture of the receipt.
2. **Given** a receipt the reader says cannot be read at all, **When** the
   payer uploads it, **Then** no credit is spent, the refusal is logged, and
   the payer is asked for a clearer picture.
3. **Given** a receipt the reader says is partly legible, with one field it
   could not read, **When** the payer submits it, **Then** the file goes to the
   provider as in Story 1, with our partial reading kept for contrast on the
   fields we did read.
4. **Given** a receipt whose reading the product could not parse, or a reader
   that is down, **When** the payer submits it, **Then** the file goes to the
   provider with an empty reading on our side; nothing blocks, and the
   provider's verdict stands alone.
5. **Given** an upload that was refused for legibility, **When** the payer
   uploads again, **Then** the upload budget counts it as today; the refusal
   never counts as a paid attempt.

---

### User Story 3 - A PDF receipt gets the same reading and the same protections as a picture (Priority: P2)

Several Mexican banks hand out the comprobante as a PDF. Today that PDF skips
every protection a picture gets: no draft for the payer to check, no field
gate, no shape rule, no comparison. With this story the product reads the PDF
at the edge like a picture, and the PDF joins Story 1 and Story 2 with no
exception.

**Why this priority**: it is the request that started this feature, and it
is what makes the flow one flow instead of two. It ranks with Story 2 because
without Story 1 it delivers a draft and a gate but not the second opinion.

**Independent Test**: upload a text PDF receipt and a scanned PDF with no
text against a stubbed reader and an intercepted provider; compare every step
with the same receipt uploaded as a picture. Needs nothing from the other
stories.

**Acceptance Scenarios**:

1. **Given** a PDF receipt with readable text, **When** the payer uploads it,
   **Then** the payer sees the same draft they would see for a picture, with
   the clave, bank, amount and date read at the edge, and no credit is spent
   for the reading.
2. **Given** that PDF, **When** the payer submits it, **Then** it follows
   Story 1 exactly: provider first, contrast on "not found", shape rules,
   payer asked only when nothing can decide.
3. **Given** a scanned PDF that contains no text, **When** the payer submits
   it, **Then** it goes to the provider with an empty reading on our side, as
   a picture our reader could not read does in Story 2.
4. **Given** a file that is a PDF regardless of the type the upload claimed,
   **When** it is read, **Then** it takes the PDF route: routing still follows
   what the file is, never what it says it is.
5. **Given** a platform top-up submitted with a PDF receipt, **When** it is
   validated, **Then** it follows the same flow under the platform's own
   attribution.
6. **Given** a PDF over the size ceiling, or a file that is neither an image
   nor a PDF, **When** it is uploaded, **Then** it is refused as today.

---

### User Story 4 - The payer never waits on the paid call (Priority: P3)

A payer submits their receipt and sees "verificando" at once. The first paid
call happens after that answer, and the page learns the outcome the way it
already does: by asking again.

**Why this priority**: the provider's reading takes seconds, and the payer is
standing on a phone in a bank app's shadow. The wait is the same seconds it
was; what changes is that the payer's screen does not hold on it.

**Independent Test**: submit a receipt against a provider intercepted to
answer slowly, and measure when the page shows "verificando" against when the
provider answers. Needs Story 1 only for the door the first call takes.

**Acceptance Scenarios**:

1. **Given** a receipt submitted, **When** the answer returns, **Then** the
   payment is "validating" and the answer did not wait for the provider.
2. **Given** the first call finishes after the answer was given, **When** the
   page asks again, **Then** it sees the outcome of that call: confirmed,
   still validating with its classification, or asked for a field.
3. **Given** the first call fails to run at all after the answer was given,
   **When** the schedule's next slot comes, **Then** the attempt runs there:
   a payment is never lost between the answer and the call.

---

### User Story 5 - The numbers become visible (Priority: P4)

The person running the platform can see, from day one, how often the two
readings agree, dispute or leave one side blind on the first call, and how
often the provider is blind on a receipt our reader read in full. These are
the numbers that say whether provider-first saves credits or spends them,
and today nobody has them.

**Why this priority**: the order of the doors was decided on a prior
measurement of thirty claves and one receipt. The decision can only be kept
or reversed on numbers, and the flow must produce them without anyone
adding instrumentation later.

**Independent Test**: run the scenarios of Story 1 and Story 2 and read the
counts back from the product's own records; every outcome that spent or saved
a credit is countable. Needs Story 1.

**Acceptance Scenarios**:

1. **Given** a set of first calls with mixed outcomes, **When** the record is
   read, **Then** the count of agreed, disputed and blind classifications on
   first calls is available, apart from the minute-two crosses of payments
   born before this feature.
2. **Given** a receipt our reader read in full and the provider read no clave
   from, **When** the record is read, **Then** that case is countable on its
   own.
3. **Given** a reading refused for legibility, **When** the record is read,
   **Then** the refusal and its reason are countable, and the count of credits
   it spent is zero.

---

### Edge Cases

- **The reader is down when the payer uploads.** No draft; the file goes to
  the provider with an empty reading on our side, and the provider's verdict
  stands alone. On "not found", the provider's reading is judged by the shape
  rules by itself: a mismatch asks the payer; a fit, or no rule, lets the
  provider's reading stand and ride the schedule through the transfer door.
  Nothing blocks on the reader being absent (constitution VIII).
- **Our reading has a date, the provider's does not, or neither has one.**
  The provider's image door needs no date, so the first call is unaffected.
  The transfer door does need one: the retries carry the date from whichever
  reading has it. When neither does, the date joins the fields the payer is
  asked for, on its own — the agreement or the accepted clave stands, the
  clock and the release keep their evidence, and the page asks for the one
  missing field. The transfer door is never called with a date nobody read,
  and today's date is never used silently (amended 2026-09-18, plan D20).
- **Our reading's amount is above the debt.** The confirmation screen still
  comes first, before any credit is spent, exactly as today. The provider
  first call happens after the payer confirms.
- **Our reading's amount is below the debt.** A short reading is a valid
  submission today and stays one: the provider's first call searches with the
  amount the provider reads off the receipt, and a partial lands as a partial.
- **The first call confirms with a different clave than ours.** Banxico's
  record is the truth: the payment confirms, and the disagreement is recorded
  as a reading our side got wrong. That is a free measurement of the reader.
- **The provider's replay flag after a provider-first call.** The first call
  validates the record under the provider's reading; a later transfer-door
  retry with the same clave must be treated as this payment's own retry, not
  as a stranger's replay. The carve-out that exists today for retries applies
  to the provider-first call as the prior attempt.
- **A dispute the payer corrects with a clave neither machine read.** The
  payer's data goes through the transfer door with no further contrast, and
  the existing supersede rules apply. The payer's typed data is never
  second-guessed by a machine.
- **A bank whose shape rule graduates between the first call and the
  retry.** The classification is taken once, at the first call, and recorded.
  A rule that appears later changes the next payment, not this one.
- **A payment born before this feature, validating at cut-over.** It keeps
  the flow it started under: a first attempt on the transfer door and a
  minute-two cross. Only payments born after the cut-over take the
  provider-first door, so a record is never half one flow and half the other.
- **The provider cannot fetch the file on the first call.** The failure is
  retryable and rides the schedule as today; the classification waits for a
  call that actually read something.
- **The PDF-to-text step fails or times out.** The PDF goes to the provider
  with an empty reading on our side, like a scanned PDF. The failure is logged
  with its reason and spends nothing.
- **The upload budget.** A refusal for legibility is an upload like any
  other for the hourly budget, and it never counts as a paid attempt.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST read a PDF receipt at the edge by turning it
  into text and reading the text with the same reader that reads pictures,
  and the resulting reading MUST pass through the same gate, the same shape
  rules and the same draft as a picture's reading (D1).
- **FR-002**: A PDF from which no text can be extracted, or whose text step
  fails, MUST produce an empty reading on our side and continue through the
  flow to the provider's own reading silently: it MUST NOT be refused for
  that reason, MUST NOT ask the payer for anything, MUST NOT show the payer
  any difference, and MUST NOT spend a credit for the reading (D1).
- **FR-003**: The reader MUST report, for every file, whether it is a
  receipt and whether it is fully legible, partly legible, or not legible at
  all (D2).
- **FR-004**: The product MUST stop before spending any credit, log the
  refusal with its reason, and ask the payer for a clearer picture, when the
  reader says the file is not a receipt or is not legible at all (D2).
- **FR-005**: The product MUST NOT block on a reading that is partly legible,
  incomplete, unparseable, or absent because the reader is down; in every
  such case the file MUST go to the provider with whatever was read (D2).
- **FR-006**: The first paid call for a payment with a receipt file MUST send
  the file to the provider's own reader, and the product MUST keep its own
  reading beside the payment for contrast (D3).
- **FR-007**: The answer to the pay request MUST NOT wait for the first paid
  call; the payment MUST be returned as validating at once, and the first
  call MUST run after the answer or, failing that, at the schedule's next
  slot (D4).
- **FR-008**: A first-call verdict of confirmed, pending or contradicted MUST
  be handled exactly as today, with the amount and date that decide money
  coming from Banxico's record alone.
- **FR-009**: On a first-call verdict of "not found", or a provider that
  could not read the file, the product MUST compare the provider's reading
  with its own on the clave and the amount, counting only fields where its own
  reading passed the gate, and MUST record the outcome on the payment as
  agreed, disputed or blind (D5).
- **FR-010**: When the readings agree, the product MUST NOT spend a further
  credit in that attempt, MUST treat the agreement as evidence for the page's
  clock and for provisional release at minute zero, and MUST make every later
  retry for that payment go through the transfer door with the agreed data,
  never the file (D6) — **except when the agreed data has no date on either
  reading**, in which case the retry MUST keep the receipt door until the
  payer supplies one (D20). The agreement still stands: the clock retires and
  the release may fire while that one field is outstanding.
- **FR-011**: When the readings disagree, the product MUST apply the bank's
  learned clave shape to both claves. If exactly one fits, that reading MUST
  be the one the retries carry through the transfer door, with no question to
  the payer. When only the provider produced a reading, because ours was
  empty, the shape rules judge the provider's clave alone: a mismatch asks the
  payer; a fit, or no rule for the bank, lets the provider's reading stand as
  the accepted data (D7).
- **FR-012**: When the readings disagree and the shape rules cannot decide,
  because the bank has no rule yet or both or neither clave fits, the product
  MUST NOT spend a further credit in that attempt and MUST ask the payer to
  fill in only the disputed fields (D8). The row keeps riding its ordinary
  schedule meanwhile — the payer's answer and Banxico's are a race, and
  whichever lands first wins (D9, FR-014).
- **FR-013**: When the provider read no clave and our reading is complete
  and passed the gate, the product MUST send our data through the transfer
  door at the schedule's next slot; when our reading is incomplete too, it
  MUST ask the payer for the missing fields (D8, D9).
- **FR-014**: A second attempt triggered by the comparison MUST ride the
  schedule's next slot and MUST NOT run in the same request as the first
  call (D9).
- **FR-015**: Data the payer typed, whether on the manual door or to resolve
  a dispute, MUST go through the transfer door and MUST NOT be compared
  against any machine reading.
- **FR-016**: The shape rules MUST accept the provider's clave as an input,
  with the provider's bank name resolved through the bank vocabulary first,
  so that FR-011 can judge both claves with the same rule (D7). A bank name
  the vocabulary cannot resolve counts as "no rule".
- **FR-017**: Every path, including refusals and empty readings, MUST write
  its reading record with the door that read the file, the legibility
  verdict where one was given, and the classification where one was taken
  (D10).
- **FR-018**: The product MUST make countable, from its own records: the
  agreed, disputed and blind outcomes on first calls, distinguishable from
  minute-two crosses; the cases where the provider was blind on a receipt the
  product read in full; and the refusals for legibility with the credits they
  spent, which MUST be zero (D10).
- **FR-019**: The platform's own top-ups MUST follow the same flow under the
  platform's attribution.
- **FR-020**: Payments validating at cut-over MUST finish under the flow they
  started, and only payments born after cut-over MUST take the provider-first
  door.
- **FR-021**: A transfer-door retry that follows a provider-first call MUST be
  treated as the same payment's retry for the provider's replay flag, never as
  another payer's replay.
- **FR-022**: Routing MUST follow what the file is, never the type the upload
  claimed, as today.
- **FR-023**: Nothing about what a verdict means, when a payment confirms,
  what the fee is, how a partial settles, or how the schedule waits changes by
  this feature.

### Key Entities

- **Reading**: what one reader made of one file: clave, bank, amount, date,
  status, and now the legibility verdict. Two readings can exist for one
  payment: the product's own and the provider's.
- **Classification**: the outcome of comparing the two readings after a
  "not found": agreed, disputed with the fields in dispute, or blind with the
  side that was blind. Recorded once per payment, at the attempt that took
  it, and marked as a first-call classification or a minute-two cross.
- **Accepted data**: the structured clave, bank, amount and date that later
  retries carry through the transfer door: the agreed data, the reading the
  shape rules favoured, or the data the payer typed.
- **Reading record**: the product's log of every reading attempt, already
  attributed to the business or the platform; gains the legibility verdict
  and the reason for a refusal, and records the PDF text route as a reading
  at the edge rather than a routing to the provider.
- **Shape rule**: the bank's learned clave pattern, unchanged in how it is
  derived; now applied to two claves instead of one.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A text PDF receipt produces a draft with the same fields as the
  same receipt uploaded as a picture, and spends zero credits for the reading.
- **SC-002**: The count of paid calls needed to confirm a receipt whose
  reading was wrong on the product's side and right on the provider's drops
  from two to one.
- **SC-003**: The count of paid calls spent on a payment whose two readings
  agree and whose transfer has not settled, within the first minute, is one.
- **SC-004**: The count of credits spent on a file the reader calls "not a
  receipt" or "not legible" is zero, and the payer is asked for a new picture
  within the same interaction.
- **SC-005**: The count of times a payer is asked for a field when a learned
  shape rule could have decided it is zero.
- **SC-006**: When a payer is asked, the count of fields they are asked for is
  exactly the number of fields in dispute or missing, never the whole form.
- **SC-007**: The payer's page shows "verificando" without waiting for the
  provider: measured against a provider intercepted to answer in ten seconds,
  the page shows the state in under one.
- **SC-008**: The agreed, disputed and blind ratio on first calls, and the
  count of receipts the provider was blind on while the product read them in
  full, can be read from the product's records with no further
  instrumentation.
- **SC-009**: For every outcome that exists today (confirmed, pending,
  contradicted, not found, partial, above the debt, manual door), the payment
  ends in the same status with the same words as today.
- **SC-010**: A payment born before the cut-over finishes under the old flow;
  the count of payments whose record mixes the two flows is zero.
- **SC-011**: Every new test carries its story citation, and the count of
  decision citations lost in the change is zero.

**Amended 2026-09-18** after the second `/speckit-analyze` (run at
implementation, finding F1/F5): FR-010 carries D20's missing-date carve-out,
which was added to the plan by the first run and never carried back into the
requirement it contradicts; FR-012 gains the "in that attempt" scope FR-010
already had.

## Assumptions

- **Both provider doors cost the same credit.** Stated by the product
  creator; the flow's economics rest on it. If the provider ever prices the
  doors differently, D3 is the decision to revisit.
- **The provider's reading survives a failed call.** Measured on 2026-08-26:
  the provider returns what it read even when the verdict is "not found".
  Without that, the first-call comparison would have nothing to compare.
- **The PDF-to-text step is one the platform's existing model binding
  offers.** Whether it is free of charge and whether it reads scanned pages is
  unverified from this environment; the plan's research MUST check both. If
  it does not read scanned pages, a scanned PDF follows FR-002, which is the
  behaviour specified anyway.
- **Legibility is a judgement the reader can make well enough.** The reader
  already answers "is this a receipt" reliably (five of five on a dark
  screenshot, 2026-08-19). "Not legible at all" is a new question; the plan
  should measure it on the receipts at hand and bias it toward letting files
  through, since a wrongly blocked photo costs the payer a step and a wrongly
  passed one costs one credit the comparison may still salvage.
- **"Next slot" is the existing schedule's next slot.** The schedule is not
  redesigned here; the comparison only decides what the next slot sends and
  through which door.
- **The shape rules cold-start empty.** In the early weeks almost no bank has
  a rule, so almost every dispute goes to the payer. That is the decided
  behaviour (D8) and the record will show when rules start to decide.
- **Attribution and isolation are unchanged.** Readings and validations stay
  attributed to the business or the platform; the shape rules remain the one
  cross-business fact they already are.
- **The confirmation screen for an amount above the debt still comes before
  any credit.** The provider-first call happens after the payer confirms, so
  the screen's rule is untouched.
- **A refused top-up has no one to ask.** A top-up receipt the reader calls
  "not a receipt" or "not legible" rides the schedule as such a top-up does
  today: one reader call per slot, no provider credit, and the operator's
  remedy is a new upload. Nothing changes there (amended 2026-09-18).
- **No new screen and no new product copy beyond two payer-facing messages:**
  "this does not look like a receipt" and "the picture is not clear enough",
  both es-MX, plus the existing per-field ask for a disputed value.

## Out of Scope

- Any change to the schedule's timing, the fee, partial settlement, or what
  a verdict means.
- Rendering a PDF to a picture, on the payer's phone or at the edge.
- Replacing the reader's model, or adding a second model to break ties.
- A third paid call as a tiebreaker: when the machines cannot decide, the
  payer decides.
- Changing how shape rules are derived or graduate.
- A back-office report or chart of the new numbers; this feature makes them
  countable from the records, and a screen for them is its own feature.
- Reprocessing payments born before the cut-over.

## Dependencies

- The provider (apiCEP) and its credential, planted per environment; the
  image door and the transfer door as they exist today.
- The platform's model binding for the reader, including its PDF-to-text
  conversion.
- The existing minute-two cross (reading-check D1–D5), whose vocabulary and
  classification this feature moves to minute zero.
- The existing shape rules (proof-extraction D13–D16) and their
  cross-business read (consta-api-merge D4).
- The existing schedule and provisional-release evidence rules, which this
  feature feeds a minute earlier and does not redesign.
