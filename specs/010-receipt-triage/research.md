# Research: receipt-triage

**Date**: 2026-09-23 · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Phase 0. Each entry: what had to be known, what was found and where, the
decision, and what else was weighed. Decisions are numbered in the plan
(`receipt-triage D6`–`D19`); the spec holds D1–D5.

## What was measured, and what could not be

- **Production has no traffic yet.** Measured 2026-09-23 on
  `devolada-db-prod`: zero rows in `payments`, zero in `extractions`. The dev
  database holds two confirmed payments, both `NUBANK`. So no rate in this
  feature (how often the clave is missing, which banks send the summary
  screen) can be read from our records today; FR-023 exists so that it can be
  from the first real week.
- **The provider's documentation is not reachable from the build
  environment** (`apicep.cloud` and `www.apicep.cloud` are blocked by the
  egress proxy, 2026-09-23). What is known of the card, phone and candidate
  modes comes from the text the product creator pasted in session and from a
  search-engine summary of the same page. Nothing in the design below depends
  on a detail only that page could settle (R3, R4).
- **Spin by OXXO is a SPEI participant in its own right.** Public sources
  (FEMSA and El Universal on the authorisation, Milenio, STP's own page;
  2026-09-23) say Spin was authorised by Banxico for a direct connection to
  SPEI and appears as its own institution (code 90728), while STP is 90646;
  customers keep sending from their STP CLABE until they are assigned a Spin
  one. So a Spin transfer may be recorded under either institution, and the
  one that applies is the one the payer's own account belongs to (R8).

## R1 — Where the stop-before-credit rule lives

**Question.** The spec stops three kinds of receipt before any paid call: a
clear capture with no clave (FR-001), a Spin movement that is not SPEI
(FR-020), and a clear capture whose destination matches none of the ISP's
identifiers (FR-016). The page must show them, and the server must not spend
on them if a client skips the page.

**Found.** Two-eyes-receipt already has this shape for its two refusals:
`/read` *reports* `isReceipt` and `legibility` and "cannot reject anybody";
the page refuses; and the engine's receipt door enforces the same rule
server-side, throwing `RECEIPT_UNREADABLE` before the provider call
(`consta/validate.ts`, the `!reading.isReceipt || reading.legibility ===
"none"` branch). The engine also still declares `RECEIPT_INCOMPLETE` — "No
door throws this since two-eyes-receipt D3 … the code stays declared because
callers still switch on it" (`consta/failure.ts`).

**Decision (D6).** One function in the engine,
`stopBeforeCredit(extracted, receivingAccounts)`, returns `null` or
`{ reason, fields }`, with reason `key_missing | not_spei |
wrong_destination`. Both callers use it: `extract()` puts it on the reading
the `/read` route returns (the page renders it), and the receipt door throws
on it before the provider call — `RECEIPT_INCOMPLETE` revived for
`key_missing`, two new codes `RECEIPT_NOT_SPEI` and
`RECEIPT_WRONG_DESTINATION`. The lifecycle's catch already turns any engine
failure into `retryLater(code)`; nothing is billed on these, and the row
carries the code the page can map.

**Alternatives.** Page-only (as the two-eyes refusal *messages* are) — rejected:
FR-001 says "MUST NOT reach a paid call", and a direct caller of the pay route
would spend. Server-only, the page learning it from the status poll —
rejected: the payer would see "verificando" and then an ask, instead of the
ask at once (SC-001 says "within the same interaction").

## R2 — What "clear" and "missing" mean for the key stop

**Found.** The reader's `legibility` is `full | partial | none | null`; null
means the model omitted it, or the reading came from a PDF's text, and "both
read as `full`, because the bias is to let files through" (`reader.ts`). The
gate's `trackingKey` is `ok | malformed | missing`. A `malformed` clave is
something the model read that failed the shape check — the two-line wrap, a
27-character misread — and the provider may read it right.

**Decision (D7).** The key stop fires only when **the gate says `missing`**
and the reading is **certain**: `legibility === "full"` on a picture, or any
text reading of a PDF (a PDF's text has no blur to hide a clave under). A
picture whose legibility the model omitted goes through, as today: the stop
flips two-eyes D2's bias, so it may only fire where the verdict is explicit.

**Decision (D8).** `malformed` never stops. It is a reading, not an absence,
and the provider's own reading is the cheap way to fix it (two-eyes D5 already
keeps a malformed clave from arguing with the provider's).

**Alternatives.** Treat null as full (the reader's own convention) — rejected
for this one rule: a convention chosen to *let files through* cannot be reused
to *stop* them. Stop on `malformed` too — rejected: it would send the payer to
type a clave the provider could have read for the same credit.

## R3 — Card and phone at the provider, and who picks the identifier

**Found.** The engine already accepts every shape the provider documents:
`beneficiarySchema` takes exactly one of `clabe` (18), `phoneNumber` (10),
`cardNumber` (16), and the receipt door takes `potentialBeneficiaries`
(`consta/request.ts`); the adapter passes both through unchanged
(`provider/apicep.ts`, `requestBody`). The transfer door takes exactly one
beneficiary. The same-institution guard (`senderBank !== beneficiary.bank`,
validation.spec.md D17) applies to any identifier. Two gaps: (1) our reader
only runs on the receipt door when a single `beneficiary` is given (`readable
= … Boolean(body.beneficiary) …`), so a candidate list today silences our
reading; (2) whether the provider's answer names the matching candidate is
**unknown** (see "What was measured") — `cepDetails` carries `receiverBank` and
`beneficiaryName`, never an account.

**Decision (D9).** The lifecycle hands the engine the ISP's identifiers:
`beneficiary` when there is one, `potentialBeneficiaries` when there are more.
The engine reads the file in both cases (gap 1 closed), narrows the list to
one identifier by the reading's destination (R5), sends `beneficiary` when it
narrowed and `potentialBeneficiaries` when it could not, and returns on the
verdict the identifier it used (`beneficiaryUsed`, null when it sent the
list). The lifecycle stores it on the payment.

**Decision (D10).** An ISP with more than one identifier and a payment whose
identifier is still unknown **keeps the receipt door** on every attempt, with
the candidate list — exactly as a missing date keeps it (two-eyes plan D20).
Accepted data is only "accepted" for the transfer door once the identifier is
known. This removes the dependency on the provider naming the candidate: the
design never needs it.

**Alternatives.** A lifecycle-side match before calling the engine — rejected:
the reading is the engine's (D14 reuse), and matching outside it would call
the reader twice or move the reader's output across the facade. Trying the
identifiers one after another on the transfer door — rejected by D2 of the
spec: a credit each, to learn nothing.

## R4 — The manual door with more than one identifier

**Found.** The manual door's `transfer` carries clave, bank, date and amount;
the beneficiary is server-side ("the client never sends its own money",
direct-payment D1). A typed row always takes the transfer door (two-eyes
FR-015), which needs one beneficiary.

**Decision.** `transfer` gains an optional `receivingAccount: "clabe" | "card"
| "phone"`, required by the server when the link offers more than one
identifier (a `VALIDATION_ERROR` otherwise) and ignored when it offers one. It
names *which of the ISP's own identifiers*; the number still comes from the
server, so the rule of direct-payment D1 holds. The page shows the choice
masked (last four digits).

## R5 — Reading the destination and matching it

**Found.** The four receipts print the destination four ways: "CLABE
Internet.sis ****8195" (receipt 1), "Bbva Mexico ***195" (receipt 2),
"internet NETSIS •3819 Cuenta" (receipt 3 — the account number, not the
CLABE), "CUENTA/TARJETA DE ABONO ****3819" (receipt 4). A CLABE is
institution (3) + plaza (3) + account (11) + check digit (1); the ISP's CLABE
…8195 carries its account …3819 in positions 7–17 — which is why receipt 3's
"•3819" is the same account.

**Decision (D11).** The reader gains `destino: { tipo: "clabe" | "tarjeta" |
"celular" | "cuenta" | null, digitos: "<the digits it can see, masks
removed>" }`. Matching is a pure function over **visible trailing digits**
against every form of each identifier: the whole CLABE, the CLABE's 11-digit
account segment, the card, the phone. Fewer than three visible digits is
*unknown*, never a mismatch (FR-016: masked digits are not a mismatch). A
destination is a *mismatch* only when the reading is clear (D7's
definition), at least three digits are visible, and they end none of the
forms. A *match* on exactly one identifier narrows (D9); a match on more than
one — possible with three digits — is unknown.

**Alternatives.** Match on the destination bank name — rejected: receipts
print it a dozen ways ("BBVA MEXICO", "Bbva Mexico") and it cannot tell a
card from a CLABE at the same bank. Require four digits — rejected: receipt 2
shows three.

## R6 — What the payment remembers

**Found.** Today the beneficiary is rebuilt from the business on every
attempt (`direct-payments/validation.ts`, `const beneficiary = { bank:
business.speiBank, clabe: business.speiClabe, … }`), so a CLABE change today
already moves in-flight payments — the case FR-017 now forbids for every
identifier.

**Decision (D12).** Two additive JSON columns on `payments`:
`beneficiary_candidates` (the ISP's identifiers at submission) and
`beneficiary` (the one the money went to, once known — at submission when the
ISP has one identifier or the payer chose; from the engine's `beneficiaryUsed`
otherwise). Attempts read the payment, never the business. A row with neither
— every row born before this feature — keeps today's fallback to the
business's CLABE, so nothing in flight changes (FR-022).

**Alternatives.** A `receiving_accounts` table with ids — rejected for now:
one card and one phone per business (spec Assumptions) fit in columns, and a
snapshot must not follow an edit anyway.

## R7 — The card and the phone in the ISP's setup

**Found.** The CLABE lives on `businesses` (`spei_clabe`, `spei_bank`), is
edited in Cuenta (`apps/admin/src/features/settings/SettingsScreen.tsx`)
through `PATCH /settings`, and belongs to the `clabe` area, which only the
owner holds (`auth/role-matrix.ts`, business-and-memberships D3); roles that
cannot update settings read it masked to the last four. `bankForClabe`
pre-selects the bank from the CLABE's prefix.

**Decision (D13).** Four nullable columns on `businesses`: `spei_card`,
`spei_card_bank`, `spei_phone`, `spei_phone_bank`. They belong to the `clabe`
area (owner only) and are masked like the CLABE. Validation: the card is 16
digits and passes the Luhn check; the phone is 10 digits; each number travels
with its bank (both or neither); the bank is from the provider's vocabulary.
The CLABE stays required: `configured` keeps its meaning, so a business with
only a card is not "configured" (spec Assumptions).

## R8 — Spin: which institution, and which movements

**Found.** As measured above, Spin is institution 90728 (`SPIN BY OXXO` in the provider's
vocabulary), and accounts not yet migrated send from STP (90646, `STP`).
`bankForClabe` already maps both prefixes (`728`, `646`). The reader names
the sending bank from the vocabulary, so a Spin receipt reads as `SPIN BY
OXXO` whatever account it came from. The provider answers a wrong sending
bank with a faceless `not_found` (validation.spec.md D12, measured
2026-08-19).

**Decision (D14).** The reader gains `cuentaOrigen` — the origin account's
digits as printed, leading digits included when visible. For a Spin reading,
the institution is **established** only when the origin shows a full CLABE
prefix: `bankForClabe` gives `SPIN BY OXXO` (728) or `STP` (646), and that is
the bank the accepted data carries. Otherwise it is **not established**: the
first call is the image door as for every receipt (two-eyes D3), and the
accepted data is not "accepted" for the transfer door (the D10 rule, applied
to the sending side), so no retry ever names a guessed Spin bank. On the
manual door the payer's pick stands (two-eyes FR-015); the picker's `SPIN BY
OXXO` entry says, in es-MX, that a CLABE starting with 646 is `STP`.

**Decision (D15).** The reader gains `operacion: "spei" | "misma_institucion"
| "efectivo" | null`. It is **recorded for every receipt** (countable, and
the ground a same-bank feature will stand on) and **acted on only for Spin**
(spec scope): a clear Spin reading with `misma_institucion` or `efectivo`
stops as `not_spei` (R1), unless it prints a clave (spec Edge Cases: a clave
on the receipt means Banxico may have it).

**Alternatives.** Map `SPIN BY OXXO` → `STP` by default — rejected: new
accounts are 728, and a default is a guess. Send both institutions — rejected:
two credits per Spin receipt.

## R9 — The bank hints

**Found.** No confirmed traffic to count (see "What was measured"), so SC-003's first version ("the
list at launch covers every sending bank in the product's confirmed payments")
cannot be met or tested today. Where each app shows the clave is only known
for sure from a real receipt or from the bank's own help. Receipt 1 shows
Banorte's summary with "Ver más detalles". BBVA's own help page ("Cómo
rastrear una transferencia bancaria paso a paso", bbva.mx) exists but could
not be read from the build environment (egress blocked, 2026-09-23), and
third-party round-ups disagree with each other and age with every app
release.

**Decision (D16).** The hints are es-MX copy in the payer app
(`apps/pago/src/features/pago/bank-hints.ts`), keyed by the `Bank` type so a
name the vocabulary does not know cannot compile, each entry carrying its
source and the date it was verified. An entry is added only from a real
receipt or the bank's own documentation, read by a person; every other bank
gets the generic hint. Launch list: Banorte (receipt 1), plus every bank whose
detail screen the product creator supplies before implementation — BBVA,
Azteca, Santander, Banamex, Nu and Spin are the obvious next captures. SC-003
is amended accordingly (spec, amended 2026-09-23).

**Alternatives.** A table in D1 editable from the operator panel — rejected
for now: copy with a deploy is how every other es-MX string ships, and the
list is small. Seeding from third-party round-ups — rejected: a hint that
sends a payer to the wrong button is worse than the generic one.

## R10 — "A second capture still has no clave"

**Decision (D17).** Page state, not server state: before the payer pays there
is no payment row, and the `/read` calls of one visit are the only captures
that count. The proof step counts keyless readings; at two, the typing form
leads and the upload becomes the second option. A reload resets the count —
acceptable, because the cost of a reset is one more upload, never a credit
(the stop still holds on the server).

## R11 — The capture guide

**Found.** The step renders `ReceiptForm` inside the step card; the payer
page has its own shadcn primitives (`collapsible`, `native-select`) and the
shared atoms from `@devolada/ui`. Constitution VI: tokens only, status never
colour alone, 360px floor, no horizontal scroll, reduced motion.

**Decision (D18).** An app-local `CaptureGuide` component (only this page
renders it, so it is not an atom): an inline SVG of a generic receipt drawn
with token classes (`fill-*`, `stroke-*` from `tokens.css` through Tailwind),
with numbered markers whose labels are text beside the picture — so nothing
is marked by colour alone; three rules as a list; the bank tips in the
existing `Collapsible`. No motion. It sits above `ReceiptForm`; nothing is
placed in front of the upload control.

## R12 — Countability

**Found.** `extractions` records every reading with its outcome, bank, gate
and legibility, but not which link or proof it read, so "how did an ask end"
cannot be joined to what the payer did next.

**Decision (D19).** `extractions` gains `proof_key` (the link id is its
prefix), `destination_kind`, `destination_digits` and `operation`; its
`outcome` vocabulary gains `key_missing`, `not_spei` and `wrong_destination`
(a TypeScript enum on a text column — no DDL). "How an ask ended" is then a
query: the next extraction on the same link (new capture), a payment on the
link with `proof_mode = 'transfer'` (typing), or neither (abandoned).

## R13 — Tests that assert what this feature changes

Two-eyes-receipt tests that assert a **fully legible picture with no clave**
reaches the provider must be rewritten to assert the stop, cited
`receipt-triage US1`; the implementation finds them by the stub readings
with `claveDeRastreo: null` and `legibilidad: "completa"` in
`test/consta/validate.test.ts` and `test/direct-payment.test.ts`. Tests of a
*malformed* clave (e.g. "scenario 4: the gate catches a clave's shape") and
of a *partly legible* hole ("a partly legible photo with a hole in it still
buys the paid call (FR-005)") stay as they are: D7 and D8 keep both paths.
The pure comparison tests in the same file (`compareReadings`) are untouched.
