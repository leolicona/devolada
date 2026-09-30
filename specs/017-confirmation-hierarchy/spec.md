# Feature Specification: confirmation-hierarchy

**Feature Branch**: `claude/spec-017-confirmation-hierarchy`

**Created**: 2026-09-30

**Status**: Draft — written from the creator's decisions of 2026-09-30.
Builds on spec 012 (`payment-without-receipt`) as it stands on `main` at
`e2ec70c`, and replaces the parts of it listed under "What this spec
replaces in spec 012". No clarification is open.

**Input**: User description, in the creator's words (2026-09-30):
"Evaluemos factorizar la UI para el flujo de confirmación de pago en
link.devoladapago.com. Adoptar como primera opción la confirmación de pago
por numero de referencia única (cuando el pagador usa sus últimos siete
numeros de su telefono), como segunda opción la confirmación de pago por
numero de referencia genérico (cuando el pagador se olvida y no usa sus
últimos siete numeros de su telefono) y dejar en el mismo formulario las
opciones de ingresar la clave de rastreo y como tercera opción subir la
foto, mas sutil ahora, ya que no es el centro. Si una confirmación de pago
que se realizo a través de numero de referencia tiene coincidencias,
primero se deberá comparar con los numeros de cuenta de origen previamente
utilizados por el pagador, si se diera el caso que es nuevo, se le deben
solicitar para el desempate y/o dar la opción de ingresar los últimos 4
dígitos de su clave de rastreo."

## Where this comes from

Spec 012 moves the payer off the capture. Their phone's last seven digits
are their reference, and "Ya pagué" asks only the bank and the day. It
keeps three ways to confirm, but ranks them loosely: "No puse la
referencia" and "Sube tu comprobante" sit side by side as small exits under
the main confirmation (012's page contract, step 2), and inside every ask
the receipt is "the second option" (012 FR-015, FR-029, FR-031).

On 2026-09-30 the creator fixed the order. The payer's own reference is the
centre. The reference the payer did use — when they forgot their phone's
digits — is a clear second option, in one form with the clave de rastreo.
The receipt is the third option and is shown quietly, because it is no
longer the centre.

The same review changed how a typed reference is tied to the payer. A
reference the payer types may be shared: Azteca's default is the business's
own account tail, so every Azteca payer who keeps it sends the same one. A
transfer it finds is therefore not proof that the transfer is the payer's.
Spec 012 settles that with an account Devolada learned for the customer,
or with the last four digits of the account the payer paid from. Three
gaps showed up:

- **An account can pay for more than one person.** Accounts are learned
  per service (012 D12), and nothing stops one account from paying for two
  households. Example: a relative paid last month for customer A, and today
  pays only for customer B, with the shared reference. When A confirms
  with that reference, the account learned for A picks B's transfer, and
  A is confirmed with B's money. Spec 012 counts zero such confirmations
  (012 SC-002).
- **The account's digits are not always at hand.** Some bank apps show the
  card's last four digits where Banxico names the account's (012 Edge
  Cases). The clave is in the transfer's detail, where the payer already
  copies it from (012 FR-029). The creator: offer the clave's last four
  characters as the other way to answer.
- **Four characters can be guessed.** Spec 012 asks the clave's last four
  characters only after the account's digits have narrowed the transfers,
  and leaves those answers outside every attempt limit (012 D25). Offered
  as a first answer, four characters need a limit of their own.

## What this spec replaces in spec 012

Spec 012 is planned and tasked, not built (2026-09-30). Where this spec and
spec 012 differ, this spec holds. Spec 012 is reconciled to it at this
spec's `/speckit-plan`, before 012's page tasks and its User Story 5 are
built.

| Spec 012 | What changes here |
| --- | --- |
| FR-015, on a typed reference: the undecided payment asks the clave's last four characters, with "Sube tu comprobante" as the second option | The tie-break screen: one screen with two ways to answer (FR-011–FR-014); the receipt is the quiet last option (FR-004) |
| FR-021: an account learned for the customer decides a tie | Only an account that belongs to this person alone decides (FR-015) |
| FR-029: the ladder's clave ask, with "Sube tu comprobante" as the second option | The receipt takes FR-004's form and place |
| FR-031: "No puse la referencia" offers the reference or the clave, with the receipt second | It becomes option 2 of the step (FR-001, FR-003); the receipt is option 3 |
| FR-032: the second fact is a learned account or the account's digits, which the plan asks before the search when no account is learned at that bank (012 D11) | The second fact is an exclusive learned account, or the account's digits, or the clave's last four characters, on one screen with two ways to answer, shown after the search found transfers (FR-009–FR-012) |
| FR-033: digits that fit nothing lead to the clave and the receipt | A wrong answer is asked again, up to the limit of FR-016 |
| FR-041: during a transition, the previous holder's account, then their digits, then the clave's characters; the new owner asked for their digits | The same tie-break screen of FR-011; only exclusive accounts decide (FR-015) |
| User Story 2 scenario 3; User Story 5 scenarios 1, 3, 4, 5, 7 and 8 | Read with the rows above |
| Page contract, step 2: the small exits (item 6), the "No puse la referencia" paragraph, the asks `sender_tail` and `clave_tail`, and every placement of "Sube tu comprobante" | Replaced by FR-001–FR-008 and FR-011 |
| Plan decisions D11 (the refusal before the search), D15 (the digits before the characters), D17 (the characters only after an undecided payment) and D25 (the characters outside every limit) | Revisited by this spec's plan |

Everything else in spec 012 stands: the reference and how it is born, the
confirmation by bank and day, the read-back and "Corregir", the ladder's
rounds, what Devolada learns, and the switch per business.

## Clarifications

### Session 2026-09-30

- Q: In what order does the confirmation step offer its ways to confirm?
  → A: **First the payer's own reference; second, in one form, the
  reference they did use or their clave; third, the receipt, shown
  quietly** ("más sutil ahora, ya que no es el centro").
- Q: A typed reference found one or more transfers. What decides which
  one is the payer's? → A: **First the sending accounts the payer used
  before.** If the account is new, the payer is asked — for the last four
  digits of their account, or, as the alternative, the last four
  characters of their clave de rastreo.
- Q: Does an account that has paid for another person of the business
  decide a tie? → A: **No.** A relative who paid last month for customer A
  and today only for customer B must not hand B's transfer to A.
- Q: A new spec, or an amendment typed into spec 012? → A: **A new spec**,
  which names what it replaces in spec 012.
- Q: What is "the ask" of the tie-break? → A: **One screen with two ways to
  answer** — the account's last four digits or the clave's last four
  characters, either one enough — in place of spec 012's two questions in a
  row. It is not asked only once: it comes back after an answer that fits
  nothing (up to FR-016's limit), and an answer that fits several leads to
  the other way and then to the whole clave. *The creator, the same day.*
- Q: On which screens does the quiet receipt link appear while a payment is
  not confirmed? → A: **Wherever the payer is asked something or the attempt
  has stopped** — the confirmation, option 2's form, every ask (data check,
  clave, tie-break), "Ya se usó para…", every refusal, and the expired
  state — **but not during the plain wait of the first rounds**, when the
  page asks nothing (012 FR-027). *The creator at `/speckit-clarify`, option
  B of three. Rejected: every unconfirmed state, which invites captures in
  the first minutes and spends calls; only the confirmation and the expired
  state, which leaves a payer asked for a clave they do not have with no
  way out.*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Three ways to confirm, in a fixed order (Priority: P1)

The payer comes back from their bank app to "Confirma tu pago". The first
and largest thing on the screen is the confirmation with their own
reference: the bank, the day, the read-back ("Buscaremos $350.00 con la
referencia 234 5678, desde Banco Azteca, hoy martes 29.") and **Confirmar
pago**. Below it is a clear second choice for the payer who did not put
their reference: **"Usé otra referencia"**. It opens one form where either
the reference they used or their clave de rastreo is enough. Last comes a
quiet text link: "Subir foto del comprobante". The same order holds on every
screen of the step. Inside the second option's form and inside every ask,
the receipt link comes last and stays quiet.

**Why this priority**: payers follow the page's order. While the receipt
competes for attention, payers keep sending captures and the reader stays
in the main flow, the opposite of what spec 012 decided. The second option
is also the way back from the most common miss of the first months: the
reference not put on the transfer.

**Independent Test**: on a business with the feature on, open a link that
has a reference and go to the confirmation step. See option 1 with the only
decisive action, option 2 as a standard control, and the receipt as a text
link at the end. Open option 2 and see the reference-or-clave form with the
receipt link last. Open each ask and see the receipt link last. Open a link
without a reference and see today's page.

**Acceptance Scenarios**:

1. **Given** a link with a reference at the confirmation step, **When** it
   opens, **Then** option 1 comes first — the bank, the day, the read-back
   and "Confirmar pago", the only decisive action on the step; option 2,
   "Usé otra referencia", is visible as a standard control without
   opening anything; and "Subir foto del comprobante" is a text link, the
   last thing on the step.
2. **Given** the step, **When** the payer opens option 2, **Then** one form
   asks for the reference they used or their clave de rastreo — either one
   is enough — with the amount (the link's, editable), the bank and the day;
   the form offers a way back to option 1; and the receipt link is still the
   last thing.
3. **Given** a payer whose reference has never confirmed a payment, asked
   "¿Pusiste la referencia 234 5678 en tu transferencia?" (012 FR-010),
   **When** they answer "No", **Then** option 2 opens and nothing is
   searched.
4. **Given** any ask of the page — the data check, the clave, the tie-break
   — "Ya se usó para…", a refusal, or the expired state, **When** it is
   shown, **Then** the receipt is offered as the same quiet text link,
   after every other action.
5. **Given** a payment in the plain wait of the first rounds ("Seguimos
   buscando"), when the page asks nothing, **When** it is shown, **Then** no
   receipt link appears; it appears with the first ask.
6. **Given** a link without a reference (the feature off, or the reference
   not ready yet), **When** it opens, **Then** the page is today's page,
   with the receipt first.
7. **Given** a payer who taps the receipt link, **When** they upload a
   capture, **Then** the receipt path works as it does today.
8. **Given** a 360-pixel phone, a keyboard or a screen reader, **When** the
   payer moves through the step, **Then** they reach the three options in
   the same order, each with visible focus, and the receipt link is a
   48-pixel touch target.

---

### User Story 2 - A typed reference is tied to the payer by history, or by one short answer (Priority: P1)

The payer typed a reference that is not their own, such as Azteca's default.
Devolada searches with it. When the search finds one or more transfers,
Devolada first looks at the payer's history: an account this customer paid
from before that no other person of the business has used. If exactly one
of the transfers comes from such an account, it confirms the payment and
nothing is asked. Otherwise the page shows one screen with two ways to
answer — "los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste"
or "los últimos 4 caracteres de tu clave de rastreo" — and the payer uses
whichever they have at hand. The answer is checked against the transfers already found, with no new
search. After three answers that fit nothing in a day, only the whole clave
and the receipt link are left on that link.

**Why this priority**: option 2 is now on the first screen. Without a short
tie-break, most of its payments would end on the whole clave or on a
receipt. The whole clave is up to 30 characters, and on 2026-09-26 one took
four tries to type right. Those are the paths this spec moves away from.

**Independent Test**: make two transfers with Azteca's default reference —
same amount, bank and day, from two accounts. Confirm with that reference as
a customer who has a learned account that belongs only to them: see the
payment confirmed without a question. Confirm as a new customer: see the
ask. Answer with the clave's last four characters: see it confirmed. On
another payment, answer wrong three times: see only the whole clave and the
receipt link offered.

**Acceptance Scenarios**:

1. **Given** a typed reference that matches one or more transfers, exactly
   one of them from an account learned for this customer and exclusive to
   this person, **When** the search answers, **Then** that transfer
   confirms the payment, nothing is asked, and the payment records that a
   learned account decided it.
2. **Given** a typed reference that matches one or more transfers, none of
   them singled out by an exclusive learned account, **When** the search
   answers, **Then** the page shows the tie-break screen: one screen with
   both ways to answer, saying that either one is enough.
3. **Given** the ask, **When** the payer gives the clave's last four
   characters and they fit exactly one of the transfers found (O read as 0,
   I as 1), **Then** that transfer confirms the payment with no new search.
4. **Given** the ask, **When** the payer gives the account's last four
   digits and they fit exactly one of the transfers found, sent from an
   account not learned for another person, **Then** that transfer confirms
   the payment with no new search.
5. **Given** account digits that fit exactly one transfer, sent from an
   account learned for another person of the business, **When** they are
   checked, **Then** nothing confirms yet and the clave's last four
   characters are asked.
6. **Given** an answer that fits several of the transfers found, **When** it
   is checked, **Then** the other way to answer is asked if the payer has
   not given it yet, and after that the whole clave.
7. **Given** an answer that fits none of the transfers found, **When** it is
   checked, **Then** nothing confirms, the page says the data matched none of
   the transfers found, and asks again; after the third such answer on this
   link within 24 hours, only the whole clave and the receipt link are
   offered.
8. **Given** a typed reference that finds a single transfer, not sent from
   an exclusive learned account, **When** the search answers, **Then** the
   ask is made as for several: one match on a shared reference is not proof.
9. **Given** a payer who does not answer, **When** time passes, **Then**
   the payment stays "en revisión" with no searches and no expiry (spec
   013's undecided path), and the ask stays on the link.
10. **Given** any screen of the page, **When** it is shown, **Then** no
    account digits and no clave characters of a transfer found are shown or
    suggested, and no list of transfers is offered to pick from.

---

### User Story 3 - An account that pays for several people never decides alone (Priority: P2)

Some accounts pay for more than one person: a relative who covers two
households, or a small business that pays for its workers. Such an account
is still learned, and a transfer from it still confirms when the payer ties
it another way. But it never decides a tie by itself — not on a typed
reference, not among one person's services on their own reference, and not
during a reference's transition (012 FR-041).

**Why this priority**: a wrong confirmation hands one customer's money to
another, and spec 012 counts zero of them. The case is rare, but it is
exactly the one the history rule creates.

**Independent Test**: account R confirmed a payment of customer A last
month. Today R pays only customer B, a different person, with the shared
reference. A confirms with that reference: the payment is not decided by
history and A is asked. B confirms: B is asked too, because R is no longer
one person's account.

**Acceptance Scenarios**:

1. **Given** an account learned for customer A that has also confirmed a
   payment of another person, **When** A's confirmation with a typed
   reference finds a transfer from it, **Then** the account does not decide
   and A is asked (User Story 2).
2. **Given** the same account, **When** the other person's confirmation
   finds a transfer from it, **Then** it does not decide for them either.
3. **Given** an account exclusive to one person, **When** it later
   confirms a payment of another person, **Then** from then on it no longer
   decides; payments it decided before stay as they are.
4. **Given** the payer's own reference and several transfers of theirs,
   **When** the learned account that would pick one for this service is not
   exclusive to this person, **Then** the earliest transfer not yet used
   confirms the payment (012 FR-015), as when no account is learned.
5. **Given** a reference in transition (012 FR-041), **When** a transfer
   with the previous digits comes from an account that is not exclusive to
   the previous holder, **Then** it does not confirm for the previous holder
   without the tie-break screen of User Story 2.

---

### Edge Cases

- **The payer has neither the account's digits nor the clave** at hand.
  The receipt link is quiet but there, on the tie-break screen. Without an answer the payment
  waits "en revisión" and never expires, until spec 016's people take it.
- **Both ways are given at once.** When they fit the same transfer, it
  confirms. When they fit different transfers, nothing confirms, and it
  counts as one wrong answer.
- **The app shows the card's last four digits, and Banxico names the
  account's.** The digits fit nothing; the clave's characters are the way.
  This is why the ask offers both.
- **Two transfers found share the clave's last four characters.** The
  whole clave is asked.
- **The payer types their own reference in option 2.** It is treated as
  their own reference (spec 012).
- **The payer types another person's reference.** It is refused before any
  search (012 FR-034); the whole clave and the receipt link are offered.
- **The limit is reached, then the payer finds the whole clave.** The whole
  clave confirms, with the forgiveness spec 013 gives a typed clave (O as 0,
  I as 1, one character missing). No limit of this spec applies to it.
- **An honest payer mistypes three times.** They reach the whole clave.
  How often this happens is measured at the pilot (SC-004).
- **The payer goes from option 2 back to option 1 before sending.**
  Nothing is searched.
- **Option 1 finds nothing.** The ladder's asks follow (012 FR-028, FR-029),
  with the receipt link quiet and last.
- **The first minutes of the wait.** "Seguimos buscando" shows no receipt
  link: nothing is asked yet, and a capture sent then would only spend
  calls. The link comes back with the first ask (FR-005).
- **Dark mode, reduced motion, a 360-pixel screen.** The order and the
  sizes hold; there is no horizontal scroll.

## Requirements *(mandatory)*

### Functional Requirements

**The confirmation step**

- **FR-001**: On a link with a reference, the confirmation step MUST offer
  exactly three ways to confirm, in this order: (1) with the payer's own
  reference; (2) with the reference the payer did use, or their clave de
  rastreo, in one form; (3) with a receipt.
- **FR-002**: The step MUST open on option 1 — the bank, the day, the
  read-back and "Confirmar pago" (012 FR-007–FR-009). "Confirmar pago" is
  the only decisive-size action on the step, and "Pagué otra cantidad"
  belongs to option 1.
- **FR-003**: Option 2 MUST be a standard-size control visible on the
  step's first screen, never behind another link. Opening it MUST show one
  form where either the reference or the clave is enough, with the amount
  (the link's, editable), the bank and the day, and a way back to option 1.
  The "No" of 012 FR-010's question opens it.
- **FR-004**: Option 3 MUST be a text link with no button styling, placed
  after every other action, with a 48-pixel touch target and visible
  focus. Wherever the page offers the receipt on a link with a reference —
  the places FR-005 names — it MUST take this form and this last place.
- **FR-005**: On a link with a reference, the receipt MUST be offered
  wherever the payer is asked something or the attempt has stopped: the
  confirmation, option 2's form, every ask (data check, clave, tie-break),
  "Ya se usó para…", every refusal, and the expired state (012 FR-039). It
  MUST NOT be offered during the plain wait of the first rounds, when the
  page asks nothing (012 FR-027). Quiet never means hidden where the payer
  needs a way out.
- **FR-006**: A link without a reference — the feature off, or the reference
  not ready yet — MUST keep today's page, with the receipt first.
- **FR-007**: The copy MUST name option 2 by what the payer did ("Usé otra
  referencia") and MUST NOT call it "genérica". That word keeps its
  existing meaning on the page: a reference many transfers share, such as
  0000 or 1234 (receipt-triage D2).
- **FR-008**: The order a keyboard or a screen reader follows MUST be the
  visual order of FR-001.

**Ties, and what decides them**

- **FR-009**: A typed reference that matches one or more transfers MUST
  confirm a payment only when one more fact ties exactly one of those
  transfers to this payer. A single match needs that fact too.
- **FR-010**: The payer's history MUST be tried first. When exactly one of
  the transfers found comes from an account learned for this customer and
  exclusive to this person (FR-015), it MUST confirm the payment without
  asking anything, and the payment records that a learned account decided
  it.
- **FR-011**: When history does not single out one transfer, the page MUST
  show the tie-break screen, after the search found transfers: one screen
  with two ways to answer, either one enough — the last four digits of the
  account or card the payer paid from, or the last four characters of their
  clave de rastreo. It is one screen, not two questions in a row; it is shown
  again only as FR-013 and FR-014 say. It MUST never suggest digits or
  characters.
- **FR-012**: An answer MUST be checked only against the transfers already
  found, and checking it MUST NOT spend a provider call. The clave's
  characters are compared with O read as 0 and I as 1. The account's digits
  are compared by the account type Banxico names, as spec 013 compares a
  receipt's tail. An answer that fits exactly one transfer confirms it,
  except as FR-013 says.
- **FR-013**: Account digits that fit exactly one transfer sent from an
  account learned for another person of the business MUST NOT confirm it
  alone; the clave's characters are asked. An answer that fits several
  transfers MUST lead to the other way to answer, if not given yet, and then
  to the whole clave.
- **FR-014**: An answer that fits none of the transfers found MUST NOT
  confirm anything. The page says the data matched none of the transfers
  found and asks again, within the limit of FR-016.
- **FR-015**: A learned account is **exclusive** to a person while every
  payment it confirmed in the business belongs to that person (a person is
  one phone and one name, as spec 012 decides). A learned account MUST
  decide a tie without asking the payer only while it is exclusive: on a
  typed reference (FR-010), among one person's services on their own
  reference (012 FR-015, FR-021), and during a reference's transition (012
  FR-041).
  Exclusivity is read at the moment of the tie; a payment an account decided
  while it was exclusive stays as it is. An account that is not exclusive is
  still learned, and a transfer from it still confirms when the payer ties
  it by the clave's characters or by the whole clave.
- **FR-016**: A link MUST accept at most three answers that fit no transfer
  within 24 hours, account digits and clave characters counted together.
  After the third, only the whole clave and the receipt link are offered on
  that link until the 24 hours pass. The whole clave and the receipt are
  never limited by this rule. The clave's characters count toward this
  limit, in place of 012 D25.
- **FR-017**: A payment whose payer does not answer MUST stay on spec 013's
  undecided path — "en revisión", no further searches, no expiry — with the
  ask still offered.
- **FR-018**: No account digits and no clave characters of a transfer found
  MUST be shown or suggested to the payer, and the page MUST NOT offer the
  transfers found as a list to pick from (012 FR-019).
- **FR-019**: A payment confirmed through this tie-break MUST record what
  decided it — an exclusive learned account, the account's digits, the
  clave's characters, or the whole clave — and how many wrong answers came
  before it (extending 012 FR-035).

### Key Entities

- **Tie-break answer**: what a payer gives to tie a typed reference to one
  transfer — which way (the account's digits or the clave's characters),
  what it fitted (none, one or several of the transfers found), and when.
  Answers that fit nothing are counted per link over 24 hours (FR-016).
- **Exclusive account**: a learned account (spec 012) whose confirmed
  payments all belong to one person of the business. It is read from the
  payments, never stored as a mark, and it stops being exclusive the day it
  confirms a payment of another person.
- **Confirmation** (spec 012): also records what decided it among this
  spec's facts, and the wrong answers before it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At the pilot business, at least 80% of the payments confirmed
  with a typed reference that found transfers are settled by history or by
  one four-character answer, without the whole clave or a receipt.
- **SC-002**: No payment is confirmed with another person's transfer
  through history or a four-character answer: 0 such confirmations in a
  month of pilot, checked against the business's bank statement, including
  payments from accounts that pay for several people.
- **SC-003**: 95% of tie-break answers show their result on the page within
  5 seconds, since no search is spent on them.
- **SC-004**: Fewer than 5% of the payers asked for a tie-break reach the
  limit of wrong answers.
- **SC-005**: Within two months of launch at the pilot business, at most
  20% of the confirmed payments of links with a reference come through a
  receipt.

## Assumptions

- Spec 012 is the base, and this spec is built with it, not after it. Spec
  012 is planned and tasked but not built (2026-09-30). This spec's plan
  reconciles 012's plan, page contract and tasks, so the two never disagree
  silently.
- The transfers one search finds differ in their clave's last characters
  (measured in 012 research R15: `…56772I` and `…73815I`, from one
  bundle). When two share their last four, the whole clave decides.
- Every bank app shows the clave in the transfer's detail. Not every app
  shows the sending account's last four digits the way Banxico names them
  (012 Assumptions). That is why the ask offers both.
- The search runs before the ask, because the clave's characters can only
  be compared with transfers already found. A typed-reference confirmation
  with no exclusive learned account therefore spends one provider call even
  when the payer then leaves. This replaces 012 D11's refusal before
  anything is billed; spec 012 spent that call after the digits anyway.
- Three wrong answers per link in 24 hours is a starting value. When a
  clave ends in four digits, a blind guess among k transfers found ties one
  about k times in 10,000; three guesses a day keep that under 1 in 1,000 a
  day for k up to 3, and a clave ending in letters is harder still. The
  owner of a transfer taken this way is told it was already used (012
  FR-013), which surfaces it. The pilot measures what the limit costs
  honest payers (SC-004) and whether anyone guesses (SC-002).
- "Exclusive" uses spec 012's person: one phone and one name. Two services
  of one person share their accounts, and that is not a second person.
- The copy quoted here is es-MX and final in meaning. Its exact wording is
  settled with the page's other copy at the plan.
- Out of scope: the payment instructions (step 1), the search by the
  payer's own reference, the ladder's rounds, the receipt reader, the pages
  of businesses without the feature, and the WhatsApp channel.
