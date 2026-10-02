# Feature Specification: payment-without-receipt

**Feature Branch**: `claude/spec-012-reference-by-phone`

**Created**: 2026-09-26

**Status**: Draft — written from the creator's decisions of 2026-09-26;
narrowed 2026-09-29 to the payer's side; rewritten the same day from the
creator's second session: the reference is the payer's phone, there is
nothing to register, Devolada learns how each customer pays, and a short
ladder takes over when a transfer is not found. Clarified 2026-09-29 and
2026-09-30: the ladder, the undecided bundle and the account tail
confirmed, and the reference made the person's — one phone and one name —
shared by that person's services. After `/speckit-analyze` (2026-09-30):
new numbers for the whole person, banks only from the past, the detail of
a used transfer only when it is the payer's own, and the clave and receipt
outside the hourly limit; then the first to receive a phone's digits keeps
them, assigned numbers at random, the unsafe-digit cases always, and a
phone beating an assigned number with a guarded transition. Last, the
same day: the system decides every reference alone and the panel only
shows it. No clarification is open.

**Input**: User description: "Pago sin comprobante. The payer registers a
recurring payment profile (sending bank + unique reference from their
phone); then (1) the payer only confirms the payment and its date, (2)
Devolada's own people validate what is left directly at Banxico, invisible
to the ISP, and (3) the ISP uploads its bank statement and Devolada does the
match. Order: 1, then 3, then 2."

Revised 2026-09-29, in the creator's words:

- "Piensa, como podemos mejorar la experiencia de usuario en este flujo,
  toma en consideración la siguientes ideas: 1. La referencia única es el
  numero de teléfono del cliente. 2. El cliente registra Banco, fecha y
  dice ya page. 3. EL sistema aprende de las cuentas de origen (banco), las
  sugiere para que el cliente las registre (asocia al menos tu cuenta de
  pago) y si ha pagado de varias la suguier."
- "Sigue con las recomendaciones. “No, puse la transferencia” le ofrece a
  opción de ingresar la referencia, pero como ya no es única deberíamos
  solicitar la terminación de la cuenta de origen o se le sugiere? Los
  datos con los que registró su pago visibles mientras se valida, con la
  opción de corregir. Si falla, en que reintento seria factible pedirle la
  confirmación de datos y en definitiva la calve de rastreo? Subir
  comprobante como segunda opción."

## Where the other layers went

On 2026-09-29 the creator split this feature. This spec keeps layer 1: the
payer pays with their own reference and confirms without a capture. The
other two layers each have their own spec:

- **The business uploads its bank statement and Devolada matches it** —
  User Story 3 of this spec until 2026-09-29, now
  [`specs/015-bank-statement-match`](../015-bank-statement-match/spec.md).
- **Devolada's people validate the remainder at Banxico** — User Story 4
  of this spec until 2026-09-29, now
  [`specs/016-banxico-remainder-queue`](../016-banxico-remainder-queue/spec.md).

Documents written before the split cite "spec 012 US4", "the human queue
(spec 012)" or "spec 012's Banxico batch" (spec 013, its research and data
model, and a few code comments around the bundle): those now mean spec 016.
"Spec 012, scenario 5" (bug `reference-search-printed-day`) still means
User Story 2, scenario 5, below. The rewrite of 2026-09-29 kept that
scenario's number and meaning; the stories after User Story 2 are new.

## Where spec 017 changes this spec

On 2026-09-30 the creator fixed the order of the confirmation step and the
tie-break of a typed reference in a spec of their own,
[`specs/017-confirmation-hierarchy`](../017-confirmation-hierarchy/spec.md).
Where the two differ, spec 017 holds: FR-015 (the typed reference's ask),
FR-021, FR-029 (the receipt's place), FR-031–FR-033, FR-041, User Story 2
scenario 3, User Story 5 scenarios 1, 3–5, 7 and 8, the page contract's
step 2 and asks, and plan decisions D11, D15, D17 and D25. Spec 017's plan reconciled
them on 2026-09-30 (its D1): this spec's plan, data model and contracts
carry dated notes, and its `tasks.md` names the tasks 017 builds instead.

## Where this comes from

Today a payment is proven by a **capture** of the bank's receipt. The
reader reads it, the provider searches Banxico with what was read, and two
bugs of 2026-09-26 showed the weak spot: a receipt that prints only a
reference can be confirmed with **somebody else's** transfer
(`reference-finds-other-transfer`), and a weekend transfer is searched on
days that cannot hold it (`reference-search-printed-day`). Banco Azteca
makes the first one the common case: the creator's Azteca receipts carry,
by default, the last seven digits of the receiving CLABE as the reference,
so Azteca payers of one business who keep the default share it.

On 2026-09-26 the creator measured the provider directly (24 paid calls)
and Banxico by batch (30 claves)
(`.specify/bugs/reference-finds-other-transfer/measurement.md`). What holds
this spec up:

- A reference plus **amount plus sending bank plus day** separates
  transfers. Same reference at $3.00 and $3.01, or from Azteca and from Nu,
  each returned its own CEP. The request has no field for the time, and
  none for the sending account.
- When several transfers still match, the provider does not pick one and
  does not refuse: it answers "invalid, Banxico confirmed" and hands over a
  **ZIP with one signed Banxico CEP per match**, each with its credit time
  to the second and the sending account.
- A CEP validated before comes back again, marked as validated before.
- The **printed day** of a transfer — the day the money moved, which the
  CEP calls the *fecha de abono* — is the date a search must carry.
  Amended 2026-09-27 (lot 3 and Banxico's batch answer, same
  `measurement.md`): Banxico found 16 of 16 transfers with the printed
  day and **0 of 14** with the operation day it files them under, Saturday
  transfers included. apiCEP also answered the Monday (and, by reference,
  the Sunday) for Saturday transfers; that is the provider's own,
  undocumented behaviour, and this spec does not rely on it.
  One answer is not explained: asked by reference with the printed day
  of a Friday, apiCEP returned one of three matching transfers and left
  out the two made after 18:00 (one call; `measurement.md`, "What these
  answers do not tell").
- A clave typed by hand is fragile. On the evening of 2026-09-26 one
  transfer's clave was typed four times before it was found: one
  character missing once, O and 0 swapped three times (same file, "Dev,
  the evening of Saturday 2026-09-26").

The creator's decision: **the payer stops sending captures.** Validation is
layered — instant with the provider (this spec), free with the business's
statement (spec 015), and human with Banxico for whatever is left (spec
016). The receipt path stays as the second option for any payer, and, until
specs 015 and 016 ship, as the way out for a transfer the instant path does
not find.

Since this spec was first written, spec 013 (`cep-bundle-match`) taught
Devolada to open the provider's several-matches bundle, to pick one CEP by
the sending account's tail or the time the receipt shows, and to leave a
payment it cannot decide in a visible undecided state that asks the payer
for the clave and never expires. This spec reuses that path for a typed
reference (FR-015), and lets an account Devolada already learned stand
where the receipt's tail stood (FR-021). On the payer's own reference it
is not needed: that reference belongs to one person, so every transfer it
matches is theirs (Clarifications, 2026-09-30).

### What the second session changed (2026-09-29)

The first version asked the payer to register once: pick a bank, receive a
reference. The creator replaced that with three ideas, and the rewrite
follows them:

- **The reference is the payer's phone** — its last seven digits, because
  SPEI's numeric reference holds at most seven. The payer already knows it
  and the business already holds it, so the reference exists before the
  payer does anything. Nothing is left to register. Since 2026-09-30 it
  identifies the person, not the service: one phone's services share it.
- **The payer gives the bank and the day each time they confirm.** A payer
  who changes bank, or a relative who pays from their own bank, just picks
  another one. The page preselects the likely answer, so this costs one tap.
- **Devolada learns how each customer pays.** Every confirmed payment
  already records its sending bank, and since spec 013 every CEP Devolada
  reads keeps its sending account, whole, under the business. Banks are
  suggested to the payer; accounts stay with the business and settle ties.

And three questions the creator asked on the same day, answered below: what
to ask a payer who did not put their reference, whether the data being
searched stays visible and correctable, and at which retry to ask for the
data and then for the clave.

The existing retry schedule frames that last answer. It is front-loaded on
evidence — "the probability mass lives in the first minutes"
(direct-payment D7) — with slots at 2, 8, 20, 45, 120 and 360 minutes after
the payment starts, and one late slot at 12 hours for a transfer that is
still not found. On the receipt path the page asks the payer to review
their data at the fifth attempt, about 45 minutes in. A confirmation
without a receipt has no evidence behind it, so after the first minutes a
wrong detail explains a "not found" better than a slow bank does; the
ladder here asks earlier (FR-028, FR-029).

## Clarifications

### Session 2026-09-26

- Q: In what order are the three layers delivered? → A: **1, then 3,
  then 2.** Each is independently useful. *Amended 2026-09-29*: layer 1
  is this spec; layer 3 is spec 015 and layer 2 is spec 016, delivered in
  that order.
- Three other answers of this session — who runs the Banxico queries
  (Devolada's own people), whether Devolada queries Banxico by machine
  (no), and whether the statement starts with a bank API (no) — moved with
  the stories they govern, to specs 015 and 016.

### Session 2026-09-29

- Q: What does this feature cover? → A: **The payer's side only** — the
  reference and the instant path — and it is built next. The statement
  and Devolada's people at Banxico each get their own spec (015 and 016).
- Q: What is the reference? → A: **The last seven digits of the
  customer's phone.** Devolada assigns another seven-digit number when the
  customer has no phone, when the phone is on more than one customer of the
  business, when those digits are already another customer's reference, or
  when they equal the tail of the business's own receiving account. The
  payer always sees the exact number. (This closes the question the first
  version left open on the reference format.) *Amended 2026-09-30: the
  reference belongs to the person — one phone and one name — so that
  person's services share it; see Session 2026-09-30.*
- Q: Does the payer register anything? → A: **No.** The reference is shown
  from the first visit; the bank and the day are given, preselected, on
  every confirmation.
- Q: What does Devolada learn, and what does the payer see of it? → A:
  **Banks and accounts, from every confirmed payment.** The payer is
  offered banks only. Accounts are kept under the business, shown to its
  operators by their last four digits, never to a payer: the payment link
  has no session, so anything it shows is shown to whoever holds the link,
  and spec 013 already keeps sending accounts for the business alone.
  *The panel's list of each customer's learned banks and accounts was
  withdrawn later the same day with the panel's actions: learning serves
  the confirmation, and accounts stay where spec 013 already shows them.*
- Q: Where the business's integration can restore the service while a
  payment is confirmed, does a confirmation count as evidence? → A: **Yes,
  under today's rules**, like a payment whose data the payer typed — and
  the clave and the receipt are offered early, so an honest payer whose
  bank dropped the reference does not end expired.
- Q: The read-back before confirming, "Pagué otra cantidad", the question
  the first time, the tie-break by a learned account? → A: **Yes, all
  four** ("Sigue con las recomendaciones").
- Q: A payer who did not put their reference types the one they used, but
  it may be shared: ask for the sending account's tail, or suggest it? →
  A: **Ask, never suggest — and ask only when needed.** When Devolada
  already learned an account of this customer that ties the transfer,
  nothing is asked. Otherwise the payer types the last four digits of the
  account they paid from. Suggesting would show account digits on a page
  without a session. *Confirmed by the creator at `/speckit-clarify`
  (option A of three). Rejected: always asking the four digits, a step
  more for a payer Devolada already knows; and dropping the typed
  reference, which leaves only the clave and the receipt to a payer who
  has a seven-digit number in front of them.*
- Q: Is the data being searched visible while it validates, with a way to
  correct it? → A: **Yes, always**, with "Corregir" on every state that is
  not final. *The creator's own request of the same session.*
- Q: If it is not found, at which retry does the payer confirm the data,
  and at which is the clave asked, with the receipt second? → A: **The
  data after the third round** (about 10 minutes after confirming), **the
  clave after the fourth** (about 20 minutes), with "Sube tu comprobante"
  beside it; then at most two more rounds without news from the payer.
  *Confirmed by the creator at `/speckit-clarify` (option A of three).
  Rejected: the receipt flow's pace (data at about 45 minutes, clave at
  about 2 hours), which leaves a wrong detail waiting and spends more
  calls; and asking at the first miss, which questions a payer whose
  transfer is only a minute late.*
- Q: When several transfers match and no learned account picks one, what
  happens to the payment until spec 016 exists? → A: **The payer is asked
  for the clave, with "Sube tu comprobante" as the second option**; the
  payment shows "en revisión" and never expires, as spec 013 does.
  *Confirmed by the creator at `/speckit-clarify` (option A of three).
  Rejected: waiting silently for spec 016, which nothing would close
  before it ships; and asking the time of the transfer first, one more
  step when the clave typed against kept candidates already forgives the
  usual typos.* *Narrowed 2026-09-30: with the reference per person,
  several matches on the payer's own reference are all theirs and ask
  nothing; this answer now governs a typed reference (User Story 5), and
  it asks the clave's last four characters, not the whole clave.*

### Session 2026-09-30

- Q: Does the reference identify the person (their phone, the same on all
  their services) or each service? → A: **The person.** The customers of a
  business whose records hold the same phone share its reference; the
  service a payment is for is the one whose link confirms it (or the one
  picked on the page that lists the links saved on the device). Several
  matches on the payer's own reference are all theirs: each confirmation
  takes one not yet used, without asking the clave. A phone on more than
  three customers, or one the business marks as not personal (an office
  number put on customers who gave none), is nobody's: each of those
  customers gets an assigned number. *Option A of three. Rejected: a
  reference per service, which gives one person several numbers; and one
  link per person that asks which service to pay, which is the wallet and
  needs the phone proven first — a feature of its own (Assumptions).*
  Decided now because a reference lives in the payer's bank app: changing
  its unit later means every payer updating their saved contact.
  *Amended the same day, after `/speckit-analyze`: "the same person" is
  the same phone **and** the same name, not "up to three customers"; see
  below.*
- Q (the creator's): Same service, same amount, bank, sending account and
  reference — only the time and the clave differ. Would asking the last
  digits of the clave work? → A: **In that case nothing needs asking**:
  both transfers are the payer's, so the earliest one not yet used
  confirms the payment and the other stays kept for their next
  confirmation, listed for the operator. **Where a question is needed** —
  candidates that may be other people's, after a typed reference — the
  clave's **last four characters** are asked instead of the whole clave:
  Devolada already holds the candidates, so four characters pick one
  without a call and with far less to type. The ladder's ask (FR-029)
  still wants the whole clave, because nothing has been found to compare
  a part with.

After `/speckit-analyze` (same day), the creator decided five more:

- Q: How does Devolada know that two customers with the same phone are the
  same person? → A: **Same phone and same name** — first name and surname
  as the business's records hold them, ignoring accents and letter case.
  Customers with the same phone and different names are different people:
  each person gets a number of their own, and the phone's digits go to no
  one, since nobody can tell whose phone it is. The business corrects it
  from the panel: "Es la misma persona" joins two customers into one
  person; "No es la misma persona" separates one (*both withdrawn later
  the same day: the system decides alone*). *This replaces the
  "more than three customers" line and the "not personal" mark: an office
  number put on customers who gave none now separates by itself, because
  the names differ. Rejected: the business deciding every repeated phone
  by hand; the payer confirming their services, which needs the phone
  proven first (the wallet).* *Amended later the same day: the first
  person to receive a reference keeps the phone's digits; see the next
  round.*
- Q: When the business gives a customer a new reference, and that person
  has several services on it, which services change? → A: **All of that
  person's services**: the person keeps one number, now a new one.
  *Rejected: only that service, which leaves one person with two numbers.* *Withdrawn later the same day with the
  panel's actions.*
- Q: From payments made before this feature, what does Devolada learn? →
  A: **The bank only.** The sending account of a receipt searched by clave
  was never kept; accounts are learned from confirmations made after
  launch. *Rejected: asking Banxico again for every old payment (one paid
  call each), and re-reading stored captures (kept 15 days).*
- Q: When the transfer already confirmed another payment, what is the
  payer told? → A: **The detail only when that payment is theirs** — one
  of the same person's services: "Ya se usó para tu pago del 12 de
  septiembre por $350.00". Otherwise, today's general sentence. *Rejected:
  never the detail; always the detail, which would show another person's
  payment.*
- Q: The link allows five attempts an hour; a payer who confirms and
  corrects three times could not send their clave or receipt. → A: **The
  clave and the receipt never count** toward that limit; corrections do.
  Receipts keep their own upload limit (20 an hour).

And, the same day, how references are generated:

- Q: When two people with different names share a phone, who keeps its
  digits? → A: **The first to receive a reference in Devolada**; the
  others get assigned numbers. When the feature is turned on, existing
  links are handled oldest first. *Rejected: the customer oldest in the
  business's records, which could take a reference away from someone who
  already saved it.* This replaces "the digits go to no one".
- Q: Does an assigned number follow a pattern (three digits of Devolada
  and the last four of the phone)? → A: **No — at random.** A pattern
  would show a payer the end of their phone and invite them to type the
  whole phone, which is the reference of the person who kept it.
- Q: Are the unsafe-digit cases checked even for a real phone of one
  person? → A: **Yes, always**, after knowing whose phone it is: they ask
  whether seven digits are safe as a reference, not whose they are. The
  leading-zero case is provisional until the pilot measures it. This
  confirms the plan's amendment of FR-002.
- Q: A new customer's phone ends in someone's assigned number. → A: **The
  phone's owner takes it** (FR-040); the previous holder gets a new number,
  a notice, and at their next confirmation the question of which
  reference they put. During the transition, who sent the money keeps
  them apart (FR-041), in the creator's order: the previous holder's
  known account, the last four digits of their account, then the last four
  characters of the clave; and the new owner is asked for their account's
  last four digits when a transfer comes from an account not known for
  them. *Rejected: the new customer getting another number (no one's
  reference changes); a 60-day wait with a temporary number for the new
  owner.*
- Q: Does the panel give the business actions over references ("Nuevo
  número", "Es la misma persona", "No es la misma persona"), a list of
  each customer's banks and accounts, a "Cuenta nueva" mark or a "cambió"
  label? → A: **No. The system decides alone; the panel only shows each
  customer's reference and whether it is the phone's or assigned, and the
  payments list says "Con su referencia".** The creator: the actions add
  work for the business. The rare cases they fixed — a name written two
  ways, two namesakes on one phone, a stand-in phone — are left to the
  rules and, later, to the phone checked by message, which the payer does
  themselves. *This withdraws the three actions and the "Nuevo número"
  answer above.*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The payer knows their reference before they pay (Priority: P1)

A customer of a business opens their permanent payment link. Next to the
amount and the account, the page shows **their reference** — the last
seven digits of their phone, the same on every service they have with
that business — with a copy button and a line on where it
goes in their bank's app ("En Azteca, escríbela en «Referencia numérica»,
no en «Concepto»"). It suggests saving the business as a contact with that
reference, so next month it is already there. The message the business
sends with the link carries the reference too. There is nothing to sign up
for and nothing to fill in.

**Why this priority**: a unique reference on every transfer removes the
shared-reference ambiguity at its root, and it is the one thing the payer
has to do differently. Every other story depends on it.

**Independent Test**: on a business with the feature on, open the links of
a customer with a phone of their own, of two customers with one phone and
one name, and of two with one phone and different names; see the first
four shown their phone's last seven digits (the two of one name the same
number, and the first of the two names the phone's digits too) and the
last one an assigned number; see the reference in the message the panel
prepares for the link. Delivers value alone: from the first transfer, the
business can tell its customers apart by reference on any receipt or
statement.

**Acceptance Scenarios**:

1. **Given** a customer whose phone is theirs alone in the business,
   **When** they open their link, **Then** the page shows their reference
   (the phone's last seven digits, said to be so), copyable, with where to
   type it and the save-as-contact tip, and asks them nothing.
2. **Given** customers of one business whose records hold the same phone
   and the same name (one person with several services), **When** each
   link is opened, **Then** all show the same reference, the phone's
   digits.
3. **Given** a customer with no phone on record, a link made through the
   collections API, or a phone whose digits another person with another
   name received first, **When** they open their link, **Then** they see
   an assigned number of their own, drawn at random, and the page does
   not call it their phone.
4. **Given** a phone whose last seven digits are already another person's
   reference (a different phone ending the same), or equal the last seven
   digits of the business's own receiving account, **When** that
   customer's reference is set, **Then** an assigned number is used
   instead.
5. **Given** a customer with a reference, **When** the business's operator
   looks at that customer in the panel, **Then** they see the reference
   and whether it is the phone's or assigned — to read, with nothing to
   do.
6. **Given** a customer who uploads a capture anyway, **When** the
   capture's reference differs from their own, **Then** the payment is
   still accepted on the receipt path and the payer is reminded of their
   reference.
7. **Given** a person holding an assigned number, **When** a new customer
   arrives whose phone ends in those seven digits, **Then** the new
   customer's link shows the digits as their phone's, and the previous
   holder's link shows a new number with the notice that it changed
   (FR-040).

---

### User Story 2 - The payer confirms with bank and day, and the business's action fires (Priority: P1)

The payer transfers the amount their link asks, with their reference, comes
back to the link and taps **"Ya pagué"**. The page asks two things, each
already answered with the likely option — **which bank they paid from** and
**which day** ("Hoy" preselected, "Ayer", "Otro día") — and reads back what
it will search: *"Buscaremos $350 con la referencia 234 5678, desde Azteca,
hoy martes 29."* One tap on "Confirmar pago" and Devolada asks the provider.
If Banxico has exactly that transfer, the payment is confirmed and the
business's action fires as today (for an ISP, the reconnection). If it is
not there yet, Devolada keeps looking. If more than one transfer matches
the payer's own reference, they are all the payer's: one not yet used
pays this service, and the rest wait for their next confirmation.

**Why this priority**: this is the instant path — one confirmation, one
paid provider call, the business's action in seconds — and it retires the
capture and the reader from the main flow.

**Independent Test**: with a customer who has a reference and a transfer
made with it, confirm with the right bank and day and see the payment
confirmed and the action queued; confirm a day where nothing exists and see
"Seguimos buscando" and the later retry. Works without User Story 3: the
payer picks the bank from the list.

**Acceptance Scenarios**:

1. **Given** a customer whose transfer Banxico holds for the day given,
   **When** they confirm with that bank and day, **Then** the payment is
   confirmed with that CEP, the clave and credit time are recorded, and
   the business's action fires.
2. **Given** a confirmation for a day where Banxico holds nothing,
   **When** the first search returns nothing, **Then** the payer sees that
   Devolada is still looking and the search is retried **on the same day
   given** without asking the payer anything; what follows is User
   Story 4's ladder. Until that story ships, the payment expires with a
   clear status if it is never found, and the payer's link then offers the
   receipt path.
3. **Given** the payer's own reference, amount, bank and day matching
   **several** transfers (they paid twice, or paid two services of the
   same price), **When** the provider answers with the bundle of CEPs,
   **Then** the bundle is kept, the earliest transfer not yet used
   confirms the payment without asking anything (one from an account
   learned for this service first, User Story 3), and the others stay kept
   for the payer's next confirmation and listed for the operator.
4. **Given** a transfer already used to confirm another payment, **When**
   it comes back marked as validated before, **Then** it does not confirm a
   second payment and the payer is told which payment already used it.
5. **Given** a payer who confirms the wrong day (the day before, the day
   after), **When** Banxico finds nothing on that day, **Then** a retry asks
   the neighbouring calendar days — never the operation day Banxico files
   the transfer under, by which Banxico finds nothing (measured 2026-09-26)
   — and the payer is not asked to upload anything.
6. **Given** a payer who sent a different amount (their link asks $350 and
   they sent $300), **When** they choose "Pagué otra cantidad" and type
   $300, **Then** the search uses $300, and a match is settled by the
   partial-payment rules that already exist. A payer who did not say so
   sees, while it validates, the amount that was searched, and can correct
   it (User Story 4).
7. **Given** a customer whose reference has never confirmed a payment,
   **When** they tap "Ya pagué", **Then** the page first asks whether they
   put that reference on the transfer; "No" spends no search and leads to
   the "No puse la referencia" path (User Story 5), or to the receipt path
   until that story ships.
8. **Given** a business whose integration can restore the service while a
   payment is confirmed (for an ISP, the provisional reconnection), and a
   customer whose history does not revoke it, **When** they confirm and the
   first search finds nothing, **Then** the service is restored under
   today's rules while Devolada keeps looking, and the page says so.

---

### User Story 3 - Devolada remembers how each customer pays (Priority: P2)

Every confirmed payment teaches Devolada something about its customer: the
bank the money came from and the account it left. The next time, the
confirmation offers that customer's banks first, the last one already
selected, so a returning payer confirms with a single tap. A customer who
has paid from two banks sees both. The accounts are never shown to the
payer; they stay with the business, where they pick between two
transfers without bothering the payer. Customers who paid by receipt
before this feature start with their banks already known.

**Why this priority**: it is what turns the confirmation into one tap, and
what lets Devolada settle most several-matches cases alone. The instant
path works without it, one pick slower.

**Independent Test**: take a customer with a payment confirmed from Azteca
on the receipt path before the feature, open their confirmation and see
Azteca preselected; make two matching transfers, one from that customer's
known account, and see the payment confirmed without a question.

**Acceptance Scenarios**:

1. **Given** a customer with a confirmed payment from Azteca, by any path
   and at any time, **When** they reach the confirmation, **Then** Azteca
   is offered and preselected.
2. **Given** a customer who has paid from Azteca and from Nu, **When** they
   reach the confirmation, **Then** both are offered, the most recent
   first and preselected, with "Otro banco" after them.
3. **Given** a payer who opens "Otro banco", **When** the list appears,
   **Then** it starts with the banks this business's customers use most.
4. **Given** several transfers matching the payer's own reference, one of
   them from an account learned for the service being confirmed, **When**
   the bundle arrives, **Then** that transfer confirms the payment without
   asking the payer, and the payment records that a learned account
   decided it.
5. **Given** a transfer found with the customer's own reference but sent
   from an account never seen for them, **When** it matches, **Then** it
   confirms the payment (people pay for relatives) and the account is
   learned.
6. **Given** any state of the payment page, **When** it is shown, **Then**
   no sending account appears, whole or in part.

---

### User Story 4 - While it validates, the payer sees what they sent; when it is not found, a short ladder asks (Priority: P2)

While a payment is being validated, the page always shows what Devolada is
searching with — amount, reference, bank, day, and the clave or account
tail if the payer gave one — with **"Corregir"**. When the transfer is not
found, Devolada does not only wait. After the third round it asks the payer
to check their data; after the fourth it asks for the clave de rastreo,
with "Sube tu comprobante" as the second option. Past that, it looks at
most twice more on its own before the payment expires, and the clave and
the receipt stay offered on the link.

**Why this priority**: a transfer the instant path does not find is the
case that decides whether payers trust it. Without this story that case
waits hours and ends in the receipt path; with it, most wrong details are
fixed within 20 minutes.

**Independent Test**: confirm with a bank that is not the one used; see the
read-back with "Corregir", the data check after the third round, a
correction of the bank finding the payment at once; in a second payment,
answer "Todo está bien" and see the clave asked after the fourth round,
with the receipt beside it.

**Acceptance Scenarios**:

1. **Given** a payment being validated, **When** the payer opens the link,
   **Then** the page shows the amount, reference, bank and day being
   searched (and the clave or tail they gave), with "Corregir".
2. **Given** a payment being validated, **When** the payer corrects the
   bank, day, amount or reference, **Then** one search runs at once with
   the new data; **When** a correction changes nothing, **Then** no search
   is spent.
3. **Given** three rounds that found nothing (the confirmation, the
   2-minute slot, the neighbouring days at the 8-minute slot), **When** the
   payer looks at the link, **Then** it asks them to check their data —
   including whether they put their reference — with "Todo está bien" and
   "Corregir", and blames no one.
4. **Given** a payer who answered "Todo está bien", or did not answer,
   **When** the fourth round (the 20-minute slot) also finds nothing,
   **Then** the page asks for the clave de rastreo, inviting them to paste
   it from their bank's app, with "Sube tu comprobante" as the second
   option.
5. **Given** a clave the payer gives at any point, **When** it is sent,
   **Then** it is searched at once with the day and bank given, and a
   match confirms the payment.
6. **Given** a payer who gives nothing new after the clave is asked,
   **When** the schedule goes on, **Then** Devolada searches at most twice
   more, the last time at the end of the payment's life, and the payment
   then expires with a clear status while the clave and the receipt stay
   offered.
7. **Given** a service already restored provisionally (User Story 2,
   scenario 8), **When** the ladder asks for data or the clave, **Then**
   the service is not withdrawn by the ask, and the page says that the
   clave or the receipt settles the payment before it expires.
8. **Given** three corrections that each spent a search, **When** the
   payer corrects a fourth time, **Then** no search is spent and the page
   offers the clave and the receipt instead.

---

### User Story 5 - "No puse la referencia" (Priority: P3)

A payer who did not put their reference — they paid before they knew it,
or their bank app kept its default — taps **"No puse la referencia"**. The
page offers to type the reference they did use, or their clave de rastreo,
with "Sube tu comprobante" as the second option. Because the reference they
used may be shared (Azteca's default is the business's own account tail),
a match on it alone is not enough: Devolada needs one more fact tying the
transfer to this customer. When it already learned one of this customer's
accounts, that account is the fact and nothing is asked. Otherwise the
payer types the last four digits of the account they paid from. Devolada
never suggests those digits.

**Why this priority**: it is the way back for the payers who miss the
reference — the most frequent reason, in the first months, for a transfer
the instant path cannot find. Until it ships, "No puse la referencia"
leads to the receipt path, which already handles them.

**Independent Test**: make a transfer with the Azteca default reference;
tap "No puse la referencia", type that reference, and see the last four
digits asked; type them and see the payment confirmed. Repeat for a
customer with a learned Azteca account and see it confirmed without the
question.

**Acceptance Scenarios**:

1. **Given** a payer who taps "No puse la referencia", **When** the page
   answers, **Then** it offers the reference they used or their clave, and
   "Sube tu comprobante" as the second option.
2. **Given** a typed reference, and an account learned for this customer
   that ties exactly one matching transfer, **When** the search answers,
   **Then** that transfer confirms the payment and nothing more is asked.
3. **Given** a typed reference and no learned account that ties a
   transfer, **When** the search answers, **Then** the payer is asked for
   the last four digits of the account they paid from, and a single
   transfer that fits them confirms the payment.
4. **Given** last four digits that fit no matching transfer, **When** they
   are checked, **Then** nothing is confirmed and the page offers the clave
   and the receipt.
5. **Given** a typed reference that many transfers share (the Azteca
   default), **When** the provider answers with the bundle, **Then** a
   learned account or the typed digits pick the transfer; if neither picks
   exactly one, the payment takes spec 013's undecided path and asks the
   last four characters of the clave, with the receipt second.
6. **Given** a typed reference that is another person's reference in the
   same business, **When** it is typed, **Then** Devolada does not search
   by it for this payer and asks for the clave or the receipt.
7. **Given** a payer whose reference changed (FR-040), **When** they next
   confirm and say they put the previous reference, **Then** the transfer
   confirms only when it comes from an account learned for them, or fits
   the last four digits of their account, or the last four characters of
   its clave (FR-041).
8. **Given** the new owner of those digits during the transition, **When**
   a transfer with them comes from an account learned for the previous
   holder, **Then** it never confirms for the new owner; **When** it comes
   from an account not yet known for the new owner, **Then** they are
   asked the last four digits of their account first (FR-041).

---

### Edge Cases

- **One phone on several customers.** With one name, it is one person with
  several services, and they share the phone's reference. With different
  names — a family where each pays their own, or an office number put on
  customers who gave none — the first person to receive a reference in
  Devolada keeps the phone's digits, and every other person gets an
  assigned number drawn at random. A customer added later with that phone
  joins the person of the same name, or gets its own number with a new
  name (FR-003). The system decides alone: a name written two ways is two
  people (each with their own number, the money never mixed), and two
  people with one name and one phone are one person — rare cases the
  phone's future check by message will settle (Assumptions).
- **A placeholder phone.** The business typed a stand-in number for
  customers who gave none. When it looks like a bank app's default
  (0000000000, 1234567890…), FR-002 already gives each an assigned number.
  When it is a real-looking number on customers with different names, they
  are different people: the first keeps its digits and the others get
  their own. When it sits on a single
  customer, it works as their reference — unique in the business — even
  though the page's "son los últimos 7 números de tu celular" is not true
  for them; the phone's future check by message corrects it.
- **A new customer's phone ends in someone's assigned number.** Juan held
  7815678 as an assigned number; Ana arrives with a phone ending in
  781 5678. Ana takes the digits (a phone beats an assigned number); Juan
  gets a new number and a notice on his link, and his next confirmation
  asks which reference he used, in case he paid with the old one before
  seeing it. Until Juan confirms with his new number, or for 60 days, the
  two are kept apart by who sent the money (FR-041).
- **One person, two services, one confirmation without a transfer.** With
  a shared reference, a service confirmed without paying can take the
  transfer meant for the other service. Accepted with the per-person
  reference (Clarifications 2026-09-30): the mix stays inside one person's
  services, and among several transfers the one from an account learned
  for that service goes first (FR-021).
- **The phone changes.** The reference does not follow it; the payer may
  have saved it in their bank.
- **A day outside the last 30 days.** A confirmation for a day after today,
  or more than 30 days ago in the business's timezone, is refused before
  any search; the page asks for a day within the last 30 days (older
  transfers go through the receipt).
- **The payer's bank app does not let them set the reference, or resets it
  to a default.** The instant path cannot find the transfer. The payer
  gets there through "No puse la referencia", the ladder's clave, or the
  receipt; once spec 015 ships, the statement can match it by amount and
  sending account. Each payment records its path, so the business can see
  which banks fail this way.
- **The payer changes bank, or a relative pays.** They pick another bank at
  the confirmation. A new sending account confirms and is learned; it is
  never refused, and nothing marks it (clarified 2026-09-30).
- **The payer pays twice the same day with the same reference** — same
  service, amount, bank and account; only the time and the clave differ.
  Both transfers are theirs, so nothing is asked: the earliest one not yet
  used confirms the payment. The other stays kept for their next
  confirmation and listed for the operator; never claimed, it is a credit
  without an invoice (an overpayment the existing rules already name).
- **The payer confirms before the transfer is filed.** The 2-minute slot
  covers it without a second confirmation.
- **"Hoy" near midnight.** A transfer made at 23:58 and confirmed at 00:03
  is found by the neighbouring-days round.
- **The amount the link asks changes between the transfer and the
  confirmation.** The read-back shows the amount searched; "Pagué otra
  cantidad" or a correction fixes it.
- **A clave typed with an error.** It finds nothing; the page says so and
  puts the receipt first. A clave that fits a candidate already kept from
  a bundle, with O read as 0, I as 1 or one character missing, confirms
  without a call (spec 013 FR-008).
- **The app shows the card's last four, and Banxico names the account's.**
  The digits fit no transfer; the payer goes to the clave or the receipt.
  Which banks do this is measured at the pilot.
- **A correction arrives after the payment was confirmed.** It is
  discarded; the payer sees the confirmed payment.
- **The provider's monthly quota runs out.** The instant path degrades to
  "Seguimos buscando"; the payment keeps its bounded life and its retries,
  and the platform operator sees the quota state.

## Requirements *(mandatory)*

### Functional Requirements

**The reference**

- **FR-001**: Every customer of a business that has this feature on MUST
  have a numeric reference of at most seven digits as soon as their
  payment link exists and their phone can be checked; until it can (the
  business's system not answering, or existing links still being
  prepared), their link works as it does today. A reference belongs to a
  person: the customers of the business whose records hold the same phone
  and the same name share it, and no two persons share one. No
  registration is asked of the payer.
- **FR-002**: The reference MUST be the last seven digits of the customer's
  phone as the business's records hold it. Devolada MUST assign another
  seven-digit number instead — one per person, drawn at random, with no
  pattern — when the customer has no phone; when another person with the
  same phone and another name received its digits first; when those
  digits are already another person's phone
  reference; when they equal the last seven digits of
  an account the business receives on; or when they look like a bank
  app's default — one digit repeated (0000000) or a straight run up or
  down (2345678, 7654321) — or start with 0. An assigned number never falls
  in any of these cases and is never one already used in the business.
  These cases are checked after Devolada knows whose phone it is, and
  apply even to a real phone of one person: they ask whether seven digits
  are safe as a reference, not whose they are. *Amended 2026-09-30 by the
  plan (payment-without-receipt D3) and confirmed by the creator the same
  day; the leading-zero case is provisional until the pilot measures
  whether bank apps keep a leading 0.*
- **FR-003**: A reference MUST NOT change by itself once shown, with the
  one exception of FR-040. A customer added later with the phone and the
  name of a person joins that person's reference; one with the phone and
  another name gets a number of their own, and whoever already holds the
  phone's digits keeps them. The system decides every case alone; the
  panel has no action that changes a reference (clarified 2026-09-30).
- **FR-004**: The payment instructions MUST show the reference next to the
  amount and the receiving account, each copyable; say whether it is the
  phone's digits; say where it goes — in the payer's bank's own words when
  a verified hint exists for that bank, otherwise the general sentence
  («Referencia numérica», not «Concepto»); and suggest saving the business
  as a contact with the reference.
- **FR-005**: The message Devolada prepares to share a payment link MUST
  include the reference, and the reference MUST be part of what the
  business reads about a link, in the panel and through the collections
  API.
- **FR-006**: The business's operator MUST see, per customer, the reference
  and whether it is the phone's or assigned — to read only: no action, no
  list of banks or accounts (clarified 2026-09-30).
- **FR-040**: A phone beats an assigned number. When a customer's phone
  ends in seven digits another person holds as an assigned number, the
  phone's owner MUST take them; the previous holder MUST get a new
  assigned number and see, on their link, that their reference changed
  and that the contact saved in their bank needs the new one. Their next
  confirmation MUST ask which reference they put — the new one or the
  previous one. *Added 2026-09-30 by the creator; numbered after FR-039 so
  no other requirement moves.*
- **FR-041**: Until the previous holder confirms a payment with their new
  number, or for 60 days, the two people MUST be kept apart by who sent
  the money: a transfer with the previous digits confirms for the previous
  holder only when it comes from an account learned for them, or fits the
  last four digits of the account they type, or — when that is not enough
  — the last four characters of its clave; it never confirms for the new
  owner when it comes from an account learned for the previous holder;
  and a transfer from an account not learned for the new owner asks the
  new owner for the last four digits of their account before it
  confirms.

**The confirmation**

- **FR-007**: A payer MUST be able to confirm a payment from the payment
  page by giving the sending bank and the day of the transfer. The amount
  is the one the link asks and the reference is their own unless they say
  otherwise. "Hoy", in the business's timezone, is preselected, with "Ayer"
  and "Otro día" beside it.
- **FR-008**: Before the payer confirms, the page MUST read back what will
  be searched: amount, reference, bank and day.
- **FR-009**: "Pagué otra cantidad" MUST let the payer give the amount they
  sent. The search uses it, exact to the cent, and the partial and
  overpayment rules that already exist settle the result.
- **FR-010**: Until the payer's own reference has confirmed a payment, on
  any of their services, "Ya pagué" MUST first ask whether they put it on
  the transfer. "No" spends no search and leads to FR-031, or to the
  receipt path until FR-031 ships.
- **FR-011**: On confirmation Devolada MUST search once by reference,
  amount, bank and day.
- **FR-012**: A single valid match MUST confirm the payment and fire the
  existing action, recording the clave and the credit time.
- **FR-013**: A CEP marked as validated before MUST NOT confirm a second
  payment. When the payment that used it is one of the same person's, the
  payer is told its day and amount ("Ya se usó para tu pago del 12 de
  septiembre por $350.00"); otherwise the general sentence, and nothing of
  another person's payment.
- **FR-014**: Where the business's integration can restore the service
  while a payment is confirmed, a confirmation MUST count as the payer's
  own evidence, under the same rules and the same history revocation as a
  payment whose data the payer typed.
- **FR-015**: The bundle of CEPs of a several-matches answer MUST be kept
  with the payment. On the payer's own reference every match is theirs:
  one not yet used MUST confirm the payment without asking anything —
  one from an account learned for this service first (FR-021), else the
  earliest — and the others stay kept for the payer's next confirmation
  and listed for the operator. On a typed reference (FR-032), when
  neither a learned account nor typed digits pick exactly one, the payment
  MUST take the undecided path spec 013 gives a bundle it cannot decide
  (013 FR-008): "en revisión" with its reason, no further provider calls,
  the payer asked for the last four characters of the clave — the whole
  clave when two candidates share them — with "Sube tu comprobante" as the
  second option, a clave that fits one kept CEP confirming without a call,
  and no `expired` end. Devolada's people take such payments once spec 016
  ships.

**What Devolada learns**

- **FR-016**: Devolada MUST learn the sending bank of every confirmed
  payment, whatever path confirmed it, including payments confirmed before
  this feature; and the sending account of every payment confirmed after
  it. Banks are learned per person (every service sharing the reference),
  accounts per service (the customer the payment was for).
- **FR-017**: The confirmation MUST offer the person's learned banks first,
  most recent first, at most three, with the most recent preselected, and
  "Otro banco" after them.
- **FR-018**: "Otro banco" MUST list first the banks this business's own
  customers use most. No other business's data informs the order.
- **FR-019**: A sending account MUST never be shown to a payer, whole or in
  part, and MUST never be suggested to them. Data read from CEPs (sender
  names, accounts) is kept only under the business it belongs to and shown
  only to its operators (accounts by their last four digits) and to
  platform operators.
- **FR-020**: A transfer found with the customer's own reference and sent
  from an account not yet learned MUST still confirm, and the account is
  learned.
- **FR-021**: When several transfers match and exactly one comes from an
  account learned for the customer being confirmed, that transfer MUST
  confirm the payment without asking the payer, and the payment records
  that a learned account decided it.
- **FR-022**: *Merged into FR-019 on 2026-09-30 (the analysis found the two
  said the same); the number is kept so later requirements keep theirs.*

**While it validates, and the ladder**

- **FR-023**: On every state of a payment that is not final, the page MUST
  show the data being searched — amount, reference, bank, day, and the
  clave or account tail the payer gave, as they gave it — with "Corregir".
- **FR-024**: A correction MUST replace the searched data and spend one
  search at once when a searched field changed; a correction that changes
  nothing spends none. At most three corrections per payment spend a
  search; after that the page offers the clave and the receipt.
  Corrections count toward the link's limit of attempts per hour; a clave
  or a receipt never does.
- **FR-025**: Searches MUST follow the existing validation schedule, in
  rounds. A round is one slot of the schedule, or one correction, whose
  search got an answer from the provider — a slot that got none (the
  quota spent, the provider down) is not a round. A round searches one
  day, except the neighbouring-days round, which searches each
  neighbouring calendar day once, never a day after today and never the
  operation day.
- **FR-026**: The first three rounds MUST be: the confirmation; the
  schedule's first slot (2 minutes today), on the day given; and its second
  slot (8 minutes today), on the neighbouring days.
- **FR-027**: The ladder is for a transfer not found; several matches take
  FR-015. The ladder MUST NOT ask the payer anything before the third round
  has found nothing. FR-010's question and "Corregir", always available,
  are not asks of the ladder.
- **FR-028**: After the third round finds nothing, the page MUST ask the
  payer to check their data: the read-back, whether they put their
  reference, "Todo está bien" and "Corregir". "Todo está bien" spends no
  search; the next round keeps its slot.
- **FR-029**: After the fourth round (the schedule's next slot, or the
  search a correction spends) finds nothing, the page MUST ask for the
  whole clave de rastreo — nothing has been found to compare a part of it
  with — inviting the payer to paste it from their bank's app, with "Sube
  tu comprobante" as the second option on the existing receipt path.
- **FR-030**: A clave given at any point MUST be searched at once with the
  day and bank given. Without a new fact from the payer after the clave is
  asked — a correction, a clave, a reference, account digits or a receipt
  — Devolada MUST search at most twice more, the last time at the end of
  the payment's life, and then let the payment expire with a clear
  status; the clave and the receipt stay offered on the link.

**"No puse la referencia"**

- **FR-031**: "No puse la referencia" MUST offer the reference the payer
  did use or their clave, with "Sube tu comprobante" as the second option.
- **FR-032**: A typed reference that is not the payer's own MUST confirm a
  payment only when a second fact ties the transfer to this customer: an
  account learned for this customer, or the last four digits of the
  sending account the payer typed. Devolada MUST ask for those digits only
  when no learned account ties the transfer.
- **FR-033**: Last four digits that fit no matching transfer MUST NOT
  confirm; the page offers the clave and the receipt.
- **FR-034**: A typed reference that is another person's reference in the
  same business MUST NOT be searched for this payer; the page asks for
  the clave or the receipt, except the payer's own previous reference
  (FR-041). Digits that belong to no person — a default-looking or other
  unsafe number (FR-002) — are an ordinary shared reference: FR-032
  applies.

**Across the feature**

- **FR-035**: Every confirmation MUST record its source — own reference,
  typed reference, clave, or receipt — what decided it (a single match,
  the earliest of the payer's own, a learned account, typed digits, the
  clave's last four characters, the clave), the clave and the credit time,
  so a payment can be traced to the transfer that paid it. Specs 015 and
  016 add their own sources to the same record.
- **FR-036**: Amounts MUST be exact to the cent in every match; no
  tolerance.
- **FR-037**: The asks and read-backs MUST be es-MX, say what was searched
  and what could differ, and never suggest the payer lied.
- **FR-038**: The provider quota MUST be visible to the platform operator,
  and running out MUST degrade to "Seguimos buscando", never to an error
  shown to the payer.
- **FR-039**: The feature MUST be turned on per business. A business
  without it keeps today's receipt flow, and on every business the receipt
  path stays reachable from the link.

### Key Entities

- **Payer reference**: a person's seven-digit number inside one business —
  the digits, whether they are a phone's or assigned, the customers
  (services) that share it, when it was set or changed. A person is the
  customers with one phone and one name. No two persons of the business
  share one; when
  different people share a phone, the first to receive a reference keeps
  its digits. A reference that passed from an assigned holder to a phone's
  owner records whom it passed from, until the transition ends (FR-041).
- **Learned bank**: a bank a person has paid from, read from their
  confirmed payments, the most recent first; nothing is stored apart.
- **Learned account**: a sending account a service was paid from — its
  bank, its type and number as the CEP names them, read from the CEPs that
  confirmed that service's payments. Kept under the business; never shown
  to a payer.
- **Confirmation**: a payer's "Ya pagué" — the bank, the day, the amount
  and the reference searched (their own or typed), any account digits or
  clave given, the corrections and the rounds it spent; what the page asks
  follows from those and is never stored.
- **Payment** (existing): gains its confirmation source, what decided it,
  the clave and the credit time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A payment is confirmed and the business's action fires within
  1 minute of confirming a transfer Banxico already holds, with no capture
  uploaded.
- **SC-002**: No payment is ever confirmed with a transfer that belongs to
  another person: 0 such confirmations in a month of pilot, checked
  against the pilot business's bank statement. A transfer moved between
  the services of one person is not counted here: it stays inside that
  person's services (Edge Cases).
- **SC-003**: The instant path spends at most 2 provider calls per payment
  on average over a month, and no payment spends more than 7 without a new
  fact from the payer.
- **SC-004**: Within two months of launch at the pilot business, at least
  70% of confirmed payments come through a path without a capture. This
  spec's paths count from launch; the statement and Banxico paths count
  once specs 015 and 016 ship.
- **SC-005**: Among payers with a learned bank, at least 80% of
  confirmations are sent with the preselected bank and day unchanged — a
  single tap.
- **SC-006**: At least 80% of the payments whose first search finds nothing
  end confirmed rather than expired.

## Assumptions

- The payer's bank app lets them set a numeric reference and keeps it for a
  saved contact; where it does not, the payer takes "No puse la
  referencia", the clave or the receipt (and, later, the layers of specs 015
  and 016). Which banks keep it is measured at the pilot, not assumed.
- The phone is the one the business's records hold: for a link made in the
  panel, read through the business's integration as the customer's other
  data is today; a link made through the collections API carries none, so
  its customer gets an assigned number. How many of the pilot business's
  customers have no phone, and how many share one under different names,
  is counted before release, since it says how often an assigned number
  appears. Names are compared as the business's records hold them,
  ignoring accents and letter case; a name written two ways counts as two
  people until the phone's future check by message.
- The amount searched is the one the payer's link asks unless the payer
  gives another: read through the business's integration as today when the
  link was made in the panel (for an ISP, its open invoices), or stored on
  the link when it was made through the collections API.
- The day the payer gives is the day the money moved (the date their app
  prints, the CEP's *fecha de abono*), and it is the only day Devolada asks
  besides its neighbours (amended 2026-09-27: Banxico found 16 of 16 by that
  day and 0 of 14 by the operation day, measured 2026-09-26). The operation
  day Banxico files a transfer under is recorded and compared, never asked.
- The last four digits a bank's app shows for the sending account are those
  of the account the CEP names, as spec 013 already assumes for the
  receipt's tail. Where a bank shows a card's digits instead, the digits
  fit nothing and the payer goes to the clave or the receipt; the pilot
  measures which banks do this.
- The provider is the one the engine already uses; its answer to several
  matches (invalid + Banxico confirmed + a ZIP naming each sending account)
  is the measured behaviour of 2026-09-26, spec 013 already reads it, and
  this feature relies on it; its quota is a plan setting the platform
  operator watches.
- The ladder rides the existing validation schedule (direct-payment D7) and
  its learned middle (learned-retry D6). Its asks are tied to rounds, not
  to the clock, so a slot that moves carries its ask with it. The minutes
  quoted here are today's slots.
- The bank hints that say where a reference is typed follow the rule the
  receipt hints already follow (receipt-triage D19): a hint is added only
  after a person verified it in the bank's own app, and says when. At
  launch: Banco Azteca, whose default reference started this feature, and
  the pilot business's most used banks; every other bank gets the general
  sentence.
- The existing payment life cycle, statuses, action queue, partial and
  overpayment rules, the provisional release and its history rules, spec
  013's undecided path, and the receipt path stay as they are; this feature
  adds confirmation sources in front of them, it does not replace them.
- WhatsApp as a channel follows the WhatsApp decision of 2026-09-22 (one
  shared Devolada number, two-way). When that channel exists, "ya pagué"
  there asks the same two questions as buttons; the channel itself is not
  part of this feature.
- Links stay one per service, and the bare payment origin keeps listing
  only the links this device was given. Turning a phone into somebody's
  links stays forbidden (returning-customer-access D1: anyone could type a
  neighbour's phone and see their service and debt). The wallet the
  creator aims for — the phone as the payer's way in, with local
  authentication — needs the phone proven before anything is shown, and
  is a feature of its own: a code sent to the phone by SMS or WhatsApp
  that the payer types back (the creator, 2026-09-30). A proven phone can
  also correct what the business's records hold — a missing, wrong or
  stand-in number — and settle "the same person" better than a name does.
  The per-person reference is chosen so that feature can build on it
  without changing any payer's number.
- Out of scope: the bank statement upload and match (spec 015); the
  remainder queue, Banxico's batch file and any query to Banxico (spec 016);
  changes to the reader; the WhatsApp channel; the wallet; one transfer
  split across several services; and any view across businesses of which
  banks keep the reference — that would be a fourth cross-business
  statistic, which constitution V admits only by amendment.
