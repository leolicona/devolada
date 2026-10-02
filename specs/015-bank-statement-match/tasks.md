---

description: "Task list for bank-statement-match"
---

# Tasks: bank-statement-match

**Input**: Design documents from `/specs/015-bank-statement-match/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: mandatory, not optional. Constitution IV puts the lifecycle in
workerd against a real D1, with apiCEP and WispHub intercepted at their
pinned origins; the panel and the page on happy-dom with MSW,
schema-validated fixtures and axe; sizes, focus and themes in Playwright.
Constitution VII: every new test cites `bank-statement-match US<n>`. Each
story's tests are written first and fail before the code beneath them
lands.

**Organization**: grouped by user story, in the creator's delivery order
(plan D1), not in the spec's priority order:

- **Phase A**: User Story 4 without a file (Phase 3 below) — the MVP.
- **Phase B**: User Story 1's core (Phase 4); User Story 4's statement
  scenarios 4 and 6 (Phase 5); then User Stories 2 and 3 (Phases 6 and 7).
  All of it is tested with synthetic credits.
- **Phase C**: a bank's reader (Phase 8). **Blocked** until the pilot's
  real file is in hand (D16).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US4, mapping to the spec's user stories
- Every task names the file it touches

## Decision citations

Code comments cite `bank-statement-match D<n>`, as tabled in
[plan.md](./plan.md#decisions) (D1–D16), and research `R<n>` where a
measured fact stands behind the rule (constitution I). Where this feature
reuses an older rule, the comment cites both. Examples: the D7 schedule,
`validation spec D17`, `provisional-release D1`, `receipt-triage D15/D31`,
`cep-bundle-match D10`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: test scaffolding every phase reuses

- [ ] T001 Add same-bank seeds to `apps/api/test/payer-helpers.ts`:
  - `seedSameBankBusiness(over)`: wraps `seedReferenceBusiness`, collection account `ACCOUNT` (BBVA MEXICO CLABE), `payByReference` on. Overrides allow a card collection account (`speiCollectKind: "card"`, `speiCard`, `speiCardBank: "BBVA MEXICO"`) and a phone one.
  - `confirmSameBank(token, opts)`: POSTs the payer's confirmation (`/direct-payments/links/:token/pay`, `referenceSource: "own"`, `senderBank: "BBVA MEXICO"`, today) and returns the row.
- [ ] T002 [P] Add MSW handlers to `apps/admin/test/msw.ts`:
  - `GET /payments/feed?awaiting=bank`
  - `POST /payments/:id/bank-check`
  
  Each answers with fixtures parsed by `feedCharge` / `bankCheckBody` from `@devolada/api/payments-schema`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the pieces both the panel's decision (US4) and the statement's
match (US1–US4) settle through. **⚠️ No user story starts before this phase.**

- [ ] T003 Create `apps/api/src/direct-payments/same-bank.ts` with:
  - the codes `SAME_BANK`, `BANK_CHECKING`, `NOT_RECEIVED`;
  - `isSameBankRow(payment, beneficiaryBank)`: transfer door (`trackingKey` or `referenceNumber`) and `senderBank === beneficiaryBank`, exact `BANKS` equality, any collection kind (D2, R2);
  - `isAwaitingBank(row)`: `validating` with `lastError` in (`SAME_BANK`, `BANK_CHECKING`);
  - `claimBankCheck(db, businessId, paymentId)`: one conditional update `SAME_BANK → BANK_CHECKING`, scoped by `business_id`, returning the row or null (D6);
  - `endNotReceived(db, row, by)`: `status: "expired"`, `lastError: NOT_RECEIVED`, `nextValidationAt: null`, `reviewedBy`/`reviewedAt` when `by` names an operator (D5).
  
  Comments cite D2, D3, D5, D6.
- [ ] T004 In `apps/api/src/direct-payments/validation.ts`, export `settleWithoutCep(env, db, payment, link, business, integration, now, opts)` (D6, R6):
  - It wraps the private `settlePanelPayment` (panel link) and `settleApiPayment` (API link) with `cep: null` and the receipt's amount — `opts.receivedCents`, else `claimedAmountCents ?? amountCents`.
  - It writes through `announcingWriter`, so the fee and the webhook behave as for any verdict.
  - It merges `opts.base` (e.g. `reviewedBy`, `reviewedAt`, a `trackingKey` or `statementCreditId` later) into the settled row.
  - Its `retryLater` puts the row back to `SAME_BANK` with `nextValidationAt: null` and reports `{ unavailable: true }` instead of scheduling or expiring.
  - No other caller changes.
- [ ] T005 [P] Update two comments in `apps/api/src/db/schema.ts`, with no column change:
  - add the `expired` + `NOT_RECEIVED` paragraph from data-model.md to the status comment (D5);
  - widen `reviewedBy`'s comment to "who decided this row by hand: receipt-triage's review or the bank check (bank-statement-match D6)".

**Checkpoint**: `pnpm --filter @devolada/api typecheck` passes; nothing calls the new code yet.

---

## Phase 3: User Story 4 — A same-bank payment waits for the business instead of expiring (Priority: P1, Phase A) 🎯 MVP

**Goal**: a payment from the business's own bank is recognized when the
payer confirms, waits with no clock, gets the provisional release like any
payment, and is confirmed — or ended "no llegó" — by an operator. The payer
reads only 017's words.

**Independent Test**: spec User Story 4's Independent Test, without the
statement half; quickstart.md Phase A steps 1–6.

### Tests for User Story 4 (write first; they fail before T016)

- [ ] T006 [P] [US4] Recognition and wait, in `apps/api/test/bank-statement-match.test.ts` (new; cites `bank-statement-match US4`), with `fetchMock` asserting **no** apiCEP request:
  - confirming with BBVA against a BBVA CLABE, card and phone collection account each leaves the row `validating`, `lastError = "SAME_BANK"`, `nextValidationAt` null;
  - the same holds with `APICEP_TOKEN` unset (recognition precedes `PROVIDER_NOT_CONFIGURED`);
  - running `sweepDirectPayments` at created + 7 h and + 13 h leaves it waiting, never `expired`;
  - a payer correction with another bank supersedes it and is searched (apiCEP intercepted once);
  - a different bank is searched as today.
- [ ] T007 [P] [US4] The release, in `apps/api/test/bank-statement-match.test.ts`. With the integration's provisional release on and WispHub at its pinned origin:
  - recognition creates one payment promise for `promiseDeadline(createdAt)`, and the row gets `provisionalReleaseAt` and `releaseEvidence = "human"`;
  - no WispHub payment is registered;
  - a second sweep creates no second promise;
  - no promise when the switch is off, on an API link, for a payer `isRevoked` refuses, or when the snapshot is a retired account.
- [ ] T008 [P] [US4] `POST /payments/:id/bank-check` received, in `apps/api/test/bank-statement-match.test.ts`:
  - **Panel link**: WispHub debt re-read, then the payment registered (intercepts as in `payments-review.test.ts`). The row is `confirmed` with a folio, `reviewedBy`, and one `validation_fee` credit entry.
  - **D14**: debt already settled gives `unapplied`.
  - **Observation mode**: `actionOutcome = "observation"` and no WispHub write.
  - **API link**: the verdict webhook delivery is queued; a one-time link closes.
- [ ] T009 [P] [US4] `bank-check` not received and refusals, in `apps/api/test/bank-statement-match.test.ts`:
  - **Not received**: the row is `expired` + `NOT_RECEIVED` with `reviewedBy`, and no fee entry.
  - **Released, then not received**: the same customer's next payment is not released (burned ride, 90 days).
  - **Not released, then not received**: the next payment is released.
  - **Second decision**: `409 NOT_AWAITING_BANK`.
  - **Another business's payment**: `404 NOT_FOUND`.
  - **Viewer role**: `403`.
  - **WispHub unreachable while settling**: `503 INTEGRATION_UNAVAILABLE`, and the row is back to `SAME_BANK`.
- [ ] T010 [P] [US4] The feed, in `apps/api/test/bank-statement-match.test.ts`:
  - `GET /payments/feed?awaiting=bank` answers only this business's waiting same-bank rows, `BANK_CHECKING` included;
  - `bankCheck` is `waiting` / `received` (with the operator's name) / `not_received` / null as data-model.md derives;
  - `release.lapsed` is true once `promiseDeadline` is before today in the business's timezone.
- [ ] T011 [P] [US4] The payer's contract, in `apps/api/test/bank-statement-match.test.ts`: `GET /direct-payments/:id/status` for a waiting same-bank row answers `status: "validating"`, `error: null`, `ask: null`, and no field that names a bank or a statement (FR-019, contracts/payment-page.md).
- [ ] T012 [P] [US4] The receipt's ask (FR-017, D9), in `apps/api/test/bank-statement-match.test.ts`, with the reader stubbed at the binding (`aiReturning`) to read BBVA as both sender and receiver on a clear capture:
  - with a clave: `/read` answers `ask: { reason: "same_bank" }`, and the receipt door refuses a submission without `transfer` the same way;
  - without a key: `ask: { reason: "no_key", fields }` includes `"senderBank"`;
  - a partly legible capture gets no ask;
  - the extraction row's outcome records `same_bank`.
- [ ] T013 [P] [US4] Panel tests in `apps/admin/test/bank-statement-match.test.tsx` (new; cites `bank-statement-match US4`):
  - **Strip and chip**: the strip shows "1 pago espera que lo confirmes en tu banco" and **Verlos** selects the chip "Por confirmar en tu banco".
  - **Waiting row**: badge "Por confirmar", the bank line, the release line and its lapsed variant.
  - **Sí, llegó**: opens its `AlertDialog`; confirming posts `{ received: true }` and the row shows "Confirmado a mano por …".
  - **No llegó**: posts `{ received: false }` and shows the "No llegó" badge.
  - **Errors**: a 409 refetches the row; a 503 shows the alert.
  - **Viewer role**: sees no buttons.
  - `axe` on each state.
- [ ] T014 [P] [US4] Page tests in `apps/pago/test/bank-statement-match.test.tsx` (new; cites `bank-statement-match US4`):
  - **Words only**: fed the statuses of contracts/payment-page.md, the page renders only those sentences. No rendered text matches `/mismo banco|estado de cuenta|a mano|BBVA/i` outside the bank the payer chose.
  - **The `same_bank` ask**: renders "¿Desde qué banco pagaste?" with the chips and **Continuar** submits `transfer.senderBank`.
  - **The `no_key` ask**: with `"senderBank"`, it shows the bank field.
  - `axe` on each.
- [ ] T015 [P] [US4] Badge tests in `packages/ui/test/atoms.test.tsx`: `StatusBadge kind="awaitingBank"` renders "Por confirmar" with its icon, and `kind="notReceived"` renders "No llegó" (cites `bank-statement-match US4`).

### Implementation for User Story 4

- [ ] T016 [US4] Add the same-bank pre-check to `runValidation` in `apps/api/src/direct-payments/validation.ts` (D2, D3, D4):
  - **Where**: after the `CEP_UNDECIDED` guard and the kept-verdict branch, **before** `if (!env.APICEP_TOKEN)`.
  - **The snapshot**: compute `parseAccount(payment.beneficiary)`, or `collectAccount(business)` for legacy rows, without any `retryLater`.
  - **The decision**: when `isSameBankRow` holds, evaluate `maybeProvisionalRelease(env, db, business, integration, link, payment, snapshot?.retired ? null : "human", now)` once, guarded by `provisionalReleaseAt == null`. Then write through `update` `{ lastError: SAME_BANK, nextValidationAt: null, ...release }` and return.
  - **Unchanged**: the later beneficiary checks (`SPEI_NOT_CONFIGURED`, `SPEI_BANK_UNKNOWN`) keep their order. The engine's guard in `consta/request.ts` is untouched.
  
  Makes T006–T007 pass.
- [ ] T017 [US4] In `apps/api/src/routes/payments/schema.ts`, add (contracts/panel.md):
  - `feedQuery.awaiting: z.enum(["bank"]).optional()`;
  - `feedCharge.bankCheck`, defaulted to null;
  - `lapsed` in the release fields, defaulted to false;
  - `bankCheckBody = z.object({ received: z.boolean() })` and its type export.
- [ ] T018 [US4] In `apps/api/src/routes/payments/handler.ts`, change `listPaymentFeed` (D8):
  - `awaiting=bank` filters `status = 'validating' AND last_error IN ('SAME_BANK','BANK_CHECKING')`, combines with `q`/`from`/`to`, and ignores `status`/`action`/`class`;
  - derive `bankCheck` (operator's display name from `reviewedBy`, never an email);
  - derive `release.lapsed` with `promiseDeadline` and the business's "today".
  
  Makes T010 pass.
- [ ] T019 [US4] Add `bankCheck(c, id, body)` to `apps/api/src/routes/payments/handler.ts` (D5, D6):
  - **Guards**: `businessGuard`; 404 when the row is not this business's (`realOnly`); `claimBankCheck`, and 409 `NOT_AWAITING_BANK` when it returns null.
  - **`received: false`**: `endNotReceived(db, row, actor.userId)`, then `enqueueAndDeliver` for an API link.
  - **`received: true`**: `settleWithoutCep` with `base: { reviewedBy, reviewedAt }`; when it reports `unavailable`, answer 503 `INTEGRATION_UNAVAILABLE`.
  - **Answer**: the row as a `feedCharge`.
  
  Makes T008–T009 pass.
- [ ] T020 [US4] Wire `POST /:id/bank-check` in `apps/api/src/routes/payments/index.ts`: `requireSession`, `requireArea("payments", "operate")`, `zValidator("json", bankCheckBody)`, beside `/:id/review`, with a comment citing D6.
- [ ] T021 [US4] Add the `same_bank` ask in `apps/api/src/consta/extraction/ask.ts` and the three places that carry it (D9, R9):
  - `apps/api/src/consta/extraction/ask.ts`, `askBeforeCredit`:
    - after `wrong_destination`: when the gate's `receiving.sameBank` is true and a key was read, return `{ reason: "same_bank" }`;
    - in the `no_key` branch, push `"senderBank"` when `receiving.sameBank` is true and it is not already listed.
  - `apps/api/src/consta/index.ts`: widen the `Ask` union.
  - `apps/api/src/consta/extract.ts`: map `same_bank` to the extraction outcome `same_bank` (TS-only enum).
  - `apps/api/src/routes/direct-payments/schema.ts`: `proofReadingResponse.ask` gains `z.object({ reason: z.literal("same_bank") })`.
  
  Makes T012 pass.
- [ ] T022 [P] [US4] Add the `StatusBadge` kinds `awaitingBank` (warning, `Landmark`, "Por confirmar") and `notReceived` (error, `CircleSlash`, "No llegó") to `packages/ui/src/components/status-badge.tsx`. No new token. Makes T015 pass.
- [ ] T023 [US4] Change `apps/admin/src/features/feed/FeedScreen.tsx` (D8, contracts/panel.md):
  - **Chip**: `{ value: "bank", label: "Por confirmar en tu banco" }` in `statusFilters`, and `feedPath` maps it to `awaiting=bank`.
  - **Strip**: a query like the failed strip's, with the strip copy and **Verlos**.
  - **Waiting rows in `ChargeRow`**: the badge, the bank line, the release / lapsed line, and **Sí, llegó** / **No llegó** behind `AlertDialog`s with the contract's copy. Both are gated by `roleCan(role, "payments", "operate")`, inside `<Pending>` while the mutation runs.
  - **Errors**: 409 refetches; 503 shows the `Alert`.
  - **Ended rows**: `notReceived`, and "Confirmado a mano por {nombre}".
  
  Makes T013 pass.
- [ ] T024 [US4] In `apps/pago/src/features/pago/PaymentPage.tsx`, render `reading.ask.reason === "same_bank"`: "¿Desde qué banco pagaste?" with 017's bank chips (the payer's learned banks first, then "Otro banco") and a 64px **Continuar** that submits the reading's transfer with `senderBank` = the chosen bank. Make sure the `no_key` form shows its bank field when `"senderBank"` is in `fields`. No other view changes (D7). Makes T014 pass.
- [ ] T025 [US4] Browser layer: in `tests/e2e/stubs.ts`, stub the feed with one waiting same-bank row. In `tests/e2e/responsive.spec.ts` and `tests/e2e/contrast.spec.ts`, cover the chip, the strip and both dialogs at 360/768/1280 in both themes: no horizontal scroll, measured focus, contrast.

**Checkpoint**: quickstart.md Phase A passes by hand. User Story 4 works without any bank file — the MVP.

---

## Phase 4: User Story 1 — The business uploads its statement and the payments it was waiting for are confirmed (Priority: P1, Phase B core)

**Goal**: an uploaded statement is read through a reader, its credits are
kept once, matched by clave and by a registered payer's reference + amount
+ day, and reported. Built and tested with a synthetic reader registered by
the tests. The first real reader is Phase 8.

**Independent Test**: with a synthetic reader returning two expected credits
(a waiting reference payment, a payment holding a clave) and one unexpected
credit, upload once: 2 matched, 1 unmatched, both payments confirmed with
the source "estado de cuenta". Upload again: nothing changes, and the
report says the credits were already imported.

### Tests for User Story 1 (write first)

- [ ] T026 [P] [US1] In `apps/api/test/bank-statement-match-statements.test.ts` (new; cites `bank-statement-match US1`), with a test-only reader injected through the registry:
  - **Upload**: matched / already / unmatched / skipped / unreadable counts; the payments confirmed with `statementCreditId` and the clave written; no apiCEP call.
  - **Repeats**: the same file twice, and two overlapping files, confirm nothing twice and create no second credit (identity, R13, including two identical credits on one day).
  - **Refusals**: an unrecognized file gets 422 `STATEMENT_FORMAT_UNSUPPORTED` with the supported banks and nothing imported; another account gets 422 `STATEMENT_OTHER_ACCOUNT`; too large gets 413.
  - **Access**: upload is `payments: operate`; another business sees nothing.
- [ ] T027 [P] [US1] In `apps/admin/test/bank-statement-match-statements.test.tsx` (new; cites `bank-statement-match US1`), the Estado de cuenta screen:
  - the upload names the supported banks;
  - the report shows the counts;
  - the imports list;
  - the refusals' copy;
  - `axe`.

### Implementation for User Story 1

- [ ] T028 [US1] Add `statementImports` and `statementCredits` to `apps/api/src/db/schema.ts` as data-model.md lists them, plus `payments.statementCreditId`. Indexes: `(business_id, identity)` unique, `(business_id, fate)`, `(business_id, operation_date)`. Then run `pnpm --filter @devolada/api db:generate` to produce the additive migration `apps/api/migrations/00NN_bank_statement_match.sql`.
- [ ] T029 [US1] Create `apps/api/src/statements/reader.ts` (D12, contracts/statements.md):
  - the types `StatementMovement`, `StatementRead` and `StatementReader`;
  - the registry `readersFor(env)`, which returns `[]` until Phase 8;
  - `supportedBanks()`;
  - an override hook that only tests use to inject a reader.
- [ ] T030 [P] [US1] Create `apps/api/src/statements/identity.ts`: `creditIdentity(movement, bank, occurrence)` per R13, and `assignOccurrences(movements)`, which numbers identical lines of a day within one file. Both are pure, with a table test in T026's file.
- [ ] T031 [US1] Create `apps/api/src/statements/import.ts`: `importStatement(env, db, business, actor, file)`:
  - pick the reader by `recognizes`;
  - refuse an unsupported format or another account (compare `accountTail` with the collection account);
  - keep only the credits, parsing amounts with the core's money parsers;
  - insert the credits with `ON CONFLICT (business_id, identity) DO NOTHING` (counting the conflicts as `already`);
  - run the match (T032);
  - write the import row with its counts.
- [ ] T032 [US1] Create `apps/api/src/statements/match.ts`, steps 1 and 3 of R14 for US1:
  - load the business's waiting rows once;
  - match by clave (`trackingKey`), confirmed rows giving `already`;
  - match by registered payer reference + amount + operation date against `validating` reference rows;
  - leave 013 undecided rows undecided, marking credits among their candidates `held_undecided`;
  - settle each match with `settleWithoutCep(..., { receivedCents: credit.amountCents, base: { statementCreditId, trackingKey: credit.clave ?? row.trackingKey } })`.
- [ ] T033 [US1] Create `apps/api/src/routes/statements/{index,handler,schema}.ts` per contracts/statements.md:
  - `POST /statements` (multipart, ≤ 5 MB, `payments: operate`);
  - `GET /statements` (`payments: read`);
  - `importReport` and the error codes.
  
  Mount it in `apps/api/src/index.ts` (`app.route("/statements", statementsRoute)`) and add `"./statements-schema"` to `apps/api/package.json` exports.
- [ ] T034 [US1] Create `apps/admin/src/features/statements/StatementsScreen.tsx`: the upload, the last report and the imports. Add the route `/estado-de-cuenta` in `apps/admin/src/router.tsx` and the nav item "Estado de cuenta" in `apps/admin/src/features/shell/Shell.tsx`, below "Pagos". Add the MSW handlers to `apps/admin/test/msw.ts`. Makes T027 pass.

**Checkpoint**: T026–T027 pass with the synthetic reader. Uploading a real
file still answers `STATEMENT_FORMAT_UNSUPPORTED` until Phase 8.

---

## Phase 5: User Story 4 — the statement's scenarios 4 and 6 (Phase B)

**Goal**: a same-bank credit confirms its waiting payment, and a statement
covering a waiting payment's day without its credit ends it "no llegó".

**Independent Test**: User Story 4 acceptance scenarios 4 and 6, and the
"wrong day" edge case, with the synthetic reader.

- [ ] T035 [P] [US4] In `apps/api/test/bank-statement-match-statements.test.ts`, cite `bank-statement-match US4` and cover:
  - a same-bank credit with the reference, amount and day confirms the `SAME_BANK` row: source "estado de cuenta", the action fired;
  - a file whose period covers the row's day without its credit ends it `expired` + `NOT_RECEIVED` (`notReceived` count; no fee);
  - a credit with its reference and amount on another day keeps it waiting and lists the credit beside it;
  - a row an operator already decided is `already`.
- [ ] T036 [US4] Extend `apps/api/src/statements/match.ts` with R14 step 2 (same-bank credits against `SAME_BANK` rows, claimed through `claimBankCheck`). After the credits, end every `SAME_BANK` row whose `transferDate` falls inside the import's period with no credit of its reference and amount anywhere in the file, using `endNotReceived(db, row, null)` (D5, FR-023).

---

## Phase 6: User Story 2 — The statement closes what the instant path left open (Priority: P2)

**Goal**: a credit revives an expired-unfound payment, and creates the
payment of a registered payer who never said "ya pagué".

**Independent Test**: spec User Story 2's Independent Test, with the synthetic reader.

- [ ] T037 [P] [US2] In `apps/api/test/bank-statement-match-statements.test.ts` (cites `bank-statement-match US2`):
  - an `expired` + `TRANSFER_NOT_FOUND` reference row matched by reference + amount + day is confirmed;
  - a credit with a registered payer's reference and exactly the amount their link asks, with no row waiting, creates and confirms a payment;
  - a different amount, or a link that asks nothing, creates nothing and lists the credit with the customer named;
  - a credit dated before the invoice's issue date creates nothing (WispHub open invoices intercepted with their dates);
  - an integration that cannot tell the date creates nothing.
- [ ] T038 [US2] Extend `apps/api/src/statements/match.ts`:
  - R14 step 3 for `expired` rows ending `TRANSFER_NOT_FOUND`;
  - step 4: resolve the reference to its person and customers (`payer_reference_customers`), read what the link asks today and the day it was first asked through the integration's open-invoices capability (or the `/v1` link's creation), and insert a `payments` row (`proofMode: "transfer"`, `referenceSource: "own"`, `referenceNumber`, the credit's day, `statementCreditId`), then settle it with `settleWithoutCep`.
  
  No provider word in the core (constitution IX).

---

## Phase 7: User Story 3 — Credits nobody expected are listed and assigned by hand (Priority: P3)

**Goal**: "Abonos sin cliente", with the customer named when a registered
reference names one, and assignment by hand.

**Independent Test**: spec User Story 3's Independent Test, with the synthetic reader.

- [ ] T039 [P] [US3] Cover assignment in `apps/api/test/bank-statement-match-statements.test.ts` (cites `bank-statement-match US3`):
  - `GET /statements/credits?fate=unmatched` lists sender, amount, reference, date and `namedCustomer`;
  - assigning a credit confirms a payment for that customer, with `statementCreditId` + `reviewedBy` and the partial and overpayment rules;
  - a second assignment gets 409 `CREDIT_ALREADY_USED`;
  - a credit matched by a later file leaves the list.
- [ ] T040 [P] [US3] Cover the panel in `apps/admin/test/bank-statement-match-statements.test.tsx` (cites `bank-statement-match US3`): the list, the customer search, the `AlertDialog`, the result, `axe`.
- [ ] T041 [US3] Implement in `apps/api/src/routes/statements/{index,handler,schema}.ts` and `apps/api/src/statements/match.ts`:
  - `GET /statements/credits` (`fate=unmatched|held_undecided`);
  - `POST /statements/credits/:id/assign` (`payments: operate`), which finds or creates the customer's panel link as the links search does, inserts the payment from the credit and settles it.
- [ ] T042 [US3] Add "Abonos sin cliente" to `apps/admin/src/features/statements/StatementsScreen.tsx`: the list, **Asignar** with the customer search and a confirming `AlertDialog`. Makes T040 pass.

---

## Phase 8: A bank's reader (Phase C) — ⛔ BLOCKED until the pilot's real file arrives (D16)

**Goal**: the first real format. Nothing here starts from documentation alone.

- [ ] T043 [US1] Measure the pilot's BBVA Net Cash export, a day or a week holding SPEI and same-bank credits. Record in `specs/015-bank-statement-match/research.md` (new R-section, dated):
  - its layout and the operation and settlement dates;
  - whether same-bank credits print the payer's folio and concept, using the creator's 2025-10-07 receipt (folio 0056320005) if that day can be exported.
  
  Save it anonymized — names, accounts and claves replaced, amounts and dates kept — as `apps/api/test/fixtures/statements/bbva-netcash-v1.*`.
- [ ] T044 [US1] Create `apps/api/src/statements/readers/bbva-netcash.ts` (`format: "bbva_netcash_v1"`), measured against T043's fixture, and register it in `readersFor`. Test it in `apps/api/test/bank-statement-match-statements.test.ts`: every credit read, the rest skipped, the counts equal to the file's, and the same-bank lines typed `same_bank_credit`.
- [ ] T045 [US1] **Only if the creator accepts the monthly PDF as a second format** (research R16, open): measure a real BBVA monthly statement, then create `apps/api/src/statements/readers/bbva-monthly-pdf.ts`, reading through the reader binding's `toMarkdown` door, with its anonymized fixture and test.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T046 [P] Close TODO(CLAUDE-MD-SAME-BANK) in `CLAUDE.md`: the opening paragraph gains one sentence — a payment from the business's own bank waits for the business, who confirms it by hand or with its statement. Add `apps/api/src/statements/` to the architecture once Phase B ships.
- [ ] T047 [P] Browser layer for the Estado de cuenta screen in `tests/e2e/responsive.spec.ts` and `tests/e2e/contrast.spec.ts`, with stubs in `tests/e2e/stubs.ts`.
- [ ] T048 Run quickstart.md end to end, then every gate in order: `spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint`, typecheck, tests, build, `pnpm e2e`.
- [ ] T049 Run `/speckit-analyze` on `specs/015-bank-statement-match/`. A CRITICAL finding blocks the merge (constitution, Development Workflow).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup; blocks every story.
- **US4, Phase A (Phase 3)**: after Foundational. It is the MVP and ships on its own.
- **US1 core (Phase 4)**: after Foundational. Its settlement path is T004, so it can start while Phase 3 is still in review.
- **US4 statement scenarios (Phase 5)**: after Phases 3 and 4.
- **US2 (Phase 6)** and **US3 (Phase 7)**: after Phase 4. They are independent of each other.
- **Readers (Phase 8)**: after Phase 4, and **blocked on the real file**.
- **Polish (Phase 9)**: T046's first sentence after Phase 3; the rest after the phases it names.

### Within each story

Tests first, failing. Then schema, then module, then route, then screen.
T016 before T018–T020 (the rows must exist to be listed and decided);
T021 before T024 (the page renders the ask the server sends).

### Parallel Opportunities

- T001 ‖ T002; T005 ‖ T003.
- Phase 3 tests T006–T015 are all [P]: three API task groups in one new file are written as separate `describe` blocks, plus the admin, page and badge tests.
- T022 ‖ T016–T021 (different package).
- In Phase 4, T030 ‖ T029.
- Phases 6 and 7 are independent of each other.

## Parallel Example: User Story 4

```text
Task: "T006–T012 API suites in apps/api/test/bank-statement-match.test.ts (separate describe blocks)"
Task: "T013 Panel tests in apps/admin/test/bank-statement-match.test.tsx"
Task: "T014 Page tests in apps/pago/test/bank-statement-match.test.tsx"
Task: "T015 Badge tests in packages/ui/test/atoms.test.tsx"
Task: "T022 StatusBadge kinds in packages/ui/src/components/status-badge.tsx"
```

## Implementation Strategy

### MVP first: Phase A (User Story 4 without a file)

1. Phases 1–2 (T001–T005).
2. Phase 3 (T006–T025): same-bank payments stop expiring in silence, for
   every business and every account type, with no bank file.
3. **Stop and validate** with quickstart.md Phase A. Merge it: it is worth
   shipping alone.

### Incremental delivery

1. Phase B: Phase 4 (the core, with synthetic credits), then Phase 5, then
   Phases 6 and 7 — each tested and mergeable.
2. Phase C: Phase 8, the day the pilot's file arrives. The first real
   upload is the end-to-end proof of User Story 1.

## Notes

- Every commit message cites the task IDs; every non-obvious rule cites its
  `bank-statement-match D<n>` (constitution I).
- No status word is added (D3, D5): if a task seems to need one, stop and
  re-read research R3/R5.
- No payer-facing text may say how a payment is validated (FR-019): T014's
  scan is the guard.
