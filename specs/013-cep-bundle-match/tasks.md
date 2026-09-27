---
description: "Task list for cep-bundle-match"
---

# Tasks: cep-bundle-match

**Input**: Design documents from `/specs/013-cep-bundle-match/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: mandatory here, not optional. Constitution IV puts the engine and
lifecycle tests in workerd against a real D1, with apiCEP and its storage
intercepted at pinned origins and the reader stubbed at the binding; the
page and the panel test on happy-dom with MSW and axe; the new panel list's
contrast and width in Playwright. Constitution VII: every new test cites
`cep-bundle-match US<n>`; the single-`valid` refusal also cites
`bug: reference-finds-other-transfer`. Tests are written first and fail
before the code beneath them lands.

**Organization**: grouped by user story. The matcher, the bundle reader and
the records are shared by every story, so they are Foundational; US1 wires
the decision into the lifecycle and is the MVP. US2 is P1 too but needs no
new code beyond US1 — its phase proves the time rules at the lifecycle
level. US3 and US4 build on US1's wiring.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US4, mapping to the spec's user stories
- Every task names the file it touches

## Decision citations

Code comments cite `cep-bundle-match D<n>`, tabled in
[plan.md](./plan.md#decisions) (D1–D17). Where a comment today says
something this feature makes false, the task that changes the code beneath
it rewrites the comment: `not_found` as the only faceless `invalid`
(`consta/provider/{apicep,types}.ts`, D11 of consta), the 422 as the
provider's answer to a shared reference (`provider/apicep.ts`,
`direct-payments/validation.ts` receipt-triage D17), the reader's `time`
comment (`extraction/reader.ts`), receipt-triage D7's four stops, and the
`last_error` word list (`db/schema.ts`).

**Unchanged on purpose** (spec Assumptions): the WispHub half, partial and
overpayment rules, the fee, the typed pay's `409 REFERENCE_SHARED`, the
`not_found` schedule for a true "none", and the top-up lifecycle (it treats
`several` as it treats `not_found`). No seal is verified (D2). No name ever
reaches a comparison or a table.

---

## Phase 1: Setup

**Purpose**: know what green looks like, and bring in the one dependency and the one var.

- [ ] T001 Baseline: `pnpm install --frozen-lockfile`, then every gate in CI order — `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test` — and record in this task's notes the commit and the test counts of `apps/api` (and of `apps/api/test/consta/validate.test.ts`, `apps/api/test/direct-payment.test.ts`), `apps/pago/test/pago.test.tsx` and `apps/admin/test/feed.test.tsx`. A gate already red proves nothing later.
- [ ] T002 Add `fflate` to `apps/api/package.json` dependencies (`pnpm --filter @devolada/api add fflate`), commit the lockfile, and confirm the Worker still bundles (`pnpm --filter @devolada/api build`); note the bundle size before and after in this task's notes (plan, Complexity Tracking; research R3).
- [ ] T003 [P] Add `APICEP_STORAGE_ORIGIN` = `https://storage.apicep.cloud` to the `vars` of `apps/api/wrangler.jsonc` — top level, `env.dev` and `env.production` — with no URL written in code (constitution VIII); declare `APICEP_STORAGE_ORIGIN?: string` in `apps/api/src/env.ts` with its comment: unset means no bundle is ever downloaded and a several answer asks the payer for the clave; a link on any other origin is never fetched (`cep-bundle-match D16`); pin it in `apps/api/vitest.config.ts`; add a row to the `.dev.vars` table of `CLAUDE.md` (`http://localhost:8789` with the sandbox).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the tables, the engine's types, the bundle reader, the matcher,
the adapter, the reader's two answers — measured on the bench before any
test stands on them — the receipt side on the payment, the test fixtures
and the sandbox. None of it changes what a payer sees on its own.

**⚠️ CRITICAL**: T004–T019 land before any story task. T015 needs the creator — real captures and marks on the bench.

- [ ] T004 Schema and migration (data-model.md): in `apps/api/src/db/schema.ts` add `cepBundles` and `cepRecords` (unique `(business_id, clave)`; indexes `(business_id, payment_ref)` and `(business_id, credit_date, amount_cents)`), `payments.transferTime`, `senderTail`, `matchTrail`, `matchDistanceS`, `extractions.senderTail`; add `"several"` to `validations.reason`'s enum; add `CEP_UNDECIDED` and `CEP_BUNDLE_PENDING` to the `last_error` word comment. Generate with `pnpm --filter @devolada/api db:generate`, name it `apps/api/migrations/0040_cep_bundle_match.sql` with a header comment in the style of `0039_valid_kept.sql` (additive; old rows read NULL), and apply with `db:migrate:local`.
- [ ] T005 Engine types: create `apps/api/src/consta/bundle/types.ts` (`CepRecord`, `ReceiptSide`, `MatchPolicy`, `MatchResult`, `TrailCandidate`, `UndecidedReason`, `BundleStatus` — data-model.md "The matcher's types"); in `apps/api/src/consta/provider/types.ts` add `"several"` to `InvalidReason` (rewrite its D11 comment: three `invalid`s now) and `creditTime`, `chain`, `senderAccountType`, `senderAccount`, `certificateNumber` to `ProviderVerdict.cep`; in `apps/api/src/consta/index.ts` add `ConstaVerdict.bundle`, `ConstaVerdict.record`, the same `cep` fields, and `time`/`senderTail` on `ConstaReading` (contracts/engine.md).
- [ ] T006 [P] Fixtures in `apps/api/test/consta/bundle-fixtures.ts` (research R18): `cadenaOf(fields)` builds a 43-field version-`01` cadena; `buildCepPdf(opts)` writes a one-page PDF 1.5 with one WinAnsi font, `Tm`/`Tj` runs, the labels verbatim ("Clave de rastreo", "Cadena Original (información del pago):", "Sello Digital (firma provista por la institución receptora del pago):", "Número de Serie del Certificado de Seguridad de la institución receptora del pago"), the cadena broken over three lines — once inside the beneficiary's name (the space eaten) and once inside the certificate number — the content stream compressed with `fflate.zlibSync`, and an option whose last compressed byte is a line break; `buildBundleZip(entries)` via `fflate.zipSync` with names `CEP-<AAAAMMDD>-<clave>.pdf`; `severalAnswer(url)`, `noneAnswer()` and `validAnswer(cep)` provider bodies in the measured shapes (research R1, with `cdaChain`, `processingTime`, `senderAccountType`, `senderAccount`). Synthetic names and RFCs only.
- [ ] T007 [P] `apps/api/src/consta/bundle/zip.ts` (`cep-bundle-match D3`): `sniff(bytes)` → `"zip" | "pdf" | null` by first bytes; `claveOfEntry(name)` for `^CEP-\d{8}-([A-Z0-9]{6,30})\.pdf$` and `^\[\d{4}-\d{2}-\d{2}\]([A-Z0-9]{6,30})\.pdf$`, never a day; `readEntries(bytes, keep)` with `fflate.unzipSync` and a filter so skipped entries are never inflated. Tests in `apps/api/test/consta/bundle.test.ts` (cite `cep-bundle-match US1`): ZIP served as PDF recognised; a real PDF is a bundle of one; garbage → null; both name patterns; skipped entries not inflated.
- [ ] T008 [P] `apps/api/src/consta/bundle/cep-pdf.ts` (`cep-bundle-match D3`, research R4): `readCepPdf(bytes)` → `{ clave, cadena, seal, certificateNumber }` or `{ unreadable: reason }` — objects' streams sliced by their declared `/Length` (never at the line break before `endstream`), inflated with `fflate`, runs decoded as cp1252, the cadena as the lines between its label and the seal's, joined without spaces. Tests in `apps/api/test/consta/bundle.test.ts`: the three-line cadena rejoins; the stream whose last compressed byte is a line break reads; a missing label → unreadable; a printed clave that differs from the entry's → unreadable.
- [ ] T009 [P] `apps/api/src/consta/bundle/cadena.ts` (`cep-bundle-match D4`, research R5): `parseCadena(text)` → the `CepRecord` facts or `null` — version `01`; `DDMMAAAA` → `YYYY-MM-DD`; `HHMMSS` → `HH:MM:SS`; `amountToCents` on the amount's text (constitution II); `creditedAt` from credit day + time in `America/Mexico_City`; names and RFC/CURP never returned. Tests in `apps/api/test/consta/bundle.test.ts`: a bundle cadena, a `valid`'s `cdaChain`, a 23:48:18 credit filed on the next operation day, a bad version → null, and a check that no returned field equals the fixture's name or RFC.
- [ ] T010 [P] `apps/api/src/consta/bundle/match.ts` (`cep-bundle-match D6`, `D7`, `D8`, `D11`): `MATCH_POLICY = { beforeS: 60, afterS: 180, marginS: 30 }`, `matchCandidates(receipt, candidates, used, policy)` and `fitClave(typed, candidates)`, pure (contracts/engine.md "The matcher"). Table tests in `apps/api/test/consta/match.test.ts` (cite `cep-bundle-match US1`, `US2`, `US3`): integrity (another amount; a destination that ties to none); used; tail by type — `40` by the CLABE's end and by its first 17 digits' end (`8301` of a CLABE ending `83010`), `3` and `10` by the number's end, fewer than three digits is no tail; window edges −60 in / −61 out / +180 in / +181 out; an `HH:MM` receipt as the whole minute; nearest wins at 83 s apart; within 30 s → `too_close`; no time and two left → `no_signal`; all used → `all_used`; none left → `none_fit`; `by` and `distanceS` for each; `fitClave` with O for 0, I for 1, one missing character, and two fits → `null`.
- [ ] T011 `apps/api/src/consta/bundle/store.ts` (`cep-bundle-match D5`, `D16`; after T004, T005, T007–T009): `storeBundle(env, db, owner, { paymentRef, validationId, searchKeys, url })` — fetch only when the URL's origin is `APICEP_STORAGE_ORIGIN` (else `unreadable`, no fetch), no auth header, `AbortSignal.timeout(10_000)`, 4 MB cap by header and by bytes read (`too_large`); sniff; read only entries whose clave the business holds no record of; insert `cep_records` on conflict do nothing; put the file in `PROOFS` at `bundles/<business_id>/<bundle_id>.zip`; write `cep_bundles` (`claves`, `unreadable`, `sha256`, `byte_size`, `status`, `url` cleared once read or given up); `readPendingBundle(env, db, owner, bundleId)` — the same with `download_attempts + 1`, the third failure `unreadable`; `storeSingleRecord(db, owner, cep)` from a `valid`'s `chain`. Returns `CepRecord`s for every readable clave of the bundle, new or already held. For a platform-owned call (`{ platform: true }`, the platform's own top-ups) it downloads and writes nothing (`cep-bundle-match D5`).
- [ ] T012 [P] `apps/api/src/consta/provider/apicep.ts` (`cep-bundle-match D1`, `D4`): read `validation.banxicoConfirmed`; in `mapVerdict`, before the `not_found` branch, `invalid` + `banxicoConfirmed === true` + no `cepDetails` + no `cepStatus` + `downloads.cepPdf` → `{ status: "invalid", reason: "several" }`; read `processingTime`, `cdaChain`, `senderAccountType`, `senderAccount`, `certificateNumber` into `cep`. Rewrite the 422 comment: measured 2026-09-26, a reference matching several transfers comes back as a bundle, never a 422 (24 calls). Tests in `apps/api/test/consta/validate.test.ts` (cite `cep-bundle-match US1`): several → `reason: "several"`; `banxicoConfirmed: true` with no link → `not_found`; `banxicoConfirmed: false` → `not_found`; a `valid` exposes the new `cep` fields.
- [ ] T013 [P] Reader questions (`cep-bundle-match D15`, research R15): in `apps/api/src/consta/extraction/reader.ts` ask `hora` as `HH:MM:SS` when the receipt prints seconds, else `HH:MM`; add `cuentaOrigen` to `FIELDS` and its sender-side rule to `RULES` ("Cuenta origen", "Desde", "Ordenante", "Cuenta de retiro"; never the destination's digits); `timeOf` keeps either shape; `Reading.senderTail` (≥ 3 digits, else null); `QUESTIONS_VERSION = "3"`; rewrite the `time` comment. In `apps/api/src/consta/extract.ts` write `extractions.sender_tail` and return `time` and `senderTail` on `ConstaReading` — the `/read` answer that `sharedAsk` reads (analyze U2). Re-pin the prompt hash in `apps/api/test/consta/reader-questions.test.ts`. No stub reading changes here: they wait for T015's measurement (constitution IV).
- [ ] T014 The bench learns the two answers (`cep-bundle-match D15`; the bench of spec 011): add `"time"` and `"senderTail"` to `BENCH_FIELDS` in `apps/api/src/routes/reader/schema.ts`; carry them in `productReading` and `notShown` in `apps/api/src/platform/bench.ts`; label them "Hora" and "Cuenta de origen" in `apps/admin/src/features/operator/BenchReceipt.tsx`. Tests in `apps/api/test/reader-bench.test.ts` (the tally counts both fields per question version) and `apps/admin/test/operator-reader.test.tsx` (both fields can be marked) — cite `cep-bundle-match US1`.
- [ ] T015 Measure the reader on the bench before any stub (constitution IV: a stubbed answer is a measured one; research R15; the way spec 010's Step 0 did): run the API with the real `AI` binding (`pnpm --filter @devolada/api dev`, or a preview) and, in `/operador` → Lector, add real captures — at least an Azteca receipt that prints seconds and "Guardadito ***8301", one that prints `HH:MM` only, and one that shows no sender account — beside the bench's existing receipts; read them all with question version `"3"` on the chosen model; mark every field; compare the tally with version `"2"`. Write the table, dated, into the header comment of `apps/api/src/consta/extraction/reader.ts`: each capture's raw answer for `hora` and `cuentaOrigen`, and the wrong counts per field of both versions — no name, RFC or whole account. A field worse in version 3 stops here and goes back to T013. Needs the creator: the captures and the marks.
- [ ] T016 Stubs from the measurement (constitution IV; after T015): in `apps/api/test/consta/helpers.ts`, `StubbedReading` gains `cuentaOrigen`, and T015's captures become named, dated readings copied from their raw answers (for example `AZTECA_SECONDS_TAIL_READING`); every stub this feature's tests use derives from them. Add to `apps/api/test/spei-date-rollover.test.ts` that a time with seconds is stored whole (cite `cep-bundle-match US2`).
- [ ] T017 `apps/api/src/consta/validate.ts` (`cep-bundle-match D1`, `D5`, `D9`, `D13`; after T011–T013): on `reason: "several"` call `storeBundle` after the billing row and return `bundle`; on a `valid` of a clave-less search, `storeSingleRecord` and return `record` — clave-less as D9 defines it: the transfer door asked by reference, or neither reading on the receipt door carried a clave the gate passed (analyze A1); on the transfer door the billing row's `tracking_key` is the CEP's clave when the request had none; `ourReading` carries `time` and `senderTail` on every outcome of a provider-first call — `valid`, `several`, `not_found`, `pending`. Tests in `apps/api/test/consta/validate.test.ts` with `fetchMock` at `https://api.apicep.cloud` and `https://storage.apicep.cloud` (cite `cep-bundle-match US1`): one `validations` row with `reason = 'several'`; records written, bundle `read`, R2 object present, `url` NULL; a link on another origin never fetched → `unreadable`; a failed download → `pending` with the URL kept; a file over 4 MB → `too_large`; a second bundle repeating a clave reads only the new entry; a single `valid` without clave stores its record and logs its clave; a platform top-up confirmed through the receipt door writes no record and a several answer on it stays `not_found`.
- [ ] T018 `apps/api/src/direct-payments/validation.ts` (`cep-bundle-match D15`, analyze I1; after T016, T017): on every attempt whose verdict carries `ourReading` — `valid`, `several`, `not_found` and `pending` alike — write `transfer_time` and `sender_tail` from it, never overwriting a set value. Today only the `not_found` branch copies the readings, and a `valid` takes the CEP's data, so a first receipt-door attempt would leave both empty. Tests in a new `apps/api/test/cep-bundle-match.test.ts` (cite `cep-bundle-match US1`) with T016's measured stubs: a receipt-door first attempt answered `valid`, and one answered `several`, both store the reading's time and tail; a typed row keeps both NULL.
- [ ] T019 [P] Sandbox: `apps/api/sandbox/cep-bundle.mjs` (plain JS, `fflate`) builds at startup a ZIP of two synthetic CEPs — tails 8301 and 4417, credited 07:11:20 and 11:40:47, $3.00 — in the layout of T006, served by `apps/api/sandbox/apicep-mock.mjs` at `/mock-bundle.zip` with `Content-Type: application/pdf`; the mock answers a shared reference (`4417000`) with the several shape pointing at it; document the reference in the mock's header comment.

**Checkpoint**: every existing test green; the engine reads bundles and keeps records; no payer-visible change yet.

---

## Phase 3: User Story 1 — A shared reference resolves to the payer's own transfer (P1) 🎯 MVP

**Goal**: a bundle confirms the payer's own transfer with one call; a single
match the receipt contradicts does not confirm; the operator sees how it was
decided.

**Independent Test**: quickstart § User Story 1.

### Tests for User Story 1 (write first, see them fail)

- [ ] T020 [US1] Lifecycle tests in `apps/api/test/cep-bundle-match.test.ts` (cite `cep-bundle-match US1`): (a) receipt 07:10:58 with tail 8301 against a ZIP of tails 8301/4417 → confirmed with the 8301 clave, `match_trail.by = "tail"`, `match_distance_s = 22`, `tracking_key` adopted, `banxico_valid_at` set, one `validations` row, the business's action queued; (b) the tail leaves one → the time is not needed; (c) one unreadable CEP → flagged in the trail, the rest decide; (d) a CEP with another amount or another destination → dropped with `amount`/`account`; (e) the Janely case as it happened — the receipt door's **first** attempt, with T016's measured reading printed 18:58 and no clave, answered by a single `valid` credited 07:19:52 → `CEP_UNDECIDED`, reason `none_fit`, `disputed_fields ["trackingKey"]`, `next_validation_at` NULL, record kept; never through a row seeded with a time (analyze I1; also cite `bug: reference-finds-other-transfer`); (f) single `valid` on a row with neither time nor tail → confirmed as today; (g) SC-003 — after a several answer, a sweep past every slot makes no second provider call; (h) the ZIP of (a) answered on the receipt door's **first** attempt, with T016's measured reading (tail 8301, time with seconds) → chosen by tail, never `no_signal` (analyze I1); (i) two payments of one bundle decided with the same stale used set — X taken by the first after the second read it — the second re-matches and confirms with Y, and with no Y it is `CEP_UNDECIDED` `all_used`, never `TRANSFER_ALREADY_USED` (D18).
- [ ] T021 [US1] Tests for the narrowed stop and the trace in `apps/api/test/cep-bundle-match.test.ts` (cite `cep-bundle-match US1`): (a) a second payment sharing reference, day, bank, amount and account, whose receipt shows a time, reaches the provider — at the lifecycle's pre-call stop, at the engine's receipt door, and at `/read` (no `shared` ask); (b) with neither time nor tail each of the three still asks for the clave with no call; (c) the true owner of a clave the filter refused later searches by clave, the provider answers `valid` with `cepPreviouslyValidated: true`, and the payment confirms — not `TRANSFER_ALREADY_USED`.
- [ ] T022 [P] [US1] Page test in `apps/pago/test/pago.test.tsx` (cite `cep-bundle-match US1`): a status with `error: "CEP_UNDECIDED"` and `disputedFields: ["trackingKey"]` shows the clave form with its copy (contracts/payment-page.md), focus on the clave field, the other fields filled, axe clean; the correction goes out with `supersedes`.
- [ ] T023 [P] [US1] Panel tests (cite `cep-bundle-match US1`): in a new `apps/api/test/payments-unmatched.test.ts`, `GET /payments/:id/proof` of a bundle-confirmed row returns `match` with `source`, `by`, `distanceS` and candidates by tail (no name, no whole account); in `apps/admin/test/feed.test.tsx`, the proof dialog shows "Varias coincidencias · resuelta por cuenta" and each candidate's fate.

### Implementation for User Story 1

- [ ] T024 [US1] The decision in `apps/api/src/direct-payments/validation.ts` (`cep-bundle-match D8`, `D9`, `D10`, `D16`): after the engine's verdict, for `reason: "several"` with `bundle.status = "read"`, or a `valid` of a clave-less search (D9) — build `ReceiptSide` from the attempt's own reading when the verdict carries one (`verdict.ourReading`: `time`, `senderTail`, and `date`, the printed day), else from the row (`transfer_time`, `sender_tail`, `transfer_date`): a first receipt-door attempt has an empty row (analyze I1); the claimed amount and the payment's account snapshot come from the row as today; read the used claves (one query over live payments of the business), run `matchCandidates`; **chosen** → promote the record into `verdict.cep` with `alreadyValidated: false` and `previouslyValidated: null`, and continue into the existing `valid` branch, writing `match_trail` and `match_distance_s` in its update; **undecided** → `validating`, `last_error = 'CEP_UNDECIDED'`, `disputed_fields ["trackingKey"]`, `next_validation_at = NULL`, `match_trail`. `bundle.status = "pending"` → `CEP_BUNDLE_PENDING` on its next slot; a row in `CEP_BUNDLE_PENDING` skips the provider and calls `readPendingBundle`; `unreadable`/`too_large` → `CEP_UNDECIDED` with that reason. When writing the chosen clave meets the unique index — another payment took it between the read and the write — add it to `used` and run the matcher again, twice at most; never `TRANSFER_ALREADY_USED` for a clave the matcher chose (`cep-bundle-match D18`). Rewrite the receipt-triage D17 comment beside the 422 branch.
- [ ] T025 [US1] Narrow the shared-reference stop (`cep-bundle-match D12`) in its four places: the pre-call stop and the short-circuit comment in `apps/api/src/direct-payments/validation.ts`; `hooks.referenceTaken` on the receipt door in `apps/api/src/consta/validate.ts` (only with neither `time` nor `senderTail` on the reading); `sharedAsk` in `apps/api/src/routes/direct-payments/handler.ts`; the typed `409 REFERENCE_SHARED` unchanged, with a comment saying why (typed data carries neither). Rewrite each receipt-triage D7 comment.
- [ ] T026 [US1] `tracesToOwnAttempt` in `apps/api/src/direct-payments/validation.ts` (`cep-bundle-match D13`): also yes when the clave is in the business's `cep_records`; the unique clave index still refuses a second use.
- [ ] T027 [US1] The ask: add `"CEP_UNDECIDED"` to `publicPaymentError` in `apps/api/src/routes/direct-payments/schema.ts` (comment D10); in `apps/api/src/routes/direct-payments/handler.ts` let `getDirectPaymentStatus` carry it (`CEP_BUNDLE_PENDING` stays null through `publicError()`); in `apps/pago/src/features/pago/PaymentPage.tsx` add its copy to `payErrors` and treat it like `REFERENCE_AMBIGUOUS` in `referenceAsk` and in the `keys = "clave"` choice.
- [ ] T028 [US1] The operator's view of a decision: `proofResponse.match` in `apps/api/src/routes/payments/schema.ts`; `getPaymentProof` in `apps/api/src/routes/payments/handler.ts` builds it from `match_trail` and the business's `cep_records` (tails only); the proof dialog in `apps/admin/src/features/feed/FeedScreen.tsx` renders the decision line and the candidates with their fates in es-MX (contracts/panel.md).

**Checkpoint**: quickstart § User Story 1 passes; US1 can ship alone.

---

## Phase 4: User Story 2 — The same payer twice on one day is told apart by time (P1)

**Goal**: two transfers from one account are told apart by the receipt's
time, or honestly not.

**Independent Test**: quickstart § User Story 2.

### Tests for User Story 2

- [ ] T029 [US2] Lifecycle tests in `apps/api/test/cep-bundle-match.test.ts` (cite `cep-bundle-match US2`): receipt 11:43:20 with tail 8301 against 11:42:13 and 11:43:36 → the 11:43:36 clave, the other `window`; receipt 11:42:05 → the 11:42:13 clave, `match_distance_s = 8`, `by = "time"`; two CEPs credited 20 s apart → `CEP_UNDECIDED`, `too_close`; no time → `no_signal`; an `HH:MM` receipt with two credits in that minute → `too_close`; a receipt at 23:59:50 and a credit at 00:00:20 the next day → chosen.

### Implementation for User Story 2

- [ ] T030 [US2] The distance in the panel: the proof dialog in `apps/admin/src/features/feed/FeedScreen.tsx` says "abonada {n} s después de la hora del comprobante" (or "antes") and names "Fuera de la ventana de hora" and "Muy cerca de otra"; test in `apps/admin/test/feed.test.tsx` (cite `cep-bundle-match US2`). Any rule T029 finds wrong is fixed in `apps/api/src/consta/bundle/match.ts` with a row added to `apps/api/test/consta/match.test.ts`.

**Checkpoint**: quickstart § User Story 2 passes.

---

## Phase 5: User Story 3 — When the bundle does not decide, the payment says so and asks for the clave (P2)

**Goal**: an undecided payment is visible, never expires, and a typed clave
that fits a kept candidate confirms with no call.

**Independent Test**: quickstart § User Story 3.

### Tests for User Story 3

- [ ] T031 [US3] Lifecycle tests in `apps/api/test/cep-bundle-match.test.ts` (cite `cep-bundle-match US3`): every clave used → the status endpoint says `CEP_ALL_USED`; three CEPs with no time and no tail → `CEP_UNDECIDED`, `no_signal`, and a sweep at +13 h leaves it `validating` with no new `validations` row; a superseding row whose clave has an O for one candidate's 0 → confirmed from the record with no provider call (`match_trail.by = "clave"`); a clave that fits no candidate → one ordinary clave call; a clave that fits two → the ordinary call.
- [ ] T032 [P] [US3] Page test in `apps/pago/test/pago.test.tsx` (cite `cep-bundle-match US3`): `CEP_ALL_USED` shows its copy and the clave form, axe clean.
- [ ] T033 [P] [US3] Feed test in `apps/admin/test/feed.test.tsx` (cite `cep-bundle-match US3`): an undecided row shows its reason in words and "Se pidió la clave de rastreo al cliente."; "Ver coincidencias" opens the candidates.
- [ ] T034 [P] [US3] Public API test in `apps/api/test/collections-api-verify.test.ts` (cite `cep-bundle-match US3`): an undecided payment of an API link reads, through `GET /v1/payments?customerRef=` and `GET /v1/transfers`, `awaiting: "payer_tracking_key"` with its `awaitingReason` — `ambiguous` for `no_signal` and `too_close`, `all_used`, `no_match` for `none_fit`, `unreadable` for `unreadable` and `too_large`; a confirmed payment and an ordinary validating one read `null` for both; the status, the webhook events and every other field are unchanged.

### Implementation for User Story 3

- [ ] T035 [US3] `CEP_ALL_USED`: add it to `publicPaymentError` in `apps/api/src/routes/direct-payments/schema.ts`; map `last_error = 'CEP_UNDECIDED'` with `match_trail.reason = 'all_used'` to it in `getDirectPaymentStatus` (`apps/api/src/routes/direct-payments/handler.ts`); its copy and the same ask in `apps/pago/src/features/pago/PaymentPage.tsx`.
- [ ] T036 [US3] The fit (`cep-bundle-match D11`) in `apps/api/src/direct-payments/validation.ts`: a row with a clave whose `supersedes_id` names a `CEP_UNDECIDED` row runs `fitClave` against that row's candidates before any call; exactly one fit promotes the record (as T024) with `match_trail.by = "clave"`; otherwise the ordinary clave search.
- [ ] T037 [US3] No expiry (`cep-bundle-match D10`) in `apps/api/src/direct-payments/validation.ts`: confirm a `CEP_UNDECIDED` row is never selected by `sweepDirectPayments` nor reaches `retryLater`'s expiry, and say so in the D10 comment — including that a row provisionally released before it went undecided keeps its WispHub promise until the promise lapses, and `notifyProvisionalExpiry` does not run for it.
- [ ] T038 [US3] The reason in the feed: `feedCharge.undecided` in `apps/api/src/routes/payments/schema.ts`; `listPaymentFeed` in `apps/api/src/routes/payments/handler.ts` sets it from `last_error` and `match_trail.reason`; `apps/admin/src/features/feed/FeedScreen.tsx` shows the reason copy of contracts/panel.md and opens the proof dialog from "Ver coincidencias" for an undecided row.
- [ ] T039 [US3] The public read (`cep-bundle-match D17`, contracts/public-api.md): `apiPayment` in `apps/api/src/routes/v1/payments/schema.ts` gains `awaiting` and `awaitingReason`, additive and nullable; `apps/api/src/routes/v1/payments/handler.ts` derives them from `last_error = 'CEP_UNDECIDED'` and `match_trail.reason` for both reads; the webhook body is unchanged.

**Checkpoint**: quickstart § User Story 3 passes.

---

## Phase 6: User Story 4 — Other customers' CEPs in the bundle confirm their own pending payments (P3)

**Goal**: a bundle closes other customers' pending payments without calls,
and the business sees what no payment holds.

**Independent Test**: quickstart § User Story 4.

### Tests for User Story 4

- [ ] T040 [US4] Lifecycle tests in `apps/api/test/cep-bundle-match.test.ts` (cite `cep-bundle-match US4`): customer B's pending payment with a clave that customer A's bundle holds gets `next_validation_at = now` after A's attempt, and the next sweep confirms it with no provider call (one `validations` row in total) and queues B's reconnection; a clave in no record calls as today.
- [ ] T041 [P] [US4] Route tests in `apps/api/test/payments-unmatched.test.ts` (cite `cep-bundle-match US4`): `GET /payments/unmatched-transfers` lists records no live payment holds with amount, credit time and tail; leaves out held ones; never shows another business's; a viewer may read it; `from` filters; the payer's status endpoint never carries another sender's data.
- [ ] T042 [P] [US4] Feed test in `apps/admin/test/feed.test.tsx` (cite `cep-bundle-match US4`): the "Sin pago" chip lists the transfers, amounts formatted es-MX with tabular numerals, axe clean.

### Implementation for User Story 4

- [ ] T043 [US4] Pull and nudge (`cep-bundle-match D14`) in `apps/api/src/direct-payments/validation.ts`: before any paid search by clave, look up the business's `cep_records` by clave — a record no live payment holds is promoted as in T024, with no call; after an attempt stores a bundle, set `next_validation_at = now` on the business's other `validating` payments whose `tracking_key` is among its claves.
- [ ] T044 [US4] The route: `GET /unmatched-transfers` in `apps/api/src/routes/payments/index.ts` (`requireArea("payments", "read")`, `zValidator` on the query; pure router); the anti-join query in `apps/api/src/routes/payments/handler.ts`; `unmatchedTransfersQuery` and `unmatchedTransfersResponse` in `apps/api/src/routes/payments/schema.ts`, exported through `@devolada/api/payments-schema`.
- [ ] T045 [US4] `apps/admin/src/features/feed/FeedScreen.tsx`: the "Sin pago" chip and its list (TanStack Query, tokens only, 40px compact rows, "Transferencias recibidas que ningún pago ha usado.").

**Checkpoint**: quickstart § User Story 4 passes.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T046 [P] `POST /dev/cep-read` in `apps/api/src/routes/dev.ts`: 404 outside `ENVIRONMENT=dev`; reads the body with `consta/bundle/` and returns the records and the unreadable entries; stores nothing. Test beside the other dev-route tests in `apps/api/test/dev-seed.test.ts` (cite `cep-bundle-match US1`).
- [ ] T047 Quickstart Step 0 by hand (`specs/013-cep-bundle-match/quickstart.md`): run `/dev/cep-read` (`apps/api/src/routes/dev.ts`) over the creator's E1, E6 and F1 bundles (`~/labs/devolada-evidencia/apicep-probe-lote1/`, `…/apicep-probe-lote2/`) → 8 records, 0 unreadable, the measured credit times; write the result, with no name, in this task's notes. Any unreadable entry stops the release and goes back to T008.
- [ ] T048 If the reader's questions changed after T015, repeat T015's comparison on the bench (`/operador` → Lector) and update the table in `apps/api/src/consta/extraction/reader.ts`; otherwise record in this task's notes that they did not.
- [ ] T049 [P] Browser layer: extend `tests/e2e/responsive.spec.ts` and `tests/e2e/contrast.spec.ts` with the "Sin pago" list and the proof dialog's candidates at 360/768/1280 in both themes, with stubs in `tests/e2e/stubs.ts` validated by the payments schema.
- [ ] T050 [P] Bug trail: a dated note in `.specify/bugs/reference-finds-other-transfer/assessment.md` — fixed by spec 013 FR-014 (`cep-bundle-match D9`), naming the tests of T020 (e) and T021 (c); after merge, run `/speckit-bug-test` on it.
- [ ] T051 Comments audit (constitution I): grep `apps/api/src` for the comments listed under "Decision citations" and for `not_found` described as the only faceless answer; rewrite what the code no longer does; confirm every new rule cites `cep-bundle-match D<n>`.
- [ ] T052 Every gate in CI order and the cross-cutting checks of `specs/013-cep-bundle-match/quickstart.md`; `pnpm e2e` for T049; record the counts against T001's in this task's notes.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T003)**: no dependencies; T002 and T003 in parallel after T001.
- **Foundational (T004–T019)**: after Setup. T005 after T004. T006–T010, T012 and T013 in parallel after T005. T011 after T004, T005, T007–T009. T014 after T013; T015 after T013 and T014 and needs the creator; T016 after T015. T017 after T011–T013. T018 after T016 and T017. T019 after T006 (it mirrors the fixture layout). **Blocks every story.**
- **US1 (T020–T028)**: after Foundational.
- **US2 (T029–T030)**: after US1's T024 (the wiring the time rules run through).
- **US3 (T031–T039)**: after US1 (T024, T027, T028).
- **US4 (T040–T045)**: after US1 (T024); independent of US2 and US3.
- **Polish (T046–T052)**: after the stories that ship; T047 before release.

### Within each story

Tests first and failing; pure modules before the engine; the engine before
the lifecycle; schemas and handlers before the page and the panel; each
story ends at its checkpoint with every existing test green.

### Shared files

`apps/api/src/direct-payments/validation.ts`, `apps/api/src/consta/validate.ts`,
`apps/api/test/cep-bundle-match.test.ts`, `routes/direct-payments/{schema,handler}.ts`,
`routes/payments/{schema,handler}.ts`, `PaymentPage.tsx`, `FeedScreen.tsx`,
`pago.test.tsx` and `feed.test.tsx` are touched by more than one task; tasks
on the same file are never `[P]` with each other.

## Parallel Examples

**Foundational**, once T004 and T005 are in:

```text
T006 fixtures        (apps/api/test/consta/bundle-fixtures.ts)
T007 zip             (apps/api/src/consta/bundle/zip.ts)
T008 CEP reader      (apps/api/src/consta/bundle/cep-pdf.ts)
T009 cadena          (apps/api/src/consta/bundle/cadena.ts)
T010 matcher         (apps/api/src/consta/bundle/match.ts)
T012 adapter         (apps/api/src/consta/provider/apicep.ts)
T013 reader          (apps/api/src/consta/extraction/reader.ts)
then T011 → T017; T013 → T014 → T015 (the creator) → T016 → T018; T019 once T006 is in
```

**US1**:

```text
T020 → T021 (same file)  |  T022 page test  |  T023 panel tests
→ T024 → T025 → T026 (validation.ts)  |  T027 schema/handler/page  |  T028 proof route/dialog
```

**US3**: T031 | T032 | T033 | T034 → T035 | T036 → T037 (same file) | T038 | T039.

**US4**: T040 | T041 | T042 → T043 | T044 → T045.

## Implementation Strategy

### MVP first (User Story 1)

1. Setup, then Foundational.
2. US1: a shared reference confirms the payer's own transfer with one
   call; a single match the receipt contradicts asks for the clave; the
   operator sees the decision.
3. **Stop and validate** with quickstart § User Story 1; it can ship alone.

### Incremental delivery

1. US1 → ship (closes the critical bug and the twelve-hour loop).
2. US2 → the same payer twice is told apart, proven at the lifecycle → ship.
3. US3 → undecided payments ask with the right words, never expire, a
   typed clave closes them without a call, and a business on the `/v1` API
   sees what the payment awaits → ship.
4. US4 → other customers' payments close from the same bundle; the business sees
   what no payment holds → ship.

Each increment leaves every earlier outcome as it was, and each is validated
by its quickstart section alone.

### Notes

- A task's notes record what was measured or run, with the date and the
  commit — and never a name, RFC or whole account from a real CEP.
- A shortcut taken on purpose is registered with `/speckit-debt-log` the
  same day (constitution, Development Workflow).
