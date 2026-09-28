# Bug Assessment: a single CEP found without a clave waits for the clave when its cadena cannot be read

- **Slug**: single-cep-unreadable
- **Created**: 2026-09-28
- **Source**: pasted text (product creator, in session, 2026-09-28), plus a
  read-only look at the dev D1 the same morning. No URL supplied, so the URL
  Trust Policy did not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> "Esta mañana subí tres comprobantes de pago para validar la implementación
> de la 013. El primer de AZTECA, el segundo de azteca con numero de
> referencia repetido: se confirmaron con éxito. El tercero con NU."

The Nu payment did not confirm. The creator then decided the remediation's
core rule in session ("Regla 1", 2026-09-28): Banxico's details come from
the cadena; when it is missing or not as measured, from the separate fields
of the same answer; only when both fail is the CEP unreadable, and the
payment records why.

## Symptom

On the receipt door, a screenshot that shows no clave is searched by its
reference. When the provider answers `valid` with one CEP whose cadena the
engine cannot read, the payment stops in `validating` + `CEP_UNDECIDED`
with no slot and no expiry, and the page asks for the clave. Before
cep-bundle-match it confirmed at once. Expected: the CEP is checked against
the receipt with the details the answer does carry, and confirms when the
time fits.

The same screen shows two more defects:

- It says "Encontramos más de una transferencia…", but one was found.
- The clave form opens with the bank and the date empty.

## Evidence (dev D1, read-only, 2026-09-28)

- **The payment** (created 09:16:46): `validating`, `last_error
  CEP_UNDECIDED`, `next_validation_at` NULL, `disputed_fields
  ["trackingKey"]`, `transfer_time "09:14"`, and `sender_bank`,
  `transfer_date`, `sender_tail` and `tracking_key` all NULL. Match trail:
  `{"source":"single","bundleId":null,"decided":"undecided","by":null,
  "reason":"unreadable","receipt":{"time":"09:14","tail":null},
  "candidates":[]}`.
- **The paid call** (09:17:04, 16.6 s, HTTP 200), mode `receipt`: status
  `valid`, `LIQUIDADO`, never validated before. The CEP is a 28-character
  clave `NU3A…`, NUBANK, 300 cents, operation day 2026-09-28.
- **The readings** (reader v3, mistral-small-3.1): neither ours nor the
  provider's carried a clave (gate `missing`). Both read a 6-digit
  reference, 280926, which is the date. Ours read 300 cents, day
  2026-09-28, time "09:14" and no bank. The screenshot prints "Autorización
  … 09:14:50 AM"; the lost seconds are their own bug.
- **No `cep_records` row** for that clave. `storeSingleRecord` returned null.
- **The same morning**, three Azteca several-matches answers were read whole:
  7 of 7 CEP PDFs, 0 unreadable. They confirmed 35, 21 and 14 s after their
  receipts' times. The bundle path reads real CEPs. The single path had never
  met a real `cdaChain` before this call.
- **The screenshot**, which the creator shared in session and which is not
  kept in the repo: Nu's "Comprobante de transferencia", cut before "Clave de
  rastreo" and "Cuenta origen". The full receipt carries both.

## Reproduction

1. A receipt-door payment whose readings carry no clave the gate passes, and
   a time.
2. The provider answers `valid` with `cepDetails` whose `cdaChain` is absent,
   or not 43 fields of version `01` with digit accounts. `processingTime`,
   `senderAccount` and the amount are present.
3. The sweep runs: the row stays `validating` + `CEP_UNDECIDED` with trail
   reason `unreadable` and no candidates.
4. `GET /direct-payments/:id/status` answers `error: "CEP_UNDECIDED"`, the
   page copy says "más de una transferencia", and `senderBank` and
   `transferDate` are null.

No test covers this path. Every single-`valid` fixture carries a `cdaChain`
built by `cadenaOf` (`apps/api/test/consta/bundle-fixtures.ts`), which is
the same understanding the parser has. The D9 branch "no record, but a time
or a tail" has no test.

## Suspected Code Paths

- `apps/api/src/consta/validate.ts`, from `const claveless = …`: a
  clave-less single `valid` calls `storeSingleRecord(db, owner,
  verdict.cep)`. The verdict carries `record: null` and nothing says why.
- `apps/api/src/consta/bundle/store.ts::storeSingleRecord`: `parseCadena(cep.chain)`
  or null. There is no other source, and no reason is kept.
- `apps/api/src/consta/bundle/cadena.ts::parseCadena`: strict by design (D4,
  FR-002). It returns null, without saying which check failed.
- `apps/api/src/direct-payments/validation.ts`, the matcher phase: `if
  (!several && !verdict.record) { if (receipt.time || receipt.tail) return
  undecided("unreadable"); }` (D9). `undecided()` writes `lastError`,
  `disputedFields`, `nextValidationAt` and the trail, but not the bank or
  the day the search used.
- `apps/api/src/routes/direct-payments/handler.ts::publicError`: every
  undecided row that is not `all_used` becomes `CEP_UNDECIDED`, whose copy
  (`apps/pago/src/features/pago/PaymentPage.tsx`, `payErrors`) was written
  for a bundle.
- `apps/admin/src/features/feed/FeedScreen.tsx::undecidedCopy`: `unreadable`
  reads "No se pudo leer el archivo de coincidencias", and a single has no
  such file.
- `specs/013-cep-bundle-match/contracts/payment-page.md` promises "the other
  fields filled from the row", which the receipt door's row cannot keep today.

## Root Cause Hypothesis

**How the payment stopped**, confidence **high**: a clave-less single
`valid` got no record because its `cdaChain` did not parse. The receipt
carried a time, so D9 made the payment undecided.

**Why the cadena did not parse**, not knowable from what was stored:

- **(A)** The receipt door's `valid` carries no `cdaChain`. Research R1
  measured it on transfer-door calls only; every probe lot was a direct call.
- **(B)** Its cadena differs from the shape measured on Azteca CEPs, and the
  strict parser refuses it.

Neither the row nor the log says which. That missing reason is a second
defect in its own right. The fix below does not depend on which cause it was.

## Proposed Remediation

**Preferred**: the creator's Rule 1, plus the three defects around it.

1. **The cadena says why** (`cadena.ts`). `readCadena(text)` returns the
   facts, or a short reason naming the check that failed: `missing`,
   `not delimited`, `<n> fields`, `version <v>`, `operation day`, `credit
   day`, `credit time`, `SPEI code`, `sender bank`, `account type`,
   `account`, `amount` or `certificate`. The reason never carries a value,
   except the field count and the version. `parseCadena` stays as a wrapper.
2. **The fields stand in** (`store.ts`). When the cadena fails, a single
   `valid`'s record is built from the same answer:
   - **credit time**: `processingTime`, `HH:MM:SS`.
   - **credit day**: the receipt's printed day, which is the day Banxico
     files a transfer under (the batch A0E0097211 measured 16 of 16, lot 3).
   - **operation day**: `operationDate`. It must fall on the printed day or
     up to 5 days after it, since the operation day is the next business day
     after hours.
   - **amount**: greater than 0.
   - **accounts and their types**: kept when well formed, else empty
     (unknown). An empty sender account fails the tail check only when the
     receipt shows a tail. An empty receiving account ties as unknown, never
     as a contradiction.
   - **certificate and seal**: as carried, else empty.

   `storeSingleRecord` returns the record and the reasons of every source
   that failed ("cadena: missing", "cadena: missing; fields: no credit
   time").
3. **The engine passes the printed day and the reason on** (`validate.ts`).
   - The printed day is `input.date` on the transfer door, and our reading's
     date (else the provider's) on the receipt door.
   - The verdict gains `recordWhy` whenever the record was not read from the
     cadena.
   - A warn line names the validation id and the reason, so a single
     confirmed with nothing to compare still leaves a trace.
4. **The payment keeps the reason, the bank and the day** (`validation.ts`,
   `cep-match.ts`, `types.ts`).
   - `TrailCandidate` gains an optional `readWhy`. It is set on the
     candidate a single's fields stood in for, on the single that could not
     be read (now one dropped candidate, named by its clave), and on every
     unreadable bundle entry.
   - The undecided write keeps `sender_bank` and `transfer_date` when the row
     has none. The bank is the CEP's for a single and the searched one for a
     bundle. The day is the receipt's printed day.
5. **Words that say one** (`schema.ts`, `handler.ts`, `PaymentPage.tsx`,
   `FeedScreen.tsx`).
   - A new public code, `CEP_SINGLE_UNDECIDED`, for an undecided single that
     is not `all_used`. It opens the same clave-only ask, with its own copy:
     "Encontramos una transferencia con tus datos, pero no pudimos confirmar
     que sea tuya. Escribe tu clave de rastreo para confirmarla."
   - The panel's undecided copy follows the source ("Una coincidencia…").
6. **Spec 013 amended.** D19 records Rule 1, and D4, D9, D10, FR-002 and
   FR-014 point to it. The engine, payment-page and panel contracts and the
   data model are updated to match.

**Alternatives**:

- **Keep D4/D9 strict and fix only the words, the fields and the reason.**
  Every unreadable single then asks for a clave the payer's screenshot may
  not show. The creator ruled this out.
- **Confirm an unreadable single unchecked**, as before 013. This reopens
  `reference-finds-other-transfer`: a receipt printed 18:58 took its payer's
  07:19 transfer.
- **Take the credit day from `operationDate`.** It is wrong after 18:00 and
  on weekends (measured), so it would move the credit a business day away
  and the payment would ask for the clave for no reason.

**Files likely to change**:

- `apps/api/src/consta/bundle/cadena.ts`, `store.ts` and `types.ts`
- `apps/api/src/consta/validate.ts` and `apps/api/src/consta/index.ts`
  (verdict type)
- `apps/api/src/direct-payments/validation.ts` and `cep-match.ts`
- `apps/api/src/routes/direct-payments/schema.ts` and `handler.ts`
- `apps/pago/src/features/pago/PaymentPage.tsx`
- `apps/admin/src/features/feed/FeedScreen.tsx`
- Tests: `apps/api/test/consta/bundle.test.ts`, `apps/api/test/consta/validate.test.ts`,
  a new `apps/api/test/single-cep-unreadable.test.ts`, and the page's and
  panel's component tests
- `specs/013-cep-bundle-match/{spec,plan,data-model}.md` and
  `contracts/{engine,payment-page,panel}.md`

**Tests to add or update** (`bug: single-cep-unreadable`):

- **Receipt door, answer without `cdaChain`**: the receipt printed 09:14 and
  `processingTime` is 09:14:58. The payment confirms by time. The record's
  credit day is the printed day, and the trail's candidate carries
  `readWhy: "cadena: missing"`.
- **A 41-field `cdaChain`**: confirms from the fields, with `readWhy
  "cadena: 41 fields"`.
- **The fields still guard the old bug**: a receipt printed 18:58 against a
  cadena-less answer credited 07:19:52 does not confirm (`none_fit`).
- **Cadena and fields both fail** (no `processingTime`): undecided
  `unreadable`, with one dropped candidate named by its clave and carrying
  both reasons. The row keeps `sender_bank NUBANK` and the printed day, and
  the status answers `CEP_SINGLE_UNDECIDED` with those fields.
- **An operation day before the printed day** makes the fields unreadable.
- **A typed reference with no time**: a cadena-less answer still confirms,
  as D9 always did, now with a record whose credit day is the typed day.
- **A bundle entry whose cadena is short**: the reason ("cadena: 42 fields")
  reaches `cep_bundles.unreadable` and the trail.
- **`readCadena`**: each check's reason, and no value leaks.
- **The page**: `CEP_SINGLE_UNDECIDED` renders its copy and the clave-only
  ask with the bank and date filled. **The panel**: the undecided single
  reads "Una coincidencia…".

## Risks & Considerations

- **Rule 1 relaxes FR-002's "anything not as measured confirms nothing"**
  for a single's own fields. The time window still decides, and the fields
  come from Banxico's answer, not from a reading. This is the creator's
  decision of 2026-09-28.
- **A record from the fields assumes credit day = printed day.** A transfer
  printed before midnight and credited after it lands about 24 h early, the
  window drops it, and the payer is asked for the clave. It fails safe.
- **`processingTime` as the credit time** was measured on direct answers. If
  the receipt door lacks it too, the payment stays undecided, now with the
  reason recorded. The next such payment on dev tells whether cause (A) or
  (B) holds.
- **No migration.** `match_trail` is JSON. `cep_records` keeps NOT NULL,
  with empty strings for unknown accounts, SPEI code and certificate.
- **The new public code touches the page schema.** The `/v1` contract
  (`awaitingReason`) is unchanged.
- **The dev payment of 09:16 stays undecided**: an undecided row has no
  slot, and the fix does not re-run it. The creator can close it with the
  clave.

## Open Questions

- None blocking. The creator decided Rule 1, and the rest follows existing
  decisions (D9, D10) and contracts.
