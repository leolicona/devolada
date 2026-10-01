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
| T025–T028 (US4) | any time: the copy it changes is on `main` already (012 is built, `70fe732`) | the payer page's copy, on every business |
| T039–T050 (US5) | step 1's parts (T039, T042–T044) any time after US4's copy; step 2's parts after US1 (T036) and US2's screen (T021) | the design the creator chose, proposal E |
| T029–T030 | with 012's T053–T054 | one sweep of comments, one quickstart run |

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

- [X] T001 Preconditions and baseline: confirm 012's T001–T008 are done on this branch (its migration `apps/api/migrations/0041_payment_without_receipt.sql` exists, `apps/api/test/payer-helpers.ts` exists, the sandbox answers 012's scenarios); run every gate in CI order — `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm -r --if-present build` — and record the commit and the test counts in this task's notes in `specs/017-confirmation-hierarchy/tasks.md`.
  - *Done 2026-10-01.* Baseline on `main` at `34ae3bd` (the spec's own docs on `77bc503`'s code): every gate green — spec-lint 95 files, gen-banks 97 banks, contrast-lint 34 pairs, pending-lint 32 labels, typecheck all workspaces, build all workspaces. Tests: api 1052 (58 files), admin 337, pago 127, ui 50, landing 10. 012's T001–T008 were built (#261): `0041_payment_without_receipt.sql`, `payer-helpers.ts` and the sandbox's 012 scenarios are on `main`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the column, the index, the sandbox and the helpers.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

- [X] T002 Schema (data-model.md; `confirmation-hierarchy D4`, `D7`): in `apps/api/src/db/schema.ts` add `payments.tieBreak` — `text("tie_break", { enum: ["none", "one", "several"] })`, nullable, its comment citing D7 and saying NULL means the row carried no answer — and `index("cep_records_business_account_idx").on(t.businessId, t.senderAccount)` on `cepRecords`, its comment citing D4. If 012's `0041_payment_without_receipt.sql` has not landed on `main`, regenerate it with `pnpm --filter @devolada/api db:generate` so both join it; if it has, generate the next number and amend data-model.md's first paragraph. Apply with `pnpm --filter @devolada/api db:migrate:local`.
  - *Done.* 012's migration had landed, so the column and the index are `apps/api/migrations/0042_confirmation_hierarchy.sql`; data-model.md's first paragraph is amended.
- [X] T003 [P] Sandbox scenarios in `apps/api/sandbox/apicep-mock.mjs` (quickstart "Sandbox additions"): fix the claves of `…44`'s two CEPs to end `…0412` (account tail 4417) and `…977I` (account tail 8301); add `…55` (two CEPs, tails 8301 and 4417, claves both ending `…5510`) and `…66` (one CEP, tail 8301, clave ending `…3O1K`).
  - *Done, with one correction:* `…66`'s clave ends `…3O10`, not `…3O1K` — `3010` cannot fit `3O1K` (O as 0 gives `301K`). quickstart.md carries the dated correction; the point (a letter O typed as zero) stands.
- [X] T004 [P] Test helpers in `apps/api/test/payer-helpers.ts` (012 T007): `seedPaidBy(db, { businessId, customer, account, accountType, clave })` — a confirmed payment on that customer's link that adopted `clave`, with its `cep_records` row sending from `account`, so an account can be made learned for one customer or for two people; and apiCEP bundle answers for `…44`, `…55` and `…66` through `fetchMock` at the pinned origin, matching T003.
  - *Done:* `seedPaidBy(db, { businessId, link, account, accountType?, clave? })` takes the customer's link; `tieBreakTransfers` and `mockTieBreakSearch` answer `…44`, `…55`, `…66` at the pinned origin.
**Checkpoint**: the schema, the sandbox and the helpers exist — US1 can start.

---

## Phase 3: Exclusive accounts (blocks US2 and US3, not US1)

**Purpose**: the one query US2 and US3 read — which accounts have paid another person. US1 does not read it, so it can run before or beside this phase (analysis I1).

- [X] T005 [P] Tests for the exclusivity query in a new `apps/api/test/confirmation-hierarchy.test.ts` (cite `confirmation-hierarchy US3`), through `accountsOfOthers` with `seedPaidBy`: an account that paid only customer A → not in A's set; one that paid A and B, another person → in the set for A and for B; one that paid two services of one person → not in that person's set; a paid customer with no reference row → another person, unless it is the customer being confirmed; a row of another business with the same account → never read.
- [X] T006 `accountsOfOthers(db, businessId, referenceId, customer, accounts)` in `apps/api/src/direct-payments/payer-reference.ts` beside 012's `learnedAccounts` (contracts/engine.md; `confirmation-hierarchy D4`): one query from `cep_records` by `(business_id, sender_account)` through the confirmed or partial payments that adopted those claves, their links, and `payer_reference_customers`; every join filtered by `business_id`; returns the accounts that paid a customer outside `referenceId`.
- [X] T007 The receipt side (`confirmation-hierarchy D4`, `D10`; builds 012 T035): `othersAccounts?: string[]` in `ReceiptSide` (`apps/api/src/consta/bundle/types.ts`); `receiptSideOf` in `apps/api/src/direct-payments/cep-match.ts` passes `knownAccounts` = the service's learned accounts minus `accountsOfOthers(…)` over the candidates' accounts, and `othersAccounts` = that set, for `own` and `typed` rows.

**Checkpoint**: exclusivity exists — US2 and US3 can start.

---

## Phase 4: User Story 1 — Three ways to confirm, in a fixed order (Priority: P1) 🎯 MVP

**Goal**: step 2 on a link with a reference offers the own-reference confirmation first, "Usé otra referencia" second, and the receipt as a quiet action last, on the views spec FR-005 names and never in the plain wait of the first rounds.

**Independent Test**: quickstart US1 — open a link with a reference; see the three options in order; open the typed and receipt views and come back; see today's page on a link without a reference.

### Tests for User Story 1 (write first, see them fail)

- [X] T008 [P] [US1] Page tests in a new `apps/pago/test/confirmation-hierarchy.test.tsx` (cite `confirmation-hierarchy US1`), MSW with `onUnhandledRequest: "error"` and schema-validated fixtures: with `payerReference`, step 2's controls in DOM order — bank, day, read-back, "Pagué otra cantidad", **Confirmar pago**, **Usé otra referencia**, "Subir foto del comprobante" — and exactly one button of the decisive recipe; **Usé otra referencia** shows "Escribe la referencia que usaste o tu clave de rastreo. Con una basta.", the form, **Volver** and the receipt link last, and **Volver** returns with no request sent; the receipt link shows the capture guide, the upload and **Volver**; *No* to "¿Pusiste la referencia…?" opens the typed view with no request; a remount lands on the confirmation; the receipt link is the last action of every view the contract's `ReceiptLink` table marks "yes" — the `check_data`, `clave` and `tie_break` asks, "Ya se usó para…", each refusal (`REFERENCE_OF_ANOTHER`, `TRANSFER_DATE_OUT_OF_RANGE`, `CORRECTIONS_EXHAUSTED`, `TIE_BREAK_EXHAUSTED`) and the expired view — with no "Sube tu comprobante" beside anything; `validating` with `ask: null` ("Seguimos buscando") shows no receipt link; the word "genérica" appears on no view; without `payerReference`, today's step (capture guide first, "No tengo el comprobante a la mano"); axe clean on every view.
- [X] T009 [P] [US1] The browser layer in `tests/e2e/pago.spec.ts` with stubs in `tests/e2e/stubs.ts` validated by the exported schemas (cite `confirmation-hierarchy US1`): the confirmation, typed and receipt views at 360, 768 and 1280 in both themes — **Confirmar pago** 64px, **Usé otra referencia** and the receipt link at least 48px, a measured focus ring on each, Tab order equal to the visual order, no horizontal scroll, axe with contrast and target size on.

### Implementation for User Story 1

- [X] T010 [US1] `ReceiptLink` in a new `apps/pago/src/features/pago/ReceiptLink.tsx` (`confirmation-hierarchy D2`): `Button variant="ghost"` from `@devolada/ui`, `className="h-12 w-full text-sm"`, "Subir foto del comprobante", an `onClick` prop; its comment cites D2 and names the recipe it takes over from today's "No tengo el comprobante a la mano" (`PaymentPage.tsx:1936-1939`), and why not the `link` variant (not a 48px target).
- [X] T011 [US1] Three views in `apps/pago/src/features/pago/ConfirmPayment.tsx` (`confirmation-hierarchy D2`, `D3`; builds 012 T027 with this in place of its exits): a `view` state `"confirm" | "typed" | "receipt"` in the component, never persisted; under **Confirmar pago**, **Usé otra referencia** (`Button variant="secondary"`, standard, full width) and `ReceiptLink`; the typed view — the intro line, today's `TransferForm` in `keys = "either"` with the link's amount and the business's timezone — sending `referenceSource: "typed"` once T016 has landed, and until then today's typed door (no `referenceSource`), so US1 ships alone on today's guarded path — then **Volver** (`ghost`, `h-12`) and `ReceiptLink`; the receipt view — `PaymentPage`'s existing receipt block (capture guide, upload mutation, the reader's refusals and receipt-triage's asks), received as a prop and rendered here, never moved (D3), then **Volver**; 012's *No* sets the typed view.
  - *Done as T036 and D21 say:* the view switch is `PaymentPage`'s `proofView`; the confirmation's choice lives beside it (`ConfirmChoice`), so `ConfirmPayment` holds no view state of its own.
- [X] T012 [US1] The asks and the expired view in `apps/pago/src/features/pago/PaymentPage.tsx` (`confirmation-hierarchy D2`; builds 012 T042 this way): on rows of a link with `payerReference`, every view the contract's `ReceiptLink` table marks "yes" ends with `ReceiptLink` — the asks, "Ya se usó para…", the refusals, the expired view — which opens the receipt block on 012 T042's re-submission path; the plain wait (`validating`, `ask: null`) shows none; 012's refusal copy that names the receipt ends "…o sube la foto de tu comprobante" (research R9); links without `payerReference` keep today's proof step untouched (FR-006).

**Checkpoint**: US1 is complete — the step's order holds on the views FR-005 names, the plain wait shows no receipt link, and a page without a reference is today's.

---

## Phase 5: User Story 2 — A typed reference is tied to the payer by history, or by one short answer (Priority: P1)

**Goal**: a typed reference searches at once; an exclusive learned account decides alone; otherwise one screen with two ways to answer, read without a call, bounded to three misses per link a day.

**Independent Test**: quickstart US2 — `…44`, `…55` and `…66` answered by characters, digits, both, wrongly three times; the limit's refusal; no provider call on any answer.

### Tests for User Story 2 (write first, see them fail)

- [X] T013 [P] [US2] Pure tables in `apps/api/test/consta/match.test.ts` (cite `confirmation-hierarchy US2`): `fitTieBreak` — digits alone fit one, several, none (by `tailFits`, a CLABE's end and the account inside it); characters alone with O read as 0 and I as 1 (`9771` fits `…977I`, `3010` fits `…3O1K`); both agreeing → one, `by: "clave_tail"`; both disagreeing → none; one way fitting nothing while the other fits → none; digits alone choosing an account in `othersAccounts` → `needs ["clave_tail"]`, and the characters then fitting it → one; several on digits alone → `needs ["clave_tail"]`, on characters alone → `needs ["sender_tail"]`, on both → `clave`; never a candidate outside the list. `typed` mode: `knownAccounts` picking exactly one → chosen, `by: "learned_account"`; two or none → undecided; a `tail` or a time on the receipt side changes nothing in this mode.
- [X] T014 [P] [US2] Lifecycle tests in `apps/api/test/confirmation-hierarchy.test.ts` (cite `confirmation-hierarchy US2`), with `payer-helpers.ts`: a typed confirmation searches at once — one provider call, never `SENDER_TAIL_NEEDED`; `…44` → `validating`, `CEP_UNDECIDED`, status `ask: "tie_break"`, `tieBreak { ways: ["sender_tail", "clave_tail"], missed: false, several: true }`; `…66` (one transfer) → asked too, `several: false`; an exclusive learned account tying one → confirmed, nothing asked, `by: "learned_account"`; answering `0412` → confirmed from the kept record with no apiCEP call (`fetchMock` sees none), `by: "clave_tail"`, `tie_break = 'one'`, `confirmation.tieBreakMisses = 0`; answering the digits `4417` → confirmed, `by: "sender_tail"`; `8301` with `0412` → `tie_break = 'none'`, the trail carried, `missed: true`; `…55` answered `5510` → `tie_break = 'several'`, `ways: ["sender_tail"]`, then `4417` with the characters carried forward → confirmed; both given and several → `ask: "clave"`; three misses on one link → `ask: "clave"`, a fourth tail → `409 TIE_BREAK_EXHAUSTED` and no row; the moving window — misses at t, t+1 h and t+2 h, then at t+24 h+1 min one more answer is accepted and a second is refused, since the oldest miss alone stopped counting; a miss followed by a fitting answer → confirmed with `confirmation.tieBreakMisses = 1`; answers never count toward `HOURLY_ATTEMPT_BUDGET` — with two misses and three confirmations or corrections in one hour, a sixth row that is an answer is accepted; a tail superseding a row not waiting on a tie-break → `409 TIE_BREAK_NOT_ASKED`, no row, no call; an answer keeps `ladder_round` and `correction_count`; a candidate another payment claimed meanwhile is dropped at answer time; an unanswered tie-break keeps no slot and never expires; 012 T043's cases that stand — `REFERENCE_OF_ANOTHER`, D3-unsafe digits searched as a shared reference (now asking `tie_break`), the payer's own typed as `own`; no status or pay response carries account digits, candidate claves or a candidate list.
  - *One detail resolved in the build:* an answer that names a transfer another payment holds (used before the search or since) is refused `TRANSFER_ALREADY_USED`, never counted as a miss — the spec's Assumption ("the owner of a transfer taken this way is told it was already used") and what a whole clave hears (cep-bundle-match D18). Found on the sandbox, where one link's confirmed transfer came back to another link's search as `used`.
- [X] T015 [P] [US2] Page tests in `apps/pago/test/confirmation-hierarchy.test.tsx` (cite `confirmation-hierarchy US2`): the tie-break screen by `tieBreak` — both fields with "o" between them and the opening sentence by `several`; `ways: ["clave_tail"]` → the characters field only, with its sentence; `ways: ["sender_tail"]` → the digits field only, with "Escribe también…"; `missed` → the miss line in an `Alert` with icon and text; **Confirmar** enabled only when a shown field is complete; it sends `supersedes` and the waiting row's reference, bank, day and amount with the tails typed; neither field pre-filled; the characters upper-cased as typed; `TIE_BREAK_EXHAUSTED` and `ask: "clave"` → 012's clave ask with `ReceiptLink` last; `TIE_BREAK_NOT_ASKED` → the status re-read; `ReceiptLink` last; axe clean.

### Implementation for User Story 2

- [X] T016 [US2] The contract (contracts/payment-page.md; `confirmation-hierarchy D9`, `D11`; builds 012 T041's schema and T046 this way): in `apps/api/src/routes/direct-payments/schema.ts`, `ask: z.enum(["check_data", "clave", "tie_break"])` and `tieBreak { ways, missed, several }` in `directPaymentStatusResponse`; the `payRequest` refinement requiring `supersedes` for `senderTail` and for `claveTail`; no `SENDER_TAIL_NEEDED`.
- [X] T017 [US2] The matcher (contracts/engine.md; `confirmation-hierarchy D6`, `D10`; builds 012 T047 this way): `fitTieBreak(answer, candidates, othersAccounts)` and the `TieBreakAnswer` / `TieBreakFit` types in `apps/api/src/consta/bundle/{match,types}.ts`, beside `fitClaveTail` (built as 012 T047 says) and reusing `tailFits`; the `typed` mode as integrity → used → `knownAccounts` → undecided, without the tail and window steps.
- [X] T018 [US2] The lifecycle in `apps/api/src/direct-payments/validation.ts` (contracts/engine.md "Lifecycle"; `confirmation-hierarchy D5`, `D6`; replaces 012 T048): typed rows search at once; one or several found and none taken by `knownAccounts` → spec 013's undecided write (trail kept, no slot), a single match included (FR-009); an answer row takes the waiting row's reference, bank, day, amount, `ladder_round` and `correction_count`, carries forward a way the waiting row's answer gave and that fitted, re-reads `usedAmong`, calls `fitTieBreak` with `othersAccounts`, and never calls the provider: `one` → spec 013's `promote` and the ordinary `valid` path, `by` from the fit, `tie_break = 'one'`, `confirmation.tieBreakMisses` counted along the `supersedes_id` chain; `needs` or `clave` → `tie_break` `several` (or `one` when the digits chose another person's account), the trail copied, undecided; `none` → `tie_break = 'none'`, the trail copied, undecided.
  - *Done.* The carried way is written on the answer row by `submitPayment` (T019), so every answer row holds both tails it was read with.
- [X] T019 [US2] `submitPayment` in `apps/api/src/routes/direct-payments/handler.ts` (`confirmation-hierarchy D8`, `D11`; builds 012 T046 without `SENDER_TAIL_NEEDED`): for a body with a tail, `409 TIE_BREAK_NOT_ASKED` when the superseded row is not waiting on a tie-break, and `409 TIE_BREAK_EXHAUSTED` when the link has three rows with `tie_break = 'none'` created in the last 24 hours (counted over `payments_link_idx`), neither writing a row; such a body is not refused by `HOURLY_ATTEMPT_BUDGET` (012 D25 amended — the comment at `handler.ts:88` cites both); `sender_tail` and `clave_tail` written; an answer never counts as a correction.
- [X] T020 [US2] The ask (data-model.md "The ask"; `confirmation-hierarchy D9`; replaces 012 T041's derivation and T049's asks): in `getDirectPaymentStatus` (`apps/api/src/routes/direct-payments/handler.ts`), the table read top to bottom from the row's `tie_break`, `sender_tail`, `clave_tail`, `last_error`, `ladder_round`, the kept trail's candidate count and the link's misses in 24 hours; `tieBreak.ways`, `missed`, `several`; the limit turns the ask to `clave`.
- [X] T021 [US2] The page (contracts/payment-page.md "The tie-break screen"; `confirmation-hierarchy D9`, `D12`; replaces 012 T049's page part): a new `apps/pago/src/features/pago/TieBreakForm.tsx` — the opening by `several` and `ways`, the fields shown by `ways` (digits: `inputMode="numeric"`, four; characters: mono, four, upper-cased), "o" between, the miss `Alert`, **Confirmar** (`primary`, standard), `ReceiptLink` last — rendered by `PaymentPage.tsx` for `ask: "tie_break"`; `payErrorCopy` in `PaymentPage.tsx` gains `TIE_BREAK_EXHAUSTED` (shows the clave ask) and `TIE_BREAK_NOT_ASKED` (re-reads the status); `REFERENCE_OF_ANOTHER` as 012 says.

**Checkpoint**: US2 is complete — a typed reference confirms by history or one answer, never by a guess past the limit, and never with a call spent on an answer.

---

## Phase 6: User Story 3 — An account that pays for several people never decides alone (Priority: P2)

**Goal**: exclusivity holds in every mode — typed, own, and the transition.

**Independent Test**: quickstart US3 — with an account seeded as paying two people, history does not decide for either; its digits lead to the characters; an exclusive account decides alone; the own mode falls back to the earliest.

### Tests for User Story 3 (write first, see them fail)

- [X] T022 [P] [US3] Pure tables in `apps/api/test/consta/match.test.ts` (cite `confirmation-hierarchy US3`; amends 012 T030): `own` mode with a learned account in `othersAccounts` and not in `knownAccounts` → the earliest not-used transfer wins, `by: "earliest"`; with an exclusive one → it goes first, `by: "learned_account"`; during a transition, a chosen candidate from an account not in `knownAccounts` is held.
- [X] T023 [P] [US3] Lifecycle tests in `apps/api/test/confirmation-hierarchy.test.ts` (cite `confirmation-hierarchy US3`; amends 012 T055's asks), with `seedPaidBy`: account 8301 having paid A and B (two people), A's typed `…44` → the tie-break screen, history not deciding; A answering the digits `8301` → `ways: ["clave_tail"]`, and the right characters confirm; the same for B, the other person, whose history does not decide either; a customer whose learned 4417 is exclusive → confirmed with no question; exclusivity read at the tie — a payment an account decided while exclusive stays as it is after the account pays another person, and the next tie is not decided by it; own reference, two of the person's transfers, the learned account shared with another person → the earliest not yet used confirms; the transition (012 D26): the previous holder's old digits with a transfer from an account not exclusive to them → `tie_break`, and the new owner's candidate from an account not known for them → `tie_break` with both ways.

### Implementation for User Story 3

- [X] T024 [US3] The `own` mode and the transition (`confirmation-hierarchy D10`; builds 012 T035 and T056 this way): the `own` mode in `apps/api/src/consta/bundle/match.ts` reads `knownAccounts` as T007 now fills it (exclusive only); in `apps/api/src/direct-payments/validation.ts`, a transition's held candidate becomes a row waiting on a tie-break (undecided, trail kept), so T018's answer path serves it; in `apps/api/src/routes/direct-payments/handler.ts`, an own row waiting in a transition derives `ask: "tie_break"` with both ways instead of 012's `sender_tail`; T056's notice and question in `ConfirmPayment.tsx` stay as 012 wrote them.
  - *Done.* The `own` mode also loses 012's typed-tail step: a tail is always an answer read by `fitTieBreak` (D6), which knows whose account the digits name; the matcher never reads one again.

**Checkpoint**: all three stories work, each on its own tests.

---

## Phase 7: User Story 4 — The payer reads about their transfer, never about who checks it (Priority: P2)

**Goal**: no text the payer reads names Banxico or assumes an ISP; each moment reads the same way; the payer's bank list has no Banxico.

**Independent Test**: quickstart US4 — the copy scan passes; walking the page through waiting, not-yet-seen, released, expired and not-found states, and a link that does not exist, shows only the vocabulary of contracts/payment-page.md "The payer's copy".

### Tests for User Story 4 (write first, see them fail)

- [X] T025 [P] [US4] The copy scan (`confirmation-hierarchy D16`, spec SC-006): a new `apps/pago/test/payer-copy.test.ts` (cite `confirmation-hierarchy US4`) that walks every `.ts`/`.tsx` file under `apps/pago/src` with the TypeScript compiler API (`typescript` is a dev dependency of `apps/pago`), collects every string literal, template-literal chunk and JSX text, reads the `<title>` of `apps/pago/index.html`, and fails on `/banxico/i` or `/internet/i` with the file, the line and the text; comments are never read. It fails today on the fourteen Banxico sentences, the fifteen ISP phrases and the two titles (research R13).
- [X] T026 [P] [US4] Page tests in `apps/pago/test/confirmation-hierarchy.test.tsx` (cite `confirmation-hierarchy US4`), MSW and schema-validated fixtures: the default wait reads "Seguimos buscando tu transferencia." and "Todavía no la vemos"; a release after agreement reads "Tu servicio ya volvió mientras terminamos de confirmar tu transferencia"; an expired row reads "No pudimos confirmar tu transferencia a tiempo" and names the fixture's business (`ispName`); a link that does not exist reads "Pide el link correcto a quien te lo envió."; the no-link root reads "Tu pago" and "a quien te envió el link"; the bank list of the typed form and of "Otro banco" has no "BANXICO" option; axe clean.

### Implementation for User Story 4

- [X] T027 [US4] The copy (`confirmation-hierarchy D13`, `D14`; contracts/payment-page.md "The payer's copy"): every row of the sentence table in `apps/pago/src/features/pago/PaymentPage.tsx` (lines 144, 848, 859, 860, 1349, 1515, 1634, 1636, 1637, 1653–1654, 1669–1670, 1681–1682, 2013, 2014, 2017, 2018, 2021 at `77bc503`), `apps/pago/src/features/pago/RootScreen.tsx:28, 33–34` and `apps/pago/index.html:7`; `payErrorCopy` takes the business's name for `TRANSFER_NOT_FOUND`; comments that quote a changed sentence follow it (`PaymentPage.tsx:2026`). Then the seventeen assertions that name the old words, each to the new one: `apps/pago/test/pago.test.tsx:628, 648, 673, 939` (`/validación en proceso/i` → `/seguimos buscando tu transferencia/i`), `:740` (→ `/no pudimos confirmar la transferencia a tiempo/i`), `:762` (→ `/tu servicio ya volvió/i`), `:1112` (→ `/no pudimos confirmar tu transferencia a tiempo/i`); `apps/pago/test/payment-without-receipt.test.tsx:325, 563, 680, 686` (→ "Seguimos buscando tu transferencia."); `tests/design/review-pr88.spec.ts:115, 126` and `review-pr90.spec.ts:188` (→ "Seguimos buscando tu transferencia"), `review-pr94.spec.ts:142` (→ "no pudimos confirmar la transferencia a tiempo"), `review-pr104-105.spec.ts:132, 145` (→ "tu servicio ya volvió"). The "protect face" assertion (`pago.test.tsx:784`, absence of `/ya volvió/i`) stays as it is.
- [X] T028 [US4] The bank list (`confirmation-hierarchy D15`): a new `apps/pago/src/features/pago/payer-banks.ts` exporting `payerBanks` — `BANKS` without `"BANXICO"`, its comment citing D15 and why `banks.ts` stays whole (generated, the provider's vocabulary, read by the API); `TransferForm` (`PaymentPage.tsx:420`) and "Otro banco" (`ConfirmPayment.tsx:159`) list it; a draft or status whose bank is `BANXICO` pre-selects nothing. In `specs/012-payment-without-receipt/contracts/payment-page.md`, the asks table's `null` row reads "Seguimos buscando tu transferencia." with a dated note citing this spec.

**Checkpoint**: US4 is complete — the copy scan passes, and every moment reads the same way on every business.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T029 [P] Comments and records: every rule this feature adds cites `confirmation-hierarchy D<n>`; the comments 012 T053 sweeps for D11, D15, D17 and D25 say the amended meaning and cite both decisions; in `specs/012-payment-without-receipt/tasks.md`, each amended task checked off says "built per spec 017 T0xx"; the 012 tests those tasks changed (T021, T038) also cite `confirmation-hierarchy US1` where they now prove it.
- [X] T030 Run `specs/017-confirmation-hierarchy/quickstart.md` end to end on the sandbox, then every gate in CI order and `pnpm e2e`; record the commit and the test counts against T001's in this task's notes in `specs/017-confirmation-hierarchy/tasks.md`, and the pay route's latency for answer rows on the sandbox (SC-003's instrument).
  - *Done 2026-10-01, measured on `34ae3bd` (branch `claude/017-confirmation-hierarchy-implement`), then rebased onto `88007c0`, which adds only spec 018's documents and constitution v1.9.1.*
  - **quickstart.md on the sandbox** (`wrangler dev --local` + `apicep-mock.mjs`): every step behaves as written. US2's step 3 asked the characters only, because step 2 had confirmed account `…4417` for another customer — FR-013 as specified, not a fault.
  - **SC-003's instrument:** the pay route answered tie-break rows in a median of 47 ms, p95 58 ms, max 67 ms (n = 10, local workerd + D1). Provider calls counted on the mock: 11 calls for 11 searched rows; 13 answer rows made none.
  - **Gates in CI order:** spec-lint 98 test files (T001: 95); gen-banks 97 banks, in step; contrast-lint 38 pairs at AA in both themes (T001: 34 — T042's two pairs, each theme), the same six below the AAA target as T001; pending-lint 32 labels; typecheck and build, every workspace.
  - **Tests against T001:** api 1095 in 59 files (1052 in 58); pago 172 in 5 files (127); admin 337, ui 50, landing 10, unchanged.
  - **`pnpm e2e`:** 167 of 168. The one red is `feedback.spec.ts` "nothing is painted… when the answer beats the threshold" — the admin's feed, which this feature does not touch. It fails the same way on `34ae3bd` with this work stashed, in this container's Chromium (`/opt/pw-browsers`, not the version Playwright pins), and passed in CI on that commit (Deploy Dev run 245). Not this feature's; CI is the judge.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001)**: after 012's T001–T008.
- **Foundational (T002–T004)**: after T001.
- **Exclusive accounts (T005–T007)**: after Foundational and 012's T034 (`learnedAccounts`); runs with 012's T035.
- **US1 (T008–T012)**: after Foundational and 012's T027 (`ConfirmPayment` exists); T012 after 012's T042. It does not wait for Exclusive accounts.
- **US2 (T013–T021)**: after Exclusive accounts and 012's US4 (T037–T042: the ladder and the ask route); it takes the place of 012's US5 typed tasks.
- **US3 (T022–T024)**: after Exclusive accounts; T024 after T018 and 012's T056.
- **US4 (T025–T028)**: after Setup only; it needs no other phase of this feature, and 012 is already built.
- **US5 (T039–T050)**: tests first (T039–T041). T042–T044 after Setup (step 1 needs nothing else); T045–T047 after US1 (T010–T012, T036); T048 after T033; T049 after T021; T050 any time after Setup.
- **Polish (T029–T030)**: after the stories wanted, with 012's T053–T054.

### User story dependencies

- **US1** needs no other story of this feature.
- **US2** needs no other story of this feature; it reads Exclusive accounts (T005–T007).
- **US3** needs US2's answer path (T018) only for the transition's tie-break (T024).

### Within each story

- Tests first, failing; then the contract, the matcher, the lifecycle, the route, the page.
- Pure tables (T013, T022) before the matcher (T017, T024).

### Shared files

- `apps/api/test/confirmation-hierarchy.test.ts`: T005, T014, T023 — sequential.
- `apps/api/test/consta/match.test.ts`: T013, T022 — sequential.
- `apps/pago/test/confirmation-hierarchy.test.tsx`: T008, T015, T026, T039, T040 — sequential.
- `apps/api/src/routes/direct-payments/handler.ts`: T019, T020, T024 — sequential.
- `apps/api/src/direct-payments/validation.ts`: T018, T024 — sequential.
- `apps/api/src/consta/bundle/match.ts`: T017, T024 — sequential.
- `apps/pago/src/features/pago/PaymentPage.tsx`: T012, T021, T027, T028, T043, T047, T048, T050 — sequential.
- `apps/pago/src/features/pago/ConfirmPayment.tsx`: T011, T028, T045, T046, T047 — sequential.

## Parallel Examples

```text
# Foundational, once T002 has landed:
T003 sandbox scenarios   |  T004 test helpers

# Exclusive accounts beside US1 (different files):
T005 exclusivity tests → T006 → T007   |  T008 page tests (US1)  |  T009 e2e (US1)

# US1 and US2 tests together (different files):
T008 page tests (US1)    |  T009 e2e (US1)      |  T013 fitTieBreak tables (US2)  |  T014 lifecycle tests (US2)

# US2 implementation where files differ:
T016 schema.ts           |  T017 match.ts       |  T021 TieBreakForm.tsx (after T016)
```

## Implementation Strategy

### MVP first (User Story 1)

With 012's US1 and US2 built, T001–T004 and T008–T012 give the payer the new order: the
own reference in the centre, the typed form second, the receipt quiet.
Until US2 lands, the typed form sends today's typed door, with today's
shared-reference stops and matcher (T011), so a typed reference never
confirms without its second fact; 012's `SENDER_TAIL_NEEDED` is never
built.

### Incremental delivery

1. Foundational (T002–T004), then US1 (T008–T012): the order.
2. Exclusive accounts (T005–T007): the `own` mode is already safer, since
   `knownAccounts` holds exclusive accounts only.
3. US2 (T013–T021): the typed path and the tie-break, in place of 012's
   US5 typed tasks.
4. US3 (T022–T024): exclusivity proven across the `own` mode and the
   transition.
5. US4 (T025–T028): the payer's copy — it can also ship first, on its own.
5b. US5 (T039–T050): the design. Step 1's account, `ReferenceBox` and
   `TransferExample` can ship right after US4, since they change only step
   1; step 2's parts follow US1 and US2.
6. Polish (T029–T030).

## Notes

- 50 tasks, all open: T001–T030, Phase 9's T031–T038 and US5's T039–T050; T001 records the baseline and T030 the result (it runs quickstart US5 too).
- A task that turns out to need a decision not in plan.md stops and asks
  the creator; it does not make one silently.

---

## Phase 9: Convergence

**Purpose**: spec 012 was built on its own, the old way (#261, `70fe732`), before any task above ran. The tables "Where these tasks sit in spec 012's order" no longer apply: every task above now changes code that exists. These tasks name what 012 built that this feature removes or reshapes, where it lives at `77bc503`, and which task above each one completes; run each with the task it names.

- [X] T031 Remove `SENDER_TAIL_NEEDED` everywhere 012 built it, with T016 and T019 (`confirmation-hierarchy D5`; 012 D11 amended, both cited): the refusal in `submitPayment` that stops a typed confirmation before any search when no account is learned (`apps/api/src/routes/direct-payments/handler.ts:631-638`); the code in the pay refusals (`apps/api/src/routes/direct-payments/schema.ts:280`); on the page, its `payErrorCopy` entry (`apps/pago/src/features/pago/PaymentPage.tsx:169`), `TransferForm`'s `askSenderTail` prop and field (`PaymentPage.tsx:230, 278-281, 314, 377-379, 463`) and their callers (`:964, 970, 2499, 2513`), and `ConfirmPayment`'s inline four-digit field on the transition's previous reference (`apps/pago/src/features/pago/ConfirmPayment.tsx:115-117, 311-325, 343, 354`) — that typed confirmation now searches at once and, on a tie, reaches T021's screen per US2/AC1 (contradicts)
- [X] T032 Rewrite the built answer path onto `fitTieBreak`, with T018 (`confirmation-hierarchy D6`; 012 D17 amended): the block at `apps/api/src/direct-payments/validation.ts:717-800` fits one way at a time (`claveTail`, else `senderTail`) and, on a miss, drops the kept candidates (`fate: "dropped"`, `why: "tail"`, `reason: "none_fit"`); it becomes T018's answer — both ways through `fitTieBreak` with `othersAccounts`, a way that fitted carried forward, a miss copying the waiting row's trail unchanged, `tie_break` written. `sameSearch` (`:382-386`) stays what makes a row an answer. The typed single-transfer stop (`:1145-1148`) becomes an undecided row asking `tie_break` with `several: false` (FR-009). A row the built path wrote before this change (a tail set, `tie_break` NULL) derives its ask by T020's table, never an ask the enum no longer has, per plan: D6 (contradicts)
  - *One case kept as 012 had it:* a typed search whose single CEP's cadena could not be read (bug: single-cep-unreadable) keeps no transfer an answer could be read against, so it asks the whole clave, not the tie-break — the data model's "waiting on a tie-break" needs transfers kept. A readable single match asks `tie_break` with `several: false` (FR-009) through the ordinary `typed` mode.
- [X] T033 Replace the built `sender_tail` and `clave_tail` asks with `tie_break`, with T016, T020 and T021 (`confirmation-hierarchy D9`; 012 D15 amended): both values leave the enum at `apps/api/src/routes/direct-payments/schema.ts:504`; `askOf` (`apps/api/src/routes/direct-payments/handler.ts:1418-1448`) becomes T020's table, the transition's own row included (T024); on the page, their copy (`PaymentPage.tsx:807-818`), the `askForm` condition (`:820`) and the two `TailAsk` screens (`:885-900`) give way to `TieBreakForm`, and `TailAsk` goes if nothing else renders it, per plan: D9 (contradicts)
- [X] T034 Exempt both answers from the hourly budget where 012 built it, with T019 (`confirmation-hierarchy D8`; 012 D25 amended): today only a `claveTail` is exempt (`safeExit`, `apps/api/src/routes/direct-payments/handler.ts:574-577`) and left out of the count (`:138`), so a `senderTail` answer counts and can be refused `TOO_MANY_ATTEMPTS`; both ways become exempt and uncounted, the comment citing both decisions (T019's `handler.ts:88` is this place). The built `fitsWithoutCall` guard (`:919-935`), under which a tail on a row that is not undecided spends a search as a correction, becomes the check T019 refuses with `409 TIE_BREAK_NOT_ASKED`, per plan: D8, D11 (contradicts)
- [X] T035 Land exclusivity and the `typed` mode where 012 built them, with T007, T017 and T024 (`confirmation-hierarchy D4`, `D10`): the payer's side of the match is `payerSide` in `apps/api/src/direct-payments/validation.ts:388-420`, not `receiptSideOf` in `cep-match.ts` as T007 says — its `knownAccounts` becomes the learned accounts minus `accountsOfOthers(…)`, with `othersAccounts` beside it, in the `typed` branch, the `own` branch and the transition; `matchTyped` and `typedTail` in `apps/api/src/consta/bundle/match.ts:227-290` lose the tail step (`by: "sender_tail"` in this mode), which `fitTieBreak` takes over; `fitClaveTail` (`:295`) stays for T017 to reuse, per plan: D10 (partial)
- [X] T036 Build US1's step on the page 012 built, as T010–T012 say, at these places (`confirmation-hierarchy D2`, `D3`): the view switch exists as `proofView` in `apps/pago/src/features/pago/PaymentPage.tsx:1018` — page state, `"confirm" | "typed" | "receipt"`, a reload lands on the confirmation — so it is D3's view state and T011 adds no second one in `ConfirmPayment`; `ConfirmPayment`'s exits (`ConfirmPayment.tsx:363-381`) become "Pagué otra cantidad" above **Confirmar pago**, then **Usé otra referencia** (`secondary`) and `ReceiptLink`; the typed view (`PaymentPage.tsx:2486-2555`: "Ver los datos otra vez", the heading "No puse la referencia", its intro, a `secondary` "Sube tu comprobante") takes the name "Usé otra referencia" (FR-007), T011's intro, **Volver** and `ReceiptLink`; the asks' receipt button (`:820-824, 901, 977`), today `secondary` after an ask form and quiet at the end of every waiting row, the plain wait included, becomes `ReceiptLink` last on the views T012 names and nothing on the plain wait; the expired view's `secondary` "Sube tu comprobante" (`:1971-1973`) becomes `ReceiptLink`, per US1, FR-005 (contradicts)
- [X] T037 Rewrite the 012 tests that prove the old tie-break so they prove this feature's, each with the task that changes its behavior — none skipped, none deleted to get green; each keeps its `payment-without-receipt US<n>` citation and adds `confirmation-hierarchy US<n>`: `apps/api/test/payment-without-receipt.test.ts:783-990` (`SENDER_TAIL_NEEDED` at 807; the `sender_tail` and `clave_tail` asks at 855, 872, 951, 964, 981; typed rows with a tail at 814, 843) → the typed door searching at once and the `tie_break` ask (T031–T033); `apps/api/test/consta/match.test.ts:229-353` (the `typed` mode's tail rows at 302, 320, 353) → T013's `typed` rows, the `fitClaveTail` table (324-337) kept while T017 reuses it; `apps/pago/test/payment-without-receipt.test.tsx` — the exits and the typed view by their old names (249, 273-287, 390-400, 697-773, 816, 833-922), `SENDER_TAIL_NEEDED` (478, 872-896, 1085-1104), the two tail asks (733, 935-1009) → T036's names and T021's screen; `tests/e2e/pago.spec.ts:352` → "Pagué otra cantidad", "Usé otra referencia", "Subir foto del comprobante", per Constitution IV, VII (missing)
  - *Done.* 012's `two candidates sharing the four characters` test passed by accident (its claves ended `A7K1` and `B7K1`); its fixture now really shares `…07K1`.
- [X] T038 Records (`confirmation-hierarchy D1`): a dated amendment to D1 in `specs/017-confirmation-hierarchy/plan.md` — 012 was built on its own (#261, `70fe732`) with its own tie-break, and this feature changes that code through Phase 9; in `specs/012-payment-without-receipt/tasks.md`, the note "Amended by spec 017" (lines 28-40) says the listed tasks were built as 012 wrote them and are changed by spec 017 T031–T037, and T029's "built per spec 017 T0xx" reads "changed by spec 017 T0xx" on those lines, per plan: D1 (contradicts)

---

## Phase 10: User Story 5 — The page shows where to pay and the payer's reference first, and teaches as it goes (Priority: P2)

**Goal**: proposal E on links with a reference — the account by the method the business chose, the reference's own box, the example that fills itself, chips, the why, the wait's steps, where to find a tie-break answer, and the line about next month — in the page's own look.

**Independent Test**: quickstart US5 — links of businesses paid by CLABE, card and phone; step 1's order and the example with and without reduced motion; chips by keyboard; the why; option 2's tags; the wait's steps; the tie-break's illustration; the confirmed line. A link without a reference is today's.

### Tests for User Story 5 (write first, see them fail)

- [X] T039 [P] [US5] Step 1 page tests in `apps/pago/test/confirmation-hierarchy.test.tsx` (cite `confirmation-hierarchy US5`), MSW with schema-validated fixtures for `collectAccount.kind` `clabe`, `card` and `phone`: the tag reads "CLABE", "Tarjeta de débito" or "Celular"; the number with its copy button; the "Banco" row for `card` and `phone` only; the "directo a su cuenta" line names the fixture's `ispName`; `ReferenceBox` is a region named "Tu referencia" after the account and before the example, with "Solo tuya", the grouped digits, a copy that writes the seven digits, the phone's note only when `fromPhone`, `referenceHint`'s sentence and the why; `TransferExample` holds its four rows with the reference row marked, and "Ver otra vez" remounts it; without `payerReference`, step 1 is today's; axe clean.
- [X] T040 [P] [US5] Step 2 and after, page tests in the same file (cite `confirmation-hierarchy US5`): the bank and the day are radio groups (`role="radio"`, one checked) drawn as chips, the arrow keys move the choice and the group is one tab stop; the preselected-bank line only when a learned bank is preselected; "¿Por qué te preguntamos esto?" toggles `aria-expanded` and its sentence with no request (MSW errors on any); option 2 shows the three tags and sends `referenceSource: "typed"` with the confirmation's bank, day and amount unchanged; the plain wait lists the three steps with `aria-current="step"` on "Verificamos tu transferencia" and no receipt link; the tie-break's illustration holds no digit or character of the fixture's candidates; a confirmed `own` row ends with the next-month line carrying the payer's digits, and a confirmed `typed` row does not; axe clean.
- [X] T041 [P] [US5] The browser layer in `tests/e2e/pago.spec.ts` with stubs in `tests/e2e/stubs.ts` (cite `confirmation-hierarchy US5`): at 360, 768 and 1280 in both themes — chips, copy buttons, "Ver otra vez" and the why at least 48px with a measured focus ring; the reference's box and the tags pass contrast with axe's rule on; no horizontal scroll with a CLABE, a card and a phone; with `reducedMotion: "reduce"` emulated, the example's four values are visible at once and no element of step 1 has a running transform animation.

### Implementation for User Story 5

- [X] T042 [US5] Contrast pairs (`confirmation-hierarchy D17`): in `scripts/contrast-lint.mjs`, `--color-text-link` and `--color-text-primary` on `--color-accent-primary-subtle` (AA normal), the subtle surface composed over the card; run it in both themes and record the measured ratios in the pair's comment (`measured 2026-10-01: 4.8:1 light, 6.2:1 dark` for the link ink, to be confirmed by the script).
  - *Measured by the script:* link ink 4.76:1 light, 6.21:1 dark; body ink 15.2:1 light, 11.1:1 dark, the surface composed over the card.
- [X] T043 [US5] Step 1's account and `ReferenceBox` (`confirmation-hierarchy D19`; spec FR-024, FR-025): in `apps/pago/src/features/pago/PaymentPage.tsx`'s step "transfer", on links with `payerReference` only — "Transfiere a" with the kind's tag (`ACCOUNT_LABEL`, an icon per kind), the number's copy row, the "Banco" row for `card` and `phone`, the "directo a su cuenta" line by kind and `ispName`; a new `apps/pago/src/features/pago/ReferenceBox.tsx` with the contract's parts and `CopyButton`; today's `CopyField` rows and well stay for links without a reference (FR-006).
- [X] T044 [US5] `TransferExample` (`confirmation-hierarchy D20`; spec FR-026): a new `apps/pago/src/features/pago/TransferExample.tsx` — the four rows by kind, the stepped `clip-path` reveal on the duration tokens, the reference row's outline last, replay by a `key` bumped from "Ver otra vez", no keyframe under `prefers-reduced-motion`; its keyframes in the app's stylesheet beside the existing motion, no raw duration literal in the component.
- [X] T045 [US5] Chips (`confirmation-hierarchy D18`; spec FR-027): `layout?: "rows" | "chips"` in `apps/pago/src/components/ui/choice-group.tsx` — the same native radios and label-as-target; chips are pills at 48px on `--border-radius-full`, the chosen one with the check icon and a focus-colour outline; the comment cites D18 and 012 D21. `ConfirmPayment.tsx` uses `chips` for the bank and the day, with the day labels of the contract and the preselected-bank line.
- [X] T046 [US5] The why (`confirmation-hierarchy D17`; spec FR-028): in `ConfirmPayment.tsx`, the link-styled button with `aria-expanded` and the sentence in a well, opening in place; nothing sent.
- [X] T047 [US5] Option 2 takes the confirmation's choice (`confirmation-hierarchy D21`; spec FR-029; amends T011 and T036): the bank, day and amount state moves from `ConfirmPayment` up to `PaymentPage` beside `proofView`; the typed view renders `TransferForm`'s key fields only, the three tags ("Elige tu banco" when none), and sends the choice unchanged; **Buscar mi pago** waits for a bank.
- [X] T048 [US5] The wait's steps (`confirmation-hierarchy D22`; spec FR-030): in `SourcedReview` (`PaymentPage.tsx`), the plain wait of a sourced row shows the three-step list derived from the row, the current step breathing through `Pending`, `aria-current="step"`, and the contract's line under it; no `ReceiptLink`.
- [X] T049 [US5] The tie-break's illustration (`confirmation-hierarchy D22`; spec FR-031): in `TieBreakForm.tsx` (T021), the figure of the contract above the fields, static markup with placeholders only, its comment citing FR-018.
- [X] T050 [US5] The confirmed line (`confirmation-hierarchy D22`; spec FR-032): in `PaymentPage.tsx`'s confirmed view, after the folio, the next-month line on rows with `referenceSource = "own"`, with the payer's grouped digits; the step 1 sections' entrance and the reference's glow (FR-033) land with T043 and T044.

**Checkpoint**: US5 is complete — both steps read as proposal E, in the page's own look, and a link without a reference is today's page.

---

## Phase 11: Convergence

- [ ] T051 Make the WhatsApp message of a panel link assume no business type: `shareText` in `apps/api/src/routes/direct-payments/handler.ts:1736` sends the payer "Hola, aquí está tu link de pago de internet." — the one payer text R13's sweep of the API missed (it looked for Banxico only). Use `apiShareText`'s words (receipt spec D3) and keep the reusable line: "Hola, aquí está tu link de pago. Guárdalo: sirve cada mes."; its comment cites `confirmation-hierarchy D14` and constitution IX; add an API test (cite `confirmation-hierarchy US4`) that the `waLink` text of a panel customer row, with and without a reference, names neither "internet" nor "Banxico", per FR-021 (partial)
- [ ] T052 Draw the confirmed check on a link with a reference: on the confirmed view of `apps/pago/src/features/pago/PaymentPage.tsx`, the check of the "Pago confirmado" badge draws once in `--duration-slow` (a stroke reveal in `apps/pago/src/styles.css`, beside step 1's motion, no raw duration); under reduced motion it shows drawn, with no keyframe; a link without a reference keeps today's confirmed view (FR-034); a page test (cite `confirmation-hierarchy US5`) and the e2e reduced-motion check cover it, per plan: D17, D20 (contracts/payment-page.md "Motion", FR-033) (partial)
