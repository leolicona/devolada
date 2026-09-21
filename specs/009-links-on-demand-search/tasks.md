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

**Revised 2026-09-21 after `/speckit-analyze`**: sixteen findings applied. The
largest was that retiring the roster breaks **twelve existing test files** no
task touched — Phase 7 now migrates every one of them before the removal, because
the constitution forbids skipping or quarantining a test to get green.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished work)
- **[Story]**: US1–US4 from spec.md
- Every task names its file

## Path Conventions

Real paths, verified against the tree: API source `apps/api/src/`, API tests
`apps/api/test/`, migrations `apps/api/migrations/`, admin source
`apps/admin/src/features/`, **admin tests `apps/admin/test/`** (not co-located),
shared MSW handlers `apps/admin/test/msw.ts`, browser layer `tests/e2e/`, design
review `tests/design/`.

---

## Phase 1: Setup

- [ ] T001 Add the `link_prunes` table (`business_id` PK, `ran_at`, `deleted_count`, `notice_seen`) to `apps/api/src/db/schema.ts` per [data-model.md](./data-model.md), with a comment citing `links-on-demand-search D13`
- [ ] T002 Generate and apply the migration: `pnpm --filter @devolada/api db:generate` then `db:migrate:local`, committing the generated file under `apps/api/migrations/` (the path `drizzle.config.ts` writes to)

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no story work begins until T003–T007 are done — the zod schema
is what the admin, the MSW handlers and the Playwright stubs all take their
types and fixtures from (constitution III).

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

- [ ] T008 [P] [US1] Write `apps/api/test/links-customers.test.ts` citing `links-on-demand-search US1`: browse walks API links then the provider's list, the cursor carries its phase, `limit` is clamped, rows dedupe by identity, a search merges four filters, `matched` is the largest count, `q` under three characters is `VALIDATION_ERROR`, test links never appear (FR-017)
- [ ] T009 [P] [US1] Write `apps/api/test/links-create-on-act.test.ts` citing `links-on-demand-search US1`: `POST /direct-payments/links` creates on first call and returns the same link on the second, a viewer gets `FORBIDDEN_FOR_ROLE`, no CLABE is `SPEI_NOT_CONFIGURED`, an unknown usuario is `CUSTOMER_NOT_FOUND`, and listing or searching creates nothing
- [ ] T010 [P] [US1] Write `apps/api/test/links-identity-only.test.ts` citing `links-on-demand-search US1` for **FR-010**: after an act, the `payment_links` row carries `customer_usuario` and Devolada's own fields and **nothing about the customer** — no name, no phone, no service state — and a second act on a customer whose provider name changed writes no name either
- [ ] T011 [US1] Replace the `linksRoster` handler at `apps/admin/test/msw.ts:95` with a `customers` handler answering `customersResponse`, plus a `createLink` handler. **This file is shared by the whole admin suite and must land before T012 and before every Phase 7 admin task**
- [ ] T012 [US1] Rewrite `apps/admin/test/links.test.tsx` onto the new door, replacing its `US-D07` citation with `links-on-demand-search US1`: a row without a link still shows both buttons, pressing Copiar calls the create door once, and `axe` passes on the rendered screen

### Implementation for User Story 1

- [ ] T013 [US1] Implement `listCustomers` in `apps/api/src/routes/direct-payments/handler.ts`: browse in two phases (D2), search over four filters plus the business's API links (D4), merge and dedupe (D6), report `matched` as a floor (D5)
- [ ] T014 [US1] Implement `createLink` in `apps/api/src/routes/direct-payments/handler.ts`: exact `usuario=` lookup for the numeric id and phone, then `ensureLink`, behind `requireArea("payments", "operate")` and the CLABE gate (D8, FR-016)
- [ ] T015 [US1] Wire `GET /customers` and `POST /links` in `apps/api/src/routes/direct-payments/index.ts` with `zValidator` only — no logic in the router (constitution III); leave the old routes in place until Phase 7
- [ ] T016 [P] [US1] Add `apps/admin/src/features/links/useCustomers.ts`: `useInfiniteQuery` over the cursor, block size measured from the viewport and clamped, an `IntersectionObserver` sentinel for the next block (FR-020, D3), a **300 ms** debounce before a search leaves the browser (FR-002), and discarding an in-flight answer whose text no longer matches the box (FR-013, US1 scenario 9)
- [ ] T017 [P] [US1] Add `apps/admin/src/features/links/useLinkAction.ts`: create-on-act for Copiar and WhatsApp, opening the WhatsApp window synchronously on the click and setting its location when the POST resolves, closing it on failure (D9), with the phone rules unchanged (FR-019: Mexico's code in front, the contact picker when the number cannot be read)
- [ ] T018 [P] [US1] Add `apps/admin/src/features/links/seen.ts` with all three `sessionStorage` stores it will ever hold — search results, recently seen names and phones, and the copied/sent marks (D11) — so US2 and US3 consume one module rather than each editing it
- [ ] T019 [US1] Rewrite `apps/admin/src/features/links/LinksScreen.tsx` around the search box and the scrolling blocks: no roster read, no "la lista puede estar incompleta" warning (FR-018), both buttons on every row the role allows, the copied/sent mark rendered from `seen.ts` (FR-022), tokens only and `StatusBadge` for the channel

**Checkpoint**: US1 is complete, including scenario 9 and the copied/sent mark. Nothing creates a link but an operator's press.

---

## Phase 4: User Story 4 — Cobros can send, not only show (Priority: P1)

**Goal**: the collections screen creates the debtor's link on the act, exactly as Links does.

**Independent Test**: delete every stored link for a business, open Cobros on a debtor, press WhatsApp — the message opens with a working link, and Links shows that same link for that customer afterwards.

### Tests for User Story 4

- [ ] T020 [P] [US4] Extend `apps/api/test/links-create-on-act.test.ts` with cases citing `links-on-demand-search US4`: a debtor with no link gains one from the act, a debtor who has one keeps it, and the link Cobros creates is the link Links finds
- [ ] T021 [US4] Rewrite `apps/admin/test/cobros.test.tsx` citing `links-on-demand-search US4`: a row with `linkUrl: null` shows both buttons, pressing one calls the create door, a viewer sees neither, and `axe` passes

### Implementation for User Story 4

- [ ] T022 [US4] Update `apps/api/src/routes/payment-requests/schema.ts` so the comment on `linkUrl`/`waLink` says a null means *no link yet*, not *hide the buttons* (D14, FR-026)
- [ ] T023 [US4] Update `apps/api/src/routes/payment-requests/handler.ts`: keep the batch lookup of stored links, drop the assumption that the roster created them all, citing D14
- [ ] T024 [US4] Update `apps/admin/src/features/cobros/CobrosScreen.tsx` to show Copiar and WhatsApp on every permitted row and call `useLinkAction` on the act — reusing the hook whole, adding no second copy of the rule

**Checkpoint**: US1 and US4 both work; the collections path survives the prune that follows.

---

## Phase 5: User Story 2 — The search survives leaving the page (Priority: P2)

**Goal**: the text and its results come back from navigation, the back button, a reload and a pasted address.

**Independent Test**: search, navigate away and back, press back, reload — each time the same text is in the box and the same results are on screen, with no second visible wait inside two minutes.

- [ ] T025 [P] [US2] Add US2 cases to `apps/admin/test/links.test.tsx` citing `links-on-demand-search US2`: the URL carries the text, remounting restores text and results from `seen.ts`, a stored entry older than two minutes is re-fetched, and an empty box leaves no entry behind
- [ ] T026 [US2] Add `?q=` as a validated search param on the Links route in `apps/admin/src/routes/`, so the text lives in the address and a pasted address opens on that search (FR-011, D11)
- [ ] T027 [US2] Wire the result store of `seen.ts` into `useCustomers.ts`: persist by normalised text, two-minute TTL, reset cleanly in tests (FR-012, D11)

**Checkpoint**: the search is durable across every way of leaving the page.

---

## Phase 6: User Story 3 — Search keeps working when WispHub does not (Priority: P3)

**Goal**: a provider outage narrows what can be found and says so, instead of failing.

**Independent Test**: with WispHub unreachable, search by usuario for a customer whose link Devolada holds, by name for one seen minutes earlier, and by reference for an API link — all three appear under a quiet note; a customer not held gives an empty result under the same note and no error block.

- [ ] T028 [P] [US3] Write `apps/api/test/links-offline.test.ts` citing `links-on-demand-search US3`: a provider timeout answers `200` with `wisphub: "unavailable"` and the API links only, a business with no key answers `"not_configured"`, a rejected key still answers `503 WISPHUB_AUTH_FAILED` (as `bug: links-refused-key` requires), and `POST /links` does fail when the provider is silent
- [ ] T029 [US3] Add US3 cases to `apps/admin/test/links.test.tsx` citing `links-on-demand-search US3` — after T025, same file: the note renders, no error block appears, a name seen minutes earlier is still found from the cache, and the empty state names where links come from
- [ ] T030 [US3] Make `listCustomers` answer a provider outage inside the envelope in `apps/api/src/routes/direct-payments/handler.ts` — never a 503 — while keeping `WISPHUB_AUTH_FAILED` its own 503 answer (D10, FR-014)
- [ ] T031 [US3] Wire the seen-names store of `seen.ts` into `useCustomers.ts`: always overwritten by a live answer, read only when the provider did not answer (FR-021, D11)
- [ ] T032 [US3] Render the quiet *"Sin conexión a WispHub"* note, the "a name search needs WispHub" line and the no-WispHub empty state in `apps/admin/src/features/links/LinksScreen.tsx` (FR-014, FR-015)

**Checkpoint**: all four stories work; the retirement can begin.

---

## Phase 7: Test migration, retirement and the prune

**⚠️ Ships with Phases 3 and 4, never before them.** FR-023 empties the stored
links Cobros reads; without US4 the collections screen can send nothing.

**⚠️ The migration (T033–T043) lands BEFORE the removal (T044–T045).** Twelve
existing test files read the roster. The constitution forbids skipping,
disabling or quarantining any of them to get green, so each is moved to the new
door first and the door is removed second.

### Test migration — real assertions to rewrite

- [ ] T033 [US1] Rewrite `apps/api/test/direct-payments-links.test.ts` onto `GET /direct-payments/customers`, **keeping** the `bug: links-refused-key` case that asserts a refused key answers 503 with `WISPHUB_AUTH_FAILED`, and re-citing the roster-era `US-D07` cases as `links-on-demand-search US1`
- [ ] T034 [US1] Rewrite the roster cases of `apps/api/test/presence-freshness.test.ts` (scenario 9: "two roster reads inside the window answer the same readAt"). A block carries no shared `readAt`, so state what replaces the freshness promise on this page, or retire the case with its reason in the file
- [ ] T035 [US1] Move FR-017's proof in `apps/api/test/collections-api-test-mode.test.ts:175` from the roster to the new customers door, keeping the one-predicate rule (`realOnly`) with the same call-site coverage
- [ ] T036 [US1] Fix the premise in `apps/api/test/payment-requests.test.ts:100` — "all of whom the roster had already given a link" is false after US4; the fixture must cover a debtor with no link
- [ ] T037 [P] [US1] Rewrite `apps/admin/test/identity-round.test.tsx:110` ("Links: the roster reads, the share buttons wait for the CLABE") against the new screen; the CLABE gate itself is unchanged (FR-016)
- [ ] T038 [P] [US1] Rebuild `apps/admin/test/presence-freshness.test.tsx` on blocks instead of rosters — it builds roster fixtures and asserts the 30-second read floor and the re-read on focus, neither of which survives a paged live read
- [ ] T039 [US1] Rewrite `tests/e2e/keyboard.spec.ts` tab-order assertions, which rest on "the roster arrives alive on arrival" (lines 98–114); the first block arrives after a provider read, so the reading order and the wait both change

### Test migration — mechanical handler swaps

- [ ] T040 [P] [US1] Swap `handlers.linksRoster` for the customers handler in `apps/admin/test/memberships.test.tsx:223` and `apps/admin/test/shell.test.tsx:167`
- [ ] T041 [P] [US1] Update the stale "client roster" comment in `apps/admin/test/feedback.test.tsx:72` — comment only, no assertion changes
- [ ] T042 [P] [US1] Replace the roster stub with a customers stub in `tests/e2e/stubs.ts`, `tests/design/review-foundations.spec.ts` and `tests/design/review-feedback.spec.ts`
- [ ] T043 [P] [US1] Remove the dead `/direct-payments/links/search` stub from `tests/design/review-links.spec.ts` — that endpoint went in the pilot-UX round and the stub outlived it — and point its shots at the new door (D12)

### Retirement

- [ ] T044 [US1] Remove `GET /direct-payments/links` and `GET /direct-payments/links/roster` from `apps/api/src/routes/direct-payments/index.ts`, and `listLinks`, `linksRoster` from its handler, with `linksListQuery`, `linksListResponse` and `linksRosterResponse` from its schema (D12)
- [ ] T045 [US1] Remove `listCustomersFull`, `customersPath` and `queryParamFor` from `apps/api/src/wisphub/client.ts`, `rosterForDisplay` from `cache.ts`, and `readRoster` plus the `roster` entry of `KINDS` from `snapshot.ts`, leaving the `pending` pass and the `sweep_kind` enum untouched (D12)
- [ ] T046 [P] [US1] Delete `apps/api/test/links-roster-cap.test.ts`, which tests the roster this feature retires, and add one line to `.specify/bugs/links-roster-cap/test.md` recording that the behaviour it verified was superseded by `009-links-on-demand-search` — the bug's history is not edited

### The prune

- [ ] T047 [US1] Add `apps/api/src/links/prune.ts`: `PRUNE_CUTOVER_MS` as a constant citing D13, the delete of pre-cutover panel links no payment and no clave attempt references, the deletion of orphaned `roster` sweep rows, and the `link_prunes` row it writes once
- [ ] T048 [US1] Join the prune to the every-minute cron in `apps/api/src/index.ts` under `waitUntil`, speaking only when it did something (constitution: one trigger)
- [ ] T049 [P] [US1] Write `apps/api/test/links-prune.test.ts` citing `links-on-demand-search US1`: a link with a payment is kept, a link with a clave attempt is kept, an API link is never touched, a post-cutover link is never touched, a second run deletes nothing and writes no second row, a deleted link's token is never reissued (FR-024), and the count lands on the row
- [ ] T050 [US1] Add `apps/admin/src/features/links/PruneNotice.tsx` showing the deleted count once and setting `notice_seen` on dismissal (FR-023)

**Checkpoint**: no test reads a roster, nothing creates a link in the background, and the pre-existing links are gone.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T051 Write `tests/e2e/links.spec.ts` citing `links-on-demand-search US1`: scrolling loads a second block, no horizontal scroll at 360/768/1280, measured contrast in both themes, touch targets on Copiar and WhatsApp, and a measured focus indicator
- [ ] T052 Measure SC-001, SC-002 and SC-003 in `tests/e2e/links.spec.ts` against the stubbed API with a realistic provider delay: the page interactive within 1 s, a search's results within 3 s of the pause, and find-and-send inside 15 s. Record the measured numbers in the file's header comment rather than asserting a wall-clock that will flake on CI
- [ ] T053 [P] Update `apps/api/package.json` only if a new area export is needed, and check `apps/admin/src/lib/base.ts` still resolves the door in dev
- [ ] T054 Run the full gates: `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `node scripts/spec-lint.mjs`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm e2e`
- [ ] T055 Walk [quickstart.md](./quickstart.md) end to end, including the count-does-not-move check for SC-004 and the no-background-creation check for SC-009
- [ ] T056 Set `PRUNE_CUTOVER_MS` to the real ship timestamp at the release commit, not before, and tell the connected ISP that roughly 6,513 links go and that a sent-but-unpaid link stops working (quickstart, *Pre-flight*)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Phase 1 for the table only; T003–T007 block every story
- **US1 (Phase 3)**: needs Phase 2. T011 (`msw.ts`) blocks T012 and every admin task in Phase 7
- **US4 (Phase 4)**: needs T014 and T017 from US1 — it reuses the create door and the action hook whole
- **US2 (Phase 5)**: needs T016, T018 and T019 from US1
- **US3 (Phase 6)**: needs T013, T018 and T019 from US1. T029 follows T025 — same file
- **Phase 7**: needs Phases 3 and 4 complete. The migration (T033–T043) precedes the removal (T044–T045); the prune follows both. T047's constant is set at T056, not at T047
- **Polish (Phase 8)**: needs everything

### User Story Dependencies

- **US1 (P1)**: independent once Phase 2 is done. This is the MVP, and it is now complete on its own — scenario 9 (T016) and the copied/sent mark (T018, T019) sit in this phase rather than leaking into US2 and US3
- **US4 (P1)**: depends on US1's create door. Independently testable — delete every link and open Cobros
- **US2 (P2)**: depends on US1's screen and `seen.ts`. Independently testable — navigate, back, reload
- **US3 (P3)**: depends on US1's handler, screen and `seen.ts`. Independently testable — take the provider away

### Parallel Opportunities

- T003 and T004 together; T005 and T006 are the same file and are not parallel
- T008, T009 and T010 together — three different API test files
- T016, T017 and T018 together — three new modules, no shared file
- T037, T038 and T040–T043 together — six different test files, once T011 has landed
- T046 and T049 together
- `seen.ts` is created once (T018) and only consumed afterwards, so US2 and US3 no longer contend for it and can be built by two people in parallel

---

## Parallel Example: User Story 1

```bash
# The three API test files, together:
Task: "Write apps/api/test/links-customers.test.ts"
Task: "Write apps/api/test/links-create-on-act.test.ts"
Task: "Write apps/api/test/links-identity-only.test.ts"

# The three new admin modules, together:
Task: "Add apps/admin/src/features/links/useCustomers.ts"
Task: "Add apps/admin/src/features/links/useLinkAction.ts"
Task: "Add apps/admin/src/features/links/seen.ts"
```

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 → Phase 2 → Phase 3
2. **Stop and validate**: any customer can be found and sent their link, and a
   session of browsing and searching without pressing anything moves the link
   count by zero (SC-004)
3. Shippable on its own: the old doors are still there, every existing test
   still passes, Cobros still works as it did, and nothing has been deleted

### Incremental delivery

1. **MVP** — US1
2. **+ US4** — Cobros sends too. This pair is what the prune needs
3. **+ US2** — the search stops being forgotten
4. **+ US3** — the provider can go away without the page going blank
5. **+ Phase 7** — the twelve-file test migration, then the retirement, then the
   prune; one release with US1 and US4
6. **+ Phase 8** — the browser layer, the measurements, the gates, the walk-through

### What must not be split

- US1 and US4 ship with Phase 7 or Phase 7 does not ship. The prune empties the
  stored links Cobros reads, and a Cobros that cannot create one is a
  collections screen that can send nothing.
- Within Phase 7, the migration ships with the removal. Removing the doors
  first leaves twelve red test files, and the constitution allows no way to
  park them.

---

## Notes

- Every test file carries `links-on-demand-search US<n>`; `spec-lint` checks it
- Every non-obvious rule carries `links-on-demand-search D<n>`; the decisions are in [research.md](./research.md)
- The three rules most likely to be lost in implementation: the WhatsApp window
  opens **before** the link exists (D9), the prune's boundary is a **constant**,
  never "when it ran" (D13), and `apps/admin/test/msw.ts` is shared by the whole
  admin suite, so T011 gates far more than the Links tests
- Commit per task or per logical group; stop at any checkpoint to validate
