---

description: "Task list for Cobros in Links"
---

# Tasks: Cobros in Links

> **Drift found by T002 (2026-09-28), before editing.** Every consumer
> T002 lists exists as listed. Three more the list did not name:
> - `tests/e2e/keyboard.spec.ts` walks the Cobros menu entry in its tab
>   order (`/^Cobros$/`). It leaves with T019.
> - `tests/e2e/contrast.spec.ts` names a screen "Cobros" but opens the
>   feed at the admin root, never `/payment-requests`. T039 therefore has
>   nothing to re-point there; T040 adds a *Por cobrar* screen to it
>   instead, which is where the two new badges are measured.
> - `apps/api/src/index.ts` mounts the route. The API path stays (D1),
>   so it needs no change.

**Input**: Design documents from `specs/014-cobros-in-links/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/receivables-api.md](./contracts/receivables-api.md),
[contracts/customer-debt-api.md](./contracts/customer-debt-api.md),
[quickstart.md](./quickstart.md)

**Tests are required, not optional.**
- Constitution IV fixes which layer may answer which question.
- Constitution VII requires every test file to cite its story, here as
  `cobros-in-links US<n>`. A task's `[US<n>]` label is what the test it
  lands with inherits.

**Organization**: by user story, in the spec's priority order: **US1 (P1),
US2 (P2), US3 (P2), US4 (P3)**. US2 and US3 share a priority. US2 comes
first because it is smaller and makes the view reachable from the old
address.

**Measurement comes first.** T001 runs the Postman collection *"WispHub ·
Mediciones para Por cobrar"* (workspace Devoladapago) and records the
answers. M2 is the only one that can stop work: if WispHub's
per-customer balance door disagrees with the invoice list, US3's debt
door (T026–T030) waits for the creator. US1, US2 and US4 do not depend
on it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel, because it touches a different file and
  depends on no incomplete task
- **[Story]**: which user story the task serves
- Every task names its file

## Path Conventions

Workspace paths are as `plan.md` fixes them: `apps/api/src/…`,
`apps/admin/src/…`, `apps/api/test/…`, `apps/admin/test/…`,
`packages/ui/src/…` and `tests/e2e/…`.

---

## Phase 1: Setup

**Purpose**: nothing needs initialising. These tasks fix the ground: what
the provider really answers, and who consumes the contract that is about
to change.

- [ ] T001 *(partly done 2026-09-27: F, M1, M3 settled, and M2 case (a) COINCIDE, on the demo; cases (b) and (c) still open. See research.md, "Measurements recorded".)* Run the collection *"WispHub · Mediciones para Por cobrar"* on the demo, then on the pilot (quickstart §0: F, M1, M2, M3). Record each answer, with its date, under the decision it settles in `specs/014-cobros-in-links/research.md`:
  - **M1 → D2:** `next` pages by `offset` or by `page`, and `count` is present or absent;
  - **M3 → D5:** the JSON types of `saldo` and `sub_total`, and the period text;
  - **M2 → D10:** COINCIDE, COINCIDE_Y_TRAE_ANTIGUAS, or a mismatch;
  - **F:** whether any `/clientes/` filter narrows by debt.

  If M2 reports FALTAN_FACTURAS or SOBRAN_FACTURAS, or if F finds a working filter, stop and take it to the creator before T026.
- [X] T002 [P] Check the list of consumers of `GET /payment-requests` and its `cobros` fixture against the tree, and note any drift at the top of this file before editing:
  - `apps/api/package.json` (the `./payment-requests-schema` export);
  - `apps/api/test/{payment-requests,pending-invoice-cap,presence-freshness}.test.ts`;
  - `apps/admin/src/{router.tsx,features/shell/Shell.tsx,features/cobros/CobrosScreen.tsx}`;
  - `apps/admin/test/{msw.ts,cobros.test.tsx,presence-freshness.test.tsx}`;
  - `tests/e2e/{stubs.ts,contrast.spec.ts}`;
  - `tests/design/{review-foundations,review-feedback}.spec.ts`.

---

## Phase 2: Foundational

**Purpose**: the boundary the rest stands on (constitution IX, D18): the
money parsers in the core, the core's capability module, the session that
says what the integration can do, and the adapter's reading of an invoice
row. US1 draws the row and US4 tells an outage from an empty list with it.

*Added 2026-09-27:* T044 and T045 are new. Earlier IDs keep their numbers,
so the analysis and research that cite them stay true.

**⚠️ CRITICAL**: no user story work begins until this phase is done.

- [X] T003 Move `apps/api/src/wisphub/money.ts` to `apps/api/src/money.ts` (`git mv`) and update every importer: Consta's three (`consta/provider/apicep.ts`, `consta/extraction/gate.ts`, `consta/extract.ts`), the adapter and the tests. The money parsers are core, not the adapter's (constitution IX, `cobros-in-links D18`). Then add a money helper there that accepts a provider amount as either a string or a JSON number and always converts through `decimalToCents` (numbers via `amountToCents`). Unreadable input returns `null` rather than throwing. Cite `cobros-in-links D5` and the M3 result from T001.
- [X] T044 Create two core files (`cobros-in-links D18`, data-model "Core and adapter"). Dependencies point one way: the adapter imports `capabilities.ts`, and only `registry.ts` imports an adapter.
  **`apps/api/src/integrations/capabilities.ts`** imports nothing from any adapter:
  - the core shapes `OpenInvoice`, `ReceivablesPage`, `CustomerDebtAnswer`;
  - `IntegrationCapabilities`, with optional `receivables.page(cursor, limit)` (answers a page or `"bad_cursor"`) and `customerDebt.of(usuario)`;
  - `IntegrationError`, with codes `INTEGRATION_UNAVAILABLE` and `INTEGRATION_AUTH_FAILED`;
  **`apps/api/src/integrations/registry.ts`** is the one entry point, and the only core file that imports an adapter:
  - `capabilitiesOf(integration, env)` picks the adapter by `integration.provider`, and returns `{}` for no integration or no key;
  - `capabilityNames(integration)` gives the same answer with no network call.
  The WispHub side is filled by T046 and T029.
- [X] T045 The session says what the integration can do (`cobros-in-links D13`):
  - `apps/api/src/auth/middleware.ts` and the actor type in `apps/api/src/env.ts` gain `integrationCapabilities: ("receivables" | "customerDebt")[]` from `capabilityNames`, beside `integrationConfigured` (`integrations-hub` D10);
  - `apps/admin/src/features/auth/session.ts`'s `BusinessActor` gains the same field;
  - the session fixture in `apps/admin/test/msw.ts` carries it.
  Add an API test to `apps/api/test/cobros-in-links.test.ts` (cite `cobros-in-links US1`): a business with a WispHub key reads both names, and one with no integration reads `[]`.
- [X] T004 In `apps/api/src/wisphub/client.ts`, give `PendingInvoice` three optional fields: `periodCents` (from `sub_total`), `carriedCents` (from the invoice's `saldo`) and `period` (the first `articulos[].descripcion` match of `Periodo del … al …`). Map them in `pendingInvoicesPage` with T003's helper. `pendingInvoicesPage` also returns the envelope's `count` as `total: number | null`, read defensively. A row whose new fields cannot be read keeps its `totalCents`. `debtOf`, the sweep and the money paths read nothing new (`cobros-in-links D5`).
- [X] T005 [P] Add API tests to `apps/api/test/cobros-in-links.test.ts`, citing `cobros-in-links US1`, for T003 and T004. They use the measured demo row: `sub_total` 499, `saldo` 299, `total` 798, and the line "Periodo del 15/Sept./2026 al 15/Oct./2026". Cover:
  - both money shapes, string and number;
  - an absent `count`, which gives `null`;
  - a row with no period line, which gives `period: null`;
  - `debtOf` over the same list unchanged, byte for byte.

**Checkpoint**: the adapter reads everything the Por cobrar row shows, the session says what the integration can do, and no money behaviour changed (T003 moves the parsers' file, not what they do).

---

## Phase 3: User Story 1 - See who has open invoices without leaving Links (Priority: P1) 🎯 MVP

**Goal**: Links gains the chip *Todos* / *Por cobrar*. Por cobrar reads open invoices live, one block per scroll, grouped by customer, and each row carries the same Copiar and WhatsApp as the customer view.

**Independent Test**: on a connected ISP with open invoices, open Links and press Por cobrar. Then check:
- the first block appears and scrolling brings more;
- rows are grouped by customer, with *Venció* / *Vence* in the business's timezone;
- a row opens to show its period and *saldo anterior*;
- WhatsApp opens that customer's chat with a working link;
- the count reads "N facturas abiertas".

### Tests for User Story 1

- [X] T006 [P] [US1] API tests in `apps/api/test/cobros-in-links.test.ts` for `GET /payment-requests` (contract `receivables-api.md`), with WispHub at its origin through `fetchMock`. Cover:
  - the first block carries an explicit window: 180 days back, one day ahead (FR-004);
  - `limit` is clamped to 10–50;
  - `nextCursor` walks the provider's own `next`, and the window stays fixed across blocks even when the clock crosses midnight between them;
  - a cursor holding a provider path, a foreign prefix or `desde > hasta` gets `400 VALIDATION_ERROR`;
  - `total` comes from `count`;
  - rows keep the provider's order;
  - SC-006: with a seeded `wisphubPages` snapshot whose rows differ, the door returns the live rows and makes exactly one provider call.
- [X] T007 [P] [US1] Component tests in `apps/admin/test/cobros-in-links.test.tsx` (MSW, axe, cites `cobros-in-links US1`). Cover:
  - Links opens on *Todos*, exactly as today;
  - pressing *Por cobrar* shows the first block;
  - a second block's invoice for a customer already on screen grows that row's total and count, and moves it nowhere;
  - *Venció* is judged by the business's timezone, not the browser's;
  - a row opens to its invoices, with period and *saldo anterior*;
  - Copiar and WhatsApp go through `POST /direct-payments/links` (FR-008);
  - a viewer sees no buttons;
  - an ISP with no open invoice gets "Nadie tiene facturas abiertas hoy", with no warning;
  - returning to the tab re-reads the first block, at most once every 30 s, and shows no read age (FR-011);
  - the count line reads "N facturas abiertas", and nothing when `total` is `null` (FR-007);
  - a business with no CLABE sees the rows with the buttons withheld (US1 scenario 7);
  - an invoice with no due date shows its issue date and never reads *Venció*;
  - switching views quickly never draws one view's late answer over the other.

### Implementation for User Story 1

- [X] T008 [P] [US1] In the adapter, `apps/api/src/wisphub/receivables.ts`, write the opaque `inv:` cursor (`cobros-in-links D2`, D18, data-model "Receivables cursor"). The core never reads it.
  - Encode `desde`, `hasta`, `limit` and `offset` parsed from the provider's `next` (measured 2026-09-27: `next` pages by `offset`).
  - Decode to either a value or `null`; `null` reaches the core as `"bad_cursor"`.
  - Never carry or accept a path.
  - Mirror `routes/direct-payments/cursor.ts` in form.
- [X] T009 [US1] Rewrite `apps/api/src/routes/payment-requests/schema.ts` to the block contract: `receivablesQuery` (`limit`, `cursor`) and `paymentRequestsResponse` = `{ results: CobroRow[], nextCursor, total, integration: "ok" | "unavailable" }`, where `CobroRow` gains `periodCents`, `carriedCents` and `period`. Remove `complete` and `readAt`, with a comment citing `cobros-in-links D1` and D16. The field names no provider (D18).
- [X] T046 [US1] In `apps/api/src/wisphub/receivables.ts`, implement the `receivables` capability and register it in `integrations/registry.ts` (`cobros-in-links D18`):
  - one `pendingInvoicesPage` call per page, on a fresh `wisphubFor` instance;
  - the path is `/facturas/?estado=1&tipo_fecha=fecha_emision`, plus T008's cursor numbers, or today's window on the first page: 180 days back, one day ahead (FR-004);
  - it reads no `readPendingInvoices`, no snapshot and no display cache (`cobros-in-links D3`);
  - it maps `PendingInvoice` to the core's `OpenInvoice`, returns `total` and the next cursor, and translates `WispHubError` into `IntegrationError`.
- [X] T010 [US1] Rewrite `apps/api/src/routes/payment-requests/handler.ts` to ask `capabilitiesOf(...).receivables.page(cursor, limit)` once per request. It maps the page to the contract. `"bad_cursor"` becomes `400 VALIDATION_ERROR`. It imports nothing from `wisphub/` (constitution IX). Keep `403` for a non-business actor, and `409 NOT_CONFIGURED` with no integration or no capability.
- [X] T011 [US1] Wire `zValidator("query", receivablesQuery)` in `apps/api/src/routes/payment-requests/index.ts`, keeping `requireSession` and no `requireArea` (`cobros-live` D4). The router stays pure.
- [X] T012 [US1] Retire `/payment-requests`' old behaviour in the API suites, and say why in each test's comment (`cobros-in-links D3`, D16). Do not delete the snapshot's own coverage.
  - `apps/api/test/payment-requests.test.ts`: rewrite for the block contract.
  - `apps/api/test/pending-invoice-cap.test.ts` (around lines 279–284 and 366–367): the snapshot still feeds the money paths, so re-point those assertions at a money-path reader, or at T006's SC-006 case.
  - `apps/api/test/presence-freshness.test.ts` (lines 90–105): the display cache no longer serves this door.
- [X] T013 [P] [US1] Create `apps/admin/src/features/links/useReceivables.ts`: an infinite query over `GET /payment-requests` with the Links block size (export `blockSize` from `useCustomers.ts` and reuse it with the constants from `useCustomers.ts`, `cobros-in-links D4`) and the same sentinel scroll trigger. It groups loaded pages with `groupReceivables`, which is `groupCobros` without its sort, in first-appearance order (D6). It re-reads the first block on return to the tab with the 30-second floor (FR-011, reusing `FOCUS_FLOOR_MS`), and shows no read age.
- [X] T014 [P] [US1] Create `apps/admin/src/features/links/ReceivablesList.tsx`, moving the row, expansion, `fmtDay` and `todayIn` from `apps/admin/src/features/cobros/CobrosScreen.tsx`. It keeps *Venció* / *Vence* as icon plus text, and adds each invoice's period and *saldo anterior* in the expansion (FR-006). Buttons use `useLinkAction`, one pair per customer, withheld per `roleCan` and the CLABE, as today. The count line reads "N facturas abiertas", or nothing when `total` is null (FR-007). The empty state reads "Nadie tiene facturas abiertas hoy." (replacing Cobros' "Nadie te debe hoy.": FR-007 names invoices, not debt).
- [X] T015 [US1] In `apps/admin/src/features/links/LinksScreen.tsx`, add the chip, the shadcn `Tabs` from `@/components/ui/tabs`, compact 40px, labelled *Todos* / *Por cobrar* (`cobros-in-links D14`), beside the search box, wrapping under it at 360px. *Todos* renders today's list unchanged. *Por cobrar* with no search text renders `ReceivablesList`. The chosen view is local state for now (T018 moves it to the address). The chip renders only when the session's `integrationCapabilities` includes `receivables` (T045, `cobros-in-links D13`, FR-013), so US1 never shows a chip that leads to a `409`. T038 keeps the other half: a `409` on `/payment-requests` drops `view` from the address.
- [X] T016 [P] [US1] In `apps/admin/test/msw.ts`, give `/payment-requests` a handler that answers the block contract with fixtures validated by `paymentRequestsResponse`: two blocks, one customer split across them, and a row with period and *saldo anterior*.

**Checkpoint**: US1 is complete on its own. Por cobrar lists, walks, groups and sends; the customer view is untouched.

---

## Phase 4: User Story 2 - The Cobros section folds into Links (Priority: P2)

**Goal**: the menu has no Cobros entry, and its address is gone with no redirect. The view lives in the address.

**Independent Test**:
- choose Por cobrar, go to Pagos and back, press back, then reload: it is still chosen each time;
- the menu has no Cobros.

### Tests for User Story 2

- [X] T017 [P] [US2] Component tests in `apps/admin/test/cobros-in-links.test.tsx` (cite `cobros-in-links US2`). Cover:
  - `view=receivables` in the address opens Por cobrar;
  - choosing the chip writes it into the address, keeping `q`;
  - an unknown `view` value reads as the customer view;
  - the shell renders no Cobros entry, as a `shell.test.tsx` case or here;
  - `apps/admin/test/cobros.test.tsx` is deleted with the screen; its US-R01 and link-act cases move into T007 and T025 where they still apply, each citing the case it replaces (D12, D16).

### Implementation for User Story 2

- [X] T018 [US2] In `apps/admin/src/router.tsx`:
  - `linksSearch` gains `view?: "receivables"`, and any other value drops it;
  - the `/payment-requests` route is removed, with no redirect (`cobros-in-links D12`, FR-014);
  - `LinksScreen.tsx` reads and writes `view` through the route search, replacing T015's local state.
- [X] T019 [P] [US2] Remove `{ to: "/payment-requests", label: "Cobros", … }` from `baseSections` in `apps/admin/src/features/shell/Shell.tsx`. Update the section-order comment above it (`cobros-in-links` FR-014).
- [X] T020 [US2] Key the local memory by view: in `apps/admin/src/features/links/seen.ts` and in the query keys of `useCustomers.ts` and `useReceivables.ts`, the view is part of the key, so the same text in two views is two answers (D12).
- [X] T021 [US2] Delete `apps/admin/src/features/cobros/CobrosScreen.tsx` once T014 has taken what it needs, and remove its import from `router.tsx` (`cobros-in-links D16`). Retire the Cobros cases of `apps/admin/test/presence-freshness.test.tsx` (scenario 3, and "US-P07: Cobros listens to Devolada's own pulse"). Each gets a comment saying D16 retired that promise for this screen, and FR-011 says what replaced it.

**Checkpoint**: one section. Every return to the page lands on the view the operator left.

---

## Phase 5: User Story 3 - Find one debtor from the Por cobrar view (Priority: P2)

**Goal**: a search in Por cobrar finds customers as the customer view does, panel rows only. Each result then says what the customer owes (open invoices plus carried balance), *Sin adeudo*, or that it could not confirm.

**Independent Test**: search Por cobrar for a customer who paid short: invoice closed, remainder in their balance. They appear with the remainder as what they owe, although the Por cobrar list does not contain them.

**Depends on**: T001's M2 verdict being COINCIDE or COINCIDE_Y_TRAE_ANTIGUAS (research D10).

### Tests for User Story 3

- [X] T022 [P] [US3] API tests in `apps/api/test/cobros-in-links.test.ts` for `GET /direct-payments/customers?channel=panel` (cite `cobros-in-links US3`):
  - API links are absent from the first block, from the `matched` floor and from the offline fallback;
  - without `channel`, the door answers byte for byte as today (the existing `links-customers`/`links-offline` suites stay green).
- [X] T023 [P] [US3] API tests in `apps/api/test/cobros-in-links.test.ts` for `GET /direct-payments/customers/debt` (contract `customer-debt-api.md`):
  - **the measured cycle, both halves read together:** the day before the billing run it answers `owes` 299.00 with no invoices; after the run, `owes` 798.00 with one invoice — never 1,097.00;
  - a credit is netted (`debt-truth` D12);
  - `none` only when `nothingOwedIsProven`;
  - `unconfirmed` for four cases: a stalled `/clientes/`, a stalled balance door, an unreadable body, and a vanished customer;
  - `503 INTEGRATION_AUTH_FAILED` for a refused key;
  - `409 NOT_CONFIGURED` with no integration;
  - `400` for a blank `usuario`;
  - a viewer may read it;
  - exactly two provider calls, in order: `usuario=` first, then `/clientes/{id_servicio}/saldo/`, using the fresh `id_servicio`.
- [X] T024 [P] [US3] Add `debtNone` (*Sin adeudo*, success, check icon) and `debtUnconfirmed` (*Sin confirmar*, warning, question icon) to `statuses` in `packages/ui/src/components/status-badge.tsx` (`cobros-in-links D15`). Add them to the playground showcase `packages/ui/src/playground/Showcase.tsx`, and run `node scripts/contrast-lint.mjs`.
- [X] T025 [P] [US3] Component tests in `apps/admin/test/cobros-in-links.test.tsx` (cite `cobros-in-links US3`). Cover:
  - in Por cobrar, three characters search with `channel=panel`;
  - each row first shows "Consultando adeudo" inside `<Pending>`, then the amount, *Sin adeudo* or *Sin confirmar*, never zero while waiting;
  - one slow debt answer does not hold the other rows;
  - at most four debt requests are in flight;
  - a refused key on a debt row switches the page to the Integraciones message;
  - the search replaces the list while active, and clearing it brings the list back;
  - fewer than three characters searches nothing;
  - only the latest text's answer shows;
  - the text survives leaving and returning;
  - debt is asked only for the results of loaded blocks. With one block of N results loaded, exactly N debt requests go out, and none for the next block until it loads (FR-017, SC-009);
  - with the customers door answering from its offline fallback, every result reads *Sin confirmar* (FR-010).

### Implementation for User Story 3

- [X] T026 [US3] Add `openInvoicesOf(idServicio: number): Promise<PendingInvoice[]>` in `apps/api/src/wisphub/client.ts`. It reads `/clientes/{id}/saldo/` and maps `facturas[]` (id, dates, `total` through T003's helper, `usuario` from the caller). It deliberately ignores the door's own `saldo` and `url_pago`. Its comment cites `cobros-in-links D10` with the demo measurement of 2026-09-23 and T001's pilot M2 result. An unreadable body throws `WispHubError("WISPHUB_UNAVAILABLE")`. The door also allows `PUT`, `PATCH` and `DELETE` (measured 2026-09-27). The adapter only ever sends `GET`, and the comment says so.
- [X] T027 [US3] In `apps/api/src/routes/direct-payments/schema.ts`:
  - `customersQuery` gains `channel: z.enum(["panel"]).optional()`;
  - add `customerDebtQuery` (`usuario`, trimmed, at least one character) and `customerDebtResponse`, a discriminated union on `state`: `owes` | `none` | `unconfirmed` (data-model "Customer debt").
- [X] T028 [US3] In `apps/api/src/routes/direct-payments/handler.ts`, `listCustomers` honours `channel=panel`: it skips `apiLinksOf` rows on the search, browse and offline paths, so `matched` counts panel rows only (`cobros-in-links D8`).
- [X] T029 [US3] Split along the boundary (`cobros-in-links D9`, D18):
  - **Adapter.** In `apps/api/src/wisphub/receivables.ts`, implement the `customerDebt` capability and register it in `integrations/registry.ts`:
    - one `wisphubFor` instance for one operation budget;
    - `getCustomer(usuario)` first, then `openInvoicesOf(fresh.wisphubId)`;
    - compose with `debtFor(record, { invoices, complete: true, source: "live" })` and `nothingOwedIsProven`, with no new debt arithmetic;
    - a null record, or any `WispHubError` other than `WISPHUB_AUTH_FAILED`, → `{ state: "unconfirmed" }`;
    - a refused key → `IntegrationError("INTEGRATION_AUTH_FAILED")`.
  - **Core.** Add `customerDebt` in `apps/api/src/routes/direct-payments/handler.ts`. It asks `capabilitiesOf(...).customerDebt.of(usuario)` and maps the answer. `INTEGRATION_AUTH_FAILED` → `503`, and no capability → `409 NOT_CONFIGURED`. The function calls nothing from `wisphub/`.
- [X] T030 [US3] Wire `GET /customers/debt` in `apps/api/src/routes/direct-payments/index.ts` with `requireSession`, `requireArea("payments", "read")` and `zValidator("query", customerDebtQuery)`. Register it **before** any `/customers/:…` pattern could shadow it. The router stays pure.
- [X] T031 [P] [US3] Create `apps/admin/src/features/links/useCustomerDebt.ts`: one TanStack query per row, keyed `["customer-debt", usuario]`, with a two-minute `staleTime` and a concurrency gate of four in flight (`cobros-in-links D11`). It exposes `state`, `totalCents` and `refused`.
- [X] T032 [US3] In `apps/admin/src/features/links/LinksScreen.tsx` and `useCustomers.ts`, when Por cobrar is chosen and the text has at least three characters:
  - run the customers search with `channel=panel`;
  - render each result's debt with `useCustomerDebt`: `Amount` for `owes`, `StatusBadge` `debtNone` / `debtUnconfirmed`, and "Consultando adeudo" inside `<Pending>` while waiting;
  - a `refused` answer (`INTEGRATION_AUTH_FAILED`) switches the page to the existing refused-key message, the same one `WISPHUB_AUTH_FAILED` shows today;
  - the debt renders only when the session's `integrationCapabilities` includes `customerDebt`;
  - the list (T014) hides while the search is active (FR-010).
- [X] T033 [P] [US3] In `apps/admin/test/msw.ts`, add handlers for `/direct-payments/customers/debt`, validated by `customerDebtResponse`: the short-payer `owes` 299.00, a `none`, an `unconfirmed`, and a delayed answer for the "one slow row" case.

**Checkpoint**: any debtor can be found from Por cobrar, including one the list cannot hold, and the answer is never a guessed zero.

---

## Phase 6: User Story 4 - WispHub away is never read as "nobody owes" (Priority: P3)

**Goal**: an outage reads as an outage, a refused key sends the operator to Integraciones, and a business without WispHub never sees the chip.

**Independent Test**:
- with WispHub unreachable, choose Por cobrar: the page says open invoices cannot be read and offers Reintentar;
- with a refused key: the setup message links to Integraciones;
- with no integration: there is no chip.

### Tests for User Story 4

- [X] T034 [P] [US4] API tests in `apps/api/test/cobros-in-links.test.ts` (cite `cobros-in-links US4`), all from contract `receivables-api.md`:
  - a stalled or failing first block answers `200 { results: [], nextCursor: null, total: null, integration: "unavailable" }`;
  - a later block failing answers the same, while the earlier blocks stay the client's;
  - a refused key answers `503 INTEGRATION_AUTH_FAILED`;
  - no integration answers `409 NOT_CONFIGURED`.
- [X] T035 [P] [US4] Component tests in `apps/admin/test/cobros-in-links.test.tsx` (cite `cobros-in-links US4`):
  - `unavailable` with no rows shows the could-not-read state with Reintentar, never "Nadie tiene facturas abiertas";
  - `unavailable` on a later block keeps the rows under "Sin conexión a WispHub";
  - a refused key shows the Integraciones message and no Reintentar;
  - a session without `receivables` in `integrationCapabilities` hides the chip;
  - `view=receivables` with a `409` falls back to the customer view.

### Implementation for User Story 4

- [X] T036 [US4] In `apps/api/src/routes/payment-requests/handler.ts`, map the failures as `cobros-in-links D7` says. `IntegrationError("INTEGRATION_UNAVAILABLE")` → the `unavailable` 200 answer, logged the way the current handler logs (`console.error("integration failure:", code, message)`, never the key). `INTEGRATION_AUTH_FAILED` → `503`. The adapter (T046) is where a `WispHubError` becomes one of the two.
- [X] T037 [US4] In `apps/admin/src/features/links/ReceivablesList.tsx` and `useReceivables.ts`, render three different states: *nobody* (`ok`, no rows, no cursor), *could not read* (`unavailable`, no rows, Reintentar), and *rows kept under the quiet note* (`unavailable` after rows). Reuse the refused-key rendering Links already has (`bug: links-refused-key`), shown for `INTEGRATION_AUTH_FAILED` from this door, and reuse Links' "Sin conexión a WispHub" note rather than writing that literal again: it is registered debt (`core-reads-provider-directly`), and the view adds no new provider literal (D18).
- [X] T038 [US4] In `apps/admin/src/features/links/LinksScreen.tsx`, on a `409` from `/payment-requests`, drop `view` from the address (`cobros-in-links D13`, FR-013). The chip's own rule landed in T015.

**Checkpoint**: every failure reads as what it is. There is no empty list that means "we don't know".

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T039 [P] Update `tests/e2e/stubs.ts` so the `cobros` fixture takes the block shape and is validated by `paymentRequestsResponse`, with a stub for `/direct-payments/customers/debt`. Point `tests/e2e/contrast.spec.ts`, `tests/design/review-foundations.spec.ts` and `tests/design/review-feedback.spec.ts` at `/links?view=receivables` where they opened `/payment-requests`.
- [X] T040 [P] In `tests/e2e/links.spec.ts` (cite `cobros-in-links US1`), check the chip and the Por cobrar view at 360, 768 and 1280: no horizontal scroll, 40px compact targets on desktop, a measured focus ring on the chip, and axe clean. The two new badges are also checked in both themes through `tests/e2e/contrast.spec.ts`. Also:
  - FR-003 / SC-003: pressing *Por cobrar* and not scrolling reads exactly one block. The stub counts `/payment-requests` calls, as `FR-020: the walk follows the operator` does for customers. This needs layout, so it lives here, not in the component suite (constitution IV);
  - SC-002: the first Por cobrar block is on screen within the 3 s ceiling (logged, with a generous ceiling, as `links.spec.ts` logs its SCs);
  - SC-001: from opening Links to pressing WhatsApp on a Por cobrar row, within the 10 s target (logged, 20 s ceiling).
- [X] T041 [P] Update the comment in `apps/api/src/routes/payment-requests/handler.ts` and the header comments of the Links screen to cite `cobros-in-links` D1–D18 where rules changed. Also update `CLAUDE.md`'s architecture notes where they name the Cobros section.
- [ ] T042 Run the CI order locally and fix what fails, never skipping a check:
  1. `node scripts/spec-lint.mjs`
  2. `node scripts/gen-banks.mjs --check`
  3. `node scripts/contrast-lint.mjs`
  4. `node scripts/pending-lint.mjs`
  5. `pnpm -r --if-present typecheck`
  6. `pnpm -r --if-present test`
  7. `pnpm -r --if-present build`
  8. Constitution IX: `grep -rn "wisphub/" apps/api/src/routes/payment-requests apps/api/src/integrations/capabilities.ts` finds nothing, and the new `customerDebt` handler calls nothing from `wisphub/`.
- [ ] T043 Walk quickstart §2, steps 1–7, against the local API with the demo key, and record anything that differs from the spec in `specs/014-cobros-in-links/quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T002)**: no dependencies. T001 needs the creator to run Postman.
- **Foundational (T003–T005, T044, T045)**: after T001's M3 answer; blocks every story. T044 comes before T045.
- **US1 (T006–T016, T046)**: after Foundational. This is the MVP. T008 comes before T046, and T046 before T010.
- **US2 (T017–T021)**: after US1's chip (T015) exists.
- **US3 (T022–T033)**: after Foundational and T001's M2 verdict. It needs US1's chip (T015) to have a view to search in. T022, T024, T027 and T028 do not depend on M2.
- **US4 (T034–T038)**: after US1's handler (T010) and list (T014).
- **Polish (T039–T043)**: after the stories it covers.

### User Story Dependencies

- **US1 (P1)**: stands alone after Foundational.
- **US2 (P2)**: uses US1's view; testable alone once the chip exists.
- **US3 (P2)**: uses US1's view; independent of US2 and US4.
- **US4 (P3)**: hardens US1's door and list; independent of US2 and US3.

### Within Each User Story

- Tests are written first and fail before implementation.
- Schema (the contract) comes before handler, and handler before router.
- The hook comes before the screen, and MSW fixtures before the component tests that use them.

### Parallel Opportunities

- T002 runs while the creator runs T001.
- T005 runs beside T004 once T003 lands.
- **US1:** T006 and T007 (tests), T008 then T046 (adapter), and T013, T014 and T016 (admin) touch different files.
- **US3:** T022–T025 (tests and badge), then T031 and T033, while T026–T030 land in the API.
- **Across stories:** after US1, the US2, US3 and US4 phases touch mostly different files. Watch `LinksScreen.tsx`, which T015, T018, T032 and T038 all edit. Sequence those four.

---

## Parallel Example: User Story 1

```text
T006  API tests for GET /payment-requests          apps/api/test/cobros-in-links.test.ts
T007  Component tests for the chip and list        apps/admin/test/cobros-in-links.test.tsx
T008  The inv: cursor                              apps/api/src/routes/payment-requests/cursor.ts
T013  useReceivables                               apps/admin/src/features/links/useReceivables.ts
T014  ReceivablesList                              apps/admin/src/features/links/ReceivablesList.tsx
T016  MSW fixtures                                 apps/admin/test/msw.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 (measure) and T002, then T003–T005, T044 and T045.
2. US1: T006–T016 and T046.
3. **Stop and validate**: quickstart §2 steps 1–3. Por cobrar lists, walks, groups and sends. The old Cobros section still exists beside it, which is harmless.

### Incremental Delivery

1. **US1:** Por cobrar exists inside Links.
2. **US2:** Cobros leaves the menu, and the address remembers the view. After this the panel has one section.
3. **US3:** search finds any debtor with what they owe. Ship it only after M2 held.
4. **US4:** failures read honestly. Small, but required before a pilot ISP relies on the view.

## Notes

- Every `*.test.*` file touched or created cites `cobros-in-links US<n>` (constitution VII). `spec-lint` checks it.
- No test is skipped, quarantined or deleted to get green. A test for retired behaviour (T012, T021) is rewritten or replaced, and its comment names the decision that retired the behaviour.
- The sweep, `readPendingInvoices`, the payer page and every money path are out of scope. If a task finds itself editing them, stop: that is a different feature (spec, Assumptions).
