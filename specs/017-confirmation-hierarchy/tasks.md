---

description: "Task list for confirmation-hierarchy"
---

# Tasks: confirmation-hierarchy

**Input**: Design documents from `/specs/017-confirmation-hierarchy/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md),
and spec 012's design and tasks, which this feature is built with (plan D1)

**Tests**: mandatory here, not optional. Constitution IV puts the lifecycle
in workerd against a real D1, with apiCEP intercepted at its pinned origin;
`fitTieBreak` and the matcher's modes are pure tables; the page tests on
happy-dom with MSW and axe; sizes, focus and themes in Playwright.
Constitution VII: every new test cites `confirmation-hierarchy US<n>`.
Tests are written first and fail before the code beneath them lands.

**Organization**: grouped by user story. The column, the index, the sandbox
answers, the test helpers and the exclusivity query are shared, so they are
Foundational. US1 (the three options) and US2 (the tie-break) are both P1
and independent of each other; US3 (shared accounts in the `own` mode and
the transition) builds on the Foundational query.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US3, mapping to the spec's user stories
- Every task names the file it touches

## Decision citations

Code comments cite `confirmation-hierarchy D<n>`, tabled in
[plan.md](./plan.md#decisions) (D1–D12). Where 012's plan says something
this feature amends (012 D10, D11, D15, D17, D25, D26), the comment cites
both: the 012 decision for what stands and the 017 decision for what
changed.

## Where these tasks sit in spec 012's order (plan D1)

This feature is not built after spec 012; it is built inside it. Run these
tasks at the points below of `specs/012-payment-without-receipt/tasks.md`:

| This feature | Runs | Because |
| --- | --- | --- |
| T001–T004 | after 012's T001–T008 | 012's migration, helpers and sandbox exist |
| T005–T007 | with 012's T034–T035 (012 US3) | `accountsOfOthers` sits beside `learnedAccounts` and feeds the same receipt side |
| T008–T012 (US1) | with 012's T021 and T027 (012 US2), finishing with T038 and T042 (012 US4) | 012 creates `ConfirmPayment` and the asks' view; US1 fixes their order |
| T013–T021 (US2) | in place of 012's T043–T049 (012 US5), after 012 US4 | the typed path is built once, the new way |
| T022–T024 (US3) | with 012's T030/T035 and T055/T056 | the `own` mode and the transition read exclusive accounts |
| T025–T026 | with 012's T053–T054 | one sweep of comments, one quickstart run |

What happens to each amended 012 task:

| 012 task | Build it… |
| --- | --- |
| T021 | as written, except "the exits": T008 here tests the three options |
| T027 | as written, except its last two items ("No puse la referencia", "Sube tu comprobante"): T011 here puts option 2 and `ReceiptLink` in their place |
| T030 | as written, plus T022's shared-account rows |
| T035 | with `knownAccounts` = learned minus `accountsOfOthers` and `othersAccounts` beside it (T007) |
| T038 | as written, except "with 'Sube tu comprobante' beside it" and the expired view's receipt: T008 asserts `ReceiptLink` last |
| T041 | with the `ask` enum and the derivation of T016 and T020 |
| T042 | as written, except the receipt on the asks and the expired view: T012 |
| T043 | replaced by T014 (it keeps 012's `REFERENCE_OF_ANOTHER`, D3-digits and own-typed cases) |
| T044 | `fitClaveTail` as written; the `typed` rows replaced by T013 |
| T045 | replaced by T015 |
| T046 | `referenceSource: "typed"` and `REFERENCE_OF_ANOTHER` as written; no `SENDER_TAIL_NEEDED`; the tails as T016 and T019 say |
| T047 | `fitClaveTail` as written; the `typed` mode as T017 says |
| T048 | replaced by T018 |
| T049 | replaced by T020 and T021 |
| T051 | as written, plus T009 |
| T055 | as written, except every "four account digits, or the clave's last four" and "asks `sender_tail`" read as the tie-break screen: T023 |
| T056 | as written, except the transition's `sender_tail` ask, which is T024's `tie_break` |

When one of those 012 tasks is checked off, its line says "built per spec
017 T0xx".

---

## Phase 1: Setup

**Purpose**: confirm the ground and record where it stands.

- [ ] T001 Preconditions and baseline: confirm 012's T001–T008 are done on this branch (its migration `apps/api/migrations/0041_payment_without_receipt.sql` exists, `apps/api/test/payer-helpers.ts` exists, the sandbox answers 012's scenarios); run every gate in CI order — `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm -r --if-present build` — and record the commit and the test counts in this task's notes in `specs/017-confirmation-hierarchy/tasks.md`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the column, the index, the sandbox, the helpers, and the one query every story reads.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

- [ ] T002 Schema (data-model.md; `confirmation-hierarchy D4`, `D7`): in `apps/api/src/db/schema.ts` add `payments.tieBreak` — `text("tie_break", { enum: ["none", "one", "several"] })`, nullable, its comment citing D7 and saying NULL means the row carried no answer — and `index("cep_records_business_account_idx").on(t.businessId, t.senderAccount)` on `cepRecords`, its comment citing D4. If 012's `0041_payment_without_receipt.sql` has not landed on `main`, regenerate it with `pnpm --filter @devolada/api db:generate` so both join it; if it has, generate the next number and amend data-model.md's first paragraph. Apply with `pnpm --filter @devolada/api db:migrate:local`.
- [ ] T003 [P] Sandbox scenarios in `apps/api/sandbox/apicep-mock.mjs` (quickstart "Sandbox additions"): fix the claves of `…44`'s two CEPs to end `…0412` (account tail 4417) and `…977I` (account tail 8301); add `…55` (two CEPs, tails 8301 and 4417, claves both ending `…5510`) and `…66` (one CEP, tail 8301, clave ending `…3O1K`).
- [ ] T004 [P] Test helpers in `apps/api/test/payer-helpers.ts` (012 T007): `seedPaidBy(db, { businessId, customer, account, accountType, clave })` — a confirmed payment on that customer's link that adopted `clave`, with its `cep_records` row sending from `account`, so an account can be made learned for one customer or for two people; and apiCEP bundle answers for `…44`, `…55` and `…66` through `fetchMock` at the pinned origin, matching T003.
- [ ] T005 [P] Tests for the exclusivity query in a new `apps/api/test/confirmation-hierarchy.test.ts` (cite `confirmation-hierarchy US3`), through `accountsOfOthers` with `seedPaidBy`: an account that paid only customer A → not in A's set; one that paid A and B, another person → in the set for A and for B; one that paid two services of one person → not in that person's set; a paid customer with no reference row → another person, unless it is the customer being confirmed; a row of another business with the same account → never read.
- [ ] T006 `accountsOfOthers(db, businessId, referenceId, customer, accounts)` in `apps/api/src/direct-payments/payer-reference.ts` beside 012's `learnedAccounts` (contracts/engine.md; `confirmation-hierarchy D4`): one query from `cep_records` by `(business_id, sender_account)` through the confirmed or partial payments that adopted those claves, their links, and `payer_reference_customers`; every join filtered by `business_id`; returns the accounts that paid a customer outside `referenceId`.
- [ ] T007 The receipt side (`confirmation-hierarchy D4`, `D10`; builds 012 T035): `othersAccounts?: string[]` in `ReceiptSide` (`apps/api/src/consta/bundle/types.ts`); `receiptSideOf` in `apps/api/src/direct-payments/cep-match.ts` passes `knownAccounts` = the service's learned accounts minus `accountsOfOthers(…)` over the candidates' accounts, and `othersAccounts` = that set, for `own` and `typed` rows.

**Checkpoint**: the schema, the sandbox, the helpers and exclusivity exist — the stories can start.

---

## Phase 3: User Story 1 — Three ways to confirm, in a fixed order (Priority: P1) 🎯 MVP

**Goal**: step 2 on a link with a reference offers the own-reference confirmation first, "Usé otra referencia" second, and the receipt as a quiet link last, on every view.

**Independent Test**: quickstart US1 — open a link with a reference; see the three options in order; open the typed and receipt views and come back; see today's page on a link without a reference.

### Tests for User Story 1 (write first, see them fail)

- [ ] T008 [P] [US1] Page tests in a new `apps/pago/test/confirmation-hierarchy.test.tsx` (cite `confirmation-hierarchy US1`), MSW with `onUnhandledRequest: "error"` and schema-validated fixtures: with `payerReference`, step 2's controls in DOM order — bank, day, read-back, "Pagué otra cantidad", **Confirmar pago**, **Usé otra referencia**, "Subir foto del comprobante" — and exactly one button of the decisive recipe; **Usé otra referencia** shows "Escribe la referencia que usaste o tu clave de rastreo. Con una basta.", the form, **Volver** and the receipt link last, and **Volver** returns with no request sent; the receipt link shows the capture guide, the upload and **Volver**; *No* to "¿Pusiste la referencia…?" opens the typed view with no request; a remount lands on the confirmation; the `check_data` ask, the `clave` ask and the expired view each end with the receipt link and offer no "Sube tu comprobante" beside anything; without `payerReference`, today's step (capture guide first, "No tengo el comprobante a la mano"); axe clean on every view.
- [ ] T009 [P] [US1] The browser layer in `tests/e2e/pago.spec.ts` with stubs in `tests/e2e/stubs.ts` validated by the exported schemas (cite `confirmation-hierarchy US1`): the confirmation, typed and receipt views at 360, 768 and 1280 in both themes — **Confirmar pago** 64px, **Usé otra referencia** and the receipt link at least 48px, a measured focus ring on each, Tab order equal to the visual order, no horizontal scroll, axe with contrast and target size on.

### Implementation for User Story 1

- [ ] T010 [US1] `ReceiptLink` in a new `apps/pago/src/features/pago/ReceiptLink.tsx` (`confirmation-hierarchy D2`): `Button variant="ghost"` from `@devolada/ui`, `className="h-12 w-full text-sm"`, "Subir foto del comprobante", an `onClick` prop; its comment cites D2 and names the recipe it takes over from today's "No tengo el comprobante a la mano" (`PaymentPage.tsx:1936-1939`), and why not the `link` variant (not a 48px target).
- [ ] T011 [US1] Three views in `apps/pago/src/features/pago/ConfirmPayment.tsx` (`confirmation-hierarchy D2`, `D3`; builds 012 T027 with this in place of its exits): a `view` state `"confirm" | "typed" | "receipt"` in the component, never persisted; under **Confirmar pago**, **Usé otra referencia** (`Button variant="secondary"`, standard, full width) and `ReceiptLink`; the typed view — the intro line, today's `TransferForm` in `keys = "either"` with the link's amount and the business's timezone — sending `referenceSource: "typed"` once T016 has landed, and until then today's typed door (no `referenceSource`), so US1 ships alone on today's guarded path — then **Volver** (`ghost`, `h-12`) and `ReceiptLink`; the receipt view — today's `CaptureGuide` and `ReceiptForm`, moved here for links with a reference, then **Volver**; 012's *No* sets the typed view.
- [ ] T012 [US1] The asks and the expired view in `apps/pago/src/features/pago/PaymentPage.tsx` (`confirmation-hierarchy D2`; builds 012 T042 this way): on rows of a link with `payerReference`, the `check_data` and `clave` asks and the expired view end with `ReceiptLink`, which opens the receipt view; links without `payerReference` keep today's proof step untouched (FR-006).

**Checkpoint**: US1 is complete — the step's order holds on every view, and a page without a reference is today's.

---

## Phase 4: User Story 2 — A typed reference is tied to the payer by history, or by one short answer (Priority: P1)

**Goal**: a typed reference searches at once; an exclusive learned account decides alone; otherwise one screen with two ways to answer, read without a call, bounded to three misses per link a day.

**Independent Test**: quickstart US2 — `…44`, `…55` and `…66` answered by characters, digits, both, wrongly three times; the limit's refusal; no provider call on any answer.

### Tests for User Story 2 (write first, see them fail)

- [ ] T013 [P] [US2] Pure tables in `apps/api/test/consta/match.test.ts` (cite `confirmation-hierarchy US2`): `fitTieBreak` — digits alone fit one, several, none (by `tailFits`, a CLABE's end and the account inside it); characters alone with O read as 0 and I as 1 (`9771` fits `…977I`, `3010` fits `…3O1K`); both agreeing → one, `by: "clave_tail"`; both disagreeing → none; one way fitting nothing while the other fits → none; digits alone choosing an account in `othersAccounts` → `needs ["clave_tail"]`, and the characters then fitting it → one; several on digits alone → `needs ["clave_tail"]`, on characters alone → `needs ["sender_tail"]`, on both → `clave`; never a candidate outside the list. `typed` mode: `knownAccounts` picking exactly one → chosen, `by: "learned_account"`; two or none → undecided; a `tail` or a time on the receipt side changes nothing in this mode.
- [ ] T014 [P] [US2] Lifecycle tests in `apps/api/test/confirmation-hierarchy.test.ts` (cite `confirmation-hierarchy US2`), with `payer-helpers.ts`: a typed confirmation searches at once — one provider call, never `SENDER_TAIL_NEEDED`; `…44` → `validating`, `CEP_UNDECIDED`, status `ask: "tie_break"`, `tieBreak { ways: ["sender_tail", "clave_tail"], missed: false, several: true }`; `…66` (one transfer) → asked too, `several: false`; an exclusive learned account tying one → confirmed, nothing asked, `by: "learned_account"`; answering `0412` → confirmed from the kept record with no apiCEP call (`fetchMock` sees none), `by: "clave_tail"`, `tie_break = 'one'`, `confirmation.tieBreakMisses = 0`; answering the digits `4417` → confirmed, `by: "sender_tail"`; `8301` with `0412` → `tie_break = 'none'`, the trail carried, `missed: true`; `…55` answered `5510` → `tie_break = 'several'`, `ways: ["sender_tail"]`, then `4417` with the characters carried forward → confirmed; both given and several → `ask: "clave"`; three misses on one link → `ask: "clave"`, a fourth tail → `409 TIE_BREAK_EXHAUSTED` and no row, and the window reopens after 24 hours; six answers within an hour never meet `TOO_MANY_ATTEMPTS`; a tail superseding a row not waiting on a tie-break → `409 TIE_BREAK_NOT_ASKED`, no row, no call; an answer keeps `ladder_round` and `correction_count`; a candidate another payment claimed meanwhile is dropped at answer time; an unanswered tie-break keeps no slot and never expires; 012 T043's cases that stand — `REFERENCE_OF_ANOTHER`, D3-unsafe digits searched as a shared reference (now asking `tie_break`), the payer's own typed as `own`; no status or pay response carries account digits, candidate claves or a candidate list.
- [ ] T015 [P] [US2] Page tests in `apps/pago/test/confirmation-hierarchy.test.tsx` (cite `confirmation-hierarchy US2`): the tie-break screen by `tieBreak` — both fields with "o" between them and the opening sentence by `several`; `ways: ["clave_tail"]` → the characters field only, with its sentence; `ways: ["sender_tail"]` → the digits field only, with "Escribe también…"; `missed` → the miss line in an `Alert` with icon and text; **Confirmar** enabled only when a shown field is complete; it sends `supersedes` and the waiting row's reference, bank, day and amount with the tails typed; neither field pre-filled; the characters upper-cased as typed; `TIE_BREAK_EXHAUSTED` and `ask: "clave"` → 012's clave ask with `ReceiptLink` last; `TIE_BREAK_NOT_ASKED` → the status re-read; `ReceiptLink` last; axe clean.

### Implementation for User Story 2

- [ ] T016 [US2] The contract (contracts/payment-page.md; `confirmation-hierarchy D9`, `D11`; builds 012 T041's schema and T046 this way): in `apps/api/src/routes/direct-payments/schema.ts`, `ask: z.enum(["check_data", "clave", "tie_break"])` and `tieBreak { ways, missed, several }` in `directPaymentStatusResponse`; the `payRequest` refinement requiring `supersedes` for `senderTail` and for `claveTail`; no `SENDER_TAIL_NEEDED`.
- [ ] T017 [US2] The matcher (contracts/engine.md; `confirmation-hierarchy D6`, `D10`; builds 012 T047 this way): `fitTieBreak(answer, candidates, othersAccounts)` and the `TieBreakAnswer` / `TieBreakFit` types in `apps/api/src/consta/bundle/{match,types}.ts`, beside `fitClaveTail` (built as 012 T047 says) and reusing `tailFits`; the `typed` mode as integrity → used → `knownAccounts` → undecided, without the tail and window steps.
- [ ] T018 [US2] The lifecycle in `apps/api/src/direct-payments/validation.ts` (contracts/engine.md "Lifecycle"; `confirmation-hierarchy D5`, `D6`; replaces 012 T048): typed rows search at once; one or several found and none taken by `knownAccounts` → spec 013's undecided write (trail kept, no slot), a single match included (FR-009); an answer row takes the waiting row's reference, bank, day, amount, `ladder_round` and `correction_count`, carries forward a way the waiting row's answer gave and that fitted, re-reads `usedAmong`, calls `fitTieBreak` with `othersAccounts`, and never calls the provider: `one` → spec 013's `promote` and the ordinary `valid` path, `by` from the fit, `tie_break = 'one'`, `confirmation.tieBreakMisses` counted along the `supersedes_id` chain; `needs` or `clave` → `tie_break` `several` (or `one` when the digits chose another person's account), the trail copied, undecided; `none` → `tie_break = 'none'`, the trail copied, undecided.
- [ ] T019 [US2] `submitPayment` in `apps/api/src/routes/direct-payments/handler.ts` (`confirmation-hierarchy D8`, `D11`; builds 012 T046 without `SENDER_TAIL_NEEDED`): for a body with a tail, `409 TIE_BREAK_NOT_ASKED` when the superseded row is not waiting on a tie-break, and `409 TIE_BREAK_EXHAUSTED` when the link has three rows with `tie_break = 'none'` created in the last 24 hours (counted over `payments_link_idx`), neither writing a row; such a body is not refused by `HOURLY_ATTEMPT_BUDGET` (012 D25 amended — the comment at `handler.ts:88` cites both); `sender_tail` and `clave_tail` written; an answer never counts as a correction.
- [ ] T020 [US2] The ask (data-model.md "The ask"; `confirmation-hierarchy D9`; replaces 012 T041's derivation and T049's asks): in `getDirectPaymentStatus` (`apps/api/src/routes/direct-payments/handler.ts`), the table read top to bottom from the row's `tie_break`, `sender_tail`, `clave_tail`, `last_error`, `ladder_round`, the kept trail's candidate count and the link's misses in 24 hours; `tieBreak.ways`, `missed`, `several`; the limit turns the ask to `clave`.
- [ ] T021 [US2] The page (contracts/payment-page.md "The tie-break screen"; `confirmation-hierarchy D9`, `D12`; replaces 012 T049's page part): a new `apps/pago/src/features/pago/TieBreakForm.tsx` — the opening by `several` and `ways`, the fields shown by `ways` (digits: `inputMode="numeric"`, four; characters: mono, four, upper-cased), "o" between, the miss `Alert`, **Confirmar** (`primary`, standard), `ReceiptLink` last — rendered by `PaymentPage.tsx` for `ask: "tie_break"`; `payErrorCopy` in `PaymentPage.tsx` gains `TIE_BREAK_EXHAUSTED` (shows the clave ask) and `TIE_BREAK_NOT_ASKED` (re-reads the status); `REFERENCE_OF_ANOTHER` as 012 says.

**Checkpoint**: US2 is complete — a typed reference confirms by history or one answer, never by a guess past the limit, and never with a call spent on an answer.

---

## Phase 5: User Story 3 — An account that pays for several people never decides alone (Priority: P2)

**Goal**: exclusivity holds in every mode — typed, own, and the transition.

**Independent Test**: quickstart US3 — with an account seeded as paying two people, history does not decide for either; its digits lead to the characters; an exclusive account decides alone; the own mode falls back to the earliest.

### Tests for User Story 3 (write first, see them fail)

- [ ] T022 [P] [US3] Pure tables in `apps/api/test/consta/match.test.ts` (cite `confirmation-hierarchy US3`; amends 012 T030): `own` mode with a learned account in `othersAccounts` and not in `knownAccounts` → the earliest not-used transfer wins, `by: "earliest"`; with an exclusive one → it goes first, `by: "learned_account"`; during a transition, a chosen candidate from an account not in `knownAccounts` is held.
- [ ] T023 [P] [US3] Lifecycle tests in `apps/api/test/confirmation-hierarchy.test.ts` (cite `confirmation-hierarchy US3`; amends 012 T055's asks), with `seedPaidBy`: account 8301 having paid A and B (two people), A's typed `…44` → the tie-break screen, history not deciding; A answering the digits `8301` → `ways: ["clave_tail"]`, and the right characters confirm; a customer whose learned 4417 is exclusive → confirmed with no question; exclusivity read at the tie — a payment an account decided while exclusive stays as it is after the account pays another person, and the next tie is not decided by it; own reference, two of the person's transfers, the learned account shared with another person → the earliest not yet used confirms; the transition (012 D26): the previous holder's old digits with a transfer from an account not exclusive to them → `tie_break`, and the new owner's candidate from an account not known for them → `tie_break` with both ways.

### Implementation for User Story 3

- [ ] T024 [US3] The `own` mode and the transition (`confirmation-hierarchy D10`; builds 012 T035 and T056 this way): the `own` mode in `apps/api/src/consta/bundle/match.ts` reads `knownAccounts` as T007 now fills it (exclusive only); in `apps/api/src/direct-payments/validation.ts`, a transition's held candidate becomes a row waiting on a tie-break (undecided, trail kept), so T018's answer path serves it; in `apps/api/src/routes/direct-payments/handler.ts`, an own row waiting in a transition derives `ask: "tie_break"` with both ways instead of 012's `sender_tail`; T056's notice and question in `ConfirmPayment.tsx` stay as 012 wrote them.

**Checkpoint**: all three stories work, each on its own tests.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T025 [P] Comments and records: every rule this feature adds cites `confirmation-hierarchy D<n>`; the comments 012 T053 sweeps for D11, D15, D17 and D25 say the amended meaning and cite both decisions; in `specs/012-payment-without-receipt/tasks.md`, each amended task checked off says "built per spec 017 T0xx".
- [ ] T026 Run `specs/017-confirmation-hierarchy/quickstart.md` end to end on the sandbox, then every gate in CI order and `pnpm e2e`; record the commit and the test counts against T001's in this task's notes in `specs/017-confirmation-hierarchy/tasks.md`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001)**: after 012's T001–T008.
- **Foundational (T002–T007)**: after T001. T005–T007 also need 012's T034 (`learnedAccounts`) and run with 012's T035.
- **US1 (T008–T012)**: after Foundational and 012's T027 (`ConfirmPayment` exists); T012 after 012's T042.
- **US2 (T013–T021)**: after Foundational and 012's US4 (T037–T042: the ladder and the ask route); it takes the place of 012's US5 typed tasks.
- **US3 (T022–T024)**: after Foundational; T024 after T018 and 012's T056.
- **Polish (T025–T026)**: after the stories wanted, with 012's T053–T054.

### User story dependencies

- **US1** needs no other story of this feature.
- **US2** needs no other story of this feature; it reads the exclusivity of Foundational.
- **US3** needs US2's answer path (T018) only for the transition's tie-break (T024).

### Within each story

- Tests first, failing; then the contract, the matcher, the lifecycle, the route, the page.
- Pure tables (T013, T022) before the matcher (T017, T024).

### Shared files

- `apps/api/test/confirmation-hierarchy.test.ts`: T005, T014, T023 — sequential.
- `apps/api/test/consta/match.test.ts`: T013, T022 — sequential.
- `apps/pago/test/confirmation-hierarchy.test.tsx`: T008, T015 — sequential.
- `apps/api/src/routes/direct-payments/handler.ts`: T019, T020, T024 — sequential.
- `apps/api/src/direct-payments/validation.ts`: T018, T024 — sequential.
- `apps/api/src/consta/bundle/match.ts`: T017, T024 — sequential.
- `apps/pago/src/features/pago/PaymentPage.tsx`: T012, T021 — sequential.

## Parallel Examples

```text
# Foundational, once T002 has landed:
T003 sandbox scenarios   |  T004 test helpers   |  T005 exclusivity tests

# US1 and US2 tests together (different files):
T008 page tests (US1)    |  T009 e2e (US1)      |  T013 fitTieBreak tables (US2)  |  T014 lifecycle tests (US2)

# US2 implementation where files differ:
T016 schema.ts           |  T017 match.ts       |  T021 TieBreakForm.tsx (after T016)
```

## Implementation Strategy

### MVP first (User Story 1)

With 012's US1 and US2 built, T001–T012 give the payer the new order: the
own reference in the centre, the typed form second, the receipt quiet.
Until US2 lands, the typed form sends today's typed door, with today's
shared-reference stops and matcher (T011), so a typed reference never
confirms without its second fact; 012's `SENDER_TAIL_NEEDED` is never
built.

### Incremental delivery

1. Foundational (T002–T007): exclusivity exists; the `own` mode is already
   safer, since `knownAccounts` holds exclusive accounts only.
2. US1 (T008–T012): the order.
3. US2 (T013–T021): the typed path and the tie-break, in place of 012's
   US5 typed tasks.
4. US3 (T022–T024): exclusivity proven across the `own` mode and the
   transition.
5. Polish (T025–T026).

## Notes

- 26 tasks, all open; T001 records the baseline and T026 the result.
- A task that turns out to need a decision not in plan.md stops and asks
  the creator; it does not make one silently.
