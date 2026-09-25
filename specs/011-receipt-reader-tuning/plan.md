# Implementation Plan: receipt-reader-tuning

**Branch**: `claude/comprobante-tracking-key-validation-jtknpt` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-receipt-reader-tuning/spec.md`

## Summary

Three changes to the receipt reader, in the creator's order:

- **The operator chooses the model.** A new **Lector** tab in `/operador`
  picks one model from the environment's allowed list. The list is a JSON
  var, so model ids stay configuration (constitution VIII). The choice is an
  append-only `platform_settings` row with its author, read on every reading
  with no cache, so the next reading uses it. A chosen model that fails is
  followed once by the default model (8 s limit on the chosen one), and the
  reading row says which model produced it and whether it was a fallback.
- **The questions read the right fields.** Version "2" of the prompt names
  both banks (`bancoEmisor`, `bancoReceptor`), takes the clave only from
  the field labelled as the clave, keeps a final letter, and reads each bank
  only from its own side. The receiving bank goes through the same
  vocabulary as the sending one. When the two are the same institution, the
  reading is flagged and **never altered**. It is also checked against the
  bank of the account the destination ties to. What the payer page receives
  does not change.
- **A test bench measures the models.** In the same tab, the operator
  uploads a receipt. Every listed model reads it in parallel, with no
  fallback, and the operator marks each field. A tally per model and
  question version decides the prod model and closes the receipt-triage
  measurement debt. The bench writes only to its own two tables and its own
  bucket prefix: no payment, no validation, no credit, no provider call, and
  no payer measurement.

Phase 0 found that the reader has exactly two doors, and both already hold
`db`. So the model can be resolved per reading without touching any other
caller (research R1). Also, Gemma 4's image-input and answer shapes through
the binding are **undocumented and unmeasured**. The design tolerates both
known answer shapes, and the bench is the instrument that proves them on the
first upload (R5).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`;
Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4.7, Drizzle ORM 0.40 over D1, zod 3.24,
wrangler 4, `@cloudflare/vitest-pool-workers` 0.8; React 19 + TanStack Query
in the panel. Workers AI goes through the `AI` binding: Mistral Small 3.1
24B (`@cf/mistralai/mistral-small-3.1-24b-instruct`, the default, measured
2026-08-19) and Gemma 4 26B A4B (`@cf/google/gemma-4-26b-a4b-it`, thinking
off via `chat_template_kwargs`, unmeasured, R5). Model ids live only in
`wrangler.jsonc` vars and in `DEFAULT_MODEL`.

**Storage**: one D1. One additive migration, `0037`: seven columns on
`extractions`, and two platform tables, `bench_receipts` and
`bench_readings` (data-model.md). The choice is a `platform_settings` row,
so there is no schema for it. R2 `PROOFS` gains a `bench/` prefix under the
existing 15-day lifecycle rule.

**Testing**: Vitest 3.2 in workerd with a real local D1. The reader is
stubbed at the binding (`aiReturning`), which gains per-model answers, a
throw and a wait. Only answer shapes that were measured are stubbed
(constitution IV); Gemma 4's is added from its real answer on the bench, and
until then the tolerant branch is registered debt. `EXTRACTION_MODELS` and
`READER_TIMEOUT_MS` are pinned in `vitest.config.ts`. `fetchMock` refuses
any provider call during bench tests. The panel is tested with happy-dom +
MSW with schema-parsed fixtures and axe on each state. The Lector tab joins
`tests/e2e/responsive.spec.ts` and `contrast.spec.ts`.

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01;
`dev` and `prod` under `devoladapago.com`

**Project Type**: pnpm monorepo. `apps/api` holds the engine's reader, the
new `routes/reader` area, the migration and the vars. `apps/admin` gets the
Lector tab. `apps/pago` and `packages/ui` are untouched.

**Performance Goals**:
- One indexed D1 read per reading to resolve the model (SC-003, no cache).
- No extra model call unless the chosen model fails. The payer's worst case
  is about 8 s + 3 s, and only while a failing model is chosen (R6).
- A prod model must read 9 of 10 receipts under 5 s on the bench (SC-005).
- A bench upload makes one call per listed model, in parallel, 30 s each at
  most.

**Constraints**:
- The payer page's contract (`/read`, `Gate`) and copy do not change.
- The same-institution guard (validation spec D17) is untouched.
- Neither bank is ever altered because of the other (FR-012).
- The migration is additive. Rows before it keep NULL (no guessed version).
- Bench files follow the payer proof's limits (1 MB, image/PDF) and
  lifecycle (15 days).
- es-MX copy in the panel. No new token, layer or motion (constitution VI).

**Scale/Scope**:
- Engine: `models.ts` (new), `reader.ts` (signature, prompt v2, version,
  answer shapes, time limit), `extraction/index.ts` (the plan, the
  fallback), `gate.ts` (`receiving`), `extract.ts` and `validate.ts` (plan
  resolution, new columns, tie verdict, `recentReading`).
- Platform: `platform/reader-model.ts` (new), and the new area
  `routes/reader/{index,handler,schema}.ts` mounted at `/platform/reader`.
- Config and schema: schema + migration; `env.ts`, `wrangler.jsonc`,
  `vitest.config.ts`, `package.json` export.
- Admin: `ReaderTab.tsx` (+ a bench detail component) and one line in
  `OperatorScreen.tsx`.
- Tests: ~12 model-choice/fallback, ~10 questions/banks, ~12 bench (API);
  ~8 panel; 2 browser. All cited `receipt-reader-tuning US<n>`.

## Decisions

The spec fixes D1–D6. The plan adds the decisions below. Code comments cite
them as `receipt-reader-tuning D<n>` (constitution I).

| # | Decision | Made in |
| --- | --- | --- |
| D1–D6 | One model per environment, chosen in `/operador` from a list set by deploy; the questions stay in code with a version; a failed answer falls back to the default once; three rules for the questions; both banks read, a same-bank pair flagged and never altered; a test bench in `/operador` (option B) | spec |
| D7 | `EXTRACTION_MODELS` is a JSON var of `{ id, label, input? }`. `EXTRACTION_MODEL` stays the default and is always in the list. An unset or invalid list resolves to the default alone (invalid also warns). `READER_TIMEOUT_MS` is a test knob | research R2 |
| D8 | The choice is a `platform_settings` row (`reader_model`), outside the `SETTINGS` registry. It is resolved per reading with no cache. States: `default`, `applies`, `stale` | research R3 |
| D9 | The model is resolved by the two callers that hold `db` (`extract.ts`, `validate.ts`) into a reader plan `{ chosen, fallback }` handed to `extractProof`. `readProof` no longer reads `env` for the model | research R1 |
| D10 | One request shape for every model (today's `messages` with text + image data URI), with the list entry's `input` merged in. The answer text comes from `response`, else `choices[0].message.content`, else the serialized answer. Gemma 4 runs with thinking off | research R5 |
| D11 | Fallback on `ReaderError` only (unavailable, timeout, no JSON). An 8 s limit applies to a chosen model that is not the default. The default is never limited. The PDF is converted once. The row records the model that produced the reading, `fallback_from` and `reader_ms` | research R6 |
| D12 | `QUESTIONS_VERSION`: "1" names today's (receipt-triage) questions, "2" this feature's (Story 2); pinned to the SHA-256 of both prompts by a test. "1" reaches a row only if Story 1 ships before Story 2 (amended 2026-09-25, analyze I1) | research R7 |
| D13 | Prompt v2: `bancoEmisor`/`bancoReceptor` keys (`banco` still parses); the clave only from its labelled field; a final letter kept, no letter/digit swaps; each bank only from its own side; everything else word for word | research R8 |
| D14 | `GatedReading.receiving = { bank, verdict, sameBank }`, a sibling of `Gate`, so the payer contract does not move. Nothing acts on `sameBank`. `receiving_bank_tie` is `match`/`mismatch` against the tied account's bank | research R9 |
| D15 | `recentReading` carries `model`, `question_version`, `reader_ms`, `fallback_from` and rebuilds `receiving`. A reused reading is never re-read | research R10 |
| D16 | The bench: files at `PROOFS/bench/<uuid>` (1 MB, image/PDF, 15 days); platform tables `bench_receipts` (unique SHA-256) and `bench_readings` (unique receipt × model × version); every listed model in parallel, 30 s each, no fallback; synchronous in the upload. Nothing is written outside its own tables | research R11 |
| D17 | What is marked is the product-facing value (after the gate and the vocabulary). Marks are `right`/`wrong`/`absent`, and `absent` is judged against the reading. The tally per (model, version) is computed on request, with `p90Ms` and `asOf` | research R12 |
| D18 | A new area `routes/reader` mounted at `/platform/reader` behind the operator guard, exported as `./reader-schema` | research R4 |
| D19 | A fourth tab **Lector** holds the Modelo card, the Banco de pruebas, the receipt detail side by side and Resultados. Images come through the API client as blobs. Columns stack below 768 px | research R13 |
| D20 | Tests prove routing, recording and non-alteration with the reader stubbed per model, and stub only measured answer shapes; accuracy is measured on the bench, never asserted by a stub (amended 2026-09-25, analyze C2) | research R14 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against v1.6.0 (amended 2026-09-25 for this feature, analyze C1). One gate per principle. The verdicts were re-read
after Phase 1 (see the note below the table).

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Twenty decisions, each with the place it was made. Every new rule in code cites `receipt-reader-tuning D<n>`. Comments that would contradict the code are rewritten: `reader.ts`'s header ("the model is read from config"), `env.ts` on `EXTRACTION_MODEL`, and the wrangler comment "replacing it is a deploy". The "not run" line in `reader.ts` is replaced only by the dated bench tally (quickstart Step 3) | PASS |
| II | Money Law | The bench stores amounts as integer cents via `amountToCents`. No amount is added, compared or converted anywhere else | PASS |
| III | One Contract, Pure Routers | New area `routes/reader/{index,handler,schema}.ts`. The router is pure, the logic lives in the handler, and zod schemas are exported as `@devolada/api/reader-schema` and used by the panel's MSW fixtures and the e2e stubs. One envelope; `UPPER_SNAKE` codes (`INVALID_MODEL`, `FILE_EXPIRED`, reused `PROOF_TOO_LARGE`, `PROOF_UNSUPPORTED_TYPE`, `READER_UNAVAILABLE`). The payer contract (`/read`, `Gate`) is unchanged by design (D14) | PASS |
| IV | Tests Run on the Real Runtime | API tests run in workerd with a real D1 and migrations applied. The reader is still the one binding a test stands in for, now per model. `fetchMock` still intercepts the provider and refuses any call from the bench. Width and contrast of the new tab are measured in the browser layer. Accuracy is not asserted by a stub; it is measured on real models on the bench (D20). Only measured answer shapes are stubbed: the branch for Gemma 4's shape stays untested and registered as debt until the bench captures its real answer, which becomes the fixture | PASS |
| V | Tenant Isolation and Authorization by Area | The model choice and the bench are platform rows with no `business_id` (precedent: `platform_settings`, `access_requests`), read and written only behind `requirePlatformOperator`; no role-matrix change. The new `extractions` columns sit on a table that carries `business_id`. The ISP's accounts are never written; only the tie verdict is (receipt-triage D21). One new cross-business read, admitted by constitution v1.6.0: the count of payer readings that fell back from the chosen model. It counts only readings where the default then read (both-failed rows are excluded), returns a number, never a row, and reads only `fallback_from`, `model` and `created_at`. The bench reads no business data | PASS |
| VI | Visual Foundations (NON-NEGOTIABLE) | The tab uses the existing atoms (`Card`, `Button`, `Alert`, `Pending`, `StatusBadge`, `Skeleton`) and the app's `Tabs`, `Select`, `Collapsible`, at compact 40 px, tokens only. Marks, failures and the same-bank flag are icon + text, never colour alone. The only motion is the `Pending` breath while reading. Checked at 360/768/1280 in both themes. es-MX copy | PASS |
| VII | Every Test Cites Its Story | New tests cite `receipt-reader-tuning US1`–`US3`. Existing reader tests keep passing unchanged, because `banco` still parses and the pinned default is Mistral | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | `EXTRACTION_MODELS` unset leaves today's single model; invalid is the same plus a warning. No `AI` binding: payer readings degrade as today, the bench answers `READER_UNAVAILABLE`, and the panel says so. A chosen model that fails falls back to the default. Model ids stay vars; the only literal is today's `DEFAULT_MODEL`. `env.ts` documents both new bindings with what "unset" means | PASS |

**Post-design re-check (after Phase 1).** All eight still pass. Three were
re-read on purpose:

- **(VIII)** The stack table's parenthesis "(model is a var)" stays true in
  substance: every usable model id is a var, and the operator only picks
  among them. Constitution v1.6.0 rewrote the parenthesis to say exactly
  that (research R16).
- **(V)** The bench's files share the payer proofs' bucket but not their
  namespace. Payer keys start with a link id, and `proofBelongsToLink` only
  accepts those, so no payment can reference a `bench/` key and the bench
  never lists a payer's key.
- **(III)** The panel fetches the bench image through the API client with
  the session. There is no public or signed URL for a bench file.

## Project Structure

### Documentation (this feature)

```text
specs/011-receipt-reader-tuning/
├── plan.md              # This file
├── spec.md              # D1–D6, three stories, FR-001…FR-021
├── research.md          # Phase 0: what was measured, R1–R16
├── data-model.md        # Phase 1: vars, the choice, extractions columns, bench tables, tally
├── quickstart.md        # Phase 1: validation per story, the bench run that decides
├── contracts/
│   ├── reader-api.md    # /platform/reader: state, choose, bench, marks, tally; the Lector tab and its copy
│   └── engine.md        # models, reader plan, fallback, both banks, recording, prompt v2, test stand-in
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── migrations/0037_receipt_reader_tuning.sql   # + extractions columns; bench_receipts, bench_readings
├── wrangler.jsonc                              # + EXTRACTION_MODELS (top-level, dev, prod); ~ comments
├── vitest.config.ts                            # + pins EXTRACTION_MODELS, READER_TIMEOUT_MS
├── package.json                                # + "./reader-schema" export
├── src/
│   ├── env.ts                                  # + EXTRACTION_MODELS, READER_TIMEOUT_MS; ~ EXTRACTION_MODEL comment
│   ├── db/schema.ts                            # ~ extractions (+7); + benchReceipts, benchReadings
│   ├── platform/reader-model.ts                # + choose / history / resolve (D8)
│   ├── consta/
│   │   ├── extract.ts                          # ~ plan, new columns, tie verdict, recentReading (D9, D14, D15)
│   │   ├── validate.ts                         # ~ plan, tie verdict on the row (D9, D14)
│   │   └── extraction/
│   │       ├── models.ts                       # + readerModels, readerChoice, readerPlan (D7–D9)
│   │       ├── reader.ts                       # ~ signature, prompt v2, QUESTIONS_VERSION, answer shapes, time limit (D10–D13)
│   │       ├── index.ts                        # ~ extractProof(plan): fallback, PDF once (D11)
│   │       └── gate.ts                         # ~ receiving (D14)
│   └── routes/
│       ├── platform/index.ts                   # ~ mount /reader
│       └── reader/
│           ├── index.ts                        # + pure router (contracts/reader-api.md)
│           ├── handler.ts                      # + state, choose, bench upload/list/detail/file/read, marks, tally
│           └── schema.ts                       # + the contract
└── test/
    ├── consta/helpers.ts                       # ~ aiReturning per model, shapes, throw, wait
    ├── consta/reader-questions.test.ts         # + US2
    ├── reader-model.test.ts                    # + US1
    └── reader-bench.test.ts                    # + US3

apps/admin/
├── src/features/operator/
│   ├── OperatorScreen.tsx                      # ~ fourth tab "Lector"
│   ├── ReaderTab.tsx                           # + Modelo, Banco de pruebas, Resultados
│   └── BenchReceipt.tsx                        # + the side-by-side detail and marks
└── test/
    ├── msw.ts                                  # + reader handlers
    └── operator-reader.test.tsx                # + US1, US3

tests/e2e/
├── stubs.ts                                    # + reader fixtures (schema-parsed)
├── responsive.spec.ts                          # + /operador Lector at 360/768/1280
└── contrast.spec.ts                            # + the Lector tab, both themes
```

**Structure Decision**: The reader is edited in place. One new pure module,
`models.ts`, keeps list parsing and resolution testable without a request.
One new route area follows the landing precedent for operator-only
resources. The bench lives entirely in its own tables, prefix and tab, so
removing it later touches nothing else. No new package, trigger, role or
token.

## Complexity Tracking

No constitution gate is violated; nothing to justify.
