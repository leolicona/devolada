---

description: "Task list for Cobros in Links"
---

# Tasks: Cobros in Links

**Input**: Design documents from `specs/012-cobros-in-links/`

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

- [ ] T001 *(partly done 2026-09-27: F, M1, M3 settled, and M2 case (a) COINCIDE, on the demo; cases (b) and (c) still open. See research.md, "Measurements recorded".)* Run the collection *"WispHub · Mediciones para Por cobrar"* on the demo, then on the pilot (quickstart §0: F, M1, M2, M3). Record each answer, with its date, under the decision it settles in `specs/012-cobros-in-links/research.md`:
  - **M1 → D2:** `next` pages by `offset` or by `page`, and `count` is present or absent;
  - **M3 → D5:** the JSON types of `saldo` and `sub_total`, and the period text;
  - **M2 → D10:** COINCIDE, COINCIDE_Y_TRAE_ANTIGUAS, or a mismatch;
  - **F:** whether any `/clientes/` filter narrows by debt.

  If M2 reports FALTAN_FACTURAS or SOBRAN_FACTURAS, or if F finds a working filter, stop and take it to the creator before T026.
- [ ] T002 [P] Check the list of consumers of `GET /payment-requests` and its `cobros` fixture against the tree, and note any drift at the top of this file before editing:
  - `apps/api/package.json` (the `./payment-requests-schema` export);
  - `apps/api/test/{payment-requests,pending-invoice-cap,presence-freshness}.test.ts`;
  - `apps/admin/src/{router.tsx,features/shell/Shell.tsx,features/cobros/CobrosScreen.tsx}`;
  - `apps/admin/test/{msw.ts,cobros.test.tsx,presence-freshness.test.tsx}`;
  - `tests/e2e/{stubs.ts,contrast.spec.ts}`;
  - `tests/design/{review-foundations,review-feedback}.spec.ts`.

---

## Phase 2: Foundational

**Purpose**: the adapter's reading of an invoice row. US1 draws it and US4
tells an outage from an empty list with it.

**⚠️ CRITICAL**: no user story work begins until this phase is done.

- [ ] T003 Add a money helper to `apps/api/src/wisphub/money.ts` that accepts a provider amount as either a string or a JSON number and always converts through `decimalToCents` (numbers via `amountToCents`). Unreadable input returns `null` rather than throwing. Cite `cobros-in-links D5` and the M3 result from T001.
- [ ] T004 In `apps/api/src/wisphub/client.ts`, give `PendingInvoice` three optional fields: `periodCents` (from `sub_total`), `carriedCents` (from the invoice's `saldo`) and `period` (the first `articulos[].descripcion` match of `Periodo del … al …`). Map them in `pendingInvoicesPage` with T003's helper. `pendingInvoicesPage` also returns the envelope's `count` as `total: number | null`, read defensively. A row whose new fields cannot be read keeps its `totalCents`. `debtOf`, the sweep and the money paths read nothing new (`cobros-in-links D5`).
- [ ] T005 [P] Add API tests to `apps/api/test/cobros-in-links.test.ts`, citing `cobros-in-links US1`, for T003 and T004. They use the measured demo row: `sub_total` 499, `saldo` 299, `total` 798, and the line "Periodo del 15/Sept./2026 al 15/Oct./2026". Cover:
  - both money shapes, string and number;
  - an absent `count`, which gives `null`;
  - a row with no period line, which gives `period: null`;
  - `debtOf` over the same list unchanged, byte for byte.

**Checkpoint**: the adapter reads everything the Por cobrar row shows, and nothing on the money path moved.

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

- [ ] T006 [P] [US1] API tests in `apps/api/test/cobros-in-links.test.ts` for `GET /payment-requests` (contract `receivables-api.md`), with WispHub at its origin through `fetchMock`. Cover:
  - the first block carries an explicit window: 180 days back, one day ahead (FR-004);
  - `limit` is clamped to 10–50;
  - `nextCursor` walks the provider's own `next`, and the window stays fixed across blocks even when the clock crosses midnight between them;
  - a cursor holding a provider path, a foreign prefix or `desde > hasta` gets `400 VALIDATION_ERROR`;
  - `total` comes from `count`;
  - rows keep the provider's order;
  - SC-006: with a seeded `wisphubPages` snapshot whose rows differ, the door returns the live rows and makes exactly one provider call.
- [ ] T007 [P] [US1] Component tests in `apps/admin/test/cobros-in-links.test.tsx` (MSW, axe, cites `cobros-in-links US1`). Cover:
  - Links opens on *Todos*, exactly as today;
  - pressing *Por cobrar* shows the first block;
  - a second block's invoice for a customer already on screen grows that row's total and count, and moves it nowhere;
  - *Venció* is judged by the business's timezone, not the browser's;
  - a row opens to its invoices, with period and *saldo anterior*;
  - Copiar and WhatsApp go through `POST /direct-payments/links` (FR-008);
  - a viewer sees no buttons;
  - an ISP with no open invoice gets "Nadie tiene facturas abiertas hoy", with no warning.

### Implementation for User Story 1

- [ ] T008 [P] [US1] Create `apps/api/src/routes/payment-requests/cursor.ts` for the opaque `inv:` cursor (`cobros-in-links D2`, data-model "Receivables cursor").
  - Encode `desde`, `hasta` and the numbers parsed from the provider's `next`: `offset`/`limit`, or `page`, per T001.
  - Decode to either a value or `null`.
  - Never carry or accept a path.
  - Mirror `routes/direct-payments/cursor.ts` in form.
- [ ] T009 [US1] Rewrite `apps/api/src/routes/payment-requests/schema.ts` to the block contract: `receivablesQuery` (`limit`, `cursor`) and `paymentRequestsResponse` = `{ results: CobroRow[], nextCursor, total, wisphub: "ok" | "unavailable" }`, where `CobroRow` gains `periodCents`, `carriedCents` and `period`. Remove `complete` and `readAt`, with a comment citing `cobros-in-links D1` and D16.
- [ ] T010 [US1] Rewrite `apps/api/src/routes/payment-requests/handler.ts` to make one `pendingInvoicesPage` call per request, on a fresh `wisphubFor` instance. The path is built from the fixed filter plus the cursor's numbers, or today's window on the first block. It reads no `readPendingInvoices`, no snapshot and no display cache (`cobros-in-links D3`). It maps rows and `total`, and encodes `nextCursor` from the provider's `next`. Keep `403` for a non-business actor and `409 NOT_CONFIGURED` without a key.
- [ ] T011 [US1] Wire `zValidator("query", receivablesQuery)` in `apps/api/src/routes/payment-requests/index.ts`, keeping `requireSession` and no `requireArea` (`cobros-live` D4). The router stays pure.
- [ ] T012 [US1] Retire `/payment-requests`' old behaviour in the API suites, and say why in each test's comment (`cobros-in-links D3`, D16). Do not delete the snapshot's own coverage.
  - `apps/api/test/payment-requests.test.ts`: rewrite for the block contract.
  - `apps/api/test/pending-invoice-cap.test.ts` (around lines 279–284 and 366–367): the snapshot still feeds the money paths, so re-point those assertions at a money-path reader, or at T006's SC-006 case.
  - `apps/api/test/presence-freshness.test.ts` (lines 90–105): the display cache no longer serves this door.
- [ ] T013 [P] [US1] Create `apps/admin/src/features/links/useReceivables.ts`: an infinite query over `GET /payment-requests` with the Links block size (reuse `blockSize` and the constants from `useCustomers.ts`, `cobros-in-links D4`) and the same sentinel scroll trigger. It groups loaded pages with `groupReceivables`, which is `groupCobros` without its sort, in first-appearance order (D6). It re-reads the first block on return to the tab with the 30-second floor (FR-011, reusing `FOCUS_FLOOR_MS`), and shows no read age.
- [ ] T014 [P] [US1] Create `apps/admin/src/features/links/ReceivablesList.tsx`, moving the row, expansion, `fmtDay` and `todayIn` from `apps/admin/src/features/cobros/CobrosScreen.tsx`. It keeps *Venció* / *Vence* as icon plus text, and adds each invoice's period and *saldo anterior* in the expansion (FR-006). Buttons use `useLinkAction`, one pair per customer, withheld per `roleCan` and the CLABE, as today. The count line reads "N facturas abiertas", or nothing when `total` is null (FR-007).
- [ ] T015 [US1] In `apps/admin/src/features/links/LinksScreen.tsx`, add the chip, the shadcn `Tabs` from `@/components/ui/tabs`, compact 40px, labelled *Todos* / *Por cobrar* (`cobros-in-links D14`), beside the search box, wrapping under it at 360px. *Todos* renders today's list unchanged. *Por cobrar* with no search text renders `ReceivablesList`. The chosen view is local state for now (T018 moves it to the address).
- [ ] T016 [P] [US1] In `apps/admin/test/msw.ts`, give `/payment-requests` a handler that answers the block contract with fixtures validated by `paymentRequestsResponse`: two blocks, one customer split across them, and a row with period and *saldo anterior*.

**Checkpoint**: US1 is complete on its own. Por cobrar lists, walks, groups and sends; the customer view is untouched.

---

## Phase 4: User Story 2 - The Cobros section folds into Links (Priority: P2)

**Goal**: the menu has no Cobros entry. The view lives in the address; the old address lands on Links with Por cobrar chosen.

**Independent Test**:
- open `/payment-requests`: you land on `/links?view=receivables`;
- choose Por cobrar, go to Pagos and back, press back, then reload: it is still chosen each time;
- the menu has no Cobros.

### Tests for User Story 2

- [ ] T017 [P] [US2] Component tests in `apps/admin/test/cobros-in-links.test.tsx` (cite `cobros-in-links US2`). Cover:
  - `view=receivables` in the address opens Por cobrar;
  - choosing the chip writes it into the address, keeping `q`;
  - an unknown `view` value reads as the customer view;
  - `/payment-requests` redirects with any `q` kept;
  - the shell renders no Cobros entry, as a `shell.test.tsx` case or here;
  - `apps/admin/test/cobros.test.tsx` shrinks to the redirect, and its US-R01 and link-act cases move into T007 and T025 where they still apply.

### Implementation for User Story 2

- [ ] T018 [US2] In `apps/admin/src/router.tsx`:
  - `linksSearch` gains `view?: "receivables"`, and any other value drops it;
  - the `/payment-requests` route renders a `<Navigate to="/links" search={{ view: "receivables", q }} />` instead of `CobrosScreen` (`cobros-in-links D12`, FR-014);
  - `LinksScreen.tsx` reads and writes `view` through the route search, replacing T015's local state.
- [ ] T019 [P] [US2] Remove `{ to: "/payment-requests", label: "Cobros", … }` from `baseSections` in `apps/admin/src/features/shell/Shell.tsx`. Update the section-order comment above it (`cobros-in-links` FR-014).
- [ ] T020 [US2] Key the local memory by view: in `apps/admin/src/features/links/seen.ts` and in the query keys of `useCustomers.ts` and `useReceivables.ts`, the view is part of the key, so the same text in two views is two answers (D12).
- [ ] T021 [US2] Delete `apps/admin/src/features/cobros/CobrosScreen.tsx` once T014 has taken what it needs, and remove its import from `router.tsx` (`cobros-in-links D16`). Retire the Cobros cases of `apps/admin/test/presence-freshness.test.tsx` (scenario 3, and "US-P07: Cobros listens to Devolada's own pulse"). Each gets a comment saying D16 retired that promise for this screen, and FR-011 says what replaced it.

**Checkpoint**: one section. The old address and every return to the page land on the view the operator left.

---

## Phase 5: User Story 3 - Find one debtor from the Por cobrar view (Priority: P2)

**Goal**: a search in Por cobrar finds customers as the customer view does, panel rows only. Each result then says what the customer owes (open invoices plus carried balance), *Sin adeudo*, or that it could not confirm.

**Independent Test**: search Por cobrar for a customer who paid short: invoice closed, remainder in their balance. They appear with the remainder as what they owe, although the Por cobrar list does not contain them.

**Depends on**: T001's M2 verdict being COINCIDE or COINCIDE_Y_TRAE_ANTIGUAS (research D10).

### Tests for User Story 3

- [ ] T022 [P] [US3] API tests in `apps/api/test/cobros-in-links.test.ts` for `GET /direct-payments/customers?channel=panel` (cite `cobros-in-links US3`):
  - API links are absent from the first block, from the `matched` floor and from the offline fallback;
  - without `channel`, the door answers byte for byte as today (the existing `links-customers`/`links-offline` suites stay green).
- [ ] T023 [P] [US3] API tests in `apps/api/test/cobros-in-links.test.ts` for `GET /direct-payments/customers/debt` (contract `customer-debt-api.md`):
  - **the measured cycle, both halves read together:** the day before the billing run it answers `owes` 299.00 with no invoices; after the run, `owes` 798.00 with one invoice — never 1,097.00;
  - a credit is netted (`debt-truth` D12);
  - `none` only when `nothingOwedIsProven`;
  - `unconfirmed` for four cases: a stalled `/clientes/`, a stalled balance door, an unreadable body, and a vanished customer;
  - `503 WISPHUB_AUTH_FAILED` for a refused key;
  - `400` for a blank `usuario`;
  - a viewer may read it;
  - exactly two provider calls, in order: `usuario=` first, then `/clientes/{id_servicio}/saldo/`, using the fresh `id_servicio`.
- [ ] T024 [P] [US3] Add `debtNone` (*Sin adeudo*, success, check icon) and `debtUnconfirmed` (*Sin confirmar*, warning, question icon) to `statuses` in `packages/ui/src/components/status-badge.tsx` (`cobros-in-links D15`). Add them to the playground showcase `packages/ui/src/playground/Showcase.tsx`, and run `node scripts/contrast-lint.mjs`.
- [ ] T025 [P] [US3] Component tests in `apps/admin/test/cobros-in-links.test.tsx` (cite `cobros-in-links US3`). Cover:
  - in Por cobrar, three characters search with `channel=panel`;
  - each row first shows "Consultando adeudo" inside `<Pending>`, then the amount, *Sin adeudo* or *Sin confirmar*, never zero while waiting;
  - one slow debt answer does not hold the other rows;
  - at most four debt requests are in flight;
  - a refused key on a debt row switches the page to the Integraciones message;
  - the search replaces the list while active, and clearing it brings the list back;
  - fewer than three characters searches nothing;
  - only the latest text's answer shows;
  - the text survives leaving and returning.

### Implementation for User Story 3

- [ ] T026 [US3] Add `openInvoicesOf(idServicio: number): Promise<PendingInvoice[]>` in `apps/api/src/wisphub/client.ts`. It reads `/clientes/{id}/saldo/` and maps `facturas[]` (id, dates, `total` through T003's helper, `usuario` from the caller). It deliberately ignores the door's own `saldo` and `url_pago`. Its comment cites `cobros-in-links D10` with the demo measurement of 2026-09-23 and T001's pilot M2 result. An unreadable body throws `WispHubError("WISPHUB_UNAVAILABLE")`.
- [ ] T027 [US3] In `apps/api/src/routes/direct-payments/schema.ts`:
  - `customersQuery` gains `channel: z.enum(["panel"]).optional()`;
  - add `customerDebtQuery` (`usuario`, trimmed, at least one character) and `customerDebtResponse`, a discriminated union on `state`: `owes` | `none` | `unconfirmed` (data-model "Customer debt").
- [ ] T028 [US3] In `apps/api/src/routes/direct-payments/handler.ts`, `listCustomers` honours `channel=panel`: it skips `apiLinksOf` rows on the search, browse and offline paths, so `matched` counts panel rows only (`cobros-in-links D8`).
- [ ] T029 [US3] Add `customerDebt` in `apps/api/src/routes/direct-payments/handler.ts`, following `cobros-in-links D9`:
  - one `wisphubFor` instance for one operation budget;
  - `getCustomer(usuario)` first, then `openInvoicesOf(fresh.wisphubId)`;
  - compose with `debtFor(record, { invoices, complete: true, source: "live" })` and `nothingOwedIsProven`, with no new debt arithmetic;
  - any `WispHubError` other than `WISPHUB_AUTH_FAILED` → `{ state: "unconfirmed" }`, and a refused key → `wisphubFailure(c, e, "panel")`;
  - a null record → `unconfirmed`.
- [ ] T030 [US3] Wire `GET /customers/debt` in `apps/api/src/routes/direct-payments/index.ts` with `requireSession`, `requireArea("payments", "read")` and `zValidator("query", customerDebtQuery)`. Register it **before** any `/customers/:…` pattern could shadow it. The router stays pure.
- [ ] T031 [P] [US3] Create `apps/admin/src/features/links/useCustomerDebt.ts`: one TanStack query per row, keyed `["customer-debt", usuario]`, with a two-minute `staleTime` and a concurrency gate of four in flight (`cobros-in-links D11`). It exposes `state`, `totalCents` and `refused`.
- [ ] T032 [US3] In `apps/admin/src/features/links/LinksScreen.tsx` and `useCustomers.ts`, when Por cobrar is chosen and the text has at least three characters:
  - run the customers search with `channel=panel`;
  - render each result's debt with `useCustomerDebt`: `Amount` for `owes`, `StatusBadge` `debtNone` / `debtUnconfirmed`, and "Consultando adeudo" inside `<Pending>` while waiting;
  - a `refused` answer switches the page to the existing refused-key message;
  - the list (T014) hides while the search is active (FR-010).
- [ ] T033 [P] [US3] In `apps/admin/test/msw.ts`, add handlers for `/direct-payments/customers/debt`, validated by `customerDebtResponse`: the short-payer `owes` 299.00, a `none`, an `unconfirmed`, and a delayed answer for the "one slow row" case.

**Checkpoint**: any debtor can be found from Por cobrar, including one the list cannot hold, and the answer is never a guessed zero.

---

## Phase 6: User Story 4 - WispHub away is never read as "nobody owes" (Priority: P3)

**Goal**: an outage reads as an outage, a refused key sends the operator to Integraciones, and a business without WispHub never sees the chip.

**Independent Test**:
- with WispHub unreachable, choose Por cobrar: the page says open invoices cannot be read and offers Reintentar;
- with a refused key: the setup message links to Integraciones;
- with no integration: there is no chip.

### Tests for User Story 4

- [ ] T034 [P] [US4] API tests in `apps/api/test/cobros-in-links.test.ts` (cite `cobros-in-links US4`), all from contract `receivables-api.md`:
  - a stalled or failing first block answers `200 { results: [], nextCursor: null, total: null, wisphub: "unavailable" }`;
  - a later block failing answers the same, while the earlier blocks stay the client's;
  - a refused key answers `503 WISPHUB_AUTH_FAILED`;
  - no integration answers `409 NOT_CONFIGURED`.
- [ ] T035 [P] [US4] Component tests in `apps/admin/test/cobros-in-links.test.tsx` (cite `cobros-in-links US4`):
  - `unavailable` with no rows shows the could-not-read state with Reintentar, never "Nadie tiene facturas abiertas";
  - `unavailable` on a later block keeps the rows under "Sin conexión a WispHub";
  - a refused key shows the Integraciones message and no Reintentar;
  - a customers answer of `not_configured` hides the chip;
  - `view=receivables` with a `409` falls back to the customer view.

### Implementation for User Story 4

- [ ] T036 [US4] In `apps/api/src/routes/payment-requests/handler.ts`, map the failures as `cobros-in-links D7` says. A `WispHubError` other than `WISPHUB_AUTH_FAILED` → the `unavailable` 200 answer, logged the way the current handler logs (`console.error("wisphub failure:", code, message)`, never the key). A refused key → `503`.
- [ ] T037 [US4] In `apps/admin/src/features/links/ReceivablesList.tsx` and `useReceivables.ts`, render three different states: *nobody* (`ok`, no rows, no cursor), *could not read* (`unavailable`, no rows, Reintentar), and *rows kept under the quiet note* (`unavailable` after rows). Reuse the refused-key rendering Links already has (`bug: links-refused-key`).
- [ ] T038 [US4] In `apps/admin/src/features/links/LinksScreen.tsx`, render the chip only when the customers answer is not `not_configured`. On a `409` from `/payment-requests`, drop `view` from the address (`cobros-in-links D13`, FR-013).

**Checkpoint**: every failure reads as what it is. There is no empty list that means "we don't know".

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T039 [P] Update `tests/e2e/stubs.ts` so the `cobros` fixture takes the block shape and is validated by `paymentRequestsResponse`, with a stub for `/direct-payments/customers/debt`. Point `tests/e2e/contrast.spec.ts`, `tests/design/review-foundations.spec.ts` and `tests/design/review-feedback.spec.ts` at `/links?view=receivables` where they opened `/payment-requests`.
- [ ] T040 [P] In `tests/e2e/links.spec.ts` (cite `cobros-in-links US1`), check the chip and the Por cobrar view at 360, 768 and 1280: no horizontal scroll, 40px compact targets on desktop, a measured focus ring on the chip, and axe clean. The two new badges are also checked in both themes through `tests/e2e/contrast.spec.ts`.
- [ ] T041 [P] Update the comment in `apps/api/src/routes/payment-requests/handler.ts` and the header comments of the Links screen to cite `cobros-in-links` D1–D17 where rules changed. Also update `CLAUDE.md`'s architecture notes where they name the Cobros section.
- [ ] T042 Run the CI order locally and fix what fails, never skipping a check:
  1. `node scripts/spec-lint.mjs`
  2. `node scripts/gen-banks.mjs --check`
  3. `node scripts/contrast-lint.mjs`
  4. `node scripts/pending-lint.mjs`
  5. `pnpm -r --if-present typecheck`
  6. `pnpm -r --if-present test`
  7. `pnpm -r --if-present build`
- [ ] T043 Walk quickstart §2, steps 1–7, against the local API with the demo key, and record anything that differs from the spec in `specs/012-cobros-in-links/quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T002)**: no dependencies. T001 needs the creator to run Postman.
- **Foundational (T003–T005)**: after T001's M3 answer; blocks every story.
- **US1 (T006–T016)**: after Foundational. This is the MVP.
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
- **US1:** T006 and T007 (tests), T008 (cursor), and T013, T014 and T016 (admin) touch different files.
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

1. T001 (measure) and T002, then T003–T005.
2. US1: T006–T016.
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
