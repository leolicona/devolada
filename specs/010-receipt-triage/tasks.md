---

> **Behind the plan since 2026-09-24.** The spec and the plan were re-planned
> for the rescoped Story 3 (plan D29–D32; D23 retired). Regenerate with
> `/speckit-tasks` before implementing; until then no task here about the
> account choice, the candidate list or three accounts on the page applies.

description: "Task list for receipt-triage"
---

# Tasks: receipt-triage

**Input**: Design documents from `/specs/010-receipt-triage/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: mandatory here, not optional. Constitution IV puts the engine,
lifecycle and settings tests in workerd against a real D1 with apiCEP
intercepted at its pinned origin and the reader stubbed at the binding; the
page and the panel test on happy-dom with MSW and axe; the guide's contrast
and width in Playwright. Constitution VII requires every test to cite its
story: every new or rewritten test cites `receipt-triage US<n>`. Research R17
names the two-eyes assertions this feature changes; nothing retires unnamed.

**Organization**: grouped by user story so each can be implemented and tested
on its own. US1 (reference) comes first, as the spec orders it; US2's rule —
ask when a capture shows *no key* — reads the gate's reference verdict, which
lands in the Foundational phase, so US2 does not wait on US1. US3 (card and
phone) and US4 (guide) are independent of every other story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US4, mapping to the spec's user stories
- Every task names the file it touches

## Decision citations

Code comments cite `receipt-triage D<n>`, tabled in
[plan.md](./plan.md#decisions): D1–D10 are the spec's, D11–D27 the plan's.

**Amended 2026-09-24** after `/speckit-analyze` (all findings folded in):
T038 and T033 identify rows born before this feature and keep them on
today's flow (G1, plan D27); T029's page-state comment cites D18 (I2) and
names how the message is announced (U1); T015, T027 and T033 lose `[P]`,
since each shares a file with a sibling task (I3); T035 updates the settings
fixtures (G2); T027 and T033 cover the platform top-up (G3) and T027 the
reader being down (C1); T039 states one rule for an account the ISP does not
have (A1); T042's first guide item reads "(Referencia numérica)" (T2); the
message names a missing account (I1, T029); the copy the design canvas added
is in the contract, and T029 and T041 carry it.
Where a comment today says something this feature makes false — a hole never
refuses (`consta/validate.ts` D2/D3 block, `consta/failure.ts` on
`RECEIPT_INCOMPLETE`, `reader.ts` on legibility, the `/read` handler's
header), the beneficiary is the business's CLABE
(`direct-payments/validation.ts`), Devolada "cannot hit" the 422
(`provider/apicep.ts`) — it is rewritten in the task that changes the code
beneath it. A comment contradicting the code is the gap constitution I
forbids.

---

## Phase 1: Setup

**Purpose**: know what green looks like before anything changes.

- [ ] T001 Baseline: `pnpm install --frozen-lockfile`, then every gate in CI order — `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test` — and record in this task's notes the commit and the test counts of `apps/api/test/consta/validate.test.ts`, `apps/api/test/direct-payment.test.ts`, `apps/api/test/settings.test.ts`, `apps/pago/test/pago.test.tsx` and `apps/admin/test/settings.test.tsx`. A gate already red proves nothing later.
- [ ] T002 List the tests research R17 says will change: `grep -n 'legibilidad: "completa"' apps/api/test/consta/validate.test.ts apps/api/test/direct-payment.test.ts` and keep those whose stub reading has `claveDeRastreo: null` (a fully legible picture with no clave that today reaches the provider). Record their names in this task's notes; T026 rewrites exactly these. Tests with a *malformed* clave or a *partly legible* hole are not on the list (D16).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the columns, the engine's contract types, the reader's two new
fields, the gate's reference verdict, the test helpers, the sandbox, and the
bank hints every story reads. None of it changes product behaviour on its own.

**⚠️ CRITICAL**: T003–T012 land before any story task.

- [ ] T003 Add the columns of [data-model.md](./data-model.md) to `apps/api/src/db/schema.ts`: on `businesses` — `speiCard`, `speiCardBank`, `speiPhone`, `speiPhoneBank` (text, nullable; comment: the `clabe` area, masked like the CLABE, `configured` still speaks of the CLABE — D9, D26); on `payments` — `referenceNumber` (text; comment: up to seven digits as printed, never cast — D1, D12), `beneficiary` and `beneficiaryCandidates` (text JSON; comment: attempts read the account from the payment, never the business — D25, D23); on `extractions` — `proofKey`, `referenceNumber`, `providerReferenceNumber`, `destinationKind`, `destinationDigits` (text; D21, D24); extend `extractions.outcome`'s enum with `key_missing` and `wrong_destination`. Extend the comment on `payments.disputed_fields` with `"referenceNumber"` (D13) and on `payments.last_error` with `REFERENCE_AMBIGUOUS` (D17). Nothing is dropped or renamed.
- [ ] T004 Generate the migration with `pnpm --filter @devolada/api db:generate`, rename it `apps/api/migrations/0036_receipt_triage.sql` (if `0036` is taken, use the next free number and amend data-model.md's first paragraph), update `apps/api/migrations/meta/_journal.json` as earlier renames did, and read it: only `ALTER TABLE … ADD COLUMN` — twelve of them — no `DROP`, no table rebuild (if drizzle-kit emits one, hand-write the `ADD COLUMN` statements and say so in the file header, as `0030` does). Give the file the same kind of header `0030_two_eyes_receipt.sql` has. Apply with `pnpm --filter @devolada/api db:migrate:local`. Depends on T003.
- [ ] T005 Extend the engine's types in `apps/api/src/consta/index.ts` exactly as [contracts/engine.md](./contracts/engine.md) lists: `ConstaBeneficiary` widened to the three shapes; the transfer variant's `trackingKey` optional beside an optional `referenceNumber`; the receipt variant's `beneficiary` optional beside `potentialBeneficiaries`; `ConstaVerdict` gains `beneficiaryUsed`, `accepted` with both keys, `disputedFields` with `referenceNumber`; `ConstaReading` gains `referenceNumber`, `destination`, `gate.referenceNumber`, `ask`, `tiedAccount`; `extract`'s input gains `receivingAccounts`. Fix every compile error this raises in callers (`direct-payments/validation.ts`, `credit/topups.ts`, `routes/direct-payments/handler.ts`) with the narrowest change that keeps today's behaviour — e.g. `trackingKey: payment.trackingKey ?? ""` stays until US1 changes it. Comment each new field with its decision (D1, D9, D11, D13, D15, D22, D24).
- [ ] T006 In `apps/api/src/consta/failure.ts`, add `RECEIPT_WRONG_DESTINATION` to `ConstaErrorCode` with a comment (receipt-triage D15, D24: a clear capture whose destination fits none of the ISP's accounts; nothing billed). Leave `RECEIPT_INCOMPLETE`'s comment for T025, which throws it again.
- [ ] T007 Extend the reader in `apps/api/src/consta/extraction/reader.ts`: `FIELDS` gains `"referenciaNumerica": "<the value of the 'Referencia' or 'Referencia numérica' field, digits only, exactly as printed including leading zeros, or null>"` and `"destino": {"tipo": "<clabe | tarjeta | celular | cuenta, or null>", "digitos": "<the digits of the destination account you can see, without asterisks or dots, or null>"}`; `RULES` gains: a reference is at most seven digits, and a "Folio", "Número de autorización", "Clave de rastreo" or account number is not a reference. `Reading` gains `referenceNumber: string | null` and `destination: { kind: "clabe" | "card" | "phone" | "account" | null; digits: string | null }`, parsed with the existing `str` helper (Spanish `tipo` mapped to the English kind; anything else is null). Both prompts share `FIELDS`, so a PDF's text is asked the same. Comment with D12 and D24.
- [ ] T008 Extend the gate in `apps/api/src/consta/extraction/gate.ts`: `Gate` gains `referenceNumber: "ok" | "malformed" | "generic" | "missing"` (`ok` iff `/^\d{1,7}$/` on the trimmed value, never cast to a number — D12; `generic` when that value is a single digit repeated ("0", "0000", "1111111") or a run of consecutive digits ("123", "1234567", "7654321"), via one exported `isGenericReference` in `apps/api/src/routes/direct-payments/schema.ts` that the gate, the pay schema and the page share — D2, clarified 2026-09-24); `GatedReading` gains `referenceNumber: string | null` (only when `ok`); `passes` becomes (`trackingKey === "ok"` or `referenceNumber === "ok"`) and `senderBank === "ok"` and `amount === "ok"` (D11). Update `apps/api/src/consta/extract.ts` so the reading it returns carries `referenceNumber` and `gate.referenceNumber` (the other new fields of `ConstaReading` stay `null` until their story).
- [ ] T009 [P] Extend the test helpers in `apps/api/test/consta/helpers.ts`: `StubbedReading` gains `referenciaNumerica?: string | null` and `destino?: { tipo?: string | null; digitos?: string | null } | null`; add two named fixtures from the spec's receipts — `RECEIPT_1_READING` (Banorte summary: `claveDeRastreo: null`, `referenciaNumerica: null`, `banco: "BANORTE"`, `monto: 300`, `fecha: "2026-09-09"`, `legibilidad: "completa"`, `destino: { tipo: "clabe", digitos: "8195" }`) and `RECEIPT_2_READING` (Azteca: `claveDeRastreo: null`, `referenciaNumerica: "038195"`, `banco: "AZTECA"`, `monto: 350`, `fecha: "2026-09-09"`, `destino: { tipo: null, digitos: "195" }`). `GOOD_READING` is unchanged, so every existing test keeps its meaning. Comment: the answers mirror the receipts the product creator brought on 2026-09-23.
- [ ] T010 [P] Teach the sandbox `apps/api/sandbox/apicep-mock.mjs`: a direct-mode body with `sender.referenceNumber` and no `trackingKey` answers `valid` with a `cepDetails.trackingKey`; reference `9999999` answers HTTP 422 with the published "provide the tracking key" error; bodies with `beneficiary.cardNumber`, `beneficiary.phoneNumber` or `potentialBeneficiaries` are accepted like a CLABE. Update the header's scenario table.
- [ ] T011 [P] Rewrite the `AI` comment in `apps/api/src/env.ts`: unset → no reading of ours, so no ask, no reference and no tied account from our side; the file goes to the provider with the whole list of accounts, and the provider's own reference, when it reads one, still counts (constitution VIII; D15, D22).
- [ ] T012 [P] Create `apps/pago/src/features/pago/bank-hints.ts`: `type BankHint = { where: string; source: string; verified: string }` and `export const BANK_HINTS: Partial<Record<Bank, BankHint>>` keyed by the `Bank` type from `@devolada/api/direct-payments-schema`, with one entry — `BANORTE`: where "toca «Ver más detalles» y captura esa pantalla", source "receipt 1, receipt-triage spec", verified "2026-09-23" — and a header comment saying an entry is added only from a real receipt or the bank's own documentation, read by a person (D19). Export `GENERAL_HINT` ("Abre el detalle de la transferencia en tu app y captura la pantalla donde aparecen estos datos."). Used by US2 and US4.
- [ ] T013 Measure the reader with the new prompt (quickstart Step 0, research R2, R14), after T007: with `pnpm --filter @devolada/api dev` and a dev link, upload receipt 1 and receipt 2 — the product creator's images, uploaded in session on 2026-09-23; never committed — and any other captures supplied, call `/read`, and record per receipt `claveDeRastreo`, `referenciaNumerica`, `destino`, `legibilidad`. Write the dated table into the header comment of `apps/api/src/consta/extraction/reader.ts`. If the reader takes a folio for a reference or misreads destination digits, tighten the prompt and measure again. If this environment cannot reach the binding (no `wrangler login`, as two-eyes T002 found), write "not run — reason" in the header and in this task's notes, and register it with `/speckit-debt-log` before the feature is called done.

**Checkpoint**: the columns exist, the types compile, the reader and the gate
speak reference and destination, the helpers and the sandbox answer both, the
hints exist, and every existing test still passes.

---

## Phase 3: User Story 1 — The referencia numérica finds the transfer when the clave is missing (P1) 🎯 MVP

**Goal**: the reference is read, compared, stored and sent whenever there is
no clave; a payer can type it; Banxico's clave is adopted onto a row found by
reference; a reference that matches more than one transfer asks for the clave
and stops the retries.

**Independent Test**: [quickstart § User Story 1](./quickstart.md#user-story-1--the-referencia-numérica).

### Tests for User Story 1

- [ ] T014 [P] [US1] Pure comparison tests in `apps/api/test/consta/validate.test.ts`, in a `describe("receipt-triage US1: the reference as a key")` beside the existing `compareReadings` block: no clave on either side and equal references → `agreed` with `accepted.referenceNumber` set and `accepted.trackingKey` null; different references → `disputed` with `["referenceNumber"]` and the shape rules never consulted; one side with no reference → `blind` on that side; a clave on either side → today's result with the reference riding along in `accepted`; `"038195"` and `"38195"` never agree; claves that disagree with no shape tiebreak, the amount agreed, and both sides reading `038195` → `disputed` with `[]` and `accepted: { trackingKey: null, referenceNumber: "038195" }`; the same with only one side reading a reference, or with the amount also disputed → today's `["trackingKey", …]` (D13, clarified 2026-09-24).
- [ ] T015 [US1] Gate tests in `apps/api/test/consta/validate.test.ts` (`receipt-triage US1`): `"038195"` → `ok` and kept as `"038195"`; `"0082918812"` → `malformed` and never on the request; a reading with a reference and no clave `passes`.
- [ ] T016 [P] [US1] Lifecycle tests in `apps/api/test/direct-payment.test.ts` (`receipt-triage US1`), against the intercepted provider: (a) a typed submission with only `referenceNumber` is accepted and the provider body carries `sender.referenceNumber` and no `trackingKey`; (b) with both keys, only `trackingKey` travels, on the first attempt and on every retry after a `not_found` (D1, clarified 2026-09-24); (b2) a row whose disputed clave fell back to the reference takes the transfer door with `referenceNumber` and no `trackingKey`, asks nothing, adopts Banxico's clave on `valid` — a clave another row already holds ends `invalid` with `TRANSFER_ALREADY_USED`, never `confirmed` (FR-006) — and on `not_found` writes `disputed_fields = ["trackingKey", "referenceNumber"]` while the next slot still searches with the reference (D13); (c) a receipt read with `RECEIPT_2_READING` whose provider reading agrees on `038195` takes the transfer door with the reference on the next slot (SC-002: at most two paid calls); (d) Banxico confirms by reference → the row carries the CEP's clave; a second submission whose search returns that clave ends `invalid` with `TRANSFER_ALREADY_USED` (D14, FR-006); (e) the provider answers 422 `provide_tracking_key` → the row has `disputed_fields = ["trackingKey"]`, `last_error = "REFERENCE_AMBIGUOUS"`, and the next slot makes **no** provider request (D17, SC-005); a correction with a clave supersedes it and takes the transfer door.

### Implementation for User Story 1

- [ ] T017 [US1] Comparison in `apps/api/src/consta/extraction/compare.ts`: `ProviderReading` gains `referenceNumber`; `DisputedField` gains `"referenceNumber"`; the comparison's key is the clave when either side read one, the reference otherwise (D13) — with the one fallback to an agreed, gated reference when a disputed clave is the only field in doubt and the shape rules settle nothing — equal as text agrees, different disputes on `referenceNumber`, one side missing is blind; the shape rules are never called for a reference; `accepted` carries `trackingKey | null` and `referenceNumber | null` (at least one set), with the reference riding along from whichever side read it, ours first. Update the header comment. Makes T014 pass.
- [ ] T018 [US1] Engine in `apps/api/src/consta/validate.ts` and `apps/api/src/consta/extract.ts` — **including `recentReading` (plan D28, research R18): rebuild `referenceNumber` from `extractions.reference_number` with its gate re-derived by the gate's own function, `passes` with either key, and admit `key_missing` and `wrong_destination` in the outcome filter; test (`receipt-triage US1`): `/read` of `RECEIPT_2_READING` then pay with the same file inside the window → one reader call in total, the reused reading carries `038195`, no ask, one provider call**: feed the adapter's `reading.referenceNumber` into the comparison as the provider's; on the transfer door pass `referenceNumber` through to the provider (the guard already requires one key); `recordExtraction` writes `reference_number` (ours, as read, gated or not) and `provider_reference_number` (theirs) (D21); `ourReading` carries `referenceNumber`. Makes T015 pass.
- [ ] T019 [US1] Rewrite the 422 comment in `apps/api/src/consta/provider/apicep.ts` ("Devolada cannot hit it (it always sends the key)") — it can now, and receipt-triage D17 is what the caller does with it.
- [ ] T020 [US1] Lifecycle in `apps/api/src/direct-payments/validation.ts`: the `accepted` test becomes (clave **or** reference) and bank and amount and date (D11); the transfer request sends `trackingKey` only when set and `referenceNumber` when set; a classification's `accepted.referenceNumber` is written to `payments.reference_number`; `adoptKey` also covers a row with a reference and no clave, whatever its `proof_mode` (D14 — the existing unique-violation branch stays the loser's path); in the engine-failure catch, `e.hint === "provide_tracking_key"` writes `disputedFields: ["trackingKey"]` and `lastError: "REFERENCE_AMBIGUOUS"` and rides the schedule; before calling the engine, a row whose `lastError` is `REFERENCE_AMBIGUOUS` and has no clave rides the next slot without a call (D17). Each rule commented with its decision. Makes T016 pass.
- [ ] T021 [US1] Contracts in `apps/api/src/routes/direct-payments/schema.ts` as [contracts/payment-page.md](./contracts/payment-page.md) lists for US1: `payRequest.transfer.trackingKey` optional, `referenceNumber` (`^\d{1,7}$`) optional, `.refine` at least one; `proofReadingResponse` gains `referenceNumber` and `gate.referenceNumber`; `directPaymentStatusResponse` gains `referenceNumber` and `"referenceNumber"` in `disputedFields`; `publicPaymentError` gains `REFERENCE_AMBIGUOUS`. Update the fixtures that validate against these schemas in the same task — `apps/pago/test/msw.ts` and `tests/e2e/stubs.ts` (`proofReading` and its variants gain `referenceNumber: null` and `gate.referenceNumber: "missing"`).
- [ ] T022 [US1] Handlers in `apps/api/src/routes/direct-payments/handler.ts` (the shared reference lookup, D7 clarified 2026-09-24: one helper `sharedReference(db, business, link, { reference, date, senderBank, amountCents, account })` in `apps/api/src/direct-payments/validation.ts` — another link, not `superseded`, same five data, the account ruling nothing out while unknown — used by `readProof` to report `ask.shared`, by `submitPayment` to refuse typed data with `REFERENCE_SHARED` when no clave rides beside it, and by the lifecycle before any transfer-door call with a reference and no clave, which then writes `disputed_fields = ["trackingKey"]`, `last_error = "REFERENCE_SHARED"` and makes no provider call; its index in `0036`): `submitPayment` stores `transfer.referenceNumber` on the row; `readProof` returns `referenceNumber` and `gate.referenceNumber`; `getDirectPaymentStatus` returns `referenceNumber` and maps `last_error = REFERENCE_AMBIGUOUS` to `error: "REFERENCE_AMBIGUOUS"`.
- [ ] T023 [US1] Page in `apps/pago/src/features/pago/PaymentPage.tsx`: `TransferForm` shows the key as two fields — "Clave de rastreo" (unchanged) and "Número de referencia" (`inputMode="numeric"`, digits only, leading zeros kept) — with the line "Escribe al menos uno."; `valid` requires at least one key; `onSubmit` sends whichever are set; the later asks gain "Confirma tu número de referencia mirando tu comprobante." for a disputed `referenceNumber`, and for `error === "REFERENCE_AMBIGUOUS"` "Tu número de referencia coincide con más de una transferencia. Escribe tu clave de rastreo para encontrar la tuya." with the form asking for the clave only, everything else pre-filled.
- [ ] T024 [P] [US1] Page tests in `apps/pago/test/pago.test.tsx` (`receipt-triage US1`): the manual form submits a reference alone, refuses both keys empty, keeps `038195` as typed; the two later-ask sentences render for their status fixtures; axe clean on each.

**Checkpoint**: receipt 2 confirms with no question; a payer can type a
reference; one transfer still pays once; an ambiguous reference asks for the
clave and costs no second call.

---

## Phase 4: User Story 2 — The payer is told exactly what is missing, and how to fix it (P2)

**Goal**: a clear capture with neither key is asked about before any credit,
in the message and with the ways forward D5 designs; later asks follow the
same pattern.

**Independent Test**: [quickstart § User Story 2](./quickstart.md#user-story-2--the-missing-data-feedback).

### Implementation for User Story 2

- [ ] T025 [US2] Create `apps/api/src/consta/extraction/ask.ts` with `askBeforeCredit(extracted, accounts)` — the `no_key` branch of [data-model.md § The ask](./data-model.md#the-ask-no-storage-beyond-the-outcome): not a reader reading, not a receipt, or not clear (`legibility === "full"` on a picture, or a PDF's text — D16) → `null`; a key not `missing` → `null`; otherwise `{ reason: "no_key", fields }` with `"key"` first, then `amount`, `date`, `senderBank` the reading lacks, in form order. Leave a typed hook for `wrong_destination` and `account` that returns nothing until T037. Export it from `apps/api/src/consta/extraction/index.ts`. In `apps/api/src/consta/failure.ts`, rewrite `RECEIPT_INCOMPLETE`'s comment: thrown again, for one case (receipt-triage D4, D15).
- [ ] T026 [US2] Enforce and report the ask. In `apps/api/src/consta/extract.ts`: compute `ask` on every reading, record the row with outcome `key_missing` when it is `no_key`, write `proof_key` on every row (D21). In `apps/api/src/consta/validate.ts`: after reading (or reusing the draft's reading), when `askBeforeCredit` is not null, record the reading and throw `RECEIPT_INCOMPLETE` with `extra.reading` and `missingFields` before the provider call; rewrite the D2/D3 comment block ("a hole no longer refuses") to name the one case D4 narrows. Then rewrite, in `apps/api/test/consta/validate.test.ts` and `apps/api/test/direct-payment.test.ts`, the tests T002 listed to assert the ask instead of a provider call, each cited `receipt-triage US2`.
- [ ] T027 [US2] Engine and lifecycle tests (`receipt-triage US2`) in `apps/api/test/consta/validate.test.ts` and `apps/api/test/direct-payment.test.ts`: `RECEIPT_1_READING` → `extract` answers `ask: { reason: "no_key", fields: ["key"] }`, the receipt door throws `RECEIPT_INCOMPLETE`, **no request reaches the intercepted provider**, the reading row's outcome is `key_missing` and its `proof_key` is set; with `fecha: null` too → `["key", "date"]`; `legibilidad: "parcial"`, no `legibilidad`, or a malformed clave → no ask and one provider call; `RECEIPT_2_READING` → no ask; a text PDF with neither key → asked; no `AI` binding → `ask: null` and one provider call, as today (FR-015); a payment that skipped the page rides `retryLater("RECEIPT_INCOMPLETE")` with nothing billed; a platform top-up whose reading has neither key rides its schedule with no provider request, in `apps/api/test/topups-pause.test.ts` (spec Edge Cases).
- [ ] T028 [US2] Contract and handler: `proofReadingResponse` in `apps/api/src/routes/direct-payments/schema.ts` gains `ask` (the `no_key` variant now; the union is completed in T039) and `readProof` in `apps/api/src/routes/direct-payments/handler.ts` returns it; rewrite the `/read` header comment ("this endpoint cannot reject anybody" stays true — it reports; D15). Update `apps/pago/test/msw.ts` and `tests/e2e/stubs.ts` fixtures with `ask: null`, and add a `keylessReading` fixture beside `proofReading`.
- [ ] T029 [US2] The ask on the page, in `apps/pago/src/features/pago/PaymentPage.tsx`, as [contracts/payment-page.md § The ask](./contracts/payment-page.md#the-ask-at-the-upload-story-2-d5-d18) specifies: rendered from `reading.ask` in the existing warning `Alert` at the top of the step — which already carries `role="status"` (`packages/ui/src/components/alert.tsx`), so it is announced politely — and given focus on arrival (`tabIndex={-1}` and `focus()`), three sentences — the key; the other missing fields only, the account included ("ni a cuál cuenta transferiste") when `fields` has `account`; the hint from `BANK_HINTS[reading.senderBank]` or `GENERAL_HINT` — and two buttons at the touch size, "Subir otra captura" (focus to the picker) and "Escribir los datos" (opens `TransferForm`). The form opened from the ask is pre-filled with every field the reading passed, shows "No aparece en tu captura" under each field the capture lacked, gives the reference field the help "Hasta 7 dígitos, con los ceros del inicio.", and ends with the text button "Mejor subo otra captura". Count `no_key` asks in this visit; at two, render the form first with "Tu captura tampoco muestra la clave de rastreo ni el número de referencia. Escribe los datos de tu transferencia." (page state, plan D18 — say so in a comment). The later asks gain one line, "En {banco}: {dónde}", when a key is asked for and `status.senderBank` has a hint (D6). Comments cite D5, D6, D18.
- [ ] T030 [P] [US2] Page tests in `apps/pago/test/pago.test.tsx` (`receipt-triage US2`): the `Alert` names the key and only the other missing fields; Banorte's hint for `senderBank: "BANORTE"`, the general one otherwise; focus is on the message; "Escribir los datos" opens the form pre-filled with "No aparece en tu captura" under each empty field; a second keyless reading renders the form first; a reference-only reading goes on to pay with no ask; the later ask shows the hint line; axe clean on every state.

**Checkpoint**: receipt 1 costs nothing and the payer knows what to do; every
other outcome is unchanged.

---

## Phase 5: User Story 3 — An ISP can be paid at a debit card or a phone as well as its CLABE (P2)

**Goal**: the owner registers one card and one phone; the page shows them; the
check asks Banxico about the account the receipt shows as destination; the
payment remembers it; a clear receipt to another account is told so for free.

**Independent Test**: [quickstart § User Story 3](./quickstart.md#user-story-3--the-card-and-the-phone).

### Tests for User Story 3

- [ ] T031 [P] [US3] Pure tests for `tieDestination` in `apps/api/test/consta/validate.test.ts` (`receipt-triage US3`), with the CLABE `012180001234538195` (ending `…38195`; its account segment, positions 7–17, is `00123453819`), a card ending `1234` and a phone ending `5678`: `clabe`/`8195` → the CLABE; `null`/`195` (receipt 2) → the CLABE; `account`/`3819` (receipt 3) → the CLABE by its account segment; `card`/`1234` → the card; two digits → `"unknown"`; digits ending two accounts → `"unknown"`; `9999` → `"none"`.
- [ ] T032 [P] [US3] Settings tests in `apps/api/test/settings.test.ts` (`receipt-triage US3`): the owner saves a Luhn-valid 16-digit card with its bank and a 10-digit phone with its bank, and clears each with `null`; a failing check digit, 15 or 17 digits, a 9-digit phone, a number without its bank, a bank outside the vocabulary are `VALIDATION_ERROR`; an admin gets `FORBIDDEN_FOR_ROLE` on any of the four fields; an operator reads both masked to the last four; `configured` is unchanged by them.
- [ ] T033 [US3] Engine and lifecycle tests in `apps/api/test/consta/validate.test.ts` and `apps/api/test/direct-payment.test.ts` (`receipt-triage US3`): a reading with `destino: { tipo: "tarjeta", digitos: "1234" }` sends `beneficiary.cardNumber` and the verdict's `beneficiaryUsed` is the card; an unreadable destination with three accounts sends `potentialBeneficiaries` and `beneficiaryUsed: null`, and our reader still ran; a `valid` answer whose `cepDetails.beneficiaryAccount` is the phone writes the phone to `payments.beneficiary` even when `beneficiaryUsed` was null; one whose `beneficiaryAccount` is none of the ISP's accounts ends `TRANSFER_CONTRADICTED`; one without `beneficiaryAccount` keeps `beneficiaryUsed` (D22, amended); a clear `9999` throws `RECEIPT_WRONG_DESTINATION` with no provider request and outcome `wrong_destination`; the payment stores `beneficiary` and a later attempt uses it after the business changed its card (FR-021); with candidates and no known account, accepted data still rides the receipt door with the list (D23); a typed submission to a link with more than one account and no `receivingAccount` is a 400, and with `receivingAccount: "phone"` the transfer door names the phone; an ISP with only a CLABE gets exactly today's request body (SC-008); a payment born before this feature (`beneficiary` and `beneficiary_candidates` both NULL) whose reading has no key and a destination matching nothing still makes today's provider call — no ask, no tie (FR-027, plan D27); a platform top-up whose clear receipt went to another account is stopped before any credit, with the platform's CLABE as the only account, in `apps/api/test/topups-pause.test.ts` (spec Edge Cases).

### Implementation for User Story 3

- [ ] T034 [P] [US3] Create `apps/api/src/consta/extraction/destination.ts` with `tieDestination(destination, accounts)` exactly as [data-model.md](./data-model.md#the-ask-no-storage-beyond-the-outcome) defines it — visible trailing digits, fewer than three → `"unknown"`, forms per account (CLABE whole and its 11-digit account segment, positions 7–17; card; phone), `destination.kind` only ordering the search and never ruling an account out (clarified 2026-09-24; test: `{ tipo: "tarjeta", digitos: "3819" }` with a CLABE whose account segment ends `3819` and a card ending `1234` → tied to the CLABE, never `"none"`), exactly one → `{ tied }`, more → `"unknown"`, none → `"none"` — pure, commented with D24, exported from `apps/api/src/consta/extraction/index.ts`. Makes T031 pass.
- [ ] T035 [US3] Settings in `apps/api/src/routes/settings/schema.ts` and `apps/api/src/routes/settings/handler.ts` as [contracts/settings.md](./contracts/settings.md) specifies: `settingsResponse.spei` gains `card`, `cardBank`, `phone`, `phoneBank`, masked for roles that cannot update settings; `settingsPatchRequest` gains the four nullable fields with a Luhn `refine`; the handler checks number-and-bank pairs against the merged row and requires the `clabe` area for any of the four (D26). In the same task, update every fixture typed against `settingsResponse`: `settings` in `tests/e2e/stubs.ts` and the `settings()` helper in `apps/admin/test/settings.test.tsx` gain `card`, `cardBank`, `phone`, `phoneBank: null`. Makes T032 pass.
- [ ] T036 [US3] Engine in `apps/api/src/consta/validate.ts` and `apps/api/src/consta/extract.ts` (D22, D24, D28 — `recentReading` also rebuilds `destination` from `destination_kind`/`destination_digits`, so a reused reading ties the same account): the `readable` test also accepts `potentialBeneficiaries`; after reading, `tieDestination` against the request's accounts — tied → the provider call carries that `beneficiary`; otherwise the list (or the single beneficiary it was given); the verdict reports `beneficiaryUsed`; `extract` accepts `receivingAccounts` and returns `destination` and `tiedAccount`; `recordExtraction` writes `destination_kind` and `destination_digits`, never the ISP's accounts.
- [ ] T037 [US3] Complete `askBeforeCredit` in `apps/api/src/consta/extraction/ask.ts`: a clear reading whose destination is `"none"` → `{ reason: "wrong_destination" }` (before the key check); in `no_key`, `fields` gains `"account"` when there is more than one account and the destination did not tie. The receipt door throws `RECEIPT_WRONG_DESTINATION` for it and `extract` records outcome `wrong_destination` (D15). Makes the rest of T033's engine cases pass.
- [ ] T038 [US3] Lifecycle in `apps/api/src/direct-payments/validation.ts` (D23, D25): the beneficiary comes from the payment — `beneficiary` if set, else the receipt door with `beneficiary_candidates`, else today's fallback to the business's CLABE for rows born before this feature; the `accepted` test also requires `beneficiary` when `beneficiary_candidates` is set; a verdict's `beneficiaryUsed` is written to `payments.beneficiary`; on `valid`, `cep.beneficiaryAccount` tied to the payment's accounts (`tieDestination`) overwrites it, and a whole account that fits none ends `invalid` with `TRANSFER_CONTRADICTED`, never `confirmed` (D22, amended 2026-09-24); in `apps/api/src/consta/provider/apicep.ts` keep `beneficiaryAccount` and `beneficiaryAccountType` from `cepDetails` on `cep`. A row with both NULL was born before this feature (T039 gives every new row one of the two): its receipt-door requests carry `legacy: true`, and the engine then skips the ask and the destination tie for it, so it finishes under the flow it started in (FR-027, plan D27) — implement the flag's side in `apps/api/src/consta/validate.ts`. Rewrite the comment above the beneficiary it replaces.
- [ ] T039 [US3] Contracts and handlers, as [contracts/payment-page.md](./contracts/payment-page.md) lists for US3: in `apps/api/src/routes/direct-payments/schema.ts` — `linkStatusResponse` gains `speiCard`, `speiCardBank`, `speiPhone`, `speiPhoneBank`; `payRequest.transfer` gains `receivingAccount`; `proofReadingResponse.ask` becomes the discriminated union with `wrong_destination` and `fields` gains `"account"`; `proofReadingResponse` gains `tiedAccount`. In `apps/api/src/routes/direct-payments/handler.ts` — both branches of `getLinkStatus` set the four fields when registered; `readProof` passes the ISP's accounts to `extract`; `submitPayment` snapshots `beneficiary` (one account, or the payer's `receivingAccount`) or `beneficiary_candidates` (more than one, from a receipt), and answers 400 `VALIDATION_ERROR` when a typed transfer names an account the ISP does not have, or names none while the ISP has more than one (one rule, contracts/payment-page.md). Update `apps/pago/test/msw.ts` and `tests/e2e/stubs.ts` fixtures (`tiedAccount: null`). Makes the rest of T033 pass.
- [ ] T040 [US3] Panel in `apps/admin/src/features/settings/SettingsScreen.tsx`: below the CLABE, inside the owner-only block, "Tarjeta de débito (opcional)" (16 digits + the `Combobox` over `BANK_OPTIONS`) and "Celular para transferencias (opcional)" (10 digits + the same picker), with the help texts and inline errors of [contracts/settings.md § Screen](./contracts/settings.md#screen), compact 40px controls, tokens only; non-owners see them as they see the CLABE. Tests in `apps/admin/test/settings.test.tsx` (`receipt-triage US3`): save, clear, each inline error, the owner-only gate, axe clean.
- [ ] T041 [US3] Page in `apps/pago/src/features/pago/PaymentPage.tsx`: the transfer step lists "Tarjeta de débito" and "Celular" with their banks through the existing `CopyField`, only when set, under the heading "Transfiere a cualquiera de estas cuentas" when there is more than one; `TransferForm` asks "¿A cuál cuenta transferiste?" when the link offers more than one account — each option with its kind, last four digits and bank, none pre-selected on the manual door, `reading.tiedAccount` pre-selected, with "la que muestra tu captura" under it, when the form opens from a reading — and sends `receivingAccount`; the `wrong_destination` ask renders in the same `Alert` ("Esta transferencia fue a otra cuenta, no a una de {ispName}. Revisa tu comprobante.") with the same two buttons. Tests in `apps/pago/test/pago.test.tsx` (`receipt-triage US3`): the accounts on the transfer step, the choice and its pre-selection, the `wrong_destination` message, an ISP with only a CLABE unchanged, axe clean.

**Checkpoint**: an ISP can be paid at three accounts, each checked against the
one the receipt shows; a CLABE-only ISP sees no change.

---

## Phase 6: User Story 4 — The payer sees what a good capture shows before taking it (P3)

**Goal**: the capture guide above the upload button, adding no tap.

**Independent Test**: [quickstart § User Story 4](./quickstart.md#user-story-4--the-capture-guide).

- [ ] T042 [P] [US4] Create `apps/pago/src/features/pago/CaptureGuide.tsx` as [contracts/payment-page.md § The capture guide](./contracts/payment-page.md#the-capture-guide-story-4-d8-d20) specifies (D20): "Tu captura debe mostrar:", an inline SVG of a generic receipt drawn only with token classes (`fill-*`, `stroke-*` from `packages/ui/src/styles/tokens.css` through Tailwind — no raw colour, size or duration), four numbered markers each named in text beside it (1 Clave de rastreo o número de referencia (Referencia numérica) · 2 Monto · 3 Fecha · 4 Cuenta a la que transferiste), the SVG `aria-hidden` because the list carries the meaning; the three rules as a list; the existing `Collapsible` "¿Dónde encuentro estos datos en mi banco?" listing `BANK_HINTS`. No motion.
- [ ] T043 [US4] Place `CaptureGuide` above `ReceiptForm` in the "Envía tu comprobante" step of `apps/pago/src/features/pago/PaymentPage.tsx`, after the refusal/ask `Alert` and before the upload control, with nothing that needs a tap in front of the upload (FR-026). Comment with D8.
- [ ] T044 [P] [US4] Page tests in `apps/pago/test/pago.test.tsx` (`receipt-triage US4`): the four numbered items are named in text, the three rules render, the tips open in one tap and list Banorte, the upload control is reachable with no other interaction, axe clean.
- [ ] T045 [US4] Browser test in `tests/e2e/pago.spec.ts` (`receipt-triage US4`): on the upload step, no horizontal scroll at 360, 768 and 1280px; the guide's text meets contrast in light and dark; the upload control is reachable by keyboard with a visible, measured focus indicator. Run with `pnpm e2e -- tests/e2e/pago.spec.ts`.

**Checkpoint**: the step teaches the capture before it is taken.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T046 Comment sweep across the files this feature touched: every comment listed under "Decision citations" is rewritten; every new rule cites `receipt-triage D<n>`; no comment still says a hole never refuses, the beneficiary is the business's CLABE, or Devolada cannot hit the 422. `grep -rn "RECEIPT_INCOMPLETE\|cannot hit\|speiClabe" apps/api/src` and read each hit.
- [ ] T047 [P] Confirm the dated note in `specs/005-two-eyes-receipt/spec.md` ("Amended 2026-09-24") still names the decisions this implementation uses (receipt-triage D4, D16), and amend it with a date if any number moved during implementation.
- [ ] T048 Run every gate in CI order (as T001) and record the new counts beside T001's; `node scripts/spec-lint.mjs` must list no new file without a citation.
- [ ] T049 By hand, per [quickstart.md](./quickstart.md): upload receipt 1 and receipt 2 to the seeded link at 360px and read the screen; add a card in Cuenta and copy it from the link; record what was seen, dated, in this task's notes.
- [ ] T050 Run `/speckit-analyze` on spec, plan and tasks; fold its findings back with dated notes, as two-eyes-receipt did; the feature is done only with no CRITICAL finding (constitution, Development Workflow).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T002)**: no dependencies.
- **Foundational (T003–T013)**: after Setup. T004 after T003; T008 after T007; T013 after T007. T009–T012 are parallel with each other and with T005–T008. **Blocks every story.**
- **US1 (T014–T024)**: after Foundational.
- **US2 (T025–T030)**: after Foundational. Its rule reads the gate's reference verdict (T008), so a reference-only receipt is never stopped even if US2 ships before US1 — it simply takes today's flow until US1 uses the reference. Building US1 first is still the order the spec recommends (Story 1, "Why this priority").
- **US3 (T031–T041)**: after Foundational; independent of US1 and US2. T037 extends the `ask.ts` T025 creates — if US3 is built before US2, T037 creates the file with the `wrong_destination` branch only and T025 adds `no_key`.
- **US4 (T042–T045)**: after Foundational (it reads T012's hints); independent of every other story.
- **Polish (T046–T050)**: after the stories that ship.

### Within each story

Tests are written first and fail; pure modules before the engine; the engine
before the lifecycle; contracts and handlers before the page; each story ends
at its checkpoint with every existing test still green.

### Shared files

`apps/api/src/consta/validate.ts`, `consta/extract.ts`,
`direct-payments/validation.ts`, `routes/direct-payments/{schema,handler}.ts`,
`PaymentPage.tsx` and `pago.test.tsx` are touched by more than one story: two
stories built in parallel merge there. Tasks on those files are never `[P]`
with each other.

## Parallel Examples

**Foundational**, once T003–T008 are in:

```text
T009 test helpers        (apps/api/test/consta/helpers.ts)
T010 sandbox             (apps/api/sandbox/apicep-mock.mjs)
T011 env comment         (apps/api/src/env.ts)
T012 bank hints          (apps/pago/src/features/pago/bank-hints.ts)
```

**US1** — the three test tasks together, then the implementation in order:

```text
T014 comparison tests → T015 gate tests (same file)  |  T016 lifecycle tests
→ T017 compare.ts → T018 validate/extract → T020 validation.ts → T021 schema → T022 handler → T023 page
T024 page tests in parallel with T019
```

**US3** — pure and settings work in parallel:

```text
T031 tieDestination tests → T033 engine/lifecycle tests (same file)  |  T032 settings tests
T034 destination.ts        |  T035 settings route
→ T036 → T037 → T038 → T039 → T040 (panel) | T041 (page)
```

**US4** — T042 and T044 together, then T043, then T045.

## Implementation Strategy

### MVP first (User Story 1)

1. Setup, then Foundational (including T013's measurement).
2. US1: receipt 2 confirms, typed references work, one transfer still pays
   once, the ambiguous reference is handled.
3. **Stop and validate** with quickstart § User Story 1; it can ship alone —
   nothing is asked that was not asked before.

### Incremental delivery

1. US1 → ship.
2. US2 → receipt 1 costs nothing and the payer is guided → ship.
3. US3 → card and phone → ship; an ISP adds them when it wants.
4. US4 → the guide → ship.

Each increment leaves every earlier outcome as it was (SC-012), and each can
be validated by its quickstart section alone.

### Notes

- A task's notes record what was measured or run, with the date and the
  commit, as two-eyes-receipt's tasks do.
- A shortcut taken on purpose is registered with `/speckit-debt-log` the same
  day (constitution, Development Workflow).
