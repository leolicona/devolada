---

description: "Task list for Cobros On-Demand Search"
---

# Tasks: Cobros On-Demand Search

**Input**: Design documents from `/specs/010-cobros-on-demand-search/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/cobros-api.md](./contracts/cobros-api.md)

**Tests**: **required**, not optional. Constitution IV fixes which layer may
answer which question, and VII requires every test file to cite its story —
here `cobros-on-demand-search US<n>`. A task's `[US<n>]` label is what the
test it lands with inherits.

**Organization**: by user story, in the priority order of the spec —
**US1 (P1), US2 (P1), US3 (P2), US4 (P3)**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on an
  incomplete task
- **[Story]**: which user story the task serves
- Every task names its file

## Path Conventions

Workspace paths as `plan.md` fixes them: `apps/api/src/…`,
`apps/admin/src/…`, `apps/api/test/…`, `apps/admin/test/…`, `tests/e2e/…`.

---

## Phase 1: Setup

**Purpose**: nothing to initialise — the workspace, the route trio and the
screen all exist. These two tasks only pin the ground the rest stands on.

- [ ] T001 Read the current behaviour into the feature's record: confirm `GET /payment-requests` still answers `{ cobros, complete, readAt }` and that `apps/admin/src/features/cobros/CobrosScreen.tsx` groups, filters and pages in the browser — noting anything that has drifted from [research.md](./research.md) in that file before editing it
- [ ] T002 [P] Confirm `@devolada/api/payment-requests-schema` is exported from `apps/api/package.json` and imported by `apps/admin/test/msw.ts`, so the contract change in Phase 2 reaches every consumer

**Checkpoint**: the starting shape is known and the contract's consumers are
listed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the contract, and the move to it **with behaviour unchanged**.
The browse still answers the whole list here — only its shape changes — so
every phase after this one ships green on its own.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

- [ ] T003 Rewrite the contract in `apps/api/src/routes/payment-requests/schema.ts`: `receipt`, `cobroRow` (`usuario`, `name`, `totalCents` nullable, `debt`, `receipts`, `oldestDue`), the request query (`q`, `limit` clamped 10–50, `cursor`, `filter`) and the response (`rows`, `nextCursor`, `total`, `matched`, `source`, `readAt` nullable, `wisphub`) exactly as [contracts/cobros-api.md](./contracts/cobros-api.md) states — removing `cobros` and `complete`, citing `cobros-on-demand-search D8` on the removal
- [ ] T004 Add `apps/api/src/routes/payment-requests/cursor.ts`: opaque encode/decode over the live path and the snapshot offset, carrying the `filter` it was made under, refusing a cursor from another walk — following `apps/api/src/routes/direct-payments/cursor.ts`, citing `cobros-on-demand-search D2`
- [ ] T005 [P] Add the grouping helper `groupReceipts` in `apps/api/src/routes/payment-requests/handler.ts`, moved from the browser's `groupCobros` — invoices to `cobroRow`s, oldest due date kept, `debt: "owed"` always, citing `cobros-on-demand-search D6`
- [ ] T006 Move `apps/api/src/routes/payment-requests/handler.ts` to the new response, behaviour unchanged: still one whole-list read through `readPendingInvoices`, now grouped by T005, `nextCursor: null`, `total` from the read, `source` and `readAt` from it, `complete` gone
- [ ] T007 Keep the router pure in `apps/api/src/routes/payment-requests/index.ts`: add `zValidator("query", …)` with the project's `invalid` handler and nothing else — no logic (constitution III)
- [ ] T008 Move `apps/admin/src/features/cobros/CobrosScreen.tsx` onto the new shape with its behaviour unchanged: render `rows` instead of grouping locally, drop the "la lista puede estar incompleta" warning with `complete` (FR-016), keep the tabs, the local search and "Mostrar más" exactly as they are for now
- [ ] T009 [P] Update `apps/admin/test/msw.ts` and the Cobros fixtures in `apps/admin/test/cobros.test.tsx` to the new envelope, and the Playwright stub in `tests/e2e/` that answers this route — all validated by the zod schema (constitution III)
- [ ] T010 Extend `apps/api/test/` with the contract's refusals in a new `apps/api/test/cobros-search.test.ts`: `q` under three characters, `q` with `cursor`, an unreadable cursor and a bad `filter` each answer `VALIDATION_ERROR`; a non-business actor answers `AUTHENTICATION_ERROR`; no integration answers `NOT_CONFIGURED`

**Checkpoint**: same screen, same behaviour, new contract. `pnpm -r test`
and `pnpm -r typecheck` are green, and the incompleteness warning is gone.

---

## Phase 3: User Story 1 — Any debtor can be found (Priority: P1) 🎯 MVP

**Goal**: the search box stops filtering the rows on screen and asks the
provider, so any customer who owes money is findable — including the one
whose debt lives only in `saldo`, whom Cobros cannot show today.

**Independent Test**: register a payment smaller than a customer's invoice,
watch them disappear from the list, then find them by name with the
remaining amount. The list below keeps working as it does today.

### Tests for User Story 1

- [ ] T011 [P] [US1] In `apps/api/test/cobros-search.test.ts`, prove the `saldo`-only debtor: `fetchMock` answers `/clientes/?…__contains=…` with a customer carrying `saldo: "60.00"` and `estado_facturas: "Pagadas"`, and the pending list without them — the row comes back `debt: "owed"`, `totalCents: 6000`, `receipts: []`
- [ ] T012 [P] [US1] In the same file, prove the three debt states: owed, `"none"` when `nothingOwedIsProven` holds, `"unknown"` with `totalCents: null` when it does not
- [ ] T013 [P] [US1] In the same file, prove the search shape: four `__contains` filters asked at once, results merged and deduped by usuario, capped at `limit`, `matched` the largest of the four counts, a customer with no usuario dropped
- [ ] T014 [P] [US1] In `apps/admin/test/cobros.test.tsx`, prove the screen: under three characters says so and asks nothing; results replace the list; the three debt states render as icon + text with no amount on `"unknown"`; "más de N" asks for more characters; a viewer and a business with no CLABE see results with the actions withheld; `axe` on the rendered screen

### Implementation for User Story 1

- [ ] T015 [US1] Add the search branch to `apps/api/src/routes/payment-requests/handler.ts`: `wisphub.searchCustomers(q, limit)` unchanged from `009 D4`, then `debtFor` over `readPendingInvoices` per match, citing `cobros-on-demand-search D4, D5`
- [ ] T016 [US1] Map each match to a `cobroRow` in the same handler: `debt` from `nothingOwedIsProven`, `totalCents` null on `"unknown"`, `receipts` from that customer's pending invoices, `matched` as a floor (`D4`), `nextCursor: null` — a search answers one block
- [ ] T017 [P] [US1] Add `apps/admin/src/features/cobros/useCobros.ts`, mirroring `apps/admin/src/features/links/useCustomers.ts`: the 300 ms debounce, the three-character floor, the query key carrying the settled text so a late answer lands under its own key (FR-011)
- [ ] T018 [US1] Wire `CobrosScreen.tsx` to `useCobros`: the search box drives the query instead of filtering rows, results replace the list while active, and the tabs and totals are hidden while a search is showing — they describe the list, not the search (`D6`)
- [ ] T019 [US1] Render the three debt states in `CobrosScreen.tsx` through `StatusBadge`, icon + text, tokens only (constitution VI) — *Sin adeudo* and *No pudimos confirmar* are es-MX product copy, and neither is colour alone

**Checkpoint**: US1 ships on its own. Any debtor is findable; the list below
is untouched.

---

## Phase 4: User Story 2 — The page asks for what it shows (Priority: P1)

**Goal**: the list arrives in blocks, one read each, the next only when the
operator scrolls toward it — and the tabs are the provider's answer, not a
filter over what loaded.

**Independent Test**: open Cobros on the largest connected ISP with the
network panel showing — one request, more on scroll, none when still.

### Tests for User Story 2

- [ ] T020 [P] [US2] In `apps/api/test/cobros-search.test.ts`, prove the live block walk: one provider call per block, `nextCursor` continuing from WispHub's own `next`, `nextCursor: null` at the end, `total` from the provider's `count` and absent — not guessed — when the provider answers none (`D8`)
- [ ] T021 [P] [US2] In the same file, prove the snapshot block: a tenant with a finished pass serves blocks with **no** provider call, invoices Devolada already registered are subtracted, and `source: "snapshot"` carries the pass's `readAt` (`D3`, `D12`)
- [ ] T022 [P] [US2] In the same file, prove the filters: every block of `overdue` and of `upcoming` carries an explicit window on every request — never the provider's current-month default (`D7`) — a receipt with no due date appears under `all` and in neither, and a cursor from another filter is refused (FR-015)
- [ ] T023 [P] [US2] In `apps/admin/test/cobros.test.tsx`, prove the screen: the first block renders and nothing more is read; a customer answered in two blocks renders once (FR-018); switching tabs drops the loaded blocks and starts that tab's own walk; the end of the walk says how many receipts the ISP has; overdue is decided in the business timezone, not the browser's (FR-025)

### Implementation for User Story 2

- [ ] T024 [US2] Add the block walk to `apps/api/src/wisphub/client.ts`: one page of the pending list from a given path, reading `count` defensively, plus the per-filter window builder (`tipo_fecha` with an always-explicit `desde`/`hasta`), citing `cobros-on-demand-search D2, D7, D8`
- [ ] T025 [US2] Add the snapshot block to `apps/api/src/wisphub/snapshot.ts`: one block cut from the served pass by offset, keeping the merge of served and in-flight passes and the subtraction of registered invoices where they already live, citing `cobros-on-demand-search D3`
- [ ] T026 [US2] Add the browse branch to `apps/api/src/routes/payment-requests/handler.ts`: cursor in, one block out, `nextCursor` encoded by `cursor.ts`, `source` and `readAt` from whichever read answered
- [ ] T027 [US2] Add the infinite scroll to `apps/admin/src/features/cobros/useCobros.ts`: `useInfiniteQuery` on the cursor, an `IntersectionObserver` sentinel with the same `rootMargin` Links uses, the block size measured from the viewport and clamped by the server (`009 D3`)
- [ ] T028 [US2] Make the tabs a provider walk in `CobrosScreen.tsx`: the chosen filter rides the request, changing it resets the walk, and the page says what a tab answers rather than implying the three add up (FR-014)
- [ ] T029 [US2] Remove the browser-side paging from `CobrosScreen.tsx` — "Mostrar más" and the local `PAGE` slice go with the scroll that replaces them

**Checkpoint**: the whole list no longer travels. US1 and US2 both work.

---

## Phase 5: User Story 3 — The search survives leaving the page (Priority: P2)

**Goal**: the text and its results come back after navigating away, the back
button and a reload; a search has an address.

**Independent Test**: search, leave, come back, press back, reload, paste
the address in another tab — the same text and results each time, with no
second visible wait inside two minutes.

### Tests for User Story 3

- [ ] T030 [P] [US3] In `apps/admin/test/cobros.test.tsx`, prove the memory: a remount inside two minutes renders the stored first block with no fetch; past two minutes it asks again; clearing the box returns to the browse list; `localStorage`/`sessionStorage` is reset between tests (constitution IV)
- [ ] T031 [P] [US3] In `apps/admin/test/links.test.tsx`, prove Links still behaves exactly as before the shared module moved underneath it — the regression T032 risks

### Implementation for User Story 3

- [ ] T032 [US3] Lift `readResults` / `writeResults` out of `apps/admin/src/features/links/seen.ts` into `apps/admin/src/lib/search-memory.ts`, keyed by page, and point Links at it unchanged — the recently-seen cache and the copied/sent marks stay where they are (`D10`)
- [ ] T033 [US3] Carry the search in the URL: `?q=` on the Cobros route in `apps/admin/src/router.tsx` and `CobrosScreen.tsx`, so the address opens on that search (FR-012)
- [ ] T034 [US3] Seed `useCobros` from `search-memory.ts` with the age it really has, so a recent search renders at once and a stale one is a normal fetch (FR-013)

**Checkpoint**: the search is durable across navigation, reload and a pasted
address.

---

## Phase 6: User Story 4 — Cobros keeps working when WispHub does not (Priority: P3)

**Goal**: rows stay under the quiet note; a search says it needs WispHub and
never answers an empty list; a refused key keeps its own door.

**Independent Test**: with the provider unreachable, confirm all three, and
that no error block replaces rows that are already on screen.

### Tests for User Story 4

- [ ] T035 [P] [US4] In `apps/api/test/cobros-search.test.ts`, prove the asymmetry of `D9`: a search with the provider away answers `WISPHUB_UNAVAILABLE` and **never** an empty `rows` — while a browse block failure keeps its own mapping; `WISPHUB_AUTH_FAILED` stays a separate code
- [ ] T036 [P] [US4] In `apps/admin/test/cobros.test.tsx`, prove the screen: loaded blocks stay under *Sin conexión a WispHub* with no error block; a search under the outage says it needs WispHub and renders no empty state; a refused key routes to Integraciones with no Reintentar; no integration keeps today's door

### Implementation for User Story 4

- [ ] T037 [US4] Map the provider's absence in `apps/api/src/routes/payment-requests/handler.ts`: search and browse mapped separately per `D9`, with the existing `wisphubFailure` mapping and the log line that `bug: cobros-installation-fallback` added
- [ ] T038 [US4] Render the three states in `CobrosScreen.tsx`: the quiet note over kept rows, the "the search needs WispHub" state, and the unchanged setup doors — never an empty result under a note

**Checkpoint**: all four stories work, and the screen never reads as "nobody
owes" when it simply could not ask.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T039 [P] Extend `tests/e2e/cobros.spec.ts` with what only the browser can answer (constitution IV): the real scroll bringing the next block, contrast in both themes, touch-target size, a measured focus indicator on the search box, and no horizontal scroll at 360/768/1280
- [ ] T040 [P] Cite every decision in the code touched: `cobros-on-demand-search D<n>` against [research.md](./research.md), with `measured <date>` where a reason was measured (constitution I)
- [ ] T041 Register the debt `D3` names — serving a snapshot block straight out of `wisphub_pages` instead of assembling the pass first — with `/speckit-debt-log`, including what it costs while unpaid
- [ ] T042 Run the CI order locally and fix what it finds: `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`
- [ ] T043 Walk [quickstart.md](./quickstart.md) against the deployed dev API — local workerd cannot reach `api.wisphub.net` (measured 2026-08-14) — and confirm SC-008 by hand: a session of searching and scrolling creates no payment link

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** → no dependencies.
- **Foundational (Phase 2)** → after Setup. **Blocks every story.** It is
  the contract plus the move onto it with behaviour unchanged, so the tree
  is green before any story starts.
- **US1 (Phase 3)** → after Foundational. Independent of US2–US4.
- **US2 (Phase 4)** → after Foundational. Independent of US1: one is the
  search, the other is the list.
- **US3 (Phase 5)** → after US1 — there must be a search to remember.
- **US4 (Phase 6)** → after US1 and US2: it is how both behave under
  failure.
- **Polish (Phase 7)** → after the stories it covers.

### Within a story

Tests first and failing, then the contract's server side, then the hook,
then the screen. The API layer proves the shape and the provider's
behaviour; the component layer proves the screen; the browser layer proves
only what needs layout.

### Parallel opportunities

- T011–T014 (US1 tests), T020–T023 (US2 tests), T030–T031, T035–T036 — all
  different files.
- T015/T016 (API) and T017 (the hook) can proceed together once T003–T004
  land; T018/T019 wait on both.
- T024 and T025 are different files and can run together; T026 waits on
  both.
- US1 and US2 can be built by two people in parallel after Phase 2.

---

## Implementation Strategy

### MVP — US1 only

1. Phase 1, then Phase 2 in full (the contract; the tree stays green).
2. Phase 3.
3. **Stop and validate**: run the `saldo`-only walk in
   [quickstart.md](./quickstart.md). A debtor Cobros could not show is on
   the screen with the right amount.
4. Shippable: the list below still behaves exactly as it does today.

### Incremental delivery

1. Phase 2 → same screen, new contract, warning gone.
2. + US1 → any debtor findable. **MVP.**
3. + US2 → the whole list stops travelling; the tabs become true.
4. + US3 → the search survives leaving the page.
5. + US4 → the failure behaviour of both halves.
6. + Phase 7 → the browser layer, the citations, the debt entry, CI.

---

## Notes

- `[P]` means a different file and no dependency on an incomplete task.
- Every test file cites `cobros-on-demand-search US<n>` (constitution VII);
  a task's `[US<n>]` label is what it inherits.
- A test starts from empty: module caches reset `beforeEach`, MSW handlers
  `afterEach`, storage where a screen remembers (constitution IV).
- Nothing in this feature writes to D1, and nothing edits `debt.ts`,
  `cache.ts`, the sweep's pass or a money path (`D13`). A diff that touches
  one of them has left the feature.
- Commit per task or per logical group; stop at any checkpoint to validate
  a story on its own.
