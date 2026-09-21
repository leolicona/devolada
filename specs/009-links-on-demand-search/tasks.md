---

description: "Task list for Links On-Demand Search"
---

# Tasks: Links On-Demand Search

**Input**: Design documents from `/specs/009-links-on-demand-search/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/links-api.md](./contracts/links-api.md)

**Tests**: required, not optional. Constitution IV fixes the layer each question
is answered at; constitution VII requires every test file to cite its story as
`links-on-demand-search US<n>`.

**Organization**: grouped by user story. Two stories are P1 — US1 and US4 — and
they ship together with the prune (plan, *Dependencies and sequencing*).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished work)
- **[Story]**: US1–US4 from spec.md
- Every task names its file

## Path Conventions

Workspace paths as the plan's source tree lists them: `apps/api/src/`,
`apps/api/test/`, `apps/admin/src/features/`, `tests/e2e/`, `tests/design/`.

---

## Phase 1: Setup

**Purpose**: the one piece of durable state this feature adds.

- [ ] T001 Add the `link_prunes` table (`business_id` PK, `ran_at`, `deleted_count`, `notice_seen`) to `apps/api/src/db/schema.ts` per [data-model.md](./data-model.md), with a comment citing `links-on-demand-search D13`
- [ ] T002 Generate and apply the migration: `pnpm --filter @devolada/api db:generate` then `db:migrate:local`, committing the generated file under `apps/api/drizzle/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the contract and the adapter every story reads from.

**⚠️ CRITICAL**: no story work begins until T003–T007 are done — the zod schema is
what the admin, the MSW handlers and the Playwright stubs all take their types
and fixtures from (constitution III).

- [ ] T003 [P] Add `customersQuery`, `customerRow`, `customersResponse`, `createLinkRequest` and `createLinkResponse` to `apps/api/src/routes/direct-payments/schema.ts`, with `url`/`waLink` nullable and `hasLink` present (D7), per [contracts/links-api.md](./contracts/links-api.md)
- [ ] T004 [P] Add the opaque cursor codec (`api:<createdAt>:<id>` / `wh:<offset>`, base64url) in `apps/api/src/routes/direct-payments/cursor.ts`, citing D2, rejecting an unreadable cursor
- [ ] T005 Replace `searchCustomers` in `apps/api/src/wisphub/client.ts` with a four-filter parallel search (`nombre__contains`, `apellido__contains`, `usuario__contains`, `telefono__contains`), returning the merged rows and each filter's `count`, citing D4 and `bug: customer-lookup-misses`
- [ ] T006 Add `customersBlock(limit, offset)` to `apps/api/src/wisphub/client.ts` returning `{ customers, total }` from `/clientes/?limit=&offset=`, with `limit` clamped 10..50, citing D3
- [ ] T007 Replace `ensureLinks` (bulk) with `ensureLink` (one customer) in `apps/api/src/direct-payments/links.ts`, returning `{ token, created }` and never replacing an existing row, citing D8 and FR-005/FR-009

**Checkpoint**: the contract exists and the adapter can answer a block and a search.

---

## Phase 3: User Story 1 — Any customer can be found and sent their link (Priority: P1) 🎯 MVP

**Goal**: the page opens on one screenful read live, scrolls for more, searches the provider directly, and creates a link only when an operator acts.

**Independent Test**: on an ISP with more customers than any list could hold, search a customer who was never listed, send their link, and confirm a link now exists for exactly that customer and for nobody else who appeared in the results.

### Tests for User Story 1

- [ ] T008 [P] [US1] Write `apps/api/test/links-customers.test.ts` citing `links-on-demand-search US1`: browse walks API links then the provider's list, the cursor carries its phase, `limit` is clamped, rows dedupe by identity, a search merges four filters, `matched` is the largest count, `q` under three characters is `VALIDATION_ERROR`, test links never appear
- [ ] T009 [P] [US1] Write `apps/api/test/links-create-on-act.test.ts` citing `links-on-demand-search US1`: `POST /direct-payments/links` creates on first call and returns the same link on the second, a viewer is refused, no CLABE is `SPEI_NOT_CONFIGURED`, an unknown usuario is `CUSTOMER_NOT_FOUND`, and listing or searching creates nothing
- [ ] T010 [P] [US1] Write `apps/admin/src/features/links/LinksScreen.test.tsx` citing `links-on-demand-search US1`: MSW answers schema-validated fixtures, a row without a link still shows both buttons, pressing Copiar calls the create door once, and `axe` passes on the rendered screen

### Implementation for User Story 1

- [ ] T011 [US1] Implement `listCustomers` in `apps/api/src/routes/direct-payments/handler.ts`: browse in two phases (D2), search over four filters plus the business's API links (D4), merge and dedupe (D6), report `matched` as a floor (D5)
- [ ] T012 [US1] Implement `createLink` in `apps/api/src/routes/direct-payments/handler.ts`: exact `usuario=` lookup for the numeric id and phone, then `ensureLink`, behind `requireArea("payments", "operate")` and the CLABE gate (D8, FR-016)
- [ ] T013 [US1] Wire `GET /customers` and `POST /links` in `apps/api/src/routes/direct-payments/index.ts` with `zValidator` only — no logic in the router (constitution III); leave the old routes in place for now
- [ ] T014 [P] [US1] Add `apps/admin/src/features/links/useCustomers.ts`: `useInfiniteQuery` over the cursor, block size measured from the viewport and clamped, an `IntersectionObserver` sentinel for the next block (FR-020, D3)
- [ ] T015 [P] [US1] Add `apps/admin/src/features/links/useLinkAction.ts`: create-on-act for Copiar and WhatsApp, opening the WhatsApp window synchronously on the click and setting its location when the POST resolves, closing it on failure (D9)
- [ ] T016 [US1] Rewrite `apps/admin/src/features/links/LinksScreen.tsx` around the search box and the scrolling blocks: no roster read, no "la lista puede estar incompleta" warning (FR-018), both buttons on every row the role allows, tokens only and `StatusBadge` for the channel
- [ ] T017 [US1] Point the admin's MSW handlers and fixtures at the new door in `apps/admin/src/test/`, validating every fixture against `customersResponse`

**Checkpoint**: the Links page finds and sends to any customer, and nothing creates a link but an operator's press.

---

## Phase 4: User Story 4 — Cobros can send, not only show (Priority: P1)

**Goal**: the collections screen creates the debtor's link on the act, exactly as Links does.

**Independent Test**: delete every stored link for a business, open Cobros on a debtor, press WhatsApp — the message opens with a working link, and Links shows that same link for that customer afterwards.

### Tests for User Story 4

- [ ] T018 [P] [US4] Extend `apps/api/test/links-create-on-act.test.ts` with cases citing `links-on-demand-search US4`: a debtor with no link gains one from the act, a debtor who has one keeps it, and the link Cobros creates is the link Links finds
- [ ] T019 [P] [US4] Write `apps/admin/src/features/cobros/CobrosScreen.test.tsx` citing `links-on-demand-search US4`: a row with `linkUrl: null` shows both buttons, pressing one calls the create door, a viewer sees neither, and `axe` passes

### Implementation for User Story 4

- [ ] T020 [US4] Update `apps/api/src/routes/payment-requests/schema.ts` so the comment on `linkUrl`/`waLink` says a null means *no link yet*, not *hide the buttons* (D14, FR-026)
- [ ] T021 [US4] Update `apps/api/src/routes/payment-requests/handler.ts`: keep the batch lookup of stored links, drop the assumption that the roster created them all, citing D14
- [ ] T022 [US4] Update `apps/admin/src/features/cobros/CobrosScreen.tsx` to show Copiar and WhatsApp on every permitted row and call `useLinkAction` on the act — reusing the hook whole, adding no second copy of the rule

**Checkpoint**: US1 and US4 both work; the collections path survives the prune that follows.

---

## Phase 5: User Story 2 — The search survives leaving the page (Priority: P2)

**Goal**: the text and its results come back from navigation, the back button, a reload and a pasted address.

**Independent Test**: search, navigate away and back, press back, reload — each time the same text is in the box and the same results are on screen, with no second visible wait inside two minutes.

### Tests for User Story 2

- [ ] T023 [P] [US2] Extend `apps/admin/src/features/links/LinksScreen.test.tsx` with cases citing `links-on-demand-search US2`: the URL carries the text, remounting restores text and results from `sessionStorage`, a stored entry older than two minutes is re-fetched, and an empty box leaves no entry behind

### Implementation for User Story 2

- [ ] T024 [US2] Add `?q=` as a validated search param on the Links route in `apps/admin/src/routes/`, so the text lives in the address and a pasted address opens on that search (FR-011, D11)
- [ ] T025 [US2] Add `apps/admin/src/features/links/seen.ts`: `sessionStorage` persistence of search results keyed by the normalised text with a two-minute TTL, reset cleanly in tests (FR-012, D11)
- [ ] T026 [US2] Discard an in-flight answer whose text no longer matches the box in `apps/admin/src/features/links/useCustomers.ts` (FR-013)

**Checkpoint**: the search is durable across every way of leaving the page.

---

## Phase 6: User Story 3 — Search keeps working when WispHub does not (Priority: P3)

**Goal**: a provider outage narrows what can be found and says so, instead of failing.

**Independent Test**: with WispHub unreachable, search by usuario for a customer whose link Devolada holds, by name for one seen minutes earlier, and by reference for an API link — all three appear under a quiet note; a customer not held gives an empty result under the same note and no error block.

### Tests for User Story 3

- [ ] T027 [P] [US3] Write `apps/api/test/links-offline.test.ts` citing `links-on-demand-search US3`: a provider timeout answers `200` with `wisphub: "unavailable"` and the API links only, a business with no key answers `"not_configured"`, a rejected key still answers `502 WISPHUB_AUTH_FAILED`, and `POST /links` does fail when the provider is silent
- [ ] T028 [P] [US3] Extend `apps/admin/src/features/links/LinksScreen.test.tsx` with cases citing `links-on-demand-search US3`: the note renders, no error block appears, a name seen minutes earlier is still found from the cache, and the empty state names where links come from

### Implementation for User Story 3

- [ ] T029 [US3] Make `listCustomers` answer a provider outage inside the envelope in `apps/api/src/routes/direct-payments/handler.ts` — never a 503 — while keeping `WISPHUB_AUTH_FAILED` its own answer (D10, FR-014)
- [ ] T030 [US3] Extend `apps/admin/src/features/links/seen.ts` to hold recently-seen names and phones, always overwritten by a live answer and read only when the provider did not answer (FR-021, D11)
- [ ] T031 [US3] Render the quiet *"Sin conexión a WispHub"* note, the "a name search needs WispHub" line and the no-WispHub empty state in `apps/admin/src/features/links/LinksScreen.tsx` (FR-014, FR-015)
- [ ] T032 [US3] Add the copied / sent mark to `apps/admin/src/features/links/seen.ts` and render it on the row, per operator and per session (FR-022, D11)

**Checkpoint**: all four stories work; the retirement can begin.

---

## Phase 7: Retirement and the prune

**⚠️ Ships with Phases 3 and 4, never before them.** FR-023 empties the stored
links Cobros reads; without US4 the collections screen can send nothing.

- [ ] T033 [US1] Remove `GET /direct-payments/links` and `GET /direct-payments/links/roster` from `apps/api/src/routes/direct-payments/index.ts`, and `listLinks`, `linksRoster` from its handler, with `linksListQuery`, `linksListResponse` and `linksRosterResponse` from its schema (D12)
- [ ] T034 [US1] Remove `listCustomersFull`, `customersPath` and `queryParamFor` from `apps/api/src/wisphub/client.ts`, `rosterForDisplay` from `cache.ts`, and `readRoster` plus the `roster` entry of `KINDS` from `snapshot.ts`, leaving the `pending` pass and the `sweep_kind` enum untouched (D12)
- [ ] T035 [US1] Add `apps/api/src/links/prune.ts`: `PRUNE_CUTOVER_MS` as a constant citing D13, the delete of pre-cutover panel links no payment and no clave attempt references, the deletion of orphaned `roster` sweep rows, and the `link_prunes` row it writes once
- [ ] T036 [US1] Join the prune to the every-minute cron in `apps/api/src/index.ts` under `waitUntil`, speaking only when it did something (constitution: one trigger)
- [ ] T037 [P] [US1] Write `apps/api/test/links-prune.test.ts` citing `links-on-demand-search US1`: a link with a payment is kept, a link with a clave attempt is kept, an API link is never touched, a post-cutover link is never touched, a second run deletes nothing and writes no second row, and the count lands on the row
- [ ] T038 [P] [US1] Delete `apps/api/test/links-roster-cap.test.ts`, which tests the roster this feature retires, and note the retirement in `.specify/bugs/links-roster-cap/` rather than editing its history
- [ ] T039 [US1] Add `apps/admin/src/features/links/PruneNotice.tsx` showing the deleted count once and setting `notice_seen` on dismissal (FR-023)

**Checkpoint**: nothing reads a roster, nothing creates a link in the background, and the pre-existing links are gone.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T040 [P] Replace the roster stub with a customers stub in `tests/e2e/stubs.ts`, `tests/design/review-foundations.spec.ts` and `tests/design/review-feedback.spec.ts`
- [ ] T041 [P] Remove the dead `/direct-payments/links/search` stub from `tests/design/review-links.spec.ts` and point its shots at the new door (D12)
- [ ] T042 Write `tests/e2e/links.spec.ts` citing `links-on-demand-search US1`: scrolling loads a second block, no horizontal scroll at 360/768/1280, measured contrast in both themes, touch targets on Copiar and WhatsApp, and a measured focus indicator
- [ ] T043 [P] Update `apps/api/package.json` only if a new area export is needed, and check `apps/admin/src/lib/base.ts` still resolves the door in dev
- [ ] T044 Run the full gates: `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `node scripts/spec-lint.mjs`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm e2e`
- [ ] T045 Walk [quickstart.md](./quickstart.md) end to end, including the count-does-not-move check for SC-004 and the no-background-creation check for SC-009
- [ ] T046 Set `PRUNE_CUTOVER_MS` to the real ship timestamp at the release commit, not before, and tell the connected ISP that roughly 6,513 links go and that a sent-but-unpaid link stops working (quickstart, *Pre-flight*)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Phase 1 for the table only; T003–T007 block every story
- **US1 (Phase 3)**: needs Phase 2
- **US4 (Phase 4)**: needs T012 and T015 from US1 — it reuses the create door and the action hook whole
- **US2 (Phase 5)**: needs T014 and T016 from US1
- **US3 (Phase 6)**: needs T011 and T016 from US1
- **Retirement and prune (Phase 7)**: needs Phases 3 and 4 complete and live. T035's constant is set at T046, not at T035
- **Polish (Phase 8)**: needs everything

### User Story Dependencies

- **US1 (P1)**: independent once Phase 2 is done. This is the MVP
- **US4 (P1)**: depends on US1's create door. Independently testable — delete every link and open Cobros
- **US2 (P2)**: depends on US1's screen. Independently testable — navigate, back, reload
- **US3 (P3)**: depends on US1's handler and screen. Independently testable — take the provider away

### Parallel Opportunities

- T003 and T004 together; T005 and T006 are the same file and are not parallel
- T008, T009 and T010 together — three different test files
- T014 and T015 together — two new hooks, no shared file
- T018 and T019 together; T027 and T028 together
- T037 and T038 together
- T040 and T041 together
- US2 and US3 can be built in parallel by two people once US1's screen exists: they touch `useCustomers.ts` and `seen.ts` from different ends, so agree on `seen.ts` first (T025 lands before T030 and T032)

---

## Parallel Example: User Story 1

```bash
# The three test files, together:
Task: "Write apps/api/test/links-customers.test.ts"
Task: "Write apps/api/test/links-create-on-act.test.ts"
Task: "Write apps/admin/src/features/links/LinksScreen.test.tsx"

# The two new hooks, together:
Task: "Add apps/admin/src/features/links/useCustomers.ts"
Task: "Add apps/admin/src/features/links/useLinkAction.ts"
```

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 → Phase 2 → Phase 3
2. **Stop and validate**: any customer can be found and sent their link, and a
   session of browsing and searching without pressing anything moves the link
   count by zero (SC-004)
3. Shippable on its own: the old doors are still there, Cobros still works as
   it did, and nothing has been deleted

### Incremental delivery

1. **MVP** — US1
2. **+ US4** — Cobros sends too. This pair is what the prune needs
3. **+ US2** — the search stops being forgotten
4. **+ US3** — the provider can go away without the page going blank
5. **+ Phase 7** — retirement and the prune, one release with US1 and US4
6. **+ Phase 8** — the browser layer, the stubs, the gates, the walk-through

### What must not be split

US1 and US4 ship with Phase 7 or Phase 7 does not ship. The prune empties the
stored links Cobros reads, and a Cobros that cannot create one is a collections
screen that can send nothing.

---

## Notes

- Every test file carries `links-on-demand-search US<n>`; `spec-lint` checks it
- Every non-obvious rule carries `links-on-demand-search D<n>`; the decisions are in [research.md](./research.md)
- The two rules most likely to be lost in implementation: the WhatsApp window
  opens **before** the link exists (D9), and the prune's boundary is a **constant**,
  never "when it ran" (D13)
- Commit per task or per logical group; stop at any checkpoint to validate
