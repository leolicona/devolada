---

description: "Task list for two-eyes-receipt"
---

# Tasks: two-eyes-receipt

**Input**: Design documents from `/specs/005-two-eyes-receipt/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: mandatory here, not optional. Constitution IV puts the engine and
lifecycle tests in workerd against a real D1 with the provider intercepted
at its pinned origin and the reader stubbed at the binding; constitution VII
requires every test to cite its story. Every rewritten or new test cites
`two-eyes-receipt US<n>`. Research R12 names what today's tests assert and
what they will assert; nothing retires unnamed.

**Organization**: grouped by user story so each can be implemented and
tested on its own. US1 is the flow; US2 and US3 each add one input to it
(legibility, PDFs); US4 changes when the pay request answers; US5 makes the
record countable. Note the one coupling the dependency graph names: US1's
page change (D13) and US4's non-blocking answer touch the same handler and
the same page, so a *merge* is cleanest with US1 and US4 together.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US5, mapping to the spec's user stories
- Every task names the file it touches

## Decision citations

Code comments cite `two-eyes-receipt D<n>`, tabled in
[plan.md](./plan.md#decisions). D1–D10 are the spec's; D11–D20 the plan's.

**Amended 2026-09-18** after `/speckit-analyze`: T009, T015 and T019 carry
the missing-date rule (D20, finding U1/A1); T011 writes a reading record on
the no-binding path (C2); T017 asserts the replay carve-out after a
provider-first call (C3); T031/T032 state and test the deferred attempt's
time budget (R1); T034 identifies legacy crosses by the D16 shape (I1);
T019 names the button sizes (U2).
Where a comment today describes the *old* order of doors (the D2 header of
`extraction/index.ts`, the D1/D2 block in `validate.ts`, the reading-check
comment on `payments.reading_check`, the "provider-ocr means a PDF" comment
on `proofReadingResponse`, the `PaymentPage` comments at the upload and the
`provider-ocr` branch), it is rewritten in the task that changes the code
beneath it — a comment contradicting the code is the gap constitution I
forbids.

---

## Phase 1: Setup

**Purpose**: know what green looks like, and settle the two facts the plan
could not verify before any engine code changes.

- [ ] T001 Baseline: `pnpm install --frozen-lockfile`, then every gate in CI order — `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test` — and record the counts in the task notes (at `4b0deba`: 99 tests in `apps/api/test/direct-payment.test.ts`, 46 in `apps/api/test/consta/validate.test.ts`, 41 in `apps/pago/test/pago.test.tsx`). A gate already red proves nothing later.
- [ ] T002 Verify the two unverified PDF facts against the real binding, exactly as [quickstart.md § Step 3](./quickstart.md#step-3--verify-the-two-unverified-facts-first-research-r6) says: with `pnpm --filter @devolada/api dev` and a dev link, call `env.AI.toMarkdown` from a throwaway `/dev/pdf-text` route (deleted before commit) on a text PDF receipt and on a scanned PDF; note the `tokens` field and whether the scanned one yields text; read the Workers AI "Markdown Conversion" docs page for the pricing rule. Write both findings, dated, into `specs/005-two-eyes-receipt/research.md` under R6 ("Verified 2026-09-…: …") and carry them into the header comment of `apps/api/src/consta/extraction/pdf-text.ts` in T024. If conversion bills, add the number to the spec's Assumptions — it changes a cost note, never the flow.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the columns the classification needs, the engine's contract
types, the test helpers every story imports, and the sandbox's image door.
None of it changes product behaviour on its own.

**⚠️ CRITICAL**: T003–T008 land before any story task.

- [ ] T003 Add the columns of [data-model.md](./data-model.md) to `apps/api/src/db/schema.ts`: on `payments` — `readingCheckAttempt` (integer), `blindSide` (text enum `provider | reader | both`), `acceptedFrom` (text enum `agreed | reader | provider | human`); on `extractions` — `legibility` (`full | partial | none`), `readingCheck`, `disputedFields`, `blindSide`, `acceptedFrom` (`agreed | reader | provider`), `providerTrackingKey` (text), `providerAmountCents` (integer); extend `extractions.outcome` with `illegible`. Rewrite the `reading_check` comment on `payments` (it says "minute-two cross"; now "taken at the first call for rows born after two-eyes-receipt, D5; at minute two for legacy rows, D16"), and comment every new column with its decision (D5, D7, D10, D17, D19). Nothing is dropped or renamed.
- [ ] T004 Generate the migration with `pnpm --filter @devolada/api db:generate`, rename it `apps/api/migrations/0029_two_eyes_receipt.sql` (update `meta/_journal.json` as `0028` did), read it — only `ALTER TABLE … ADD COLUMN`, no `DROP`, no table rebuild (SQLite rebuilds a table for some ALTERs; if drizzle-kit emits a rebuild, hand-write the ADD COLUMN statements instead and say so in the file header) — and apply with `pnpm --filter @devolada/api db:migrate:local`. Depends on T003.
- [ ] T005 Extend the engine's types in `apps/api/src/consta/index.ts` exactly as [contracts/engine.md](./contracts/engine.md) lists: `ConstaVerdict` gains `ourReading`, `readingCheck`, `disputedFields`, `blindSide`, `accepted`, `acceptedFrom`; `ConstaReading` gains `legibility`. Comment each with its decision (D3, D5, D7, D2). Update the header's description of the receipt door ("the provider's eyes first, ours beside them", D3, D11).
- [ ] T006 [P] Extend the test helpers in `apps/api/test/consta/helpers.ts`: `aiReturning(reading, calls?, opts?)` gains a `toMarkdown` stub that returns `[{ name, mimeType: "application/pdf", format: "markdown", tokens: 0, data: opts.pdfText ?? "" }]` (an empty string is the scanned-PDF case, D15) and records the call; `StubbedReading` gains `legibilidad?: "completa" | "parcial" | "nula"`; add `RECEIPT_TEXT`, a realistic es-MX receipt text fixture (clave, banco, monto, fecha, estatus on separate lines) for the text variant. Comment: the binding is the one thing a test stands in for (constitution IV), and the text is what the conversion would return, seeded rather than converted.
- [ ] T007 [P] Rewrite the `AI` comment in `apps/api/src/env.ts`: unset → "the receipt still goes to the provider's image door, with no reading of ours beside it; the page never blocks and a PDF is handed over unread" (D3, D15, FR-005, constitution VIII). Mention that `toMarkdown` on the same binding turns a PDF into text (D1).
- [ ] T008 [P] Teach the sandbox `apps/api/sandbox/apicep-mock.mjs` the image door's reading: an `imageUrl` request answers with `validation.extractedData` (or whatever field the real apiCEP uses for its OCR reading — read `apps/api/src/consta/provider/apicep.ts` `ApiCepResponse` and match it) carrying a clave, amount, date and bank; a URL containing `notfound` answers `invalid` with no `cepDetails` and the reading present (the classification case); `unreadable` keeps answering the named OCR failure (the blind case). Update the header's scenario table.

**Checkpoint**: the columns exist, the types compile, the helpers and the
sandbox speak the image door, and every existing test still passes.

---

## Phase 3: User Story 1 — The first paid call carries two readings (P1) 🎯 MVP

**Goal**: the file goes to the provider first with our reading beside it;
on "not found" the two readings are compared at minute zero, the shape rules
break a tie, agreement stops the spending, and the payer is asked only for
the field in doubt. Payments and top-ups alike.

**Independent Test**: `pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "two-eyes-receipt US1"` and `… test/direct-payment.test.ts -t "two-eyes-receipt US1"` walk every row of the research R3 table and the door of the next attempt; `pnpm --filter @devolada/pago test -- -t "two-eyes-receipt US1"` proves the silent path sends `proofId` alone. Then the sandbox walk in [quickstart.md § US1](./quickstart.md#user-story-1--the-first-paid-call-carries-two-readings).

### The comparison (D5–D8, R3)

- [ ] T009 [US1] Create `apps/api/src/consta/extraction/compare.ts` exporting `compareReadings(ours: GatedReading | null, theirs: ProviderReading | null, rules: ShapeRule[]): Classification` that implements the research R3 table verbatim: fields count on our side only when the gate said `ok` (D5); clave compared case-insensitively, amount as integer cents equality; the provider's bank resolved with `resolveBank` before `checkShape` on each clave; `unknown` is "no rule"; `accepted` built per the table with the date from ours, else theirs, else null — and when null, `disputedFields` gains `"date"` on top of whatever the row decided, so the payer is asked for the date alone while the classification stands (D20); `acceptedFrom` set accordingly; `blindSide` set on `blind`. Header cites D5–D8, D11 and D20 and says why the comparison lives in the engine (R1). Pure function, no I/O.
- [ ] T010 [US1] Add the `compareReadings` scenarios to `apps/api/test/consta/validate.test.ts` in a new `describe("two-eyes-receipt US1: the comparison")`: one `it` per row of the R3 table (agreed; disputed favouring ours; disputed favouring theirs; disputed with no rule; disputed both fit; disputed neither fits; provider blind + ours complete; provider blind + ours incomplete; ours empty + theirs fits; ours empty + theirs mismatches; ours empty + no rule), plus "a bank-name or date difference never disputes" and "a malformed clave on our side raises no dispute". Seed shape rules with `seedValidations` (ten valid rows of one length for a bank) where a rule is needed. Depends on T009.

### The engine's receipt door (D3, D11, D12, D14)

- [ ] T011 [US1] Rewrite the receipt branch of `apps/api/src/consta/validate.ts` per [contracts/engine.md § Flow](./contracts/engine.md#flow-d2-d3-d5d8-d11-d12-d14-d15): keep `readProofFromBucket` + `extractProof`; keep the D2 refusal for `!isReceipt` (the `legibility` half arrives in T021); drop the `RECEIPT_INCOMPLETE` throw and the transfer-input conversion; keep `input` in receipt mode with the signed link; after the provider answers, on `not_found` call `compareReadings(gated ?? null, verdict.reading ?? null, await loadShapeRules(db))` and merge `ourReading`, `readingCheck`, `disputedFields`, `blindSide`, `accepted`, `acceptedFrom` into the returned verdict; set `source: "provider-ocr"`. Catch the provider's `RECEIPT_UNREADABLE` failure on this path only: write the billed row as the failure branch does today, then return `{ status: "invalid", reason: "not_found", readingCheck: "blind", blindSide: "provider", accepted: ours-if-complete, … }` (D12) — the legacy `providerOcr` path keeps throwing. When the reader is absent (`READER_UNAVAILABLE`) or its output cannot be parsed (`READER_UNREADABLE`), do not skip the record as today's fall-through does: write an extraction row `source: "provider-ocr"`, outcome `routed`, `raw_output` = `no-binding` / `unreadable`, and link it to the billed call like any other (FR-017, D19). Rewrite the D1/D2 comment block at the top of the branch and the `readable` comment; cite D3, D11, D12. `RECEIPT_INCOMPLETE` stays declared in `failure.ts` with a comment saying no door throws it since D3.
- [ ] T012 [US1] Add reading reuse to `apps/api/src/consta/validate.ts` (or a helper `recentReading(db, owner, sha256, now)` in `apps/api/src/consta/extract.ts`, exported): before calling `extractProof`, load the file, look up the newest `extractions` row for the same `business_id` (NULL for the platform), same `proof_sha256`, `source = 'reader'`, `outcome IN ('passed','gated')`, `created_at > now − 15 min`, and rebuild `Reading` + `GatedReading` from it instead of calling the model; the reused row's id is recorded as the draft it came from (a note in `raw_output` of the new row, or a `reused_from` mention in the comment — no new column). Cite D14 and constitution V (owner-scoped read). The `/read` door (`extract()`) never reuses (R8).
- [ ] T013 [US1] Extend `recordExtraction` in `apps/api/src/consta/extract.ts` to write the new columns: `legibility` from the reading, `readingCheck`/`disputedFields`/`blindSide`/`acceptedFrom` from a `classification` extra, `providerTrackingKey`/`providerAmountCents` from a `providerReading` extra; keep `source: "reader"` for any reading the engine produced and `"provider-ocr"` only when nothing was read here. Make `validate.ts` write the provider-first row with all of it and link `validation_id` as today (D19). Rewrite `readingPayload`'s "A PDF was loaded and … not read here" comment (that case is now "nothing here could read the file", D15).
- [ ] T014 [US1] Rewrite the receipt-door scenarios in `apps/api/test/consta/validate.test.ts` (`describe("validate — receipt door")`) per research R12: every scenario that captured a `sender` body from an image now captures `imageUrl` and no `sender`; the `RECEIPT_INCOMPLETE` scenarios become "a hole goes to the provider" scenarios; add "not_found carries the classification and the accepted data", "the provider's unreadable answer is a blind verdict, the billed row still written" (D12), "the draft's reading is reused within 15 minutes and re-read after" (D14, count `calls` on the stub), "no AI binding: the file still goes to the provider, ourReading null, a not_found is blind on our side". Every rewritten `it` cites `two-eyes-receipt US1` (the archive `US-V02` citations are replaced, not appended). Depends on T011–T013.

### The lifecycle stores the outcome and picks the door (D16, D17)

- [ ] T015 [US1] In `apps/api/src/direct-payments/validation.ts`: build the request from the row per D17 — a transfer call when `trackingKey`, `senderBank`, `claimedAmountCents` **and** `transferDate` are all present, a receipt call otherwise; accepted data with no date never reaches the transfer door: the classification's `disputedFields` (which carries `"date"` in that case, D20) is written on the row and the row waits for the payer's correction, which supersedes it with a date — remove the `?? now.toISOString()` date fallback from the request builder for rows with accepted data and say why in its comment (the manual door keeps its fallback: the payer typed a date there). Add `"date"` to the `disputedFields` enum of `directPaymentStatusResponse` in `apps/api/src/routes/direct-payments/schema.ts` (comment: D20) and to the `payments.disputed_fields` comment in `schema.ts`; restrict the legacy `crossCheck` to the D16 shape (`proofMode === "transfer" && proofKey && supersedesId == null && readingCheck == null && …` as today) and write `readingCheckAttempt: 2` on its classification; on a verdict carrying `readingCheck` (a provider-first call), write `readingCheck`, `disputedFields`, `blindSide`, `acceptedFrom`, `readingCheckAttempt: attempts`, and — when `accepted` is present — `trackingKey`, `senderBank`, `transferDate`, `claimedAmountCents` from it, so the next slot takes the transfer door; pass the classification to `releaseEvidenceFor` so `agreed` at minute zero buys the release (D6, no change in `provisional.ts`). Extend the CEP-adoption rule at `valid` (reading-check D7) to rows with `acceptedFrom` set. In the pay handler's supersede path (`apps/api/src/routes/direct-payments/handler.ts`) write `acceptedFrom: "human"` on the superseding row (data-model). Rewrite the `crossCheck` comment (reading-check D1 → "legacy rows only, D16; new rows classify at the first call, D5"). Cite D16, D17.
- [ ] T016 [US1] In `apps/api/src/credit/topups.ts`: on a verdict carrying `accepted`, write `trackingKey`, `senderBank`, `transferDate` on the top-up (`claimedCents` already holds the amount) so the next attempt builds a transfer request by the same D17 rule (`topUp.trackingKey && topUp.senderBank` → transfer); a top-up with no accepted data keeps the receipt door (D18). Cite D17, D18 in the request-building comment.
- [ ] T017 [US1] Add `describe("two-eyes-receipt US1: the classifier at minute zero")` to `apps/api/test/direct-payment.test.ts`, seeding rows born the new way (`proofMode: "receipt"`, `proofKey` set): (1) the inline attempt sends `imageUrl` and no `sender`; (2) `not_found` + agreed writes `readingCheck = agreed`, `readingCheckAttempt = 1`, `acceptedFrom = agreed`, the accepted fields on the row, and the next sweep's captured body is a `sender` call with them; (3) disputed favouring ours → next sweep sends ours; (4) disputed favouring theirs → next sweep sends theirs, `disputedFields` null; (5) disputed with no rule → `disputedFields` on the row and the status endpoint, no second call in the same minute; (6) provider blind + ours complete → next slot sends ours, `blindSide = provider`; (7) `releaseEvidenceFor` answers `agreed` on the first call (assert `releaseEvidence` on the row after a `not_found` with agreement); (8) a `valid` on the first call adopts the CEP's key as today; (9) agreed on clave and amount with no date on either side → `readingCheck = agreed`, `disputedFields = ["date"]`, `transferDate` null, and the next sweep makes **no** provider call for that row (D20); (10) a transfer-door retry after a provider-first call that answers `alreadyValidated: true` confirms the payment, never `TRANSFER_ALREADY_USED` — the first call counted as this row's own attempt (FR-021, direct-payment D8). Extend the existing `US-D14` describe with one test proving a legacy-shaped row still takes the `providerOcr` cross and writes `readingCheckAttempt = 2`, and one proving a new-shaped row never does. Cite `two-eyes-receipt US1`. Depends on T015.
- [ ] T018 [US1] Add to `apps/api/test/prepaid-credit.test.ts` one scenario: a receipt top-up's first attempt sends `imageUrl`; a `not_found` with an agreeing provider reading writes `trackingKey`/`senderBank`/`transferDate` on the top-up; the next sweep sends a `sender` call under the platform owner (NULL `business_id` on the engine rows). Cite `two-eyes-receipt US1`. Depends on T016.

### The page sends the file, not the reading (D13)

- [ ] T019 [US1] In `apps/pago/src/features/pago/PaymentPage.tsx` `upload` mutation: the silent path (gate passed, amount not above the debt) posts `{ proofId, receiptStatus?, receiptAmountCents?, supersedes? }` with **no `transfer`**; the `reading.source === "provider-ocr"` branch keeps posting `{ proofId }`; the above-debt case (`reading.amountCents > expected`) returns the draft as today but the confirmation screen it renders gets two actions — "Enviar así" (`size="decisive"`, 64px, posts `{ proofId, receiptStatus, receiptAmountCents }`) and "Corregir los datos" (`size="standard"`, 48px, opens the `TransferForm` with the draft, posts `transfer` as today) — sizes declared, never improvised (constitution VI). In the validating view, open the correction form whenever `status.disputedFields` is non-empty, whatever `readingCheck` says, and let `disputedSet.has("date")` empty the date exactly as the clave and the amount are emptied today (D20; the `ProofReading`/status types come from the schema, so `"date"` arrives typed). Rewrite the D18 comment above the mutation ("the machine reads, the provider reads, the human is asked only for what is in doubt", D3, D13) and the `provider-ocr` branch comment (line ~453: "a PDF" → "nothing here could read the file"). Remove the `gated` early return: a hole no longer asks the payer before spending (FR-005) — the draft still renders for the above-debt case only. Keep `supersedes` behaviour. Note: `supersedes` without `transfer` is the re-upload door; after this task a re-upload from the silent path carries `supersedes` with `proofId` only, which the handler already accepts.
- [ ] T020 [US1] Rewrite in `apps/pago/test/pago.test.tsx`: scenario 43 ("a reading that passes the gate is submitted silently") asserts the captured pay body has `proofId` and no `transfer`; scenario 44 stays as the corrected-form path (the form is reached from the above-debt "Corregir" action or the dispute form — pick the dispute form, seeded through the status stub, so the test does not depend on the above-debt screen); "a receipt claiming more than the debt is informed, never refused" asserts the two actions and what each posts; add "a reading with a hole is sent to the provider, not shown as a form" (`gate.trackingKey: "missing"` → pay with `proofId` alone, no form). Cite `two-eyes-receipt US1`. Depends on T019.

**Checkpoint**: a receipt image goes provider-first, classifies at minute
zero, and the next attempt takes the right door; the page sends the file;
the sandbox walk in quickstart § US1 passes.

---

## Phase 4: User Story 2 — A bad photo never costs a credit, an imperfect one goes through (P2)

**Goal**: the reader judges legibility; "not a receipt" and "not legible at
all" stop before spending and ask for a clearer picture; everything else goes
to the provider.

**Independent Test**: `pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "two-eyes-receipt US2"` and `pnpm --filter @devolada/pago test -- -t "two-eyes-receipt US2"`; then the measurement in [quickstart.md § US2](./quickstart.md#user-story-2--a-bad-photo-never-costs-a-credit).

- [ ] T021 [US2] In `apps/api/src/consta/extraction/reader.ts`: add `"legibilidad": "<completa | parcial | nula>"` to `PROMPT` with the three rules of research R7 (nula only when no field can be read at all; parcial when readable but a requested field is blurred, cut off or hidden; completa otherwise); add `legibility: "full" | "partial" | "none" | null` to `Reading`, mapped from the model's word (null when omitted); header comment cites D2 and the bias toward letting files through (spec Assumptions). Then in `apps/api/src/consta/validate.ts` and `apps/api/src/consta/extract.ts` make the pre-spend refusal `!reading.isReceipt || reading.legibility === "none"`, writing outcome `not_a_receipt` or `illegible` and throwing `RECEIPT_UNREADABLE` with the reading (D2, FR-004); a `partial` or null legibility never refuses (FR-005).
- [ ] T022 [US2] Expose legibility on the reading door: add `legibility: z.enum(["full","partial","none"]).nullable()` to `proofReadingResponse` in `apps/api/src/routes/direct-payments/schema.ts` (comment: D2; rewrite the "provider-ocr means the file was a PDF" comment → "nothing here could read the file"), return it from `readProof` in `apps/api/src/routes/direct-payments/handler.ts`, and rewrite that handler's header ("a file that is a PDF" is no longer a hole; "this endpoint cannot reject anybody" stays true — the *page* refuses, the endpoint reports). Regenerate nothing: the schema is the contract and the page imports the type.
- [ ] T023 [US2] Add `describe("two-eyes-receipt US2: the gate before spending")` to `apps/api/test/consta/validate.test.ts`: `esComprobante: false` → `RECEIPT_UNREADABLE`, one extraction row `not_a_receipt`, zero provider calls; `legibilidad: "nula"` → `RECEIPT_UNREADABLE`, row `illegible`, zero provider calls; `legibilidad: "parcial"` with a missing clave → the provider is called with `imageUrl`; a stub whose output has no JSON (`READER_UNREADABLE` today) → the provider is still called, `ourReading` null; the reading door (`extract`) returns `legibility` and never throws for `parcial`. Cite `two-eyes-receipt US2`. Depends on T021, T022.
- [ ] T024 [US2] In `apps/pago/src/features/pago/PaymentPage.tsx`: when `/read` answers `isReceipt === false` or `legibility === "none"`, do not pay — render the es-MX refusal from [contracts/payment-page.md § Copy](./contracts/payment-page.md#copy-es-mx-constitution-vi) in the existing `Alert` (`variant="warning"`, `layout="icon"`, icon + text), keep the picker open, reset the file, and count nothing; the two sentences are literal es-MX product copy, no new token, no new atom. Derive the `ProofReading` type from the schema so `legibility` is typed. Cite D2 in the comment.
- [ ] T025 [US2] In `apps/pago/test/pago.test.tsx`: rewrite scenario 45 ("an image that is not a receipt is caught here") to assert the refusal message, the picker still present and no `/pay` request; add "a photo the reader cannot read at all is refused with the 'toma otra foto' message"; add "a partly legible photo pays with `proofId` alone" (MSW `/read` answering `legibility: "partial"`, `gate.amount: "missing"`). Cite `two-eyes-receipt US2`. Depends on T024.

**Checkpoint**: garbage and unreadable photos spend nothing and ask for a
new picture; a smudged one goes through.

---

## Phase 5: User Story 3 — A PDF receipt gets the same reading and protections (P2)

**Goal**: a PDF is turned into text at the edge and read by the same reader;
it gets the draft, the gate and the US1 flow; a scanned PDF continues with an
empty reading, silently.

**Independent Test**: `pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "two-eyes-receipt US3"`; the two uploads of [quickstart.md § Step 3](./quickstart.md#step-3--verify-the-two-unverified-facts-first-research-r6) end to end.

- [ ] T026 [P] [US3] Create `apps/api/src/consta/extraction/pdf-text.ts` exporting `pdfToText(env: { AI?: Ai }, proof: LoadedProof): Promise<string | null>`: returns null when `env.AI` is absent or has no `toMarkdown`; calls `env.AI.toMarkdown({ name: "receipt.pdf", blob: new Blob([proof.bytes], { type: "application/pdf" }) })`, returns `data` trimmed when `format === "markdown"` and non-empty, null on `format === "error"`, a thrown call, or empty text; never throws. Header cites D1, D15 and carries the two verified facts from T002 with their date (cost; scanned pages). Depends on T002 for the facts only.
- [ ] T027 [US3] In `apps/api/src/consta/extraction/reader.ts` add the text variant: `readProof(env, proof, { text })` (or a sibling `readText(env, text)`) sends `TEXT_PROMPT` — "This is the text extracted from a Mexican bank transfer receipt PDF (comprobante SPEI). …" with the same JSON shape, the same rules, no legibility question (D15: `legibility` is null on a text reading) — as a single text message to the same model. Cite D1. In `apps/api/src/consta/extraction/index.ts` rewrite the D2 header (routing is still by what the file *is*, but both kinds are read here now) and route `proof.kind === "pdf"` to `pdfToText` → text reading when text exists, and to an empty-reading result (`route: "provider-ocr"`, `reading: null`) when it does not — never a throw. Make `ExtractionResult`'s `provider-ocr` variant carry the reason (`"no-binding" | "no-text" | "unreadable"`) for the extraction row's `raw_output`. Depends on T026.
- [ ] T028 [US3] In `apps/api/src/consta/extract.ts` record a text PDF reading as `source: "reader"` with `media_type: application/pdf`, and a PDF with no text as `source: "provider-ocr"`, outcome `routed`, `raw_output` naming the reason (D19). `readingPayload` for a text reading is the reader payload (the page gets a draft). Depends on T027.
- [ ] T029 [US3] Add `describe("two-eyes-receipt US3: a PDF read at the edge")` to `apps/api/test/consta/validate.test.ts`: a `PDF()` fixture with `aiReturning(GOOD_READING, calls, { pdfText: RECEIPT_TEXT })` → `extract` returns a draft with the gate fields, the extraction row is `reader` + `application/pdf`, and `validate` goes provider-first with `ourReading` set (the stub's `calls` show one `toMarkdown` and one `run` with a text message and no `image_url`); the same fixture with `pdfText: ""` → `extract` returns `source: "provider-ocr"` with null fields and no error, `validate` calls the provider with `imageUrl` and classifies `blind`/`reader` on `not_found`; a stub whose `toMarkdown` throws → same as empty; the magic-bytes scenario ("a PDF served as image/png") keeps its assertion but expects the reader row; a top-up PDF under `{ platform: true }` writes a NULL-owner reader row. Retire by name the archive scenario "US-V02, scenario 2: a PDF keeps the provider's OCR door, untouched" (its behaviour is gone by D1). Cite `two-eyes-receipt US3`. Depends on T028.
- [ ] T030 [P] [US3] Update the two PDF comments in `apps/pago/src/features/pago/PaymentPage.tsx` (the picker's "PDF too: … apiCEP reads it (D12)" → "read here like a picture since two-eyes-receipt D1; a scanned PDF is handed to the provider unread, silently") and in `apps/api/src/direct-payments/proofs.ts` (the accepted-types comment). No behaviour change.

**Checkpoint**: a text PDF produces the same draft as a picture and takes the
US1 flow; a scanned PDF is silent.

---

## Phase 6: User Story 4 — The payer never waits on the paid call (P3)

**Goal**: the pay request answers `validating` at once; the first paid call
runs after the answer, or at the next slot if it never ran.

**Independent Test**: `pnpm --filter @devolada/api test -- test/direct-payment.test.ts -t "two-eyes-receipt US4"` and `pnpm --filter @devolada/pago test -- -t "two-eyes-receipt US4"`; the slow-sandbox check in [quickstart.md § US4](./quickstart.md#user-story-4--the-payer-never-waits-on-the-paid-call).

- [ ] T031 [US4] In `apps/api/src/routes/direct-payments/handler.ts` `pay`: replace `const row = paused ? payment : await runValidation(…)` with a deferred attempt — `const attempt = runValidation(…)`; `try { c.executionCtx.waitUntil(attempt.catch(log)) } catch { await attempt }` (Hono throws on `executionCtx` outside a Worker request; the fallback awaits so nothing is dropped) — and answer `201 { directPaymentId: payment.id, status: payment.status, error: null }` (the row's own status: `validating` or `queued_for_credit`). Rewrite the "Inline attempt, then the sweep takes over (D7)" comment: the attempt still runs first, the answer no longer waits (D4); the row is born owned by the sweep, so a lost attempt runs at +2 min (the 2026-08-18 rule, unchanged); state the time budget — the platform's post-response limit for deferred work (verify the published number on the Workers docs and write it, dated) against the 25 s provider deadline plus a reused reading — and that a verdict lost to it is survived by the attempt counter written before the call (research R5). Update the `payResponse` comment in `apps/api/src/routes/direct-payments/schema.ts` (the enum keeps `confirmed | partial | invalid | unapplied` for compatibility; inline they are no longer produced).
- [ ] T032 [US4] Add `describe("two-eyes-receipt US4: the answer never waits")` to `apps/api/test/direct-payment.test.ts`: with `mockApiCep` delayed (a `fetchMock` reply with a `delay`, or an `APICEP_DEADLINE_MS`-bounded hang resolved by hand), `POST …/pay` with `createExecutionContext()` from `cloudflare:test` as the fourth argument answers `201 validating` before the provider resolves; after `waitOnExecutionContext(ctx)` the row is `confirmed`; without an execution context (the existing `app.request(url, init, env)` form) the handler still finishes the attempt inline; a deferred attempt that rejects (the provider mock throws after the response) leaves the row `validating` with `nextValidationAt` at +2 min and `validationAttempts = 1`, and the next `sweepDirectPayments` picks it up as a retry (US4 scenario 3, R5's budget). Adjust every existing test in the file that asserted an inline `confirmed`/`partial`/`invalid` on the POST to pass a context and assert after `waitOnExecutionContext` — keep their citations. Cite the new ones `two-eyes-receipt US4`. Depends on T031.
- [ ] T033 [US4] In `apps/pago/test/pago.test.tsx` add "the page shows Verificando on the POST's answer and the outcome on a poll": MSW `/pay` answers `validating`, the status stub answers `confirmed` on the second poll; assert the badge order. Confirm `PaymentPage.tsx` needs no change (the `onSuccess` path already stores a `validating` payment and polling already runs) — if a branch assumed an inline `confirmed`, fix it and cite D4. Cite `two-eyes-receipt US4`.

**Checkpoint**: the payer sees "Verificando" in the time of an insert.

---

## Phase 7: User Story 5 — The numbers become visible (P4)

**Goal**: agreed / disputed / blind on first calls, provider-blind while we
read fully, and refusals with zero credits are each one query over the
record, from day one.

**Independent Test**: `pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "two-eyes-receipt US5"`; the D1 console queries in [quickstart.md § US5](./quickstart.md#user-story-5--the-numbers-become-visible).

- [ ] T034 [US5] Create `scripts/reading-check-report.mjs` beside `scripts/cep-latency-report.mjs`, read-only, taking a D1 export or `wrangler d1 execute --json` output: prints the five counts of [data-model.md § Counts](./data-model.md#reading-record--extractions-seven-columns-added) as one markdown table (first-call classifications by `reading_check`/`blind_side` from `extractions`; legacy crosses as the `payments` rows with the D16 shape — `proof_mode = 'transfer' AND proof_key IS NOT NULL AND supersedes_id IS NULL AND reading_check IS NOT NULL` — never by attempt number; provider-blind-while-we-read-fully; refusals by outcome with their `validation_id` NULL count; PDFs by source/outcome). Header cites D10 and the spec's SC-008. No screen (spec Out of Scope).
- [ ] T035 [US5] Add `describe("two-eyes-receipt US5: the record answers the questions")` to `apps/api/test/consta/validate.test.ts`: after driving one agreed, one disputed, one provider-blind, one not-a-receipt and one illegible scenario through `validate`/`extract`, run the five queries from data-model.md against the test D1 and assert the counts; assert every refusal row has `validation_id IS NULL`. Cite `two-eyes-receipt US5`. Depends on T013, T021.

**Checkpoint**: the ratio the creator asked for is a query, not a guess.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T036 Register the legacy branch as debt with `/speckit-debt-log` under `.specify/debt/legacy-minute-two-cross/`: where it lives (`validation.ts` `crossCheck`, the `providerOcr` request, the US-D14 legacy tests), what it costs while unpaid (a second door-selection rule to read around), the exit condition (no `validating` row with the D16 shape exists on dev and prod — a query — after which the branch, its `providerOcr` flag and the legacy tests are removed with `/speckit-debt-pay`). Cite D16.
- [ ] T037 [P] Comment audit: grep `apps/api/src apps/pago/src` for "provider-ocr", "OCR door", "transfer door", "minute-two", "direct mode", "PDF" and "reading-check" and rewrite every sentence that still describes the old order of doors or the old PDF route, citing the decision that changed it (D1, D3, D5, D13, D16, D17). Confirm `apps/admin` needs nothing (`FeedScreen.tsx` reads `proofMode`, whose meaning is unchanged, D17).
- [ ] T038 [P] Update `CLAUDE.md` Architecture invariants: the `payments` lifecycle sentence gains "a receipt goes to the provider's image door first with the edge reading beside it; on not-found the two readings are compared and the row records agreed / disputed / blind (two-eyes-receipt D3, D5)", and the testing section's reader sentence mentions the `toMarkdown` stub. Keep it to two sentences.
- [ ] T039 Run the gates in CI order (`node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm -r --if-present build`) and the quickstart by hand: step 3, US1 sandbox walk, US2 measurement (record the `nula` false-refusal count in `reader.ts`'s header with the date), US3 uploads, US4 slow sandbox, US5 queries, the cut-over check. Record results in the task notes.
- [ ] T040 Run `/speckit-analyze` and resolve every CRITICAL finding; carry any correction into `specs/005-two-eyes-receipt/spec.md`, `specs/005-two-eyes-receipt/plan.md` or `specs/005-two-eyes-receipt/tasks.md` with a dated "Amended" note, as 004 did.

---

## Dependencies & Execution Order

```text
Setup (T001–T002)
   └─▶ Foundational (T003–T008)
          └─▶ US1 (T009–T020)  ── the flow; the MVP
                 ├─▶ US2 (T021–T025)  ── adds legibility to the gate US1 keeps
                 ├─▶ US3 (T026–T030)  ── adds the PDF input to the reader US1 calls
                 ├─▶ US4 (T031–T033)  ── changes when the pay handler US1 edited answers
                 └─▶ US5 (T034–T035)  ── reads the columns US1 (T013) and US2 (T021) write
                              └─▶ Polish (T036–T040)
```

**Why US1 comes first**: every other story feeds the receipt door US1
rewrites (T011) or reads the row US1 writes (T015). US2 and US3 are inputs
to that door; US4 is the answer of the handler that calls it; US5 counts
what it recorded.

**Why a merge is cleanest with US1 + US4 together**: T019 (US1) and T031
(US4) both edit the pay path — the page stops sending `transfer` and the
handler stops waiting. Either alone is testable; together they are the
payer's experience the spec describes. US2, US3 and US5 can each land in a
later PR.

**Within US1**: T009 → T010; T011 needs T009 and T005; T012, T013 beside
T011 (T012 touches `validate.ts`/`extract.ts` — coordinate with T011 in one
sitting); T014 needs T011–T013; T015 needs T005, T003; T016 beside T015;
T017 needs T015; T018 needs T016; T019 needs nothing in the API (the handler
already accepts `proofId` alone) — it can start after T005; T020 needs T019.

**Within US3**: T026 can start after T002; T027 needs T026; T028 needs T027;
T029 needs T028 and T006; T030 any time.

**Within US4**: T031 → T032; T033 beside T032.

## Parallel opportunities

| Wave | Tasks | Files |
| --- | --- | --- |
| Foundational | T006, T007, T008 (beside T003–T005) | `test/consta/helpers.ts`; `env.ts`; `sandbox/apicep-mock.mjs` |
| US1 engine | T009 then T010; T012 and T013 beside T011 | `compare.ts`; `validate.ts`; `extract.ts` |
| US1 lifecycle | T015 and T016 beside each other; T017, T018 after | `validation.ts` + `handler.ts`; `topups.ts` |
| US1 page | T019 → T020, beside the lifecycle wave | `PaymentPage.tsx`; `pago.test.tsx` |
| US2 | T021 and T022 beside each other; T024 beside T023 | `reader.ts` + `validate.ts`/`extract.ts`; `schema.ts` + `handler.ts`; `PaymentPage.tsx` |
| US3 | T026 and T030 beside US2's wave | `pdf-text.ts`; two comments |
| US5 | T034 beside T035 | `scripts/reading-check-report.mjs`; `validate.test.ts` |
| Polish | T036, T037, T038 | the debt entry; comments; `CLAUDE.md` |

## Implementation Strategy

### MVP first (User Story 1, with US4)

1. Phase 1: baseline, and settle the two PDF facts (T002) — twenty minutes
   with a dev link, and it decides one header comment and one assumption.
2. Phase 2: columns, types, helpers, sandbox. Every existing test still
   passes at the checkpoint.
3. Phase 3: the comparison, the receipt door, the lifecycle, the page.
   **Stop and validate**: the US1 test filters green; the sandbox walk.
4. Phase 6: the non-blocking answer. This plus Phase 3 is the first
   mergeable slice — the payer's experience as specified.

### Incremental delivery

5. Phase 4 (legibility) and Phase 5 (PDFs) — each its own PR if wanted;
   each independently testable against the door Phase 3 built.
6. Phase 7 (the report and the record test) — small, reviewable alone.
7. Phase 8: the debt entry, the comment audit, `CLAUDE.md`, the gates,
   `/speckit-analyze`.

### One developer, one branch

Stories land as separate commit groups on this branch, in phase order.
Nothing here happens after the merge except reading the dev numbers a week
later (quickstart § US5), which is the measurement the spec's D10 asks for.

---

## Notes

- [P] tasks touch different files and depend on nothing unfinished.
- Every task names its file; every test task names its citation.
- The two facts T002 verifies are the only unknowns; everything else was
  read out of the code (research.md).
- `RECEIPT_INCOMPLETE` stays declared and unused after T011; removing the
  code is a one-line follow-up once no caller switches on it — say so in
  `failure.ts` rather than deleting it in this feature.
