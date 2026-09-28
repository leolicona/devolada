# Bug Fix: a single CEP found without a clave is read from its own fields when its cadena cannot be

- **Slug**: single-cep-unreadable
- **Fixed**: 2026-09-28
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

A clave-less single `valid` whose cadena could not be read used to stop
the payment for the clave, and nothing recorded why. Now the creator's Rule
1 applies (cep-bundle-match D19). The same answer's own fields stand in for
the cadena, with the receipt's printed day as the credit day. The CEP is
unreadable only when both sources fail, and every source that did not read
leaves its reason on the payment. The payer's page says one transfer was
found, the panel says the same, and the clave form opens with the bank and
the day filled.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/consta/bundle/cadena.ts` | modified | `readCadena` returns the facts or the check that failed (`missing`, `<n> fields`, `version <v>`, `credit time`, …). `parseCadena` is now a wrapper. The header points to D19. |
| `apps/api/src/consta/bundle/store.ts` | modified | `singleFacts(cep, printedDay)` reads the cadena, then the fields, and returns `why`. `storeSingleRecord` takes the printed day and returns `{ record, why }`. A bundle entry's cadena failure names its check (`"cadena: 42 fields"`). |
| `apps/api/src/consta/validate.ts` | modified | The printed day: `input.date` on the transfer door, our reading's date (else the provider's) on the receipt door. `recordWhy` rides the verdict whenever the cadena did not read, and a warn line names the validation id. |
| `apps/api/src/consta/index.ts` | modified | `ConstaVerdict.recordWhy`. |
| `apps/api/src/consta/bundle/types.ts` | modified | `TrailCandidate.readWhy`, stored only. |
| `apps/api/src/direct-payments/cep-match.ts` | modified | `unreadableCandidates` keeps each reason. New `notedRead` notes the one candidate a single's fields stood in for. New `undecidedOf` returns the reason and the source; `undecidedReasonOf` delegates to it. |
| `apps/api/src/direct-payments/validation.ts` | modified | A single that neither source read rides the trail as one dropped candidate named by its clave, with both reasons. The undecided write keeps the vocabulary bank (the CEP's for a single, the searched one for a bundle) and the printed day when the row has none. |
| `apps/api/src/routes/direct-payments/{schema,handler}.ts` | modified | New public code `CEP_SINGLE_UNDECIDED` for an undecided single that is not `all_used`. |
| `apps/api/src/routes/payments/{schema,handler}.ts` | modified | `feedCharge.undecidedSource` (see Deviations). |
| `apps/pago/src/features/pago/PaymentPage.tsx` | modified | Copy for `CEP_SINGLE_UNDECIDED`, which opens the same clave-only ask. |
| `apps/admin/src/features/feed/FeedScreen.tsx` | modified | `undecidedWords`: a single reads "Una coincidencia…" in the row and in the dialog. |
| `specs/013-cep-bundle-match/{spec,plan,data-model}.md`, `contracts/{engine,payment-page,panel}.md` | amended | Clarification session 2026-09-28, decision D19, FR-002, the records from the fields, `readWhy`, the third public code and the panel's single copy. |
| `apps/api/test/consta/bundle.test.ts` | tests added | `readCadena` and `singleFacts`. |
| `apps/api/test/consta/validate.test.ts` | tests added | The engine's record, `recordWhy`, and a bundle entry's reason. |
| `apps/api/test/cep-bundle-match.test.ts` | tests added / updated | The lifecycle. Test (c) now asserts the entry's `readWhy`. In test (e) the status error is now `CEP_SINGLE_UNDECIDED`, since the old words were the defect. |
| `apps/api/test/payments-unmatched.test.ts` | test added | The feed's `undecidedSource`. |
| `apps/pago/test/pago.test.tsx` | test added | The page's single ask. |
| `apps/admin/test/feed.test.tsx` | tests added | The panel's single words. |
| `apps/api/test/consta/{bundle-fixtures,helpers}.ts` | fixtures | Committed with the assessment. `validAnswer` can leave out or replace `cdaChain` and `processingTime`. `NU_0914_READING` is the measured version-3 answer for the dev screenshot. |

## Diff Highlights

```ts
/* store.ts — D19: the cadena, else the answer's own fields, else unreadable */
export function singleFacts(cep, printedDay) {
  const cadena = readCadena(cep.chain);
  if ("facts" in cadena) return { facts: cadena.facts, why: null };
  const fields = fieldFacts(cep, printedDay);
  if ("facts" in fields) return { facts: fields.facts, why: `cadena: ${cadena.why}` };
  return { facts: null, why: `cadena: ${cadena.why}; fields: ${fields.why}` };
}
```

```ts
/* handler.ts — the payer's words say one */
const undecided = undecidedOf(row);
if (undecided?.reason === "all_used") return "CEP_ALL_USED" as const;
if (undecided?.source === "single") return "CEP_SINGLE_UNDECIDED" as const;
```

## Tests Added or Updated

All are cited `bug: single-cep-unreadable`.

**Unit** (`consta/bundle.test.ts`):
- `readCadena` names each check and never echoes a value; a non-numeric
  version reads "version ?".
- A cadena that reads leaves no note.
- The fields stand in on the printed day, with the note "cadena: missing"
  or "cadena: 41 fields".
- The operation day may follow the printed day by up to five days, and may
  never precede it.
- With neither source there are no facts, and both reasons are kept.
- Masked accounts are empty.

**Engine** (`consta/validate.test.ts`):
- A cadena-less `valid` keeps a record on the day asked, with `recordWhy
  "cadena: missing"`.
- With no `processingTime` either, the record is null and the reasons are
  "cadena: missing; fields: credit time".
- A cadena that reads carries no `recordWhy`.
- A short bundle entry is unreadable as "cadena: 42 fields".

**Lifecycle** (`cep-bundle-match.test.ts`):
- The Nu screenshot as it happened (measured reading `09:14`): it confirms
  5 s past the printed minute, with `readWhy "cadena: missing"`, and a
  record on 2026-09-28.
- A 41-field cadena confirms, with the note naming the count.
- The fields still guard the Janely case (`none_fit`). The row keeps
  AZTECA and 2026-09-25, and the status reads `CEP_SINGLE_UNDECIDED`.
- When both sources fail: the payment is undecided `unreadable`, one named
  candidate carries both reasons, the row keeps NUBANK and 2026-09-28, and
  no record is written.
- A typed reference with no time confirms with a record on the typed day.
- With nothing to compare and nothing to read, it still confirms and leaves
  no trail (D9).

**Feed** (`payments-unmatched.test.ts`): `undecidedSource` is `single` or
`several`, and null on a paid row.

**Page** (`pago.test.tsx`): `CEP_SINGLE_UNDECIDED` shows its words, never
"más de una", focuses the clave, and fills NUBANK, 2026-09-28 and $3.00.
axe is clean.

**Panel** (`feed.test.tsx`): a single `unreadable` row and its dialog read
"Una coincidencia; sus datos de Banxico no se pudieron leer". The other
single reasons read "one", and a bundle keeps its words.

## Local Verification

- **Before the fix**: the new and updated API tests failed, 17 of them
  (`vitest run` on the three files).
- **After the fix**: `vitest run test/consta/bundle.test.ts
  test/cep-bundle-match.test.ts test/consta/validate.test.ts` → 198/198.
- **The page and panel tests against the old code**: 1 of 1 and 2 of 2 fail
  with `PaymentPage.tsx` and `FeedScreen.tsx` restored from HEAD. They pass
  with the fix.
- **CI gates in order**: every one passes.
  - `spec-lint` 89 files, `gen-banks --check`, `contrast-lint`,
    `pending-lint`.
  - `pnpm -r --if-present typecheck`.
  - `pnpm -r --if-present test`: api 886, pago 88, admin 24 files, ui 50,
    landing 10, all green.
  - `pnpm -r --if-present build`.

## Deviations from Assessment

- **Tests live in the existing files**, in `bug: single-cep-unreadable`
  describes, not in a new `single-cep-unreadable.test.ts`. The lifecycle's
  helpers (rows, mocks, the WispHub confirmation) are local to
  `cep-bundle-match.test.ts`.
- **Scope grew by one field.** The panel's row words an undecided charge
  from the feed, which carried only the reason. It now also carries
  `undecidedSource` (`routes/payments/{schema,handler}.ts`), so the row and
  the dialog both say "Una coincidencia…". The field defaults to null, so
  older fixtures parse.
- **The dev payment of 09:16 is no longer undecided.** The assessment said
  it would stay so. At 10:02 the creator typed the Nu clave on the page:
  the new row confirmed and superseded it. The clave path works for a
  28-character Nu clave.

## Follow-ups

- **`/speckit-bug-test slug=single-cep-unreadable` after the merge deploys
  dev.** Upload a Nu screenshot cut before the clave. The payment should
  confirm, and its trail's `readWhy` (or the warn line) says whether the
  photo door's answer had no cadena (cause A) or another shape (cause B).
- **The payer's `CEP_ALL_USED` words are plural** ("Las transferencias que
  encontramos…") for a single too. Only the panel got a single wording.
- **Bank names outside the vocabulary**: "NU" read from a logo left the row
  with no bank. This needs its own general rule (noted in
  `reader-drops-seconds`).
- **`reader-drops-seconds`** is the next fix in this branch.
