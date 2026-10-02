---

description: "Task list for payment-method-per-channel"
---

# Tasks: payment-method-per-channel

**Input**: Design documents from `specs/019-payment-method-per-channel/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md) (D1–D16), [data-model.md](./data-model.md),
[contracts/action-attempt.md](./contracts/action-attempt.md),
[contracts/wisphub-recording.md](./contracts/wisphub-recording.md),
[contracts/integrations-payment-methods.md](./contracts/integrations-payment-methods.md),
[quickstart.md](./quickstart.md). Constitution v1.9.1.

**Tests are required, not optional.**
- Constitution IV fixes the layer: the API suite in workerd with a real D1
  and WispHub intercepted at its origin; the admin in happy-dom with MSW
  (`onUnhandledRequest: "error"`) and axe; the browser layer only for what
  needs layout.
- Constitution VII: every new test file cites
  `payment-method-per-channel US<n>`. A task's `[US<n>]` label is what the
  test it lands with inherits.
- Every assertion about a recording is made on the `registrar-pago` body
  that reached WispHub (`forma_pago`, `referencia`), never on the object the
  core built (contracts/action-attempt.md, "Rules").

**Organization**: by user story, in the spec's priority order:
**US1 (P1), US4 (P2), US2 (P2), US3 (P3)**.
- US4 comes before US2: it is what every business meets first (the
  connection, then the methods, then execution), and it carries the gate
  that makes US1 true from a business's first payment (FR-013).
- US2 needs no code of its own once the foundation and US1 are in: the
  chooser picks by channel. Its phase proves it on the store's paths.

**Second `/speckit-analyze` (2026-10-02)**: a new key or installation
moves the stamp (→ T017, T022); without a key the methods card says
"connect first" (→ T025, T026).

**Revised after `/speckit-analyze` (2026-10-02)**: execution needs a saved
key (H1 → T017, T022, T025, T026); FR-005's other recording paths are
tested (M1 → T014); the connection test's failed probe answers
`checked: false` (M2 → T017, T021, T025); a method Devolada has seen is
used by the next payment everywhere (D16, the creator's choice → T003,
T011, T012, T017, T021, T022). Task numbers are the renumbered ones.

**T001 (2026-10-02): no drift.** The three callers of
`paymentActions.attempt`, the `input()` helper, both users of the cash
method id, the expected objects and the browser visits are where the task
says. Every `formas-de-pago` stub matches by prefix or regex and none sends
`next`. Every `capabilitiesOf` caller passes the whole integration row. The
latest migration is `0044_cash_at_stores.sql`.

**Deviation found while implementing T011**: the list is cached under a
new key kind, `payment-methods`, not the old `payment-method`. An entry
left under the old kind holds a single id; with a row whose stamp is still
null the key would be the same, and the list reader would get a number on
the first payment after the deploy.

**Found while implementing US4 (2026-10-02)**:
- `apps/admin/test/a11y.test.tsx` renders the WispHub screen too, so it
  needed the new read's handler (T026 named only `integrations.test.tsx`).
- A refused copy says "No se copió" on the field, the links screen's
  words; the live region says what to do instead.
- The T017 tests decide one open point: when a key save's own connection
  test reads the methods, the list is kept here under the patch's new
  stamp, as the setup read does (D16, "the place that read it keeps it").
- T018 met one more expected object than T001 listed: the
  `INSTALLATION_UNREACHABLE` answer in `apps/api/test/integrations.test.ts`
  ("tests a typed key without saving") gains `devoladaMethods: null`.
- The methods probe now reads the list, so a 200 whose body is not a list
  fails the probe as `INSTALLATION_UNREACHABLE` — the installation not
  answering usefully, as a 5xx is. Before, any JSON passed it.

**Checks run (T034–T036, 2026-10-02)**: API 68 files / 1,255 tests;
admin 30 / 388; ui, pago, red, landing green; typecheck in every
workspace; spec-lint, contrast-lint, pending-lint and gen-banks --check
green. The IX grep finds the two names only in the adapter. Browser layer:
274 passed. This container's Playwright browser is build 1194 while the
repo pins a newer one, so the run used a throwaway config pointing at the
installed Chromium; CI runs its own.

**T037 (2026-10-02)**: `/speckit-analyze` after implementation found no
critical issue. Resolved with the creator's go-ahead:
- C1: with only Devolada's methods the cash method follows today's rule
  over the whole list, and a refused method is never sent again in the
  same attempt (FR-012, FR-004; D4, D6 corrected; two tests in
  `apps/api/test/payment-method-per-channel.test.ts`).
- U1: the methods card takes only a test of the saved connection; a typed
  key's test stays in the connection card (contract corrected; one test
  in `apps/admin/test/payment-method-per-channel.test.tsx`).
- I1–I5: research D3, plan IV, the data model, T025 and the spec's status
  now say what was built.
The related suites were run again: API 7 files / 103 tests, admin 3 / 47.

**Release rule (D12), before any code**: the pilot must not create
`CASH - RED.DEVOLADAPAGO` before the release that carries FR-012. Today's
adapter would record every payment with it (R11).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel: it touches a different file and depends
  on no incomplete task
- **[Story]**: which user story the task serves
- Every task names its file, and every non-obvious rule it writes cites
  `payment-method-per-channel D<n>` in a comment

## Path Conventions

Paths are as `plan.md` fixes them:
- `apps/api/src/…` and `apps/api/test/…`
- `apps/admin/src/…` and `apps/admin/test/…`
- `packages/ui/src/…`
- `tests/e2e/…`

---

## Phase 1: Setup

**Purpose**: check what the tasks change against the tree before editing.
No behaviour changes in this phase.

- [X] T001 Check the consumers this feature changes against the tree, and note any drift at the top of this file (`specs/019-payment-method-per-channel/tasks.md`) before editing:
  - the three callers of `paymentActions.attempt`: `attemptOf` in `settleConfirmed` (`apps/api/src/direct-payments/validation.ts`), `dispatchObserved` (`apps/api/src/routes/payments/handler.ts`) and `sweepReconnections` (`apps/api/src/reconnection/queue.ts`); plus the `input()` helper in `apps/api/test/cash-at-stores-capabilities.test.ts`, which builds an `ActionAttemptInput` by hand;
  - every user of `cashPaymentMethodId` and `WispHub.getCashPaymentMethodId`: `apps/api/src/wisphub/reconnection.ts` and `apps/api/test/provider-latency.test.ts` (scenarios 1, 2, 11b, 12);
  - every `formas-de-pago` stub in `apps/api/test/` matches by prefix or regex, never the exact path, so a `?limit=&offset=` query keeps them matching; and none of them sends `next`, so a one-page read stays one call;
  - the expected objects that gain `devoladaMethods`: `HEALTHY` in `apps/api/test/integrations.test.ts`, the test answers in `apps/api/test/integrations-installation.test.ts`, and the test-result fixture in `apps/admin/test/integrations.test.tsx`;
  - the browser-layer visits of the WispHub screen: `tests/e2e/contrast.spec.ts` (two entries) and `tests/e2e/responsive.spec.ts`, which will meet the new read;
  - the path the integration row takes to the adapter: `capabilitiesOf` (`apps/api/src/integrations/registry.ts`) → `wisphubCapabilities` (`apps/api/src/wisphub/receivables.ts`) → `paymentActions` (`apps/api/src/wisphub/actions.ts`); every caller passes the whole row it read, so the new column reaches the adapter with no extra query;
  - the latest migration number in `apps/api/migrations/`.

**Checkpoint**: drift noted, or none.

---

## Phase 2: Foundational

**Purpose**: the ground every story stands on:
- the capability's input carries the payment's channel and reference parts
  (D2), filled at the three call sites;
- the adapter reads the whole list of methods, cached (D3);
- the pure rules: names, descriptions, normalization, choice (D1, D4, D5,
  D15);
- the cash method never one of Devolada's names (FR-012). This is the one
  behaviour change of the phase, and the one the release must carry before
  any business creates the methods (D12).

**⚠️ No story starts before this phase is green.**

- [X] T002 [P] Widen `ActionAttemptInput` in `apps/api/src/integrations/capabilities.ts` with `channel: "spei" | "store"` and `recordReference: { folio: string | null; trackingKey: string | null; storeName: string | null }`, exactly as `contracts/action-attempt.md` gives them, each with its comment citing D2/D7. `ActionAttempt` does not change.
- [X] T003 [P] Add `paymentMethodsSeenAt: integer("payment_methods_seen_at", { mode: "timestamp_ms" })`, nullable, to `integrations` in `apps/api/src/db/schema.ts`, with a comment citing D16 (what it stamps, who writes it, that the adapter only reads it). Run `pnpm --filter @devolada/api db:generate` and `db:migrate:local`; the generated file in `apps/api/migrations/` must be a single additive `ALTER TABLE integrations ADD payment_methods_seen_at` (D11: the preview applies it to the live dev database).
- [X] T004 [P] Create `apps/api/src/direct-payments/record-reference.ts` (core, D2, D10):
  - `storeNamesFor(db, rows)`: one `select id, name from stores where id in (…)` over the rows' non-null `storeId`, as a `Map<storeId, name>`; no query when no row has a store;
  - `recordReferenceOf(row, names)`: `{ folio: row.folio, trackingKey: row.channel === "spei" ? row.trackingKey : null, storeName: row.storeId ? names.get(row.storeId) ?? null : null }`.
  - The comment says why the name is read at recording (D10: the name as it is then; a later rename touches nothing, FR-006) and why nothing about the payer is read (FR-007).
- [X] T005 In `settleConfirmed` (`apps/api/src/direct-payments/validation.ts`), keep the row that `await update({ folio: payment.folio ?? makeFolio(), … })` returns, and build every attempt from it: `channel: row.channel` and `recordReference: recordReferenceOf(row, await storeNamesFor(db, [row]))`, read once before `attemptOf`. Comment why the returned row and not `payment`: the clave may have been adopted onto the row after `payment` was read (`adoptKey`, the matcher's write, the accepted key), and the folio is born in this very write. Depends on T002, T004.
- [X] T006 [P] In `dispatchObserved` (`apps/api/src/routes/payments/handler.ts`), add `channel: row.channel` and `recordReference: recordReferenceOf(row, await storeNamesFor(db, [row]))` to `actions.attempt`. Depends on T002, T004.
- [X] T007 [P] In `sweepReconnections` (`apps/api/src/reconnection/queue.ts`), read `storeNamesFor(db, due)` once per batch beside the businesses' timezones, and add `channel: charge.channel` and `recordReference: recordReferenceOf(charge, storeNames)` to `actions.attempt` (D10: one query, as the batch already does for the businesses). Depends on T002, T004.
- [X] T008 [P] Add `channel: "spei"` and `recordReference: { folio: null, trackingKey: null, storeName: null }` to the `input()` helper in `apps/api/test/cash-at-stores-capabilities.test.ts`, so the existing suite typechecks and keeps proving what it proves. Depends on T002.
- [X] T009 In `apps/api/src/wisphub/client.ts`:
  - replace `getCashPaymentMethodId()` with `listPaymentMethods(): Promise<{ id: number; nombre: string }[]>`: `GET /formas-de-pago/?limit=100&offset=<n>`, following while the answer's `next` is a non-null string, inside the client's operation budget; an empty list is returned as empty (the "no payment methods" throw moves to the chooser, T010);
  - keep the field names of a 400 JSON body on `WispHubError` as `fields?: string[]` (D6): on a non-ok 400 only, read the body as text, `JSON.parse` it safely, and keep its top-level keys. Every other status throws exactly as today.
  - Comment each with D3 / D6 and the measured answer (R9: `{"forma_pago": ["Clave primaria … inválida - objeto no existe."]}`).
- [X] T010 Create `apps/api/src/wisphub/payment-methods.ts`, pure, no I/O (D1, D4, D5, D15):
  - the two names, `SPEI - LINK.DEVOLADAPAGO` and `CASH - RED.DEVOLADAPAGO`, each with its es-MX description as research D15 gives it, keyed by channel;
  - `normalizeMethodName(text)`: NFD with accents removed, upper case, runs of spaces collapsed, spaces around `-`, `.` and `·` removed, trimmed (D5);
  - `devoladaMethodFor(methods, channel)`: the methods whose normalized name equals the channel's normalized name; the lowest `id`, or null (FR-003);
  - `devoladaMatches(methods, channel)`: how many match, for the setup block (US4);
  - `cashMethodOf(methods)`: the first, in the provider's order, whose `nombre` matches `/efect|cash/i` and whose normalized name is neither of Devolada's; else the first that is neither; else the first method; an empty list throws `WispHubError("WISPHUB_UNAVAILABLE", "no payment methods")`, today's answer (D4, FR-012). Its comment names R11 (measured 2026-10-02: the demo lists `CASH - RED.DEVOLADAPAGO` before "Cash").
- [X] T011 In `apps/api/src/wisphub/cache.ts`, replace `cashPaymentMethodId` with `paymentMethods(businessId, wisphub, now, seenAt)`: the whole list from `listPaymentMethods`, cached for the same ten minutes under the same key kind, with `seenAt` (ms or null) as the key's version through `keyFor`'s existing `version` argument (D3, D16). Add `forgetPaymentMethods(businessId, wisphub, seenAt)` (deletes this colo's entry, D6) and `rememberPaymentMethods(businessId, wisphub, methods, now, seenAt)` (writes a fresh list under a new stamp, for the setup read, D8). Migrate `apps/api/test/provider-latency.test.ts` scenarios 1, 2, 11b and 12 to `listPaymentMethods` and `paymentMethods`, keeping each scenario's assertion (the deadline, the spent budget, one read per tenant, the configured base) and its existing `US-P06` citation. Depends on T009.
- [X] T012 Thread the record through the adapter, and use the cash rule:
  - `apps/api/src/wisphub/reconnection.ts`: `attemptReconnection` takes one more argument, `record: { channel: "spei" | "store"; reference: ActionAttemptInput["recordReference"] }`; in place of `cashPaymentMethodId(…)`, it reads `paymentMethods(business.id, wisphub, now)` (still in parallel with `ensureAutoActivate`, provider-latency D2) and records with `cashMethodOf(methods).id` (FR-012);
  - `apps/api/src/wisphub/actions.ts`: pass `{ channel: input.channel, reference: input.recordReference }`, and the integration's `paymentMethodsSeenAt` (ms or null) as the cache version that `attemptReconnection` hands to `paymentMethods` (D16);
  - `apps/api/src/wisphub/receivables.ts` and `actions.ts`: `wisphubCapabilities` and `paymentActions` take `WispHubAddress & { paymentMethodsSeenAt?: Date | null }`, which every caller's integration row already satisfies.
  - Depends on T002, T003, T010, T011.

**Checkpoint**: `pnpm -r --if-present typecheck` and `pnpm -r --if-present test` green with no other test edited. Every business records with the same cash method as today, except one whose list has Devolada's name before its own cash method (FR-012).

---

## Phase 3: User Story 1 — The business downloads what came in by SPEI (Priority: P1) 🎯 MVP

**Goal**: every SPEI payment Devolada records carries
`SPEI - LINK.DEVOLADAPAGO` when the business's WispHub has it; otherwise
the cash method, and the action never waits (FR-001, FR-003–FR-006,
FR-012).

**Independent Test**: on the demo, with the method created, a paid link's
invoice carries the method, and the panel's list filtered by it shows it
(quickstart §2, steps 4–5).

### Tests for User Story 1

- [X] T013 [US1] Extend the WispHub stubs so a test can name the list and read what was sent:
  - `mockPanelSettle` in `apps/api/test/payer-helpers.ts`: `opts.methods` (default `[{ id: 7, nombre: "efectivo" }]`, today's) and a returned capture of the `registrar-pago` body's `forma_pago` and `referencia`;
  - `mockAction` in `apps/api/test/store-helpers.ts`: the same `opts.methods` and `formaPago` / `referencia` on its capture.
  - Existing callers pass nothing and keep today's stub.
- [X] T014 [US1] Create `apps/api/test/payment-method-per-channel.test.ts` with `describe("payment-method-per-channel US1 …")`, each case asserting the captured body:
  - the SPEI verdict, list `[efectivo 7, SPEI - LINK.DEVOLADAPAGO 12]` → `forma_pago: 12`;
  - *Ejecutar ahora* on an observed SPEI row → `12`;
  - the sweep on a queued SPEI row → `12`;
  - no Devolada method → `7`, the action ends as today;
  - R11's order `[CASH - RED.DEVOLADAPAGO 3, Cash 4, efectivo 7]` and no SPEI method → `4`;
  - only Devolada's names are set aside: `[CASH - RED.DEVOLADAPAGO 3, Devoladapago 5]` → `5`; `[CASH - RED.DEVOLADAPAGO 3]` alone → `3` (today's behaviour for that case, FR-012);
  - the name typed `spei-link . devoladapago` → matched; two methods named `SPEI - LINK.DEVOLADAPAGO`, ids 12 and 9 → `9`;
  - the provider refuses the method (`400 {"forma_pago": ["Clave primaria \"12\" inválida - objeto no existe."]}`) → a second `registrar-pago` with `7` in the same attempt; the payment ends as today; the next payment reads the list again;
  - a 400 naming `total_cobrado` → one call only, and the action stays queued with `INTEGRATION_UNAVAILABLE`;
  - a row whose money already landed (`payment_registered_at` set) → no `registrar-pago` and no list read (D9, FR-006);
  - FR-005's other paths, each with `[efectivo 7, SPEI 12]` → `12`: a partial payment that leaves the service cut (`accion: 0`); a customer with no pending invoice, where Devolada creates the invoice and then pays it; a held payment the business accepts (`POST /payments/:id/review`, `decision: "accept"`, execution on).

### Implementation for User Story 1

- [X] T015 [US1] In `attemptReconnection` (`apps/api/src/wisphub/reconnection.ts`), record with `devoladaMethodFor(methods, record.channel) ?? cashMethodOf(methods)` (D4). Depends on T012.
- [X] T016 [US1] In the same function, the fallback (D6): when `registerPayment` throws a `WispHubError` with status 400 whose `fields` include `forma_pago`, and the method sent was Devolada's, call `forgetPaymentMethods` and send the same payment once more with `cashMethodOf(methods).id`. A 422 on either call keeps reconnection D8's reading (the money landed). Any other error is rethrown as today. Comment the measured answer (R9, 2026-10-02) and why a second call cannot pay twice (the invoice stays pending). Depends on T015.

**Checkpoint**: T014 green; the existing suites green.

---

## Phase 4: User Story 4 — The business sets up its methods before Devolada writes in its system (Priority: P2)

**Goal**: after the connection, the WispHub screen shows each method's
name and description to copy and whether it exists; "Probar conexión" says
the same; automatic execution turns on only when the channels' methods
exist (FR-008, FR-009, FR-013).

**Independent Test**: on the demo, in observation mode, with a method
renamed, the block shows it missing and *Ejecución* stays off; restore it,
reopen, and it turns on (quickstart §2, steps 3, 6–7).

### Tests for User Story 4

- [X] T017 [P] [US4] In `apps/api/test/payment-method-per-channel.test.ts`, add `describe("payment-method-per-channel US4 …")`:
  - `GET /integrations/wisphub/payment-methods`: both found (store channel on, `seedStoreChannel`) → two lines, each with its `name` and `description`; store channel off → `network: null`; one missing → `missing`; two with one name → `duplicate`; WispHub timing out → `{ checked: false }`; no key → `409 WISPHUB_NOT_CONFIGURED`; a role without `integrations: manage` → refused as the hub's other routes are;
  - after a first payment cached `[efectivo 7]`, a setup read that finds the SPEI method makes the next SPEI payment record with `12` (FR-014);
  - `POST /integrations/wisphub/test`: `devoladaMethods` carries the block of the candidate key; a test that stops before the payment-methods probe → `devoladaMethods: null`; a candidate key's read writes no cache;
  - the probe's three cases (D8): answered → the block; refused or timed out at the methods probe → `{ checked: false }`; stopped at an earlier probe → `null`;
  - the gate, each row of the D14 table in `quickstart.md` §1, the no-key row included (`409 WISPHUB_NOT_CONFIGURED`, no WispHub call): the status and code, and that the row's `actions_enabled` is unchanged when refused; turning off, and `true` on a row already on, make no WispHub call;
  - the stamp (D16): the setup read, the test of the saved connection, a successful gate, and a patch that saves a new key or installation each move `payment_methods_seen_at`; a test of a candidate key and a refused gate do not; `paymentMethods` with a cached list under one stamp reads the provider again when asked with a newer stamp; and after a first payment cached one account's list, saving another key on the same installation makes the next payment read the list again.
- [X] T018 [P] [US4] Add `devoladaMethods` to `HEALTHY` in `apps/api/test/integrations.test.ts` (its stub lists only "Efectivo": `link` missing, `network: null`) and to the expected answers in `apps/api/test/integrations-installation.test.ts`.

### Implementation for User Story 4

- [X] T019 [US4] In `apps/api/src/routes/integrations/schema.ts`, add `devoladaMethodStatus`, `devoladaMethodLine` (`name`, `description`, `status`) and `devoladaMethods` exactly as `contracts/integrations-payment-methods.md` gives them; add `devoladaMethods: devoladaMethods.nullable()` to `wisphubTestResponse`; export the types (`DevoladaMethods`, `DevoladaMethodLine`). The package export `./integrations-schema` already exists.
- [X] T020 [US4] In `apps/api/src/wisphub/payment-methods.ts`, add `setupBlockOf(methods, storeChannelOn): DevoladaMethods` (`found` for one match, `duplicate` for more, `missing` for none; `network` only with the store channel on) and `readDevoladaMethods(wisphub, storeChannelOn)`, which lists fresh and answers `{ checked: false }` on any `WispHubError` (FR-009). The block's type is imported type-only from the integration's schema. Depends on T019.
- [X] T021 [US4] In `apps/api/src/routes/integrations/handler.ts`:
  - `getWisphubPaymentMethods(c)`: `businessGuard`, the stored key and installation (`409 WISPHUB_NOT_CONFIGURED` without a key), the business's `store_channel_on`; reads the list fresh; when the provider answered, stamps `payment_methods_seen_at` with `upsertIntegration` and keeps the list with `rememberPaymentMethods` under the new stamp (D8, D16); answers the block;
  - `testKey`: the `payment_methods` probe reads `listPaymentMethods` instead of `probePaymentMethods` (then delete `probePaymentMethods` from `client.ts`), and `answer()` carries `devoladaMethods` by the contract's table: the block when the probe answered, `{ checked: false }` when it ran and failed, `null` when the test stopped before it (D8, FR-009). Only a test of the saved key and installation stamps (D16). The probe's outcome rules do not change.
  - Depends on T019, T020.
- [X] T022 [US4] In `patchWisphub` (same file), the gate (D14): only when the patch carries `actionsEnabled: true` and the stored row has it false (or there is no row yet): with no key after this patch, refuse with `409 WISPHUB_NOT_CONFIGURED` before any provider call; otherwise read the block with the key and installation the row will have after this patch; refuse the whole patch with `409 PAYMENT_METHODS_MISSING` when a required line is `missing`, or `503 PAYMENT_METHODS_UNCHECKED` when `checked` is false; save nothing. A passing check saves the patch and `payment_methods_seen_at` in the same write (D16). Separately, whatever else it carries, a patch that saves a new key or installation also sets `payment_methods_seen_at` to now, with no provider call for it (D16: the cache key carries the address, not the key). Required: `link` always, `network` when the store channel is on; `duplicate` counts as present. Comment D14 and FR-013's "never turned off". Depends on T021.
- [X] T023 [US4] In `apps/api/src/routes/integrations/index.ts`, `GET /wisphub/payment-methods` with `requireSession`, `requireArea("integrations", "manage")`, wired to `getWisphubPaymentMethods`. Pure router. Depends on T021.
- [X] T024 [P] [US4] In `packages/ui/src/components/status-badge.tsx`, add `methodFound` (success, check, "Creada"), `methodMissing` (info, "Falta crearla") and `methodDuplicate` (warning, "Repetida"), each with a lucide icon, with a comment citing payment-method-per-channel D8 and why missing is not a failure (FR-008).
- [X] T025 [US4] In `apps/admin/src/features/integrations/WispHubScreen.tsx`:
  - a `PaymentMethodsCard` between `KeyCard` and `MappingCard`: without a key (`wisphub.configured` false) no query and *"Conecta WispHub para revisar tus formas de pago."*; otherwise a query on `GET /integrations/wisphub/payment-methods` (its own loading inside `<Pending>`, its own error state with retry; a `409 WISPHUB_NOT_CONFIGURED` reads as the no-key text, with no retry), one line per method — the name in the mono face and the description, each field itself a `<button>` that copies its value in place (label with a copy icon, then the value; after copying, a check and "Copiado"; `navigator.clipboard.writeText`, as `ApiScreen.tsx` does), the `StatusBadge` — and the copy of `contracts/integrations-payment-methods.md` ("The screen");
  - the network's line only when `session.storeChannel.on` (as built: when the block's `network` is not null, which the API derives from the same `store_channel_on`, read per request);
  - `SwitchesCard`: the switch cannot be turned on while the integration has no key (`wisphub.configured` false: "Primero conecta WispHub."), while a required line is `missing`, or while the block is unchecked, and says why, pointing at the block; it can always be turned off; the three refusal codes (`WISPHUB_NOT_CONFIGURED`, `PAYMENT_METHODS_MISSING`, `PAYMENT_METHODS_UNCHECKED`) get their es-MX copy;
  - when "Probar conexión" or a save answers `devoladaMethods`, a block replaces the card's cached block; `null` leaves it as it is.
  - Depends on T019, T024.
- [X] T026 [US4] Admin tests:
  - `apps/admin/test/msw.ts`: a `devoladaMethods` handler factory for the new GET, its fixtures validated by `devoladaMethods.parse`;
  - `apps/admin/test/payment-method-per-channel.test.tsx` (cites `payment-method-per-channel US4`): both lines with names and descriptions, each field copying its value in place and showing "Copiado"; the network's line hidden with the store channel off; the missing method's two copies — observing ("Créala para poder encender la ejecución.") and executing ("Mientras no exista, esos pagos se registran como efectivo, igual que hoy."); the unchecked state; the switch blocked with no key, with a method missing and unchecked, and free to turn off; each refusal's copy; a test answer with `devoladaMethods: null` leaving the card as it was; no key saved → no read and the connect-first text; axe on every rendered state;
  - `apps/admin/test/integrations.test.tsx`: a handler for the new read (found), and `devoladaMethods: null` on its test-result fixture.
  - Depends on T025.
- [X] T027 [P] [US4] In `tests/e2e/stubs.ts`, stub `**/integrations/wisphub/payment-methods` with a found block validated by the schema, so `tests/e2e/contrast.spec.ts` and `tests/e2e/responsive.spec.ts` measure the block in both themes and at 360/768/1280. Depends on T019.

**Checkpoint**: T017, T018 and T026 green; the browser layer renders the block.

---

## Phase 5: User Story 2 — The business downloads what its network of stores collected (Priority: P2)

**Goal**: every store cash payment carries `CASH - RED.DEVOLADAPAGO` when
the business's WispHub has it, whichever store recorded it (FR-002); the
two channels are independent (FR-004).

**Independent Test**: on the demo with the store channel on, a store's
record lands on the invoice with the network's method (quickstart §2).

- [X] T028 [US2] In `apps/api/test/payment-method-per-channel.test.ts`, add `describe("payment-method-per-channel US2 …")`, asserting the captured body (`seedActiveStore`, `seedStoreChannel`, `mockAction`):
  - a store's record, list `[efectivo 7, SPEI 12, CASH - RED 13]` → `forma_pago: 13` (the deferred first attempt, run by the sweep when no `defer`);
  - the sweep on a queued store row → `13`;
  - the network's method missing, the SPEI one present → the store payment records with `7`, never `12`;
  - the SPEI one missing, the network's present → a SPEI payment records with `7`, never `13`;
  - two stores, one method: both record with `13`.
- [X] T029 [US2] If a T028 case fails, the fix goes where the case points (`settleConfirmed`'s `channel` for the store's deferred attempt, or the chooser); no other code is expected for this story. Depends on T028.

**Checkpoint**: T028 green.

---

## Phase 6: User Story 3 — Each recorded payment says where it came from (Priority: P3)

**Goal**: every recording, fallback included, carries `folio · clave` or
`folio · tienda`, at most 200 characters, nothing about the payer (FR-007).

**Independent Test**: on the demo, the invoice's transaction reads
"Referencia: DV-… · <clave>" (quickstart §2, step 5).

- [X] T030 [US3] In `apps/api/test/payment-method-per-channel.test.ts`, add `describe("payment-method-per-channel US3 …")`, asserting the captured `referencia`:
  - a SPEI payment with its clave → `DV-XXXXXX · <clave>`; one found by reference whose clave was adopted at the verdict → that clave; one with no clave → `DV-XXXXXX`;
  - a store payment → `DV-XXXXXX · <store name>`; the store renamed afterwards → a later retry of a payment not yet landed carries the new name, a landed one is never recorded again;
  - the fallback (the refused method of T014) still carries the reference;
  - a 300-character store name written straight to the row → 200 characters, the folio intact, the name ending in `…`;
  - the body never holds the customer's name or phone.
- [X] T031 [US3] In `apps/api/src/wisphub/payment-methods.ts`, `referenceFor(reference)`: `folio · clave`, `folio`, or `folio · store name`, with ` · ` as separator; only the store's name is shortened, ending in `…`, to fit 200 characters (R7); `undefined` when there is no folio. Comment D7 and the measured facts (R10, R12: the middle dot survives the API, the panel and the PDF; the store's part is at most 80 characters today, so the cut is a guard).
- [X] T032 [US3] In `apps/api/src/wisphub/client.ts`, `registerPayment` takes an optional `reference?: string` and sends `referencia` only when it is given, so every body without one stays byte-for-byte today's.
- [X] T033 [US3] In `attemptReconnection` (`apps/api/src/wisphub/reconnection.ts`), pass `referenceFor(record.reference)` on the first call and on the fallback. Depends on T031, T032.

**Checkpoint**: T030 green; the whole suite green.

---

## Phase 7: Polish & cross-cutting

- [X] T034 Run quickstart §1 end to end: the API and admin suites, `pnpm -r --if-present typecheck`, `node scripts/spec-lint.mjs`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `node scripts/gen-banks.mjs --check`.
- [X] T035 [P] Constitution IX check: `rg -n "DEVOLADAPAGO" apps packages --glob '!apps/api/src/wisphub/**' --glob '!**/test/**' --glob '!tests/**'` returns nothing — the names live in the adapter only (D1); the admin shows them from the contract.
- [X] T036 [P] `pnpm e2e` (contrast and responsive on the WispHub screen, both themes).
- [X] T037 Run `/speckit-analyze` and resolve every CRITICAL finding before the PR is marked ready.
- [ ] T038 Release (D12), with the creator:
  - before the `v*` tag: confirm the pilot has not created `CASH - RED.DEVOLADAPAGO`;
  - on dev, the creator runs quickstart §2 on the demo (steps 3–7);
  - after the tag: quickstart §3 with the pilot, and SC-001 checked on its first 30 SPEI payments after its screen shows `SPEI - LINK.DEVOLADAPAGO` *Creada*.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after T001. Blocks every story.
- **US1 (Phase 3)**: after Phase 2.
- **US4 (Phase 4)**: after Phase 2. Its tests of a payment using a freshly
  read method (T017, second bullet) need T015.
- **US2 (Phase 5)**: after US1 (it proves US1's chooser on the store's
  paths).
- **US3 (Phase 6)**: after Phase 2; T030's fallback case needs T016.
- **Polish (Phase 7)**: after the stories the release carries.

### Within Phase 2

- T002, T003 and T004 first, in parallel; then T005, T006, T007, T008
  in parallel.
- T009 → T011; T010 in parallel with T009; T012 after T002, T003, T010,
  T011.

### Within US4

- T019 → T020 → T021 → T022, T023; T024 in parallel with T019–T023;
  T025 after T019, T024; T026 after T025; T027 after T019.

### Parallel opportunities

```text
Phase 2:  T002 ‖ T003 ‖ T004 ‖ T009 ‖ T010
          then T005 ‖ T006 ‖ T007 ‖ T008 ‖ T011
US4:      T017 ‖ T018 ‖ T024 (tests and the badge, beside the API work)
          T027 as soon as T019 lands
Across:   US3 (T030–T033) beside US4, once Phase 2 and T016 are in
```

---

## Implementation Strategy

### MVP: Phase 2 + US1

The foundation alone already makes the release safe (FR-012). With US1, a
business that creates `SPEI - LINK.DEVOLADAPAGO` gets every SPEI payment
under it: the pilot's request, answered. Stop and validate on the demo.

### Then

1. **US4**: the screen and the gate — what makes US1 true from a new
   business's first payment, and what a business reads to set up.
2. **US2**: the network's method, proven on the store's paths.
3. **US3**: the reference on every recording.

One PR can carry them all; the release (T038) waits for FR-012 (Phase 2)
at the least, and for US4 before any business is told to create the
methods.
