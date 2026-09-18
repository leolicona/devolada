# Implementation Plan: two-eyes-receipt

**Branch**: `claude/pdf-vision-model-support-bv03j5` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-two-eyes-receipt/spec.md`

## Summary

Turn the receipt flow around. Today the product reads the receipt at the
edge, gates it, and spends the first provider credit on the transfer door
with that reading; the provider's own reading arrives only on a second
credit, a minute later, and only after a "not found". After this feature the
first credit sends the file to the provider's image door with our reading
riding beside it; when Banxico has nothing yet, the two readings are compared
on the spot, the bank's learned clave shape breaks a tie, and the payer is
asked only when nothing can decide, and only for the field in doubt. PDFs
join the same flow: the engine turns the PDF into text with the model binding
it already holds and reads the text with the same reader, so a PDF gets the
same draft, gate and protections as a picture. The reader also judges
legibility, and only "not a receipt" and "not legible at all" block before a
credit is spent.

Phase 0 found that **almost every piece already exists and the work is
re-wiring, not building**: the provider's reading survives a failed call
(measured 2026-08-26) and is already parsed; the three-word classification
(agreed / disputed / blind) and the disputed-field form on the payer's page
are already built for the minute-two cross; the shape rules already judge a
clave against a bank; the provider door already takes a PDF; and the model
binding the reader uses already offers a PDF-to-text conversion, typed on
the binding this repo compiles against. What is new is small and named:

- the engine's receipt door goes to the provider first and classifies on
  the way back (research R1, R2), with the shape rules judging both claves
  (R3);
- the lifecycle stores the accepted data and lets the next attempt pick the
  transfer door from it (R4), for payments and for top-ups alike (R9);
- the pay request stops waiting on the provider (R5);
- the reader gains a text variant for PDFs (R6) and a legibility verdict
  (R7), and reuses the draft's reading instead of calling the model twice
  (R8);
- one additive migration adds the columns the classification and the
  measurement need (data-model.md);
- payments born before the cut-over keep the minute-two cross, identified
  by a shape no new row can have (R10).

The biggest single cost is again the tests: the receipt-door scenarios of
the engine suite and the payer page's upload scenarios assert today's order
of doors, and every one of them must be rewritten to assert the new one, with
its citation.

## Vocabulary

Four doors, two on each side, named the same way in every artifact and
comment:

- **The engine's doors** are what a caller sends: the *transfer door* (a
  request carrying typed or accepted data) and the *receipt door* (a
  request carrying a file key).
- **The provider's doors** are what apiCEP is asked: its *transfer door*
  (sender data, one lookup) and its *image door* (a signed link to the
  file, which the provider reads itself — "OCR mode" in the provider's
  own words).

A receipt-door request reaches the provider's image door first (D3) and its
transfer door on later attempts once data is accepted (D17). "OCR door",
"direct mode" and "minute-two cross" in existing comments are rewritten to
these four names where the code beneath them changes (T037).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`;
Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4.7, Drizzle ORM 0.40 over D1, zod 3.24,
wrangler 4, `@cloudflare/vitest-pool-workers` 0.8; Workers AI through the
`AI` binding — the reader model `@cf/mistralai/mistral-small-3.1-24b-instruct`
(a var, text and vision) and the binding's own `toMarkdown` conversion for
PDFs (`@cloudflare/workers-types` 4.20260702.1 in the lockfile declares it:
`toMarkdown(files: MarkdownDocument[]) → ConversionResponse[]`); apiCEP at
`https://api.apicep.cloud`, the only provider, two doors at one price

**Storage**: one D1 (`devolada-db`; one additive migration `0029`: columns
on `payments`, `extractions` and `top_ups`, no new table); R2 `PROOFS`
unchanged

**Testing**: Vitest 3.2 in workerd with a real local D1; apiCEP intercepted
with `fetchMock` at its pinned origin; the reader stubbed at the binding
(`aiReturning`, which gains a `toMarkdown` stub); proofs in the miniflare
bucket. Component tests for the payer page on happy-dom with MSW. The pay
request's non-blocking answer is tested with `createExecutionContext` /
`waitOnExecutionContext` from `cloudflare:test`

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01,
`nodejs_compat`; `dev` and `prod` under `devoladapago.com`

**Project Type**: pnpm monorepo. Backend (`apps/api`: engine, lifecycle,
routes, schema, migration) plus the public payment page (`apps/pago`: the
upload step, one new refusal message, the above-debt confirmation). The
admin is untouched; the top-up screen is untouched

**Performance Goals**: the pay request answers in the time of a D1 insert,
never the provider's 6–10 s (SC-007); one Workers AI call per receipt for the
reading (the draft's reading is reused by the paid attempt, R8), plus one
free PDF-to-text conversion for a PDF; a payment whose two readings agree
spends exactly one credit in its first minute (SC-003)

**Constraints**: migrations additive (the PR preview applies them to the
live dev database); every verdict's meaning, the schedule, the fee, partial
settlement and provisional release unchanged (FR-023); the shape rules stay
the one cross-business read they are (constitution V); no AI binding still
degrades to the provider, now with no reading on our side (constitution
VIII); es-MX copy only on the payer's page (constitution VI)

**Scale/Scope**: engine — `validate.ts` receipt branch rewritten, `reader.ts`
+ text prompt and legibility, `extraction/index.ts` + PDF text route, one new
module `extraction/compare.ts`, `extract.ts` + reuse and the legibility
outcome; lifecycle — `validation.ts` door selection and classification
storage, `credit/topups.ts` the same in miniature; routes — pay handler
non-blocking, read handler + legibility, `schema.ts` + one field; schema +
migration; payer page — three edits; tests — ~14 engine scenarios rewritten
or added, ~8 lifecycle scenarios, ~6 page scenarios, ~2 top-up scenarios,
all cited `two-eyes-receipt US<n>`

## Decisions

The spec fixes D1–D10. The plan adds the ones below; code comments cite
all of them as `two-eyes-receipt D<n>` (constitution I). D20 was added on
2026-09-18 after `/speckit-analyze` (finding U1); findings C1, I1, C2, C3,
R1, T1, D1, U2 and U3 of the same run were folded into the spec, the data
model, research R5 and R9, the contracts and the tasks with dated notes.

| # | Decision | Made in |
| --- | --- | --- |
| D1–D10 | The product decisions: text at the edge for PDFs, legibility, provider first, non-blocking pay, minute-zero comparison, agreement stops spending, shape rules as tiebreaker, payer asked only for the field in doubt, never an immediate second call, the numbers counted from day one | spec |
| D11 | The provider-first flow and the classification live in the engine's receipt door; the lifecycle stores the outcome and picks the door for the next attempt from the row | research R1 |
| D12 | The provider's own "could not read" answer on a provider-first call is a `not_found` verdict with a blind classification, never a failure that rides the schedule unclassified | research R2 |
| D13 | The payer's page sends `transfer` only from a form the payer edited; a machine reading, confirmed or not, travels as `proofId` alone. The above-debt confirmation becomes "send as is" or "correct" | research R5 |
| D14 | The paid attempt reuses the draft's reading — same owner, same file hash, younger than the proof link's lifetime — instead of calling the model again | research R8 |
| D15 | A PDF whose text step yields nothing produces an empty reading, never a legibility refusal: legibility is a verdict the model gives on a picture it saw | research R6 |
| D16 | A payment born before the cut-over is one with `proof_mode = 'transfer'`, a `proof_key` and no `supersedes_id`; no row born after can have that shape, so those rows alone keep the minute-two cross | research R10 |
| D17 | The retry door is chosen from the row: accepted data present → transfer door; otherwise the receipt door. `proof_mode` keeps meaning "what the payer submitted" | research R4 |
| D18 | Top-ups take the same engine path; with no human to ask, a top-up the machines cannot decide keeps riding the receipt door as today | research R9 |
| D19 | The classification and both readings are recorded on the reading record (`extractions`) for every owner, and the payment carries what its page needs; the measurement is one query over one table | research R11 |
| D20 | A missing date is a disputed field: when the accepted data has no date, `disputedFields` carries `"date"`, the page asks for the date alone, and the transfer door is never called with a date nobody read. Agreement evidence stands meanwhile | `/speckit-analyze` 2026-09-18, finding U1 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against v1.3.0. One gate per principle; verdicts re-read after
Phase 1.

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Nineteen decisions with the place each was made. Every new rule in code cites `two-eyes-receipt D<n>`; the comments that describe today's order of doors (`extraction/index.ts` D2 header, `validate.ts` D1/D2 block, `schema.ts` reading-check comment, the `proofReadingResponse` "provider-ocr means a PDF" comment) are rewritten, not left contradicting the code | PASS |
| II | Money Law | The provider's amount already arrives as cents through `amountToCents`; ours through the gate's `amountToCents`. The comparison is integer equality on cents. No new conversion is introduced; the one outbound `cents / 100` on the transfer door is unchanged | PASS |
| III | One Contract, Pure Routers | `proofReadingResponse` gains `legibility`; `payRequest` and `payResponse` keep their shapes (the inline status simply is always `validating` now); routers untouched — the change in the pay route is in the handler. The engine facade gains fields on `ConstaVerdict` and `ConstaReading` (contracts/engine.md); it is a component, not a surface. Bank vocabulary untouched | PASS |
| IV | Tests Run on the Real Runtime | apiCEP stays intercepted at its pinned origin, now answering the image door first; the reader stubbed at the binding, the stub extended with `toMarkdown` so a PDF test seeds the text the conversion would return — the binding remains the one thing a test stands in for. The non-blocking pay is exercised with a real execution context from `cloudflare:test`, not a mocked handler | PASS |
| V | Tenant Isolation and Authorization by Area | Every new column sits on tables that already carry `business_id`; the one new read the engine makes — reuse of a recent reading of the same file (D14) — filters on the owner and the file hash. The shape rules' cross-business read is unchanged in scope; it is applied to a second clave, not to a new column. No new area or action | PASS |
| VI | Visual Foundations (NON-NEGOTIABLE) | The payer page gains one refusal message (es-MX, in the existing `Alert` atom, icon + text) and a two-button confirmation on the existing above-debt screen, both from existing atoms and tokens; no new literal, no new layer, no new motion | PASS |
| VII | Every Test Cites Its Story | New and rewritten tests cite `two-eyes-receipt US1`…`US5`; the retired assertions are named in research R12 so nothing disappears unnamed; `spec-lint` runs on every file touched | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | No `AI` binding → the receipt door still goes to the provider, with an empty reading on our side, and the page never blocks (FR-005); a binding without `toMarkdown` (older runtime) or a failed conversion → a PDF continues with an empty reading (D15, FR-002); no `APICEP_TOKEN` → unchanged. `env.ts` comments say so for `AI` | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/005-two-eyes-receipt/
├── plan.md              # This file
├── spec.md              # D1–D10, five stories, FR-001…FR-023
├── research.md          # Phase 0: R1–R12
├── data-model.md        # Phase 1: columns on payments, extractions, top_ups
├── quickstart.md        # Phase 1: validation per story, gates in CI order
├── contracts/
│   ├── engine.md        # ConstaVerdict / ConstaReading additions, door rules
│   └── payment-page.md  # proofReadingResponse + what the page sends when
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── migrations/0029_two_eyes_receipt.sql        # + additive columns (data-model.md)
├── src/
│   ├── db/schema.ts                            # ~ payments, extractions, top_ups columns; comments rewritten
│   ├── env.ts                                  # ~ AI comment: what unset means now
│   ├── consta/
│   │   ├── index.ts                            # ~ ConstaVerdict/ConstaReading fields (contracts/engine.md)
│   │   ├── validate.ts                         # ~ receipt door: provider first, classify, accepted data (R1, R2)
│   │   ├── extract.ts                          # ~ reuse (R8), legibility outcome, PDF is a reader row (R6)
│   │   └── extraction/
│   │       ├── index.ts                        # ~ PDF → text → reader; D2 header rewritten
│   │       ├── reader.ts                       # ~ text prompt variant, legibility field (R6, R7)
│   │       ├── pdf-text.ts                     # + toMarkdown wrapper; empty on any failure (D15)
│   │       ├── compare.ts                      # + classification + accepted data + tiebreak (R2, R3)
│   │       ├── gate.ts                         # unchanged
│   │       └── shape.ts                        # unchanged (called with the provider's clave too)
│   ├── direct-payments/
│   │   ├── validation.ts                       # ~ door from the row (D17), store classification, legacy cross kept for D16 rows
│   │   └── provisional.ts                      # unchanged (agreed at minute zero flows through releaseEvidenceFor as is)
│   ├── credit/topups.ts                        # ~ door from the row, store accepted data (R9)
│   └── routes/direct-payments/
│       ├── handler.ts                          # ~ pay: non-blocking (R5); read: legibility refusal
│       └── schema.ts                           # ~ proofReadingResponse.legibility; comments
├── sandbox/apicep-mock.mjs                     # ~ OCR door answers with an `extracted` reading, "blind" trigger
└── test/
    ├── consta/helpers.ts                       # ~ aiReturning gains toMarkdown; a text-PDF fixture
    ├── consta/validate.test.ts                 # ~ receipt door scenarios rewritten (R12)
    ├── direct-payment.test.ts                  # ~ inline attempt, US-D14 cross, + first-call classification
    └── prepaid-credit.test.ts                  # + top-up receipt through the new door

apps/pago/
├── src/features/pago/PaymentPage.tsx           # ~ upload: legibility refusal; silent path sends proofId only (D13); above-debt: send as is / correct
└── test/pago.test.tsx                          # ~ scenarios 43/44/45, above-debt, + legibility

.specify/debt/legacy-minute-two-cross/          # + logged at implementation: the D16 branch dies with the last pre-cut-over row
```

**Structure Decision**: the feature edits the engine, the lifecycle, two
route handlers and one page in place. No new package, no new route, no new
table. The one new engine module (`compare.ts`) holds the comparison and
tiebreak so that `validate.ts` reads as the flow and the rule has one home.

## Complexity Tracking

No constitution gate is violated; nothing to justify.
