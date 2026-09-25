---
description: "Task list for receipt-reader-tuning"
---

# Tasks: receipt-reader-tuning

**Input**: Design documents from `/specs/011-receipt-reader-tuning/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: these are mandatory here, not optional.
- Constitution IV puts the engine and route tests in workerd against a real
  D1, with the reader stubbed at the binding and apiCEP intercepted at its
  pinned origin. The panel tests run on happy-dom with MSW and axe. The new
  tab's width and contrast are checked in Playwright.
- Constitution VII: every new test cites `receipt-reader-tuning US<n>`.
- A stub proves routing, recording and non-alteration, never accuracy
  (plan D20). Accuracy is measured with real models on the bench (T034–T036).

**Organization**: grouped by user story, in the spec's order.
- **Foundational** is the reader's plumbing: the allowed list, the plan per
  reading, the new `readProof` signature, the fallback, the recorded model
  and version. With no choice made, it changes no behaviour.
- **US1** is the operator's door to it: choosing the model.
- **US2** is the questions and the two banks. It reads nothing from US1 and
  can land first.
- **US3** is the bench. It reuses the foundational `readProof` and US2's
  receiving bank when present, and works without it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US3, mapping to the spec's user stories
- Every task names the file it touches

## Decision citations

Code comments cite `receipt-reader-tuning D<n>`, tabled in
[plan.md](./plan.md#decisions): D1–D6 are the spec's, D7–D20 the plan's.

Some comments today become false with this feature. Each one is rewritten
in the task that changes the code beneath it (constitution I):
- `reader.ts`'s header ("The model is read from config so replacing it is a
  deploy");
- the comment on `EXTRACTION_MODEL` in `apps/api/src/env.ts`;
- the `ai` block comment in `apps/api/wrangler.jsonc` ("replacing it is a
  deploy and not a release").

**Unchanged on purpose** (spec D5, plan D14):
- the same-institution guard (`consta/request.ts`, validation spec D17);
- what the payer page receives from `/read` (`Gate`, `proofReadingResponse`);
- every payer-facing word.

No task reads the same-bank flag to change the flow.

---

## Phase 1: Setup

**Purpose**: know what green looks like, and which lines move, before anything changes.

- [ ] T001 Baseline: run `pnpm install --frozen-lockfile`, then every gate in CI order: `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`. Record in this task's notes the commit and the test counts per workspace. A gate that is already red proves nothing later.
- [ ] T002 Record in this task's notes:
  - every test that asserts the reader's model id or the answer key `banco`: `grep -rn "mistral-small\|banco:" apps/api/test`. They must keep passing unchanged, because `banco` still parses as the sending bank (D13) and the pinned default stays Mistral.
  - the next free migration number: `ls apps/api/migrations`. Expected `0037`; if it is taken, amend data-model.md's first line.
  - the lines of the three comments named above that this feature rewrites.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the columns and tables, the configuration, the test stand-in,
the reader plan and the fallback, the recorded model and version, and the
contract module. With no `reader_model` row, every reading is made by the
default model exactly as today, plus four new columns on its row.

**⚠️ CRITICAL**: T003–T011 land before any story task.

- [ ] T003 Schema and migration per [data-model.md](./data-model.md), in `apps/api/src/db/schema.ts`:
  - **`extractions`** — add `questionVersion` (`question_version` text), `readerMs` (`reader_ms` integer), `fallbackFrom` (`fallback_from` text), `receivingBank` (`receiving_bank` text), `gateReceivingBank` (`gate_receiving_bank` text, enum `ok|unknown|missing`), `sameBank` (`same_bank` integer, mode boolean) and `receivingBankTie` (`receiving_bank_tie` text, enum `match|mismatch`). Each column carries a comment citing `receipt-reader-tuning D11`/`D14`.
  - **`benchReceipts`** (`bench_receipts`): `id`, `proofKey`, `sha256` (unique), `mediaType`, `byteSize`, `uploadedBy` → `user.id`, `createdAt`.
  - **`benchReadings`** (`bench_readings`): `id`, `benchReceiptId` → `bench_receipts.id`, `model`, `modelLabel`, `questionVersion`, `status` enum `read|failed`, `failureCode`, `readerMs`, `reading` (JSON text), `rawOutput`, `marks` (JSON text), `markedBy`, `markedAt`, `createdAt`. A unique index on `(bench_receipt_id, model, question_version)` and an index on `created_at`.
  - Put a comment above both bench tables: platform rows with no `business_id`, like `platform_settings` and `access_requests` (constitution V, D16).
  - Then run `pnpm --filter @devolada/api db:generate` and rename the output to `apps/api/migrations/0037_receipt_reader_tuning.sql` (and its journal tag). It must contain only `ADD COLUMN`, `CREATE TABLE` and `CREATE INDEX`. Run `db:migrate:local`.
- [ ] T004 [P] Configuration (D7, D11):
  - **`apps/api/src/env.ts`**:
    - Add `EXTRACTION_MODELS?: unknown`, the parsed JSON var. Comment: what it holds, and that unset or invalid means the default alone, with a warning when invalid (constitution VIII).
    - Add `READER_TIMEOUT_MS?: string`, a test knob that is never set by a deploy. Comment: the 8 s default and why (research R6).
    - Rewrite the `EXTRACTION_MODEL` comment: it is the **default** model, always in the list, and the fallback.
  - **`apps/api/wrangler.jsonc`**:
    - Add `EXTRACTION_MODELS` to the top-level, `dev` and `prod` `vars`:
      - top-level and dev: `[{ "id": "@cf/mistralai/mistral-small-3.1-24b-instruct", "label": "Mistral Small 3.1" }, { "id": "@cf/google/gemma-4-26b-a4b-it", "label": "Gemma 4 26B", "input": { "chat_template_kwargs": { "enable_thinking": false } } }]`;
      - prod: the Mistral entry alone.
    - Rewrite the `ai` comment: the list is a var, the operator picks among it in `/operador` (receipt-reader-tuning D1, D7).
  - **`apps/api/vitest.config.ts`**: pin `EXTRACTION_MODELS` to two test models (`@cf/test/default` labelled "Default", `@cf/test/other` labelled "Other"), `EXTRACTION_MODEL` to `@cf/test/default` and `READER_TIMEOUT_MS` to `"50"`, with a comment on why (constitution IV). If T002 found tests asserting the Mistral id, pin `EXTRACTION_MODEL` to Mistral's id instead and use it as the default entry, so those tests stay unchanged.
  - **`CLAUDE.md`**: add `READER_TIMEOUT_MS` to the "test knobs" row of the `.dev.vars` table.
- [ ] T005 [P] Test stand-in in `apps/api/test/consta/helpers.ts` (contracts/engine.md "Test stand-in", D20):
  - `aiReturning` accepts, besides today's single reading, a map from model id to a reading, a string, `{ throws }` or `{ waitsMs, then }`. It also takes `opts.shape: "response" | "choices"` to answer in the OpenAI-style shape (`{ choices: [{ message: { content } }] }`).
  - `StubbedReading` gains optional `bancoEmisor` and `bancoReceptor`. `calls` keeps recording `{ model, input }`, so a test can assert the merged `input`.
  - Today's call shape `aiReturning(reading, calls, { pdfText })` must keep working unchanged.
- [ ] T006 Models module `apps/api/src/consta/extraction/models.ts` (new, D7–D9), per contracts/engine.md:
  - `readerModels(env)` — zod-parse `env.EXTRACTION_MODELS` as `{ id, label, input? }[]`. On invalid input, `console.warn` once per isolate and use the default alone. Prepend the default (`env.EXTRACTION_MODEL ?? DEFAULT_MODEL`, labelled by its id) when missing; ids are unique, first wins. Returns `{ list, defaultModel }`.
  - `readerChoice(db, list)` — read the latest `platform_settings` row with key `reader_model` through the existing `platform_settings_key_created_idx` index, with no cache (D8, SC-003). Return `{ active, choice: "default" | "applies" | "stale", stale }`.
  - `readerPlan(env, db)` — return `{ chosen: active, fallback: active.id === defaultModel.id ? null : defaultModel }`.
  - Export all three from `consta/extraction/index.ts`.
- [ ] T007 Reader signature in `apps/api/src/consta/extraction/reader.ts` (D10–D12):
  - New signature: `readProof(ai, proof, model: ReaderModel, opts: { text?, timeoutMs? })`. Build today's `messages` and `max_tokens: 400`, then merge `model.input` into the request.
  - When `timeoutMs` is set, race the call against a timer and throw `ReaderError("READER_UNAVAILABLE", "timeout")` when it fires.
  - Take the answer text from `response` (a string), else `choices[0].message.content` (a string), else the serialized answer; then `parseReaderOutput` as today.
  - Parse `bancoEmisor ?? banco` as `senderBank` and `bancoReceptor` as `receivingBank`.
  - `Reading` gains `receivingBank`, `questionVersion`, `ms` and `fallbackFrom` (null here). `model` = `model.id`.
  - Add `export const QUESTIONS_VERSION = "1"`, pinned to **today's** prompts (US2 bumps it to "2" with the new wording). Export `PROMPT` and `TEXT_PROMPT` for the pin test.
  - Rewrite the header's "The model is read from config…" sentence: the model now arrives per reading from the caller's plan (D9). Keep the proof-extraction D5 measurement lines as they are.
- [ ] T008 Plan and fallback in `apps/api/src/consta/extraction/index.ts` (D9, D11):
  - New signature: `extractProof(env, proof, plan: ReaderPlan)`.
  - PDF: call `pdfToText` **once**. No text → `provider-ocr`, as today.
  - Read with `plan.chosen`. Apply `timeoutMs = Number(env.READER_TIMEOUT_MS ?? 8000)` only when `plan.fallback` is set.
  - On a `ReaderError` with `plan.fallback` set, read once more with `plan.fallback`, with no limit and the same picture or text. That reading's `fallbackFrom` = `plan.chosen.id`.
  - On a second error, or a first error with no fallback, rethrow. Attach `fallbackFrom` to the error (e.g. a property on `ReaderError`) so the caller's row can record it.
  - Comment the block with D11 and "a wrong answer is not a failure" (spec D3).
- [ ] T009 Callers in `apps/api/src/consta/extract.ts` and `apps/api/src/consta/validate.ts` (D9, D11, D15):
  - Both resolve `await readerPlan(env, db)` and pass it to `extractProof`.
  - `recordExtraction` writes `questionVersion`, `readerMs` and `fallbackFrom` from the reading. On a failure row, it writes `fallbackFrom` from the error.
  - `recentReading` copies `model`, `question_version`, `reader_ms` and `fallback_from` onto the rebuilt reading, and the new row records them. A reused reading is never re-read (D15).
  - Top-ups (`credit/topups.ts`) go through `validate` and need no edit. Confirm with a grep that no other caller of `extractProof` or `readProof` exists (research R1).
- [ ] T010 [P] Contract module `apps/api/src/routes/reader/schema.ts` (new, D18): every schema in [contracts/reader-api.md](./contracts/reader-api.md) — `readerStateResponse`, `chooseModelRequest`, `benchField`, `benchMark`, `benchReading`, `benchReceiptSummary`, `benchReceiptDetail`, `benchListResponse`, `setMarksRequest`, `benchTallyResponse` — with their exported types. Add `"./reader-schema": "./src/routes/reader/schema.ts"` to `apps/api/package.json` `exports`.
- [ ] T011 Foundational check in `apps/api`: run `pnpm --filter @devolada/api typecheck` and `pnpm --filter @devolada/api test`. The whole suite passes with the counts of T001; the only difference is the rows' new columns. Any failure here is a behaviour change and must be fixed, not re-baselined.

**Checkpoint**: the reader reads through a plan; the default reads exactly as before; each row names its model and version.

---

## Phase 3: User Story 1 — The operator chooses which model reads receipts (Priority: P1) 🎯 MVP

**Goal**: in `/operador` → Lector, the operator sees the active model and its history, and chooses another model from the environment's list. The next reading uses it, and a failing model falls back to the default.

**Independent Test**: quickstart "Story 1". On dev, switch Mistral → Gemma 4, upload through a link, and the reading row names Gemma 4 and version; switch back and it names Mistral.

### Tests for User Story 1 ⚠️ write first, see them fail

- [ ] T012 [P] [US1] `apps/api/test/reader-model.test.ts` (new; cites `receipt-reader-tuning US1`), using `aiReturning` per model id and the pinned two-model list:
  - `readerModels`: unset list → default alone; invalid JSON or shape → default alone plus one warning; default missing from the list → prepended; duplicate ids → first wins.
  - `GET /platform/reader`: `choice: "default"` with no row; `"applies"` after a choice; `"stale"` with `staleChoice` when the stored id left the list. Also `readerAvailable: false` with no `AI` binding.
  - `POST /platform/reader/model`: `201` appends one `platform_settings` row with the author, and history is latest first; an id outside the list → `400 INVALID_MODEL` and no row; a non-operator → `403 NOT_PLATFORM_OPERATOR` on both routes.
  - The next `/direct-payments/links/:token/read` after a choice calls the chosen model (`calls[0].model`), with the entry's `input` merged in.
  - Fallback, picture: the chosen model throws, or waits past `READER_TIMEOUT_MS`, or answers with no JSON. Each time the default reads once, the `/read` answer is normal, and the row has `model` = default, `fallback_from` = chosen, `reader_ms` set and `question_version` set.
  - Fallback, PDF: same, and `toMarkdown` is called once.
  - Both fail: `/read` answers `503 READER_UNAVAILABLE` as today, and the `unreadable`/`refused` row records `fallback_from`.
  - With the default chosen, a failure makes exactly one call and no fallback.
  - An answer in the `choices` shape parses like the `response` shape.
  - A reused draft (the pay right after `/read` on the same file) keeps the draft's `model` and `question_version` even after the choice changed in between (spec US1 scenario 6).
  - `fallbacksLast7Days` counts only payer rows with `fallback_from` in the window.
- [ ] T013 [P] [US1] `apps/admin/test/operator-reader.test.tsx` (new; cites `receipt-reader-tuning US1`), with schema-parsed fixtures (`@devolada/api/reader-schema`) and new handlers in `apps/admin/test/msw.ts` (`readerState`, `readerChoose`).
  - The Lector tab is present only for the operator (the screen already redirects others).
  - The Modelo card shows the label and "Por defecto"; the stale `Alert` with the stale id; "Respaldos en los últimos 7 días: n"; the history.
  - "Usar este modelo" is disabled until the selection changes, then posts `modelId` and refreshes.
  - A one-model list shows the select disabled with "Este ambiente tiene un solo modelo."
  - `readerAvailable: false` shows its `Alert`.
  - `expectNoViolations` on each state.

### Implementation for User Story 1

- [ ] T014 [US1] `apps/api/src/platform/reader-model.ts` (new, D8):
  - `chooseReaderModel(db, list, modelId, authorUserId)` — refuse an id outside `list` (return `{ ok: false }`), else insert a `platform_settings` row with key `reader_model`.
  - `readerHistory(db, limit = 5)`.
  - `fallbacksSince(db, sinceMs)` — `count(*)` of `extractions` with `fallback_from IS NOT NULL` and `created_at >= since`. This is a platform count over every business, and it returns a number, never a row (constitution V — note it in the comment).
  - Keep `reader_model` out of `SETTINGS`, with a comment saying why (D8).
- [ ] T015 [US1] `apps/api/src/routes/reader/handler.ts` (new) `getReaderState` and `postReaderModel`, per contracts/reader-api.md: compose `readerModels`, `readerChoice`, `readerHistory`, `fallbacksSince(now − 7 days)`, `QUESTIONS_VERSION` and `readerAvailable = Boolean(env.AI)`. Answer `201` with the fresh state after a choice, or `400 INVALID_MODEL`.
- [ ] T016 [US1] `apps/api/src/routes/reader/index.ts` (new): a pure router (`GET /`, `POST /model` with `zValidator("json", chooseModelRequest)`). Mount it in `apps/api/src/routes/platform/index.ts` with `platformRoute.route("/reader", readerOperatorRoute)`, next to the landing mount, with a comment citing D18.
- [ ] T017 [US1] `apps/admin/src/features/operator/ReaderTab.tsx` (new) Modelo card per contracts/reader-api.md "Modelo card":
  - Use `Card`, `Alert`, `Button`, `Pending` and `Skeleton` from `@devolada/ui` and the app's `Select`, at compact size and with tokens only.
  - TanStack Query key `["reader-state"]`, invalidated after a choice.
  - Show dates with `formatTime` and the display settings, as `SettingField` does.
  - Add the fourth tab "Lector" (value `reader`) to `apps/admin/src/features/operator/OperatorScreen.tsx`, and extend the file's header comment (operator-panel + receipt-reader-tuning D19).

**Checkpoint**: US1 is independently testable and deployable. With the dev list, the creator can switch models from the panel.

---

## Phase 4: User Story 2 — The receipt is read right: the clave, both banks, every character (Priority: P1)

**Goal**: version "2" of the questions (D13); the receiving bank through the vocabulary; the same-bank flag and the tie verdict recorded; nothing altered, and the payer's contract unchanged.

**Independent Test**: quickstart "Story 2" (automated). Accuracy on the real receipts is measured by the bench in T034–T036.

### Tests for User Story 2 ⚠️ write first, see them fail

- [ ] T018 [P] [US2] `apps/api/test/consta/reader-questions.test.ts` (new; cites `receipt-reader-tuning US2`):
  - **The prompts.** `PROMPT` and `TEXT_PROMPT` each contain: the clave-label rule naming "Folio", "Número de autorización", "Número de operación" and "Referencia"; the final-letter rule naming Banco Azteca's "I"; the sending-bank rule naming "Cuenta origen" and "Cuenta destino"; the keys `bancoEmisor` and `bancoReceptor`; the unchanged reference and destination rules. The legibility block appears only in `PROMPT`.
  - **The pin.** `sha256(PROMPT + "\n" + TEXT_PROMPT)` equals the hash pinned for `QUESTIONS_VERSION`, which is `"2"`.
  - **Parsing.** `bancoEmisor` and `bancoReceptor` parse; a stub with only `banco` still gives `senderBank`.
  - **The receiving bank.** It resolves through the vocabulary, so `"Bbva Mexico"` → `BBVA MEXICO`, `unknown` for a name outside the list, and `missing` when absent.
  - **Same bank.** Through `/read` on a link whose cuenta de cobro is an AZTECA CLABE, with a stub of `bancoEmisor: "AZTECA"` and `bancoReceptor: "AZTECA"`: the row has `same_bank = 1`, `sender_bank = 'AZTECA'`, `gate_sender_bank = 'ok'`; the `/read` answer's `senderBank` is `AZTECA`; and **nothing is altered**.
  - **Different banks.** `bancoEmisor: null` and `bancoReceptor: "BBVA MEXICO"` → `same_bank` NULL and `sender_bank` NULL. The receiving bank is never copied into the sender.
  - **The tie verdict.** Destination digits that tie to the cuenta de cobro, with a matching receiving bank → `receiving_bank_tie = 'match'`; with another bank → `'mismatch'`; untied → NULL.
  - **The payer's answer.** The `/read` response parses with `proofReadingResponse` and has no receiving-bank key.
  - **The reused draft.** The pay after `/read` rebuilds `receiving` and records the same three columns.
  - **The receipt door.** On the receipt door (`validate`), the same columns are written on the paid call's row.

### Implementation for User Story 2

- [ ] T019 [US2] Questions v2 in `apps/api/src/consta/extraction/reader.ts`:
  - Rewrite `FIELDS` and `RULES` to the text in [contracts/engine.md](./contracts/engine.md) "The questions, version 2": `claveDeRastreo` from its labelled field, `bancoEmisor` and `bancoReceptor`, the clave-copy rule with Azteca's "I", each bank from its own side, both may be the same, the vocabulary line for both.
  - Keep the legibility block, the reference rules (receipt-triage D12), the destination rules (D24) and the not-a-receipt rule word for word.
  - Bump `QUESTIONS_VERSION` to `"2"` and re-pin its hash in T018's test.
  - Extend the header with a receipt-reader-tuning D13 paragraph: the three measured failures (spec "Where this comes from") and that the measurement is the bench tally (T036). Leave the "not run" line for T036 to replace.
- [ ] T020 [US2] Receiving bank in `apps/api/src/consta/extraction/gate.ts` (D14): `GatedReading.receiving = { bank: resolveBank(reading.receivingBank), verdict, sameBank }`, with `sameBank` true only when both banks are `ok` and equal. `Gate` is unchanged. Comment: nothing acts on `sameBank`, the gate never changes the sender because of the receiver, and the same-institution guard is validation spec D17's (spec D5, FR-012).
- [ ] T021 [US2] Recording in `apps/api/src/consta/extract.ts` and `apps/api/src/consta/validate.ts` (D14, D15):
  - Add a pure helper `receivingBankTie(gated, tie)` in `consta/extraction/destination.ts`, beside `tieDestination`.
  - `extract()` and `validate()` pass the verdict from the `tie` they already compute to `recordExtraction`, as `extra.receivingBankTie`.
  - `recordExtraction` writes `receiving_bank`, `gate_receiving_bank`, `same_bank` and `receiving_bank_tie`. It never writes the ISP's account (receipt-triage D21).
  - `recentReading` rebuilds `receiving` from the stored columns, with the flag re-derived.

**Checkpoint**: US2 is independently testable. Every new reading asks the v2 questions and records both banks.

---

## Phase 5: User Story 3 — The creator compares the models on a test bench (Priority: P2)

**Goal**: upload a receipt in `/operador` → Lector; every listed model reads it in parallel; the operator marks each field; the tally per model and question version decides the prod model. No payment, credit, provider call or payer measurement is involved.

**Independent Test**: quickstart "Story 3" (automated), then Steps 1–3 on dev (T034–T036).

### Tests for User Story 3 ⚠️ write first, see them fail

- [ ] T022 [P] [US3] `apps/api/test/reader-bench.test.ts` (new; cites `receipt-reader-tuning US3`), with `fetchMock` refusing every provider origin:
  - **Upload.** A PNG reads with both pinned models in parallel (two `calls`, each with its own `input`). The answer is `201` with two readings, each with a `readerMs`. The file sits at `bench/<uuid>` in the test bucket.
  - **A failed model.** One model throws → its reading is `failed` with `READER_UNAVAILABLE` and its raw answer, and no other model's reading replaces it. A wait past the bench limit gives `TIMEOUT`: override the limit for the test via an exported constant, or inject it.
  - **A PDF** is converted once (`toMarkdown` once) and read by both models.
  - **Isolation.** After uploads, zero rows exist in `extractions`, `payments`, `validations` and `credit_entries`, and no fetch leaves.
  - **Upload refusals.** `413 PROOF_TOO_LARGE` over 1 MB; `415 PROOF_UNSUPPORTED_TYPE` for a declared `text/plain`, and for bytes that sniff as neither image nor PDF; `400 VALIDATION_ERROR` without a file; `503 READER_UNAVAILABLE` with no `AI` binding, and nothing is stored.
  - **Duplicates.** The same bytes twice → `200` with `duplicate: true`, and no new readings.
  - **Read again.** After `QUESTIONS_VERSION` or the list changes (simulate by pinning a third model through `env` in the test), `POST …/read` fills only the missing combinations; with nothing missing it reads nothing.
  - **The file.** `GET …/file` returns the bytes with the sniffed type and `no-store`; after the object is deleted it is `404 FILE_EXPIRED`, and the detail says `fileAvailable: false` while the readings stay.
  - **Marks.** They save and replace. `absent` is judged right when the value is null and wrong when it is not; the folio case is a clave marked `absent` and read `"QVSBGOD7L"` → wrong. `absent` on `isReceipt` or `legibility` → `400`; any mark on a failed reading → `400`.
  - **The tally.** Per (model, version): readings, failures, judged, right, `wrongByField`, and `p90Ms` by nearest rank (null with no `read` rows).
  - **The guard.** Every bench route refuses a non-operator with `403 NOT_PLATFORM_OPERATOR`.
- [ ] T023 [P] [US3] Extend `apps/admin/test/operator-reader.test.tsx` (cites `receipt-reader-tuning US3`), with handlers `benchList`, `benchDetail`, `benchUpload`, `benchRead`, `benchMarks`, `benchFile` and `benchTally` in `apps/admin/test/msw.ts`:
  - **Upload.** The upload shows the `Pending` "Leyendo con 2 modelos…", then the receipt detail. A duplicate shows "Este comprobante ya estaba en el banco."
  - **The detail.** One column per reading and the nine field rows. "No se ve" for null values. The "Mismo banco" flag is icon + text. A failed column shows "No respondió", "Respuesta sin datos" or "Tardó demasiado". The raw answer sits behind "Ver respuesta del modelo".
  - **Marks.** The three-way control (no "No aparece" on the first two rows); "Guardar revisión" sends `setMarksRequest`.
  - **Read again and file gone.** "Leer de nuevo" appears only when `missing` is not empty. With the file gone, the page says so and the readings stay.
  - **Resultados.** The rows, the "Al …" date, and the two worst fields.
  - `expectNoViolations` on each state.

### Implementation for User Story 3

- [ ] T024 [P] [US3] `apps/api/src/platform/bench.ts` (new, pure; D16, D17):
  - `productReading(gated, reading)` → the contract's `reading` object: after the gate and vocabulary, amounts in cents via `amountToCents`, with `sameBank`.
  - `judge(reading, marks)` → `right`/`wrong` per marked field, with the `absent` rule; `destination` counts as not shown when it has no digits.
  - `tally(rows, now)` → the `benchTallyResponse` rows, with nearest-rank `p90Ms`.
  - Export `BENCH_TIMEOUT_MS = 30_000`.
  - Keep it free of database and fetch, like `compare.ts`.
- [ ] T025 [US3] Bench handlers in `apps/api/src/routes/reader/handler.ts` (D16), per contracts/reader-api.md:
  - **`postBench`:**
    - parse the multipart `file` with the payer upload's checks (`PROOF_MAX_BYTES`, `isAcceptedProofType`), then `loadProof` on the bytes (magic bytes → `415`);
    - with no `env.AI`, answer `503` before storing anything;
    - on a SHA-256 duplicate, answer `200` with `duplicate: true`;
    - otherwise `PROOFS.put("bench/<uuid>")`, insert `bench_receipts`, and read.
  - **The reading:** for every model of `readerModels(env).list`, in parallel with `Promise.allSettled`:
    - a PDF goes through `pdfToText` once; no text → each model's reading is `failed` with `READER_UNREADABLE` and a note;
    - `readProof(env.AI, proof, model, { text, timeoutMs: BENCH_TIMEOUT_MS })`;
    - no fallback;
    - `gateReading`, then `productReading`;
    - insert one `bench_readings` row per model, with `status`, `failureCode` (`TIMEOUT` when the error says timeout), `readerMs` and `rawOutput`.
  - **`listBench`** — newest first, 25 per page, cursor on `created_at`/`id`, with the per-reading summary and `marked` counts.
  - **`getBench`** — the detail: `fileAvailable` from `PROOFS.head`, each reading's `judged`, and `missing` = listed models × current version not present.
  - **`getBenchFile`** — the bytes, the sniffed type and `Cache-Control: no-store`; `404 FILE_EXPIRED` on a miss.
  - **`postBenchRead`** — fill `missing` only.
  - **`putBenchMarks`** — validate against the rules above, then save `marks`, `markedBy` and `markedAt`.
  - **`getBenchTally`.**
  - Never touch `extractions`, `payments`, `validations` or the credit tables; comment this with FR-019.
- [ ] T026 [US3] Bench routes in `apps/api/src/routes/reader/index.ts`: `POST /bench`, `GET /bench`, `GET /bench/tally` (declared before `/bench/:id`), `GET /bench/:id`, `GET /bench/:id/file`, `POST /bench/:id/read`, `PUT /bench/readings/:readingId/marks` with `zValidator("json", setMarksRequest)`. The router stays pure.
- [ ] T027 [US3] Admin bench, per contracts/reader-api.md "Banco de pruebas", "Detail" and "Resultados":
  - **In `ReaderTab.tsx`** — the Banco de pruebas card: upload with `FormData` and a direct `fetch` with credentials (the `CreditCard.tsx` top-up precedent), the list, and the Resultados card.
  - **In `apps/admin/src/features/operator/BenchReceipt.tsx`** (new) — the detail:
    - the image fetched through `fetch(…/file, { credentials: "include" })` as a blob and shown by object URL, revoked on unmount; a PDF opens by object URL in a new tab via "Abrir PDF";
    - columns per reading beside the image, stacking below 768 px;
    - the three-way marks as icon + text controls (constitution VI);
    - "Guardar revisión", "Leer de nuevo", and the `Collapsible` raw answer.
  - The in-progress label sits inside `<Pending>` (pending-lint).
- [ ] T028 [P] [US3] Browser layer:
  - In `tests/e2e/stubs.ts`, add the reader routes with fixtures parsed by `@devolada/api/reader-schema`: a state, a detail with two readings (one failed, one with `sameBank`), and a tally.
  - Add `/operador` → Lector to `tests/e2e/responsive.spec.ts` (no horizontal scroll at 360/768/1280, the detail included) and to `tests/e2e/contrast.spec.ts` (both themes).
  - Tests cite `receipt-reader-tuning US3`.

**Checkpoint**: all three stories work on their own. The bench runs on dev.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T029 [P] Re-read every comment this feature touched for truth (constitution I):
  - `reader.ts` header;
  - `env.ts`: `AI`, `EXTRACTION_MODEL`, `EXTRACTION_MODELS`, `READER_TIMEOUT_MS`;
  - `wrangler.jsonc` `ai` comment;
  - `extract.ts`: the `recordExtraction` and `recentReading` blocks;
  - `validate.ts`: where the plan is resolved;
  - `platform/settings.ts`: a one-line pointer that `reader_model` lives in `reader-model.ts` (D8).

  No comment may still say the model is fixed per deploy.
- [ ] T030 [P] `node scripts/spec-lint.mjs`: every new test file cites `receipt-reader-tuning US<n>`, and no existing citation was lost (SC-010).
- [ ] T031 Every gate in CI order (`specs/011-receipt-reader-tuning/quickstart.md`, "The gates"), plus `pnpm e2e -- --grep "Lector"`. Record the test counts next to T001's.
- [ ] T032 Run the automated parts of `specs/011-receipt-reader-tuning/quickstart.md` Stories 1–3. Then by hand on `localhost:5174/operador` → Lector with the real binding: switch models; upload one receipt through the demo link and check the row's `model`, `question_version`, `reader_ms` and `fallback_from`; upload one receipt to the bench and see both columns. Record what was seen in this task's notes.
- [ ] T033 Prepare the dev deploy through the normal PR → `main` flow (never from a local machine). Confirm in `apps/api/wrangler.jsonc` that the dev `vars` list both models. Confirm prod's list is Mistral alone, so prod does not change until the creator decides (SC-005).

### Measurement on dev — by the product creator (quickstart Steps 1–3)

- [ ] T034 Step 1 of `specs/011-receipt-reader-tuning/quickstart.md`: gather the test set from the creator's phone. The originals are kept, per the creator on 2026-09-25:
  - Nu with the folio;
  - Azteca without clave;
  - Azteca with clave `…368901I`, and the other two Azteca captures;
  - receipt 1 (Banorte) and receipt 2 (Azteca `038195`) of receipt-triage;
  - at least one receipt with a labelled clave that reads right today;
  - one PDF.
- [ ] T035 Step 2 of `specs/011-receipt-reader-tuning/quickstart.md`: on `app.dev.devoladapago.com/operador` → Lector → Banco de pruebas, upload the whole set and mark every field. The first Gemma 4 upload also proves the call and answer shapes (research R5). If a column reads "Respuesta sin datos" with the JSON inside another structure, add the branch in `readProof`, deploy, and use "Leer de nuevo".
- [ ] T036 Step 3 of `specs/011-receipt-reader-tuning/quickstart.md`: from Resultados, decide the prod model against SC-001, SC-002 and SC-005.
  - Write the tally with its "Al …" date into the header of `apps/api/src/consta/extraction/reader.ts`, replacing the "not run" paragraph.
  - Run `/speckit-debt-pay receipt-triage-reader-unmeasured` with it as evidence (FR-020, SC-009).
  - If the winner is not Mistral: add it to prod's `EXTRACTION_MODELS` (a deploy), then choose it in prod's `/operador` → Lector.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T002)**: no dependencies.
- **Foundational (T003–T011)**: after Setup; blocks every story.
  - T003, then T004 (the config needs no schema, but tests do).
  - T005, T006, T010 [P] after T003.
  - T007 → T008 → T009 (the signature, then the plan, then its callers).
  - T011 last.
- **US1 (T012–T017)**: after Foundational. Its tests (T012, T013) run against foundational code plus its own routes and tab.
- **US2 (T018–T021)**: after Foundational. Independent of US1 and can land first; T019 changes the prompt only.
- **US3 (T022–T028)**: after Foundational.
  - US3 uses `readerModels` (T006) and `readProof` (T007).
  - It shows the receiving bank when US2 has landed. Without US2 the receiving-bank row reads "No se ve", which is acceptable, but T035 must run after US2 is deployed.
  - T025 and T026 share `routes/reader/*` with US1's T015 and T016, so land them after US1 or merge carefully.
- **Polish (T029–T033)**: after the stories chosen for the release.
- **Measurement (T034–T036)**: after deploy to dev with US2 and US3 live.

### Within Each User Story

- Tests first (they fail), then the pure pieces, then handlers and routes, then the panel.
- A story is done when its tests pass and its quickstart section holds.

### Parallel Opportunities

- Foundational: T004, T005, T006 and T010 touch different files and run together after T003.
- US1: T012 ∥ T013 (API and panel tests); T014 ∥ T017 once the schema module exists.
- US2: T018 ∥ T020 (the test and the gate); T019 ∥ T020.
- US3: T022 ∥ T023 ∥ T024 ∥ T028; T025 needs T024.
- Across stories: US1 and US2 can proceed in parallel after Foundational; they share no file except `extract.ts`, and T009 and T021 touch different blocks of it.

## Parallel Example: User Story 3

```text
Task: "T022 reader-bench.test.ts — upload, isolation, marks, tally"
Task: "T023 operator-reader.test.tsx — bench states"
Task: "T024 platform/bench.ts — productReading, judge, tally"
Task: "T028 e2e stubs + responsive/contrast for Lector"
```

## Implementation Strategy

### MVP First (User Story 1)

1. Setup → Foundational: the reader reads through a plan; the rows name model and version.
2. US1: the operator can switch the model in `/operador`.
3. **Stop and validate**: the switch on dev, and a fallback forced in tests.

### Incremental Delivery

1. Foundational + US1 → switchable model (MVP).
2. + US2 → the v2 questions and both banks recorded. Behaviour for the payer is unchanged except for better readings.
3. + US3 → the bench.
4. Measurement (T034–T036) → the prod decision and the debt closed.

Recommended release: US1 + US2 + US3 together, so version "1" is never written to a row (research R7) and the creator can measure the moment dev deploys.
