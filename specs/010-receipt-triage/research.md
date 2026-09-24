# Research: receipt-triage

**Date**: 2026-09-23, rescoped 2026-09-24 · **Spec**: [spec.md](./spec.md) ·
**Plan**: [plan.md](./plan.md)

Phase 0. Each entry: what had to be known, what was found and where, the
decision, and what else was weighed. Decisions are numbered in the plan
(`receipt-triage D9`–`D19`); the spec holds D1–D8. This file replaces the
research of 2026-09-23, whose card, phone and Spin entries left the scope with
the spec (Clarifications, 2026-09-24); no code cites their numbers.

## What was measured, and what could not be

- **Production has no traffic yet.** Measured 2026-09-23 on
  `devolada-db-prod`: zero rows in `payments`, zero in `extractions`. The dev
  database holds two confirmed payments, both `NUBANK`. So how often a capture
  lacks both keys cannot be read from our records today; FR-022 makes it
  countable from the first real week.
- **The provider's documentation is not reachable from the build
  environment** (`apicep.cloud`, `www.apicep.cloud`: blocked by the egress
  proxy, 2026-09-23). What is known of the reference search comes from the
  text the product creator pasted in session: "`referenceNumber` — Payment
  reference number. Required if `trackingKey` is not sent", with the example
  `"referenceNumber": "0170126"`. The design below needs nothing only that page
  could settle (R4, R6).
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

**Decision (D9).** The reference is threaded through every one of those
layers as an optional sibling of the clave, with one rule everywhere: **a key
is a clave or a reference; the reference travels when there is no clave; both
travel when both exist.** Nothing about the clave's own path changes.

## R2 — What counts as a reference

**Found.** SPEI's referencia numérica is a number of up to seven digits,
entered by the sender (bank apps ask for "Referencia numérica — hasta 7
dígitos"); the provider's own example carries seven (`0170126`). Receipt 2
prints six ("038195", a leading zero). Receipt 3 — out of scope, but a good
warning — prints a ten-digit "Folio de operación" (0082918812), exactly the
kind of number a reader might mistake for a reference.

**Decision (D10).** The reader asks for the field labelled "Referencia" or
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

**Decision (D11).** The comparison's key is **the clave when either reading
found one, the reference otherwise**. When the key is the reference: equal
references (as text) agree; different ones dispute, and the disputed field is
`referenceNumber`; one side with none is blind. The shape rules have no
opinion on a reference (they are learned from claves) and never break a
reference tie — a disputed reference goes to the payer. `accepted` carries
`trackingKey | null` and `referenceNumber | null`, at least one set.
`DisputedField` gains `referenceNumber`.

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

**Decision (D12).** Adoption also covers a row that has a reference and no
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

**Decision (D13).** One pure function, `askBeforeCredit(extracted)`, returns
`null` or `{ fields }`, where `fields` lists `key`, `amount`, `date`,
`senderBank` — every field the typing form will need that the capture did not
show, the key first. Both callers use it: `extract()` puts it on the reading
`/read` returns (the page renders it), and the receipt door throws
`RECEIPT_INCOMPLETE` on it before the provider call, carrying the fields.
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

**Decision (D14).** The ask fires only when both keys are **missing** — not
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

**Decision (D15).** On that hint the lifecycle records the ask — the
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

**Decision (D16).** The ask reuses that `Alert`, in the same place, and the
same `TransferForm`:

- the `Alert` carries three sentences built from `ask.fields` (key first,
  then the others in form order, then the hint), receives focus when it
  appears, and is announced;
- two buttons below it: "Subir otra captura" (focuses the picker) and
  "Escribir los datos" (opens the form);
- the form gains a key block — "Clave de rastreo" and "Número de referencia",
  with "Escribe al menos uno." — and, under each field the capture lacked,
  the text "No aparece en tu captura";
- the count of keyless readings in one visit is page state; at two, the form
  renders first (a reload resets it, costing at most one more upload, never a
  credit — the server still stops).

The later asks keep their sentences and gain `referenceNumber` and the
`REFERENCE_AMBIGUOUS` sentence ("Tu número de referencia coincide con más de
una transferencia. Escribe tu clave de rastreo para encontrar la tuya."),
plus the bank hint line when the payment's bank has one.

## R9 — The bank hints

**Decision (D17).** es-MX copy in the payer app
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

**Decision (D18).** An app-local `CaptureGuide` (only this page renders it,
so it is not an atom): an inline SVG of a generic receipt drawn with token
classes (`fill-*`, `stroke-*` from `tokens.css` through Tailwind), four
numbered markers named in text beside the drawing, the three rules as a list,
the bank tips in the existing `Collapsible`. No motion. It sits above
`ReceiptForm`; nothing needing a tap is placed in front of the upload
control.

## R11 — Countability

**Found.** `extractions` records every reading with its outcome, bank, gate
and legibility, but not which proof it read (so an ask cannot be joined to
what the payer did next) and not the references.

**Decision (D19).** `extractions` gains `proof_key` (its prefix is the link
id), `reference_number` (ours, as read) and `provider_reference_number`
(theirs); its `outcome` vocabulary gains `key_missing` (TypeScript only, the
column is text). "How an ask ended" is then a query: the next extraction on
the same link, a payment on the link with `proof_mode = 'transfer'`, or
neither. Searches by reference are `validations` rows with
`reference_number` set and `tracking_key` NULL, already recorded.

## R12 — Tests that assert what this feature changes

Two-eyes-receipt tests that assert a **fully legible picture with no clave**
reaches the provider are rewritten to assert the ask, cited
`receipt-triage US2` — found by stub readings with `claveDeRastreo: null` and
`legibilidad: "completa"` in `test/consta/validate.test.ts` and
`test/direct-payment.test.ts`. Tests of a *malformed* clave ("scenario 4: the
gate catches a clave's shape") and of a *partly legible* hole ("a partly
legible photo with a hole in it still buys the paid call (FR-005)") stay as
they are (D14). The pure `compareReadings` tests stay and gain reference
cases. The comment in `provider/apicep.ts` that says Devolada "cannot hit"
the 422 is rewritten.
