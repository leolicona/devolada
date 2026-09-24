# Implementation Plan: receipt-triage

**Branch**: `claude/payment-receipt-info-handling-bhqn5o` | **Date**: 2026-09-24 (first planned 2026-09-23) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-receipt-triage/spec.md`

## Summary

Three changes around the receipt upload. **Before it**, the payer sees what a
good capture shows. **During the check**, the referencia numérica becomes a
second key: the product reads it, compares it and searches Banxico with it
whenever there is no clave de rastreo, and a payer who types their data may
give either. **After the reading**, a clear capture that shows neither key is
stopped before any paid call, and the payer is told exactly which data is
missing, where their bank shows it, and that they can type it — with
everything the capture did show already filled in.

Phase 0 found that the engine already speaks reference end to end — the
request guard, the provider adapter, the billing log and the parsing of the
provider's own reading all carry it (research R1). What stops it is the layer
above: a facade type, the reader, the gate, the comparison, one payment
column, the lifecycle's `accepted` test and the pay contract. The ask reuses
the two-eyes refusal's exact shape — `/read` reports, the page renders, the
receipt door enforces — and revives a failure code the engine still declares
(`RECEIPT_INCOMPLETE`). Two things are genuinely new: Banxico's clave must be
adopted onto a confirmed row that was found by reference, or the reference
would reopen the double payment direct-payment D8 closed (R4); and the
provider's "this reference matches more than one transfer" must stop the
retries and ask for the clave, or every slot would buy the same refusal (R7).

Production has no traffic yet (measured 2026-09-23), so the feature's rates
are unknown today and countable from its first week (FR-022, D19).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`;
Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4.7, Drizzle ORM 0.40 over D1, zod 3.24,
wrangler 4, `@cloudflare/vitest-pool-workers` 0.8; React 19 + TanStack Query
on the payer page; Workers AI through the `AI` binding — the reader model is
a var (`@cf/mistralai/mistral-small-3.1-24b-instruct` by default); apiCEP at
`https://api.apicep.cloud`, whose direct mode takes `referenceNumber` when
there is no `trackingKey` (documented, unmeasured — research, "What was
measured")

**Storage**: one D1 (`devolada-db`); one additive migration `0036`: one
column on `payments`, three on `extractions`, no new table. R2 `PROOFS`
unchanged

**Testing**: Vitest 3.2 in workerd with a real local D1; apiCEP intercepted
with `fetchMock` at its pinned origin, now also answering reference searches
and the 422; the reader stubbed at the binding (`aiReturning`) with
`referenciaNumerica`; component tests for the payer page on happy-dom with
MSW, axe on every state; the capture guide's contrast and width in Playwright
(`tests/e2e/pago.spec.ts`)

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01;
`dev` and `prod` under `devoladapago.com`

**Project Type**: pnpm monorepo — `apps/api` (engine, lifecycle, routes,
schema, migration) and `apps/pago` (the payer page). `apps/admin` and
`packages/ui` untouched

**Performance Goals**: zero provider credits on a clear capture with no key
(SC-001); no extra Workers AI call — the reference rides the same prompt, and
the paid attempt still reuses the draft's reading (two-eyes D14); a
reference-only receipt confirms in at most two paid calls (SC-002); a
reference matching more than one transfer costs at most one (SC-005)

**Constraints**: migration additive; what a verdict means, the fee, partial
settlement and the schedule are unchanged (FR-023); every row born before the
migration keeps today's path (FR-021); the shape rules' cross-business read is
untouched, and never consulted for a reference (constitution V, D11);
es-MX copy on the page; no new token, layer or motion (constitution VI)

**Scale/Scope**: engine — `reader.ts` (+1 field), `gate.ts` (+1 verdict),
`compare.ts` (key = clave or reference), `ask.ts` (new, pure), `validate.ts`
(ask before the provider), `extract.ts` (ask on the reading, new outcome,
proof key and references on the row), `index.ts` (facade types),
`failure.ts` (comment), `provider/apicep.ts` (comment); lifecycle —
`validation.ts` (accepted with either key, adoption, the 422); routes —
`direct-payments/{handler,schema}.ts`; schema + migration; sandbox — reference
triggers; pago — `PaymentPage.tsx`, `CaptureGuide.tsx`, `bank-hints.ts`.
Tests: ~8 engine, ~7 lifecycle, ~12 page, 1 browser — all cited
`receipt-triage US<n>`; the ones research R12 names are rewritten

## Decisions

The spec fixes D1–D8. The plan adds the ones below; code comments cite them
as `receipt-triage D<n>` (constitution I).

| # | Decision | Made in |
| --- | --- | --- |
| D1–D8 | A key is a clave or a reference; a reference is up to seven digits as printed; Banxico's clave kept for every confirmation; a clear capture with neither key asked about before any credit; the feedback's when, where, words and ways forward; the same pattern for later asks; a reference matching more than one transfer asks for the clave; the capture guide inside the step | spec |
| D9 | The reference is threaded through every layer as an optional sibling of the clave, with one rule: the reference travels when there is no clave, both when both exist | research R1 |
| D10 | The reader asks for "Referencia"/"Referencia numérica" and is told what is not one; the gate accepts `^\d{1,7}$` as printed. The engine's guard stays at 20 digits for other callers | research R2 |
| D11 | The comparison's key is the clave when either side read one, the reference otherwise; the shape rules never judge a reference; a disputed reference goes to the payer | research R3 |
| D12 | A confirmed row with a reference and no clave adopts the CEP's clave whatever its `proof_mode`, under the existing unique index | research R4 |
| D13 | One pure `askBeforeCredit` in the engine: `/read` reports it, the receipt door throws `RECEIPT_INCOMPLETE` on it before the provider call | research R5 |
| D14 | The ask fires only when both keys are *missing* and the reading is *certain* — `legibility === "full"` on a picture, or a PDF's text. Omitted legibility, `partial`, and a malformed clave go through | research R6 |
| D15 | On the provider's `provide_tracking_key`, the row asks for the clave (`disputed_fields`, `REFERENCE_AMBIGUOUS`) and skips the provider on later slots until it has one | research R7 |
| D16 | The ask reuses the refusal `Alert` and `TransferForm`: three sentences, focus on arrival, two buttons, "No aparece en tu captura" under each empty field, the form first on a second ask in one visit | research R8 |
| D17 | Bank hints are es-MX copy in the payer app, keyed by `Bank`, each with its source and date; an entry only from a real receipt or the bank's own documentation. Launch: Banorte | research R9 |
| D18 | The capture guide is an app-local component: an inline SVG in token classes, numbered markers named in text, the rules as a list, the tips in the existing `Collapsible`, no motion | research R10 |
| D19 | `extractions` gains `proof_key`, `reference_number`, `provider_reference_number` and the outcome `key_missing`, so every count in FR-022 is one query | research R11 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against v1.5.0. One gate per principle; verdicts re-read after
Phase 1 (below the table).

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Nineteen decisions with the place each was made. Every new rule in code cites `receipt-triage D<n>`. Comments that say a hole never refuses (`consta/validate.ts` D2/D3 block, `consta/failure.ts` on `RECEIPT_INCOMPLETE`, `reader.ts` on legibility, the `/read` handler's header) and that Devolada "cannot hit" the 422 (`provider/apicep.ts`) are rewritten, not left contradicting the code. The two-eyes spec carries a dated note pointing at receipt-triage D4 (done with this plan) | PASS |
| II | Money Law | No amount is added or converted. A reference is text, never parsed as a number, so its leading zeros survive. The amount the ask names as missing is a field name, not a value | PASS |
| III | One Contract, Pure Routers | `proofReadingResponse`, `payRequest`, `directPaymentStatusResponse` and `publicPaymentError` change additively (contracts/payment-page.md). Routers untouched; the logic is in handlers. The engine's facade changes are internal (contracts/engine.md). The bank hints are keyed by the `Bank` type the schema re-exports, so the vocabulary keeps one source (`gen-banks`) | PASS |
| IV | Tests Run on the Real Runtime | apiCEP stays intercepted at its pinned origin, answering reference searches and the 422 as the adapter already parses them; the reader stays the one binding a test stands in for; migrations applied per test. The guide's contrast and width are measured in the browser layer | PASS |
| V | Tenant Isolation and Authorization by Area | The new columns sit on tables that already carry `business_id`. No new area, action or cross-business read; the shape rules are not consulted for references | PASS |
| VI | Visual Foundations (NON-NEGOTIABLE) | The guide draws with token classes; markers are numbered and named in text, never colour alone; the ask reuses the existing `Alert` (icon + text) and the form's fields; buttons at the 48px touch size; no motion; checked at 360/768/1280 in both themes. es-MX copy throughout. The guide is app-local because only one surface renders it | PASS |
| VII | Every Test Cites Its Story | New and rewritten tests cite `receipt-triage US1`…`US3`; research R12 names the two-eyes assertions that change, so none disappears unnamed | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | No `AI` binding → no reading, so no ask and no reference from our side: the file goes to the provider as today, and the provider's own reference, when it reads one, still counts. No `APICEP_TOKEN` → unchanged. The `AI` comment in `env.ts` gains the sentence saying so | PASS |

**Post-design re-check (after Phase 1).** Still PASS on all eight. Re-read on
purpose: (II) the reference column is `text` and every comparison of
references is string equality, so `038195` and `38195` never merge. (V) the
adoption of Banxico's clave (D12) is scoped by the existing index, which is
per business — one business's reference search can never collide with
another's row.

## Project Structure

### Documentation (this feature)

```text
specs/010-receipt-triage/
├── plan.md              # This file
├── spec.md              # D1–D8, three stories, FR-001…FR-023
├── research.md          # Phase 0: what was measured, R1–R12
├── data-model.md        # Phase 1: columns, reading fields, the ask
├── quickstart.md        # Phase 1: validation per story, gates in CI order
├── contracts/
│   ├── engine.md        # facade types, the ask, the comparison, the 422
│   └── payment-page.md  # /read, pay, status, errors, page behaviour and copy
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── migrations/0036_receipt_triage.sql          # + additive columns (data-model.md)
├── src/
│   ├── db/schema.ts                            # ~ payments.reference_number; extractions columns; outcome vocabulary
│   ├── env.ts                                  # ~ AI comment: no reading → no ask
│   ├── consta/
│   │   ├── index.ts                            # ~ transfer: trackingKey | referenceNumber; accepted, reading, ask
│   │   ├── failure.ts                          # ~ RECEIPT_INCOMPLETE comment: thrown again, for one case
│   │   ├── validate.ts                         # ~ ask before the provider; reference into the comparison
│   │   ├── extract.ts                          # ~ ask on the reading; key_missing; proof_key and references on the row
│   │   ├── provider/apicep.ts                  # ~ the 422 comment: Devolada can hit it now
│   │   └── extraction/
│   │       ├── reader.ts                       # ~ referenciaNumerica in FIELDS (both prompts); what is not a reference
│   │       ├── gate.ts                         # ~ referenceNumber verdict; passes with either key
│   │       ├── compare.ts                      # ~ key = clave or reference; accepted with both keys
│   │       └── ask.ts                          # + askBeforeCredit (pure)
│   ├── direct-payments/
│   │   └── validation.ts                       # ~ accepted with either key; reference on the transfer door; adoption (D12); the 422 (D15)
│   └── routes/direct-payments/
│       ├── handler.ts                          # ~ /read: ask + reference; pay: reference; status: reference
│       └── schema.ts                           # ~ contracts/payment-page.md
├── sandbox/apicep-mock.mjs                     # ~ a reference it finds, and one it answers 422 for
└── test/
    ├── consta/helpers.ts                       # ~ stub readings carry referenciaNumerica
    ├── consta/validate.test.ts                 # ~ R12 rewrites; + reference comparison, the ask
    └── direct-payment.test.ts                  # + reference door, adoption, the 422

apps/pago/
├── src/features/pago/
│   ├── PaymentPage.tsx                         # ~ the ask, the key block, lead with typing, later asks
│   ├── CaptureGuide.tsx                        # + the guide (D18)
│   └── bank-hints.ts                           # + BANK_HINTS (D17)
└── test/pago.test.tsx                          # + US1–US3 scenarios

tests/e2e/pago.spec.ts                          # + the guide at 360/768/1280, both themes
specs/005-two-eyes-receipt/spec.md              # ~ dated note: D2/FR-005 narrowed by receipt-triage D4 (done with this plan)
```

The platform's top-ups (`credit/topups.ts`) need no edit: their `accepted`
test requires a clave, so a top-up whose readings agree on a reference only
keeps the receipt door, as the spec's Edge Cases say; the ask reaches them
through the engine exactly as the two-eyes refusals do.

**Structure Decision**: the feature edits the engine, the lifecycle, one route
handler and one page in place. One new pure engine module (`ask.ts`) keeps the
rule testable without a database, the way `compare.ts` holds the two-eyes
comparison. No new package, route, table, area or token.

## Complexity Tracking

No constitution gate is violated; nothing to justify.
