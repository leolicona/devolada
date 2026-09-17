---

description: "Task list for consta-api-merge"
---

# Tasks: consta-api-merge

**Input**: Design documents from `/specs/004-consta-api-merge/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: mandatory here, not optional. FR-017 requires every behaviour the
engine's tests prove today to be proven again after the move, constitution IV
puts the engine's tests in workerd against a real D1 with the provider
intercepted at its real origin, and constitution VII requires every test to
cite its story. Moved tests keep their archive-era `US-V##` citations; every
rewritten or new test cites `consta-api-merge US<n>`.

**Organization**: grouped by user story so each can be implemented and tested
on its own. Note the one exception the dependency graph names: US1 deletes a
directory the deploy pipeline still visits until US2 edits it, so a *merge*
needs US1 and US2 together.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US4, mapping to the spec's user stories
- Every task names the file it touches

## Decision citations

Code comments cite `consta-api-merge D<n>`, tabled in
[plan.md](./plan.md#decisions). D1, D9, D13 are the clarify answers; D2–D8,
D10–D16, D18 come from research; D17 from the spec's Assumptions.

**Moving a file means moving its comments.** Every `D<n>` the engine carries
today — `validation spec D1–D19`, `proof-extraction D<n>`, `trust-layer D<n>`,
`learned-retry D<n>` — survives verbatim in its new home (FR-016, SC-011).
T001 records the counts; T047 checks them. Use `git mv` so history follows.

---

## Phase 1: Setup

**Purpose**: know what green looks like before anything moves, and land the
law before the code departs from it.

- [X] T001 Install and baseline: `pnpm install --frozen-lockfile`, then run every gate in CI order — `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test` — and record the results in the task notes (expected at `31c4c71`: 265 API tests, 71 Consta tests, all green). Then record the citation baseline for SC-011: for each file under `apps/consta/src/` run `git show 31c4c71:<path> | grep -o "D[0-9][0-9]*" | sort | uniq -c` and save the per-file lists to `specs/004-consta-api-merge/baselines/citations.md`. A gate that was already red, or a citation count taken after the move, proves nothing.
- [X] T002 [P] Amend the constitution with `/speckit-constitution` exactly as [research.md R14](./research.md#r14--the-constitution-amendment-this-plan-proposes) lists: stack table API row and Environments row, Principle III's Consta parenthetical, Principle IV's two mentions, Principle V's key bullet replaced by the `business_id` rule and the D4 exception, Principle VIII's example and its base-URL sentence. MINOR bump. First check `git log origin/main -- .specify/memory/constitution.md`: if v1.2.0 (the `003` amendment) has landed, also rewrite its Principle III sentence that names `apps/consta` as a program-facing surface — the engine is a component, not a surface; the `/v1/*` grant is untouched. Cite D15 in the Sync Impact Report. The amendment leads the code on purpose, as v1.1.0 did. **Done 2026-09-16 as v1.3.0, stacked on PR #197's v1.2.0 in the same PR (#199); `/speckit-analyze` finding C3 (the reader binding) went in with it, and #197's Principle III example list now names `/v1/*` alone.**

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the tables the engine writes, the bindings it reads, the pins the
tests need, and the helpers every moved test imports. None of it changes
product behaviour; the old client keeps working until US1 replaces it.

**⚠️ CRITICAL**: T003–T007 land before any engine file moves.

- [X] T003 Add `validations` and `extractions` to `apps/api/src/db/schema.ts` exactly as [data-model.md](./data-model.md) specifies: every column the Consta tables carry, `api_key_id` replaced by `business_id` (text, NULL, references `businesses.id`), indexes `(business_id, created_at)` on both and `(business_id, customer_ref)` on `validations`. Carry the tables' block comments over from `apps/consta/src/db/schema.ts` verbatim (D6/D15 append-only law, D8 never-the-image, D9 refusals logged) and add, on `business_id`, a comment citing D3 ("NULL is the platform's own top-up, prepaid-credit D6") and, on `customer_ref`, one citing D5 (the link's own customer, undisguised). Retire `businesses.consta_api_key` in place: keep the column declared, replace its comment with one citing D11 — never read, never written, not dropped because the PR preview shares the dev database with the running Worker (research R10).
- [X] T004 Generate the migration with `pnpm --filter @devolada/api db:generate` and rename it `apps/api/migrations/0028_consta_api_merge.sql` (update `meta/_journal.json` to match, as `0018_phase2_foundation.sql` did). Read it before applying: it must contain only `CREATE TABLE` and `CREATE INDEX` — no `DROP`, no `ALTER` of an existing table (D13, the additive rule). Apply with `pnpm --filter @devolada/api db:migrate:local`.
- [X] T005 Add to `Bindings` in `apps/api/src/env.ts`: `APICEP_TOKEN?`, `APICEP_BASE_URL?`, `APICEP_DEADLINE_MS?`, `AI?: Ai`, `EXTRACTION_MODEL?`, each with the "unset means" comment from [contracts/configuration.md](./contracts/configuration.md) (constitution VIII); carry the reasons over from `apps/consta/src/env.ts` (validation spec D2, D16; proof-extraction D1, D5). Leave `CONSTA_*` and `CUSTOMER_REF_SECRET` in place for now — T045 removes them once nothing reads them.
- [X] T006 In `apps/api/wrangler.jsonc` add `"ai": { "binding": "AI" }` and the var `EXTRACTION_MODEL` (`@cf/mistralai/mistral-small-3.1-24b-instruct`) to the top-level block, `env.dev` and `env.prod` — repeated in each because an env's block replaces the top-level one, the rule `EMAIL_FROM` already documents. Carry the model comment over from `apps/consta/wrangler.jsonc` (proof-extraction D5: "replacing it is a deploy and not a release"). Leave `CONSTA_BASE_URL` and the prod comment for T045.
- [X] T007 Pin the provider in `apps/api/vitest.config.ts` — `APICEP_BASE_URL: "https://api.apicep.cloud"`, `APICEP_TOKEN: "test-apicep-token"` — beside the WispHub and Resend pins, with the same reason stated (a developer's `.dev.vars` pointing at the sandbox must not redirect the suite; constitution IV). In `apps/api/test/setup.ts`, throw when `env.APICEP_BASE_URL` is not the pinned origin, as the file already does for WispHub. Cite D12.
- [X] T008 [P] `git mv apps/consta/sandbox/apicep-mock.mjs apps/api/sandbox/apicep-mock.mjs` and add `"sandbox": "node sandbox/apicep-mock.mjs"` to `apps/api/package.json` scripts. The mock's header still says "Consta must say pending" in its scenario table — leave the scenarios, change "Consta" to "the engine" only where the sentence would otherwise name a Worker that no longer exists.
- [X] T009 [P] Make `scripts/gen-banks.mjs` write one constant — `apps/api/src/direct-payments/banks.ts` — and check one; update the header ("One vocabulary, two places that must agree: apiCEP's contract file and the product's constant"), and `scripts/banks.data.md` lines 4–5 to name one file. Cite D14. `node scripts/gen-banks.mjs --check` must pass before and after.
- [X] T010 [P] Create `apps/api/test/consta/helpers.ts` from `apps/consta/test/helpers.ts`: keep `PNG`, `JPEG`, `PDF`, `NOT_A_FILE`, `fenced`, `aiReturning` and their comments; replace `seedApiKey` with `seedValidations(businessId | null, rows)` (inserts into the API's `validations` with `business_id`) and add `putProof(key, bytes, contentType)` (writes to `env.PROOFS`); re-export `seedBusiness` from `../helpers` so every engine test seeds a real business row for the foreign key. Depends on T003.

**Checkpoint**: the tables exist, the bindings are declared, the pins hold, and
the old HTTP client still passes every test.

---

## Phase 3: User Story 1 — The product validates its own payments (P1) 🎯 MVP

**Goal**: validation runs inside the API, in the same process that took the
payment, with every verdict, wording and schedule identical to today.

**Independent test**: run the API suite with the provider intercepted at
`https://api.apicep.cloud` and no other origin registered; walk every outcome
by hand against the sandbox (quickstart, US1). Needs nothing from US2–US4.

### The engine moves (D1, D17)

- [X] T011 [US1] `git mv apps/consta/src/provider/apicep.ts apps/consta/src/provider/types.ts` → `apps/api/src/consta/provider/`. In `apicep.ts` replace the two `Math.round(x * 100)` (the CEP amount, the OCR reading) with `amountToCents` from `../../wisphub/money` and say why in the comment (D18, constitution II); leave `amount: input.amountCents / 100` as it is with a comment citing D18 (the provider takes a number). Do **not** move `apps/consta/src/provider/banks.ts` — it is generated, and the API's own copy is the one constant now (T009).
- [X] T012 [P] [US1] `git mv apps/consta/src/extraction/{reader,gate,shape,index}.ts` → `apps/api/src/consta/extraction/`. Point every `BANKS` import at `../../direct-payments/banks`. In `gate.ts` replace `Math.round(reading.amount * 100)` with `amountToCents` (D18). In `shape.ts` import `validations` from `../../db/schema` and add, above `loadShapeRules`, the D4 citation: the read is across every business on purpose — a rule about a bank, derived from pairs Banxico proved, returning a pattern and never a row. In `index.ts` change `extractProof(env, receiptUrl)` to `extractProof(env, proof: LoadedProof)` — routing by magic bytes is unchanged, only the fetch leaves (D7).
- [X] T013 [P] [US1] Rewrite `apps/consta/src/extraction/fetch.ts` as `apps/api/src/consta/extraction/proof.ts` (`git mv`, then edit): keep `MAX_PROOF_BYTES`, `sniff`, `sha256Hex` and the `ProofFetchError` class with codes `PROOF_NOT_FOUND` (new), `PROOF_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`; export `loadProof(bytes: Uint8Array): Promise<LoadedProof>` (ceiling → sniff → hash) and `readProofFromBucket(bucket: R2Bucket, key: string)` (a missing object is `PROOF_NOT_FOUND`). Delete `fetchProof`, `isBlockedHost`, `readCapped` and the redirect handling, and record in the header why they left: they guarded a URL any integrator could pass, and there is no integrator (D7, FR-008). Keep the D7 paragraph about the magic bytes deciding the route.
- [X] T014 [P] [US1] `git mv apps/consta/src/trust/history.ts apps/api/src/consta/trust/history.ts`. `trustBlock(db, businessId, customerRef, current, now)` filters `eq(validations.businessId, businessId)` where it filtered the key; the `(business_id, customer_ref)` index carries it. Cite D3 beside the filter; every trust-layer D<n> stays.
- [X] T015 [P] [US1] `git mv apps/consta/src/retry/suggest.ts apps/api/src/consta/retry/suggest.ts`. The 28-day window keeps reading every business; add the D4 citation above the query — Banxico's latency per bank pair is not a tenant's fact, and a cell partitioned by business would meet its thirty-sample floor later for nobody's benefit.
- [X] T016 [P] [US1] `git mv apps/consta/src/routes/validate/schema.ts apps/api/src/consta/request.ts`. Replace `receiptUrl: z.string().url()` with `receipt: z.object({ proofKey: z.string().min(1) })` and update the `superRefine` messages ("exactly one of transfer or receipt"; "providerOcr only applies to the receipt door"). `BANKS` from `../direct-payments/banks`. Every D12/D13/D17 comment stays; add one line citing D8: the guard runs in-process now, before any credit, and a refusal writes no row.
- [X] T017 [US1] Turn `apps/consta/src/routes/extract/index.ts` into `apps/api/src/consta/extract.ts` (`git mv`, then edit): keep `shapeSignals`, `recordExtraction`, `extractionFailure`, `readingPayload` with their D9/D15/D16 comments; `recordExtraction(db, owner, …)` writes `businessId: ownerId(owner)`; `amountCents` uses `amountToCents` (D18); replace the Hono route with `export async function extract(env, db, owner, { proofKey })` — read the bucket (T013), `extractProof` (T012), signals, record, payload — returning `ConstaReading`, and mapping `ProofFetchError` / `ReaderError` through `extractionFailure` into `ConstaError`. Delete the `zValidator` block and `apps/consta/src/routes/extract/schema.ts`. Depends on T012, T013, T016.
- [X] T018 [US1] Turn `apps/consta/src/routes/validate/index.ts` into `apps/api/src/consta/validate.ts` (`git mv`, then edit): `export async function validate(env, db, owner, request): Promise<ConstaVerdict>`. Run the T016 guard first (`safeParse` → `REQUEST_REJECTED` with `issues`, nothing written). On the receipt door read the bytes from the bucket (T013) and, only when the file takes the provider's route — a PDF, or `providerOcr` — build `receiptUrl` with `signedProofUrl(env, proofKey, now)` from `../direct-payments/proofs` (direct-payment D12: the link exists for the provider). Every `apiKeyId` becomes `ownerId(owner)`. A `ProviderFailure` is rethrown as `ConstaError` carrying `code`, `retryable`, `retryAfter`, `hint`, `missingFields`, after the D15 billed-failure row is written exactly as today. The success object is the same `data: { … }` the route returned, now returned directly. **Every comment stays** — the D3/D8/D11/D15/D16/D18/D19 paragraphs, the Azteca measurement, the `providerOcr` reasoning. Depends on T011–T017.
- [X] T019 [US1] Replace `apps/api/src/consta/client.ts` with `apps/api/src/consta/index.ts` per [contracts/engine.md](./contracts/engine.md): `export type Owner`, `export function consta(env, db, owner)` returning `{ validate, extract }`, `ownerId(owner)`, and `ConstaError` with the eleven-code union and `retryable` (the class keeps its name, D17). Keep every exported type — `ConstaRequest` (receipt door now `{ receipt: { proofKey } }`), `ConstaBeneficiary`, `ConstaVerdict` (widened with `source`, `extractionId`, `shape`, `hint`, `cepStatus`, `downloads`), `ConstaTrust`, `ConstaGate`, `ConstaReading` — and their comments. Delete `CONSTA_TIMEOUT_MS` and its paragraph, replacing it with two lines citing D10: one process, one listener, the engine's 25 s is the deadline. Cite D2 and D6 in the header. `git rm apps/api/src/consta/client.ts`.

### The three callers (D2)

- [X] T020 [US1] `apps/api/src/direct-payments/validation.ts`: `speiAvailable` reads `env.APICEP_TOKEN` in place of `env.CONSTA_BASE_URL && env.CONSTA_API_KEY` (comment: the engine is local; what can be absent is the provider's credential). The attempt's gate becomes `if (!env.APICEP_TOKEN) return retryLater("PROVIDER_NOT_CONFIGURED")` (D6). The `refs` block becomes unconditional — `{ customerRef: link.customerUsuario, paymentRef: payment.id }`, the link's customer identity (`link.customerRef` for an API link once `003` adds that column) — with the provisional-release D4 comment rewritten to say why the disguise left (D5; research R4). The three request shapes carry `receipt: { proofKey: payment.proofKey ?? "" }` where they carried `receiptUrl: await signedProofUrl(...)`. `new Consta(env.CONSTA_BASE_URL, constaKey).validate(request)` becomes `consta(env, db, { businessId: business.id }).validate(request)`; delete `constaKey` and the payments-and-classes D7 key paragraph (the business is the identity now — say so, citing D3). Drop the `customerRefFor` and `signedProofUrl` imports if nothing else uses them. `retryLater(code)` on `ConstaError` is unchanged: every failure still rides the schedule (D6, FR-011).
- [X] T021 [P] [US1] `apps/api/src/credit/topups.ts`: the gate becomes `APICEP_TOKEN` → `PROVIDER_NOT_CONFIGURED`; the receipt door carries `receipt: { proofKey: topUp.proofKey ?? "" }`; `new Consta(env.CONSTA_BASE_URL, env.CONSTA_API_KEY)` becomes `consta(env, db, { platform: true })` with the prepaid-credit D6 comment kept ("the platform's own transaction") and D3 added (NULL owner). No refs, as today.
- [X] T022 [P] [US1] `apps/api/src/routes/direct-payments/handler.ts` `readProof`: remove the `CONSTA_BASE_URL && CONSTA_API_KEY` gate (the reader needs no provider; an absent `AI` degrades inside the engine); replace `consta.extract(await signedProofUrl(...))` with `consta(c.env, db, { businessId: business.id }).extract({ proofKey: proofId })`; the catch answers `503 { code: "READER_UNAVAILABLE" }` (D6 — the page never reads the code, `PaymentPage.tsx:447`). `serveProof` is untouched: the provider still fetches through it.

### The engine's tests move (D12)

- [X] T023 [US1] `git mv apps/consta/test/validate.test.ts apps/api/test/consta/validate.test.ts`, then rewrite the harness and nothing else: `postValidate(key, body, overrides)` becomes a call to `consta({ ...env, ...overrides }, db(), { businessId }).validate(body)` with a `ConstaError` caught and its `code`/`retryable` asserted where the HTTP status and envelope were; `mockProof(bytes)` becomes `putProof(key, bytes)` and requests carry `receipt: { proofKey }`; the key seed becomes `seedBusiness()`. Leave the US-V15 blocks (`the history refs`, `the trust block`, lines 1019–1210 at `31c4c71`) out — T039 carves them into `trust.test.ts`. **Retire** "scenario 5: a bad key and a revoked key both 401 without touching the provider" and delete the `describe("API keys (D5)")`. **Rewrite** "scenario 9: http, a private address and an oversized file are refused before any reading" on bytes: an oversized proof is `PROOF_TOO_LARGE`, unrecognised bytes are `UNSUPPORTED_MEDIA_TYPE`, a key with no object is `PROOF_NOT_FOUND` — cite `consta-api-merge US1` on the rewritten test. In "US-V07: a bank name off the vocabulary is refused with the vocabulary attached", keep the refusal and drop the `acceptedBanks` assertion (the vocabulary payload was a door feature). Every other test keeps its title, its `US-V##` and its assertions; the provider mock at `https://api.apicep.cloud` is unchanged. Depends on T018, T019, T010.
- [X] T024 [P] [US1] `git mv apps/consta/test/learned-retry.test.ts apps/api/test/consta/learned-retry.test.ts`: the seeded distributions go through `seedValidations` with a `businessId`; the request goes through the engine in-process; the eight `US-V16` tests keep their titles and assertions.

### The API's tests stop mocking product code (D12)

- [X] T025 [US1] `apps/api/test/direct-payment.test.ts`: `CONSTA_ORIGIN` becomes `APICEP_ORIGIN = "https://api.apicep.cloud"`; `mockConsta(data)` becomes `mockApiCep(data)` with the same vocabulary in and apiCEP's wire out (research R11: `valid` → `status: "valid"` + `validation.cepDetails` in pesos; `pending` → `status: "pending"`; `not_found` → `status: "invalid"` with no `validation`; `contradicted` → `status: "invalid"` + `cepStatus: "DEVUELTO"`; `alreadyValidated` → `cepPreviouslyValidated: true`; the reading → `extracted`); the 18 `captured.body` assertions read apiCEP's body (`sender.trackingKey`, `sender.amount` in pesos, `imageUrl`, `beneficiary`). Test env: drop `CONSTA_BASE_URL`, `CONSTA_API_KEY`, `CUSTOMER_REF_SECRET`; add `APICEP_TOKEN`. `lastError: "CONSTA_UNAVAILABLE"` assertions become `PROVIDER_UNAVAILABLE` (a 502 from apiCEP). **Retire** the "Consta that predates D11" test at line ~915 — its subject is a wire that no longer exists — and the two `customerRef` tests (lines ~2568 and ~2598), whose subject is an HMAC that travelled to another service; name all three in the commit message. What replaces them — the row's attribution and its undisguised `customer_ref` — is T040's to prove, under US3, so this task lands no test cited to another story. The three release-shadow tests that passed `trust: TRUST_BLOCK` seed rows with `seedValidations` and assert the block the engine computed; the two `retryAfter` tests seed thirty measured rows the way `learned-retry.test.ts` does. Depends on T010, T019, T020.
- [X] T026 [P] [US1] `apps/api/test/topups-pause.test.ts`: the same re-pointing for its 7 mock sites and its env. The top-up row's NULL owner is T040's to prove (US3), not this task's.
- [X] T027 [P] [US1] `apps/api/test/integration-dispatch.test.ts`: the same re-pointing for its 6 mock sites and its env.
- [X] T028 [P] [US1] `apps/api/test/payment-classes.test.ts`: the same re-pointing for its 3 mock sites and its env.
- [X] T029 [P] [US1] `apps/api/test/payment-requests.test.ts`: env only — drop the two `CONSTA_*` keys, add `APICEP_TOKEN`.

### What is left of the old Worker

- [X] T030 [US1] Delete the remainder of `apps/consta/` — `src/index.ts`, `src/env.ts`, `src/auth/api-key.ts`, `src/routes/admin/keys.ts`, `src/routes/banks.ts`, `src/db/schema.ts`, `src/provider/banks.ts`, `migrations/`, `test/admin-keys.test.ts`, `test/banks.test.ts`, `test/setup.ts`, `test/helpers.ts`, `wrangler.jsonc`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts` — with `git rm -r apps/consta`, then `pnpm install` so `pnpm-lock.yaml` drops the workspace. The seven retired tests (five in `admin-keys`, two in `banks`) are named in research R11; list them in the commit message. The Worker's *deployment*, its secrets and its pipeline steps retire in US2 and US4; this task removes only what the move left behind.
- [X] T031 [US1] Run `pnpm --filter @devolada/api typecheck` and `pnpm --filter @devolada/api test`. Everything green, with `fetchMock.disableNetConnect()` in force so any call to a Consta origin fails the test that made it (SC-004). Record the test count in the task notes against T001's baseline and account for the difference by name: it rises by the 62 moved and 1 rewritten engine tests, and falls by the three `direct-payment.test.ts` tests T025 retires — `consta-keys.test.ts` still passes at this checkpoint and retires in T044.
- [X] T032 [US1] Walk quickstart US1 by hand against the sandbox: `pnpm --filter @devolada/api sandbox`, `.dev.vars` with `APICEP_TOKEN` and `APICEP_BASE_URL=http://localhost:8789`, the demo seed; pay with keys containing `PEND`, `BAD`, `NF`, `E500` and a clean one and read the row after each (`constaStatus`, `lastError` — `PROVIDER_UNAVAILABLE`, never `CONSTA_UNAVAILABLE`); upload a PNG and confirm the reader ran locally (an `extractions` row with `source = 'reader'` — this never happened locally before, research R6); upload a PDF and confirm `source = 'provider-ocr'`. Record what you saw.

**Checkpoint**: the product validates its own payments. Every verdict the
lifecycle produced through the hop it now produces in-process.

---

## Phase 4: User Story 2 — One product to deploy, one credential to keep (P2)

**Goal**: the pipeline deploys three Workers and one database, plants one
provider credential and verifies it; production is able to validate the
moment the credential is planted.

**Independent test**: read the workflows and count; run a preview with and
without `APICEP_TOKEN` and watch the link flip between `debt` and
`unavailable` with no code change (quickstart, US2).

**Follows US1 for a merge**: T030 deleted `apps/consta/`, which `deploy-dev.yml`
still visits until T033.

- [X] T033 [US2] `.github/workflows/deploy-dev.yml` per [contracts/configuration.md](./contracts/configuration.md): delete the four Consta steps ("D1 consta dev migrations", "Deploy dev Consta", "Sync Consta worker secrets", and the `apps/consta` working directories); in "Sync worker secrets" delete the `CONSTA_API_KEY`, `CONSTA_ISSUER_TOKEN` and `CUSTOMER_REF_SECRET` blocks with their comments and add a guarded `APICEP_TOKEN` block (absent → `::warning::No APICEP_TOKEN in the dev environment — the SPEI channel stays unavailable.`); keep "Verify the Consta provider credential" whole, renamed "Verify the provider credential", placed after the API secret sync — its five 401 readings, the whitespace checks and the retry on the transient body are measured knowledge and stay. Cite D9 in the step comments.
- [X] T034 [P] [US2] `.github/workflows/deploy-prod.yml`: delete the `CUSTOMER_REF_SECRET` and `CONSTA_ISSUER_TOKEN` blocks; add the guarded `APICEP_TOKEN` block (absent → `::warning::No APICEP_TOKEN in the production environment — the SPEI channel stays unavailable (consta-api-merge: switching production on is a separate decision).`); add "Verify the provider credential" with the same body as dev, which already exits 0 with a warning when the secret is absent; replace the comment "the channel stays unavailable until Consta has a prod env" with the sentence from the contract. The D1 backup step is untouched. Cite D9.
- [X] T035 [P] [US2] Add `.github/workflows/retire-consta.yml`: `workflow_dispatch` with a boolean input `dry_run` (default `true`), environment `dev`, `working-directory: apps/api`, the account and token env the deploy jobs use; steps in order — `wrangler d1 export devolada-consta-db-dev --remote --output consta-dev.sql`, `actions/upload-artifact` as `consta-dev-final-export` with `retention-days: 90`, then (only when `dry_run` is false) `wrangler delete --name devolada-consta-dev` and `wrangler d1 delete devolada-consta-db-dev -y`. The dry run proves the export and the credentials; the real run is the creator's (T050). Header comment: one-shot, run once after the dev deploy that stops calling Consta, deleted afterwards (D13, FR-013).
- [X] T036 [P] [US2] `CLAUDE.md`: in *Commands* delete the `@devolada/consta dev` and `@devolada/consta sandbox` lines and add `pnpm --filter @devolada/api sandbox`; change "api / consta only" to "api only"; in *Architecture* delete the `apps/consta` row and make the `apps/api` row say it hosts the SPEI validation engine (Consta) as a module; in the invariants, delete "(Consta adds `retryable`)", drop "the Consta key backfill" from the sweep list, change "no Consta key → the SPEI channel says it is unavailable" to "no provider credential → …", and make the generated-files bullet name one `banks.ts`; in *Testing* change "API / Consta (`apps/*/test/`)" to "API (`apps/api/test/`)". The opening paragraph's "Banxico validation through Consta" stays — Consta is still the engine's name.
- [X] T037 [P] [US2] Add `apps/api/test/consta/availability.test.ts` citing `consta-api-merge US2`: the same app, given an env without `APICEP_TOKEN`, answers `status: "unavailable"` on `GET /direct-payments/links/:token` and, given the token, answers `status: "debt"` with the CLABE (SC-005, FR-009); a payment already `validating` whose sweep runs without the token is retried as `PROVIDER_NOT_CONFIGURED` and never dies; an env without `AI` reads an image through the provider's door (`source: "provider-ocr"`) rather than failing.
- [X] T038 [US2] Verify statically and locally, recording the numbers: `grep -c "wrangler deploy" .github/workflows/deploy-dev.yml` is 3 and `grep -c "migrations apply"` is 1 (SC-002); `grep -n "CONSTA_\|CUSTOMER_REF_SECRET" .github/workflows/*.yml` is empty (SC-003, SC-009); `pnpm e2e:passkey` still boots the API with the `ai` binding in local mode (the passkey config runs `wrangler dev --local` with no Cloudflare credentials — if the binding makes startup fail, that is a finding for T053, not something to hide).

**Checkpoint**: one deploy, one database, one credential; production able, not on.

---

## Phase 5: User Story 3 — The validation record lives beside the payment (P3)

**Goal**: every provider call and every reading is a row in the product's
database, attributed to the business or the platform, and every reader of
that record — trust, shape, retry, the report — reads one place.

**Independent test**: validate for a business and for the platform and read
the rows; run the report against one database (quickstart, US3).

**Follows US1** for the engine and the tables; independent of US2 and US4.

- [X] T039 [US3] Create `apps/api/test/consta/trust.test.ts` from the two US-V15 blocks of `git show 31c4c71:apps/consta/test/validate.test.ts` (lines 1019–1210: "the history refs", four tests; "the trust block", five tests), run through the engine in-process and scoped by business: add that the same `customer_ref` at two businesses never shares a chain (SC-007), that a platform row (NULL owner) never enters any business's evidence, and that the chain in flight is excluded (trust-layer D3). Keep the nine `US-V15` citations; the additions cite `consta-api-merge US3`.
- [X] T040 [P] [US3] Add `apps/api/test/consta/attribution.test.ts` citing `consta-api-merge US3`, every test title carrying the word *attributed* so `-t "attributed"` in the quickstart selects them: a business's `validate` writes one `validations` row with `business_id` set, `customer_ref` = the link's customer identity (its usuario for a panel link; the caller's reference once an API link exists — FR-006, D5) and `payment_ref` = the payment id, with no secret in the env (SC-006); a billed failure — the envelope-shaped 400 — writes a row with `status` NULL, attributed the same way (FR-004); a top-up writes NULL; `extract` writes one `extractions` row with `proof_sha256`, `byte_size` and `media_type` and **no column holding the bytes** (FR-005); a query scoped to business B returns none of A's rows (SC-007); and the two reads that cross businesses on purpose do so: ten valid claves split across two businesses graduate one shape rule, and thirty measured transfers across two businesses fill one retry cell (D4).
- [X] T041 [P] [US3] Rewrite `scripts/cep-latency-report.mjs` to read one database: `DBS` becomes the API's `devolada-db` / `devolada-db-dev`, the first query joins `payments p` to `businesses b ON b.id = p.business_id` (`b.spei_bank` as the receiver) and the second reads `validations` from the same database; the interval arithmetic, the ladder cells and the markdown stay as they are. Say in the header that the report joined two databases by tracking key until this feature and that its table names had been dead since migrations 0018/0019 (D14). Run `node scripts/cep-latency-report.mjs --env local` against the rows T032 left and paste the first lines of the output in the task notes (SC-008).
- [X] T042 [US3] Run `pnpm --filter @devolada/api test -- test/consta` and read the local rows T032 wrote: every `validations` and `extractions` row carries an owner (SC-006); the top-up rows carry NULL. Record.

**Checkpoint**: the engine's evidence is the product's evidence, in one place.

---

## Phase 6: User Story 4 — The standalone identity is retired cleanly (P4)

**Goal**: nothing that existed only because Consta was a separate service
survives — keys, doors, sweep, secrets, base URL — and every decision and
every test that belonged to the engine is accounted for.

**Independent test**: the SC-009 grep returns nothing; the citation audit
matches T001's baseline; `spec-lint` is clean (quickstart, US4).

**Follows US1** (the callers no longer read what this phase deletes) and
US2 (the workflows no longer plant it).

- [X] T043 [US4] `git rm apps/api/src/consta/issuer.ts apps/api/src/consta/refs.ts`. In `apps/api/src/index.ts` delete the `backfillConstaKeys` import and its `waitUntil` block, and rewrite the scheduled-handler comment to list the three sweeps that remain (FR-014; cite D5 for the refs and note that the key backfill left with the keys). In `apps/api/src/routes/businesses/handler.ts` delete the key-issuance block after the business insert and the `issueConstaKey` import; a business is born without a key because it needs none (D3).
- [X] T044 [P] [US4] `git rm apps/api/test/consta-keys.test.ts` — seven tests whose subject (issuance at birth, the backfill sweep, the issue-only door) no longer exists; name them in the commit message as research R11 does for the engine's eight.
- [X] T045 [US4] Remove `CONSTA_BASE_URL`, `CONSTA_API_KEY`, `CONSTA_ISSUER_TOKEN` and `CUSTOMER_REF_SECRET` from `Bindings` in `apps/api/src/env.ts` with their comments. In `apps/api/wrangler.jsonc` delete `CONSTA_BASE_URL` from the top-level and `env.dev` vars with its comment, and replace the `env.prod` comment "No CONSTA_BASE_URL: Consta has no prod env yet…" with the sentence from [contracts/configuration.md](./contracts/configuration.md) (no `APICEP_TOKEN` planted here by this feature — spec Q3). `pnpm --filter @devolada/api typecheck` is the proof that no reader remains (SC-009): a stale `env.CONSTA_*` anywhere is now a compile error. Cite D9.
- [X] T046 [P] [US4] Log the retired column with `/speckit-debt-log retired-consta-key-column` (D11, research R10): where it lives (`apps/api/src/db/schema.ts`, `businesses.consta_api_key`, declared and never read); what it costs while unpaid (a dead column every `SELECT` on `businesses` carries, and a comment that has to explain itself); what paying looks like (one `ALTER TABLE businesses DROP COLUMN consta_api_key` migration, generated by removing the declaration, after this feature's dev and prod deploys have run so that no deployed version selects it). Severity low, effort minutes, kind deliberate.
- [X] T047 [US4] Citation audit (SC-011, FR-016): for every file in T001's `baselines/citations.md`, run the same `grep -o "D[0-9][0-9]*" | sort | uniq -c` on its new home under `apps/api/src/consta/` and confirm every token the original carried is present (the new home may carry more — the `consta-api-merge D<n>` additions — never fewer). For the five files that retired (`index.ts`, `env.ts`, `auth/api-key.ts`, `routes/admin/keys.ts`, `routes/banks.ts`) list their citations as retired with the door. Append the result to `specs/004-consta-api-merge/baselines/citations.md`.
- [X] T048 [US4] Run the SC-009 grep from [quickstart.md](./quickstart.md#user-story-4--the-standalone-identity-is-retired-cleanly) — `git grep -n "CONSTA_BASE_URL\|CONSTA_API_KEY\|CONSTA_ISSUER_TOKEN\|CONSTA_ADMIN_TOKEN\|CUSTOMER_REF_SECRET\|consta.test\|consta.dev.devoladapago" -- ':!specs' ':!.specify'` — and confirm it returns nothing (`retire-consta.yml` names the Worker and the database, not a URL, key or token; it is the one file allowed to). Then `node scripts/spec-lint.mjs`: every file under `apps/api/test/consta/` cites.
- [ ] T049 [US4] After the creator's explicit go-ahead in chat — this deletes credentials — remove the retired secrets from the GitHub environments: `gh secret delete CONSTA_API_KEY --env dev`, `gh secret delete CONSTA_ISSUER_TOKEN --env dev`, `gh secret delete CONSTA_ADMIN_TOKEN --env dev`, `gh secret delete CUSTOMER_REF_SECRET --env dev`, `gh secret delete CONSTA_ISSUER_TOKEN --env prod`, `gh secret delete CUSTOMER_REF_SECRET --env prod`. Keep `APICEP_TOKEN` in `dev`: it is re-pointed at the API, not re-created. Nothing in the workflows reads the removed names after T033/T034, so this can run before or after the merge.
- [ ] T050 [US4] Post-merge, once the dev deploy is green — the creator, from the Actions tab: run `retire-consta.yml` with `dry_run: true`, confirm the `consta-dev-final-export` artifact exists and is not empty; run it again with `dry_run: false`; confirm `https://consta.dev.devoladapago.com/health` no longer answers and `wrangler d1 list` (via the workflow log or the dashboard) no longer shows `devolada-consta-db-dev`. Then open the follow-up PR that `git rm`s `.github/workflows/retire-consta.yml` (D13: the tree carries no dead job; git keeps the record).

**Checkpoint**: nothing points at a service that no longer exists, and every
decision and test the engine carried is present or named as retired.

---

## Phase 7: Polish & Cross-Cutting

- [X] T051 Run every gate in CI order and record the results in the task notes: `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm -r --if-present build`, then `pnpm e2e` and `pnpm e2e:passkey`. None may be skipped or quarantined to get green. Note the workspace count `pnpm -r` visits (one fewer than at T001).
- [X] T052 Walk the by-hand checks in [quickstart.md](./quickstart.md) that T032 and T041 did not already cover: on a PR preview (if `PREVIEW_ENABLED`) or a local run, the "able, not on" flip for SC-005 with no code change between the two states; the cut-over scenario (FR-020): seed a `validating` row with `validation_attempts = 1`, `consta_status = 'pending'` and a `consta_validation_id` the old service would have written (`v-old-service-…`), run the sweep, and confirm the next attempt reads `isRetry` true, applies the replay carve-out, and that nothing tries to follow the foreign id — `direct-payment.test.ts` "scenario 9: the sweep picks it up" seeds the first two fields already; add the third there so the proof is a test, not a note.
- [X] T053 Correct [contracts/engine.md](./contracts/engine.md), [contracts/configuration.md](./contracts/configuration.md) and [data-model.md](./data-model.md) wherever implementation proved a sentence wrong — the `wrangler delete` prompt behaviour in CI, the `ai` binding under `wrangler dev --local`, the exact code list on `ConstaError` — and say so inline, as 001's `Field` note does. Correct the contract to match the code only when nothing asked for the other reading.
- [X] T054 Run `/speckit-analyze` and resolve every CRITICAL finding before calling the feature done (constitution, *Development Workflow*): the one expected to need an answer is Principle V against the two cross-tenant reads, which T002's amendment and T012/T015's D4 citations exist to answer.

---

## Dependencies & Execution Order

```text
Setup (T001–T002)
   └─▶ Foundational (T003–T010)
          └─▶ US1 (T011–T032)
                 ├─▶ US2 (T033–T038)  ── together with US1, the smallest mergeable slice
                 ├─▶ US3 (T039–T042)  ── independent of US2 and US4
                 └─▶ US4 (T043–T050)  ── after US2 (the workflows stop planting what US4 deletes)
                              └─▶ Polish (T051–T054); T050 runs after the merge
```

**Why US1 must come first**: every other story reads the tables, the engine
or the deletion US1 makes. US3 tests the rows the engine writes; US4 deletes
the config the engine stopped reading; US2 removes pipeline steps that
target the directory US1 deleted.

**Why a merge needs US1 + US2 together**: T030 deletes `apps/consta/` and
`deploy-dev.yml` runs `wrangler d1 migrations apply` from that directory
until T033 edits it. US1 alone is testable locally and not deployable.

**Why US4 follows US2**: T045 deletes the `CONSTA_*` bindings; if
`deploy-dev.yml` still planted `CONSTA_API_KEY` at that point the sync
would succeed against a binding the Worker no longer declares — harmless,
but a green step planting a dead secret is the exact class of failure
constitution VIII names. T033 first, then T045.

**Within US1**: T011–T016 are six independent moves; T017 needs T012, T013,
T016; T018 needs T011–T017; T019 needs T018; T020–T022 need T019; T023–T029
need T019 (and T010); T030 needs T023–T024 (the tests must have left before
the directory goes); T031 needs everything before it.

## Parallel opportunities

| Wave | Tasks | Files |
| --- | --- | --- |
| Foundational | T008, T009, T010 | sandbox + `package.json`; `gen-banks.mjs` + `banks.data.md`; `test/consta/helpers.ts` |
| Engine moves | T011–T016 | six distinct source files/directories |
| Callers | T021, T022 (after T019's shared `index.ts` contract is in) | `topups.ts`; `direct-payments/handler.ts` |
| Test files | T024, T026–T029 (beside T025) | five distinct test files |
| Pipeline | T034, T035, T036, T037 (beside T033) | `deploy-prod.yml`; `retire-consta.yml`; `CLAUDE.md`; `availability.test.ts` |
| Records | T040, T041 (beside T039) | `attribution.test.ts`; `cep-latency-report.mjs` |
| Retirement | T044, T046 (beside T043) | `consta-keys.test.ts`; the debt entry |

T002 (the amendment) runs beside everything in Phase 1; it touches only
`.specify/memory/constitution.md`.

## Implementation Strategy

### MVP first (User Story 1 + 2)

1. Phase 1: baseline and the amendment.
2. Phase 2: tables, bindings, pins, helpers — the old client still passes.
3. Phase 3: the engine moves, the callers switch, the tests move.
   **Stop and validate**: `pnpm --filter @devolada/api test` green with no
   Consta origin registered; the sandbox walk in T032.
4. Phase 4: the pipeline. This is the first mergeable state — after it, the
   dev deploy ships three Workers and one database, and production is able.

### Incremental delivery

5. Phase 5: the record's tests and the report — independently reviewable.
6. Phase 6: retirement — the deletions, the debt, the audit, then the
   post-merge run of the one-shot workflow.
7. Phase 7: the gates, the by-hand checks, the contract corrections,
   `/speckit-analyze`.

### One developer, one branch

Stories land as separate commit groups on this branch, in phase order. The
retirement run (T050) and the follow-up PR that removes the workflow are
the only steps that happen after the merge; everything else is on the branch
before it.

---

## Notes

- [P] tasks touch different files and depend on nothing unfinished.
- Every task names its file; every test task names its citation.
- Retired tests are retired **by name** (research R11, T030, T044) — a test
  that disappears unnamed is coverage lost silently, which FR-017 forbids.
- Commit after each task or logical group; each commit message names the
  `D<n>` it applies.
- Stop at any checkpoint to validate the story on its own.

---

## Implementation notes (2026-09-16)

Recorded per task as the tasks asked; every number below was read off a
command that can be run again.

- **T001** — baseline at `31c4c71`, all gates green: spec-lint 52 files
  (one warning, `consta-keys.test.ts` uncited — the file retires in T044),
  gen-banks 97 banks, contrast-lint 34 pairs, pending-lint 23 labels,
  typecheck 5 workspaces; **265 API tests, 71 Consta tests**, as expected.
  Citation baseline saved to `baselines/citations.md`.
- **T004** — `0028_consta_api_merge.sql`: two `CREATE TABLE`, three
  `CREATE INDEX`, no `DROP`, no `ALTER`. Applied locally.
- **T007** — the pin needed one more act: with `ai` in `wrangler.jsonc`,
  miniflare hands the suite an `AI` object that would call Cloudflare for
  real (measured: `typeof env.AI === "object"`, deletable). `test/setup.ts`
  deletes it so the reader stays the one binding tests stand in for
  (constitution IV). Recorded in `contracts/configuration.md` (T053).
- **T019** — `ConstaError` lives in `consta/failure.ts` and is re-exported
  from `consta/index.ts`, so `validate.ts` and `extract.ts` can throw it
  without importing the facade that imports them. Twelve codes, not eleven:
  `RECEIPT_INCOMPLETE` (the gate's own refusal) was missing from the
  contract's count (T053).
- **T023** — 46 tests moved (56 − scenario 5 retired − the 9 US-V15 tests
  carved into `trust.test.ts` by T039); scenario 9 rewritten on bytes and
  cited `consta-api-merge US1`.
- **T025** — retired by name: "scenario 40: an `invalid` with no reason at
  all is read as not_found, not as a refusal"; "customerRef is the HMAC of
  the usuario, paymentRef is the payment id"; "without the secret nothing
  travels and nothing blocks". The shadow test "without a block the decision
  is byte-identical and the shadow records null" became "with an empty
  history … records the empty measurement": the refs travel on every call
  now (D5), so a `pending` always carries a block — for a stranger, one of
  zeros. The two `retryAfter` tests seed thirty measured transfers and the
  payment's own prior miss, so the learned moment is exactly `createdAt +
  25 min` (the 25-minute step, not the mock's 26).
- **T030/T044** — `consta-keys.test.ts` (7) did not "still pass at this
  checkpoint": the callers stopped reading the key in T020, so it retired
  here. Five of its tests retire by name (birth issuance, the sweep's
  backfill ×3, the key-under-validation); the two **"D9 scenario 12: a
  suspended business validates nothing"** tests are about suspension, not
  keys, so they moved to `payment-classes.test.ts` re-pointed at apiCEP
  with the key assertion dropped — retiring them whole would have lost
  payments-and-classes D9's proof (FR-017). Engine tests retired by name:
  `admin-keys.test.ts` (5), `banks.test.ts` (2), validate scenario 5 (1).
- **T031** — `pnpm --filter @devolada/api test`: **332 tests, 25 files**,
  `disableNetConnect` in force. Accounting against 265: + 75 under
  `test/consta/` (46 validate, 8 learned-retry, 12 trust, 3 availability,
  6 attribution) − 3 retired in `direct-payment.test.ts` − 7
  `consta-keys.test.ts` + 2 moved into `payment-classes.test.ts` = 332.
- **T032** — sandbox walk, one process (`wrangler dev --local` + the mock on
  8789, `.dev.vars` with `APICEP_TOKEN`/`APICEP_BASE_URL`): five seeded
  `validating` rows swept through `/dev/direct-payment-sweep` → `PEND`
  validating/pending; `BAD` invalid/`TRANSFER_CONTRADICTED`; `NF`
  validating/`TRANSFER_NOT_FOUND`; `E500` validating/`PROVIDER_UNAVAILABLE`
  (never `CONSTA_UNAVAILABLE`); clean → `consta_status = valid`, then
  `WISPHUB_NOT_CONFIGURED` (no WispHub in this sandbox). Every
  `validations` row: `business_id` = the demo ISP, `customer_ref` = the
  link's usuario, `payment_ref` = the payment id. Receipt doors on a fresh
  link: a **PDF** → `extractions` row `provider-ocr / routed`,
  `application/pdf`, 129 bytes, SHA-256 set, then a receipt-mode
  `validations` row (the mock's imageUrl door answered valid). A **PNG** →
  `wrangler dev --local` cannot run the AI binding ("Binding AI needs to be
  run remote"), so the reader answered `READER_UNAVAILABLE` and the engine
  fell through to the provider's door (constitution VIII); `/read` answered
  `503 READER_UNAVAILABLE`. **Finding**: "the reader ran locally" cannot be
  shown without `wrangler dev --remote` or Cloudflare credentials; the local
  gap research R6 named (the `http://localhost` refusal) is closed — the
  bytes reach the reader — but the reader itself is remote by nature.
- **T038** — `grep -c "wrangler deploy" deploy-dev.yml` = 3;
  `grep -c "migrations apply"` = 1; the `CONSTA_\|CUSTOMER_REF_SECRET`
  grep over the workflows is empty. `wrangler dev --local` starts with the
  `ai` binding and reports it "not supported" — startup does not fail; see
  T032 for what a call does. Passkey run recorded under T051.
- **T041** — `node scripts/cep-latency-report.mjs --env local` runs against
  one database: "Transfers with a tracking key in the engine's log: 6.
  Confirmed (reached `valid`): 2. Payments matched in Devolada: 5." — cold
  start, no cell open, as the walk's rows warrant.
- **T042** — every `validations`/`extractions` row the walk wrote carries the
  demo ISP's id; the NULL owner is proven by `attribution.test.ts`
  scenario 2 through `validateTopUp`.
- **T047** — first run found `D19` missing from `extract.ts` (its sentence
  lived on the router's `zValidator` block); restored on
  `extractionFailure`, re-run: every citation present. Table in
  `baselines/citations.md`.
- **T048** — the SC-009 grep is empty (one test comment that named the old
  test origin was reworded); spec-lint: 52 files, no warning.
- **T049** — NOT run: deleting the six GitHub environment secrets needs the
  creator's explicit go-ahead in chat. Nothing in the workflows reads them
  after T033/T034, so it can happen before or after the merge.
- **T050** — post-merge, the creator's: `retire-consta.yml` dry run, then
  the real run, then the follow-up PR that removes the workflow.
- **T053** — three corrections written inline: the twelve-code
  `ConstaError` and its file; the `AI` binding deleted in `test/setup.ts`;
  `wrangler delete --skip-confirmation` (read from `--help`); plus the
  index names in `data-model.md`.
- **T051** — every gate in CI order, green: spec-lint 52 files, no
  warning; gen-banks 97 banks, the constant in step; contrast-lint 34
  pairs; pending-lint 23 labels; typecheck 4 workspaces (`pnpm -r` visits
  one fewer than at T001); tests **api 332, admin 161, pago 47, ui 50**;
  build 3 apps; `pnpm e2e` 51 passed; `pnpm e2e:passkey` 2 passed (the API
  booted under `wrangler dev --local` with the `ai` binding — T038).
  Environment note, not a repo change: the pinned Playwright wanted a
  Chromium build the sandbox lacked, so the run pointed
  `PLAYWRIGHT_BROWSERS_PATH` at the installed one.
- **T054** — `/speckit-analyze`: no CRITICAL finding. Principle V's two
  cross-tenant reads are the ones v1.3.0 names and both cite D4 in code;
  no `× 100` under `src/consta/`; no `retryable` on any API route; every
  test under `test/consta/` cites. Findings (all resolved inline or noted):
  the contract's eleven-code list (twelve; corrected), research R11's
  "retires whole" for `consta-keys.test.ts` (two suspension tests moved
  instead), and the quickstart's "the reader reads it locally" (true with a
  remote-capable `wrangler dev`; the local binding is a stub).
- **Open for the creator**: T049 (delete the six retired GitHub secrets —
  needs an explicit go-ahead), T050 (run `retire-consta.yml` after the dev
  deploy, then the follow-up PR that removes it).
