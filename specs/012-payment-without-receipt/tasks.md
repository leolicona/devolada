---

description: "Task list for payment-without-receipt"
---

# Tasks: payment-without-receipt

**Input**: Design documents from `/specs/012-payment-without-receipt/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: mandatory here, not optional. Constitution IV puts the lifecycle
and reference tests in workerd against a real D1, with apiCEP and WispHub
intercepted at their pinned origins; the matcher's new modes are pure
tables; the page and the panel test on happy-dom with MSW and axe; sizes,
focus and themes of the new controls in Playwright. Constitution VII: every
new test cites `payment-without-receipt US<n>`. Tests are written first and
fail before the code beneath them lands.

**Organization**: grouped by user story. The schema, the phone rule, the
adapter capability, the switch and the test helpers are shared, so they are
Foundational. US1 (the reference) is the MVP and ships alone: payers can
already put a reference no one else has. US2 (the confirmation) makes it
receipt-free. US3 (learning) and US4 (read-back and ladder) build on US2;
US5 ("No puse la referencia") on US2 and US3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US5, mapping to the spec's user stories
- Every task names the file it touches

## Decision citations

Code comments cite `payment-without-receipt D<n>`, tabled in
[plan.md](./plan.md#decisions) (D1–D23). Where a comment today says
something this feature makes false, the task that changes the code beneath
it rewrites the comment: receipt-triage D7's shared-reference stops (D9),
spec 013 D5's "clave-less searches only" in `consta/bundle/store.ts` and
`db/schema.ts` (D13), the `validations.quota_remaining` comment (D19), and
the follow-up in `.specify/bugs/reference-search-printed-day/fix.md` that
left the misremembered day to this spec (D14).

**Unchanged on purpose** (spec Assumptions; plan Constraints): with
`pay_by_reference = 0`, every path is today's; rows without a
`reference_source` keep today's schedule, stops and asks; the WispHub half,
partial and overpayment rules, the fee, spec 013's matcher in `receipt`
mode, the provisional release and its history rules, and the receipt path.
A link row never holds a phone or a name (links-on-demand-search FR-010).

---

## Phase 1: Setup

**Purpose**: know what green looks like; get the two facts only the creator can bring.

- [ ] T001 Baseline: `pnpm install --frozen-lockfile`, then every gate in CI order — `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test` — and record in this task's notes (`specs/012-payment-without-receipt/tasks.md`) the commit and the test counts of `apps/api` (and of `apps/api/test/direct-payment.test.ts`, `apps/api/test/cep-bundle-match.test.ts`, `apps/api/test/consta/match.test.ts`), `apps/pago`, `apps/admin` and `packages/ui`. A gate already red proves nothing later.
- [ ] T002 The creator's two checks (quickstart "Before tasks"; research R4, R19): (a) in the pilot business's WispHub, count customers with no phone and phones held by more than one customer (and by more than three) — record the numbers, never a phone, in `specs/012-payment-without-receipt/research.md` under R4; (b) in Banco Azteca's app, note where a numeric reference is typed when sending and whether a saved contact keeps it, with the date — the source of T052. **Needs the creator.** Blocks release, not code; if (a) shows "more than three" is the wrong line, amend FR-002/D4 before T013.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the tables, the phone rule, the adapter's new capability, the
switch, the test helpers and the sandbox. None of it changes what a payer
sees on its own: the switch is off by default.

**⚠️ CRITICAL**: T003–T008 land before any story task.

- [ ] T003 Schema and migration (data-model.md): in `apps/api/src/db/schema.ts` add `payerReferences` (unique `(business_id, digits)` over all states; `origin`, `state`, `state_reason`, `changed_by_user_id`, `created_at`, `changed_at`), `payerReferenceCustomers` (primary key `(business_id, source, customer_key)`, index `(reference_id)`), `providerQuota` (primary key `provider`; no `business_id`, comment "a platform row, like `platform_settings`"); `businesses.payByReference` (integer, default 0); `payments.referenceSource`, `ladderRound` (default 0), `correctionCount` (default 0), `claveTail`, `senderAccountNew`, `confirmation` (JSON). Each column's comment says what it means and cites its decision. Generate with `pnpm --filter @devolada/api db:generate`, name it `apps/api/migrations/0041_payment_without_receipt.sql` with a header comment in the style of `0040_cep_bundle_match.sql` (additive; old rows read NULL or 0), and apply with `db:migrate:local`.
- [ ] T004 [P] The phone rule (`payment-without-receipt D2`): create `apps/api/src/phone.ts` with `nationalPhone(raw)` — ten digits after removing a leading `52` or `521`, else null; rebuild `toWhatsAppPhone` in `apps/api/src/receipt/index.ts` as `52` + `nationalPhone`, same outputs. Tests in a new `apps/api/test/phone.test.ts` (cite `payment-without-receipt US1`): `5512345678`, `+52 55 1234 5678`, `521…`, dashes and spaces → ten digits; eight digits, two numbers in one field, empty → null; every existing `toWhatsAppPhone` case unchanged.
- [ ] T005 [P] Adapter capability `customersWithPhone` (`payment-without-receipt D4`, contracts/engine.md): declare it in `apps/api/src/integrations/capabilities.ts` beside `receivables` and `customerDebt`; implement it in `apps/api/src/wisphub/client.ts` — `telefono__contains=<last seven>` on the customers list, paged at 50 to the end, each result's `telefono` through `nationalPhone`, kept only when equal — and register its name in `apps/api/src/wisphub/receivables.ts`. The filter's words and paging stay in `wisphub/` (constitution IX). Tests in a new `apps/api/test/payer-reference.test.ts` (cite `payment-without-receipt US1`), WispHub at its pinned origin with `fetchMock`: exact matches only (a `…2345678` in another area code is left out), two pages read to the end, a refused key throws `IntegrationError`.
- [ ] T006 [P] The switch (`payment-without-receipt D20`, contracts/panel.md): `payByReference` in `settingsResponse` and `settingsPatchRequest` in `apps/api/src/routes/settings/schema.ts`, read and written in `apps/api/src/routes/settings/handler.ts` under `settings: update`; the toggle with its sentence in `apps/admin/src/features/settings/SettingsScreen.tsx`. Tests: `apps/api/test/settings.test.ts` (cite `payment-without-receipt US1`: owner and admin set it, an operator gets 403, default false) and `apps/admin/test/settings.test.tsx` (the toggle, its copy, axe).
- [ ] T007 [P] Test helpers in a new `apps/api/test/payer-helpers.ts`: a business with `pay_by_reference = 1` and a registered CLABE; WispHub customers with phones answered through `fetchMock` (by usuario and by `telefono__contains`); apiCEP transfer answers keyed by reference and day — `valid` (with `cdaChain`, `senderAccount`, `processingTime`), several (a bundle built with `test/consta/bundle-fixtures.ts`), not found, and `429` with `X-RateLimit-Remaining`; a clock that steps a payment through its schedule slots and runs `sweepDirectPayments`; a counter of provider calls.
- [ ] T008 [P] Sandbox scenarios in `apps/api/sandbox/apicep-mock.mjs` (quickstart table): a search by reference answers by what the reference ends in — `…11` valid on the day asked, `…22` valid only on the day before, `…33` two CEPs from one account (07:11, 07:13), `…44` two CEPs from two accounts (tails 8301, 4417); anything else not found. Reuse the several scenario's synthetic CEP builder.

**Checkpoint**: every gate green; nothing a payer or an operator sees has changed.

---

## Phase 3: User Story 1 — The payer knows their reference before they pay (P1) 🎯 MVP

**Goal**: every customer of a business with the feature on has a seven-digit
number that no other person in the business has — their phone's last seven
when that is safe, an assigned number otherwise — shown on the link, in the
share message, on `/v1`, and to the operator.

**Independent Test**: quickstart § User Story 1.

### Tests for User Story 1 (write first, see them fail)

- [ ] T009 [US1] Reference rules in `apps/api/test/payer-reference.test.ts` (cite `payment-without-receipt US1`), through `ensurePayerReference` with WispHub intercepted: (a) a phone alone → its last seven, `origin = "phone"`, one holder row; (b) two customers with one phone → the same reference; three → the same; (c) four → the digits `blocked` (`shared_by_many`) and an assigned number each; (d) a fourth customer added later → assigned, the first three keep theirs; (e) no phone, and an API customer → assigned; (f) D3 — phones ending `2345678`, `0000000`, `7654321`, `0123456`, and the last seven of a registered CLABE, card or phone account, a retired one included → assigned; (g) another phone with the same last seven already a reference → assigned; (h) an assigned number has seven digits, first 1–9, is not generic, and a forced clash draws again; (i) WispHub down or a refused key → null, no row written; (j) reset → the old row `retired` with who and when, a new assigned number, the other holders keep theirs, and the old digits are never drawn again; (k) not personal → `blocked`, each holder its own assigned number; on an assigned reference → 409 `NOT_A_PHONE_REFERENCE`; (l) a link pruned and made again finds the same reference; (m) the backfill assigns at most twenty links per business per minute, skips businesses with the switch off, and says nothing when there is nothing to do; (n) `payments:read` reads a profile, `payments:operate` is needed for reset and not-personal.
- [ ] T010 [P] [US1] Contract tests (cite `payment-without-receipt US1`): in a new `apps/api/test/payment-without-receipt.test.ts`, `GET /direct-payments/links/:token` answers `payerReference { digits, fromPhone, proven: false }`, null with the switch off, and makes the reference on the first read when the link has none; `POST /direct-payments/links` answers a `waLink` whose message carries the digits; `customerRow.payerReference` with `sharedWith`; in `apps/api/test/collections-api-links.test.ts`, `/v1` `paymentLink.payerReference` on create, list, get and patch, the same for a reusable and a one-time link of one `customerRef`, null with the switch off. `apps/api/test/links-identity-only.test.ts` stays green untouched: no phone, no name on the link row.
- [ ] T011 [P] [US1] Page tests in a new `apps/pago/test/payment-without-receipt.test.tsx` (cite `payment-without-receipt US1`): step 1 shows "Tu referencia" as `234 5678`, the copy button copies `2345678`, "Son los últimos 7 números de tu celular" only when `fromPhone`, the general where-to-type sentence (and a verified entry's words when `REFERENCE_HINTS` has the bank), the save-as-contact tip, the concepto unchanged; with no `payerReference`, step 1 is today's; a capture whose reference differs from the payer's own is accepted and the page reminds them of their reference (US1 scenario 6); axe clean.
- [ ] T012 [P] [US1] Panel tests in a new `apps/admin/test/payment-without-receipt.test.tsx` (cite `payment-without-receipt US1`): a Links row shows "Ref. 234 5678 · celular", "Ref. 781 2044 · asignada" and "· compartida con 1"; the profile sheet opens with the reference and who shares it; reset and "no es personal" ask with their dialogs' copy (contracts/panel.md) and refresh the row; a viewer sees neither action; axe clean.

### Implementation for User Story 1

- [ ] T013 [US1] Create `apps/api/src/direct-payments/payer-reference.ts` (contracts/engine.md; `payment-without-receipt D1`, `D3`–`D6`): `ensurePayerReference(db, env, business, integration, customer)` in the four steps of the contract; `assignNumber` drawn with `crypto.getRandomValues` and inserted under the unique index, drawing again on a clash; the D3 test using `isGenericReference` and `registeredAccounts` (`direct-payments/accounts.ts`), retired accounts included; `referenceOf(link)`, `holdersOf(reference)`, `isProven(reference)`; `resetReference` and `markNotPersonal` with the acting user. Never a phone written anywhere.
- [ ] T014 [US1] Where a reference is born (`payment-without-receipt D5`): after `ensureLink` in `createLink` (`apps/api/src/routes/direct-payments/handler.ts`, the customer already read), in the `/v1` create of `apps/api/src/routes/v1/payment-links/handler.ts`, lazily in `getLinkStatus`, and in `backfillPayerReferences(env, db, now)` in `payer-reference.ts`, wired into the every-minute chain in `apps/api/src/index.ts` after `sweepDirectPayments` — twenty links per business per minute, silent when idle.
- [ ] T015 [US1] Contracts (contracts/payment-page.md, panel.md, public-api.md; `payment-without-receipt D22`): `linkStatusResponse.payerReference` in `apps/api/src/routes/direct-payments/schema.ts`, built in `getLinkStatus`; `customerRow.payerReference` built in `panelCustomerRow`, `apiCustomerRow` and `panelLinksMatching` from the holder rows; `shareText` gains "Tu referencia para transferir: 234 5678" when the business has the feature on; `/v1` `paymentLink.payerReference` in `apps/api/src/routes/v1/payment-links/schema.ts` and `toPublic`.
- [ ] T016 [US1] The profile routes (contracts/panel.md): `GET /direct-payments/payer-profiles/:linkId` (`payments: read`), `POST …/:linkId/reset` and `POST …/:linkId/not-personal` (`payments: operate`) in `apps/api/src/routes/direct-payments/{index,handler,schema}.ts` — the router stays pure; `payerProfileResponse` exported; `banks` and `accounts` answer empty arrays until T035.
- [ ] T017 [US1] The page's step 1 in `apps/pago/src/features/pago/PaymentPage.tsx`: "Tu referencia" `CopyField` (grouped `234 5678`, copies the digits), the `fromPhone` line, the where-to-type line from a new `apps/pago/src/features/pago/reference-hints.ts` (`REFERENCE_HINTS` empty, `GENERAL_REFERENCE_HINT` = "Escríbela en «Referencia numérica», no en «Concepto».", the entry rule of receipt-triage D19 in its comment), the save-as-contact tip; in the receipt step, the reminder when the capture's reference differs from `payerReference.digits`.
- [ ] T018 [US1] The panel: the reference line in `CustomerLine` of `apps/admin/src/features/links/LinksScreen.tsx`; a new `apps/admin/src/features/links/PayerProfile.tsx` (the existing `Sheet`, two `AlertDialog`s with contracts/panel.md's copy, `payments:operate` gating via `roleCan`), opened from the row.

**Checkpoint**: quickstart § User Story 1 passes; US1 can ship alone — payers
can already put a reference no one else in the business has.

---

## Phase 4: User Story 2 — The payer confirms with bank and day (P1)

**Goal**: "Confirmar pago" with the bank and the day searches by the payer's
own reference, confirms what Banxico holds, takes one of several of the
payer's own transfers without asking, and retries the same day and then the
neighbouring days.

**Independent Test**: quickstart § User Story 2.

### Tests for User Story 2 (write first, see them fail)

- [ ] T019 [US2] Lifecycle tests in `apps/api/test/payment-without-receipt.test.ts` (cite `payment-without-receipt US2`), with `payer-helpers.ts`: (1) found on the day given → confirmed, clave and credit time recorded, the action queued, one provider call, `reference_source = "own"`; (2) nothing → the next slot searches the same day and nothing is asked; (3) several on the own reference → the earliest unused confirms, the other stays kept and appears in the unmatched transfers; a second service of the same phone at the same price confirms with the other and never meets `REFERENCE_SHARED`; (4) validated before → `TRANSFER_ALREADY_USED`, and the status names the payment that used it; (5) scenario 5 — round 3 searches the day before and the day after (never after today, never the operation day), confirms on the neighbour that holds it, and `confirmation.days` lists every day searched; (6) "Pagué otra cantidad" searches the typed amount, and a match settles by the existing partial rules; (7) `proven` is false until an own confirmation, then true on every service sharing the reference; (8) with the provisional release on and a clean history, a first `not_found` releases with `human` evidence. Also: the server ignores a `referenceNumber` sent with `own`; `REFERENCE_NOT_READY` with the switch off or no reference; `TRANSFER_DATE_OUT_OF_RANGE` for tomorrow and for 31 days ago, judged in the business's timezone; a `429` leaves `ladder_round` where it was; a row without `reference_source` keeps today's schedule and its `REFERENCE_SHARED` stop (regression).
- [ ] T020 [P] [US2] Matcher tables in `apps/api/test/consta/match.test.ts` (cite `payment-without-receipt US2`): `own` mode keeps integrity (amount and account drop as in `receipt` mode), drops used claves, takes the earliest credited, says `all_used` when every candidate is used, and never `no_signal`, `too_close` or `none_fit`; every existing `receipt` table unchanged.
- [ ] T021 [P] [US2] Page tests in `apps/pago/test/payment-without-receipt.test.tsx` (cite `payment-without-receipt US2`): step 2 opens on "Confirma tu pago"; the question when `proven` is false (*Sí* continues, *No* spends nothing); the bank `ChoiceGroup` and "Otro banco"; "Hoy, martes 29" and "Ayer, lunes 28" computed in the business's timezone, "Otro día" bounded to the last 30 days; the read-back follows every choice; **Confirmar pago** sends `{ referenceSource: "own", senderBank, date, preselected }` and no reference; "Pagué otra cantidad" adds `amountCents` and changes the read-back; the exits; keyboard only; `REFERENCE_NOT_READY` falls back to the receipt step; axe clean.
- [ ] T022 [P] [US2] Feed tests (cite `payment-without-receipt US2`): in `apps/api/test/payment-without-receipt.test.ts`, `GET /payments/feed` answers `referenceSource` and `decidedBy: "earliest"`; in `apps/admin/test/payment-without-receipt.test.tsx`, the charge row shows "Con su referencia" beside its `StatusBadge`.

### Implementation for User Story 2

- [ ] T023 [US2] The pay contract (`payment-without-receipt D8`, `D9`, `D23`): `transfer.referenceSource` and `transfer.preselected` in `payRequest` (`apps/api/src/routes/direct-payments/schema.ts`), the key refinement accepting `own` without a key; in `submitPayment` (`handler.ts`) — `own` writes `referenceOf(link)` into `reference_number` and ignores any sent, refuses `REFERENCE_NOT_READY`, bounds the day to today − 30 … today with `businessWallClock`, writes `reference_source` and `confirmation`, and skips the typed `409 REFERENCE_SHARED`; rewrite that receipt-triage D7 comment to say which rows it still guards.
- [ ] T024 [US2] Matcher `own` mode (`payment-without-receipt D10`): `MatchMode` in `apps/api/src/consta/bundle/types.ts`; `matchCandidates(…, mode)` in `apps/api/src/consta/bundle/match.ts` — integrity → used → earliest `creditedAt`, `by: "earliest"`, undecided only as `all_used`; `receipt` mode byte for byte as today. Still pure.
- [ ] T025 [US2] The lifecycle in `apps/api/src/direct-payments/validation.ts` (`payment-without-receipt D9`, `D14`): rows with a `reference_source` skip the pre-call shared-reference stop; the matcher runs in `own` mode for them (`cep-match.ts` passes it); `ladder_round` rises only on an attempt that got a provider answer (a `429`, an outage or no credential is not a round); round 3 searches each neighbouring day once — the day before, and the day after when it is not after today — and never the operation day; `confirmation.days` gains every day searched. Add the dated note to `.specify/bugs/reference-search-printed-day/fix.md`: scenario 5 is built here.
- [ ] T026 [US2] Status: `referenceSource` and `searchedDays` in `directPaymentStatusResponse` (`apps/api/src/routes/direct-payments/schema.ts`), set by `getDirectPaymentStatus` (`apps/api/src/routes/direct-payments/handler.ts`).
- [ ] T027 [US2] The page's step 2 (`payment-without-receipt D21`): create `apps/pago/src/components/ui/choice-group.tsx` (native radio inputs, tokens only, 48px items, visible focus, the chosen one marked by icon and text; its comment cites D21 and the native-select's reasons) and `apps/pago/src/features/pago/ConfirmPayment.tsx` (the first-time question, the bank row, the day row, the read-back, the decisive 64px **Confirmar pago**, "Pagué otra cantidad", "No puse la referencia", "Sube tu comprobante"); render it as step 2's first view in `PaymentPage.tsx` when `payerReference` is present; the step memory (`step.ts`) unchanged.
- [ ] T028 [US2] The feed: `referenceSource` and `decidedBy` in `feedCharge` (`apps/api/src/routes/payments/schema.ts`), built in `apps/api/src/routes/payments/handler.ts` from the row and `match_trail`; the text beside the `StatusBadge` in `apps/admin/src/features/feed/FeedScreen.tsx`.

**Checkpoint**: quickstart § User Story 2 passes; a payer confirms without a
capture.

---

## Phase 5: User Story 3 — Devolada remembers how each customer pays (P2)

**Goal**: a returning payer's bank is preselected; "Otro banco" starts with
the business's usual banks; an account learned for a service picks its
transfer among several; a new account is marked for the operator; no
account digit ever reaches a payer.

**Independent Test**: quickstart § User Story 3.

### Tests for User Story 3 (write first, see them fail)

- [ ] T029 [US3] Lifecycle tests in `apps/api/test/payment-without-receipt.test.ts` (cite `payment-without-receipt US3`): (1) a receipt payment confirmed before the feature from Azteca → `learnedBanks: ["AZTECA"]`; (2) payments from Azteca and Nu → both, the most recent first, across every service sharing the reference; (3) `bankOrder` counts this business's last 90 days only — another business's rows never move it; (4) several on the own reference, one from an account learned for **this** service → that one, `by: "learned_account"`, even when not the earliest; an account learned only for the other service of the same phone does not decide; (5) a confirmation from a new account → confirmed and `sender_account_new = 1`; the first confirmation ever → NULL; (6) D13 — a `valid` found by clave writes a `cep_records` row; a platform top-up writes none; (7) every payer-facing response of the feature (link read, pay, status) contains no digit run of any learned account — a JSON scan.
- [ ] T030 [P] [US3] Matcher tables in `apps/api/test/consta/match.test.ts` (cite `payment-without-receipt US3`): in `own` mode, `knownAccounts` puts whole-account matches first, then the earliest; an empty list changes nothing.
- [ ] T031 [P] [US3] Page tests in `apps/pago/test/payment-without-receipt.test.tsx` (cite `payment-without-receipt US3`): the most recent learned bank is preselected; "Otro banco" lists `bankOrder` first, then the rest in es-MX order; `preselected` reports what was offered.
- [ ] T032 [P] [US3] Panel tests (cite `payment-without-receipt US3`): in `apps/api/test/payer-reference.test.ts`, the profile answers `banks` and `accounts` with the last four digits only; in `apps/admin/test/payment-without-receipt.test.tsx`, the profile lists them and the feed shows "Cuenta nueva".

### Implementation for User Story 3

- [ ] T033 [US3] Records for every `valid` (`payment-without-receipt D13`): in `apps/api/src/consta/validate.ts` call `storeSingleRecord` for every `valid` of a business, clave searches included; rewrite spec 013 D5's "clave-less only" comments in `apps/api/src/consta/bundle/store.ts` and `apps/api/src/db/schema.ts`.
- [ ] T034 [US3] Learned queries in `apps/api/src/direct-payments/payer-reference.ts` (`payment-without-receipt D7`, `D12`): `learnedBanks(reference)` per person, `learnedAccounts(link)` per service (`cep_records` joined on adopted claves, business-filtered), `bankOrder(business)`.
- [ ] T035 [US3] Wire them: `knownAccounts` in `ReceiptSide` and its preference in `own` mode (`apps/api/src/consta/bundle/{types,match}.ts`, `by: "learned_account"`); `receiptSideOf` in `apps/api/src/direct-payments/cep-match.ts` passes the service's learned accounts; `sender_account_new` written on confirmation in `validation.ts`; `learnedBanks` and `bankOrder` in `linkStatusResponse`; `banks` and `accounts` (last four) in `payerProfileResponse`; `senderAccountNew` in `feedCharge`.
- [ ] T036 [US3] Screens: `apps/pago/src/features/pago/ConfirmPayment.tsx` orders and preselects from `learnedBanks` and `bankOrder`; `apps/admin/src/features/links/PayerProfile.tsx` lists banks and accounts; `apps/admin/src/features/feed/FeedScreen.tsx` shows "Cuenta nueva".

**Checkpoint**: quickstart § User Story 3 passes; a returning payer confirms in one tap.

---

## Phase 6: User Story 4 — The read-back and the ladder (P2)

**Goal**: while it validates, the payer sees what is searched and can
correct it; a transfer not found asks for the data after round 3 and the
clave after round 4, with the receipt beside it; two more rounds, then
expiry — seven calls at most.

**Independent Test**: quickstart § User Story 4.

### Tests for User Story 4 (write first, see them fail)

- [ ] T037 [US4] Lifecycle tests in `apps/api/test/payment-without-receipt.test.ts` (cite `payment-without-receipt US4`), stepping the clock: on a reference never found — rounds 1–3 ask nothing; `ask: "check_data"` after round 3; round 4 at the third slot; `ask: "clave"` after round 4; rounds 5 and 6 at the 2-hour slot and the last one (720 on `not_found`); `expired` after; seven provider calls at most (SC-003). A correction carries `ladder_round` and `correction_count`, searches at once and, after round 3, is round 4; an identical correction spends nothing; a fourth search-spending correction without a clave → `409 CORRECTIONS_EXHAUSTED`, with a clave → accepted; a clave given at any point is searched at once; a correction after confirmation is refused and the status stays confirmed; an ask never withdraws a standing release; a receipt sent from the ask supersedes the row and a validating receipt leaves no burned ride (`isRevoked` false); `429`s do not advance the asks.
- [ ] T038 [P] [US4] Page tests in `apps/pago/test/payment-without-receipt.test.tsx` (cite `payment-without-receipt US4`): the read-back under "Ver los datos que enviaste" with **Corregir** on every non-final state; the copy of each `ask` (contracts/payment-page.md); "Todo está bien" hides `check_data` and is remembered for that payment on the device (`localStorage` cleared `beforeEach`); the clave ask focuses the clave with "Sube tu comprobante" beside it; the release sentence when a release stands; `CORRECTIONS_EXHAUSTED` copy; a sourced row never opens the form because `validationAttempts ≥ 5`; the waiting copy inside `<Pending>`; axe clean.

### Implementation for User Story 4

- [ ] T039 [US4] The ladder's tail in `apps/api/src/direct-payments/validation.ts` (`payment-without-receipt D14`): on sourced rows, after round 4 the next slots are the 2-hour one and the last (the late slot on `not_found`), then `expired`; in `submitPayment` (`handler.ts`), a correction inherits `ladder_round` and `correction_count` from the row it supersedes and counts itself.
- [ ] T040 [US4] The correction cap (`payment-without-receipt D16`): `409 CORRECTIONS_EXHAUSTED` in `submitPayment` (`apps/api/src/routes/direct-payments/handler.ts`) for a fourth search-spending correction with neither a clave nor a receipt; the code in the pay error list of `apps/api/src/routes/direct-payments/schema.ts`.
- [ ] T041 [US4] The ask (`payment-without-receipt D15`): `ask` in `directPaymentStatusResponse` (`apps/api/src/routes/direct-payments/schema.ts`), derived in `getDirectPaymentStatus` (`apps/api/src/routes/direct-payments/handler.ts`) from `ladder_round` and `last_error` on sourced rows (`check_data`, `clave`; data-model.md "The ask").
- [ ] T042 [US4] The page: in `PaymentPage.tsx`, the validating view of sourced rows — the read-back, **Corregir**, the asks by `ask` with their copy, the release sentence, `CORRECTIONS_EXHAUSTED`; "Todo está bien" remembered per payment in a new `apps/pago/src/ask-ack.ts` (the pattern of `step.ts`: `try`/`catch`, unreadable means not acknowledged); the sourced rows no longer open the form by `validationAttempts`.

**Checkpoint**: quickstart § User Story 4 passes.

---

## Phase 7: User Story 5 — "No puse la referencia" (P3)

**Goal**: a payer who used another reference types it; a learned account or
the last four digits of their account tie the transfer to them; a
reference that is someone else's is refused; the clave's last four
characters choose among kept candidates.

**Independent Test**: quickstart § User Story 5.

### Tests for User Story 5 (write first, see them fail)

- [ ] T043 [US5] Lifecycle tests in `apps/api/test/payment-without-receipt.test.ts` (cite `payment-without-receipt US5`): another person's reference (active or blocked) → `409 REFERENCE_OF_ANOTHER`; the payer's own typed → handled as `own`; no tail and no account learned for this service at that bank → `409 SENDER_TAIL_NEEDED` with no row and no call; a learned account ties one transfer → confirmed, nothing asked, `by: "learned_account"`; four digits fit one → confirmed, `by: "sender_tail"`; four digits fit none → nothing confirmed, `ask: "clave"`; a learned account but no fit and no digits → validating with its candidates kept and `ask: "sender_tail"`, and a correction with the four digits confirms without a call; the `…44` bundle with nothing that picks → `CEP_UNDECIDED` and `ask: "clave_tail"`; a clave tail that fits one kept candidate → confirmed from the record with no call; two candidates sharing the four → `ask: "clave"`; a typed reference not found rides the same ladder as US4.
- [ ] T044 [P] [US5] Matcher tables in `apps/api/test/consta/match.test.ts` (cite `payment-without-receipt US5`): `typed` mode — `knownAccounts`, then the tail, undecided otherwise; `fitClaveTail` — O read as 0 and I as 1 on both sides, exactly one fit or null, never a candidate outside the list.
- [ ] T045 [P] [US5] Page tests in `apps/pago/test/payment-without-receipt.test.tsx` (cite `payment-without-receipt US5`): "No puse la referencia" (from the question and from step 2) opens the typed form with its label; `SENDER_TAIL_NEEDED` shows the four-digit field; `REFERENCE_OF_ANOTHER` copy; the `sender_tail` and `clave_tail` asks; "Sube tu comprobante" second everywhere; axe clean.

### Implementation for User Story 5

- [ ] T046 [US5] The contract (`payment-without-receipt D11`, `D17`): `referenceSource: "typed"`, `senderTail`, `claveTail` (requires `supersedes`) in `payRequest` (`apps/api/src/routes/direct-payments/schema.ts`); in `submitPayment` (`apps/api/src/routes/direct-payments/handler.ts`), `REFERENCE_OF_ANOTHER` and `SENDER_TAIL_NEEDED` before anything is created or billed, `sender_tail` and `clave_tail` written.
- [ ] T047 [US5] The matcher (`payment-without-receipt D11`, `D17`): `typed` mode in `apps/api/src/consta/bundle/match.ts` (integrity → used → `knownAccounts` → tail; `by: "learned_account" | "sender_tail"`) and `fitClaveTail(tail, candidates)` beside `fitClave`.
- [ ] T048 [US5] The lifecycle in `apps/api/src/direct-payments/validation.ts`: typed rows run the matcher in `typed` mode with the service's learned accounts at the chosen bank and the typed tail; no fit without a tail keeps the candidates on a validating row with no next slot; a superseding row with `sender_tail` is fitted against the superseded row's candidates without a call, and one with `clave_tail` through `fitClaveTail`, as spec 013 D11 does for a whole clave.
- [ ] T049 [US5] The asks and the page: `sender_tail` and `clave_tail` in the `ask` derivation (`apps/api/src/routes/direct-payments/handler.ts`); in `apps/pago/src/features/pago/PaymentPage.tsx`, the typed path from "No puse la referencia" (the existing `TransferForm` labelled for it), the four-digit field, both asks and the refusals' copy.

**Checkpoint**: quickstart § User Story 5 passes.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T050 [P] The quota (`payment-without-receipt D19`, FR-038): the `provider_quota` upsert in `apps/api/src/consta/provider/apicep.ts` beside the telemetry (a failed upsert is a lost observation, never a failed validation; rewrite the `quota_remaining` comment in `db/schema.ts`); `GET /platform/provider-quota` in `apps/api/src/routes/platform/{index,handler,schema}.ts`; the line in the "Reglas" tab of `apps/admin/src/features/operator/OperatorScreen.tsx`. Tests (cite `payment-without-receipt US4`): in `apps/api/test/consta/validate.test.ts`, the header upserts and a later answer overwrites; in `apps/api/test/payment-without-receipt.test.ts`, only a platform operator reads it; in `apps/admin/test/payment-without-receipt.test.tsx`, the line and its absence when null.
- [ ] T051 [P] The browser layer in `tests/e2e/pago.spec.ts` with stubs in `tests/e2e/stubs.ts` validated by the exported schemas (cite `payment-without-receipt US2`): step 1 and "Confirma tu pago" at 360, 768 and 1280 in both themes — 48px choices, the 64px **Confirmar pago**, a measured focus ring, no horizontal scroll, axe with contrast and target size on.
- [ ] T052 [P] Banco Azteca's where-to-type entry from T002 (b): `REFERENCE_HINTS.AZTECA` in `apps/pago/src/features/pago/reference-hints.ts` with its `source` and `verified` date; the page test of T011 asserts its words. **Needs T002.**
- [ ] T053 Comments and records: sweep the comments listed under "Decision citations" (`apps/api/src/direct-payments/validation.ts`, `apps/api/src/routes/direct-payments/handler.ts`, `apps/api/src/consta/bundle/store.ts`, `apps/api/src/db/schema.ts`) and rewrite what became false; add to the invariants of `CLAUDE.md` one bullet — a payer's reference belongs to a person inside one business, is never a phone stored, and lives beside the link, not on it (`payment-without-receipt D1`).
- [ ] T054 Run `specs/012-payment-without-receipt/quickstart.md` end to end on the sandbox and every gate in CI order; record in this task's notes (`specs/012-payment-without-receipt/tasks.md`) the commit and the test counts against T001's.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T002)**: T001 first. T002 needs the creator and blocks release only (and T052).
- **Foundational (T003–T008)**: after T001. T004–T008 in parallel after T003. **Blocks every story.**
- **US1 (T009–T018)**: after Foundational.
- **US2 (T019–T028)**: after US1's T013–T015 (a confirmation needs a reference).
- **US3 (T029–T036)**: after US2's T024–T025 (the `own` matcher and the lifecycle it extends) and US1's T016 (the profile).
- **US4 (T037–T042)**: after US2 (T023, T025, T026); independent of US3.
- **US5 (T043–T049)**: after US2 and US3 (it needs learned accounts), and US4's T041 (the `ask` field).
- **Polish (T050–T054)**: T050 and T051 after US2; T052 after T002; T053 and T054 last.

### Within each story

Tests first and failing; pure modules (matcher, phone) before the
lifecycle; schemas and handlers before the page and the panel; each story
ends at its checkpoint with every existing test green.

### Shared files

`apps/api/src/direct-payments/validation.ts`, `apps/api/src/routes/direct-payments/{schema,handler}.ts`,
`apps/api/src/consta/bundle/{match,types}.ts`, `apps/api/src/direct-payments/payer-reference.ts`,
`apps/api/test/payment-without-receipt.test.ts`, `apps/api/test/payer-reference.test.ts`,
`apps/api/test/consta/match.test.ts`, `PaymentPage.tsx`, `ConfirmPayment.tsx`,
`apps/pago/test/payment-without-receipt.test.tsx`, `apps/admin/test/payment-without-receipt.test.tsx`
are touched by more than one task; tasks on the same file are never `[P]`
with each other.

## Parallel Examples

**Foundational**, once T003 is in:

```text
T004 phone rule      (apps/api/src/phone.ts, receipt/index.ts)
T005 capability      (integrations/capabilities.ts, wisphub/client.ts)
T006 switch          (routes/settings, SettingsScreen.tsx)
T007 test helpers    (apps/api/test/payer-helpers.ts)
T008 sandbox         (apps/api/sandbox/apicep-mock.mjs)
```

**US1**:

```text
T009 reference rules  |  T010 contracts  |  T011 page  |  T012 panel
→ T013 → T014 → T015 → T016 (API)  |  T017 page  |  T018 panel
```

**US2**: T019 | T020 | T021 | T022 → T023 → T024 → T025 → T026 (API) | T027 page | T028 feed.

**US3**: T029 | T030 | T031 | T032 → T033 | T034 → T035 → T036.

**US4**: T037 | T038 → T039 → T040 → T041 (API) | T042 page.

**US5**: T043 | T044 | T045 → T046 | T047 → T048 → T049.

## Implementation Strategy

### MVP first (User Story 1)

1. Setup, then Foundational.
2. US1: every customer has a reference no other person in the business
   has, on the link, in the share message, on `/v1` and in the panel.
3. **Stop and validate** with quickstart § User Story 1. It can ship alone:
   receipts and statements already tell customers apart by reference.

### Incremental delivery

1. US1 → ship (the reference exists; capture flow unchanged).
2. US2 → ship (payers confirm with bank and day; the capture is optional).
3. US3 → ship (one tap for returning payers; ties settled by known accounts).
4. US4 → ship (the read-back, corrections and the ladder; seven calls at most).
5. US5 → ship (the way back for payers who missed the reference).

Each increment leaves every earlier outcome as it was, and each is validated
by its quickstart section alone. The switch stays off on a business until
the creator turns it on for the pilot.

### Notes

- A task's notes record what was measured or run, with the date and the
  commit — never a phone, a name or a whole account.
- A shortcut taken on purpose is registered with `/speckit-debt-log` the
  same day (constitution, Development Workflow).
