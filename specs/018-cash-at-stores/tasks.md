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
