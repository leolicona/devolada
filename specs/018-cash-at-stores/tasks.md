---

description: "Task list for Cash at Stores"
---

# Tasks: Cash at Stores

> **Drift found by T004 (2026-10-01, against `88007c0` + the T002 fix).**
> Nothing the tasks name is missing; four readers they do not name:
> - `proof_mode` has three more readers than T004 lists, none of which meets
>   a cash row: `direct-payments/provisional.ts::releaseEvidenceFor` (a SPEI
>   payment's evidence), `webhooks/events.ts` (`proofDoor`, API links only)
>   and `routes/credit/handler.ts` (the top-ups table's own `proof_mode`,
>   `schema.ts` `top_ups`, which this feature does not touch).
> - The attempt budget is `attemptsInLastHour` in
>   `routes/direct-payments/handler.ts`, read in two places (the pay door and
>   the confirmation door); D12's filter goes in the function, once.
> - The incident history is `provisional.ts::isRevoked`'s sibling query.
> - `/auth/me` has two more readers in the browser layer:
>   `tests/e2e/dropdown.spec.ts` and `tests/e2e/links.spec.ts` stub it
>   directly. Both serve a business actor and keep doing so.
> - T002 landed as `decided_action` (a sibling column, migration 0042):
>   `observed_action` was taken (its contract is "null on every row that
>   really dispatched"). T017's call sites carry `decidedActionOf`.

**Input**: Design documents from `specs/018-cash-at-stores/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/store-api.md](./contracts/store-api.md),
[contracts/platform-stores-api.md](./contracts/platform-stores-api.md),
[contracts/business-cash-api.md](./contracts/business-cash-api.md),
[quickstart.md](./quickstart.md). Constitution v1.8.0.

**Tests are required, not optional.**
- Constitution IV fixes which layer may answer which question.
- Constitution VII requires every test file to cite its story, here as
  `cash-at-stores US<n>`. A task's `[US<n>]` label is what the test it
  lands with inherits.
- The bug's regression test cites `bug: queue-retry-forgets-action`.

**Organization**: by user story, in the spec's priority order:
**US1 (P1), US2 (P1), US3 (P1), US4 (P2), US5 (P2)**.

The three P1 stories are what the pilot needs together:
- **US1 (the counter)** comes first because it is the feature. Its tests
  seed a store and a session directly, so it can be built and proven
  before the operator's screens (US2) or the shopkeeper's sign-in (US3)
  exist.
- **US2 and US3** then make it reachable by real people.

**Three things come before any story**:
1. the measurements (T001). M1 can stop the work;
2. the queue bug, on the lite path (T002);
3. the foundation (Phase 2): tables, the store actor, the capabilities,
   and the extracted settlement.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel: it touches a different file and depends
  on no incomplete task
- **[Story]**: which user story the task serves
- Every task names its file, and every non-obvious rule it writes cites
  `cash-at-stores D<n>` in a comment

## Path Conventions

Paths are as `plan.md` fixes them:
- `apps/api/src/…` and `apps/api/test/…`
- `apps/red/src/…` and `apps/red/test/…` (new)
- `apps/admin/src/…` and `apps/admin/test/…`
- `packages/ui/src/…`
- `tests/e2e/…` and `tests/passkey/…`
- `.github/workflows/…`

---

## Phase 1: Setup

**Purpose**: measure what the design waits on, fix the bug it would
inherit, register the shortcut, and scaffold the fifth surface. No
behaviour changes in this phase except the bug fix.

- [ ] T001 Run quickstart §0's measurements and record each result, with its date, under its decision in `specs/018-cash-at-stores/research.md`:
  *Status 2026-10-01: M1 measured and recorded (it holds). M2 needs an Android phone and an iPhone, and M3 the pilot tenant's key — both still open; research.md says why.*
  - **M1 → D3/D5**, on a local D1. Four answers:
    - the `username` plugin's generated columns;
    - sign-in by `POST /auth/sign-in/username` for a user whose `username` was written in the DB;
    - `EMAIL_NOT_VERIFIED` for the same user, unverified;
    - a `hooks.before` refusal of `username` on `/auth/sign-up/email` and `/auth/update-user`.
  - **M2 → D26**: adding a manifest-only preview to the home screen on Android Chrome and on iOS Safari.
  - **M3 → D8**: on the pilot, read-only, whether `/clientes/?nombre__contains=` rows and `/clientes/?usuario=` carry `zona` and `telefono`.

  If M1 shows the username cannot be kept to the acceptance route, **stop** and take it to the creator before T010.
- [X] T002 Lite path, its own PR, before T016: `/speckit-bug-assess`, `/speckit-bug-fix` and `/speckit-bug-test` under `.specify/bugs/queue-retry-forgets-action/` (research D10).
  - **The bug**: `apps/api/src/reconnection/queue.ts`'s sweep and `retryAction` in `apps/api/src/routes/payments/handler.ts` retry with "reconnect" whatever the row decided.
  - **The fix**: keep the decided action on the row and read it back on every retry.
  - **The regression test** cites `bug: queue-retry-forgets-action`. A `withheld` payment, and a `register_only` one, whose first attempt met a 503, are retried by the sweep as register-only.
- [X] T003 [P] Register the pilot's shortcut with `/speckit-debt-log` as `.specify/debt/store-cash-no-cap/` (research D30).
  - Where it lives: `store_ledger` has no cap check.
  - What it costs: the business's exposure has no ceiling.
  - Exit condition: a cap per store, with a warning before it and collections blocked at it, before a second store or a second business joins.
- [X] T004 Check the consumers this feature changes against the tree, and note any drift at the top of this file before editing:
  - every reader of the feed row's `channel` and `proofMode` (`apps/api/src/routes/payments/schema.ts`, `apps/admin/src/features/feed/`, `apps/admin/test/msw.ts`, `tests/e2e/stubs.ts`);
  - the three `attemptReconnection` callers (`direct-payments/validation.ts`, `routes/payments/handler.ts`, `reconnection/queue.ts`);
  - the link-scoped rules of D12 (`routes/direct-payments/handler.ts` attempt budget, `credit/index.ts::reverseContradictedFees`, `direct-payments/provisional.ts` incident history);
  - every `/auth/me` consumer (`apps/admin/src/features/auth/session.ts`, `tests/e2e/stubs.ts`).
- [X] T005 [P] Scaffold `apps/red` from `apps/pago`'s shape and `apps/admin`'s auth pieces (research D1, D26):
  - `apps/red/package.json` as `@devolada/red`, with `@tanstack/react-router`, `@tanstack/react-query`, `better-auth`, `@better-auth/passkey`, `@devolada/ui`, and dev `@devolada/api`;
  - `vite.config.ts` on port 5177, `tsconfig.json`, `components.json` (new-york, lucide), and `index.html` (`lang="es-MX"`, the theme script);
  - `src/main.tsx`, `src/styles.css` (`@import "@devolada/ui/styles.css"`);
  - `src/lib/api.ts`: `VITE_API_URL`, `credentials: "include"`, `api` / `baPost` / `baGet` as in admin;
  - `src/lib/auth-client.ts` with `passkeyClient()`;
  - `public/manifest.webmanifest`: "Devolada · Tienda", standalone, theme `#0f766e`, icons;
  - `test/{setup.ts,msw.ts,a11y.ts}` and `vitest.config.ts` (happy-dom, MSW `onUnhandledRequest: "error"`, `queryClient.clear()` after each test).
- [X] T006 [P] Add `apps/red/wrangler.jsonc`: an assets-only Worker with SPA fallback, `env.dev` `devolada-red-dev` on `red.dev.devoladapago.com`, and `env.prod` `devolada-red` on `red.devoladapago.com` (D1, D29).
- [X] T007 [P] Add `"apps/red/src"` to `ROOTS` in `scripts/pending-lint.mjs`, and to the roots `scripts/contrast-lint.mjs` scans (D29).
- [X] T008 [P] Declare `RED_BASE_URL` in `apps/api/src/env.ts`. Its comment says what unset means: the same treatment as `PAGO_BASE_URL`. In `apps/api/wrangler.jsonc`:
  - set it per env: `http://localhost:5177`, `https://red.dev.devoladapago.com`, `https://red.devoladapago.com`;
  - add red's origins to `ALLOWED_ORIGINS`: local `http://localhost:5177`; dev `https://red.dev.devoladapago.com` and `*-devolada-red-dev.devoladapago-14b.workers.dev`; prod `https://red.devoladapago.com` (D29).
- [X] T009 Wire red into CI for previews and dev only. Prod waits for T066.
  - `.github/workflows/ci.yml`: a preview build with `VITE_API_URL="${{ vars.DEV_API_URL }}"` and an upload with `scripts/preview-upload.sh devolada-red-dev --config ../red/wrangler.jsonc --env dev`.
  - `.github/workflows/deploy-dev.yml`: a build and a `wrangler deploy --config ../red/wrangler.jsonc --env dev` step beside admin and pago.
  - `playwright.config.ts`: `RED_PORT` 4177, an exported `RED`, and a webServer that builds and previews `@devolada/red` (D29).

**Checkpoint**: measurements recorded and not stopping; the bug fixed on
`main`; the debt registered; an empty `apps/red` builds, typechecks,
tests and previews on every PR.

---

## Phase 2: Foundational

**Purpose**: the ground every story stands on:
- the tables;
- the store actor and its refusals;
- the three capabilities, and the action call sites moved behind them;
- one settlement function for SPEI and cash;
- the link's SPEI rules made blind to cash;
- the cash book's single writer;
- the network fee.

**⚠️ CRITICAL**: no user story work begins until this phase is done. Every
SPEI suite must pass unchanged at its end.

- [X] T010 Schema and one additive migration (data-model; D3, D6, D7, D11, D13, D15).
  - **`apps/api/src/db/schema.ts`**:
    - adds `stores`, `store_invitations`, `store_ledger` and `store_handovers`, with every index and partial unique index data-model lists;
    - `businesses` gains `store_channel_on` and `store_channel_since`;
    - `payments` gains `store_id`, `store_user_id`, `store_fee_cents`, `collection_key`, and UNIQUE `(store_id, collection_key) WHERE collection_key IS NOT NULL`;
    - the TS enums become `channel: ["spei","store"]` and `proof_mode: ["receipt","transfer","none"]`.
  - **`apps/api/src/db/auth-schema.ts`**: `user` gains `username` (unique) and `display_username`, the shape T001's M1 recorded.
  - **The migration**: `pnpm --filter @devolada/api db:generate`. Check the file holds only `CREATE TABLE`, `CREATE INDEX` and `ALTER TABLE … ADD COLUMN`: no `__new_` table and no `DROP`.
- [X] T011 Better Auth in `apps/api/src/auth/better.ts` (D2, D3):
  - add `username()`;
  - add a `hooks.before` that refuses a `username` field on `/sign-up/email` and `/update-user`;
  - give the organization plugin `allowUserToCreateOrganization: (user) => !isStoreUser(user)`. `isStoreUser` is a DB read of `stores.user_id`.
- [X] T012 The store actor (D2):
  - **`apps/api/src/env.ts`** gains `StoreActor` and `Variables.store`.
  - **`apps/api/src/auth/middleware.ts`** gains `requireStore`. It resolves the session, then the store by `stores.user_id`. A suspended store has its session rows deleted and gets 403 `STORE_SUSPENDED`. A user with no store row, or an `invited` one, gets 403 `WRONG_ACTOR`.
  - **`requireSession`** refuses a user with a store row with 403 `WRONG_ACTOR`, before `findActor`.
  - **`apps/api/src/routes/auth.ts`'s `/auth/me`** answers the store branch (contract `store-api.md`).
  - **`POST /businesses`** (`apps/api/src/routes/businesses/handler.ts`) refuses a store user with 403 `WRONG_ACTOR`.
- [X] T013 Test helpers in `apps/api/test/store-helpers.ts`:
  - `seedStore({ status, phone, userId? })`;
  - `storeSession(store)`: a user with `username`, verified, plus a session cookie;
  - `seedStoreChannel(business)`: sets `store_channel_on` and `store_channel_since`;
  - `mockCustomerSearch(rows)` and `mockCustomerDebt(usuario, debt, customer)`, on top of `payer-helpers.ts`' WispHub mocks.
- [X] T014 API tests in `apps/api/test/cash-at-stores-access.test.ts`, citing `cash-at-stores US3`, for T011 and T012:
  - a store user gets `WRONG_ACTOR` on `GET /payments/feed`, `POST /businesses` and `POST /auth/organization/create`;
  - a business member gets `WRONG_ACTOR` on a `requireStore` route;
  - a suspended store gets `STORE_SUSPENDED` and its session row is gone;
  - `/auth/me` answers `type: "store"`;
  - `POST /auth/sign-up/email` with a `username` is refused, and so is `POST /auth/update-user {username}`;
  - a store user is never a platform operator, even with an email in `PLATFORM_OPERATOR_EMAILS`.
- [X] T015 The capabilities' core shapes, in `apps/api/src/integrations/capabilities.ts` (D8, D9):
  - `customerSearch.find(text, limit)`, which answers `{ rows: { usuario, name, zone, providerCustomerId }[], more }`;
  - the `customer` block on `CustomerDebtAnswer`'s `owes` and `none`: `{ providerCustomerId, name, zone }`, with **no phone** (D8, D18);
  - `paymentActions.attempt(input)`, which answers `ActionAttempt` with errors `INTEGRATION_UNAVAILABLE` and `INTEGRATION_AUTH_FAILED`.

  Wire them in `apps/api/src/integrations/registry.ts`, and add both names to `WISPHUB_CAPABILITY_NAMES`.
- [X] T016 The WispHub adapter fills them, in `apps/api/src/wisphub/receivables.ts`, or a sibling `wisphub/actions.ts` if receivables grows past one job:
  - **`customerSearch`** wraps `searchCustomers`. It maps zone as M3 recorded, and never returns the phone.
  - **`customerDebt.of`** returns the `customer` block from the `getCustomer` it already makes.
  - **`paymentActions.attempt`** wraps `attemptReconnection`, and translates `WISPHUB_AUTH_FAILED` / `WISPHUB_UNAVAILABLE` into the `INTEGRATION_*` codes.

  This depends on T002 having landed.
- [X] T017 Move the three action call sites behind `paymentActions` (D9):
  - `settlePanelPayment` in `apps/api/src/direct-payments/validation.ts`;
  - execute and retry in `apps/api/src/routes/payments/handler.ts`;
  - the sweep in `apps/api/src/reconnection/queue.ts`.

  Then two follow-ups:
  - `apps/admin/src/features/feed/FeedScreen.tsx`'s reason map learns `INTEGRATION_UNAVAILABLE` and `INTEGRATION_AUTH_FAILED`;
  - `.specify/debt/core-reads-provider-directly/debt.md` gets a dated note that its action anchors are paid by `cash-at-stores` D9. The read anchors stay open.
- [X] T018 Add API tests to `apps/api/test/cash-at-stores-capabilities.test.ts`, citing `cash-at-stores US1`, with WispHub through `fetchMock`. Cover:
  - search rows carry name, usuario, zone and the provider id, and never a phone;
  - the debt's `customer` block;
  - `paymentActions` translates a 401 into `INTEGRATION_AUTH_FAILED` and a 503 into `INTEGRATION_UNAVAILABLE`.

  Then run the whole API suite: every SPEI test passes unchanged.
- [X] T019 Extract `settleConfirmed` from `settlePanelPayment` in `apps/api/src/direct-payments/validation.ts` (D13). It takes over:
  - folio and customer identity;
  - `settle()` and `classifyPayment()`;
  - the observation gate. The review hold stays in `settlePanelPayment`: it is SPEI-only, and a cash row is never held for review (D13, /speckit-analyze H2);
  - `actionForClass`;
  - dispatch, the first attempt, `outcomeOf` and `settleDispatch`;
  - the final write, through `announcingWriter`.

  Its inputs are `receivedCents`, `debtCents`, `serviceFeeCents`, the invoice id and the customer. `settlePanelPayment` keeps its debt read and its CEP, and calls it.

  Also move `makeFolio` to `apps/api/src/folio.ts` (D17) and update its importers. The SPEI suites pass unchanged.
- [X] T020 Make the link's SPEI rules blind to cash rows (D12), each with a comment citing D12:
  - add `channel = 'spei'` to the attempt budget in `apps/api/src/routes/direct-payments/handler.ts` (the one-hour count);
  - add it to the incident history in `apps/api/src/direct-payments/provisional.ts`;
  - in `apps/api/src/credit/index.ts`, `debitValidationFee` skips `reverseContradictedFees` for a `store` row.
- [X] T021 Add API tests to `apps/api/test/cash-at-stores-capabilities.test.ts`, citing `cash-at-stores US1`, for T020. Seed a `store` payment beside SPEI rows of the same link and check:
  - the payer's SPEI attempt budget is untouched;
  - an earlier `invalid` SPEI row keeps its fee when the cash row is debited;
  - the incident history of a provisional release ignores the cash row.
- [X] T022 Create the cash book's single writer, `apps/api/src/store-ledger/index.ts` (D19):
  - `recordCollection(db, payment)` writes `+applied`, idempotent by the unique `(payment_id) WHERE kind = 'collection'` index;
  - `recordHandover(db, handover)` writes `−cents` when confirmed;
  - `recordCorrection(db, {…})`;
  - `heldCents(db, storeId, businessId)` is a SUM;
  - `feesSinceHandoverCents(db, storeId, businessId)` sums `payments.store_fee_cents` since the last `handover` movement.

  Nothing else in the tree may insert into `store_ledger`.
- [X] T023 [P] Add two settings in `apps/api/src/platform/settings.ts` (data-model § Platform settings):
  - `store_fee_cents`: type `cents`, born at 1500, range 0–5000 (D22);
  - `store_receipt_template`: a new type, `template`, born at research D31's default. `validateSetting` refuses it with `INVALID_SETTING` when it is outside 20–1000 characters, has no `{folio}`, or uses a placeholder D31 does not list.

  Put the renderer in `apps/api/src/receipt/index.ts`, beside `toWhatsAppPhone` and `whatsAppLink`: `renderReceipt(template, values)`. It fills the placeholders, formats money as es-MX MXN, and drops lines left empty (D31). Do not create `src/receipt.ts` (/speckit-analyze U1).

  Add API tests to `apps/api/test/cash-at-stores-operator.test.ts`, citing `cash-at-stores US2`: the three refusals, a save keeps its author, and the renderer drops an empty `{pendiente}` line.

**Checkpoint**:
- a store can be seeded and signed in, and every refusal holds;
- the counter's three questions can be asked by capability;
- one function settles any confirmed payment;
- cash rows cannot disturb a link's SPEI rules;
- the whole SPEI suite still passes.

---

## Phase 3: User Story 1 - Collect cash at the counter (Priority: P1) 🎯 MVP

**Goal**: in `apps/red`, the shopkeeper searches, gets a quote, collects
the whole debt or a part, gets a folio at once, watches the outcome, and
sends the receipt by WhatsApp. The payment is an ordinary payment of the
business, and its action runs through the same path as SPEI.

**Independent Test**: with a seeded active store, a business with the
channel on and WispHub mocked, sign in as the shopkeeper. Then check:
- the search shows nothing until three characters;
- a result shows name, usuario and zone only;
- a whole collection gives `exact`, `confirmed`, a folio, one fee and one
  `collection` movement, and reconnects;
- a second search shows *Sin adeudo*;
- the receipt opens WhatsApp.

### Tests for User Story 1

- [X] T024 [P] [US1] API tests in `apps/api/test/cash-at-stores-counter.test.ts`, citing `cash-at-stores US1`, against `contracts/store-api.md`.
  **Search** (`GET /store/customers`):
  - a two-character query → `QUERY_TOO_SHORT`;
  - at most 10 rows, and `more`;
  - the fields: name, usuario, zone, nothing else;
  - the integration down → `integration: "unavailable"` with empty rows;
  - no business with the channel on → `CHANNEL_OFF`.

  **Quote** (`GET /store/customers/debt`):
  - `owes`, `none` and `unavailable`;
  - the fee equals the current `store_fee_cents`.

  **Record** (`POST /store/collections`):
  - a whole debt → `exact` and `confirmed`, `service_fee_cents` 0, `store_fee_cents` = the fee, and `proof_mode` `none`;
  - it ensures a panel link, and creates none when one already exists;
  - one `validation_fee` entry and one `collection` movement;
  - a short amount under the threshold → `short` and `partial`, registered with no reconnection;
  - after a 503 on the first attempt, the sweep retries with no reconnection (T002);
  - a changed debt, or a changed fee → `AMOUNT_CHANGED`, and nothing written;
  - `NOTHING_DUE`, `AMOUNT_ABOVE_DEBT`, and an unproven zero → `INTEGRATION_UNAVAILABLE`;
  - the same `collectionKey` twice → one row and a 200;
  - a credit below the negative cap → recorded, debited, and the crossing email sent (FR-029);
  - observation mode → `observation`;
  - an integration whose `exact` class maps to `register_only` → `done` with no reconnection, shown as `registered` (H2).

  **Status and receipt**:
  - `GET /store/collections/:id` maps all six outcomes of `contracts/store-api.md` (`registered` included), and another store's id → 404;
  - the receipt's `text` is the current `store_receipt_template` filled in for the payment. The default says *"Comprobante de pago"*, never *"cobro"*, and formats money and time in es-MX and the business's timezone. After the operator saves a new template, the next receipt uses it;
  - the receipt's `waLink` carries the phone `customersWithPhone.phoneOf` returns, read at that request. After the collection and after the receipt, `payments.customer_phone` is null, and no other table holds the phone;
  - with no phone, with the capability absent, with the provider failing, or with a phone on file that is not ten readable digits (letters, eight digits), the answer is `hasPhone: false` and `wa.me/?text=…` (L3). Another store's payment → 404.
- [X] T025 [P] [US1] Component tests in `apps/red/test/counter.test.tsx`, citing `cash-at-stores US1`, with MSW fixtures parsed by `@devolada/api/store-schema` and axe on each screen. Cover:
  - an empty search, and the three-character hint;
  - results without a phone;
  - an outage message, never "sin resultados";
  - `CHANNEL_OFF`: *Cobrar* shows *"Por ahora no hay negocios para cobrar en esta tienda."* with no search box, and *Caja* still opens (L2);
  - the quote's breakdown and *Sin adeudo*;
  - an amount above the debt, refused;
  - `AMOUNT_CHANGED` shows the new amounts and asks again;
  - every outcome as icon + text;
  - the receipt with no phone asks for a number and builds `wa.me/52…` itself. MSW asserts the number never reaches the API.

### Implementation for User Story 1

- [X] T026 [US1] The counter's contracts in `apps/api/src/routes/store/schema.ts`: the search, quote, record, status and receipt shapes and codes of `contracts/store-api.md`. Export `./store-schema` in `apps/api/package.json`.
- [X] T027 [US1] The counter's handlers in `apps/api/src/routes/store/handler.ts`:
  - **search**, through `customerSearch` (D8, D24);
  - **quote**, through `customerDebt`, read live, plus `store_fee_cents` (D14, D22);
  - **record**, in this order:
    1. a fresh debt, and the fee checked against the expected ones (D14);
    2. `ensureLink` (D11);
    3. insert with `collection_key`, returning the existing row on a unique violation (D15);
    4. `settleConfirmed` with `serviceFeeCents: 0` (D13);
    5. `recordCollection` (D19);
    6. the first attempt in `waitUntil` (D25);
  - **status**;
  - **receipt**, asked for only when WhatsApp is tapped:
    - the text is `renderReceipt(store_receipt_template, …)` (D31);
    - the phone is read live through `customersWithPhone.phoneOf`. The link is built with the existing `toWhatsAppPhone` and `whatsAppLink` from `apps/api/src/receipt/index.ts`, and the phone is **never written** (D18, constitution V v1.9.0);
    - with no phone, `hasPhone: false` and `wa.me/?text=…`.

  The record never writes `customer_phone`.

  Import nothing from `wisphub/`.
- [X] T028 [US1] Wire it up:
  - `apps/api/src/routes/store/index.ts` is a pure router: `requireStore` on the counter routes, and `zValidator`;
  - mount `/store` in `apps/api/src/index.ts`.
- [X] T029 [US1] The red shell:
  - `apps/red/src/router.tsx`, with the routes of D26;
  - `apps/red/src/layout/TabLayout.tsx`, with three tabs (*Cobrar*, *Caja*, *Movimientos*), 64px, `aria-current`, and the "Sin conexión. Revisa tu internet." banner;
  - `apps/red/src/features/auth/session.ts`: `useSession` on `/auth/me`. A non-store actor gets the *"Esta cuenta no es de una tienda"* screen with *Cerrar sesión*, and `STORE_SUSPENDED` gets the suspended screen.
- [X] T030 [P] [US1] `apps/red/src/features/counter/SearchScreen.tsx`:
  - the business's name in view (FR-015);
  - a search box, autofocused, that searches from three characters after a short pause;
  - results as name, usuario and zone;
  - the outage message;
  - on `CHANNEL_OFF`, *"Por ahora no hay negocios para cobrar en esta tienda."* in place of the search box. *Caja* and *Movimientos* still work (L2);
  - waiting labels inside `<Pending>`.
- [X] T031 [P] [US1] `apps/red/src/features/counter/QuoteScreen.tsx`:
  - `AmountBreakdown` (*Adeudo*, *Cargo por servicio*, *Total a cobrar*);
  - an amount field that is the whole debt by default and editable down;
  - `collectionKey` generated once per screen;
  - *Cobrar $X* at `size="decisive"`;
  - `AMOUNT_CHANGED` re-asks;
  - the short-payment notice, so the shopkeeper can say whether the service will come back.
- [X] T032 [P] [US1] `apps/red/src/features/counter/ResultScreen.tsx`:
  - the folio in mono, and the amount;
  - the outcome polled every 3 s while `queued`, each outcome as icon + text through `StatusBadge`;
  - what remains owed after a short payment;
  - *Enviar comprobante* asks the API for the receipt only at that tap, then opens `waLink`. With `hasPhone: false`, it asks for ten digits and builds the link in the app; that number is never sent (D18, FR-027);
  - *Usar otro número* (the spec's edge case for a wrong phone on file) asks for ten digits and builds the link the same way;
  - *Copiar comprobante* and *Nuevo cobro*.
- [X] T033 [US1] Browser layer:
  - `tests/e2e/stubs.ts` gains `stubRedApi`, with fixtures parsed by the store schemas;
  - `tests/e2e/contrast.spec.ts` gains the search, quote and result screens, in both themes;
  - `tests/e2e/responsive.spec.ts` gains the same at 360, 768 and 1280: no horizontal scroll, touch targets of 48px, and 64px for *Cobrar*;
  - `tests/e2e/keyboard.spec.ts` walks the counter's tab order (search, result, quote, amount, *Cobrar*) with a measured focus indicator;
  - `tests/e2e/motion.spec.ts` gains red: the result screen's wait breathes, and reduced motion keeps only the opacity breath (constitution IV, VI; /speckit-analyze M3).

**Checkpoint**: a seeded shopkeeper can collect, and the business's
system acts on it. US1 is proven at every layer.

---

## Phase 4: User Story 2 - The operator sets up a store and connects a business (Priority: P1)

**Goal**: in `/operador`, the operator does four things:
- creates, edits, suspends and reactivates stores, and sends invitations
  by WhatsApp;
- switches the channel on for one capable business;
- sets the network fee;
- records corrections in a store's cash book.

**Independent Test**: as an operator, check that:
- creating a store lists it as *Invitada*, with an invitation shown once;
- a second business cannot be switched on, and neither can one without
  the capabilities;
- a fee change keeps its author;
- a correction moves the balance on both sides;
- a non-operator is refused everywhere.

### Tests for User Story 2

- [X] T034 [P] [US2] API tests in `apps/api/test/cash-at-stores-operator.test.ts`, citing `cash-at-stores US2`, against `contracts/platform-stores-api.md`. Cover:
  - **stores**: list, create, `PHONE_TAKEN`, edit;
  - **phone changes**: on an accepted store, `user.username` changes too;
  - **invitations**: the DB holds only `token_hash`, never the token; a resend replaces the open invitation and the old token answers `INVALID_INVITATION`; `ALREADY_ACCEPTED`;
  - **suspension**: it deletes the shopkeeper's sessions and the next store request is refused. Reactivating a store suspended before accepting returns it to `invited`, and its open invitation works again within its seven days (/speckit-analyze M6);
  - **the switch**: `storeChannel` refuses `NOT_CAPABLE` and `ONE_BUSINESS_AT_A_TIME`; `store_channel_since` is set once and survives switching off;
  - **the fee**: `store_fee_cents` keeps its history;
  - **corrections**: one writes a movement, and the payment's detail shows it; a payment of another store gives 404;
  - **access**: a non-operator gets `NOT_PLATFORM_OPERATOR`.
- [X] T035 [P] [US2] Component tests in `apps/admin/test/operator-stores.test.tsx`, citing `cash-at-stores US2`, with MSW and axe. Cover:
  - the Tiendas list, with status as icon + text;
  - the create dialog and its validation;
  - the invitation shown once, with *Copiar* and *WhatsApp*;
  - suspend and reactivate;
  - the Negocios switch with the refusal's reason;
  - the Reglas labels *Cargo por servicio en tiendas* and *Mensaje del comprobante (WhatsApp)*;
  - the template field: a text area, the placeholders listed, a preview with sample data, and the panel naming a missing `{folio}` or an unknown placeholder before it saves;
  - the correction form, with a reason of 3–280 characters.

### Implementation for User Story 2

- [X] T036 [US2] `apps/api/src/routes/platform/schema.ts`:
  - store, invitation, ledger and correction shapes;
  - `patchBusinessRequest.storeChannel`;
  - `businessRow` gains `storeChannel`, `capabilities` and `storeHeldCents`;
  - `settingItem.type` gains `"template"`;
  - `store_fee_cents` is typed `cents`, and `store_receipt_template` is typed `template`.
- [X] T037 [US2] `apps/api/src/routes/platform/handler.ts`:
  - **stores**: list (with `collectsFor` and held cents from `heldCents`), create, edit with the username change in the same batch, suspend and reactivate with session deletion. The phone is normalised with `nationalPhone` (`apps/api/src/phone.ts`), and a number that does not give ten digits is refused with `VALIDATION_ERROR` (D3, L5);
  - **invitations**: issue and resend. The token is random; `token_hash` is SHA-256; the URL is `${RED_BASE_URL}/invitacion/<token>`, plus a `wa.me/52<phone>` link (D4);
  - **the cash book**: read it, and record a correction through `recordCorrection` (D21);
  - **the switch**: check capabilities with `capabilityNames`, then the one-business guard, then set `since` the first time (D7).

  Wire the routes in `apps/api/src/routes/platform/index.ts`, behind the router's existing guard.
- [X] T038 [US2] `apps/admin/src/features/operator/StoresTab.tsx` (new), added as the fifth tab of `OperatorScreen.tsx`:
  - the list;
  - create and edit dialogs at compact 40px;
  - the invitation panel, shown once;
  - suspend and reactivate, each with a confirm;
  - a per-business cash book with *Registrar corrección*.
- [X] T039 [US2] In `apps/admin/src/features/operator/OperatorScreen.tsx`:
  - `BusinessDetail` gains the *Efectivo en tiendas* switch, with the refusal's reason in es-MX;
  - `KEY_LABELS` gains `store_fee_cents: "Cargo por servicio en tiendas"` and `store_receipt_template: "Mensaje del comprobante (WhatsApp)"`;
  - `SettingField` renders type `template` as a text area at the compact size, with the placeholder list, a live preview with sample data, and the same three checks as the API (D31).
- [X] T040 [US2] Browser layer:
  - the Tiendas tab joins `tests/e2e/contrast.spec.ts` in both themes, and `tests/e2e/responsive.spec.ts` at 1280 and 768;
  - `tests/e2e/keyboard.spec.ts` walks the create dialog and the invitation panel, with a measured focus indicator and focus returning to the trigger on close (/speckit-analyze M3).

**Checkpoint**: the operator can set the pilot up end to end, but the
shopkeeper cannot get in yet.

---

## Phase 5: User Story 3 - The shopkeeper gets in and stays in (Priority: P1)

**Goal**: the shopkeeper's way in:
- the invitation link;
- a password and a recovery email, verified by a code;
- sign-in with phone and password, or a passkey;
- recovery by a code;
- a refusal from the panel, and from the app for the wrong kind of
  account.

**Independent Test**: accept an invitation, verify, sign out, then sign in
by phone. Enable a passkey and sign in with it. Recover with a code.
Then check:
- a used, replaced or expired invitation says it no longer works;
- the panel shows a store account its own screen.

### Tests for User Story 3

- [X] T041 [P] [US3] API tests in `apps/api/test/cash-at-stores-access.test.ts`, citing `cash-at-stores US3`, against `contracts/store-api.md` § Invitation. Cover:
  - **the preview**: `open` with `phoneTail`; `invalid` for unknown, accepted, replaced, expired, and a suspended store;
  - **acceptance**: it creates the user with no username, then writes `username` = phone, sets `stores.user_id`, and the store becomes `active`. The verification code is sent; verifying signs the shopkeeper in;
  - **refusals**: `EMAIL_TAKEN` for an existing user and for an operator's address. A failure after the user is created removes the user, and the invitation stays `sent`;
  - **sign-in**: `POST /auth/sign-in/username` with the phone; unverified gives `EMAIL_NOT_VERIFIED`;
  - **recovery**: the `forget-password` code resets the password.
- [X] T042 [P] [US3] Component tests in `apps/red/test/access.test.tsx`, citing `cash-at-stores US3`, with MSW and axe. Cover:
  - the sign-in screen: the phone normalised to ten digits; *"Teléfono o contraseña incorrectos"*; the passkey button and its fallback copy;
  - the invitation's two steps;
  - recovery;
  - the wrong-account screen and the suspended screen.
- [X] T043 [P] [US3] One passkey case in `tests/passkey/red.spec.ts`, citing `cash-at-stores US3`. Against the real wrangler API, a shopkeeper enrols a passkey on red's origin and signs in with it. `playwright.passkey.config.ts` builds red with `VITE_API_URL`, on a port the API trusts.

### Implementation for User Story 3

- [X] T044 [US3] The invitation endpoints, in `apps/api/src/routes/store/{schema,handler,index}.ts`. Both are session-less and use the Hono rate limiter (`auth/rate-limit.ts`):
  - `GET /store/invitations/:token`, 30/min;
  - `POST /store/invitations/:token/accept`, 5/min, following D5's order and its rollback. The `username` written is the store's phone as `nationalPhone` gives it (L5).
- [X] T045 [US3] `apps/red/src/features/auth/`:
  - **`LoginScreen.tsx`**: *Entrar*, with `baPost("/auth/sign-in/username")` and *Entrar con huella o rostro* through `authClient.signIn.passkey()`;
  - **`InvitationScreen.tsx`**: email and password, then the code through `baPost("/auth/email-otp/verify-email")`;
  - **`RecoverScreen.tsx`**: the `forget-password` code, then the new password;
  - **`PasskeyCard.tsx`**: enrolment, shown in *Caja*.

  The copy comes from the old app, re-checked against es-MX rules: *código*, never "token" or "OTP", and no links in emails.
- [X] T046 [US3] `apps/admin/src/features/auth/`: when `/auth/me` answers `type: "store"`, the panel shows *"Esta cuenta es de una tienda. Entra en red.devoladapago.com."* with *Cerrar sesión*, instead of the business wizard. Add a test case to `apps/admin/test/access.test.tsx`, citing `cash-at-stores US3`.

**Checkpoint**: with US2 and US3 done, real people can run US1. This is
the pilot's first deployable cut.

---

## Phase 6: User Story 4 - The business sees cash payments with its SPEI payments (Priority: P2)

**Goal**: Pagos lists cash and SPEI together, with a channel filter and
*"Efectivo · <tienda>"*. The detail shows the store, the fee and any
correction. Retry and run-now work on cash rows.

**Independent Test**: seed a whole and a short cash payment next to SPEI
ones. Open Pagos and check:
- both kinds are listed together, the filter works, and the detail is
  complete;
- the credit shows one fee per cash payment.

### Tests for User Story 4

- [X] T047 [P] [US4] API tests in `apps/api/test/cash-at-stores-business.test.ts`, citing `cash-at-stores US4`, against `contracts/business-cash-api.md` § Pagos. Cover:
  - the feed lists both channels in time order;
  - `channel=store` and `channel=spei` filter;
  - `storeName`, `storeFeeCents` and `corrections`;
  - a cash row's money fields (`serviceFeeCents` 0, `askedCents` = the debt);
  - one fee per cash row;
  - retry and execute on a cash row go through `paymentActions`;
  - `GET /payments/:id/proof` on a cash row → 404.
- [X] T048 [P] [US4] Component tests in `apps/admin/test/feed-cash.test.tsx`, citing `cash-at-stores US4`, with MSW and axe. Cover:
  - the channel line *"Efectivo · <tienda>"* with an icon;
  - the *Todos / SPEI / Efectivo* chip;
  - the expanded row's store, fee and corrections.

### Implementation for User Story 4

- [X] T049 [US4] Pagos on the API:
  - **`apps/api/src/routes/payments/schema.ts`**: `feedQuery.channel`; `feedCharge.channel` as the enum `["spei","store"]`; `storeFeeCents`; `corrections`; `proofMode` gains `none`;
  - **`apps/api/src/routes/payments/handler.ts`**: the channel filter, a left join on `stores` for `storeName`, corrections from `store_ledger`, and the proof door answers 404 for `proof_mode = 'none'`.
- [X] T050 [US4] In `apps/admin/src/features/feed/FeedScreen.tsx`:
  - the channel line;
  - the chip, its parameter in `feedPath`, and the expanded row's store, fee and corrections;
  - the MSW fixtures in `apps/admin/test/msw.ts`, parsed by the changed schema.
- [X] T051 [US4] Browser layer: a cash row joins the Pagos screen in `tests/e2e/contrast.spec.ts`, and the stub fixtures are parsed by the changed schema.

**Checkpoint**: the business sees every peso collected in its name, in
the list it already reads.

---

## Phase 7: User Story 5 - Handing over the cash (Priority: P2)

**Goal**: the cash book in both directions.
- The store sees *Mi caja*, declares a hand-over and reads its movements.
- The business sees *Puntos de pago*, and confirms or disputes each
  hand-over.

**Independent Test**: after cash payments, declare a hand-over. Confirm
it, and both screens show the same new balance. Declare another and
dispute it: the balance stays, and both sides show the note. Two
businesses holding cash at one store never see each other's.

### Tests for User Story 5

- [X] T052 [P] [US5] API tests in `apps/api/test/cash-at-stores-handover.test.ts`, citing `cash-at-stores US5`, against `contracts/store-api.md` § cash book and `contracts/business-cash-api.md` § Puntos de pago.
  **The store's side**:
  - `/store/cashbox`'s held amount and fees since the last hand-over;
  - `/store/ledger`'s pages;
  - declaring, `HANDOVER_PENDING` and `AMOUNT_EXCEEDS_HELD`.

  **The business's side**:
  - confirming writes one movement, and the store's and the business's sums agree to the cent (SC-005);
  - disputing needs a note, is terminal, writes nothing, and the store sees the note;
  - a second confirm gives `HANDOVER_NOT_PENDING`;
  - a viewer gets `FORBIDDEN_FOR_ROLE` on confirm and dispute.

  **Isolation and the menu**:
  - two businesses with cash at one store each see only their own (FR-042);
  - with the channel switched off for a business that still has cash at a store: the cash-book routes answer, no `CHANNEL_OFF`, and a hand-over is declared and confirmed (H1, L4);
  - `/auth/me`'s business branch carries `storeChannel.since`.
- [X] T053 [P] [US5] Component tests in `apps/red/test/cashbox.test.tsx`, citing `cash-at-stores US5`, with MSW and axe. Cover:
  - *Mi caja*: held, fees, last and pending hand-over, the dispute note. Tapping the amount held, or the fees, opens the movements behind it (FR-037);
  - *Registrar entrega*: the default amount and its errors;
  - *Movimientos*: grouped by day, *Cargar más*.
- [X] T054 [P] [US5] Component tests in `apps/admin/test/cash-points.test.tsx`, citing `cash-at-stores US5`, with MSW and axe. Cover:
  - the stores list;
  - the two-tap confirm dialog naming the store and the amount;
  - the dispute with a note;
  - a viewer sees no buttons;
  - the menu entry appears when `storeChannel.since` is set.

### Implementation for User Story 5

- [X] T055 [US5] The store's cash book on the API, in `apps/api/src/routes/store/{schema,handler,index}.ts`: `GET /store/cashbox`, `GET /store/ledger`, and `POST /store/handovers`, following D20's rules (one pending at a time, never above what is held). All reads go through `store-ledger/index.ts`.
  These routes serve every business the store has movements with, whether or not its channel is still on. They never answer `CHANNEL_OFF`, and a `businessId` outside that set → 404 (contract § "The business, in the cash book"; /speckit-analyze H1). T052 tests it.
- [X] T056 [US5] Puntos de pago on the API:
  - `apps/api/src/routes/cash-points/{index,handler,schema}.ts`: `GET /cash-points`, `POST /cash-points/handovers/:id/confirm|dispute`, and `GET /cash-points/stores/:storeId/history`;
  - every query filters by the actor's business;
  - confirm and dispute use `requireArea("payments","operate")`;
  - confirming writes through `recordHandover`, in the same batch as the status change;
  - export `./cash-points-schema` in `apps/api/package.json`, and mount `/cash-points` in `apps/api/src/index.ts`.
- [X] T057 [US5] Put `storeChannel: { on, since }` on the business actor: in `apps/api/src/auth/middleware.ts`, from the `businesses` row already loaded, and in `apps/admin/src/features/auth/session.ts` (D7, D23).
- [X] T058 [P] [US5] The red cash-book screens:
  - `apps/red/src/features/cashbox/CashboxScreen.tsx`: held, fees, last and pending hand-over, the dispute note, *Registrar entrega*, the passkey card and *Cerrar sesión*. The amount held and the fees are links to *Movimientos* for that business (FR-037, `cashbox` D2);
  - `HandoverScreen.tsx`: *"La entrega quedará pendiente hasta que el negocio confirme que recibió el efectivo."*;
  - `LedgerScreen.tsx`.
- [X] T059 [US5] The admin's *Puntos de pago* page:
  - `apps/admin/src/features/cash-points/CashPointsScreen.tsx` (new);
  - the route `/puntos-de-pago` in `apps/admin/src/router.tsx`;
  - the menu entry in `apps/admin/src/features/shell/Shell.tsx`, shown when `storeChannel.since` is set;
  - statuses through the existing `StatusBadge` entries `pending`, `confirmed` and `disputed`.
- [X] T060 [US5] Browser layer:
  - *Mi caja*, *Entrega* and *Movimientos* (red), and *Puntos de pago* (admin), join `tests/e2e/contrast.spec.ts` and `tests/e2e/responsive.spec.ts`;
  - `tests/e2e/keyboard.spec.ts` walks the confirm dialog and the dispute form on *Puntos de pago*;
  - `tests/e2e/motion.spec.ts` covers red's cash-book waits (/speckit-analyze M3).

**Checkpoint**: every story is done, and the pilot can run its whole
cycle: collect, see, hand over, confirm.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T061 [P] Grep checks, each recorded in the PR description:
  - `grep -rn "wisphub/" apps/api/src/routes/store apps/api/src/routes/cash-points apps/api/src/store-ledger` prints nothing (constitution IX);
  - no reader tells a cash row from a SPEI row by `proof_mode`; only `channel` does (data-model);
  - `store_ledger` is inserted only in `apps/api/src/store-ledger/index.ts` (D19).
- [X] T062 [P] Update `CLAUDE.md`:
  - the opening names cash at stores;
  - the Commands list gains `pnpm --filter @devolada/red dev # the shopkeeper's app (5177)`;
  - the Architecture block gains `apps/red`;
  - "all four Workers" becomes "all five Workers" (constitution v1.8.0 follow-up TODO(CLAUDE-MD-WORKERS)).
- [X] T063 [P] Re-read every new screen's copy against D27's words. Check three things:
  - the payer reads *pago*, never *cobro*;
  - nothing in code says "cash" where `store` is the word;
  - the receipt says *Cargo por servicio*, never "comisión".
- [X] T064 Run quickstart §2 in the CI order, locally: spec-lint, gen-banks, contrast-lint, pending-lint, typecheck, every test suite, `pnpm e2e` and `pnpm e2e:passkey`. Fix what fails, with no skip and no quarantine.
- [ ] T065 After merge to `main` and the dev deploy, walk quickstart §3 on `red.dev.devoladapago.com` with the demo tenant. Record the walk's date and anything that differed in `specs/018-cash-at-stores/quickstart.md`. Time two things, and record them beside SC-001 and SC-002 (/speckit-analyze L5):
  - from typing the customer's name to the folio on screen (SC-001: under 60 s);
  - from the folio to the customer active in WispHub (SC-002: under 2 minutes).
- [ ] T066 Wire red into production:
  - **`.github/workflows/deploy-prod.yml`**: a build with `vars.PROD_API_URL`, a deploy logged with `tee`, `red` in the "what landed" loop, and a smoke probe on `PROD_RED_URL`;
  - **`.github/workflows/rollback-prod.yml`**: `red` in the options and in the `case` that maps a Worker to its config;
  - **the GitHub environment**: `PROD_RED_URL` set.

  Release only after T065's walk is clean.
- [ ] T067 Outside this repository, before the first real collection (quickstart §4; research D30):
  - turn off `leolicona/devolada-red`'s deploy workflows, whose names collide with this account's Workers;
  - confirm the pilot's three agreements are signed (spec Assumptions).

  These belong to the creator; record the date here when done.
- [X] T068 [P] *(Added 2026-10-01, /speckit-analyze M4.)* In `specs/009-links-on-demand-search/spec.md`, add a dated note under FR-008. It records the clause `cash-at-stores` D11 adds: a link is also born *"when a store records a cash payment for that customer"*, and it cites `cash-at-stores` D11. The rest of FR-008 is not rewritten.
- [X] T069 [P] *(Added 2026-10-01, /speckit-analyze L6.)* Open the lite path for the payer page's copy *"Paga en tu punto de cobro más cercano"*, shown when SPEI is unavailable (`apps/pago/src/features/pago/PaymentPage.tsx`). Run `/speckit-bug-assess` under `.specify/bugs/payer-copy-store-points/`. The spec's FR-041 keeps the payer page silent about stores, so the copy must not promise points the business may not have. It is independent of this feature's code, and lands before the pilot.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**:
  - T001 gates T010–T012 if M1 fails.
  - T002 must be on `main` before T016.
  - T003–T009 can run in any order.
- **Phase 2 (Foundational)** depends on Phase 1 and blocks every story.
  Inside it:
  - T010 comes first;
  - T011 and T012 follow T010;
  - T015 comes before T016, then T017;
  - T019 comes before T020;
  - T013, T014, T018, T021, T022 and T023 follow what they test or need.
- **Phases 3–7** depend on Phase 2.
- **Phase 8**:
  - T061–T064 follow every story;
  - T065 follows the dev deploy;
  - T066 follows T065;
  - T067 is outside the code, and comes before the first real collection;
  - T068 and T069 can run at any time; T069 lands before the pilot.

### User Story Dependencies

- **US1** depends only on Phase 2. Its tests seed the store, the session
  and the channel.
- **US2** depends only on Phase 2. Its correction tests seed a cash
  payment directly.
- **US3** depends on Phase 2. T044 shares `routes/store/` with US1's
  T026–T028, so run them one after the other on that folder.
- **US4** depends on Phase 2, and reads cash rows. Its tests seed them,
  so it does not wait for US1's code.
- **US5** depends on Phase 2 and on US1's `/store` router (T028), which
  it extends.

### Within Each User Story

- Tests are written first and fail first.
- Schema comes before handler, handler before router, router before
  screens, and screens before the browser layer.
- Every API change lands with its contract test.

### Parallel Opportunities

- **Phase 1**: T003, T005, T006, T007 and T008 run together.
- **Phase 2**: T023 runs beside T011 and T012. T013 follows T010 and
  T012. T018 and T021 share a test file and run one after the other, once
  their subjects land. *(The [P] marks were removed from T013, T018 and
  T021 on 2026-10-01, /speckit-analyze L1.)*
- **US1**: T024 and T025 together, then T030, T031 and T032 together,
  after T029.
- **US2 and US3** can be staffed in parallel with US1, except for US3's
  T044, which shares `routes/store/` with US1's T026–T028.
- **US4 and US5**: their admin parts (T050, T059) and red parts (T058)
  run in parallel. T061, T062 and T063 also run together.

---

## Parallel Example: User Story 1

```bash
# The tests first, together:
Task: "T024 API tests in apps/api/test/cash-at-stores-counter.test.ts (cash-at-stores US1)"
Task: "T025 component tests in apps/red/test/counter.test.tsx (cash-at-stores US1)"

# After T026–T029, the three screens together:
Task: "T030 apps/red/src/features/counter/SearchScreen.tsx"
Task: "T031 apps/red/src/features/counter/QuoteScreen.tsx"
Task: "T032 apps/red/src/features/counter/ResultScreen.tsx"
```

---

## Implementation Strategy

### MVP for the pilot (US1 + US2 + US3)

The spec's three P1 stories together are the smallest thing a real
shopkeeper can use:

1. Phase 1, then Phase 2.
2. US1. Stop and prove it with seeded data, at every layer.
3. US2, then US3. Stop and walk quickstart §3 steps 1–8 on dev.

### Incremental delivery, one PR per step

1. **The bug** (T002), alone, on the lite path.
2. **Setup and foundation** (T001, T003–T023). No visible change: the
   SPEI suites prove nothing moved.
3. **The counter** (US1).
4. **The operator** (US2) and **the shopkeeper's way in** (US3). After
   this, the pilot can start on dev.
5. **The business's view** (US4) and **the hand-over** (US5). The first
   real hand-over needs US5. US4 can ship the same day.
6. **Polish and production** (T061–T067).

---

## Notes

- **The receipt's phone is settled** (2026-10-01, constitution v1.9.0,
  research D18 and D31). The phone is read live for each receipt and
  never stored. The message is the operator's template. Nothing about it
  is open.
- **The deferred decision** (FR-006). The one-business guard (T037) is
  the only place it lives. Lifting it is a spec of its own: which stores
  serve which business, and what a store may then search.
- **No step skips a CI stage**, and none quarantines a test (constitution,
  Development Workflow).

---

## Phase 9: Convergence

**Purpose**: the gaps `/speckit-converge` found on 2026-10-01 between
`spec.md`, `plan.md`, this file and the code on `main` (`c23d34c`). Each
one was checked in the code. They are ordered by severity: CRITICAL, then
HIGH, MEDIUM and LOW. Four of them wait on a decision from the creator
before any code (T073, T088, T097, T098), and each of those says so.

- [X] T070 [US1] **CRITICAL** Remove the new provider leak from the counter's record per Constitution IX (contradicts):
  - `apps/api/src/routes/store/handler.ts:259` passes `wisphubId: Number(debt.customer.providerCustomerId)` to `ensureLink`. A core handler now assumes the provider's customer id is a number, which holds only for WispHub; another adapter's id would be stored as `"NaN"`.
  - Give `ensureLink` (`apps/api/src/direct-payments/links.ts:124`) a string `providerCustomerId` in the core's words, so the store route passes the capability's id untouched. Its one other caller is `apps/api/src/routes/direct-payments/handler.ts:2268`.
  - If anything of it stays, correct the 2026-10-01 note in `.specify/debt/core-reads-provider-directly/debt.md` ("Cash at stores adds no new leak").
- [X] T071 [US1] Make the `queued` outcome say whether the service will come back, per FR-025, FR-026, US1/AC7 and the spec's edge case on a short payment below the threshold (contradicts):
  - every cash row is written `queued` before its first attempt (`settleConfirmed`'s deferred branch). `outcomeOfRow` (`apps/api/src/routes/store/handler.ts:348-364`) maps it to `queued` without reading `decidedAction`;
  - the receipt's sentence for that state is fixed: *"Tu servicio se reactivará en unos minutos."* (`outcomeSentence` in the same file). The app says the same (`apps/red/src/features/counter/ResultScreen.tsx:31`);
  - so a short payment below the threshold, or a business whose class maps to `register_only`, is promised a reconnection on screen, and in the WhatsApp receipt when it is sent early;
  - carry the decided action in the status answer (`contracts/store-api.md` § status). Word the queued line, the badge and the receipt sentence by it: reconnect, register only, or not reconnected because short. Add the cases to `apps/api/test/cash-at-stores-counter.test.ts` and `apps/red/test/counter.test.tsx`.
- [X] T072 [US1] Make every recorded cash payment end settled and in the cash book, per SC-003, SC-005, FR-039, US1/AC13 and D15, D19, D25 (partial):
  - the record is three separate writes (`apps/api/src/routes/store/handler.ts:265-328`): the insert, born `validating` by the column default; `settleConfirmed`; then `recordCollection`;
  - the replay (`:232-236`) and the race (`:290-295`) answer 200 with the folio straight from the row, and never finish it;
  - so if the first request dies after the insert, the payment stays `validating` for good: no fee, no `collection` movement and no action, while the app polls `queued` forever. No sweep finds it, because `nextValidationAt` and `nextAttemptAt` are null. *Mi caja* and *Puntos de pago* then both show too little cash held, and they agree, so nothing reveals it;
  - on the replay and the race, finish an unfinished row (`settleConfirmed`, then `recordCollection`; the fee debit and the movement are both idempotent), or make the writes one batch. Let the every-minute sweep repair any `store` row left without its `collection` movement. Test a record that fails after the insert, then its retry.
- [ ] T073 [US1] **Decision first.** Decide with the creator, then build, how a collection treats a customer whose earlier cash payment the business's system does not show yet, per SC-004 and the spec's edge case on cash and SPEI the same day (partial):
  - the quote and the record read only the integration's live debt (`apps/api/src/routes/store/handler.ts:179`, `:242-252`);
  - that debt does not include a confirmed cash payment whose action is `queued`, held by observation mode, or `failed`. A second collection for the same customer therefore reads the whole debt again and can take it twice. With observation mode on, this is true of every later collection until the business registers the first payment by hand;
  - the options to put to the creator, each with its cost:
    - subtract those payments from the fresh debt. Cost: Devolada never learns of a payment the business registers by hand, so a permanent subtraction under-charges later debts;
    - refuse the collection with a code of its own;
    - warn the shopkeeper and let them choose;
  - then build the choice at the quote and the record, with API and component tests.
- [ ] T074 [US3] Keep a signed-in shopkeeper in the app through a lost signal, per FR-010, US3/AC3 and D26's offline banner (contradicts):
  - `apps/red/src/layout/TabLayout.tsx:52-54` sends the shopkeeper to `/entrar` on any session error, `NETWORK_ERROR` and 5xx included. The session goes stale after 60 s (`apps/red/src/features/auth/session.ts`), so a short loss of signal at that moment signs them out of view;
  - on `/entrar`, a network failure reads *"Teléfono o contraseña incorrectos."* (`apps/red/src/features/auth/LoginScreen.tsx:111`);
  - go to `/entrar` only on 401 `AUTHENTICATION_ERROR`. On a network or server error, keep the layout and its banner. Give the sign-in screen its own line for a lost signal. Add the cases to `apps/red/test/access.test.tsx`.
- [ ] T075 [US2] Page the operator's cash book and *Puntos de pago*'s hand-over history, per FR-030, US2/AC11 and D21 (partial):
  - `apps/admin/src/features/operator/StoresTab.tsx:320-324` reads one page of `/platform/stores/:id/ledger/:businessId` (20 rows) and never follows `nextCursor`;
  - the correction's payment picker is built from that one page, so a payment older than the latest 20 movements can be neither seen nor corrected;
  - *Puntos de pago*'s history (`apps/admin/src/features/cash-points/CashPointsScreen.tsx:135-138`) ignores its `nextCursor` too;
  - add *Cargar más* to both, and let the picker reach any payment of that store and business. Extend `apps/admin/test/operator-stores.test.tsx` and `apps/admin/test/cash-points.test.tsx`.
- [ ] T076 [US5] Show the day, not only the hour, on *Puntos de pago*, and when a hand-over was resolved, per US5/AC5 and FR-034 (partial):
  - `apps/admin/src/features/cash-points/CashPointsScreen.tsx:151, 184, 193` render `formatTime`, which is hour and minute only (`apps/admin/src/lib/datetime.ts:19-28`), for hand-overs that may be days old;
  - `resolvedAt` is in the schema (`apps/api/src/routes/cash-points/schema.ts:31`), and is never shown beside `resolvedBy`;
  - use `formatDateTime`, show `resolvedAt`, and assert both in `apps/admin/test/cash-points.test.tsx`.
- [ ] T077 [US2] Show the suspended screen on the shopkeeper's next action, per US2/AC5 and FR-014 (partial):
  - suspending deletes the shopkeeper's session rows (`apps/api/src/routes/platform/handler.ts:356`). The next request therefore answers 401 `AUTHENTICATION_ERROR` (`apps/api/src/auth/middleware.ts:115-117`), never `STORE_SUSPENDED`;
  - so the app shows the sign-in, and shows the suspended screen only after the password is typed again. `apps/api/test/cash-at-stores-operator.test.ts:225` accepts that 401;
  - make the next action answer `STORE_SUSPENDED`. For example: leave the session rows to `requireStore`, which already deletes them as it refuses, and refuse a suspended store's sign-in with the same code;
  - align `contracts/platform-stores-api.md` ("Suspending deletes the shopkeeper's session rows") and the test.
- [ ] T078 [US3] Keep the business signup from replacing a shopkeeper's unverified account, per D2, D5 and FR-009 (missing):
  - `POST /auth/business/signup` treats any unverified user with that email as a half-typed address, and removes it (`apps/api/src/routes/auth.ts:53-56`);
  - take a shopkeeper who accepted the invitation and has not typed the code yet. `removeUser` deletes their sessions and their password row, then fails on `stores.user_id`'s foreign key. The answer is a 500, and the password is already gone;
  - answer `EMAIL_TAKEN` when the unverified user is a store's user, and run `removeUser`'s three deletes as one batch. Add the case to `apps/api/test/cash-at-stores-access.test.ts`.
- [ ] T079 [US5] Make *Mi caja*'s fees open the collections they count, per FR-037 and US5/AC1 (partial):
  - the figure counts the fees since the last confirmed hand-over (`apps/api/src/store-ledger/index.ts:127-148`), but its link opens every collection ever (`apps/red/src/features/cashbox/CashboxScreen.tsx:38-40`);
  - `storeLedgerQuery` has no lower bound (`apps/api/src/routes/store/schema.ts:177-181`). `/store/cashbox` gives no time for the last *confirmed* hand-over, because its `lastHandover` can be a dispute;
  - the last hand-over's amount is not a link;
  - add a `since` bound to `GET /store/ledger` (and to `contracts/store-api.md`), return the last confirmed hand-over's time, and use both from *Mi caja*. Extend `apps/api/test/cash-at-stores-handover.test.ts` and `apps/red/test/cashbox.test.tsx`.
- [ ] T080 [US5] Give the store its hand-over history, so a dispute and its note stay readable on both sides, per US5/AC6 and US5's "both sides see the same history" (partial):
  - the store sees a resolved hand-over only as `lastHandover`, which is one row (`apps/api/src/routes/store/handler.ts:596-606`);
  - a dispute writes no movement (D20), so it never reaches *Movimientos*. Once the next hand-over is resolved, the store loses the dispute and its note, while the business keeps the full list at `GET /cash-points/stores/:storeId/history`;
  - add a store-side history route (record it in `contracts/store-api.md`) and open it from *Mi caja*, with API and component tests.
- [ ] T081 [US1] Never show a cached debt with *Cobrar* live, per FR-018 and the spec's edge case "never shows an amount it did not just read" (partial):
  - `apps/red/src/features/counter/QuoteScreen.tsx:148, 156` wait only on `isPending`. A quote still in the cache therefore renders, with *Cobrar* enabled, while the fresh read runs;
  - nothing clears `store-quote` after a record. *Nuevo cobro* on the same customer shows the debt from before the payment, and the amount field is set once from it (`:64`);
  - the server's `AMOUNT_CHANGED` stops a wrong record, but the shopkeeper has already read a wrong amount to the payer;
  - drop the quote from the cache after a record, and hold the screen until the fresh read lands. Test it in `apps/red/test/counter.test.tsx`.
- [X] T082 [US1] Keep the folio and the outcome on screen when one status poll fails, per US1/AC10 (partial):
  - `apps/red/src/features/counter/ResultScreen.tsx:175` swaps the folio card for *"No pudimos cargar este pago"* whenever `isError` is set;
  - TanStack Query sets it on a single failed poll while it still holds the data;
  - show the data when there is some, and the poll's failure inline. Test it in `apps/red/test/counter.test.tsx`.
- [ ] T083 [US3] Bring red's sign-in, recovery, invitation, suspended and wrong-account screens, and the narrowed *Movimientos*, into the browser layer, per FR-012, Constitution VI (48px touch targets) and D28 (partial):
  - `tests/e2e/responsive.spec.ts:266-281` measures none of them;
  - four links are under 48px and nothing measures them: *Olvidé mi contraseña* (`apps/red/src/features/auth/LoginScreen.tsx:154`), *Volver a entrar* (`apps/red/src/features/auth/RecoverScreen.tsx:88`), *Reenviar código* (`apps/red/src/features/auth/InvitationScreen.tsx:88`) and *Ver todos* (`apps/red/src/features/cashbox/LedgerScreen.tsx:67`);
  - add the screens to `tests/e2e/responsive.spec.ts` and `tests/e2e/contrast.spec.ts`, and bring the links to 48px.
- [ ] T084 [US1] Cross-fade the outcome when it changes, per Constitution VI ("the outcome cross-fades") (missing): `apps/red/src/features/counter/ResultScreen.tsx:217-222` swaps the badge from `queued` to its final state with no `Reveal` (`packages/ui/src/components/reveal.tsx`). Wrap it, and add the change to red's case in `tests/e2e/motion.spec.ts`.
- [ ] T085 [US2] Show the day and the author on the operator's records, per FR-030 (who corrected what, and when) and FR-008, FR-043 (changes keep their author and date) (partial):
  - the operator's cash book shows movements and corrections with the hour only (`apps/admin/src/features/operator/StoresTab.tsx:368`);
  - Reglas' *Último cambio* shows the hour only and no author (`apps/admin/src/features/operator/OperatorScreen.tsx:150`). The setting's history carries only `authorUserId`;
  - render `formatDateTime` on both, and the author's email on the setting.
- [ ] T086 [US2] Show why a resend, a suspension or a reactivation failed, per FR-004 and FR-005 (partial):
  - `Resend` and `StatusAction` (`apps/admin/src/features/operator/StoresTab.tsx:257-313`) never render their mutation's error;
  - so, for example, `ALREADY_ACCEPTED` on a stale list does nothing visible;
  - add es-MX copy at each control, and a test in `apps/admin/test/operator-stores.test.tsx`.
- [ ] T087 Use the shared atoms where the new screens rebuild them, per Constitution VI ("a duplicate recipe in an app is drift") (contradicts):
  - *Enviar por WhatsApp* (`apps/admin/src/features/operator/StoresTab.tsx:164`) and *Registrar entrega* (`apps/red/src/features/cashbox/CashboxScreen.tsx:76-86`) rebuild the button's classes instead of using `buttonVariants` from `@devolada/ui`. The second loses its hover and active states;
  - the correction form uses two native `<select>` elements (`StoresTab.tsx:384-407`), where the same panel uses the themed `Select` (`apps/admin/src/features/operator/OperatorScreen.tsx:364-372`).
- [ ] T088 **Decision first.** Finish the lite path for the payer page's *"Paga en tu punto de cobro más cercano"*, per FR-041 and T069 ("lands before the pilot") (partial):
  - `.specify/bugs/payer-copy-store-points/` holds only `assessment.md`;
  - `apps/pago/src/features/pago/PaymentPage.tsx:2119-2121` still shows the store icon and the copy;
  - the creator picks the replacement sentence, which is the assessment's open question. Then run `/speckit-bug-fix` and `/speckit-bug-test`, with a case citing `bug: payer-copy-store-points`.
- [ ] T089 [US3] Make acceptance's rollback match D5 (partial):
  - the acceptance batch (`apps/api/src/routes/store/handler.ts:536-548`) marks the invitation `accepted` even when the store write matched no row. D5 says the invitation stays `sent`;
  - in a double-accept race, the second batch hits `user.username`'s unique index and answers 500 (`:553-555`), never `INVALID_INVITATION`;
  - make the username and invitation writes depend on the store write, and map the unique violation to `INVALID_INVITATION`;
  - write a test that reaches the batch. `apps/api/test/cash-at-stores-access.test.ts:261-273` stops before it.
- [ ] T090 [US2] Make the one-business guard atomic, per FR-006 and D7 (partial):
  - `apps/api/src/routes/platform/handler.ts:178-189` reads, then writes, so two switch-ons at the same moment can both pass;
  - no index backs the guard, because the data model chose none;
  - write the switch as one conditional `UPDATE … WHERE NOT EXISTS` (no other business has the channel on), and answer `ONE_BUSINESS_AT_A_TIME` when no row changes.
- [ ] T091 [US2] Complete the correction's refusal tests, per FR-030 and US2/AC11 (partial):
  - the test named for "another store, or another business" (`apps/api/test/cash-at-stores-operator.test.ts:332-346`) exercises only another store;
  - no test sends `cents: 0`, or a reason over 280 characters;
  - add the three cases.
- [ ] T092 [US2] Test editing a store, per FR-003, US2/AC3 and T035 (missing): no test at any layer opens the edit dialog, or meets `PHONE_TAKEN` on an edit. Add both to `apps/admin/test/operator-stores.test.tsx`.
- [ ] T093 [US1] Prove the counter's retry and live behaviour in `apps/red/test/counter.test.tsx`, per FR-023, US1/AC13 and T025 (partial). Today only the key's format is checked (`:174`). Add:
  - a retry after `NETWORK_ERROR` sends the same `collectionKey`;
  - the poll every 3 s while `queued`;
  - the offline banner;
  - the tabs' `aria-current`;
  - *Copiar comprobante* and *Nuevo cobro*.
- [X] T094 [US1] Label the copy button *Copiar comprobante*, per T032 (partial): `apps/red/src/features/counter/ResultScreen.tsx:139` reads *Copiar*.
- [ ] T095 [US1] Give the real reason when a quote is refused, per FR-028 (partial):
  - every quote error reads *"Revisa tu conexión"* (`apps/red/src/features/counter/QuoteScreen.tsx:157-162`), including `CHANNEL_OFF`, `NOT_CAPABLE` and `STORE_*`;
  - map each code to its own es-MX line.
- [ ] T096 Remove red's `/suspendida` route, or record it in D26's routes table, per research D26 (unrequested):
  - `apps/red/src/router.tsx:22` declares it, and nothing links or navigates to it;
  - the suspended screen is shown in place by `apps/red/src/features/auth/Gate.tsx`.
- [ ] T097 [US2] **Decision first.** Make the store's invited status read the same everywhere, per FR-001 and US2/AC1–AC2 (*Invitada*) (contradicts):
  - the list's badge reads *Invitación enviada*. That is the shared `invited` status (`packages/ui/src/components/status-badge.tsx:150`), older than this feature;
  - the create and reactivate dialogs say *Invitada* (`apps/admin/src/features/operator/StoresTab.tsx:206, 281`);
  - the creator picks one of three: a store status of its own reading *Invitada*, dialogs that say *Invitación enviada*, or a dated note against FR-001.
- [ ] T098 [US4] **Decision first.** Settle when Pagos offers the channel filter, per FR-031 and D23 (contradicts):
  - `apps/admin/src/features/feed/FeedScreen.tsx:794-797` shows the *Todos / SPEI / Efectivo* chip only when `storeChannel.since` is set, and cites D23 for it. D23 does not state that condition, and FR-031 has none;
  - `apps/admin/test/feed-cash.test.tsx:118` locks the behaviour in;
  - record the condition in D23, or show the chip always.
- [ ] T099 [US1] Keep store-born links out of the payer-reference backfill, or amend D11, per research D11 ("no payer reference until the payer's own flow asks for one") (contradicts):
  - `backfillPayerReferences` (`apps/api/src/direct-payments/payer-reference.ts:680-703`) takes every panel link with no holder;
  - so a link `ensureLink` creates at the counter gets a reference within a minute wherever `payByReference` is on.
- [ ] T100 [US4] Drop `proofMode` from the feed row in `contracts/business-cash-api.md`, per that contract's "Row changes in `feedCharge`" (contradicts):
  - `feedCharge` (`apps/api/src/routes/payments/schema.ts:52-142`) has no such field;
  - rows are told apart by `channel`, and `none` lives only in the database enum, as `data-model.md` asks.
- [X] T101 [US1] Record `businessName` in the status answer of `contracts/store-api.md` § `GET /store/collections/:id`, per that contract (unrequested): `collectionStatusResponse` returns it (`apps/api/src/routes/store/schema.ts:121`), and the contract does not list it.
- [ ] T102 Filter `ledgerRowsOf`'s payment read by business, per Constitution V (partial):
  - `apps/api/src/store-ledger/index.ts:213-218` reads `payments` by id alone;
  - the ids come from movements already scoped to the store and the business, so nothing leaks today;
  - add `inArray(payments.businessId, businessIds)`, so the query carries the rule itself.
- [ ] T103 Cite stories, not only tasks, in the browser layer's new blocks, per Constitution VII (partial):
  - `tests/e2e/contrast.spec.ts:153` cites *cash-at-stores T033, T040, T051, T060*, and `tests/e2e/motion.spec.ts:756` cites *T033, T060*;
  - add `cash-at-stores US1`, `US2`, `US4` and `US5` beside them.
- [ ] T104 Close TODO(CLAUDE-MD-WORKERS) in the constitution's Sync Impact Report, through `/speckit-constitution` as a patch note, per the constitution's Governance (partial):
  - T062 did the work: CLAUDE.md now says five Workers, names red's dev command and lists `apps/red`;
  - v1.9.1's report still carries the TODO "unchanged from v1.9.0".
