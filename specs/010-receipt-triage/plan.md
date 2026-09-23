# Implementation Plan: receipt-triage

**Branch**: `claude/payment-receipt-info-handling-bhqn5o` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-receipt-triage/spec.md`

## Summary

Four changes around the receipt upload. **Before it**, the payer sees what a
good capture shows. **After it**, a clear capture that does not print the
clave de rastreo is stopped before any paid call, and the payer is told
exactly which fields are missing, where their bank shows them, and that they
can type them instead. **Around it**, an ISP can be paid at a debit card or a
phone number as well as its CLABE, and the check names the identifier the
money went to. And a **Spin** receipt is checked against the institution
Banxico records for it — only when the movement went through SPEI.

Phase 0 found, again, that most of the machinery exists:

- the engine's request schema and the provider adapter **already accept** a
  card, a phone and a candidate list (research R3); only the facade's
  `ConstaBeneficiary` type and one `readable` test stand in the way;
- the two-eyes refusal has **exactly the shape** the new stops need — the
  `/read` route reports, the page refuses, the receipt door enforces — and the
  code the key stop needs, `RECEIPT_INCOMPLETE`, is still declared (R1);
- `bankForClabe` **already maps** 728 → `SPIN BY OXXO` and 646 → `STP` (R8);
- the page's `TransferForm` **already pre-fills** from a draft and the later
  asks **already name** the disputed field (R10).

What is new and named:

- one engine module for the stop (`stop.ts`) and one for destination matching
  (`destination.ts`), both pure (D6, D11);
- three fields on the reader's prompt: `destino`, `cuentaOrigen`,
  `operacion` (D11, D14, D15);
- the engine narrows a candidate list by the reading and reports the
  identifier it used (D9); the lifecycle stores it and keeps the receipt door
  while it is unknown (D10, D12);
- four columns on `businesses`, two on `payments`, four on `extractions` in
  one additive migration (data-model.md);
- the Cuenta screen gains the card and the phone (D13); the payment page gains
  the identifiers, the capture guide, the ask and the account choice (D16–D18).

Two facts could not be settled from here and the design is built so it does
not need them: whether the provider's answer names the matching candidate
(D10 removes the need), and where each bank's app shows the clave (D16 ships
only verified hints). Production has no traffic yet (measured 2026-09-23), so
the feature's rates are unknown today and countable from its first week
(FR-023, D19).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`;
Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4.7, Drizzle ORM 0.40 over D1, zod 3.24,
wrangler 4, `@cloudflare/vitest-pool-workers` 0.8; React 19 + TanStack Query
on the payer page and the panel; Workers AI through the `AI` binding — the
reader model is a var (`@cf/mistralai/mistral-small-3.1-24b-instruct` by
default); apiCEP at `https://api.apicep.cloud`, the only provider, whose
beneficiary types (CLABE, card, phone) and candidate list are documented and
unmeasured (research R3)

**Storage**: one D1 (`devolada-db`); one additive migration `0036`: columns
on `businesses`, `payments` and `extractions`, no new table. R2 `PROOFS`
unchanged

**Testing**: Vitest 3.2 in workerd with a real local D1; apiCEP intercepted
with `fetchMock` at its pinned origin; the reader stubbed at the binding
(`aiReturning`) with the three new fields; component tests for the payer page
and the panel on happy-dom with MSW, axe on every screen; the capture guide's
contrast, width and focus in Playwright (`tests/e2e/pago.spec.ts`)

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01;
`dev` and `prod` under `devoladapago.com`

**Project Type**: pnpm monorepo — `apps/api` (engine, lifecycle, routes,
schema, migration), `apps/pago` (the payer page), `apps/admin` (the Cuenta
screen). `packages/ui` untouched

**Performance Goals**: zero provider credits on the three stops (SC-001,
SC-006, SC-007); no extra Workers AI call — the three new fields ride the
same prompt, and the paid attempt still reuses the draft's reading
(two-eyes D14); a transfer to a card or phone confirms in as many paid calls
as one to the CLABE (SC-005)

**Constraints**: migrations additive; nothing about verdicts, the fee,
partial settlement, the schedule or top-ups moves (FR-024); every row born
before the migration keeps today's path (FR-022); the one cross-business read
(the shape rules) is untouched (constitution V); es-MX copy on both surfaces;
no new token, layer or motion (constitution VI)

**Scale/Scope**: engine — `reader.ts` (+3 fields), `stop.ts` and
`destination.ts` (new, pure), `validate.ts` (candidates, stop, narrowing),
`extract.ts` (stop on the reading, new outcomes), `index.ts` (facade types),
`failure.ts` (+2 codes); lifecycle — `validation.ts` (beneficiary from the
row, acceptance rules); routes — `direct-payments/{handler,schema}.ts`,
`settings/{handler,schema}.ts`; schema + migration; pago — `PaymentPage.tsx`,
`CaptureGuide.tsx`, `bank-hints.ts`; admin — `SettingsScreen.tsx`; sandbox —
card/phone/candidates. Tests: ~12 engine scenarios, ~8 lifecycle, ~5
settings, ~10 page, ~3 panel, 1 browser — all cited `receipt-triage US<n>`;
the ones research R13 names are rewritten

## Decisions

The spec fixes D1–D5. The plan adds the ones below; code comments cite them
as `receipt-triage D<n>` (constitution I).

| # | Decision | Made in |
| --- | --- | --- |
| D1–D5 | Card and phone as identifiers; the identifier learned from the receipt, never guessed; the capture guide inside the step; missing fields named before a credit (narrowing two-eyes D2/FR-005 for a clear capture with no clave); Spin verified only as SPEI | spec |
| D6 | One stop rule in the engine, two callers: `/read` reports it and the page renders it, the receipt door enforces it before the provider call. `RECEIPT_INCOMPLETE` is revived for the missing key; `RECEIPT_NOT_SPEI` and `RECEIPT_WRONG_DESTINATION` are new | research R1 |
| D7 | "Clear" means `legibility === "full"` on a picture, or a PDF's text. A picture whose legibility the model omitted goes through: a convention chosen to let files through is not reused to stop them | research R2 |
| D8 | Only a *missing* clave stops. A *malformed* one is a reading the provider may fix for the same credit | research R2 |
| D9 | The lifecycle hands the engine every identifier; the engine reads the file, narrows by the destination, sends one beneficiary or the candidate list, and reports `beneficiaryUsed` | research R3 |
| D10 | While a multi-identifier payment's beneficiary is unknown, its retries keep the receipt door with the candidate list, as a missing date does (two-eyes plan D20). The design never needs the provider to name the matching candidate | research R3 |
| D11 | The destination is matched by visible trailing digits against every form of each identifier — whole CLABE, its 11-digit account segment, card, phone. Fewer than three digits, or more than one match, is *unknown*; only a clear reading matching nothing is a mismatch | research R5 |
| D12 | The payment snapshots the identifiers at submission (`beneficiary_candidates`) and the one it was sent to (`beneficiary`); attempts read the payment, never the business. Rows with neither keep today's fallback | research R6 |
| D13 | Card and phone are columns on `businesses` in the `clabe` area (owner only), masked like the CLABE; the CLABE stays required and `configured` keeps its meaning | research R7 |
| D14 | A Spin reading's institution is established only from the origin account's prefix (`bankForClabe`: 728 → `SPIN BY OXXO`, 646 → `STP`); otherwise machine data with a Spin bank is not accepted for the transfer door. `STP` read as such is untouched | research R8 |
| D15 | The reader reports the operation (SPEI, same institution, cash) for every receipt; only a clear Spin reading with no clave printed is stopped on it | research R8 |
| D16 | Bank hints are es-MX copy in the payer app, keyed by `Bank`, each with its source and date; an entry only from a real receipt or the bank's own documentation. Launch: Banorte. SC-003 amended | research R9 |
| D17 | "A second capture still has no clave" is page state, counted per visit | research R10 |
| D18 | The capture guide is an app-local component: an inline SVG in token classes, numbered markers named in text, the rules as a list, the tips in the existing `Collapsible`, no motion | research R11 |
| D19 | `extractions` gains `proof_key`, `destination_kind`, `destination_digits`, `operation` and three outcomes, so every count in FR-023 is one query | research R12 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against v1.5.0. One gate per principle; verdicts re-read after
Phase 1 (below the table).

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Nineteen decisions with the place each was made. Every new rule in code cites `receipt-triage D<n>`. The comments that say a hole never refuses (`consta/validate.ts` D2/D3 block, `consta/failure.ts` on `RECEIPT_INCOMPLETE`, `reader.ts` on `legibility`, the `/read` handler's header) are rewritten to name the one case D4 narrows, not left contradicting the code. The two-eyes spec gains a dated note pointing at receipt-triage D4 | PASS |
| II | Money Law | No amount is added or converted. The destination and origin fields are digits as text, never money. The amount the stop names as missing is a field name, not a value | PASS |
| III | One Contract, Pure Routers | `linkStatusResponse`, `proofReadingResponse`, `payRequest`, `settingsResponse`, `settingsPatchRequest` gain optional fields only (contracts/). Routers untouched: the changes are in handlers. The bank hints are keyed by the `Bank` type re-exported from the schema, so the vocabulary still has one source (`gen-banks`). The engine's new codes are internal and never travel to a browser | PASS |
| IV | Tests Run on the Real Runtime | apiCEP stays intercepted at its pinned origin, now also answering card, phone and candidate bodies; the reader stays the one binding a test stands in for, its stub carrying the three new fields; migrations applied per test. The guide's contrast and width are measured in the browser layer, not guessed in happy-dom | PASS |
| V | Tenant Isolation and Authorization by Area | Every new column sits on a table that already carries `business_id` (or is `businesses` itself). The card and phone use the existing `clabe` area — no new area or action. The destination match reads only the business's own identifiers. No new cross-business read | PASS |
| VI | Visual Foundations (NON-NEGOTIABLE) | The guide draws with token classes only; markers are numbered and named in text, never colour alone; the ask uses the existing `Alert` (icon + text); controls keep their declared sizes (48px on the page, 40px compact in the panel); no motion; checked at 360/768/1280 in both themes by the browser layer. es-MX copy throughout. The guide is app-local because only one surface renders it | PASS |
| VII | Every Test Cites Its Story | New and rewritten tests cite `receipt-triage US1`…`US4`; research R13 names the two-eyes assertions that change so none disappears unnamed | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | No `AI` binding → no reading, so no stop and no narrowing: the file goes to the provider with the whole candidate list, as a no-reading file does today. A business with no card or phone → today's payload and today's single beneficiary. No `APICEP_TOKEN` → unchanged. The `AI` comment in `env.ts` gains the one sentence saying so | PASS |

**Post-design re-check (after Phase 1).** Still PASS on all eight. Two points
re-read on purpose: (III) the payer page never receives a card or phone it
should not show — both are public on the transfer step by design, like the
CLABE; the panel masks them for roles without the `clabe` area. (V) the
`/read` route now passes the business's identifiers into the engine; the
engine uses them for matching and records only the reading's own digits, never
the identifiers, on `extractions`.

## Project Structure

### Documentation (this feature)

```text
specs/010-receipt-triage/
├── plan.md              # This file
├── spec.md              # D1–D5, four stories, FR-001…FR-024
├── research.md          # Phase 0: R1–R13 and what was measured
├── data-model.md        # Phase 1: columns, reading fields, stop order
├── quickstart.md        # Phase 1: validation per story, gates in CI order
├── contracts/
│   ├── engine.md        # facade types, stop, matching, new codes
│   ├── payment-page.md  # link payload, /read stop, pay receivingAccount, page copy
│   └── settings.md      # card and phone in Cuenta
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── migrations/0036_receipt_triage.sql          # + additive columns (data-model.md)
├── src/
│   ├── db/schema.ts                            # ~ businesses, payments, extractions columns; outcome vocabulary
│   ├── env.ts                                  # ~ AI comment: no reading → no stop, whole candidate list
│   ├── consta/
│   │   ├── index.ts                            # ~ ConstaBeneficiary widened, receipt list, verdict + reading fields
│   │   ├── failure.ts                          # ~ RECEIPT_INCOMPLETE revived, + RECEIPT_NOT_SPEI, RECEIPT_WRONG_DESTINATION
│   │   ├── validate.ts                         # ~ read with a list, stop before the provider, narrow, beneficiaryUsed, spinInstitution
│   │   ├── extract.ts                          # ~ stop on the reading, new outcomes, proof_key and destination on the row
│   │   └── extraction/
│   │       ├── reader.ts                       # ~ destino, cuentaOrigen, operacion in FIELDS (both prompts)
│   │       ├── stop.ts                         # + stopBeforeCredit (pure)
│   │       ├── destination.ts                  # + matchDestination, spinInstitution (pure)
│   │       ├── gate.ts                         # unchanged
│   │       └── compare.ts                      # unchanged
│   ├── direct-payments/
│   │   └── validation.ts                       # ~ beneficiary from the row (D12), accepted needs a known beneficiary (D10) and an established Spin bank (D14)
│   └── routes/
│       ├── direct-payments/
│       │   ├── handler.ts                      # ~ link payload identifiers; /read passes identifiers; pay: receivingAccount, snapshot
│       │   └── schema.ts                       # ~ contracts/payment-page.md
│       └── settings/
│           ├── handler.ts                      # ~ card/phone: clabe area, pairs, masking
│           └── schema.ts                       # ~ contracts/settings.md
├── sandbox/apicep-mock.mjs                     # ~ accepts cardNumber, phoneNumber, potentialBeneficiaries
└── test/
    ├── consta/helpers.ts                       # ~ stub readings carry destino, cuentaOrigen, operacion
    ├── consta/validate.test.ts                 # ~ R13 rewrites; + stop, narrowing, Spin
    ├── direct-payment.test.ts                  # + snapshot, receipt door with candidates, receivingAccount
    └── settings.test.ts                        # + card and phone

apps/pago/
├── src/features/pago/
│   ├── PaymentPage.tsx                         # ~ identifiers, the ask, lead with typing, account choice, Spin note, later-ask hint
│   ├── CaptureGuide.tsx                        # + the guide (D18)
│   └── bank-hints.ts                           # + BANK_HINTS (D16)
└── test/pago.test.tsx                          # + US1–US4 scenarios

apps/admin/
├── src/features/settings/SettingsScreen.tsx    # ~ card and phone in the owner-only block
└── test/settings.test.tsx                       # + card and phone scenarios

tests/e2e/pago.spec.ts                          # + the guide at 360/768/1280, both themes
specs/005-two-eyes-receipt/spec.md              # ~ dated note: D2/FR-005 narrowed by receipt-triage D4 (done with this plan)
```

**Structure Decision**: the feature edits the engine, the lifecycle, three
route handlers, one page and one panel screen in place. Two new pure engine
modules keep the stop and the matching testable without a database, the way
`compare.ts` holds the two-eyes comparison. No new package, route, table,
area or token.

## Complexity Tracking

No constitution gate is violated; nothing to justify.
