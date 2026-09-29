# Bug Fix: a single CEP's cadena is read with the seal that follows it

- **Slug**: single-cep-unreadable
- **Fixed**: 2026-09-29 (first applied 2026-09-28, revised after the
  re-assessment)
- **Assessment**: ./assessment.md, and its Re-assessment of 2026-09-29
- **Status**: applied

## Summary

A clave-less single `valid` never gave a record, from any bank. The cadena
reader demanded that the cadena end in `||`, and a `valid`'s `cdaChain` ends
in its seal. The reader now takes the last `||` as the closing bars and
drops the seal after them, so the cadena reads and the payment is matched
by time, as spec 013 intended.

The first version of this fix (2026-09-28) let the answer's own fields
stand in for a cadena that could not be read (the creator's Rule 1). The
creator withdrew it on 2026-09-29, and it is gone. What stays from it:
every source that does not read says why, the payer's page and the panel
say "one transfer", and the clave form opens with the bank and the day
filled.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/consta/bundle/cadena.ts` | modified | `readCadena` returns the facts or the check that failed. The closing bars are the last `\|\|`; after them comes a base64 seal or nothing (D4 amended 2026-09-29). `parseCadena` wraps it. |
| `apps/api/src/consta/bundle/store.ts` | modified | `storeSingleRecord` reads the cadena alone and returns `{ record, why }`. A bundle entry's cadena failure names its check (`"cadena: 42 fields"`). |
| `apps/api/src/consta/validate.ts`, `apps/api/src/consta/index.ts` | modified | `recordWhy` rides the verdict when a clave-less single has no record, and a warn line names the validation id. |
| `apps/api/src/consta/bundle/types.ts` | modified | `TrailCandidate.readWhy`, stored only. |
| `apps/api/src/direct-payments/cep-match.ts` | modified | `unreadableCandidates` keeps each reason. `undecidedOf` returns the reason and the source; `undecidedReasonOf` delegates to it. |
| `apps/api/src/direct-payments/validation.ts` | modified | A single whose cadena did not read rides the trail as one dropped candidate named by its clave, with the check it failed. The undecided write keeps the vocabulary bank (the CEP's for a single, the searched one for a bundle) and the printed day when the row has none. |
| `apps/api/src/routes/direct-payments/{schema,handler}.ts` | modified | New public code `CEP_SINGLE_UNDECIDED` for an undecided single that is not `all_used`. |
| `apps/api/src/routes/payments/{schema,handler}.ts` | modified | `feedCharge.undecidedSource` (see Deviations). |
| `apps/pago/src/features/pago/PaymentPage.tsx` | modified | Copy for `CEP_SINGLE_UNDECIDED`, which opens the same clave-only ask. |
| `apps/admin/src/features/feed/FeedScreen.tsx` | modified | `undecidedWords`: a single reads "Una coincidencia…" in the row and in the dialog. |
| `specs/013-cep-bundle-match/{spec,plan,research,data-model}.md`, `contracts/{engine,payment-page,panel}.md` | amended | R5 and D4 (the seal), D19 (the cadena alone; Rule 1 withdrawn), FR-002, the clarifications of 2026-09-28 and 2026-09-29, `readWhy`, the third public code and the panel's single copy. |
| `apps/api/test/consta/bundle-fixtures.ts` | fixtures | `cdaChainOf(t)`: the cadena, then its seal. `validAnswer` answers with it by default, and can still leave out or replace `cdaChain` and `processingTime`. |
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

**Unit** (`consta/bundle.test.ts`):
- The cdaChain as measured, the cadena and then a 344-character seal,
  gives the printed cadena's facts, and the seal never reaches them.
- Klar after 18:00 keeps the 28th as its credit day, and its credit
  instant is 01:31:09 UTC on the 29th.
- An empty field inside the cadena does not move the closing bars.
- `readCadena` names each check and never echoes a value. A tail after the
  bars that is not a seal reads "not delimited".
- The 013 test "a valid's cdaChain reads the same way" now carries the
  seal.

**Engine** (`consta/validate.test.ts`):
- A cdaChain with its seal keeps its record and leaves no note.
- No cadena: no record, "cadena: missing".
- A cadena of another shape: no record, "cadena: 41 fields".
- A short bundle entry is unreadable as "cadena: 42 fields".
- The 013 test "a valid exposes … the cadena" expects the chain as the
  answer carries it, seal and all.

**Lifecycle** (`cep-bundle-match.test.ts`):
- The Nu screenshot as it happened (measured reading "09:14", measured
  credit 09:14:50) confirms by time from the cadena, with no note on the
  trail and a record on 2026-09-28.
- Klar after 18:00, shaped like the measured answer, confirms on the
  manual door: the record's operation day is the 29th and its credit day
  the 28th.
- A cadena of another shape, or none, is unreadable: undecided, the one
  transfer named with the check it failed, NUBANK and the printed day kept
  on the row, `CEP_SINGLE_UNDECIDED` on the status.
- With nothing to compare and no cadena, D9 still confirms, and no trail
  is written.
- Test (c) asserts the unreadable entry's `readWhy`. In test (e) the
  status error is `CEP_SINGLE_UNDECIDED`, since the old words were the
  defect.

**Feed** (`payments-unmatched.test.ts`): `undecidedSource` is `single` or
`several`, and null on a paid row.

**Page** (`pago.test.tsx`): `CEP_SINGLE_UNDECIDED` shows its words, never
"más de una", focuses the clave, and fills NUBANK, 2026-09-28 and $3.00.
axe is clean.

**Panel** (`feed.test.tsx`): a single `unreadable` row and its dialog read
"Una coincidencia; sus datos de Banxico no se pudieron leer". The other
single reasons read "one", and a bundle keeps its words.

## Local Verification

- **Against the reader before this change**, with the fixtures as
  measured: 52 of the 195 tests in the three API files fail, among them
  every new test above. The rest fail on interceptors that the failed
  flows left behind.
- **With the change**: `vitest run test/consta/bundle.test.ts
  test/consta/validate.test.ts test/cep-bundle-match.test.ts` → 195/195.
- **CI gates in order**: every one passes.
  - `spec-lint` (90 files), `gen-banks --check` (97 banks),
    `contrast-lint`, `pending-lint`.
  - `pnpm -r --if-present typecheck`.
  - `pnpm -r --if-present test`: api 930 in 55 files, pago 88, admin 317
    in 24 files, ui 50, landing 10, all green.
  - `pnpm -r --if-present build`.

## Deviations from Assessment

- **The root cause was the seal, not a missing or different cadena.** The
  first assessment could not tell cause (A) from (B). The probe of
  2026-09-29 showed neither: the cadena is always there, in the measured
  shape, with its seal after it. See the assessment's Re-assessment.
- **Rule 1 is withdrawn** (the creator, 2026-09-29): no fields stand in
  for the cadena.
- **Tests live in the existing files**, in `bug: single-cep-unreadable`
  describes, not in a new `single-cep-unreadable.test.ts`. The lifecycle's
  helpers are local to `cep-bundle-match.test.ts`.
- **Scope grew by one field.** The panel's row words an undecided charge
  from the feed, which carried only the reason. It now also carries
  `undecidedSource`, so the row and the dialog both say "Una
  coincidencia…". The field defaults to null, so older fixtures parse.
- **The dev payments of 2026-09-28 stay as they are.** The one of 09:16
  was superseded by the clave typed at 10:02, and the one of 13:23 by the
  clave typed at 14:13.

## Follow-ups

- **`/speckit-bug-test slug=single-cep-unreadable` after the merge deploys
  dev.** A Nu screenshot cut before its clave, and a Klar receipt, should
  both confirm with no clave asked.
- **Do not tag a release before this merges.** Spec 013 is on `main`
  since 2026-09-28 and would take the unreadable single to production.
- **A payer whose bank shows no clave** (Klar): what the undecided ask
  should be is a product decision.
- **Case in a typed clave**: Klar's clave mixes cases, and the transfer
  door upper-cases every typed clave. Not measured.
- **The payer's `CEP_ALL_USED` words are plural** ("Las transferencias
  que encontramos…") for a single too. Only the panel got a single
  wording.
- **Bank names outside the vocabulary**: "NU" read from a logo left the
  row with no bank. This needs its own general rule (noted in
  `reader-drops-seconds`).
- **`reader-drops-seconds`** is assessed in this branch and not yet fixed.
- **The sandbox mock** answers a `valid` with no `cdaChain`, so a
  clave-less single there is unreadable. It could answer the measured
  shape.
- **A provider call cut by the 25 s deadline may still be billed.** On
  dev, 2026-09-28, two credits went with no row between 10:02 and 13:25.
  The payment of 13:23 counted two attempts and has one row, and apiCEP
  answered its second call as "validated before".
