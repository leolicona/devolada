# Bug Fix: a single CEP's cadena is read with the seal that follows it

- **Slug**: single-cep-unreadable
- **Fixed**: 2026-09-29
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The cadena reader demanded that a cadena end in `||`, but a `valid`'s
`cdaChain` ends in its seal. It now takes the last `||` as the closing bars
and drops the seal after them, so a clave-less single `valid` is recorded
from its cadena and matched by time, from any bank.

The cadena is the only source: the answer's own fields no longer stand in
(Rule 1, withdrawn by the creator). What stays from the first fix:
- every source that does not read says why;
- the payer's page and the panel say "one transfer";
- the clave form opens with the bank and the day filled.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/consta/bundle/cadena.ts` | modified | `readCadena` returns the facts or the check that failed. The closing bars are the last `\|\|`, and after them comes a base64 seal or nothing (D4 amended). `parseCadena` wraps it. |
| `apps/api/src/consta/bundle/store.ts` | modified | `storeSingleRecord` reads the cadena alone and returns `{ record, why }`. A bundle entry's cadena failure names its check (`"cadena: 42 fields"`). |
| `apps/api/src/consta/validate.ts`, `apps/api/src/consta/index.ts` | modified | `recordWhy` rides the verdict when a clave-less single has no record, and a warn line names the validation id. |
| `apps/api/src/consta/bundle/types.ts` | modified | `TrailCandidate.readWhy`, stored only. |
| `apps/api/src/direct-payments/cep-match.ts` | modified | `unreadableCandidates` keeps each reason. `undecidedOf` returns the reason and the source, and `undecidedReasonOf` delegates to it. |
| `apps/api/src/direct-payments/validation.ts` | modified | A single whose cadena did not read rides the trail as one dropped candidate named by its clave, with the check it failed. The undecided write keeps the vocabulary bank (the CEP's for a single, the searched one for a bundle) and the printed day when the row has none. |
| `apps/api/src/routes/direct-payments/{schema,handler}.ts` | modified | New public code `CEP_SINGLE_UNDECIDED`, for an undecided single that is not `all_used`. |
| `apps/api/src/routes/payments/{schema,handler}.ts` | modified | `feedCharge.undecidedSource`, null by default so older fixtures parse. |
| `apps/pago/src/features/pago/PaymentPage.tsx` | modified | Copy for `CEP_SINGLE_UNDECIDED`, which opens the same clave-only ask. |
| `apps/admin/src/features/feed/FeedScreen.tsx` | modified | `undecidedWords`: a single reads "Una coincidencia…" in the row and in the dialog. |
| `specs/013-cep-bundle-match/{spec,plan,research,data-model}.md`, `contracts/{engine,payment-page,panel}.md` | amended | R5 and D4 (the seal); D19 (the cadena alone, Rule 1 withdrawn); FR-002; the clarifications of 2026-09-28 and 2026-09-29; `readWhy`; the third public code; the panel's single copy. |
| `apps/api/test/consta/bundle-fixtures.ts` | fixtures | `cdaChainOf(t)` is the cadena followed by a seal. `validAnswer` answers with it by default, and can still leave out or replace `cdaChain` and `processingTime`. |
| `apps/api/test/consta/helpers.ts` | fixtures | `NU_0914_READING`: the measured version-3 reading of the dev screenshot. |
| Tests | added / updated | See below. |

## Diff Highlights

```ts
/* cadena.ts — D4 amended 2026-09-29: the closing bars are the last `||` */
const close = t.lastIndexOf("||");
if (!t.startsWith("||") || close < 2 || t.length < 5) return { why: "not delimited" };
const after = t.slice(close + 2);
if (after && !SEAL.test(after)) return { why: "not delimited" };
const f = t.slice(2, close).split("|");
```

## Tests Added or Updated

All are cited `bug: single-cep-unreadable`.

- `apps/api/test/consta/bundle.test.ts`:
  - The cdaChain as measured, the cadena and then a 344-character seal,
    gives the printed cadena's facts, and the seal never reaches them.
  - Klar after 18:00 keeps the 28th as its credit day, and its credit
    instant is 01:31:09 UTC on the 29th.
  - An empty field inside the cadena does not move the closing bars.
  - `readCadena` names each check and echoes no value. A tail after the
    bars that is not a seal reads "not delimited".
  - The 013 test "a valid's cdaChain reads the same way" now carries the
    seal.
- `apps/api/test/consta/validate.test.ts`:
  - A cdaChain with its seal keeps its record and leaves no note.
  - No cadena: no record, and "cadena: missing".
  - Another shape: no record, and "cadena: 41 fields".
  - A short bundle entry is unreadable as "cadena: 42 fields".
  - The 013 test "a valid exposes … the cadena" expects the chain as the
    answer carries it, seal and all.
- `apps/api/test/cep-bundle-match.test.ts`:
  - The Nu screenshot as it happened (measured reading "09:14", measured
    credit 09:14:50) confirms by time from the cadena, with no note on the
    trail and a record on 2026-09-28.
  - Klar after 18:00, shaped like the measured answer, confirms on the
    manual door. The record's operation day is the 29th and its credit
    day the 28th.
  - A cadena of another shape, or none, is unreadable:
    - the payment is undecided;
    - the one transfer is named with the check it failed;
    - the row keeps NUBANK and the printed day;
    - the status reads `CEP_SINGLE_UNDECIDED`.
  - With nothing to compare and no cadena, D9 still confirms and writes no
    trail.
  - Test (c) asserts the unreadable entry's `readWhy`.
  - In test (e) the status error is `CEP_SINGLE_UNDECIDED`.
- `apps/api/test/payments-unmatched.test.ts`: `undecidedSource` is
  `single` or `several`, and null on a paid row.
- `apps/pago/test/pago.test.tsx`: `CEP_SINGLE_UNDECIDED`:
  - shows its words, and never "más de una";
  - focuses the clave;
  - fills NUBANK, 2026-09-28 and $3.00;
  - axe is clean.
- `apps/admin/test/feed.test.tsx`: a single `unreadable` row and its dialog
  read "Una coincidencia; sus datos de Banxico no se pudieron leer". The
  other single reasons read "one", and a bundle keeps its words.

## Local Verification

- **Reproduction against the old reader.** `main`'s reader was put back,
  with the fixtures as measured. `vitest run test/consta/bundle.test.ts
  test/consta/validate.test.ts test/cep-bundle-match.test.ts` fails 52 of
  195, including every new test above. The rest fail on interceptors that
  the failed flows left behind.
- **This run** (2026-09-29), on the fixed paths:
  - `pnpm --filter @devolada/api exec vitest run test/consta/bundle.test.ts
    test/consta/validate.test.ts test/cep-bundle-match.test.ts
    test/payments-unmatched.test.ts`: 205/205.
  - `pnpm --filter @devolada/pago exec vitest run test/pago.test.tsx`:
    82/82.
  - `pnpm --filter @devolada/admin exec vitest run test/feed.test.tsx`:
    38/38.
  - `node scripts/spec-lint.mjs`: 90 test files checked.
- **The full CI gates, in order, on the same code** (before this run
  rewrote the two documents):
  - `spec-lint`, `gen-banks --check` (97 banks), `contrast-lint` and
    `pending-lint` pass.
  - `pnpm -r --if-present typecheck` passes.
  - `pnpm -r --if-present test`: api 930 in 55 files, pago 88, admin 317 in
    24 files, ui 50, landing 10, all green.
  - `pnpm -r --if-present build` passes.
- **Manual check.** The seals dev keeps from printed CEPs are 3 of 3 at
  344 characters of standard base64, which is the alphabet the reader
  accepts.

## Deviations from Assessment

- **The code came before this assessment.** The remediation was applied in
  commit `17082b8`, before `/speckit-bug-assess` was re-run on
  2026-09-29. This run checked the applied change against the assessment,
  point by point, instead of writing it anew. Nothing in the code needed
  to change.

## Follow-ups

- **`/speckit-bug-test slug=single-cep-unreadable` after the merge deploys
  dev.** A Nu screenshot cut before its clave, and a Klar receipt, should
  both confirm with no clave asked.
- **Do not tag a release before this merges.** Spec 013 has been on `main`
  since 2026-09-28 and would take the bug to production.
- **The assessment's open questions:**
  - what to ask a payer whose bank shows no clave (Klar);
  - whether Banxico matches a typed clave regardless of case.
- **The payer's `CEP_ALL_USED` words are plural** ("Las transferencias que
  encontramos…") for a single too. Only the panel got a single wording.
- **Bank names outside the vocabulary.** "NU" read from a logo left the row
  with no bank. This needs its own general rule (noted in
  `reader-drops-seconds`).
- **`reader-drops-seconds`** is assessed in this branch and not yet fixed.
- **The sandbox mock** answers a `valid` with no `cdaChain`, so a
  clave-less single there is unreadable. It could answer the measured
  shape.
- **A provider call cut by the 25 s deadline may still be billed.** On dev,
  2026-09-28, two credits were spent with no row between 10:02 and 13:25.
  The 13:23 payment counted two attempts and has one row, and apiCEP
  answered its second call as "validated before".
