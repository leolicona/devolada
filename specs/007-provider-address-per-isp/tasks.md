---

description: "Task list for 007 — Provider Address per ISP"
---

# Tasks: Provider Address per ISP

**Input**: Design documents from `/specs/007-provider-address-per-isp/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/integrations.md](./contracts/integrations.md), [quickstart.md](./quickstart.md)

**Tests**: included, and not optional here. Constitution IV requires the API
layer to run in workerd against a real D1 with providers intercepted at their
real origin, and VII requires every test file to cite its story. Every test
task below carries `provider-address-per-isp US<n>`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished work)
- **[Story]**: US1 / US2 / US3, mapping to spec.md
- Every task names the file it touches

---

## Phase 1: Setup

**Purpose**: settle the one fact the catalogue ships, before anything is built
on it.

- [!] **BLOCKED — attempted 2026-09-18, recorded in research.md.** T001 Verify the pilot's installation answers the provider API — run the `curl` in [quickstart.md](./quickstart.md) ("Before implementing") with the pilot's real key against `https://api.wisphub.io/api/clientes/?limit=1`, and record the status code in `specs/007-provider-address-per-isp/research.md` under "Carried, not resolved here". A non-200 stops T003 until the right host is known.
- [!] **BLOCKED — same reason as T001.** T002 While the key is in hand, compare `OPTIONS /facturas/` with and without the invoice permission (research D7) and record the answer in `specs/007-provider-address-per-isp/research.md`. If it discriminates, **T027** (the `testKey` rewrite) can verify three of the four writes, and FR-011 can be widened back toward its original wording.

**Checkpoint**: **not met.** Both probes were attempted and neither left the
session: the implementing environment's egress refuses the CONNECT to
`api.wisphub.io` and `api.wisphub.net` alike (`403`), and no pilot key was
available. The attempt and what follows from it are recorded in
[research.md](./research.md) under "T001 / T002".

T003 therefore ships `wisphub_io` **with its note intact** — nothing answered,
so there is no evidence the entry is wrong, only none that it is right. This is
not the "non-200" that was to stop T003. The call still has to be made with the
pilot's real key, from a machine with egress, **before T036** points their row
at that entry.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the catalogue, the column and the factory. Every story rests on
these.

**⚠️ No user story work begins until this phase is complete.**

- [X] T003 Create the installation catalogue in `apps/api/src/wisphub/installations.ts` — `InstallationKey`, `Installation`, `INSTALLATIONS`, `installationByKey`, `defaultInstallation`, with the three entries and hosts from [data-model.md](./data-model.md). Pure data: no import from `src/db`, `src/auth`, Hono or Drizzle (research D3). Cite `provider-address-per-isp D1/D2/D3`, and carry the note on `wisphub_io` that T001 either retires or corrects.
- [X] T004 [P] Add the catalogue invariants test in `apps/api/test/installations.test.ts` citing `provider-address-per-isp US1` — keys unique, every `host` `https` and inside the provider's domain family, exactly one `isDefault`, `kind` set on every entry. This is what stands in for a generator (research D2).
- [X] T005 [P] Export the catalogue as `"./installations": "./src/wisphub/installations.ts"` in `apps/api/package.json`, so the admin can import it (research D3).
- [X] T006 Add `installation: text("installation")` to the `integrations` table in `apps/api/src/db/schema.ts` — nullable, no default, with a comment citing `provider-address-per-isp D1/D5/D6` explaining that null means "not chosen" and resolves to the platform default.
- [X] T007 Generate the migration with `pnpm --filter @devolada/api db:generate` and confirm `apps/api/migrations/` gained a single additive `ALTER TABLE integrations ADD COLUMN installation TEXT` — nothing else (research D6). Apply locally with `db:migrate:local`.
- [X] T008 Create the provider-client factory in `apps/api/src/wisphub/factory.ts` — `wisphubFor(integration, env)` resolving `integration.installation` → catalogue host, else `env.WISPHUB_BASE_URL`, else `DEFAULT_BASE_URL` ([data-model.md](./data-model.md), research D4/D5). An unknown key resolves to the default rather than throwing (constitution VIII). Cite `provider-address-per-isp D4`.
- [X] T009 Route the four call sites in `apps/api/src/routes/direct-payments/handler.ts` through `wisphubFor`.
- [X] T010 [P] Route both call sites in `apps/api/src/direct-payments/provisional.ts` through `wisphubFor`.
- [X] T011 [P] Route the call site in `apps/api/src/direct-payments/validation.ts` through `wisphubFor`.
- [X] T012 [P] Route the call site in `apps/api/src/reconnection/queue.ts` through `wisphubFor` — the sweep loads the integration row per business already, so it passes that row, never a platform value.
- [X] T013 [P] Route the call site in `apps/api/src/routes/payments/handler.ts` through `wisphubFor`.
- [X] T014 [P] Route the call site in `apps/api/src/routes/payment-requests/handler.ts` through `wisphubFor`.
- [X] T015 Give `testKey` in `apps/api/src/routes/integrations/handler.ts` its own resolution path — it tests a key and an installation that are **not yet saved**, so it resolves the catalogue directly rather than from a stored row (contracts/integrations.md, "Behaviour"). This is the eleventh call site and the only one that does not read `integration.installation`.
- [X] T016 Update the `WISPHUB_BASE_URL` comment in `apps/api/src/env.ts` to say it is the platform **default** for businesses that recorded none, not an override (research D5), keeping the "unset means" sentence constitution VIII requires.

**Checkpoint**: `grep -rn "new WispHub(" apps/api/src | grep -v wisphub/factory.ts` returns nothing. Every story can now begin.

---

## Phase 3: User Story 1 — An ISP connects on their own installation (Priority: P1) 🎯 MVP

**Goal**: an ISP picks their installation from a closed list, pastes their key, and their roster loads — with no deploy, and with every existing business untouched.

**Independent Test**: create a business, choose a non-default installation, save a key valid there, confirm the roster loads from that installation; then confirm a business with no installation recorded behaves exactly as before.

### Contract, then tests, then implementation for User Story 1

> The contract lands first because the tests import it — see "Within each
> story" below (`/speckit-analyze` finding I4).

- [X] T017 [US1] Add `installationKey`, `installation` and `effectiveInstallation` to `wisphubIntegration`, and `installation` to `wisphubPatchRequest`, in `apps/api/src/routes/integrations/schema.ts` per [contracts/integrations.md](./contracts/integrations.md). `host` stays out of the response on purpose.
- [X] T018 [P] [US1] API test in `apps/api/test/integrations-installation.test.ts` citing `provider-address-per-isp US1` — saving an installation stores the key and resolves its host; a business with `installation` null resolves to the platform default and its provider calls still reach the pinned origin (FR-002, SC-006); a value outside the catalogue is rejected at the write path (FR-005).
- [X] T019 [P] [US1] Component test in `apps/admin/test/integrations.test.tsx` citing `provider-address-per-isp US1` — the picker renders the three entries with the test installation visibly marked, the saved installation shows beside the key tail, and a business with none shows the resolved one marked as assumed. MSW answers the contract; `axe` runs on the screen.

### Implementation for User Story 1

- [X] T020 [US1] Persist and read the installation in `apps/api/src/routes/integrations/handler.ts` — `toWisphub` returns `installation` and the resolved `effectiveInstallation` with its `assumed` flag; `patchWisphub` accepts and validates the key against the catalogue.
- [X] T021 [US1] Add the installation picker to `apps/admin/src/features/integrations/WispHubScreen.tsx` — a closed choice from `@devolada/api/installations`, es-MX labels, the test entry marked with `StatusBadge` (icon + text, never colour alone), sized per the declared scale and readable at the 360px floor (constitution VI). When the business already has links, changing the installation asks for confirmation first and says plainly what is not protected — the spec's **Deferred** outcomes are reachable through this control and should be a conscious act, not a stray click (`/speckit-analyze` finding U1).
- [X] T022 [US1] Show the installation in use beside the key tail in `apps/admin/src/features/integrations/WispHubScreen.tsx`, with the same prominence (FR-004), and word the assumed case so the ISP can tell a default from a choice.
- [X] T023 [US1] Add the "not on the list" path to `apps/admin/src/features/integrations/WispHubScreen.tsx` (FR-006) — plain es-MX saying Devolada does not reach that installation yet and how to ask, with no free-text field anywhere on the screen.

**Checkpoint**: an ISP on any listed installation can connect from the panel alone. MVP is deliverable here.

---

## Phase 4: User Story 2 — A failed connection says which thing is wrong (Priority: P2)

**Goal**: three failures read as three different problems, each naming the installation tried, and none blaming a key that is valid.

**Independent Test**: seed each failure against a test business and confirm a distinct outcome and the installation label, with the key absent from every response and log line.

### Contract, then tests, then implementation for User Story 2

- [X] T024 [US2] Replace `code` with `outcome`, `triedInstallation`, `verified`, `unverified` and `missingPermission` in `WispHubTestResponse` in `apps/api/src/routes/integrations/schema.ts` per [contracts/integrations.md](./contracts/integrations.md).
- [X] T025 [US2] API test in `apps/api/test/integrations-installation.test.ts` citing `provider-address-per-isp US2` — an unreachable host gives `INSTALLATION_UNREACHABLE`, a 403 gives `KEY_REJECTED`, a refused permission gives `PERMISSION_MISSING`, and success gives `OK` with the three reads in `verified` and the four writes in `unverified`. Assert `triedInstallation` on all four, and assert the fixture key appears in no response body **and in no captured log line** — FR-013 covers "no message **and no record**", and the adapter already logs provider failures (`/speckit-analyze` finding G2).
- [X] T026 [US2] Component test in `apps/admin/test/integrations.test.tsx` citing `provider-address-per-isp US2` — each outcome renders its own message and names the installation; the rejected-key case must not tell the owner their key is wrong; the missing-permission case must not report the connection as healthy.

### Implementation for User Story 2

- [X] T027 [US2] Rewrite `testKey` in `apps/api/src/routes/integrations/handler.ts` to probe the three reads Devolada needs — the customer list, the invoice list and the payment methods — and to map the adapter's failures onto the four outcomes. It never attempts a write (research D7). Cite `provider-address-per-isp D7`.
- [X] T028 [US2] Make the test run against the installation **being saved** in `apps/api/src/routes/integrations/handler.ts` — the one in the patch if present, the stored one otherwise (FR-009). Saving stays unblocked by a failed test (settings D3).
- [X] T029 [US2] Widen the `wisphubTest` projection on the PATCH answer in `apps/api/src/routes/integrations/handler.ts` — it currently sends `{ ok, code }`, and T024 retires `code`. Save-then-test is the path an ISP actually uses, so without this US2 ships unable to tell the three failures apart exactly where they are first met (`/speckit-analyze` finding G1). Carry `outcome`, `triedInstallation`, `verified` and `unverified`, and update `IntegrationsResponse` in `schema.ts` to match.
- [X] T030 [US2] Rewrite the three-branch message block in `apps/admin/src/features/integrations/WispHubScreen.tsx` against `outcome`. The current "WispHub rechazó esta llave. Revísala en tu panel." is the line this story exists to stop showing when the key is fine.
- [X] T031 [US2] Show what was and was not verified in `apps/admin/src/features/integrations/WispHubScreen.tsx` — plain es-MX naming the four write permissions as first exercised by a real payment, so a healthy connection never claims more than it proved (research D7).

**Checkpoint**: an ISP can diagnose a failed connection without contacting support.

---

## Phase 5: User Story 3 — Several ISPs on different installations at once (Priority: P3)

**Goal**: two businesses on two installations both collect, and neither reaches the other's.

**Independent Test**: two businesses on two intercepted origins, one payment each, and the assertion that the other origin received nothing.

### Tests for User Story 3

- [X] T032 [US3] Isolation test in `apps/api/test/installation-isolation.test.ts` citing `provider-address-per-isp US3` — intercept a second provider origin beside the pinned one (research D8); confirm a payment for each business; assert each registration landed on its own origin **and that the other origin received nothing at all** for that business. The negative assertion is the one that catches a missed call site.
- [X] T033 [US3] Degradation test in `apps/api/test/installation-isolation.test.ts` citing `provider-address-per-isp US3` — one origin unreachable queues only its own business's action with a visible status, while the other business collects and reconnects normally (FR-012).
- [X] T034 [US3] Structural guard in `apps/api/test/installation-isolation.test.ts` citing `provider-address-per-isp US3` — assert no `new WispHub(` outside `apps/api/src/wisphub/factory.ts`, so the twelfth call site cannot appear unnoticed (research D4, constitution V "auditable with grep"). It lives here, not in `installations.test.ts`, so that no test file carries two story citations and US1 can ship without US3 editing its files (`/speckit-analyze` finding C1).

### Implementation for User Story 3

- [X] T035 [US3] Fix whatever T032–T034 expose in `apps/api/src/wisphub/factory.ts` and the routed call sites. **Closed empty.** All three passed on their first run against the Phase 2 code, with nothing changed in the factory or in any routed call site — the phase found what it hoped to find. It was not a vacuous pass: T034 was checked by re-introducing `new WispHub(...)` in `apps/api/src/routes/payments/handler.ts`, which failed the guard by name (`expected [ '../src/routes/payments/handler.ts' ] to deeply equal []`) before being reverted.

**Checkpoint**: onboarding a second ISP costs the first nothing. All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: settle the spec gap, pay the debt this feature was written to remove, and prove the whole thing.

- [!] **BLOCKED — a deployed-environment action, not a change to this tree.** T036 Point the pilot's business row at its installation from `/integrations/wisphub` in `apps/admin`, and confirm its roster loads — the "Release" steps in [quickstart.md](./quickstart.md). Set it through the panel, never by writing the row, so the path an ISP uses is the path that gets proven. *The implementing session has no access to the deployed dev or prod panel and no pilot account. Production carries zero connected integrations (measured 2026-09-18), so T037 landing first regressed nobody — the row is set when the pilot connects. **Make the `api.wisphub.io` probe (T001) with their real key before pointing the row there.***
- [X] T037 Remove `WISPHUB_BASE_URL` from `env.dev.vars` and `env.prod.vars` in `apps/api/wrangler.jsonc`, and the two stopgap comments with it. **This must land in the same release as T036** or the platform default keeps overriding every business that chose nothing (research D5). *Both bindings and both comments are gone. Safe ahead of T036 on the prod side for the reason the removed comment itself recorded — zero connected production integrations — and on the dev side it is the fix for T038 rather than a risk to it.*
- [!] **BLOCKED — needs the deployed dev API, which exists only after this merges.** T038 Confirm the demo tenant `FastIsp` works on dev again after T037 — verify from `/integrations/wisphub` in `apps/admin` and from a roster read, not from the row. It has been failing by design since the stopgap comments landed in `apps/api/wrangler.jsonc`. *The code change that should restore it has landed (T037); the confirmation is the first thing to do once Deploy Dev is green.*
- [X] T039 Close the debt in `.specify/debt/wisphub-host-is-platform-wide/debt.md` with `/speckit-debt-pay`, running the three exit checks that entry already carries. Its "Trigger: already met" note is what T037 answers. **Verdict: `partial`, so the entry stays open** — all three exit checks hold on the tree and every anchor that should be gone is gone, but the entry's step 4 is two things and only one of them is a code change: the pilot's row (T036) is still unset. Recorded in `.specify/debt/wisphub-host-is-platform-wide/payment.md`; it closes when T036 and T038 are done.
- [X] T040 [P] Update the WispHub row in `specs/006-production-launch/contracts/environment.md` — the platform no longer names a host for every tenant; the ISP chooses one in the panel.
- [X] T041 [P] Update the integration step in `specs/006-production-launch/quickstart.md` so onboarding reads "paste your key **and** pick your installation", which is what it has actually been since the provider ran more than one.
- [X] T042 [P] Add the installation picker to the browser layer in `tests/e2e/` — real contrast in both themes, touch-target size, no horizontal scroll at 360/768/1280 (constitution IV: the questions happy-dom cannot answer).
- [X] T043 Run the full gate listed in `specs/007-provider-address-per-isp/quickstart.md` — `scripts/spec-lint.mjs`, `scripts/gen-banks.mjs --check`, `scripts/contrast-lint.mjs`, `scripts/pending-lint.mjs`, workspace typecheck, workspace tests, `pnpm e2e`. *All green: spec-lint 66 files, gen-banks 97 banks in step, contrast-lint 34 pairs at AA in both themes, pending-lint 27 labels, typecheck across 4 workspaces, 751 tests, 67 browser tests. One thing the gate caught on the way: the WispHub fixture in `apps/admin/test/a11y.test.tsx` was hand-written beside the contract rather than parsed against it, so the new fields made the screen render nothing and axe reported a 5s timeout instead of a missing field. Fixed by parsing it with `integrationsResponse`, which is how the rest of the admin fixtures already work.*

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T002)**: no dependencies, and sequential — both append to `research.md`. T001 gates T003's host value.
- **Foundational (T003–T016)**: blocks all three stories. T003 → T004/T005; T006 → T007; T008 → T009–T015.
- **US1 (T017–T023)**: after Foundational. T017 (the contract) lands before its tests, because they import it. Delivers the MVP.
- **US2 (T024–T031)**: after Foundational. Independent of US1 — it changes the test's *answer*, not the address's *storage*. T024 (the contract) lands before its tests, same reason.
- **US3 (T032–T035)**: after Foundational. Proves what Phase 2 built; expected to find little if T008–T015 were done well.
- **Polish (T036–T043)**: T037 depends on T036. T039 depends on T037 and T038.

### Within each story

The contract (`schema.ts`) lands **first**, because the tests import it and
would not compile without it. Then the tests, written to fail. Then the
handler, then the screen. The template's "tests before everything" does not
survive contact with a typed contract, and pretending otherwise is how a
phase stalls on its first task (`/speckit-analyze` finding I4).

### Parallel Opportunities

- **T009–T014** touch six different files and are the bulk of Phase 2 — the widest parallel window in the feature. T009 is not marked `[P]` only because it is four edits in one file.
- **T004 and T005** run alongside each other once T003 exists — different files.
- **US1 and US2 are genuinely independent** once Phase 2 is done — one developer on the storage and the picker, one on the outcomes and the messages. They meet in three files, so those tasks are **not** marked `[P]` and must be sequenced: `schema.ts` (T017, T024), `apps/api/test/integrations-installation.test.ts` (T018, T025) and `apps/admin/test/integrations.test.tsx` (T019, T026). Land the US1 task of each pair first (`/speckit-analyze` finding I2).
- **T040, T041, T042** are three separate files in Phase 6.
- **`[P]` is checked, not assumed**: no two `[P]` tasks name the same file anywhere in this list.

---

## Parallel Example: Phase 2 call-site routing

```bash
# After T008 lands the factory, these six run together — different files:
Task: "Route apps/api/src/direct-payments/provisional.ts through wisphubFor"      # T010
Task: "Route apps/api/src/direct-payments/validation.ts through wisphubFor"        # T011
Task: "Route apps/api/src/reconnection/queue.ts through wisphubFor"                # T012
Task: "Route apps/api/src/routes/payments/handler.ts through wisphubFor"           # T013
Task: "Route apps/api/src/routes/payment-requests/handler.ts through wisphubFor"   # T014
Task: "Give testKey its own resolution path in routes/integrations/handler.ts"     # T015
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 — confirm the host. A wrong catalogue entry leaves the pilot where they are today.
2. Phase 2 — catalogue, column, factory.
3. Phase 3 — the contract, the resolution and the picker.
4. **Stop and validate**: an ISP on `wisphub.io` connects from the panel, and every existing business is untouched.
5. This is shippable. The pilot is unblocked without the stopgap.

### Incremental delivery

1. Setup + Foundational → nothing visible, everything resting on it.
2. + US1 → the pilot connects (**MVP**).
3. + US2 → a failed connection is diagnosable without support.
4. + US3 → proven safe for the second ISP.
5. + Polish → the stopgap comes out and the debt closes.

### Sequencing constraints outside this feature

- **Not the same week as `.specify/bugs/customer-lookup-misses`** — it edits `apps/api/src/wisphub/client.ts`, which T003 and T008 sit beside, and it is the more urgent of the two if the pilot's usuarios turn out to lack `@`.
- **T036 and T037 ship together.** Splitting them across releases leaves the override in place, which is the debt unpaid while looking paid.

---

## Notes

- `[P]` means a different file and no unfinished dependency.
- Every test file cites `provider-address-per-isp US<n>` (constitution VII); `spec-lint` checks it.
- Commit per task or per logical group; every non-obvious rule carries its `provider-address-per-isp D<n>`.
- Phase 5 may find nothing. That is a pass, not a wasted phase — T032's negative assertion is the only thing that can prove Phase 2 was complete.
- FR-011 was amended in `spec.md` on 2026-09-18 rather than scheduled as a task here, so no phase implements code the spec contradicts (`/speckit-analyze` finding I1).

---

## Phase 7: Convergence

**Purpose**: what an assessment of the tree against `spec.md`, `plan.md` and
`tasks.md` found still unbuilt, appended by `/speckit-converge` on 2026-09-18.
The four `[!] BLOCKED` tasks above are deliberately **not** repeated here —
none of them is a change to this tree, so none of them is work
`/speckit-implement` can pick up.

- [X] T044 [US1] Save the picked installation together with the key in `apps/admin/src/features/integrations/WispHubScreen.tsx` — "Guardar llave" patches `{ wisphubApiKey }` on its own, so an ISP who picks their installation and then saves their key has that key tested against the address they just moved away from and reads "wisphub.net rechazó esta llave" for a key that is perfectly good. That is the exact line this feature exists to stop showing. `wisphubPatchRequest` and `patchWisphub` already accept a key and an installation in one patch and re-test against the one being saved, so this is the screen catching up to its own contract. Carry the confirmation gate with it: a connected business whose key save also moves the installation must still be asked first (T021). Add the component test that presses the two controls in the order an ISP actually uses them. per US1/AC1, FR-009 (partial) *One `submit(patch)` now adds the installation whenever the picker differs from the one in use, so "Guardar llave" and "Guardar instalación" send the same complete connection, and the confirmation covers both — moving installations is the same act whether it rides a key or goes alone. The key field says what is about to be saved before the button is pressed. The API needed nothing: T017 and T028 already accepted both in one patch and tested the one being saved, and `test/integrations-installation.test.ts` already proved it, which is why the three new tests are all at the component layer. Each was checked against the old screen and failed there.*
- [X] T045 [US2] Test the pairing the ISP is looking at, in `apps/api/src/routes/integrations/schema.ts` and `apps/admin/src/features/integrations/WispHubScreen.tsx` — "Probar conexión" posts `{ apiKey }` only and `wisphubTestRequest` carries no installation, so an ISP correcting a wrong pick is told about the installation they are leaving rather than the one they chose. Add `installation` to `wisphubTestRequest`, send the picker's value, and keep the stored one as the fallback when the request names none. per US1/AC6, SC-004 (partial) *`wisphubTestRequest` gained `installation`, and `testWisphubKey` resolves it before the stored row. The panel sends it only while the pick differs from what is in use — naming the resolved installation on every request would freeze the platform default into it and take `WISPHUB_BASE_URL` out of the resolution for rows that chose nothing (D5). Proved at both layers, and both directions of the rule were checked by sabotage: dropping the field and always sending it each fail a different test.*
- [X] T046 Carry the installation in the provider cache keys in `apps/api/src/wisphub/cache.ts` — `keyFor` carries only `businessId`, so for the ten minutes after a business changes installation the cash payment-method id minted on the OLD one is still served to `registerPayment` on the money path (`wisphub/reconnection.ts`), and the roster and pending lists for thirty seconds. The spec's *Deferred* section names two things an installation change does not protect; this is a third, and unlike those two it is reachable only through the control this feature added. per FR-003, spec *Deferred* (missing) *`keyFor` carries the address the answer came from, which the adapter now exposes as a readonly `baseUrl` — asking the instance is the only source that cannot drift from where the call actually went. A change of installation is a new key, so it invalidates itself and the old entries expire unread; nothing has to remember to clear anything. Proved in `test/installation-isolation.test.ts` by one business across two installations in time, and the test was checked by reverting the key: it fails naming the untouched `formas-de-pago` interceptor on the new installation.*
