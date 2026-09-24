# Research: receipt-triage

> **Story 3 rescoped 2026-09-24 — this file is behind the spec.** The ISP now
> chooses one *cuenta de cobro*, the only account the payment page shows;
> the CLABE is no longer required; a receipt's destination is checked by its
> last four digits; a transfer to another account registered at submission
> is checked against that account (spec D9, D10, Story 3, FR-016–FR-021).
> Everything here about showing several accounts, the account choice on the
> form (`receivingAccount`), the candidate list (`potentialBeneficiaries`,
> `beneficiary_candidates`, D23), three visible digits, or the CLABE staying
> required is superseded until the plan is redone for Story 3.

**Date**: 2026-09-23, rescoped 2026-09-24 · **Spec**: [spec.md](./spec.md) ·
**Plan**: [plan.md](./plan.md)

Phase 0. Each entry: what had to be known, what was found and where, the
decision, and what else was weighed. Decisions are numbered in the plan
(`receipt-triage D11`–`D26`; D27 came from `/speckit-analyze`, 2026-09-24);
the spec holds D1–D10. This file replaces the
research of 2026-09-23. Its Spin entries left the scope with the spec
(Clarifications, 2026-09-24); its card and phone entries came back the same
day and are R12–R16 here. No code cites the old numbers.

## What was measured, and what could not be

- **Production has no traffic yet.** Measured 2026-09-23 on
  `devolada-db-prod`: zero rows in `payments`, zero in `extractions`. The dev
  database holds two confirmed payments, both `NUBANK`. So how often a capture
  lacks both keys cannot be read from our records today; FR-028 makes it
  countable from the first real week.
- **The provider's documentation is not reachable from the build
  environment** (`apicep.cloud`, `www.apicep.cloud`: blocked by the egress
  proxy, 2026-09-23). What is known of the reference search comes from the
  text the product creator pasted in session: "`referenceNumber` — Payment
  reference number. Required if `trackingKey` is not sent", with the example
  `"referenceNumber": "0170126"`; and of the card, phone and account-list
  modes, the same pasted text (exactly one of `clabe` 18, `phoneNumber` 10,
  `cardNumber` 16 per account; `potentialBeneficiaries` only when the
  provider reads the picture).
- **The provider's documentation, read in full on 2026-09-24** — still not
  reachable from here; the product creator pasted the whole validation page
  in session. What it settles: the 422 is "referencia duplicada en Banxico
  (requiere clave de rastreo)", with no list of candidates (R7);
  `potentialBeneficiaries` works only when the provider reads the picture,
  and when no candidate fits the answer is `status: "error"` (R12); `sender`
  may carry both keys, at least one; and, once Banxico confirms,
  `cepDetails` carries **`beneficiaryAccount`** and `beneficiaryAccountType`
  — the account that received the money (R12, amended). Still unmeasured:
  whether a 422 bills, and whether `beneficiaryAccount` comes whole or
  masked. Its response example prints a nine-digit `referenceNumber`
  ("987654321"); SPEI's referencia numérica has at most seven, so D12's gate
  stands and a longer provider reading counts as no reference.
- **Bank help pages are not reachable either** (`www.bbva.mx` blocked,
  2026-09-23), and third-party round-ups disagree with each other. Where a
  bank's app shows its clave is known for sure only from receipt 1 (Banorte,
  "Ver más detalles").

## R1 — The engine already speaks reference; the product does not

**Found.**

- The request guard accepts it: `transferSchema` takes `trackingKey` and
  `referenceNumber`, both optional, with `.refine(t => t.trackingKey ||
  t.referenceNumber)` (`consta/request.ts`); the reference is `^\d{1,20}$`
  because the provider's maximum is undocumented.
- The adapter sends it (`provider/apicep.ts`, `requestBody`), records it on
  the billing log (`validations.reference_number`), and parses the one the
  provider's picture reading returns (`reading.referenceNumber`).
- The provider's 422 is already classified: `REQUEST_REJECTED`, not
  retryable, `hint: "provide_tracking_key"` — "Devolada cannot hit it (it
  always sends the key), a future integrator searching by reference alone
  can." This feature is that integrator.

What stops the reference today, in order: the facade type
(`ConstaRequest.transfer.trackingKey: string`), the reader (no field for
it), the gate, the comparison (`ProviderReading` drops the provider's
reference; `accepted.trackingKey` is required), the payment row (no column),
the lifecycle's `accepted` test and its transfer request (`trackingKey:
payment.trackingKey ?? ""`), the pay contract (`transfer.trackingKey`
required) and the page's form.

**Decision (D11).** The reference is threaded through every one of those
layers as an optional sibling of the clave, with one rule everywhere: **a key
is a clave or a reference; the reference travels only when there is no
clave; when both exist, only the clave travels** (clarified 2026-09-24). Nothing about the clave's own path changes.

## R2 — What counts as a reference

**Found.** SPEI's referencia numérica is a number of up to seven digits,
entered by the sender (bank apps ask for "Referencia numérica — hasta 7
dígitos"); the provider's own example carries seven (`0170126`). Receipt 2
prints six ("038195", a leading zero). Receipt 3 — out of scope, but a good
warning — prints a ten-digit "Folio de operación" (0082918812), exactly the
kind of number a reader might mistake for a reference.

**Decision (D12).** The reader asks for the field labelled "Referencia" or
"Referencia numérica" and is told, in the prompt, not to take a folio, an
authorisation number, a clave or an account for it. The gate accepts a
reference only as `^\d{1,7}$`, as printed — leading zeros kept, never parsed
as a number — and reports `ok | malformed | missing` like the clave. The
engine's own guard stays at 20 digits (it serves any caller); the product is
stricter.

**Alternatives.** Accept up to 20 like the engine — rejected: it would send
folios to Banxico as references, a paid `not_found` each. Normalise leading
zeros away — rejected: the reference is text on the receipt; what Banxico
stores is what the sender typed.

## R3 — The comparison with two keys

**Found.** `compareReadings` (`consta/extraction/compare.ts`) decides agreed,
disputed or blind on the clave and the amount, uses the bank's clave shape as
tiebreaker, and returns `accepted: { trackingKey, senderBank, amountCents,
date }`. It is pure and already receives the provider's reading.

**Decision (D13).** The comparison's key is **the clave when either reading
found one, the reference otherwise**. When the key is the reference: equal
references (as text) agree; different ones dispute, and the disputed field is
`referenceNumber`; one side with none is blind. The shape rules have no
opinion on a reference (they are learned from claves) and never break a
reference tie — a disputed reference goes to the payer. `accepted` carries
`trackingKey | null` and `referenceNumber | null`, at least one set.
`DisputedField` gains `referenceNumber`.

**Amended 2026-09-24 (`/speckit-clarify`).** Retries keep the clave when
there is one; the reference is only recorded. The one fallback: the clave is
the only disputed field, the shape rules do not settle it, and both readings
read the same reference with gate `ok`. Then the classification stays
`disputed` with no field asked, and `accepted` carries the reference with
`trackingKey: null` — the shape the D7 tiebreak already returns, with the
reference in the clave's place. The next attempt takes the transfer door
with that reference (costing only the slot the schedule was going to spend),
and the adoption of Banxico's clave (R4) closes the loop. When that search
comes back `not_found`, the lifecycle writes `disputed_fields =
["trackingKey", "referenceNumber"]` — the page asks for the clave **or** the
reference, either one enough — and the slots keep searching with the
reference meanwhile. An ambiguous answer is R7's case, not this one.

**Alternatives.** Compare both keys whenever both exist — rejected: a clave
already identifies the transfer, and a second axis of dispute adds questions
without adding certainty.

## R4 — Banxico's clave for every confirmation

**Found.** When the check confirms, the lifecycle adopts the CEP's clave onto
the row only in some cases: `adoptKey = cep.trackingKey && (!payment.trackingKey
? payment.proofMode === "receipt" : …)` (`direct-payments/validation.ts`). A
typed row with no clave — possible for the first time with this feature — would
confirm with `tracking_key` NULL, outside the unique index
`payments_business_tracking_idx` (direct-payment D8), so the same transfer
could pay twice. The index's own race handling (`isUniqueViolation` →
`invalid`, already used) is what makes adoption safe.

**Decision (D14).** Adoption also covers a row that has a reference and no
clave, whatever its `proof_mode`: the CEP's clave is written, and the unique
index refuses the second claimant exactly as it does today. This is FR-006,
and it is not optional: without it, the reference would reopen the double
payment direct-payment D8 closed.

## R5 — Where the stop lives

**Found.** Two-eyes-receipt already has this shape for its two refusals:
`/read` *reports* `isReceipt` and `legibility` and "cannot reject anybody";
the page refuses; and the engine's receipt door enforces the same rule,
throwing `RECEIPT_UNREADABLE` before the provider call. The engine still
declares `RECEIPT_INCOMPLETE` — "no door throws this since two-eyes-receipt
D3 … the code stays declared because callers still switch on it"
(`consta/failure.ts`).

**Decision (D15).** One pure function, `askBeforeCredit(extracted,
accounts)`, returns `null`, `{ reason: "no_key", fields }` or `{ reason:
"wrong_destination" }` (R14). `fields` lists `key`, `amount`, `date`,
`senderBank`, `account` — every field the typing form will need that the
capture did not show, the key first; `account` only when the ISP has more
than one and the destination did not tie to one. Both callers use it:
`extract()` puts it on the reading `/read` returns (the page renders it), and
the receipt door throws on it before the provider call — `RECEIPT_INCOMPLETE`
for `no_key`, carrying the fields; `RECEIPT_WRONG_DESTINATION` for the
other.
Nothing is billed; the lifecycle's catch already turns an engine failure into
`retryLater(code)`, and the draft's reading is reused on each slot
(two-eyes D14), so a client that skipped the page costs Workers AI calls at
most, never credits.

**Alternatives.** Page-only — rejected: FR-008 says "MUST NOT reach a paid
call" and a direct caller of the pay route would spend. Server-only, learned
from the status poll — rejected: the payer would see "verificando" and then
an ask, instead of the ask at once (SC-001).

## R6 — "Clear", "missing" and "no key"

**Found.** The reader's `legibility` is `full | partial | none | null`; null
means the model omitted it, or the reading is a PDF's text, and both "read as
`full`, because the bias is to let files through" (`reader.ts`). The gate
says `ok | malformed | missing` per field.

**Decision (D16).** The ask fires only when both keys are **missing** — not
malformed — and the reading is **certain**: `legibility === "full"` on a
picture, or any text reading of a PDF. A picture whose legibility the model
omitted goes through, as today: the stop flips two-eyes D2's bias, so it may
only fire where the verdict is explicit. A malformed clave is a reading the
provider may fix for the same credit, so it never stops.

## R7 — A reference that matches more than one transfer

**Found.** On the transfer door, the provider's 422 becomes `REQUEST_REJECTED`
with `hint: "provide_tracking_key"`; the lifecycle, like for every engine
failure, calls `retryLater(code)` — so today the next slot would send the same
request, and a rejected request bills like any call (measured 2026-08-19 on
the same-institution 400). Nothing asks the payer.

**Decision (D17).** On that hint the lifecycle records the ask — the
payment's `disputed_fields` becomes `["trackingKey"]` and its `last_error`
`REFERENCE_AMBIGUOUS` — and every later slot of that row **skips the
provider** while the row has no clave, riding the schedule to an honest
expiry unless the payer answers. The payer's answer is a correction like any
other (two-eyes D18 supersede) and takes the transfer door with the clave.
`REFERENCE_AMBIGUOUS` joins `publicPaymentError`, so the page can say why it
asks.

**Alternatives.** Retry with the image door — rejected: the provider's
picture reading would search by the same reference. Stop the row as
`invalid` — rejected: nothing is wrong with the payment; one field is
missing.

## R8 — The feedback, on the page

**Found.** The step "Envía tu comprobante" already shows a warning `Alert`
(icon + text) above the upload control for the two two-eyes refusals, from
`/read`'s answer, before any payment exists. `TransferForm` already pre-fills
from a draft and leaves a field empty when the draft has no value. The later
asks already name the disputed field (`disputedSet`), with per-field
sentences.

**Decision (D18).** The ask reuses that `Alert`, in the same place, and the
same `TransferForm`:

- the `Alert` carries three sentences built from `ask.fields` (key first,
  then the others in form order, then the hint), receives focus when it
  appears, and is announced;
- two buttons below it: "Subir otra captura" (focuses the picker) and
  "Escribir los datos" (opens the form);
- the form gains a key block — "Clave de rastreo" and "Número de referencia",
  with "Escribe al menos uno." — and, under each field the capture lacked,
  the text "No aparece en tu captura";
- when the ISP has more than one account, the form gains "¿A cuál cuenta
  transferiste?" (R13), pre-selected when the reading tied the destination;
- the count of keyless readings in one visit is page state; at two, the form
  renders first (a reload resets it, costing at most one more upload, never a
  credit — the server still stops);
- `wrong_destination` uses the same `Alert`: "Esta transferencia fue a otra
  cuenta, no a una de {ISP}. Revisa tu comprobante." with the same two
  buttons — typing is the way out of a misread digit, because typed data is
  never second-guessed (two-eyes FR-015).

The later asks keep their sentences and gain `referenceNumber` and the
`REFERENCE_AMBIGUOUS` sentence ("Tu número de referencia coincide con más de
una transferencia. Escribe tu clave de rastreo para encontrar la tuya."),
plus the bank hint line when the payment's bank has one.

## R9 — The bank hints

**Decision (D19).** es-MX copy in the payer app
(`apps/pago/src/features/pago/bank-hints.ts`), keyed by the `Bank` type the
schema re-exports so a name outside the vocabulary cannot compile, each entry
carrying its source and verification date. An entry is added only from a real
receipt or the bank's own documentation, read by a person. Launch: `BANORTE`
("toca «Ver más detalles» y captura esa pantalla", receipt 1, 2026-09-23),
plus any bank whose detail screen the product creator supplies before
implementation — BBVA, Azteca, Santander, Banamex, Nu and Spin are the
obvious next captures.

**Alternatives.** Seeding from third-party round-ups — rejected: a hint that
sends a payer to the wrong button is worse than the general one.

## R10 — The capture guide

**Found.** The step renders `ReceiptForm` inside the step card; the page has
its own shadcn primitives (`collapsible`, `native-select`) and the shared
atoms. Constitution VI: tokens only, status never colour alone, 360px floor,
no horizontal scroll, reduced motion.

**Decision (D20).** An app-local `CaptureGuide` (only this page renders it,
so it is not an atom): an inline SVG of a generic receipt drawn with token
classes (`fill-*`, `stroke-*` from `tokens.css` through Tailwind), four
numbered markers named in text beside the drawing, the three rules as a list,
the bank tips in the existing `Collapsible`. No motion. It sits above
`ReceiptForm`; nothing needing a tap is placed in front of the upload
control.

## R11 — Countability

**Found.** `extractions` records every reading with its outcome, bank, gate
and legibility, but not which proof it read (so an ask cannot be joined to
what the payer did next), not the references, and not the destination.

**Decision (D21).** `extractions` gains `proof_key` (its prefix is the link
id), `reference_number` (ours, as read) and `provider_reference_number`
(theirs), `destination_kind` and `destination_digits` (as the reader saw
them); its `outcome` vocabulary gains `key_missing` and `wrong_destination`
(TypeScript only, the column is text). Payments by the account that received
them are `payments.beneficiary` (R15). "How an ask ended" is then a query: the next extraction on
the same link, a payment on the link with `proof_mode = 'transfer'`, or
neither. Searches by reference are `validations` rows with
`reference_number` set and `tracking_key` NULL, already recorded.

## R12 — Card and phone at the provider, and who picks the account

**Found.** The engine already accepts every shape the provider documents:
`beneficiarySchema` takes exactly one of `clabe` (18), `phoneNumber` (10),
`cardNumber` (16), and the receipt door takes `potentialBeneficiaries`
(`consta/request.ts`); the adapter passes both through unchanged
(`provider/apicep.ts`, `requestBody`). The transfer door takes exactly one
beneficiary. The same-institution guard (`senderBank !== beneficiary.bank`,
validation.spec.md D17) applies to any account. Three gaps: (1) the facade's
`ConstaBeneficiary` type knows only a CLABE (`consta/index.ts`); (2) our
reader only runs on the receipt door when a single `beneficiary` is given
(`readable = … Boolean(body.beneficiary) …`), so a list today silences our
reading; (3) whether the provider's answer names the matching account is
unknown — `cepDetails` carries `receiverBank` and `beneficiaryName`, never an
account.

**Decision (D22).** The lifecycle hands the engine the ISP's accounts:
`beneficiary` when there is one, `potentialBeneficiaries` when there are more.
The engine reads the file in both cases (gap 2 closed), ties the reading's
destination to one account (R14), sends `beneficiary` when it could and
`potentialBeneficiaries` when it could not, and returns on the verdict the
account it used (`beneficiaryUsed`, null when it sent the list). The
lifecycle stores it on the payment (R15). `ConstaBeneficiary` is widened to
the three shapes (gap 1).

**Decision (D23).** A payment whose ISP has more than one account and whose
account is still unknown **keeps the receipt door** on every attempt, with
the list — exactly as a missing date keeps it (two-eyes plan D20). Accepted
data is "accepted" for the transfer door only once the account is known.
This removes the dependency on the provider naming the account (gap 3): the
design never needs it.

**Amended 2026-09-24 — the provider does name it, once Banxico confirms.**
The documentation (read in session, "What was measured") lists
`cepDetails.beneficiaryAccount` and `beneficiaryAccountType`; the adapter
drops both today (`provider/apicep.ts`, the `cepDetails` type and `cep`
mapping). Decision (plan D22, amended): the adapter keeps them on `cep`
(`beneficiaryAccount`, `beneficiaryAccountType`), and on a `valid` verdict
the lifecycle ties `beneficiaryAccount` to the payment's accounts with the
same `tieDestination` (R14) — Banxico's record outranks the receipt's
trailing digits:

- tied to one account → that account is written to `payments.beneficiary`,
  whatever `beneficiaryUsed` said;
- absent, or too few digits to tie → `beneficiaryUsed` stands, as before;
- whole enough to judge and fitting none of the payment's accounts → the
  payment is not confirmed: `invalid` with `TRANSFER_CONTRADICTED`, the
  code that already means "the CEP contradicts the claim".

D23 is unchanged: before a `valid` there is no `cepDetails`, so an unknown
account still keeps the receipt door with the list.

**Alternatives.** Tie the destination in the lifecycle before calling the
engine — rejected: the reading is the engine's (two-eyes D14 reuse), and
matching outside it would call the reader twice or move the reader's output
across the facade. Try the accounts one after another on the transfer door —
rejected by D10: a credit each, to learn nothing.

## R13 — The manual door with more than one account

**Found.** The manual door's `transfer` carries the key, bank, date and
amount; the beneficiary is server-side ("the client never sends its own
money", direct-payment D1). A typed row always takes the transfer door
(two-eyes FR-015), which needs one beneficiary.

**Decision.** `transfer` gains an optional `receivingAccount: "clabe" | "card"
| "phone"`, required when the link offers more than one account; naming an
account the ISP does not have is a `VALIDATION_ERROR` either way (amended
2026-09-24, analyze A1). It names
*which of the ISP's own accounts*; the number still comes from the server, so
direct-payment D1 holds. The page shows each choice with its last four
digits — none pre-selected on the manual door, the tied one pre-selected when
the form opens from a reading whose destination tied to an account.

## R14 — Reading the destination and tying it to an account

**Found.** The four receipts print the destination four ways: "CLABE
Internet.sis ****8195" (receipt 1), "Bbva Mexico ***195" (receipt 2),
"internet NETSIS •3819 Cuenta" (receipt 3 — the account number, not the
CLABE), "CUENTA/TARJETA DE ABONO ****3819" (receipt 4). A CLABE is
institution (3) + plaza (3) + account (11) + check digit (1); the ISP's CLABE
…8195 carries its account …3819 in positions 7–17, which is why receipt 3's
"•3819" is the same account.

**Decision (D24).** The reader gains `destino: { tipo: "clabe" | "tarjeta" |
"celular" | "cuenta" | null, digitos: "<the digits it can see, masks
removed>" }`. Tying is a pure function over **visible trailing digits**
against every form of each account: the whole CLABE, the CLABE's 11-digit
account segment, the card, the phone. Fewer than three visible digits is
*unknown*, never a mismatch (FR-020: hidden digits are not a mismatch). A
match on exactly one account ties it; a match on more than one — possible
with three digits — is unknown. A destination is a *mismatch* only when the
reading is clear (D16), at least three digits are visible, and they end none
of the forms — **all** the forms of **all** the ISP's accounts. `tipo`, when
known, only orders the search (`tarjeta` tries the card first; `cuenta` the
CLABE's account segment first); it never rules an account out.

**Amended 2026-09-24 (`/speckit-clarify`, the product creator).** The first
version let `tipo` narrow the forms tried. Receipts print "CUENTA/TARJETA DE
ABONO ****3819": a reader that calls it `tarjeta` while the digits end the
CLABE's account would have stopped a payment made to the ISP. The ISP's
accounts are known; if the visible digits end any of them, the destination
is the ISP's.

**Alternatives.** Match on the destination bank's name — rejected: receipts
print it a dozen ways ("BBVA MEXICO", "Bbva Mexico") and it cannot tell a card
from a CLABE at the same bank. Require four digits — rejected: receipt 2
shows three.

## R15 — What the payment remembers

**Found.** Today the beneficiary is rebuilt from the business on every
attempt (`direct-payments/validation.ts`, `const beneficiary = { bank:
business.speiBank, clabe: business.speiClabe, … }`), so a CLABE change already
moves in-flight payments — the case FR-021 now forbids for every account.

**Decision (D25).** Two additive JSON columns on `payments`:
`beneficiary_candidates` (the ISP's accounts at submission, when there were
more than one) and `beneficiary` (the one the money went to, once known — at
submission when the ISP has one account or the payer chose; from the
engine's `beneficiaryUsed` otherwise). Attempts read the payment, never the
business. A row with neither — every row born before this feature — keeps
today's fallback to the business's CLABE, so nothing in flight changes
(FR-027).

**Alternatives.** A `receiving_accounts` table with ids — rejected for now:
one card and one phone per ISP fit in columns, and a snapshot must not follow
an edit anyway.

## R16 — The card and the phone in the ISP's setup

**Found.** The CLABE lives on `businesses` (`spei_clabe`, `spei_bank`), is
edited in Cuenta (`apps/admin/src/features/settings/SettingsScreen.tsx`,
the bank chosen with the searchable `Combobox` over `BANK_OPTIONS`) through
`PATCH /settings`, and belongs to the `clabe` area, which only the owner holds
(`auth/role-matrix.ts`, business-and-memberships D3); roles that cannot update
settings read it masked to the last four.

**Decision (D26).** Four nullable columns on `businesses`: `spei_card`,
`spei_card_bank`, `spei_phone`, `spei_phone_bank`. They belong to the `clabe`
area (owner only) and are masked like the CLABE. Validation: the card is 16
digits and passes the Luhn check; the phone is 10 digits; each number travels
with its bank (both or neither); the bank is from the provider's vocabulary.
The CLABE stays required: `configured` keeps its meaning, so an ISP with only
a card is not "configured".

## R17 — Tests that assert what this feature changes

Two-eyes-receipt tests that assert a **fully legible picture with no clave**
reaches the provider are rewritten to assert the ask, cited
`receipt-triage US2` — found by stub readings with `claveDeRastreo: null` and
`legibilidad: "completa"` in `test/consta/validate.test.ts` and
`test/direct-payment.test.ts`. Tests of a *malformed* clave ("scenario 4: the
gate catches a clave's shape") and of a *partly legible* hole ("a partly
legible photo with a hole in it still buys the paid call (FR-005)") stay as
they are (D16). The pure `compareReadings` tests stay and gain reference
cases. The comment in `provider/apicep.ts` that says Devolada "cannot hit"
the 422 is rewritten.

## R18 — The reused reading must carry what this feature reads

**Found** (review of the plan against `main`, 2026-09-24). The receipt door
reuses the draft's reading instead of calling the reader again
(`recentReading`, `consta/extract.ts`, two-eyes D14). It rebuilds the
reading from the `extractions` row: clave, bank, amount, date, legibility —
and recomputes `passes` as clave **and** bank **and** amount. It filters
`outcome IN ('passed', 'gated')`. Nothing in the plan or the tasks touched
it, so after this feature:

- receipt 2 read at `/read` (reference `038195`, no clave) would come back
  from reuse with no reference — the ask (D15) would see two missing keys
  and stop the pay with `RECEIPT_INCOMPLETE`, the exact receipt Story 1
  exists to confirm;
- without the ask, the comparison would lose our reference and go `blind`;
- the destination would be lost too, so the account could never tie from a
  reused reading (D24).

**Decision (D28).** `recentReading` rebuilds everything the reader now
returns, from the columns D21 adds: `referenceNumber` from
`extractions.reference_number`, with its gate verdict re-derived by the
same pure function the gate uses (`ok | malformed | generic | missing` is a
function of the stored text, so nothing is lost — unlike the clave's gate,
which is stored because its shape rules can change); `destination` from
`destination_kind` and `destination_digits`; `passes` with the new rule
(either key). The outcome filter also admits `key_missing` and
`wrong_destination`: they hold a full reading, and a client that skipped the
page and pays with the same file inside the window must meet the same stop
without a second model call. A row written before the migration reads NULL
in the new columns — no reference, unknown destination — which is exactly
what it saw.
