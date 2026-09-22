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

**Revised 2026-09-21 after `/speckit-analyze`**, twice. The first pass found
sixteen issues, the largest being that retiring the roster breaks **twelve
existing test files** no task touched — Phase 7 now migrates every one before the
removal, because the constitution forbids skipping or quarantining a test to get
green. The second pass found seven more, two of them created by the first round
of fixes: the prune's count had no door to reach the panel through (T049), and
`presence-freshness` lost a cited promise with nothing recording it (FR-027,
D15).

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

- [X] T001 Add the `link_prunes` table (`business_id` PK, `ran_at`, `deleted_count`, `notice_seen`) to `apps/api/src/db/schema.ts` per [data-model.md](./data-model.md), with a comment citing `links-on-demand-search D13`
- [X] T002 Generate and apply the migration: `pnpm --filter @devolada/api db:generate` then `db:migrate:local`, committing the generated file under `apps/api/migrations/` (the path `drizzle.config.ts` writes to)

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no story work begins until T003–T007 are done — the zod schema
is what the admin, the MSW handlers and the Playwright stubs all take their
types and fixtures from (constitution III).

- [X] T003 [P] Add `customersQuery`, `customerRow`, `customersResponse`, `createLinkRequest` and `createLinkResponse` to `apps/api/src/routes/direct-payments/schema.ts`, with `url`/`waLink` nullable and `hasLink` present (D7), per [contracts/links-api.md](./contracts/links-api.md)
- [X] T004 [P] Add the opaque cursor codec (`api:<createdAt>:<id>` / `wh:<offset>`, base64url) in `apps/api/src/routes/direct-payments/cursor.ts`, citing D2, rejecting an unreadable cursor
- [X] T005 Replace `searchCustomers` in `apps/api/src/wisphub/client.ts` with a four-filter parallel search (`nombre__contains`, `apellido__contains`, `usuario__contains`, `telefono__contains`), returning the merged rows and each filter's `count`, citing D4 and `bug: customer-lookup-misses`
- [X] T006 Add `customersBlock(limit, offset)` to `apps/api/src/wisphub/client.ts` returning `{ customers, total }` from `/clientes/?limit=&offset=`, with `limit` clamped 10..50, citing D3
- [X] T007 Replace `ensureLinks` (bulk) with `ensureLink` (one customer) in `apps/api/src/direct-payments/links.ts`, returning `{ token, created }` and never replacing an existing row, citing D8 and FR-005/FR-009

**Checkpoint**: the contract exists and the adapter can answer a block and a search.

---

## Phase 3: User Story 1 — Any customer can be found and sent their link (Priority: P1) 🎯 MVP

**Goal**: the page opens on one screenful read live, scrolls for more, searches the provider directly, and creates a link only when an operator acts.

**Independent Test**: on an ISP with more customers than any list could hold, search a customer who was never listed, send their link, and confirm a link now exists for exactly that customer and for nobody else who appeared in the results.

### Tests for User Story 1

- [X] T008 [P] [US1] Write `apps/api/test/links-customers.test.ts` citing `links-on-demand-search US1`: browse walks API links then the provider's list, the cursor carries its phase, `limit` is clamped, rows dedupe by identity, a search merges four filters, `matched` is the largest count, `q` under three characters is `VALIDATION_ERROR`, test links never appear (FR-017)
- [X] T009 [P] [US1] Write `apps/api/test/links-create-on-act.test.ts` citing `links-on-demand-search US1`: `POST /direct-payments/links` creates on first call and returns the same link on the second, a viewer gets `FORBIDDEN_FOR_ROLE`, no CLABE is `SPEI_NOT_CONFIGURED`, an unknown usuario is `CUSTOMER_NOT_FOUND`, and listing or searching creates nothing
- [X] T010 [P] [US1] Write `apps/api/test/links-identity-only.test.ts` citing `links-on-demand-search US1` for **FR-010**: after an act, the `payment_links` row carries `customer_usuario` and Devolada's own fields and **nothing about the customer** — no name, no phone, no service state — and a second act on a customer whose provider name changed writes no name either
- [X] T011 [US1] Replace the `linksRoster` handler at `apps/admin/test/msw.ts:95` with a `customers` handler answering `customersResponse`, plus a `createLink` handler. **This file is shared by the whole admin suite and must land before T012 and before every Phase 7 admin task**
- [X] T012 [US1] Rewrite `apps/admin/test/links.test.tsx` onto the new door, replacing its `US-D07` citation with `links-on-demand-search US1`: a row without a link still shows both buttons, pressing Copiar calls the create door once, and `axe` passes on the rendered screen

### Implementation for User Story 1

- [X] T013 [US1] Implement `listCustomers` in `apps/api/src/routes/direct-payments/handler.ts`: browse in two phases (D2), search over four filters plus the business's API links (D4), merge and dedupe (D6), report `matched` as a floor (D5)
- [X] T014 [US1] Implement `createLink` in `apps/api/src/routes/direct-payments/handler.ts`: exact `usuario=` lookup for the numeric id **and the phone**, then `ensureLink`, returning a `waLink` built from that phone through `toWhatsAppPhone` (FR-028, D16), behind `requireArea("payments", "operate")` and the CLABE gate (D8, FR-016)
- [X] T015 [US1] Wire `GET /customers` and `POST /links` in `apps/api/src/routes/direct-payments/index.ts` with `zValidator` only — no logic in the router (constitution III); leave the old routes in place until Phase 7
- [X] T016 [P] [US1] Add `apps/admin/src/features/links/useCustomers.ts`: `useInfiniteQuery` over the cursor, block size measured from the viewport and clamped, an `IntersectionObserver` sentinel for the next block (FR-020, D3), a **300 ms** debounce before a search leaves the browser (FR-002, the figure the spec now carries), discarding an in-flight answer whose text no longer matches the box (FR-013, US1 scenario 9), and re-reading the **first block only** on return to the tab, no more than once every 30 seconds (FR-027, D15)
- [X] T017 [P] [US1] Add `apps/admin/src/features/links/useLinkAction.ts`: create-on-act for Copiar and WhatsApp, opening the WhatsApp window synchronously on the click and setting its location to the door's `waLink` when the POST resolves, closing it on failure (D9). The `waLink` carries the phone the act read, so the customer's own chat opens (FR-028, D16); `toWhatsAppPhone`'s rules are unchanged, and the picker is the fallback only for a number it refuses (FR-019)
- [X] T018 [P] [US1] Add `apps/admin/src/features/links/seen.ts` with all three `sessionStorage` stores it will ever hold — search results, recently seen names and phones, and the copied/sent marks (D11) — so US2 and US3 consume one module rather than each editing it
- [X] T019 [US1] Rewrite `apps/admin/src/features/links/LinksScreen.tsx` around the search box and the scrolling blocks: no roster read, no "la lista puede estar incompleta" warning (FR-018), **no read-age indicator and no "Actualizar"** (FR-027, D15 — the `Freshness` component this screen renders today goes), both buttons on every row the role allows, the copied/sent mark rendered from `seen.ts` (FR-022), tokens only and `StatusBadge` for the channel

**Checkpoint**: US1 is complete, including scenario 9 and the copied/sent mark. Nothing creates a link but an operator's press.

---

## Phase 4: User Story 4 — Cobros can send, not only show (Priority: P1)

**Goal**: the collections screen creates the debtor's link on the act, exactly as Links does.

**Independent Test**: delete every stored link for a business, open Cobros on a debtor, press WhatsApp — the message opens with a working link, and Links shows that same link for that customer afterwards.

### Tests for User Story 4

- [X] T020 [P] [US4] Extend `apps/api/test/links-create-on-act.test.ts` with cases citing `links-on-demand-search US4`: a debtor with no link gains one from the act, a debtor who has one keeps it, the link Cobros creates is the link Links finds, and the returned `waLink` **carries the phone the act read** — with the picker fallback only for a record whose number is absent or unreadable (FR-028, D16)
- [X] T021 [US4] Rewrite `apps/admin/test/cobros.test.tsx` citing `links-on-demand-search US4`: every permitted row shows both buttons, pressing one calls the create door and opens the customer's own chat, a record without a readable phone falls back to the picker, a viewer sees neither button, and `axe` passes

### Implementation for User Story 4

- [X] T022 [US4] Remove `linkUrl` and `waLink` from `cobroRow` in `apps/api/src/routes/payment-requests/schema.ts`, citing D16: a stored `waLink` has no phone and would send the operator to the picker for a debtor who already has a link
- [X] T023 [US4] Update `apps/api/src/routes/payment-requests/handler.ts`: drop the batch lookup of stored links and the chunking under D1's parameter cap it needed (`bug: cobros-links-lookup-params`), since neither field survives. The debt read, the 5-page window, `complete` and `readAt` are untouched (D14, D16)
- [X] T024 [US4] Update `apps/admin/src/features/cobros/CobrosScreen.tsx` to show Copiar and WhatsApp on every permitted row and call `useLinkAction` on the act, opening the chat with the `waLink` the door returns — reusing the hook whole, adding no second copy of the rule (FR-028)

**Checkpoint**: US1 and US4 both work; the collections path survives the prune that follows.

---

## Phase 5: User Story 2 — The search survives leaving the page (Priority: P2)

**Goal**: the text and its results come back from navigation, the back button, a reload and a pasted address.

**Independent Test**: search, navigate away and back, press back, reload — each time the same text is in the box and the same results are on screen, with no second visible wait inside two minutes.

- [X] T025 [P] [US2] Add US2 cases to `apps/admin/test/links.test.tsx` citing `links-on-demand-search US2`: the URL carries the text, remounting restores text and results from `seen.ts`, a stored entry older than two minutes is re-fetched, and an empty box leaves no entry behind
- [X] T026 [US2] Add `?q=` as a validated search param on the Links route in `apps/admin/src/routes/`, so the text lives in the address and a pasted address opens on that search (FR-011, D11)
- [X] T027 [US2] Wire the result store of `seen.ts` into `useCustomers.ts`: persist by normalised text, two-minute TTL, reset cleanly in tests (FR-012, D11)

**Checkpoint**: the search is durable across every way of leaving the page.

---

## Phase 6: User Story 3 — Search keeps working when WispHub does not (Priority: P3)

**Goal**: a provider outage narrows what can be found and says so, instead of failing.

**Independent Test**: with WispHub unreachable, search by usuario for a customer whose link Devolada holds, by name for one seen minutes earlier, and by reference for an API link — all three appear under a quiet note; a customer not held gives an empty result under the same note and no error block.

- [X] T028 [P] [US3] Write `apps/api/test/links-offline.test.ts` citing `links-on-demand-search US3`: a provider timeout answers `200` with `wisphub: "unavailable"` and the API links only, a business with no key answers `"not_configured"`, a rejected key still answers `503 WISPHUB_AUTH_FAILED` (as `bug: links-refused-key` requires), and `POST /links` does fail when the provider is silent
- [X] T029 [US3] Add US3 cases to `apps/admin/test/links.test.tsx` citing `links-on-demand-search US3` — after T025, same file: the note renders, no error block appears, a name seen minutes earlier is still found from the cache, and the empty state names where links come from
- [X] T030 [US3] Make `listCustomers` answer a provider outage inside the envelope in `apps/api/src/routes/direct-payments/handler.ts` — never a 503 — while keeping `WISPHUB_AUTH_FAILED` its own 503 answer (D10, FR-014)
- [X] T031 [US3] Wire the seen-names store of `seen.ts` into `useCustomers.ts`: always overwritten by a live answer, read only when the provider did not answer (FR-021, D11)
- [X] T032 [US3] Render the quiet *"Sin conexión a WispHub"* note, the "a name search needs WispHub" line and the no-WispHub empty state in `apps/admin/src/features/links/LinksScreen.tsx` (FR-014, FR-015)

**Checkpoint**: all four stories work; the retirement can begin.

---

## Phase 7: Test migration, retirement and the prune

**⚠️ Ships with Phases 3 and 4, never before them.** FR-023 empties the stored
links Cobros reads; without US4 the collections screen can send nothing.

**⚠️ The migration (T033–T043) lands BEFORE the removal (T044–T045).** Twelve
existing test files read the roster. The constitution forbids skipping,
disabling or quarantining any of them to get green, so each is moved to the new
door first and the door is removed second.

**T036 moved to Phase 4 (2026-09-22).** T022 drops `linkUrl` and `waLink` from
`cobroRow` in that phase, so the two cases in
`apps/api/test/payment-requests.test.ts` that assert them cannot wait here: one
asserted the stored link rode the row, the other that 120 debtors each carried
one. Both were rewritten with US4, and `.specify/bugs/cobros-links-lookup-params`
records that the bind which overran D1's cap left with the lookup.

**Five of them moved in Phase 3, not here (2026-09-22).** T019 rewrites the
Links *screen*, and five files render that screen: `apps/admin/test/msw.ts`
(T011), `links.test.tsx` (T012), `identity-round.test.tsx` (T037),
`presence-freshness.test.tsx` (T038), `memberships.test.tsx` and
`shell.test.tsx` (T040), plus the Playwright stubs the screen reads through
(T039, T042). The task list assumed the screen kept reading the roster until
this phase; it does not, so those tasks came forward with it rather than
leaving the admin suite red for four phases. The API-side migration
(T033–T036) and the removals stay here, where the API doors still are.

### Test migration — real assertions to rewrite

- [X] T033 [US1] Rewrite `apps/api/test/direct-payments-links.test.ts` onto `GET /direct-payments/customers`, **keeping** the `bug: links-refused-key` case that asserts a refused key answers 503 with `WISPHUB_AUTH_FAILED`, and re-citing the roster-era `US-D07` cases as `links-on-demand-search US1`
- [X] T034 [US1] Retire the roster cases of `apps/api/test/presence-freshness.test.ts` (scenario 9: "two roster reads inside the window answer the same readAt"), recording in the file that FR-027 / D15 replaced the promise — a block is read when it renders, so no two blocks share a `readAt`. The invoice-read cases in the same file are untouched
- [X] T035 [US1] Move FR-017's proof in `apps/api/test/collections-api-test-mode.test.ts:175` from the roster to the new customers door, keeping the one-predicate rule (`realOnly`) with the same call-site coverage
- [X] T036 [US1] Fix the premise in `apps/api/test/payment-requests.test.ts:100` — "all of whom the roster had already given a link" is false after US4; the fixture must cover a debtor with no link
- [X] T037 [P] [US1] Rewrite `apps/admin/test/identity-round.test.tsx:110` ("Links: the roster reads, the share buttons wait for the CLABE") against the new screen; the CLABE gate itself is unchanged (FR-016)
- [X] T038 [P] [US1] Rebuild `apps/admin/test/presence-freshness.test.tsx` on blocks per FR-027 / D15: the age indicator is gone and its assertions with it, while the re-read on return to the tab and its 30-second floor **stay** and now apply to the first block only
- [X] T039 [US1] Rewrite `tests/e2e/keyboard.spec.ts` tab-order assertions, which rest on "the roster arrives alive on arrival" (lines 98–114); the first block arrives after a provider read, so the reading order and the wait both change

### Test migration — mechanical handler swaps

- [X] T040 [P] [US1] Swap `handlers.linksRoster` for the customers handler in `apps/admin/test/memberships.test.tsx:223` and `apps/admin/test/shell.test.tsx:167`
- [X] T041 [P] [US1] Update the stale "client roster" comment in `apps/admin/test/feedback.test.tsx:72` — comment only, no assertion changes
- [X] T042 [P] [US1] Replace the roster stub with a customers stub in `tests/e2e/stubs.ts`, `tests/design/review-foundations.spec.ts` and `tests/design/review-feedback.spec.ts`
- [X] T043 [P] [US1] Remove the dead `/direct-payments/links/search` stub from `tests/design/review-links.spec.ts` — that endpoint went in the pilot-UX round and the stub outlived it — and point its shots at the new door (D12)

### Retirement

- [X] T044 [US1] Remove `GET /direct-payments/links` and `GET /direct-payments/links/roster` from `apps/api/src/routes/direct-payments/index.ts`, and `listLinks`, `linksRoster` from its handler, with `linksListQuery`, `linksListResponse` and `linksRosterResponse` from its schema (D12)
- [X] T045 [US1] Remove `listCustomersFull`, `customersPath` and `queryParamFor` from `apps/api/src/wisphub/client.ts`, `rosterForDisplay` from `cache.ts`, and `readRoster` plus the `roster` entry of `KINDS` from `snapshot.ts`, leaving the `pending` pass and the `sweep_kind` enum untouched (D12)
- [X] T046 [P] [US1] Delete `apps/api/test/links-roster-cap.test.ts`, which tests the roster this feature retires, and add one line to `.specify/bugs/links-roster-cap/test.md` recording that the behaviour it verified was superseded by `009-links-on-demand-search` — the bug's history is not edited

### The prune

- [X] T047 [US1] Add `apps/api/src/links/prune.ts`: `PRUNE_CUTOVER_MS` as a constant citing D13, the delete of pre-cutover panel links no payment and no clave attempt references, the deletion of orphaned `roster` sweep rows, and the `link_prunes` row it writes once
- [X] T048 [US1] Join the prune to the every-minute cron in `apps/api/src/index.ts` under `waitUntil`, speaking only when it did something (constitution: one trigger)
- [X] T049 [US1] Add the notice door so the count reaches the business (FR-023): `pruneNoticeResponse` in `apps/api/src/routes/direct-payments/schema.ts`, `GET /direct-payments/prune-notice` (`payments:read`) and `POST /direct-payments/prune-notice/dismiss` (`payments:operate`, so a viewer cannot silence it for everyone) wired in `index.ts` with handlers in `handler.ts`, per [contracts/links-api.md](./contracts/links-api.md)
- [X] T050 [P] [US1] Write `apps/api/test/links-prune.test.ts` citing `links-on-demand-search US1`: a link with a payment is kept, a link with a clave attempt is kept, an API link is never touched, a post-cutover link is never touched, a second run deletes nothing and writes no second row, a deleted link's token is never reissued (FR-024), the count lands on the row, the notice door answers it once and `null` after dismissal, and a viewer cannot dismiss
- [X] T051 [US1] Add `apps/admin/src/features/links/PruneNotice.tsx` reading `GET /direct-payments/prune-notice`, showing the deleted count once and calling the dismiss door (FR-023)

**Checkpoint**: no test reads a roster, nothing creates a link in the background, and the pre-existing links are gone.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T052 Write `tests/e2e/links.spec.ts` citing `links-on-demand-search US1`: scrolling loads a second block, no horizontal scroll at 360/768/1280, measured contrast in both themes, touch targets on Copiar and WhatsApp, and a measured focus indicator
- [X] T053 Measure SC-001, SC-002 and SC-003 in `tests/e2e/links.spec.ts` against the stubbed API with a realistic provider delay, and record the numbers in the file's header comment. Assert a **generous ceiling** — 3 s interactive, 6 s to results, 20 s to find-and-send — so a page that gets slow fails a gate, while the targets themselves (1 s / 3 s / 15 s) stay measurements rather than a wall-clock that flakes on CI
- [X] T054 [P] Update `apps/api/package.json` only if a new area export is needed, and check `apps/admin/src/lib/base.ts` still resolves the door in dev
- [X] T055 Run the full gates: `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `node scripts/spec-lint.mjs`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm e2e`
- [X] T056 Walk [quickstart.md](./quickstart.md) end to end, including the count-does-not-move check for SC-004 and the no-background-creation check for SC-009
- [ ] T057 Set `PRUNE_CUTOVER_MS` to the real ship timestamp at the release commit, not before, and tell the connected ISP that roughly 6,513 links go and that a sent-but-unpaid link stops working (quickstart, *Pre-flight*)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Phase 1 for the table only; T003–T007 block every story
- **US1 (Phase 3)**: needs Phase 2. T011 (`msw.ts`) blocks T012 and every admin task in Phase 7
- **US4 (Phase 4)**: needs T014 and T017 from US1 — it reuses the create door and the action hook whole
- **US2 (Phase 5)**: needs T016, T018 and T019 from US1
- **US3 (Phase 6)**: needs T013, T018 and T019 from US1. T029 follows T025 (same test file) and T031 follows T027 (same hook)
- **Phase 7**: needs Phases 3 and 4 complete. The migration (T033–T043) precedes the removal (T044–T045); the prune follows both. T047's constant is set at T057, not at T047
- **Polish (Phase 8)**: needs everything

### User Story Dependencies

- **US1 (P1)**: independent once Phase 2 is done. This is the MVP, and it is now complete on its own — scenario 9 (T016) and the copied/sent mark (T018, T019) sit in this phase rather than leaking into US2 and US3
- **US4 (P1)**: depends on US1's create door, whose fresh read is where both the link and the number come from (D16). Independently testable — delete every link and open Cobros
- **US2 (P2)**: depends on US1's screen and `seen.ts`. Independently testable — navigate, back, reload
- **US3 (P3)**: depends on US1's handler, screen and `seen.ts`. Independently testable — take the provider away

### Parallel Opportunities

- T003 and T004 together; T005 and T006 are the same file and are not parallel
- T008, T009 and T010 together — three different API test files
- T016, T017 and T018 together — three new modules, no shared file
- T037, T038 and T040–T043 together — six different test files, once T011 has landed
- T046 and T050 together
- `seen.ts` is created once (T018), so nothing contends for it. **`useCustomers.ts` is the contended file now**: T016 creates it, and T027 (US2) and T031 (US3) each wire a store into it, so those two are sequential and US2 and US3 cannot be built in parallel end to end. Their tests (T025, T029) share `links.test.tsx` and are sequential for the same reason; the parallelism in these phases is between a story's test and another story's implementation, not between the stories

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
- FR-027 / D15 retires a promise `presence-freshness` made on this page. It is
  a recorded decision, not an implementation detail — if the product creator
  wants a per-row age instead, that changes T016, T019, T034 and T038
- Commit per task or per logical group; stop at any checkpoint to validate

---

## Phase 9: Convergence

**Appended 2026-09-22 by `/speckit-converge`.** The implementation of Phases 1–8
is complete and every gate is green; what follows is the gap between what the
spec and plan ask for and what the code currently does.

- [ ] T058 **CRITICAL** — Stop the prune from spending its one-shot ledger row while the cutover is unset: `prunePanelLinks` in `apps/api/src/links/prune.ts` must return without writing a `link_prunes` row when `cutoverMs` is `0`, so the pass is still available at the release commit, and the `deleted_count: 0` rows already written on dev must be cleared — as it stands, the first cron tick after any deploy marks every business pruned at cutover `0`, and T057 then deletes nothing forever, per FR-023 and SC-008 (contradicts)
- [ ] T059 Add the release-sequence case to `apps/api/test/links-prune.test.ts`: run the pass with `PRUNE_CUTOVER_MS` as it actually ships, assert it deletes nothing **and writes no row**, then set a real past cutover and assert the deletion still happens — every case today passes an explicit `cutoverMs` and so proves nothing about what production runs first, per FR-023 and plan D13 (missing)
- [ ] T060 Report `matched` as a floor on the offline path too: `panelLinksMatching` in `apps/api/src/routes/direct-payments/handler.ts` caps at `limit` and discards the true count, so a search with the provider away over more stored panel links than fit in one block says "N clientes coinciden" instead of "Más de N" and never asks for more characters, per FR-006 and US3 (partial)
- [ ] T061 Reconcile the `POST /direct-payments/links` error table in `specs/009-links-on-demand-search/contracts/links-api.md` with what the door can actually answer: `BUSINESS_SUSPENDED` cannot reach it, because `apps/api/src/auth/middleware.ts` revokes a suspended business's session with `ACCOUNT_SUSPENDED` (403) before any handler runs, per `contracts/links-api.md` (contradicts)
- [ ] T062 Correct the stale forward-reference in `apps/admin/src/features/links/LinksScreen.tsx` — the offline-note comment still says "US3 (T030) makes the door answer `wisphub: 'unavailable'` … until then it is a background read that failed", which describes code that no longer exists — per Constitution I and FR-014 (partial)
