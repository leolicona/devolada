---

description: "Task list for automated-collections-api"
---

# Tasks: automated-collections-api

**Input**: Design documents from `/specs/003-automated-collections-api/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/public-api.md](./contracts/public-api.md), [quickstart.md](./quickstart.md)

**Tests**: Required, not optional. Constitution IV says each layer answers only what it can, and VII says every test cites its story — a feature is done when its stories have cited tests at the layer that can answer them. Every test file below carries `automated-collections-api US<n>`.

**Organization**: grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: the user story this serves (US1–US4). Setup, Foundational, Test Mode and Polish carry none
- Every task names its file

## Path Conventions

Per [plan.md](./plan.md): `apps/api/src/` for the API, `apps/api/test/` for its suite, `apps/admin/src/` and `apps/admin/test/` for the panel, `apps/pago/` for the payer's page, `tests/e2e/` for the browser layer.

---

## Phase 1: Setup

**Purpose**: unblock the work the repo's law blocks, then scaffold the new area.

- [ ] T001 Amend the constitution's opening sentence via `/speckit-constitution`, using the wording proposed in `specs/003-automated-collections-api/plan.md` (Constitution Check). Governance forbids routing around it, so nothing below may merge first. MINOR bump, Sync Impact Report updated in `.specify/memory/constitution.md`
- [ ] T002 Add the `./v1-schema` export to `apps/api/package.json` so the panel and the stubs import the contract from one place (constitution III)
- [ ] T003 Create the pure router skeleton in `apps/api/src/routes/v1/index.ts` and mount it in `apps/api/src/index.ts`, **excluded from the CORS allow-list** — `/v1` is server-to-server (research D1)
- [ ] T004 [P] Pin the webhook test destination origin in `apps/api/vitest.config.ts`, beside the existing WispHub and Resend pins, so a developer's `.dev.vars` can never redirect a delivery out of the suite (constitution IV)

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user story can begin until this phase is complete. It carries the only migration and the gate split the whole feature rests on.

### Schema and migration

- [ ] T005 Widen `payment_links` in `apps/api/src/db/schema.ts`: add `source`, `mode`, `customer_ref`, `ask_cents`, `label`, `concept`, `expires_at`, `closed_at`, `is_test`, and relax `wisphub_customer_id` / `customer_usuario` to nullable, with the schema comment citing `automated-collections-api D3` and stating every invariant from `data-model.md`
- [ ] T006 Replace `payment_links_business_usuario_idx` in `apps/api/src/db/schema.ts` with the two partial unique indexes of research D4, commenting why one index over both namespaces would let a WispHub usuario collide with a caller's reference
- [ ] T007 Add `customer_ref`, `asked_cents` and `is_test` to `payments` in `apps/api/src/db/schema.ts`, citing `automated-collections-api D12` and the denormalisation reason already stated for the WispHub customer fields beside them
- [ ] T008 Add `api_credentials`, `api_webhooks`, `webhook_deliveries`, `idempotency_keys` and `rate_counters` to `apps/api/src/db/schema.ts` per `data-model.md`, each with the comment saying what it is for and citing its decision
- [ ] T009 Generate the migration with `pnpm --filter @devolada/api db:generate` and apply it with `db:migrate:local`; confirm the generated SQL performs SQLite's table rebuild for `payment_links` and **recreates both partial unique indexes**
- [ ] T010 [P] Write `apps/api/test/collections-api-schema.test.ts` (`automated-collections-api US1`) proving after migration that an API link row needs no WispHub customer, that a second reusable link for one `customer_ref` is rejected, and that a panel link and an API link may share the same string without colliding

### Credentials and middleware

- [ ] T011 [P] Implement `dk_` key generation, SHA-256 hashing and the key tail in `apps/api/src/api-clients/credentials.ts`, mirroring `apps/consta/src/auth/api-key.ts` and citing `automated-collections-api D11` plus the comment on why ours is hashed while the provider keys are not
- [ ] T012 [P] Implement credential reads and writes in `apps/api/src/api-clients/store.ts` — issue, list with tails, revoke by timestamp, touch `last_used_at`
- [ ] T013 Implement `requireApiCredential` in `apps/api/src/routes/v1/middleware.ts`: resolve the credential to exactly one business, refuse missing/unknown/revoked without revealing anything (FR-005), refuse a suspended business (FR, research D15), and set the business and the test flag on the context
- [ ] T014 [P] Implement the per-business minute-bucket rate limit in `apps/api/src/routes/v1/middleware.ts` over `rate_counters`, answering `RATE_LIMITED` with how long to wait (FR-024, research D13)
- [ ] T015 [P] Implement idempotency in `apps/api/src/routes/v1/middleware.ts` over `idempotency_keys`, replaying the first stored response verbatim (FR-008, research D14)
- [ ] T016 [P] Add the `/v1` envelope helper with `retryable` in `apps/api/src/routes/v1/envelope.ts`, and the error-code union from `contracts/public-api.md`, citing the Complexity Tracking entry that justifies the field

### The gate split — the load-bearing change

- [ ] T017 Split `speiAvailable()` in `apps/api/src/direct-payments/validation.ts` into `channelAvailable(env, business)` (CLABE + known bank + Consta) and `askAvailable(link, integration)` (a panel link needs the WispHub key, an API link does not), citing `automated-collections-api D5` and restating what "no WispHub key" now means
- [ ] T018 Update the WispHub refusal at `apps/api/src/direct-payments/validation.ts:530` so `WISPHUB_NOT_CONFIGURED` can only be reached by a panel link
- [ ] T019 Update the three other call sites of the old predicate in `apps/api/src/routes/direct-payments/handler.ts` (`getLinkStatus`, `submitPayment`) to use the split gates
- [ ] T020 Implement link state derivation — `open` / `paid` / `expired` — in `apps/api/src/direct-payments/links.ts`, deriving from `closed_at` and `expires_at` per `data-model.md` rather than storing a fourth column
- [ ] T021 Write `apps/api/test/collections-api-channel.test.ts` (`automated-collections-api US1`) proving a business with **no WispHub integration row at all** passes `channelAvailable` and can hold a link, and that a panel link without the WispHub key still degrades exactly as it does today
- [ ] T022 Run `pnpm --filter @devolada/api test` and confirm every existing suite still passes after T017–T019 — the gate split touches the shared money path, so an untouched red test here is the feature's first real risk

**Checkpoint**: a non-ISP business can exist, hold a credential and own a link row. No story work before this point.

---

## Phase 3: User Story 1 — The caller's own system creates the payment link (P1) 🎯 MVP

**Goal**: a business's software creates a link and sends it. Nobody opens the panel to collect.

**Independent Test**: issue a credential in the panel, create a reusable and a one-time link by API, open both in a browser, see the right amount and the business's own CLABE. Re-price the reusable one and watch the page change. Pay the one-time one and watch it close.

### Tests for User Story 1

- [ ] T023 [P] [US1] Write `apps/api/test/collections-api-links.test.ts` (`automated-collections-api US1`) covering spec scenarios 1–9: create reusable, re-price, create one-time with a deadline, close on payment, expire, same-reference returns the same link, idempotency key replays the first response, `CHANNEL_UNAVAILABLE` naming the missing piece, junk credential reveals nothing, and cross-business isolation
- [ ] T024 [P] [US1] Add to `apps/api/test/collections-api-links.test.ts` the spec scenario 10 assertion: every response body and error code produced by `/v1/payment-links` is free of ISP vocabulary (no `usuario`, `servicio`, `wisphub`, `subscriber`) — SC-011
- [ ] T025 [P] [US1] Write `apps/admin/test/api-credentials.test.tsx` (`automated-collections-api US1`) covering FR-001/003/004: the key shows once and never again, the tail identifies it afterwards, revoke takes effect, every wait sits inside `<Pending>`, and `axe` passes on the rendered screen
- [ ] T026 [P] [US1] Add a payer-page case to `apps/pago/test/pago.test.tsx` (`automated-collections-api US1`): an API link renders the ask, the CLABE and the caller's reference, and a closed or expired link renders its es-MX explanation with no CLABE (FR-031)

### Implementation for User Story 1

- [ ] T027 [P] [US1] Define the link contract in `apps/api/src/routes/v1/payment-links/schema.ts` per `contracts/public-api.md` — create, patch, read, list — with `askCents` as a positive integer and `expiresAt` required only for `one_time`
- [ ] T028 [US1] Implement the handler in `apps/api/src/routes/v1/payment-links/handler.ts`: create (reusable returns the existing row, research D4), re-price, close, read, list — all filtered by the credential's business
- [ ] T029 [US1] Wire the pure router in `apps/api/src/routes/v1/payment-links/index.ts` — middleware, `zValidator`, no logic (constitution III)
- [ ] T030 [US1] Branch `getLinkStatus` in `apps/api/src/routes/direct-payments/handler.ts` so an API link builds the **same** `LinkStatusResponse` from `ask_cents` — `status: "debt"`, `cobros: []`, `reference` = `customer_ref` — with no WispHub client constructed (research D6)
- [ ] T031 [US1] Add the `closed` status to `apps/api/src/routes/direct-payments/schema.ts` and return it for a paid or expired one-time link
- [ ] T032 [US1] Branch `submitPayment` in `apps/api/src/routes/direct-payments/handler.ts`: an API link's ask is `ask_cents`; refuse a submission on a closed or expired link; store `customer_ref` and `asked_cents` on the payment row
- [ ] T033 [P] [US1] Render the closed and expired states in `apps/pago/src/features/pago/PaymentPage.tsx` with es-MX copy, tokens only, no CLABE offered (constitution VI)
- [ ] T034 [P] [US1] Build `apps/admin/src/features/integrations/ApiScreen.tsx` from `@devolada/ui` atoms: issue a credential, show it once, list tails, revoke, every wait in `<Pending>`
- [ ] T035 [US1] Register the screen in `apps/admin/src/router.tsx` and link it from `apps/admin/src/features/integrations/IntegrationsScreen.tsx`
- [ ] T036 [US1] Add `/v1/payment-links` handlers to `apps/admin/test/msw.ts` and to the Playwright stubs in `tests/e2e/stubs.ts`, validated by the exported schema (constitution III)

**Checkpoint**: money can be collected through the API, and the business sees it in the panel. Deployable as the MVP.

---

## Phase 4: User Story 2 — The webhook tells the caller the transfer was validated (P2)

**Goal**: the loop closes without a human. A verdict reaches the caller's system, signed, retried and never lost.

**Independent Test**: register an address, drive a payment to a verdict, assert the delivery arrives with the payment's facts and a verifiable signature, then make the endpoint fail and watch the schedule run out and the re-send work.

### Tests for User Story 2

- [ ] T037 [P] [US2] Write `apps/api/test/collections-api-webhook.test.ts` (`automated-collections-api US2`) covering spec scenarios 1, 2, 6, 8: every verdict type is announced and named, the body carries all of FR-014's facts, the signature verifies against the raw body, the event id identifies a repeat, and no address registered means nothing is sent and nothing fails
- [ ] T038 [P] [US2] Add retry coverage to `apps/api/test/collections-api-webhook.test.ts` for scenarios 3 and 5: a non-2xx widens the wait through `[1, 5, 15, 60, 240]`, the schedule ends in `failed`, and a re-send delivers the same event id and the same body
- [ ] T039 [P] [US2] Add scenario 4 and 7 coverage to `apps/api/test/collections-api-webhook.test.ts`: a destination that never answers leaves the payment confirmed and the payer's success untouched (FR-017), and a rotation window signs with both secrets so either verifies
- [ ] T040 [P] [US2] Write the FR-029 proof in `apps/api/test/collections-api-no-wisphub.test.ts` (`automated-collections-api US2`): a business with WispHub connected **and actions enabled** pays an API link, and `fetchMock`'s `assertNoPendingInterceptors` proves not one WispHub call was made
- [ ] T041 [P] [US2] Write `apps/admin/test/api-webhook.test.tsx` (`automated-collections-api US2`) covering FR-018: a failing endpoint is visible with its reason, status is icon + text and never colour alone, `axe` passes

### Implementation for User Story 2

- [ ] T042 [P] [US2] Implement the event payload in `apps/api/src/webhooks/events.ts` — rendered once at enqueue and stored, never re-rendered (research D9) — with the five event types of `contracts/public-api.md`
- [ ] T043 [P] [US2] Implement signing in `apps/api/src/webhooks/sign.ts`: `HMAC-SHA256(secret, "<timestamp>.<raw body>")` in hex, one signature per live secret during a rotation window, reusing the WebCrypto shape of `apps/api/src/consta/refs.ts` (research D10)
- [ ] T044 [US2] Implement `enqueueDelivery` and the sweep `sweepWebhookDeliveries` in `apps/api/src/webhooks/queue.ts`: lease first, the same five waits as `reconnection/queue.ts`, terminal `failed` when spent, and speak only when it did something (research D8)
- [ ] T045 [US2] Mount the sweep on the existing every-minute `scheduled` handler in `apps/api/src/index.ts` with `waitUntil` — **no new trigger** (constitution)
- [ ] T046 [US2] Implement the validation seam in `apps/api/src/direct-payments/validation.ts`: branch on `link.source` immediately after the tracking key is adopted; the API branch settles against `asked_cents` with the business's tolerance, sets `action_outcome`, enqueues the delivery, and constructs no WispHub client (research D7, FR-029)
- [ ] T047 [US2] Attempt the first delivery inline at the verdict via `waitUntil` in `apps/api/src/direct-payments/validation.ts`, so the payer's verdict never waits on the caller's endpoint (FR-017)
- [ ] T048 [P] [US2] Define the webhook contract in `apps/api/src/routes/v1/webhook/schema.ts` — register, read, delete, rotate, list deliveries, retry one
- [ ] T049 [US2] Implement the handler in `apps/api/src/routes/v1/webhook/handler.ts`, refusing a destination that cannot protect the message in transit with `INSECURE_URL` (FR-038)
- [ ] T050 [US2] Wire the pure router in `apps/api/src/routes/v1/webhook/index.ts`
- [ ] T051 [P] [US2] Build `apps/admin/src/features/integrations/WebhookScreen.tsx`: the address, the secret shown once on rotation, and delivery health as `StatusBadge` with icon and text
- [ ] T052 [US2] Register the screen in `apps/admin/src/router.tsx` and add its MSW handlers to `apps/admin/test/msw.ts`

**Checkpoint**: US1 and US2 both work. Collections are automatic end to end.

---

## Phase 5: User Story 3 — The caller asks about a payment at any moment (P3)

**Goal**: support answers "did this customer pay?" without opening Devolada, and a missed webhook is never a hole.

**Independent Test**: drive a payment through every state and get the truth from the API at each step.

### Tests for User Story 3

- [ ] T053 [P] [US3] Write `apps/api/test/collections-api-verify.test.ts` (`automated-collections-api US3`) covering all four spec scenarios: validating with its ask, confirmed with folio and amounts, a reference with nothing received answering an **empty list rather than an error**, and another business's payment answering `NOT_FOUND`

### Implementation for User Story 3

- [ ] T054 [P] [US3] Define the read contract in `apps/api/src/routes/v1/payments/schema.ts` per `contracts/public-api.md`
- [ ] T055 [US3] Implement payment-by-id and payments-by-`customerRef` in `apps/api/src/routes/v1/payments/handler.ts`, filtered by the credential's business
- [ ] T056 [US3] Wire the pure router in `apps/api/src/routes/v1/payments/index.ts`

**Checkpoint**: all three of the spec's first priorities work independently.

---

## Phase 6: User Story 4 — The business reconciles the transfers it received (P4)

**Goal**: a month of received transfers pulled in a stable order, matching the business's own books.

**Independent Test**: confirm payments across three days, walk the pages with a small limit, and see every payment exactly once even while new ones arrive.

### Tests for User Story 4

- [ ] T057 [P] [US4] Write `apps/api/test/collections-api-transfers.test.ts` (`automated-collections-api US4`) covering the four spec scenarios: a date range returns exactly its payments with all their facts, a cursor walk with a payment confirmed mid-walk skips and repeats nothing, a non-`America/Mexico_City` business's "Tuesday" is its own day, and unapplied money is visible
- [ ] T058 [P] [US4] Add the D16 assertion to `apps/api/test/collections-api-transfers.test.ts`: `unapplied` covers a payment on a closed link and one against an ask of zero — and nothing claims to report a deposit Devolada was never told about

### Implementation for User Story 4

- [ ] T059 [P] [US4] Define the transfers contract in `apps/api/src/routes/v1/payments/schema.ts` — `from`, `to`, `limit`, `cursor`, `nextCursor`
- [ ] T060 [US4] Implement the day-range resolution in the business's timezone in `apps/api/src/routes/v1/payments/handler.ts`, reusing the existing business-timezone helper rather than a second one (constitution II)
- [ ] T061 [US4] Implement the keyset cursor on `(confirmedAt, id)` in `apps/api/src/routes/v1/payments/handler.ts`, so a concurrent confirmation cannot make a walk skip or repeat a row (FR-020)

**Checkpoint**: all four user stories independently functional.

---

## Phase 7: Test Mode (FR-034, FR-035)

**Purpose**: a developer at a company that is not an ISP integrates without moving real money — and not one test record touches anything real. This is the requirement most likely to leak, so its isolation is tested before it is trusted.

- [ ] T062 [P] Write `apps/api/test/collections-api-test-mode.test.ts` (`automated-collections-api US1`) proving the whole flow runs under a test credential with no Consta call, and then proving the isolation: the panel feed does not list it, the credit balance does not move, the **real** credential's `/v1/transfers` does not return it
- [ ] T063 Implement the test-mode advance endpoint in `apps/api/src/routes/v1/test-mode/{index,handler,schema}.ts`, reachable only by a test credential and answering `NOT_FOUND` to a real one (research D12)
- [ ] T064 Guard the validation fee in `apps/api/src/credit/index.ts` so a test payment is never debited — one gate, in the one place a payment already costs money
- [ ] T065 Add the shared `realOnly` predicate in `apps/api/src/direct-payments/links.ts` and apply it to the business-facing reads in `apps/api/src/routes/payments/handler.ts` and `apps/api/src/routes/direct-payments/handler.ts`, so test rows are excluded by one rule rather than 22 remembered filters
- [ ] T066 Add the test-mode toggle to `apps/admin/src/features/integrations/ApiScreen.tsx` and make a test credential visibly labelled, so nobody confuses the two

---

## Phase 8: Polish & Cross-Cutting

- [ ] T067 [P] Write the published reference at `specs/003-automated-collections-api/contracts/reference.md` covering every endpoint, every error code and the webhook contract — including how to verify a signature and how to recognise a repeat — readable by a developer who has never heard of WispHub (FR-036, SC-004)
- [ ] T068 [P] Add the expiry sweep for `idempotency_keys` and old `rate_counters` buckets to the existing cron in `apps/api/src/index.ts`, riding the same trigger
- [ ] T069 [P] Add the payer's closed and expired states to `tests/e2e/contrast.spec.ts` — real contrast in both themes, 360/768/1280, no horizontal scroll (constitution IV and VI)
- [ ] T070 [P] Extend `apps/api/src/routes/dev.ts` so `/dev/seed` can mint a credential and a test credential for the demo business, making the quickstart runnable in one step
- [ ] T071 Update `.dev.vars` documentation and `apps/api/src/env.ts` comments for any new binding, each saying what "unset" means (constitution VIII)
- [ ] T072 Amend FR-022 in `specs/003-automated-collections-api/spec.md` to "a validated transfer that was not applied", per research D16 — raise it with the developer first; the current wording promises bank reconciliation the product cannot do
- [ ] T073 Run the full gate in order: `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm e2e`
- [ ] T074 Walk `specs/003-automated-collections-api/quickstart.md` end to end against a locally running stack and fix anything it gets wrong
- [ ] T075 Run `/speckit-analyze` and resolve every CRITICAL finding

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)** — T001 blocks everything by Governance; T002–T004 can follow immediately
- **Phase 2 (Foundational)** — depends on Phase 1. **Blocks all user stories.** T005–T009 are strictly sequential (one schema file, one migration); T010–T016 parallelise after; T017–T022 are the gate split and must land together
- **Phase 3 (US1)** — depends on Phase 2
- **Phase 4 (US2)** — depends on Phase 2. Testable on its own, but only observable end to end once US1 exists to create the link
- **Phase 5 (US3)** and **Phase 6 (US4)** — depend on Phase 2; independent of each other and of US2
- **Phase 7 (Test Mode)** — depends on Phase 3 for links and Phase 4 for the webhook it fires
- **Phase 8 (Polish)** — depends on whatever stories shipped

### Story dependencies

- **US1 (P1)**: needs only the foundation. The MVP.
- **US2 (P2)**: needs the foundation. Its seam is in shared code (T046), so land it before US3/US4 if one person is working
- **US3 (P3)**: fully independent
- **US4 (P4)**: fully independent

### Within each story

Tests first and failing, then contract (`schema.ts`), then handler, then router, then the panel and the stubs. Never the router before the handler — the router is pure (constitution III).

### Parallel opportunities

- **Phase 2**: T010 with T011–T012; T014–T016 together after T013
- **Phase 3**: all four test tasks (T023–T026) together; then T027 with T033 and T034
- **Phase 4**: all five test tasks (T037–T041) together; then T042, T043 and T048 together
- **Across stories**: with more than one person, US1 / US2 / US3 / US4 run in parallel the moment Phase 2 is done
- **Phase 8**: T067–T071 all parallel

---

## Parallel Example: User Story 2

```bash
# All five test files first — different files, no dependencies:
Task: "apps/api/test/collections-api-webhook.test.ts — facts, signature, dedup, no-address"
Task: "apps/api/test/collections-api-webhook.test.ts — retries, failure, re-send"   # same file, sequential
Task: "apps/api/test/collections-api-no-wisphub.test.ts — assertNoPendingInterceptors"
Task: "apps/admin/test/api-webhook.test.tsx — failing endpoint visible, axe"

# Then the three independent modules:
Task: "apps/api/src/webhooks/events.ts — payload frozen at enqueue"
Task: "apps/api/src/webhooks/sign.ts — HMAC, both secrets in rotation"
Task: "apps/api/src/routes/v1/webhook/schema.ts — the contract"
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 — Setup, **starting with the constitution amendment**
2. Phase 2 — Foundational, ending with T022: every existing test still green
3. Phase 3 — US1
4. **Stop and validate**: run the US1 half of `quickstart.md`. A business with no WispHub key creates a link by API and a payer pays it
5. Deploy — merge to `main` deploys dev behind the browser and passkey gates

### Incremental delivery

1. Setup + Foundational → a non-ISP business can exist and hold a link
2. + US1 → collections without opening the panel **(MVP)**
3. + US2 → collections without a human at all
4. + US3 → support answers from its own tool
5. + US4 → finance reconciles
6. + Test mode → a stranger can integrate safely

Each step is deployable and breaks nothing before it.

### Where to be most careful

- **T009** is the only migration and the only non-additive one. Confirm both partial unique indexes survive the rebuild before moving on
- **T017–T022** change the shared money path. T022 exists because a green new test over a red old one is not progress
- **T046** edits the most measured function in the repo. Branch inside it; never copy it
- **T062–T065** are test-mode isolation. Write T062 first and watch it fail — a test-mode leak that reaches a real total is worse than no test mode

---

## Notes

- `[P]` means a different file with no incomplete dependency
- Every test file cites `automated-collections-api US<n>` (constitution VII); `spec-lint.mjs` is warning-only until TD-005 is paid — write the citation anyway
- Every non-obvious rule cites its decision as `automated-collections-api D<n>`, and says when a reason was measured
- Commit per task or per logical group; stop at any checkpoint to validate a story on its own
- The admissions policy stays open by the developer's decision of 2026-09-12. T013 honours the existing `businesses.status` gate and adds no policy of its own
