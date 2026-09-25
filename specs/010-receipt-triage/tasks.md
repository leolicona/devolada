---
description: "Task list for receipt-triage"
---

# Tasks: receipt-triage

**Input**: Design documents from `/specs/010-receipt-triage/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Regenerated 2026-09-24** from the re-planned spec and plan (D11–D32; D23
retired with the list door; Story 3 rescoped to one cuenta de cobro; the
capture guide made compact; blurry captures keep today's rule). No task of
the earlier list survives by number; the earlier list is in git history.

**Tests**: mandatory here, not optional. Constitution IV puts the engine,
lifecycle and settings tests in workerd against a real D1 with apiCEP
intercepted at its pinned origin and the reader stubbed at the binding; the
page and the panel test on happy-dom with MSW and axe; the guide's contrast
and width in Playwright. Constitution VII requires every test to cite its
story: every new or rewritten test cites `receipt-triage US<n>`. Research R17
names the two-eyes assertions this feature changes; nothing retires unnamed.

**Organization**: grouped by user story so each can be implemented and tested
on its own. US1 (reference) first, as the spec orders it. US2 reads the
gate's reference verdict, which lands in Foundational, so it does not wait on
US1. US3 (cuenta de cobro) and US4 (guide) are independent of the others.
The review hold (plan D31) is shared by US1 (no-clave guard) and US3 (retired
account), so it is Foundational.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US4, mapping to the spec's user stories
- Every task names the file it touches

## Decision citations

Code comments cite `receipt-triage D<n>`, tabled in
[plan.md](./plan.md#decisions): D1–D10 are the spec's, D11–D32 the plan's
(D23 retired — never cite it for new code).

Where a comment today says something this feature makes false — a hole never
refuses (`consta/validate.ts` D2/D3 block, `consta/failure.ts` on
`RECEIPT_INCOMPLETE`, `reader.ts` on legibility, the `/read` handler's
header), the beneficiary is the business's CLABE
(`direct-payments/validation.ts`, `routes/direct-payments/handler.ts`),
`configured` needs a CLABE (`routes/settings/handler.ts`), Devolada "cannot
hit" the 422 (`provider/apicep.ts`) — it is rewritten in the task that
changes the code beneath it. A comment contradicting the code is the gap
constitution I forbids.

**Unchanged on purpose** (spec, 2026-09-24): a partly legible capture, a
malformed clave and a picture whose legibility the reader did not judge go to
the provider as today (D16); no task adds a warning for blur. The reader
learns only `referenciaNumerica` and `destino`; every message is fixed es-MX
copy; the WhatsApp share text is untouched.

---

## Phase 1: Setup

**Purpose**: know what green looks like before anything changes.

- [ ] T001 Baseline: `pnpm install --frozen-lockfile`, then every gate in CI order — `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test` — and record in this task's notes the commit and the test counts of `apps/api/test/consta/validate.test.ts`, `apps/api/test/direct-payment.test.ts`, `apps/api/test/settings.test.ts`, `apps/pago/test/pago.test.tsx` and `apps/admin/test/settings.test.tsx`. A gate already red proves nothing later.
- [ ] T002 List the tests research R17 says will change: `grep -n 'legibilidad: "completa"' apps/api/test/consta/validate.test.ts apps/api/test/direct-payment.test.ts` and keep those whose stub reading has `claveDeRastreo: null` (a fully legible picture with no clave that today reaches the provider). Record their names in this task's notes; T031 rewrites exactly these. Tests with a *malformed* clave or a *partly legible* hole are not on the list (D16). Also list every reader of `status = 'confirmed'` that settles something — `grep -rn "\"confirmed\"" apps/api/src` — for T013's audit.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the columns, the engine's contract types, the reader's two new
fields, the gate's reference verdict, the test helpers, the sandbox, the bank
hints, and the review hold. None of it changes product behaviour on its own.

**⚠️ CRITICAL**: T003–T016 land before any story task.

- [ ] T003 Add the columns of [data-model.md](./data-model.md) to `apps/api/src/db/schema.ts`: on `businesses` — `speiCard`, `speiCardBank`, `speiPhone`, `speiPhoneBank`, `speiCollectKind` (text enum `clabe|card|phone`, nullable; comment: NULL reads `clabe` — D29), `speiRetiredAccounts` (text JSON; D30); on `payments` — `referenceNumber` (comment: up to seven digits as printed, never cast — D1, D12), `beneficiary` and `registeredAccounts` (text JSON; comment: attempts read the account from the payment, never the business — D25, D30), `reviewReason` (`retired_account|no_clave`), `reviewedBy`, `reviewedAt` (D31); on `extractions` — `proofKey`, `referenceNumber`, `providerReferenceNumber`, `destinationKind`, `destinationDigits` (D21, D24); extend `extractions.outcome` with `key_missing` and `wrong_destination` and `payments.actionOutcome` with `review` (D31); add the non-unique index `payments_business_reference_idx` on (`businessId`, `referenceNumber`, `transferDate`) (D7). Extend the comments on `payments.disputed_fields` (`"referenceNumber"`, D13) and `payments.last_error` (`REFERENCE_AMBIGUOUS` D17, `REFERENCE_SHARED` D7, `REJECTED_BY_BUSINESS` D31). Nothing is dropped or renamed.
- [ ] T004 Generate the migration with `pnpm --filter @devolada/api db:generate`, rename it `apps/api/migrations/0036_receipt_triage.sql` (if `0036` is taken, use the next free number and amend data-model.md's first paragraph), update `apps/api/migrations/meta/_journal.json` as earlier renames did, and read it: only `ALTER TABLE … ADD COLUMN` and one `CREATE INDEX` — no `DROP`, no table rebuild (if drizzle-kit emits one, hand-write the statements and say so in the file header, as `0030` does). Give the file the header `0030_two_eyes_receipt.sql` has. Apply with `pnpm --filter @devolada/api db:migrate:local`. Depends on T003.
- [ ] T005 Extend the engine's types in `apps/api/src/consta/index.ts` exactly as [contracts/engine.md](./contracts/engine.md) lists: `ConstaBeneficiary` widened to the three shapes; the transfer variant's `trackingKey` optional beside an optional `referenceNumber`; the receipt variant carries `beneficiary` and an optional `receivingAccounts` (entries may carry `retired: true`); `ConstaVerdict` gains `beneficiaryUsed`, `cep.beneficiaryAccount`/`beneficiaryAccountType`, `accepted` with both keys, `disputedFields` with `referenceNumber`; `ConstaReading` gains `referenceNumber`, `destination`, `gate.referenceNumber` (with `generic`), `ask`, `tiedAccount`; `extract`'s input gains `receivingAccounts`. Fix every compile error in callers (`direct-payments/validation.ts`, `credit/topups.ts`, `routes/direct-payments/handler.ts`) with the narrowest change that keeps today's behaviour — e.g. `trackingKey: payment.trackingKey ?? ""` stays until US1 changes it. Comment each new field with its decision (D1, D9, D11, D13, D15, D22, D24, D30).
- [ ] T006 In `apps/api/src/consta/failure.ts`, add `RECEIPT_WRONG_DESTINATION` to `ConstaErrorCode` with a comment (receipt-triage D15, D24: a clear capture whose destination fits none of the ISP's registered accounts, current or retired; nothing billed). Leave `RECEIPT_INCOMPLETE`'s comment for T030, which throws it again.
- [ ] T007 Extend the reader in `apps/api/src/consta/extraction/reader.ts`: `FIELDS` gains `"referenciaNumerica": "<the value of the 'Referencia' or 'Referencia numérica' field, digits only, exactly as printed including leading zeros, or null>"` and `"destino": {"tipo": "<clabe | tarjeta | celular | cuenta, or null>", "digitos": "<the digits of the destination account you can see, without asterisks or dots, or null>"}`; `RULES` gains: a reference is at most seven digits, and a "Folio", "Número de autorización", "Clave de rastreo" or account number is not a reference. Nothing else is asked of the reader (spec Out of Scope, 2026-09-24). `Reading` gains `referenceNumber: string | null` and `destination: { kind: "clabe" | "card" | "phone" | "account" | null; digits: string | null }`, parsed with the existing `str` helper (Spanish `tipo` mapped to the English kind; anything else null). Both prompts share `FIELDS`. The legibility rules stay word for word (D16). Comment with D12 and D24.
- [ ] T008 Extend the gate in `apps/api/src/consta/extraction/gate.ts`: `Gate` gains `referenceNumber: "ok" | "malformed" | "generic" | "missing"` — `ok` iff `/^\d{1,7}$/` on the trimmed value, never cast (D12); `generic` when that value is a single digit repeated ("0", "0000", "1111111") or a run of consecutive digits ("123", "1234567", "7654321"), via one exported, pure `isGenericReference` in `apps/api/src/routes/direct-payments/schema.ts` that the gate, the pay schema and the page share (D2). `GatedReading` gains `referenceNumber: string | null` (only when `ok`); `passes` becomes (`trackingKey === "ok"` or `referenceNumber === "ok"`) and `senderBank === "ok"` and `amount === "ok"` (D11). Update `apps/api/src/consta/extract.ts` so the reading it returns carries `referenceNumber` and `gate.referenceNumber` (other new `ConstaReading` fields stay `null` until their story).
- [ ] T009 [P] Extend the test helpers in `apps/api/test/consta/helpers.ts`: `StubbedReading` gains `referenciaNumerica?: string | null` and `destino?: { tipo?: string | null; digitos?: string | null } | null`; add `RECEIPT_1_READING` (Banorte summary: `claveDeRastreo: null`, `referenciaNumerica: null`, `banco: "BANORTE"`, `monto: 300`, `fecha: "2026-09-09"`, `legibilidad: "completa"`, `destino: { tipo: "clabe", digitos: "8195" }`) and `RECEIPT_2_READING` (Azteca: `claveDeRastreo: null`, `referenciaNumerica: "038195"`, `banco: "AZTECA"`, `monto: 350`, `fecha: "2026-09-09"`, `destino: { tipo: null, digitos: "195" }`). `GOOD_READING` is unchanged. Comment: the answers mirror the receipts the product creator brought on 2026-09-23.
- [ ] T010 [P] Teach the sandbox `apps/api/sandbox/apicep-mock.mjs`: a direct-mode body with `sender.referenceNumber` and no `trackingKey` answers `valid` with `cepDetails.trackingKey` and `cepDetails.beneficiaryAccount`; reference `9999999` answers HTTP 422 with the published "referencia duplicada … requiere clave de rastreo" error; bodies with `beneficiary.cardNumber` or `beneficiary.phoneNumber` are accepted like a CLABE. Update the header's scenario table.
- [ ] T011 [P] Rewrite the `AI` comment in `apps/api/src/env.ts`: unset → no reading of ours, so no ask, no reference and no tied account from our side; the file goes to the provider named with the cuenta de cobro, and the provider's own reference, when it reads one, still counts (constitution VIII; D15, D22).
- [ ] T012 [P] Create `apps/pago/src/features/pago/bank-hints.ts`: `type BankHint = { where: string; source: string; verified: string }` and `export const BANK_HINTS: Partial<Record<Bank, BankHint>>` keyed by the `Bank` type from `@devolada/api/direct-payments-schema`, with one entry — `BANORTE`: where "toca «Ver más detalles» y captura esa pantalla", source "receipt 1, receipt-triage spec", verified "2026-09-23" — and a header comment: an entry is added only from a real receipt or the bank's own documentation, read by a person (D19). Export `GENERAL_HINT` ("Abre el detalle de la transferencia en tu app y captura la pantalla donde aparecen estos datos."). Used by US2 and US4.
- [ ] T013 The review hold's plumbing (plan D31, [contracts/review.md](./contracts/review.md)), in `apps/api/src/direct-payments/validation.ts` and the readers T002 listed: one helper `holdForReview(update, reason)` writes `status: "confirmed"`, `actionOutcome: "review"`, `reviewReason`; `announcingWriter` announces nothing for a row whose `actionOutcome` is `review`; the reconnection queue (`apps/api/src/reconnection/queue.ts`) never takes it; every other reader T002 found that settles on `confirmed` (the link's paid state, provisional release) skips it. Each skip commented with D31. Tests in `apps/api/test/direct-payment.test.ts` (`receipt-triage US3`): a held row is not queued, not announced, and not counted as paid.
- [ ] T014 The review decision route: `apps/api/src/routes/payments/schema.ts` gains `reviewDecisionRequest` (`{ decision: "accept" | "reject" }`) exported through the package's existing `payments` export; `apps/api/src/routes/payments/index.ts` adds `POST /:id/review` behind `requireSession` and `requireArea("payments", "operate")`, pure wiring; `apps/api/src/routes/payments/handler.ts` gains `reviewDecision`: tenant-scoped, `NOT_REVIEWABLE` (409) unless `actionOutcome = "review"`; `accept` → `actionOutcome: "queued"` and the verdict is announced; `reject` → `status: "invalid"`, `lastError: "REJECTED_BY_BUSINESS"`, `actionOutcome: null`, announced; both write `reviewedBy`, `reviewedAt`. Tests in `apps/api/test/payments.test.ts` (new — first find where `execute-action` is tested today and follow that file's setup) (`receipt-triage US3`): accept, reject, 409 on a normal row, 403 for a role without `payments/operate`, another business's row is not found.
- [ ] T015 [P] The held row in the panel's payments feed (`apps/admin/src/features/feed/`): the existing `StatusBadge` pattern (icon + text) "En revisión"; for `retired_account`, "Pagó a tu {tipo} ••••{últimos 4}, que ya no está registrada. Banxico confirmó la transferencia."; for `no_clave`, "Banxico confirmó la transferencia sin clave de rastreo; revisa que no la hayas cobrado ya."; buttons "Aceptar pago" and "Rechazar" at the compact 40px size calling T014's route through TanStack Query. The feed schema carries `reviewReason` (update its fixtures). Tests in the panel's payments test (`receipt-triage US3`): both reasons render, both buttons call the route, axe clean.
- [ ] T016 Measure the reader with the new prompt (quickstart Step 0, research R2, R14), after T007: with `pnpm --filter @devolada/api dev` and a dev link, upload receipt 1 and receipt 2 — the product creator's images, uploaded in session on 2026-09-23; never committed — and any other captures supplied, call `/read`, and record per receipt `claveDeRastreo`, `referenciaNumerica`, `destino`, `legibilidad`. Write the dated table into the header comment of `apps/api/src/consta/extraction/reader.ts`. If the reader takes a folio for a reference or misreads destination digits, tighten the prompt and measure again. If this environment cannot reach the binding, write "not run — reason" in the header and in this task's notes, and register it with `/speckit-debt-log` before the feature is called done.

**Checkpoint**: the columns exist, the types compile, the reader and the gate
speak reference and destination, the helpers and the sandbox answer both, the
hints exist, a held row can be decided, and every existing test still passes.

---

## Phase 3: User Story 1 — The referencia numérica finds the transfer when the clave is missing (P1) 🎯 MVP

**Goal**: the reference is read, compared, stored and sent whenever there is
no clave; a payer can type it, reference first; Banxico's clave is adopted
onto a row found by reference, and a confirmation with no clave is guarded;
an ambiguous, generic or shared reference asks for the clave.

**Independent Test**: [quickstart § User Story 1](./quickstart.md#user-story-1--the-referencia-numérica).

### Tests for User Story 1

- [ ] T017 [P] [US1] Pure comparison tests in `apps/api/test/consta/validate.test.ts`, in a `describe("receipt-triage US1: the reference as a key")` beside the existing `compareReadings` block: no clave on either side and equal references → `agreed` with `accepted.referenceNumber` set and `accepted.trackingKey` null; different references → `disputed` with `["referenceNumber"]`, the shape rules never consulted; one side with no reference → `blind` on that side; a clave on either side → today's result with the reference riding along; `"038195"` and `"38195"` never agree; claves that disagree with no shape tiebreak, the amount agreed, both sides reading `038195` → `disputed` with `[]` and `accepted: { trackingKey: null, referenceNumber: "038195" }`; the same with one side's reference only, or the amount also disputed → today's dispute (D13); **neither side read a key** → `disputedFields` is `["trackingKey", "referenceNumber"]` plus `"amount"` only when no reading has an amount — no longer the fixed `["trackingKey", "amount"]` (the post-credit ask aligned, spec FR-004/FR-005).
- [ ] T018 [US1] Gate tests in `apps/api/test/consta/validate.test.ts` (`receipt-triage US1`): `"038195"` → `ok` and kept as `"038195"`; `"0082918812"` → `malformed` and never on the request; `"0"`, `"0000"`, `"1234567"`, `"7654321"` → `generic` and never a key; a reading with a non-generic reference and no clave `passes`; `isGenericReference` pure cases.
- [ ] T019 [P] [US1] Lifecycle tests in `apps/api/test/direct-payment.test.ts` (`receipt-triage US1`), against the intercepted provider: (a) a typed submission with only `referenceNumber` is accepted and the provider body carries `sender.referenceNumber` and no `trackingKey`; (b) with both keys, only `trackingKey` travels, first attempt and every retry after `not_found` (D1); (c) a row whose disputed clave fell back to the reference takes the transfer door with the reference, asks nothing, adopts Banxico's clave on `valid`, and on `not_found` writes `disputed_fields = ["trackingKey", "referenceNumber"]` while the next slot still searches with the reference (D13); (d) `RECEIPT_2_READING` whose provider reading agrees on `038195` takes the transfer door with the reference on the next slot (SC-002); (e) Banxico confirms by reference → the row carries the CEP's clave; a second submission whose search returns that clave ends `invalid` with `TRANSFER_ALREADY_USED`, never `confirmed` (D14, FR-006); (f) the provider answers 422 → `disputed_fields = ["trackingKey"]`, `last_error = "REFERENCE_AMBIGUOUS"`, and the next slot makes **no** provider request (D17, SC-005); a correction with a clave supersedes it; (g) a typed generic reference with no clave is a `VALIDATION_ERROR`; (h) another link's payment with the same reference, date, bank, amount and account → the typed submission is refused `REFERENCE_SHARED` with nothing created, and a receipt-door row in that state makes no provider call (D7); the same link's own earlier row never matches; (i) the missing-clave guard (FR-006): a `valid` CEP with no `trackingKey` and `cepPreviouslyValidated: false` and no confirmed twin confirms with `tracking_key` NULL and logs "unexpected"; with `true`, or a confirmed twin with the same five data — on another link **or the same one** — → `invalid`, `TRANSFER_ALREADY_USED`; with `null` → held, `review_reason = "no_clave"`.

### Implementation for User Story 1

- [ ] T020 [US1] Comparison in `apps/api/src/consta/extraction/compare.ts`: `ProviderReading` gains `referenceNumber`; `DisputedField` gains `"referenceNumber"`; the key is the clave when either side read one, the reference otherwise (D13), with the one fallback to an agreed, gated reference when a disputed clave is the only field in doubt and the shape rules settle nothing; equal as text agrees, different disputes on `referenceNumber`, one side missing is blind; the shape rules are never called for a reference; `accepted` carries `trackingKey | null` and `referenceNumber | null`, ours first. The "neither read a key" branch and `missingOf` ask for `["trackingKey", "referenceNumber"]` and `"amount"` only when missing. Update the header comment. Makes T017 pass.
- [ ] T021 [US1] Engine in `apps/api/src/consta/validate.ts` and `apps/api/src/consta/extract.ts`, **including `recentReading` (plan D28, research R18)**: rebuild `referenceNumber` from `extractions.reference_number` with its gate re-derived by the gate's own function, `passes` with either key, and admit `key_missing` and `wrong_destination` in the outcome filter. Feed the adapter's `reading.referenceNumber` into the comparison as the provider's; on the transfer door pass `referenceNumber` through; `recordExtraction` writes `reference_number` (ours, as read) and `provider_reference_number` (D21); `ourReading` carries `referenceNumber`. Test (`receipt-triage US1`) in `apps/api/test/consta/validate.test.ts`: `/read` of `RECEIPT_2_READING` then pay with the same file inside the window → one reader call in total, the reused reading carries `038195`, no ask, one provider call. Makes T018 pass.
- [ ] T022 [US1] Rewrite the 422 comment in `apps/api/src/consta/provider/apicep.ts` ("Devolada cannot hit it (it always sends the key)") — it can now; the provider's text is "referencia duplicada en Banxico (requiere clave de rastreo)", and receipt-triage D17 is what the caller does with it.
- [ ] T023 [US1] Lifecycle in `apps/api/src/direct-payments/validation.ts`: the `accepted` test becomes (clave **or** reference) and bank and amount and date (D11); the transfer request sends `trackingKey` when set, else `referenceNumber` — never both (D1); a classification's `accepted.referenceNumber` is written to `payments.reference_number`; `adoptKey` also covers a row with a reference and no clave, whatever its `proof_mode` (D14); a `valid` CEP with no clave runs the FR-006 guard (replay flag + `sharedReference` over *confirmed* rows; `null` flag → `holdForReview("no_clave")` from T013; log "unexpected: CEP without clave"); in the engine-failure catch, `hint === "provide_tracking_key"` writes `disputedFields: ["trackingKey"]` and `lastError: "REFERENCE_AMBIGUOUS"`; before calling the engine, a row with `lastError` `REFERENCE_AMBIGUOUS` or `REFERENCE_SHARED` and no clave rides the next slot without a call (D17, D7). Add `sharedReference(db, business, link, { reference, date, senderBank, amountCents, account }, { confirmedOnly?, includeSameLink? })` here — not `superseded`, same five data, another link by default; the FR-006 guard calls it with `{ confirmedOnly: true, includeSameLink: true }`, because "no other confirmed payment of the business" includes the payer's own earlier one (analyze 2026-09-24, I1). Each rule commented with its decision. Makes T019 (a)–(f), (h), (i) pass.
- [ ] T024 [US1] Contracts in `apps/api/src/routes/direct-payments/schema.ts` as [contracts/payment-page.md](./contracts/payment-page.md) lists for US1: `payRequest.transfer.trackingKey` optional, `referenceNumber` (`^\d{1,7}$`) optional, at least one, and a generic reference needs a clave (`isGenericReference`); `proofReadingResponse` gains `referenceNumber` and `gate.referenceNumber`; `directPaymentStatusResponse` gains `referenceNumber`, `"referenceNumber"` in `disputedFields`, and `inReview`; `publicPaymentError` gains `REFERENCE_AMBIGUOUS` and `REFERENCE_SHARED`. Update the fixtures validated against these schemas in the same task — `apps/pago/test/msw.ts` and `tests/e2e/stubs.ts`.
- [ ] T025 [US1] Handlers in `apps/api/src/routes/direct-payments/handler.ts`: `submitPayment` stores `transfer.referenceNumber`, and refuses typed data with `REFERENCE_SHARED` when `sharedReference` matches and no clave rides beside it (nothing created); `readProof` returns `referenceNumber`, `gate.referenceNumber`, and reports `ask.shared` when the reading's reference matches; `getDirectPaymentStatus` returns `referenceNumber`, `inReview` (`actionOutcome === "review"`), and maps `REFERENCE_AMBIGUOUS` / `REFERENCE_SHARED` to `error`. Makes T019 (g), (h) pass.
- [ ] T026 [US1] Page in `apps/pago/src/features/pago/PaymentPage.tsx`, `TransferForm` (FR-005): "Número de referencia" first (`inputMode="numeric"`, digits only, leading zeros kept, "Hasta 7 dígitos, con los ceros del inicio."), then "¿No tienes número de referencia? Escribe tu clave de rastreo" and the "Clave de rastreo" field, "Con uno basta."; a reference `isGenericReference` matches shows "Esta referencia la usan muchas transferencias. Escribe tu clave de rastreo para encontrar la tuya." and makes the clave required; a `REFERENCE_SHARED` answer shows the same line; the form never asks for an account. Later asks: "Confirma tu número de referencia mirando tu comprobante." (disputed reference); `REFERENCE_AMBIGUOUS` → "Tu número de referencia coincide con más de una transferencia. Escribe tu clave de rastreo para encontrar la tuya." with the clave only; both keys disputed → "No encontramos tu transferencia todavía. Confirma tu clave de rastreo o tu número de referencia mirando tu comprobante; con uno basta." with both fields, reference first; `inReview` → the info `Alert` "Tu pago está en revisión con {ispName}. Te avisaremos aquí cuando lo confirme." Comments cite D1, D2, D7, D13, D17, D31.
- [ ] T027 [P] [US1] Page tests in `apps/pago/test/pago.test.tsx` (`receipt-triage US1`): the reference field comes first; a reference alone submits; both empty refused; `038195` kept as typed; `1234567` alone blocked with its line; `REFERENCE_SHARED` shows the line and requires the clave; each later-ask sentence renders for its status fixture; `inReview` renders the review message and no success state; axe clean on each.

**Checkpoint**: receipt 2 confirms with no question; a payer can type a
reference first; one transfer still pays once, with or without Banxico's
clave; ambiguous, generic and shared references ask for the clave and cost
no second call.

---

## Phase 4: User Story 2 — The payer is told exactly what is missing, and how to fix it (P2)

**Goal**: a clear capture with neither key — a generic reference counting as
none — is asked about before any credit, with the message and the ways
forward D5 designs; later asks follow the same pattern.

**Independent Test**: [quickstart § User Story 2](./quickstart.md#user-story-2--the-missing-data-feedback).

### Implementation for User Story 2

- [ ] T028 [US2] Create `apps/api/src/consta/extraction/ask.ts` with `askBeforeCredit(extracted, accounts)` — the `no_key` branch of [data-model.md § The ask](./data-model.md#the-ask-no-storage-beyond-the-outcome): not a reader reading, not a receipt, or not clear (`legibility === "full"` on a picture, or a PDF's text — D16) → `null`; a clave not `missing`, or a reference neither `missing` nor `generic` → `null`; otherwise `{ reason: "no_key", fields }` with `"key"` first, then `amount`, `date`, `senderBank` the reading lacks — never `account`. Leave a typed hook for `wrong_destination` that returns nothing until T041. Export it from `apps/api/src/consta/extraction/index.ts`. In `apps/api/src/consta/failure.ts`, rewrite `RECEIPT_INCOMPLETE`'s comment: thrown again, for one case (D4, D15).
- [ ] T029 [US2] Engine and lifecycle tests (`receipt-triage US2`) in `apps/api/test/consta/validate.test.ts` and `apps/api/test/direct-payment.test.ts`: `RECEIPT_1_READING` → `ask: { reason: "no_key", fields: ["key"] }`, the receipt door throws `RECEIPT_INCOMPLETE`, **no request reaches the intercepted provider**, outcome `key_missing`, `proof_key` set; with `fecha: null` → `["key", "date"]`; a clear capture whose only key is `referenciaNumerica: "1234567"` → asked; `legibilidad: "parcial"`, no `legibilidad`, or a malformed clave → no ask and one provider call, as today; `RECEIPT_2_READING` → no ask; a text PDF with neither key → asked; no `AI` binding → `ask: null` and one provider call (FR-015); a payment that skipped the page rides `retryLater("RECEIPT_INCOMPLETE")` with nothing billed; a platform top-up whose reading has neither key rides its schedule with no provider request, in `apps/api/test/topups-pause.test.ts`.
- [ ] T030 [US2] Enforce and report the ask. In `apps/api/src/consta/extract.ts`: compute `ask` on every reading, record outcome `key_missing` for `no_key`, write `proof_key` on every row (D21). In `apps/api/src/consta/validate.ts`: after reading (or reusing the draft's reading), when `askBeforeCredit` is not null, record the reading and throw `RECEIPT_INCOMPLETE` with `extra.reading` and `missingFields` before the provider call; rewrite the D2/D3 comment block to name the one case D4 narrows. Then rewrite, in both test files, the tests T002 listed to assert the ask instead of a provider call, each cited `receipt-triage US2`. Makes T029 pass.
- [ ] T031 [US2] Contract and handler: `proofReadingResponse` in `apps/api/src/routes/direct-payments/schema.ts` gains `ask` (the `no_key` variant with optional `shared`; `wrong_destination` joins in T043) and `readProof` in `apps/api/src/routes/direct-payments/handler.ts` returns it; rewrite the `/read` header comment ("this endpoint cannot reject anybody" stays true — it reports; D15). Update `apps/pago/test/msw.ts` and `tests/e2e/stubs.ts` with `ask: null`, and add a `keylessReading` fixture beside `proofReading`.
- [ ] T032 [US2] The ask on the page, in `apps/pago/src/features/pago/PaymentPage.tsx`, as [contracts/payment-page.md § The ask](./contracts/payment-page.md#the-ask-at-the-upload-story-2-d5-d18) specifies: rendered from `reading.ask` in the existing warning `Alert` at the top of the step (already `role="status"`), focused on arrival (`tabIndex={-1}`, `focus()`); three sentences — the key (the generic or shared form when the reading's reference is one); the other missing fields only; the hint from `BANK_HINTS[reading.senderBank]` or `GENERAL_HINT` — and two buttons at the touch size, "Subir otra captura" (focus to the picker) and "Escribir los datos" (opens `TransferForm` pre-filled, "No aparece en tu captura" under each field the capture lacked, ending with "Mejor subo otra captura"). Count `no_key` asks in this visit; at two, render the form first with "Tu captura tampoco muestra la clave de rastreo ni el número de referencia. Escribe los datos de tu transferencia." (page state, D18 — say so in a comment). The later asks gain "En {banco}: {dónde}" when a key is asked for and `status.senderBank` has a hint (D6).
- [ ] T033 [P] [US2] Page tests in `apps/pago/test/pago.test.tsx` (`receipt-triage US2`): the `Alert` names the key and only the other missing fields, never an account; the generic and shared first sentences; Banorte's hint for `senderBank: "BANORTE"`, the general one otherwise; focus on the message; "Escribir los datos" opens the form pre-filled; a second keyless reading renders the form first; a reference-only reading goes on to pay with no ask; the later ask shows the hint line; axe clean on every state.

**Checkpoint**: receipt 1 costs nothing and the payer knows what to do; every
other outcome, blur included, is unchanged.

---

## Phase 5: User Story 3 — An ISP chooses the account it is paid at: CLABE, debit card or phone (P2)

**Goal**: the owner registers up to three accounts and chooses the cuenta de
cobro; the page shows only it; the receipt's last three or four digits name
the account checked, retired ones included; a clear receipt to no account of
the ISP is discarded kindly and for free; a confirmation to a retired
account waits for the ISP; the CLABE is no longer required.

**Independent Test**: [quickstart § User Story 3](./quickstart.md#user-story-3--the-cuenta-de-cobro-re-planned-2026-09-24).

### Tests for User Story 3

- [ ] T034 [P] [US3] Pure tests for `tieDestination` in `apps/api/test/consta/validate.test.ts` (`receipt-triage US3`), with the CLABE `012180001234538195` (account segment, positions 7–17, `00123453819`), a card ending `1234`, a phone ending `5678` and a retired card ending `4321`: `clabe`/`8195` → the CLABE; `null`/`195` (receipt 2, three digits) → the CLABE; `account`/`3819` (receipt 3) → the CLABE by its segment; `tarjeta`/`3819` → the CLABE, never `"none"` (kind only orders, D24); `card`/`1234` → the card; `4321` → the retired card, flagged `retired`; `12345678` compares only the last four; two digits → `"unknown"`; digits ending two accounts → `"unknown"`; `9999` → `"none"`.
- [ ] T035 [P] [US3] Settings tests in `apps/api/test/settings.test.ts` (`receipt-triage US3`): the owner saves a Luhn-valid card and a 10-digit phone, each with its bank, and sets `speiCollectKind`; a failing check digit, 15 or 17 digits, a 9-digit phone, a number without its bank, a bank outside the vocabulary → `VALIDATION_ERROR`; choosing an unregistered kind, or clearing the cuenta de cobro → `VALIDATION_ERROR`; an ISP with only a card as cuenta de cobro is `configured` (D32); a CLABE-only business with NULL `spei_collect_kind` reads `collectKind: "clabe"` and today's `configured`; changing or clearing a number appends the old one to `spei_retired_accounts`, and setting it again removes it (D30); an admin gets `FORBIDDEN_FOR_ROLE` on any of these fields; an operator reads the numbers masked.
- [ ] T036 [US3] Engine and lifecycle tests in `apps/api/test/consta/validate.test.ts` and `apps/api/test/direct-payment.test.ts` (`receipt-triage US3`): the provider body always carries exactly one `beneficiary`, never `potentialBeneficiaries`; a destination ending the cuenta de cobro names it; one ending the non-cobro card names the card and `beneficiaryUsed` is the card; unknown (two digits) names the cuenta de cobro; a clear `9999` throws `RECEIPT_WRONG_DESTINATION` with no provider request and outcome `wrong_destination`; a destination ending a retired card names it, and on `valid` the row is held (`review_reason = "retired_account"`), not queued, not announced; on `valid`, `cepDetails.beneficiaryAccount` tied to the snapshot overwrites `beneficiary`, and a whole account that fits none ends `TRANSFER_CONTRADICTED` (D22); `beneficiary` and `registered_accounts` are snapshotted at submission and a later attempt uses them after the ISP changed its card (FR-021); a typed submission is checked against the cuenta de cobro and carries no account; an ISP collecting at its CLABE gets exactly today's request body (SC-008); a payment born before this feature (both columns NULL) whose reading has no key and a destination matching nothing still makes today's provider call — no ask, no tie (FR-027, D27); a platform top-up whose clear receipt went to another account is stopped before any credit (spec Edge Cases), in `apps/api/test/topups-pause.test.ts`.

### Implementation for User Story 3

- [ ] T037 [P] [US3] Create `apps/api/src/consta/extraction/destination.ts` with `tieDestination(destination, accounts)` exactly as [data-model.md](./data-model.md#the-ask-no-storage-beyond-the-outcome) defines it — digits only; the last four (three when only three are visible); fewer than three → `"unknown"`; forms per account (CLABE whole and its 11-digit segment, positions 7–17; card; phone), retired ones included and returned with `retired`; `destination.kind` only ordering the search; exactly one → `{ tied }`, more → `"unknown"`, none → `"none"` — pure, commented with D24 and D30, exported from `apps/api/src/consta/extraction/index.ts`. Makes T034 pass.
- [ ] T038 [US3] One helper `collectAccount(business)` and `registeredAccounts(business)` in `apps/api/src/direct-payments/accounts.ts` (new): the cuenta de cobro (`speiCollectKind ?? "clabe"`) as a `ConstaBeneficiary`, and the current + retired accounts as a snapshot. Replace every `speiClabe!` beneficiary read in `apps/api/src/routes/direct-payments/handler.ts` and `apps/api/src/direct-payments/validation.ts` with it, keeping the legacy fallback (a row with no `beneficiary`) on the CLABE; `speiBankIsKnown` reads the cuenta de cobro's bank (D32). Comment with D29, D32.
- [ ] T039 [US3] Settings in `apps/api/src/routes/settings/schema.ts` and `apps/api/src/routes/settings/handler.ts` as [contracts/settings.md](./contracts/settings.md) specifies: `settingsResponse.spei` gains `card`, `cardBank`, `phone`, `phoneBank` (masked for roles that cannot update settings) and `collectKind`; `settingsPatchRequest` gains the four nullable fields with a Luhn `refine` and `speiCollectKind`; the handler checks number-and-bank pairs and the cuenta de cobro against the merged row, appends changed or cleared numbers to `spei_retired_accounts` in the same write (and removes one set again), requires the `clabe` area for any of them, and computes `configured` from the cuenta de cobro (D26, D29, D30, D32); rewrite the `configured` comment. Update every fixture typed against `settingsResponse` in `tests/e2e/stubs.ts` and `apps/admin/test/settings.test.tsx`. Makes T035 pass.
- [ ] T040 [US3] Engine in `apps/api/src/consta/validate.ts` and `apps/api/src/consta/extract.ts` (D22, D24, D28, D30): the receipt door runs `tieDestination` against `receivingAccounts` (or `[beneficiary]`); tied → the provider call names that account, retired included; otherwise `beneficiary`; the verdict reports `beneficiaryUsed` (with `retired`); `extract` accepts `receivingAccounts` and returns `destination` and `tiedAccount`; `recentReading` also rebuilds `destination` from `destination_kind`/`destination_digits`; `recordExtraction` writes those two, never the ISP's accounts. The `legacy` flag (D27) skips the ask and the tie. In `apps/api/src/consta/provider/apicep.ts` keep `beneficiaryAccount` and `beneficiaryAccountType` from `cepDetails` on `cep`.
- [ ] T041 [US3] Complete `askBeforeCredit` in `apps/api/src/consta/extraction/ask.ts`: a clear reading whose destination is `"none"` → `{ reason: "wrong_destination" }` (before the key check). The receipt door throws `RECEIPT_WRONG_DESTINATION` and `extract` records outcome `wrong_destination` (D15).
- [ ] T042 [US3] Lifecycle in `apps/api/src/direct-payments/validation.ts` (D22, D25, D27, D30, D31): the beneficiary comes from the payment — `beneficiary` if set, else (both columns NULL) today's fallback with `legacy: true`; receipt-door requests carry `registered_accounts` as `receivingAccounts`; a verdict's `beneficiaryUsed` is written to `payments.beneficiary`; on `valid`, `cep.beneficiaryAccount` tied to the snapshot overwrites it, and a whole account that fits none ends `invalid` with `TRANSFER_CONTRADICTED`; a `valid` whose `beneficiary` is retired calls `holdForReview("retired_account")`. Rewrite the comment above the beneficiary it replaces. Makes T036 pass with T040, T041.
- [ ] T043 [US3] Contracts and handlers, as [contracts/payment-page.md](./contracts/payment-page.md) lists for US3: in `apps/api/src/routes/direct-payments/schema.ts` — `linkStatusResponse` gains `collectAccount`; `proofReadingResponse.ask` becomes the discriminated union with `wrong_destination`, and gains `destinationSeen`; `payRequest.transfer` has no account field. In `apps/api/src/routes/direct-payments/handler.ts` — both branches of `getLinkStatus` set `collectAccount` (and `speiClabe`/`speiBank` only when it is the CLABE); `readProof` passes `registeredAccounts(business)` to `extract` and returns `destinationSeen`, never the digits or `tiedAccount`; `submitPayment` snapshots `beneficiary` (the cuenta de cobro, or the draft reading's tied account) and `registered_accounts` (D30). Update `apps/pago/test/msw.ts` and `tests/e2e/stubs.ts`.
- [ ] T044 [US3] Panel in `apps/admin/src/features/settings/SettingsScreen.tsx`: the section "Cuentas para recibir pagos" — "CLABE", "Tarjeta de débito" and "Celular para transferencias", each optional with the bank `Combobox`, and the radio group "¿Dónde quieres que te paguen tus clientes?" over the registered accounts ("CLABE ••••8195"), with the help texts and inline errors of [contracts/settings.md § Screen](./contracts/settings.md#screen); compact 40px controls, tokens only; non-owners see them as they see the CLABE. Tests in `apps/admin/test/settings.test.tsx` (`receipt-triage US3`): save, clear, choose, each inline error, "No puedes borrar la cuenta donde te pagan", the owner-only gate, axe clean.
- [ ] T045 [US3] Page in `apps/pago/src/features/pago/PaymentPage.tsx`: the transfer step shows `collectAccount` in the existing `CopyField`, labelled "CLABE", "Tarjeta de débito" or "Celular" with its bank — one account, no list, no choice; a CLABE renders exactly as today. The `wrong_destination` ask renders in the same `Alert`: "Parece que esta transferencia se hizo a otra cuenta, no a la de {ispName}. {ispName} recibe pagos en {tipo} terminada en {últimos 4}. Si leímos mal tu comprobante, sube otra captura o escribe tus datos." with the same two buttons. Tests in `apps/pago/test/pago.test.tsx` (`receipt-triage US3`): card and phone as cuenta de cobro, a CLABE unchanged, the `wrong_destination` message, axe clean.

**Checkpoint**: an ISP collects at the one account it chose, with no CLABE
required; a payer sees one number; a payment to another registered account
is checked there; a removed one waits for the ISP.

---

## Phase 6: User Story 4 — The payer sees what a good capture shows before taking it (P3)

**Goal**: a compact guide in two moments — one line before the payer leaves
for the bank, a four-item checklist at the upload that becomes the answer
after the reading.

**Independent Test**: [quickstart § User Story 4](./quickstart.md#user-story-4--the-capture-guide).

- [ ] T046 [P] [US4] Create `apps/pago/src/features/pago/CaptureGuide.tsx` as [contracts/payment-page.md § The capture guide](./contracts/payment-page.md) specifies (D8, D20, redesigned 2026-09-25): a section on the well surface titled "Tu captura debe mostrar" with the inline SVG receipt in token classes (`aria-hidden`) beside an ordered list of four items — marker, name, one precise line; the account line built from `collectAccount` ("{Tipo} que termina en {últimos 4}") — one line of rules with a camera icon, and the existing `Collapsible` "¿Dónde lo encuentro en mi banco?" listing `BANK_HINTS`. Props `state: "idle" | "reading" | { reading }`: `reading` puts `data-motion="breath"` on each marker and a "Revisando…" word; a result turns the title into "Lo que vimos en tu captura" and each item into check + "Se ve" or open circle + "No se ve" with its fix line, each swap inside `Reveal`. Key = `trackingKey` or a non-generic `referenceNumber`; amount; date; account = `destinationSeen` and not `wrong_destination`. Tokens only, opacity-only motion, no new token.
- [ ] T047 [US4] Place the guide in `apps/pago/src/features/pago/PaymentPage.tsx`: on the transfer step, the note under the account ("Al terminar, toma captura del detalle" / "Ahí aparecen la clave de rastreo o el número de referencia que necesitamos."); on "Envía tu comprobante", the file row's "Leyendo tu captura…" with `data-motion="breath"` while `/read` runs, `CaptureGuide` fed the state, and the ask `Alert` with `animate-enter`; nothing that needs a tap in front of the upload (FR-026). Comment with D8.
- [ ] T048 [P] [US4] Page tests in `apps/pago/test/pago.test.tsx` (`receipt-triage US4`): the transfer-step note; the four items with their lines and the account's last four; the tips open in one tap and list Banorte; while `/read` is pending the items carry `data-motion="breath"` and "Revisando…"; after `keylessReading` the title reads "Lo que vimos en tu captura", the key item "No se ve" with its fix line and the amount "Se ve"; the ask carries the enter animation; the upload control is reachable with no other interaction; axe clean.
- [ ] T049 [US4] Browser test in `tests/e2e/pago.spec.ts` (`receipt-triage US4`): on the upload step, no horizontal scroll at 360, 768 and 1280px; contrast in light and dark; under `prefers-reduced-motion: reduce` the breath's computed `animation-duration` is still `--duration-breath` and no element of the guide has a transform; the upload control reachable by keyboard with a visible, measured focus indicator. Run with `pnpm e2e -- tests/e2e/pago.spec.ts`.

**Checkpoint**: the payer is told what to capture before leaving for the
bank, and sees at a glance what their capture showed.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T050 Comment sweep across the files this feature touched: every comment listed under "Decision citations" is rewritten; every new rule cites `receipt-triage D<n>`; no new code cites D23. `grep -rn "RECEIPT_INCOMPLETE\|cannot hit\|speiClabe!\|potentialBeneficiaries" apps/api/src` and read each hit.
- [ ] T051 [P] Confirm the dated note in `specs/005-two-eyes-receipt/spec.md` still names the decisions this implementation uses (receipt-triage D4, D16), and amend it with a date if any number moved.
- [ ] T052 Run every gate in CI order (as T001) and record the new counts beside T001's; `node scripts/spec-lint.mjs` must list no new file without a citation.
- [ ] T053 By hand, per [quickstart.md](./quickstart.md): upload receipt 1 and receipt 2 to the seeded link at 360px and read the screen; register a card, make it the cuenta de cobro and see only it on the link; after the first real confirmation by reference on dev, read the row — `tracking_key` holds Banxico's clave (FR-006); run every query of [quickstart § The numbers](./quickstart.md#the-numbers-fr-028) against the dev database and confirm each answers without new instrumentation (FR-028); record what was seen, dated, in this task's notes.
- [ ] T054 Run `/speckit-analyze` on spec, plan and tasks; fold its findings back with dated notes; the feature is done only with no CRITICAL finding (constitution, Development Workflow).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T002)**: no dependencies.
- **Foundational (T003–T016)**: after Setup. T004 after T003; T008 after T007; T013 after T003 and T002; T014 after T013; T015 after T014; T016 after T007. T009–T012 parallel with each other and with T005–T008. **Blocks every story.**
- **US1 (T017–T027)**: after Foundational.
- **US2 (T028–T033)**: after Foundational. Its rule reads the gate's verdicts (T008), so a reference-only receipt is never stopped even if US2 ships before US1.
- **US3 (T034–T045)**: after Foundational; independent of US1 and US2. T041 extends the `ask.ts` T028 creates — if US3 comes first, T041 creates the file with `wrong_destination` only and T028 adds `no_key`.
- **US4 (T046–T049)**: after Foundational (hints, T012). Its "Cuenta" item reads `destinationSeen` (T043); built before US3, the item shows the neutral state until then.
- **Polish (T050–T054)**: after the stories that ship.

### Within each story

Tests first and failing; pure modules before the engine; the engine before
the lifecycle; contracts and handlers before the page; each story ends at its
checkpoint with every existing test still green.

### Shared files

`apps/api/src/consta/validate.ts`, `consta/extract.ts`,
`direct-payments/validation.ts`, `routes/direct-payments/{schema,handler}.ts`,
`PaymentPage.tsx` and `pago.test.tsx` are touched by more than one story;
tasks on those files are never `[P]` with each other.

## Parallel Examples

**Foundational**, once T003–T008 are in:

```text
T009 test helpers        (apps/api/test/consta/helpers.ts)
T010 sandbox             (apps/api/sandbox/apicep-mock.mjs)
T011 env comment         (apps/api/src/env.ts)
T012 bank hints          (apps/pago/src/features/pago/bank-hints.ts)
then T013 → T014 → T015 (panel, parallel with T016)
```

**US1**:

```text
T017 comparison tests → T018 gate tests (same file)  |  T019 lifecycle tests
→ T020 compare.ts → T021 validate/extract → T023 validation.ts → T024 schema → T025 handler → T026 page
T027 page tests in parallel with T022
```

**US3**:

```text
T034 tieDestination tests → T036 engine/lifecycle tests  |  T035 settings tests
T037 destination.ts  |  T038 accounts helper  |  T039 settings route
→ T040 → T041 → T042 → T043 → T044 (panel) | T045 (page)
```

**US4** — T046 and T048 together, then T047, then T049.

## Implementation Strategy

### MVP first (User Story 1)

1. Setup, then Foundational (including T016's measurement).
2. US1: receipt 2 confirms, references are typed first, one transfer still
   pays once, ambiguous / generic / shared references ask for the clave.
3. **Stop and validate** with quickstart § User Story 1; it can ship alone.

### Incremental delivery

1. US1 → ship.
2. US2 → receipt 1 costs nothing and the payer is guided → ship.
3. US3 → the cuenta de cobro, no CLABE required → ship.
4. US4 → the compact guide → ship.

Each increment leaves every earlier outcome as it was (SC-012), and each can
be validated by its quickstart section alone.

### Notes

- A task's notes record what was measured or run, with the date and the
  commit.
- A shortcut taken on purpose is registered with `/speckit-debt-log` the same
  day (constitution, Development Workflow).
