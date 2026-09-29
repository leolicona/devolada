# Research: cep-bundle-match

**Date**: 2026-09-27 · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Phase 0. Each entry: what had to be known, what was found and where, the
decision, and what else was weighed. Decisions are numbered in the plan
(`cep-bundle-match D1`–`D16`) and cited in code in that form.

## What was measured, and what could not be

- **The provider's three answers to a search** — measured 2026-09-26 with
  `scripts/apicep-probe.sh` (lots 1–3, `.specify/bugs/reference-finds-
  other-transfer/measurement.md`) and read again whole on 2026-09-27 from
  the creator's machine, where they now live in
  `~/labs/devolada-evidencia/` (R1).
- **Eight CEPs opened** — E1 (3), E6 (3), F1 (2), all to the demo BBVA
  account, all from one Azteca sender. Read on 2026-09-27 with a spike
  reader in the session scratchpad; nothing with a name, RFC or account
  entered the repo (R3, R4, R5).
- **The seal** — the certificate the CEPs name was fetched from the SAT's
  public repository on 2026-09-27 with the creator's approval, and every
  seal was checked against it: 0 of 8 (R2).
- **Not measured**: whether the receipt door (the provider's OCR mode) also
  answers with a bundle — every measured bundle came from a search by
  reference with a date (R17); whether a bundle answer marks its claves as
  "validated before" at the provider (R13 makes it not matter); a sender
  account of a type other than CLABE (the label admits it, no sample has
  it, R8); a CEP whose names carry Ñ or accents (they do not matter: names
  are dropped, R5).

## R1 — What the provider answers: several, one, none

**Found** (2026-09-26, read whole 2026-09-27):

| Field | Several matches (E1, E3, E6, F1, F2, G5) | One match (E2, F3…) | None (E4, E7) |
| --- | --- | --- | --- |
| HTTP | 200 | 200 | 200 |
| `status` | `invalid` | `valid` | `invalid` |
| `validation.banxicoConfirmed` | `true` | `true` | `false` |
| `validation.cepStatus` | absent | `LIQUIDADO` | absent |
| `validation.cepDetails` | absent | the CEP | absent |
| `validation.cepPreviouslyValidated` | `null` | `true` / `false` | `null` |
| `downloads` | `cepPdf` only | `cepXml` and `cepPdf` | `{}` |
| time | 4.4–5.7 s | 3.8–8.2 s | 0.6–1.7 s |

- `downloads.cepPdf` of a several answer is a public URL on
  `storage.apicep.cloud` — no token — named by the reference and what reads
  as the call's epoch milliseconds (`9784417-1790446947555.pdf`, called
  2026-09-26 ~18:23 UTC). Guessable from the reference, which for Azteca
  is the business's CLABE's last seven digits.
- A one-match `valid` carries in `cepDetails` more than the adapter reads
  today: `processingTime` (the credit time, `HH:MM:SS`), `speiKey`,
  `cdaChain` (the cadena original in one line, followed by its seal —
  R5, amended 2026-09-29), `certificateNumber`,
  `senderAccountType`, `senderAccount` (whole), `senderRfc`,
  `beneficiaryRfc`, `paymentConcept`, `iva`. `operationDate` is the
  **operation** day; the credit day is only in `cdaChain`.
- The top-level `processingTime` object (`ocr`, `validation`, `total`) is
  the provider's latency — not the credit time.
- Today `mapVerdict` (`consta/provider/apicep.ts`) never reads
  `banxicoConfirmed`: an `invalid` with no `cepDetails` and no `cepStatus`
  is `not_found`, so a several answer rides the `not_found` schedule
  (`REVALIDATION_OFFSETS_MINUTES` + `LATE_SLOT_MINUTES`, about eight paid
  calls over twelve hours) and ends `expired`. `downloads` reaches the
  engine's verdict and is never stored.

**Decision (D1).** "Several" is its own provider reason: `status:
"invalid"`, `reason: "several"`, recognised by `banxicoConfirmed === true`
with no `cepDetails`, no `cepStatus` and a `downloads.cepPdf`. It is written
to `validations.reason` like the other two, so the billing log says what the
provider said. The adapter also reads `processingTime`, `cdaChain`,
`senderAccountType` and `senderAccount` on a `valid` (D4). A `banxicoConfirmed:
true` answer without the link is still `not_found` — nothing to open.

**Alternatives.** A new top-level status beside `valid`/`pending`/
`invalid`: rejected — the provider said `invalid`; the log keeps its words
and the reason says which `invalid` (the D11 pattern of `consta`).

## R2 — The seal cannot be verified

**Found** (2026-09-27):

- Every CEP carries the cadena, the seal (base64, 256 bytes: an RSA-2048
  signature) and "Número de Serie del Certificado de Seguridad de la
  institución receptora del pago" — a number, never the certificate. All
  eight carry `00001000000515660608` (BBVA as receiver).
- The SAT serves a certificate under that number
  (`rdc.sat.gob.mx/rccf/…/00001000000515660608.cer`, 1,593 bytes,
  `application/x-x509-ca-cert`, issued by the SAT's "SAT-IES Authority"):
  the e.firma of an unrelated private person. Opening each seal with its
  public key gives a random block (`34f82080…`), not PKCS#1 padding
  (`0001ffff…`): 0 of 8 verify, whatever the cadena's join.
- Banxico's security infrastructure (IES) has three certifying agencies —
  Banxico, SAT, CECOBAN — each numbering its own certificates; the CEP
  names no agency. Banxico publishes the agencies' certificates, not the
  banks' ("Certificados de la IES", banxico.org.mx). The CEP XML also
  carries only the number (apiCEP's documentation of the XML fields).
- The seal already arrives with every `valid` (`cepDetails.digitalSignature`)
  and has never been checked (`consta/index.ts` passes it; nothing reads it).
- The clave and the reference are **not** in the cadena (8 of 8, and the
  `valid`'s `cdaChain`): even a verified seal would not cover them.

**Decision (D2).** No seal verification. A bundle is trusted as the
provider's answer, exactly as every `valid` is: one call, no second call by
clave (clarification amended 2026-09-27). The seal is stored with each CEP
record and marked not verified, so a future verifier can run over history.

**Alternatives.** A second call by clave per chosen CEP (option B of the
session): rejected — it asks the same source again and adds no trust; it
would buy only the provider's "validated before" flag (R13 covers what it
guards) and the XML, at one credit and about five seconds per payment, and
it carries an unmeasured risk: if a several answer marks its claves as
validated, the second call would refuse the true owner. Verifying against
Banxico's own validator: manual, captcha — not a runtime path. Asking
Banxico (`ies@banxico.org.mx`) how bank certificates are obtained: open,
not blocking; it matters first for files a person uploads (spec 012).

## R3 — Reading the bundle

**Found** (2026-09-27, the three ZIPs):

- Magic bytes `50 4B 03 04`; general-purpose flag `0x0808` (sizes in a data
  descriptor, UTF-8 names), so entry sizes come from the central directory.
  No folders. Entries `CEP-<AAAAMMDD operation day>-<clave>.pdf`, each
  28,727–28,728 bytes; the ZIP barely compresses them (E1: 83,242 bytes for
  86,183).
- Banxico's batch (spec 012) names the same PDFs `[<AAAA-MM-DD credit
  day>]<clave>.pdf`: the two sources put **different days** in the name for
  one transfer.
- Workers have `DecompressionStream` ("deflate", "deflate-raw") but no ZIP
  reader; `apps/api` has no zip or pdf dependency today.

**Decision (D3).** The bundle is recognised by its first bytes — `PK\x03\x04`
a ZIP, `%PDF-` a single CEP (a bundle of one) — never by its name or
`Content-Type`. It is unzipped with `fflate` (`unzipSync`, entries filtered
by name before inflating), the same library tests use to build fixtures
(`zipSync`, `zlibSync`). The clave comes from the entry name, cross-checked
with the "Clave de rastreo" printed inside; a mismatch makes the CEP
unreadable. Days never come from a name. An entry whose clave the business
already holds as a record (R6) is not opened again.

**Alternatives.** Own ZIP reader over `DecompressionStream("deflate-raw")`:
viable, but tests would need a hand-written ZIP writer too; `fflate` is
~8 KB, pure JS, and gives both sides. Workers AI `toMarkdown`: a
conversion, not a copy — Markdown uses `|` for tables, a call per file, and
an answer we would have to stub; rejected for exact fields.

## R4 — Reading a CEP's text

**Found** (2026-09-27, eight PDFs): PDF 1.5 by JasperReports 6.20 over
OpenPDF 1.3.30; one font, `WinAnsiEncoding`, no `ToUnicode`; two
`FlateDecode` streams (the page, one image); no signature dictionary, no
embedded certificate. Text runs are `Tm` + `Tj`/`TJ`, decoded as cp1252.
Labels, verbatim: "Clave de rastreo", "Cadena Original (información del
pago):", "Sello Digital (firma provista por la institución receptora del
pago):", "Número de Serie del Certificado de Seguridad de la institución
receptora del pago", and the footnote "*La hora de abono corresponde al huso
horario que rige en la Ciudad de México.". The cadena prints over **three**
lines: one break falls inside the beneficiary's name (the break ate a
space), one inside the certificate number (no space). A first spike reader
failed on 1 of 8 files: it cut each stream at the line break before
`endstream`, and that file's last compressed byte was a line break — a
stream must be sliced by its declared `/Length`.

**Decision (D3, cont.).** A purpose-built reader of this layout
(`consta/bundle/cep-pdf.ts`): streams sliced by `/Length`, inflated with
`fflate`, runs decoded as cp1252, the cadena taken as the lines between its
label and the seal's, joined **without** spaces. Anything unexpected —
no label, no cadena, a clave that disagrees with the name — makes the CEP
unreadable: it confirms nothing and is flagged (FR-002), which fails toward
asking the clave, never toward a wrong pick.

**Alternatives.** pdf.js through `unpdf`: general, but a large bundle and a
worker shim in the Worker for one fixed document from one generator; its
text items would still need the same label logic. Rejected.

## R5 — The cadena original

**Found** (eight CEPs and the `valid`'s `cdaChain`): version `01`, 43
fields, pipe-separated, `||` at both ends. Positions used here (1-based
after the leading `||`): 1 version; 2 operation day `DDMMAAAA`; 3 credit
day `DDMMAAAA`; 4 credit time `HHMMSS`; 5 receiver's SPEI code; 6 sending
bank; 7 sender's name; 8 sender's account type; 9 sender's account; 10
sender's RFC/CURP; 11 receiving bank; 12 beneficiary's name; 13
beneficiary's account type; 14 beneficiary's account; 15 beneficiary's
RFC/CURP; 16 concept; 17 IVA; 18 amount (`3.00`); last, the certificate
number. No clave, no reference.

**Decision (D4).** One parser, `parseCadena(text)`, for both sources — a
bundle's three joined lines and a `valid`'s `cdaChain`. It requires version
`01`, valid days and time, digits for accounts and a decimal amount, and
returns only what matching needs: days, time, the credit instant, account
types and accounts, banks, amount in cents (`amountToCents` on the string,
constitution II), certificate number. Names and RFC/CURP never leave the
parser (FR-006, FR-010 by construction). The credit instant is the credit
day and time in `America/Mexico_City` — the CEP's own footnote — as epoch
ms. Joining without spaces is exact for every field kept: none holds a
space; the names it glues are the ones dropped.

**Amended 2026-09-29** (bug `single-cep-unreadable`). A `valid`'s
`cdaChain` does not end at its closing bars: its seal follows them,
`||<43 fields>||<344 base64 characters>`. Found on six answers the creator
asked for again with `scripts/apicep-probe.sh` — Azteca 1, Nu 4 (three
transfers), Klar 1; by clave and by reference; first and repeated — read
through a filter that kept each field's kind and length and no value. The
eight CEPs' printed cadenas do end at the bars. Every one of the six had
the same 43 fields and version `01`, `processingTime` equal to the
cadena's credit time, and the credit day of the day the money arrived:
Klar's, sent 2026-09-28 at 19:30:50 and filed under the 29th, kept the
28th. A parser that required `||` at the end read none of them — dev held
no record of a single `valid` by 2026-09-29. The decision stands with one
change: the closing bars are the last `||`, and what follows them is a
base64 seal or nothing; the seal is dropped there, and the record keeps
`digitalSignature` (D2).

## R6 — What is kept, and where

**Found.** Payments, proofs and the billing log all live under
`business_id` (constitution V); proofs sit privately in R2 `PROOFS` behind
signed URLs (D12 of direct-payment). The creator decided the bundle is kept
under the business (session 2026-09-27); the spec keeps it as long as its
payment.

**Decision (D5).** Two tables, written by the engine:

- `cep_bundles` — one per several answer: the payment and the provider
  call it came from, the search keys, the status (`pending` → `read` |
  `unreadable` | `too_large`), download attempts, the claves it holds (from
  the entry names), the file's SHA-256 and its R2 key. The provider's URL
  is kept only until the file is read, then cleared; it never leaves the
  API (FR-010).
- `cep_records` — one per transfer the business's searches without a clave
  have returned, bundle or single `valid`, unique by `(business_id,
  clave)`: days, time, credit instant, banks, account types and accounts,
  destination, amount, certificate number and the seal (`seal_status =
  'not_verified'`).

The raw file goes to `PROOFS` under a `bundles/<business_id>/` prefix, so it
follows the bucket's 15-day lifecycle rule like every receipt (set by hand,
`wrangler.jsonc`); the records stay. Which transfer a payment took is the
payment's own `tracking_key` (adopted, D8 of direct-payment); "used" and
"unmatched" are queries, never a stored fate.

Neither is written for the platform's own top-ups: those calls are owned
by the platform (`consta(env, db, { platform: true })`, `business_id` NULL
in `validations`), and a record belongs to the business that received the
money. For them a several answer stays what it is today, `not_found`.

**Alternatives.** A fate column per record: two writers (engine and
lifecycle) on one row and a state that can drift from the payments that
define it. Rejected.

## R7 — The window and the margin

**Found.** Receipt → credit gaps measured 2026-09-26: +8 s, +22 s, about
+60 s — the credit after the send every time. F1's two transfers from one
sender were credited 83 s apart. Receipts print `HH:MM` (most) or
`HH:MM:SS` (Azteca).

**Decision (D6).** For each candidate, `d = credit instant − receipt
instant`. A candidate is inside when `−60 s ≤ d ≤ +180 s`; a receipt that
prints `HH:MM` is the whole minute, so its `d` is an interval and the
candidate is inside when the interval meets the window. Among those inside,
the nearest by `|d|` (by the interval's nearest point for `HH:MM`) is
chosen — unless the two nearest were credited within 30 s of each other,
which is "too close to call". Instants carry the day, so midnight needs
nothing special. `d` is recorded in whole seconds on every confirmation
(`match_distance_s`), so the window can be measured again from real
traffic (clarified 2026-09-27).

## R8 — The account tail

**Found.** Azteca's "***8301" is positions 14–17 of the sender's CLABE
(the account number's end; the CLABE ends in 3010). The CEP labels the
sender's account "CLABE, Tarjeta de débito, Número de celular", and the
cadena carries its type (`40` in all eight). SPEI's types: `40` CLABE, `3`
debit card, `10` phone.

**Decision (D7).** A receipt tail `t` (digits only, as printed) keeps a
candidate when: type `40` — the CLABE ends with `t`, or the CLABE's first
17 digits (the account without its check digit) end with `t`; type `3` or
`10` — the number ends with `t`; any other type — the number ends with `t`.
Fewer than three digits is no tail. A receipt with a tail and a candidate
with no readable account: dropped (the receipt contradicts what it cannot
confirm, and only for that candidate).

## R9 — Where the decision is made

**Found.** The engine owns the provider and the documents (constitution:
Consta at `src/consta/`, in-process); the lifecycle owns what only the
database knows — which claves live payments hold, what the receipt said
(the row's accepted fields, two-eyes D17) — and it already turns a `valid`
into a confirmation through one branch: `tieCepAccount`, the stale check,
the amount and partial rules, the retired-account hold, the adoption of
the clave, `banxico_valid_at`, then the WispHub half.

**Decision (D8).** The engine reads (D1–D5) and returns the candidates; the
lifecycle decides with one pure matcher, `matchCandidates(receipt,
candidates, used, policy)` in `consta/bundle/match.ts` — pure so spec 012's
batch path can call it with a statement as the receipt side (FR-012). A
decided match is **promoted to the ordinary `valid` verdict**: the chosen
record becomes the verdict's `cep`, `alreadyValidated: false`,
`previouslyValidated: null`, and the existing `valid` branch runs unchanged.
The matcher's order: integrity (amount ≠ the search's, or a destination
that fits none of the payment's accounts: dropped and flagged), used (a
clave a live payment holds), tail (D7), window (D6).

**Decision (D9).** Every CEP found without a clave passes the matcher —
a several answer's records, and the single `valid` of a clave-less search
(FR-014). A search is clave-less when the transfer door asked by reference,
or when neither reading on the receipt door — ours or the provider's —
carried a clave the gate passed; a receipt whose clave was read is a clave
search, and the CEP it returns is the payer's (analyze A1, 2026-09-27).
With neither a time nor a tail, nothing contradicts a single candidate and
it confirms as today; several with no signal are undecided.

**Decision (D18)** — analyze U3, 2026-09-27. The used claves are read
before the decision and the clave is written after it, so two payments
decided at the same moment can choose one transfer: the payer 1 of a
bundle with X (11:43:20) and Y (11:44:30) and a receipt at 11:43:00, the
payer 2 with a receipt at 11:43:10 and no tail — each finds X nearest. In
turn, the second would see X used and take Y, its own. At once, the unique
index refuses the second write, and today that reads as
`TRANSFER_ALREADY_USED`: a payer who paid is refused. So a conflict on a
clave *the matcher chose* adds it to `used` and decides again, at most
twice; nothing left is `all_used`, the clave is asked. A clave the payer
typed or the receipt showed is the payer's own claim, and another live
payment holding it is a real second use: today's refusal stands.

## R10 — The undecided state

**Found.** `REFERENCE_AMBIGUOUS` and `REFERENCE_SHARED` already put a row on
`validating` with `disputed_fields: ["trackingKey"]`: the payer's page asks
for the clave, the slots after it make no call, and the row ends `expired`
when the schedule runs out (receipt-triage D17/D7). A payer's answer is a
new row that supersedes the old one (two-eyes D18).

**Decision (D10).** Undecided is `validating` + `last_error =
'CEP_UNDECIDED'` + `disputed_fields: ["trackingKey"]` + `next_validation_at
= NULL`: no slot, so no call and no expiry while it holds a bundle
(clarified 2026-09-27). Why it did not decide rides in `match_trail.reason`
(`all_used`, `no_signal`, `too_close`, `none_fit`, `unreadable`,
`too_large`). It is decided in the same attempt that received the bundle,
so the ask is up within the minute (SC-004). No new `status` word: the
payer page, the feed, `StatusBadge` and the `/v1` webhooks keep their
vocabulary; the reason is new, the state is not.

## R11 — The typed clave against the kept candidates

**Found.** Four typed claves failed on dev on 2026-09-26: three with O and
0 swapped, one with a character missing (measurement.md). A bundle keeps
two or three claves that share their date and bank prefix but differ in
several later characters.

**Decision (D11).** When a row that supersedes an undecided one carries a
clave, the lifecycle first compares it with the superseded row's
candidates: equal after reading O as 0 and I as 1 on both sides, or equal
to a candidate with one character removed. Exactly one fit confirms from
that record without a call (US3); none or several fits fall through to the
ordinary clave search. Forgiveness is only against the kept candidates —
never against Banxico.

## R12 — The shared-reference stop, narrowed

**Found.** Receipt-triage D7 stops a search by reference that another
payment of the business shares (reference, day, bank, amount, account) in
four places: the page's ask at `/read` (`sharedAsk`), the typed pay
(`409 REFERENCE_SHARED`), the lifecycle before the paid call
(`REFERENCE_SHARED`), and the engine's receipt door
(`RECEIPT_REFERENCE_SHARED`).

**Decision (D12).** Each of the four stops only when the reading or the
row has neither a time nor a tail (FR-015). Typed data has neither — the
form asks for no time or tail — so the typed stop is unchanged in effect.

## R13 — "Validated before" that was our own search

**Found.** A search by reference that the provider answers `valid` marks
the clave as validated (F6). D8's guard refuses a `valid` flagged "validated
before" unless `tracesToOwnAttempt` finds our own earlier attempt; on the
transfer door the billing log records `input.trackingKey`, which a search
by reference does not have — so a single `valid` the filter now refuses
would leave the true owner facing `TRANSFER_ALREADY_USED`.

**Decision (D13).** `tracesToOwnAttempt` also answers yes when the clave is
in the business's `cep_records` — one of our own searches returned it — and
the transfer door's billing row records the CEP's clave when the request
had none. The unique clave index still refuses a second use inside
Devolada (FR-016).

## R14 — Other customers' CEPs (US4)

**Decision (D14).** By pull, not push: a payment that holds a clave looks
up `cep_records` before any paid call, and a record no live payment holds
confirms it without a call (the promoted-`valid` path of D8). Storing a
bundle nudges the business's `validating` payments whose clave is among its
entries (`next_validation_at = now`), so the sweep closes them within the
minute. "Transfers received without a payment" is the business's records
that no live payment holds — a query for the panel, never shown to a payer.

**Alternatives.** Confirming the other payments from inside the first
payment's attempt: cross-row writes against rows another sweep may hold.
Rejected.

## R15 — The reader's two new answers

**Found.** The prompt asks `hora` as `HH:MM`, and `timeOf` rejects
`HH:MM:SS`, so a time with seconds is dropped today. There is no question
for the sender's account.

**Decision (D15).** `hora` is asked as `HH:MM:SS` when seconds are printed,
else `HH:MM`, and `timeOf` keeps either. A new `cuentaOrigen` asks for the
visible digits of the account the money **left** — "Cuenta origen",
"Desde", "Ordenante", "Cuenta de retiro" — never the destination's.
`QUESTIONS_VERSION` moves (`"2"` → `"3"`, and the pinned prompt hash in
`test/consta/reader-questions.test.ts` with it); `extractions` gains
`sender_tail`; `ConstaReading` — the verdict's `ourReading` and `/read`'s
answer — gains `time` and `senderTail`. Today the time stops at
`extractions.transfer_time` and never reaches a payment: a receipt-door row
is born with its accepted fields empty and fills them from the first
verdict (`verdict.accepted`, two-eyes D17). That copy runs only on `not_found`; a `valid` takes the CEP's data instead.
So the matcher reads the receipt side from the attempt's own reading when
the verdict carries one — `verdict.ourReading` rides every outcome of a
provider-first call — and falls back to the row; and the payment takes
`transfer_time` and `sender_tail` from `verdict.ourReading` on every attempt
that carries one, never overwriting (analyze I1, 2026-09-27: reading the
row alone, the receipt door's first attempt — the Janely case — would meet
an empty row and confirm as today). A misread tail fails safe (no
candidate fits: the clave is asked).

**Measured before it is stubbed** (constitution IV, analyze C1). Tests
stand in for the reader with answers it gave; these two answers do not
exist yet. The bench of spec 011 (`/operador` → Lector: real receipts read
by a model and a question version, each field marked right, wrong or
absent, tallied per version) marks nine fields today and neither of these;
it learns `time` and `senderTail`, the creator reads real captures — an
Azteca receipt with seconds and "***8301", one with `HH:MM` only, one with
no sender account — with version 3 beside the bench's own set, and the
tally must show no field worse than version 2. The stubs are then copied
from those raw answers, and the table goes, dated, into the header of
`extraction/reader.ts` (the way receipt-triage's Step 0 recorded its
own).

## R16 — Downloading, and a bundle too large

**Decision (D16).** The download is not a provider call: no credit, no
`validations` row. It is made only to the provider's storage origin —
`APICEP_STORAGE_ORIGIN`, a var in `wrangler.jsonc` for local, dev and
prod (`https://storage.apicep.cloud`), with no URL written in code
(constitution VIII: base URLs are vars, never literals). Unset, no bundle is
downloaded: the payment is undecided and the clave is asked. `.dev.vars`
points it at the sandbox (`http://localhost:8789`); `vitest.config.ts` pins
it (constitution IV). A link to any other origin is never fetched: the
bundle is `unreadable`, the payment undecided, the clave asked. The
provider's own base URL does carry a code default today
(`DEFAULT_BASE_URL` in `provider/apicep.ts`); that gap is registered as
debt (`provider-url-defaults`), not copied. It runs in the attempt that received the answer, with a
10 s deadline and a 4 MB cap (about 140 CEPs at 28 KB). A failed download
leaves the bundle `pending` and the row `validating` with `last_error =
'CEP_BUNDLE_PENDING'`: its next slot downloads again and never calls the
provider. Three failed attempts make the bundle `unreadable`, and a file
over the cap `too_large` — both undecided (D10). Only entries whose clave the business
does not hold as a record are inflated (D3), so a due date's growing
bundles cost each transfer one parse per business.

## R17 — The receipt door's several

**Found.** Not measured (see the top). On that door, `compareReadings` runs
only on `not_found` (two-eyes D5).

**Decision.** The adapter's recognition is door-agnostic (D1), so a several
answer on the receipt door takes the same path: bundle, matcher, decision.
The receipt side comes from the row, written from the reading at
submission (D15). A several answer is not `not_found`, so no reading
comparison runs for it.

## R19 — A business on the `/v1` API and an undecided payment

**Found** (2026-09-27). An undecided payment stays `validating` and, by the
clarification of the same day, never expires. The public read
(`apiPayment`, `routes/v1/payments/schema.ts`) carries the status and the
verdict facts, nothing about what a payment waits on; webhooks fire once
per status, so an undecided payment announces nothing. A business on the
API would see a payment that never ends and not know why. Its payers use
Devolada's page today, which asks for the clave; the business needs to see
it.

**Decision (D17).** `apiPayment` gains two nullable fields, set only while
`last_error = 'CEP_UNDECIDED'`: `awaiting: "payer_tracking_key"` and
`awaitingReason` — `all_used`; `ambiguous` for `no_signal` and
`too_close`; `no_match` for `none_fit`; `unreadable` for `unreadable` and
`too_large`. Four public words over six internal ones, so the internal
vocabulary can move without a breaking change. Additive (clarified
2026-09-27, option a).

**Alternatives.** Keeping the six-hour expiry for API links: a real
transfer would end `expired` while Devolada holds the proof it arrived.
A new webhook event (`payment.awaiting`): a new word in the public event
vocabulary, which is built from the statuses; left for when a business
asks for push.

## R18 — Tests and fixtures

**Decision.** Real CEPs carry names and RFCs and never enter the repo. Tests
build synthetic ones with `fflate` in a helper that reproduces the measured
layout: the labels, a cadena broken over three lines (inside a name and
inside the certificate number), cp1252 text, and a stream whose last
compressed byte is a line break (R4's failure). The ZIP origin
(`https://storage.apicep.cloud`) is intercepted with `fetchMock` like the
provider's. The spike reader ran over the eight real CEPs on 2026-09-27
(8 of 8 read, after the `/Length` fix); `quickstart.md` repeats that check
locally before release.
