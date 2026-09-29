# Bug Assessment: a single CEP's cadena is never read, because its seal follows the closing bars

- **Slug**: single-cep-unreadable
- **Created**: 2026-09-29 (re-assessed; first assessed 2026-09-28)
- **Source**: pasted text (product creator, in session, 2026-09-28 and
  2026-09-29), the creator's probe of apiCEP on 2026-09-29, and a
  read-only look at the dev D1. No URL supplied, so the URL Trust Policy
  did not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> "Esta mañana subí tres comprobantes de pago para validar la implementación
> de la 013. El primer de AZTECA, el segundo de azteca con numero de
> referencia repetido: se confirmaron con éxito. El tercero con NU."

The Nu payment did not confirm (2026-09-28). A second Nu screenshot at
13:20 stopped the same way, and a manual entry by reference confirmed.

The first assessment (2026-09-28) could not tell why the cadena did not
parse. Its two hypotheses were (A) the receipt door's answer carries none,
or (B) its shape differs. Its fix let the answer's own fields stand in for
the cadena (the creator's "Regla 1"). On 2026-09-29 the creator asked apiCEP
again, directly, for six answers, and reported:

> "La cadena real es `||campos||sello` (el sello de 344 caracteres va
> después de las barras finales)"

The creator then decided: read the cadena as it arrives, and withdraw Rule
1 ("Sí, hazlo en el PR #255 y quita la Regla 1").

## Symptom

A search without a clave that apiCEP answers with one `valid` never yields
the CEP's record, because the engine cannot read its cadena. This holds on
the receipt door and on the transfer door by reference. With a time or a
tail on the receipt, the payment stops in `validating` + `CEP_UNDECIDED`
(`unreadable`) and asks for the clave. With neither, it confirms unchecked
(D9). Expected: the cadena reads, the matcher holds its credit time against
the receipt, and the payment confirms when it fits.

The same screen had three more defects:
- It said "Encontramos más de una transferencia…", but one was found.
- The clave form opened with the bank and the date empty.
- Nothing recorded why the cadena did not read.

## Evidence

**Dev D1** (read-only, 2026-09-28 and 2026-09-29):
- **09:16, Nu receipt, reference 280926:** `validating`, `CEP_UNDECIDED`,
  trail `single` / `unreadable` with no candidates, bank and day empty. The
  clave typed at 10:02 superseded it and confirmed.
- **13:23, Nu receipt, reference 2546382:** the same. The clave typed at
  14:13 superseded it.
- **13:35, manual entry by reference 2573955** (Nu, $2.00): confirmed, but
  only because the form carries no time and no tail (D9). Its cadena did
  not read either.
- **`cep_records` with no bundle:** 0. No single `valid` was ever recorded
  on dev, from any bank.
- **The three Azteca receipts of that morning** ended in bundles, because
  their reference repeats. They confirmed: 7 of 7 CEP PDFs read.
- **The seals dev keeps from printed CEPs:** 3 of 3 are 344 characters of
  standard base64, padded `==`.

**The probe** (2026-09-29, the creator's machine): `scripts/apicep-probe.sh`,
six paid calls, read through a jq filter that printed each answer's keys and
each cadena field's kind and length, never a value. The full answers stay on
the creator's machine.

| Case | Bank | Search | Validated before | `cdaChain` | Fields | Version | `processingTime` | Operation / credit day |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Azteca | clave | no | cadena + seal (344) | 43 | 01 | 08:35:01 | 28 / 28 |
| N1 | Nu | clave | yes | cadena + seal (344) | 43 | 01 | 09:14:50 | 28 / 28 |
| N2 | Nu | clave | yes | cadena + seal (344) | 43 | 01 | 13:20:12 | 28 / 28 |
| N3 | Nu | clave | yes | cadena + seal (344) | 43 | 01 | 13:29:46 | 28 / 28 |
| N4 | Nu | reference | yes | cadena + seal (344) | 43 | 01 | 13:29:46 | 28 / 28 |
| K1 | Klar | reference | no | cadena + seal (344) | 43 | 01 | 19:31:09 | 29 / 28 |

- **Every answer carried `cdaChain`, all in the same shape:**
  `||<43 fields>||<344-character base64 seal>`. With the seal set apart,
  all eleven checks of the parser pass. The banks differ only in:
  - the bank's name;
  - the concept's length;
  - for Klar, a CURP (18) where the others carry an RFC (13), in a field
    the parser drops.
- **The cadena's credit time equals `processingTime`** in all six.
- **Klar was filed under the next day but credited the same day.** It was
  printed 2026-09-28 at 19:30:50, filed under the 29th, and credited on the
  28th at 19:31:09.
- **Klar's receipt shows no clave de rastreo**, either when sent or once
  confirmed.

## Reproduction

1. A search without a clave: the receipt door, when no reading carries a
   clave the gate passes, or the transfer door by reference. apiCEP answers
   `valid` with one CEP.
2. Its `cepDetails.cdaChain` arrives as the provider sends it:
   `||<43 fields>||<344-character base64 seal>`.
3. `storeSingleRecord` calls `parseCadena`, which returns null because the
   text does not end in `||`. `verdict.record` is null.
4. The sweep. With a time or a tail on the receipt, the payment becomes
   `undecided("unreadable")` and the page shows `CEP_UNDECIDED` ("más de
   una transferencia"). With neither, it confirms with no trail.
5. In the test suite: once `validAnswer` carries the seal, the reader of
   `main` fails 52 of the 195 tests in `consta/bundle.test.ts`,
   `consta/validate.test.ts` and `cep-bundle-match.test.ts`.

## Suspected Code Paths

Line numbers are those of `main` at `a9392b8`.

- `apps/api/src/consta/bundle/cadena.ts:54`: `parseCadena` returns null
  unless the text ends in `||`, and `:55` cuts two characters off each end.
- `apps/api/src/consta/bundle/store.ts:378-379`: `storeSingleRecord` has
  only `parseCadena(cep.chain)` and keeps no reason.
- `apps/api/src/consta/provider/apicep.ts:334-335`: `chain` is `cdaChain`
  as sent, and `creditTime` is `processingTime`.
- `apps/api/src/consta/validate.ts:655-656`: a clave-less single `valid`
  stores its record, and a null says nothing.
- `apps/api/src/direct-payments/validation.ts:899-904`: D9, where no record
  plus a time or a tail means undecided `unreadable`.
- `apps/api/src/consta/bundle/cep-pdf.ts:295-296`: the bundle path takes
  the cadena and the seal from separate labels. This is why that path
  worked.
- `apps/api/test/consta/bundle-fixtures.ts:91, 342`: the fixture cadena
  ends in `||`, and `validAnswer` sends it as `cdaChain`. The tests shared
  the parser's assumption.
- `specs/013-cep-bundle-match/research.md:179`: R5 says "`||` at both
  ends", and said it of the `valid`'s cdaChain too.
- The words:
  - `apps/pago/src/features/pago/PaymentPage.tsx:131`: the
    `CEP_UNDECIDED` copy says "más de una transferencia".
  - `apps/api/src/routes/direct-payments/handler.ts:297`: `publicError`
    has no code for a single.
  - `apps/admin/src/features/feed/FeedScreen.tsx:140-145`:
    `undecidedCopy.unreadable` says "No se pudo leer el archivo de
    coincidencias", a file a single does not have.

## Root Cause Hypothesis

`parseCadena` demands that the cadena end in `||`, and a `valid`'s
`cdaChain` never does, because its seal follows the closing bars. This was
measured on six answers across three banks. So every clave-less single
`valid` is unreadable, from any bank.

It showed first on Nu because a Nu reference names one transfer, so its
searches end in a single `valid`. Azteca's references repeat, so its
searches end in bundles, whose PDFs carry the cadena and the seal under
separate labels. Research R5 and the fixtures carried the parser's
assumption, so the tests agreed with the parser and not with the provider.

The first assessment's causes (A) and (B) are both ruled out: the cadena is
present, and its 43 fields are exactly as measured. Confidence: **high**
(measured, and reproduced in the test suite).

## Proposed Remediation

**Preferred**: read the cadena as it arrives, and withdraw Rule 1.

1. **`readCadena`** (`cadena.ts`, cep-bundle-match D4 amended):
   - The closing bars are the last `||`.
   - After them comes a base64 seal or nothing. The seal is dropped; the
     record keeps `digitalSignature` (D2).
   - It returns the facts or the check that failed. The reason is never a
     value, except the field count and a short version.
   - `parseCadena` wraps it. The printed cadena, with no seal, reads as
     before.
2. **The cadena is the only source** (FR-002; the creator withdrew Rule 1
   on 2026-09-29). Remove from the first fix:
   - the fields fallback (`singleFacts`, `fieldFacts`);
   - the printed-day argument;
   - the trail note on a single read from its fields.
3. **Keep from the first fix**:
   - `recordWhy` on the verdict, and a warn line;
   - `readWhy` on the trail's candidates;
   - a single whose cadena does not read rides the trail as one dropped
     candidate named by its clave;
   - the undecided row keeps the vocabulary bank and the printed day, for
     the clave form;
   - `CEP_SINGLE_UNDECIDED` and its words;
   - the panel's single copy, through `feedCharge.undecidedSource`.
4. **Fixtures as measured**: `cdaChainOf(t)` is the cadena followed by a
   seal, and `validAnswer` answers with it by default.
5. **Spec 013**:
   - R5 and D4 amended;
   - D19 rewritten;
   - FR-002 updated;
   - clarifications of 2026-09-28 (Q1 withdrawn) and of 2026-09-29;
   - the data model and the engine contract.

**Alternatives**:
- **Keep Rule 1 as a backup.** The creator declined. With the cadena read,
  the fields would stand in only when it is absent, and no answer showed
  that (6 of 6 carried it).
- **Cut a fixed 344-character tail.** It would break on a longer key, from
  another certificate, and would hide a real change of shape.
- **Read the CEP PDF from `downloads.cepPdf`.** One download per single,
  for data the answer already carries.

**Files likely to change**:
- `apps/api/src/consta/bundle/cadena.ts`, `store.ts` and `types.ts`
- `apps/api/src/consta/validate.ts` and `apps/api/src/consta/index.ts`
- `apps/api/src/direct-payments/validation.ts` and `cep-match.ts`
- `apps/api/src/routes/direct-payments/{schema,handler}.ts` and
  `apps/api/src/routes/payments/{schema,handler}.ts`
- `apps/pago/src/features/pago/PaymentPage.tsx` and
  `apps/admin/src/features/feed/FeedScreen.tsx`
- `apps/api/test/consta/bundle-fixtures.ts` and `helpers.ts`
- `specs/013-cep-bundle-match/{spec,plan,research,data-model}.md` and
  `contracts/{engine,payment-page,panel}.md`

**Tests to add or update** (`bug: single-cep-unreadable`):
- **`readCadena`**:
  - the measured shape reads to the printed cadena's facts, and the seal
    never reaches them;
  - an empty field does not move the closing bars;
  - a tail that is not a seal reads "not delimited";
  - each check names itself, and no value leaks.
- **Klar after 18:00**: the operation day is the 29th, the credit day the
  28th, and the credit instant is 01:31:09 UTC on the 29th.
- **The engine**:
  - a cdaChain with its seal keeps its record and leaves no note;
  - no cadena gives no record and "cadena: missing";
  - another shape gives "cadena: 41 fields".
- **The lifecycle**:
  - the Nu screenshot as it happened confirms by time, from the cadena;
  - Klar after 18:00 confirms on the manual door;
  - a cadena of another shape, or none, is undecided `unreadable`: the one
    transfer is named with its check, NUBANK and the printed day are kept,
    and the status reads `CEP_SINGLE_UNDECIDED`;
  - with nothing to compare and no cadena, D9 still confirms.
- **The 013 tests that encoded the old shape** now carry the seal.
- **The feed, the page and the panel**: their single wording.

## Risks & Considerations

- **The seal's alphabet.** A seal in any other alphabet (URL-safe, or with
  line breaks) reads "not delimited". The CEP is then unreadable and the
  clave is asked: it fails safe and says why. The seals kept from printed
  CEPs match (3 of 3).
- **With Rule 1 withdrawn, a missing cadena asks for the clave.** A Klar
  payer cannot give one, because their receipt shows none. This is an open
  question.
- **No migration.** No API change beyond `CEP_SINGLE_UNDECIDED` and
  `feedCharge.undecidedSource`. `match_trail` is JSON.
- **Not in production.** Spec 013 has been on `main` since 2026-09-28, and
  the last release is v1.2.0 (2026-09-20). A release before this merge
  would ship the bug.
- **Past payments are not re-run.** The two dev payments were superseded
  by their claves.

## Open Questions

- [NEEDS CLARIFICATION: what to ask a payer whose bank shows no clave
  (Klar) when a payment stays undecided. A product decision, not blocking.]
- [NEEDS CLARIFICATION: whether Banxico matches a clave regardless of
  case. Klar's claves mix cases and the transfer door upper-cases typed
  ones. Not measured, and not blocking.]
