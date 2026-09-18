---

description: "Task list for production-launch"
---

# Tasks: production-launch

**Input**: Design documents from `/specs/006-production-launch/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: none as files. The feature changes no application code and its
subject — the pipeline — has no layer in constitution IV short of running it
(plan, Complexity Tracking). Each story is proven by a **verification task**
that runs the real thing and links its evidence: the gate refusing a commit,
the release's log and summary, the day-one path ending in a verdict, the
rollback rehearsal. Those tasks carry their `[US<n>]` label so the proof
inherits the citation (constitution VII).

**Organization**: grouped by user story. Two kinds of task appear side by
side and are marked: **code** (files in the tree) and **ops** (acts outside
the repository — the environment, the account, the providers). An ops task
marked **creator-only** involves a credential value the agent may never see,
type or store; the agent prints the command, the creator runs it. An ops task
marked **on the creator's word** is a persistent configuration change the
agent may perform only after an explicit go-ahead in chat.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on unfinished work
- **[Story]**: US1…US3, mapping to the spec's user stories
- Every code task names the file it touches; every ops task names the check that proves it

## Decision citations

YAML comments cite `production-launch D<n>`, tabled in
[plan.md](./plan.md#decisions). D4, D8, D9 are the creator's clarify
answers; the rest come from research R1–R11. The four workflow headers keep
their archive citations (`CICD.md path …`) verbatim — CLAUDE.md says so.

---

## Phase 1: Setup

**Purpose**: know what green looks like, and what the environments hold,
before anything changes.

- [X] T001 Baseline the gates: from the repo root run, in CI order, `node scripts/spec-lint.mjs`, `node scripts/gen-banks.mjs --check`, `node scripts/contrast-lint.mjs`, `node scripts/pending-lint.mjs`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `pnpm -r --if-present build`; record the results in the task notes (expected at `1720769`: all green). A gate that was already red proves nothing later.
- [X] T002 [P] Baseline the environments for SC-008: run `gh secret list --env production`, `gh secret list --env dev`, `gh variable list`, `gh api repos/leolicona/devolada/environments/production --jq '{protection_rules, deployment_branch_policy}'` and paste the outputs (names only — never values) into the task notes. Expected on 2026-09-17: `production` = `BETTER_AUTH_SECRET`, `CLOUDFLARE_API_TOKEN`, `CONSTA_ISSUER_TOKEN`; `dev` carries `CONSTA_API_KEY`, `CONSTA_ISSUER_TOKEN`, `CONSTA_ADMIN_TOKEN` among others; `protection_rules: []`.

---

## Phase 2: Foundational — the environment, outside the repository

**Purpose**: what the pipeline cannot do for itself and the first release
needs. None of it blocks the code tasks in Phase 3; all of it blocks the
release (T017). Reference: [contracts/environment.md](./contracts/environment.md).

**⚠️ CRITICAL**: T003 and T006 change persistent configuration and run only
on the creator's word; T007–T009 are creator-only.

- [X] T003 **ops, on the creator's word** — Configure the gate on the environment (D3): `gh api -X PUT repos/leolicona/devolada/environments/production --input -` with `{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}`, then two `gh api -X POST repos/leolicona/devolada/environments/production/deployment-branch-policies` calls with `{"name":"v*","type":"tag"}` and `{"name":"main","type":"branch"}`. Check: `…/deployment-branch-policies --jq '.branch_policies[] | "\(.type) \(.name)"'` → `tag v*`, `branch main`. **Done 2026-09-18.** The required reviewer was attempted first and refused by GitHub (HTTP 422: not on this plan for a private repository); the creator chose the tag as the approval — constitution v1.4.0, spec Clarifications 2026-09-18, research R3.
- [X] T004 [P] **ops** — Set the two smoke variables (D6): `gh variable set PROD_ADMIN_URL --body https://app.devoladapago.com` and `gh variable set PROD_PAGO_URL --body https://link.devoladapago.com`. Check: `gh variable list` shows both beside `PROD_API_URL`.
- [ ] T005 [P] **ops, creator-only** — Mint the production apiCEP token (D4) at app.apicep.cloud: a second `apicep_…` token, distinct from dev's; if the account cannot hold two, a second account — never the dev token. Note the pool (800 calls/month) and that each release spends one call (D11). Check: the creator confirms in chat that a distinct token exists; its value is never pasted here.
- [X] T006 **ops, on the creator's word** — Delete the retired secrets (D13, spec 004 T049): `gh secret delete CONSTA_ISSUER_TOKEN --env production`; `gh secret delete CONSTA_API_KEY --env dev`; `gh secret delete CONSTA_ISSUER_TOKEN --env dev`; `gh secret delete CONSTA_ADMIN_TOKEN --env dev`. Check: `gh secret list --env production` and `--env dev` show no `CONSTA_*` (SC-008 = 0).
- [ ] T007 [P] **ops, creator-only** — Plant the two credentials in the production environment, from the creator's own terminal: `gh secret set RESEND_API_KEY --env production` and `gh secret set APICEP_TOKEN --env production` (paste with no trailing newline — the probe rejects one). Check: `gh secret list --env production` shows both with today's date; the values never appear in this session.
- [X] T008 [P] **ops** — Plant the operator (D9): `gh secret set PLATFORM_OPERATOR_EMAILS --env production --body "leolicona.dev@gmail.com"` — the agent may run this, the value is the creator's own address given in session. Check: `gh secret list --env production` shows it.
- [ ] T009 [P] **ops, creator-only** — In the Cloudflare dashboard: R2 → `devolada-transfer-proofs` → Settings → Object lifecycle rules → add `expire-15d`, delete objects after 15 days (D10). Then in the Resend dashboard confirm `devoladapago.com` still shows **Verified** (it was on 2026-08-15; the zone moved accounts on 2026-09-01). Check: the creator confirms both in chat; the runbook's pre-flight boxes are ticked.

**Checkpoint**: `quickstart.md` §0 has every box ticked except "the commit
to tag", which waits for the merge.

---

## Phase 3: User Story 1 — The creator ships a release from a tag, and the tag is the approval (P1) 🎯 MVP

**Goal**: `deploy-prod.yml` refuses an ungated commit, runs the PR loop's
checks, runs straight on (the push was the approval), warns in consequences, proves three
hostnames and states what landed. `deploy-dev.yml` gains the same lint and
the same warning text. CLAUDE.md names the acts.

**Independent Test**: dispatch *Deploy Prod* from this branch — the gate
refuses (no dev run for the commit) and the YAML is thereby proven valid;
after the merge, push `v1.0.0` and read the run against `quickstart.md` §1.

### Code

- [X] T010 [US1] In `.github/workflows/deploy-prod.yml` add a `gate` job before `test` (D1, research R1): `permissions: { actions: read, contents: read }`; checkout with `fetch-depth: 0`; one step that (a) queries `gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/deploy-dev.yml/runs?head_sha=${GITHUB_SHA}&per_page=10" --jq '[.workflow_runs[] | select(.conclusion == "success")] | length'` and fails with `::error::No green Deploy Dev run for ${GITHUB_SHA}. Tag a main commit whose dev deploy finished green (production-launch D1).` when the count is 0; (b) runs `git fetch origin main && git merge-base --is-ancestor "$GITHUB_SHA" origin/main` and fails with `::error::${GITHUB_SHA} is not on main. A release is a main commit (production-launch D1).` otherwise. `GH_TOKEN: ${{ github.token }}`. Make `test` `needs: gate`. Comment the job with why the browser and passkey layers are not repeated here.
- [X] T011 [US1] In `.github/workflows/deploy-prod.yml` `test` job, add `- run: node scripts/pending-lint.mjs` after the `contrast-lint` step, with a comment citing D2 ("a tag's test job is never a subset of the PR gate").
- [X] T012 [US1] In `.github/workflows/deploy-prod.yml` *Sync worker secrets*, replace the plain `echo "No RESEND_API_KEY … skipping (TD-011)."` with `echo "::warning::No RESEND_API_KEY in the production environment — nobody can finish signing up: the verification code is only logged (production-launch D5)."`. Leave the `BETTER_AUTH_SECRET` refusal and the operator/provider warnings as they are.
- [X] T013 [US1] In `.github/workflows/deploy-prod.yml` *Verify the provider credential*, rewrite the comment paragraph that begins "The probe is free" to state that the probe **spends one credit per release** — measured 2026-08-19: a request apiCEP rejects with 400 is still billed — and that it is kept because the 2026-08-18 six-hour silence cost more (D11).
- [X] T014 [US1] In `.github/workflows/deploy-prod.yml` capture what lands (D12): change the three deploy steps to `… wrangler deploy … 2>&1 | tee "$RUNNER_TEMP/deploy-<api|admin|pago>.log"` (keep `set -o pipefail` so a failed deploy still fails the step); add a final step *What landed* that greps `Current Version ID:` from each log and writes a markdown table — `service | version id` — plus the archive artifact name (`d1-backup-${{ github.ref_name }}`) to `$GITHUB_STEP_SUMMARY`, echoing the same lines to the log. Comment: FR-009 — the ids are what `rollback-prod.yml` takes.
- [X] T015 [US1] In `.github/workflows/deploy-prod.yml` *Smoke test*, loop over three `name=url` pairs — `api=${{ vars.PROD_API_URL }}/health`, `admin=${{ vars.PROD_ADMIN_URL }}/`, `pago=${{ vars.PROD_PAGO_URL }}/` — each with the existing 10 × 30 s wait; an empty URL → `::warning::<name> URL not set; smoke skipped` and continue; a URL that never answers → `::error::<url> did not answer in 5 minutes. To return a service to its previous version run Actions → Rollback Prod (production-launch D7).` and exit 1 after trying the remaining URLs. Cite D6 and D14; keep the certificate-race comment.
- [X] T016 [P] [US1] In `.github/workflows/deploy-dev.yml`: add `- run: node scripts/pending-lint.mjs` after `contrast-lint` in `test` (D2); replace the plain `RESEND_API_KEY` skip line with the `::warning::` sentence of T012, saying "dev" (D5); rewrite the probe's "The probe is free" paragraph as in T013 (D11). Nothing else moves.
- [X] T017 [P] [US1] In `CLAUDE.md`, directly after "**Never deploy from a local machine.** Merge to `main` deploys dev (…); a `v*` tag deploys prod behind an approval gate.", add: a release is `git tag vX.Y.Z origin/main && git push origin vX.Y.Z` on a commit whose Deploy Dev run is green (the tag job checks); a rollback is Actions → *Rollback Prod* with the service and the version id from the release's summary; the runbook is `specs/006-production-launch/quickstart.md` (D14).
- [X] T018 [US1] Syntax-check the three workflow files (`python3 -c 'import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]' .github/workflows/deploy-prod.yml .github/workflows/deploy-dev.yml .github/workflows/rollback-prod.yml`) and read each diff once more against [contracts/release-pipeline.md](./contracts/release-pipeline.md): every promise in the table has a step, every warning names a consequence, every new rule cites its D. (Runs after T024 so the rollback file exists.)

### Verification

- [X] T019 [US1] **Prove the refusal (spec US1 scenario 2)**: push this branch, then `gh workflow run deploy-prod.yml --ref claude/production-deployment-b1e0c6` and `gh run watch` — the `gate` job must fail with the D1 error (no Deploy Dev run exists for a branch commit) and `test`/`deploy` must never start. This also proves the edited YAML parses on GitHub. Paste the run URL into the PR description under "Evidence".
- [ ] T020 [US1] **The release (spec US1 scenarios 1, 3–8)** — after the PR merges and its *Deploy Dev* run is green, **on the creator's word** (the push is the approval — D3): `git fetch origin main && git tag v1.0.0 origin/main && git push origin v1.0.0`; `gh run watch`. Read the log against `quickstart.md` §1: gate green, `d1-backup-v1.0.0` archived (empty), migrations applied, no `::warning::` in the secrets step, `apiCEP accepted the credential`, three hostnames answered, summary table present. Then `curl -s https://api.devoladapago.com/health`, `curl -sI https://app.devoladapago.com/ | head -1`, `curl -sI https://link.devoladapago.com/ | head -1`. Record the run URL, the three version ids and the archive name — they go into T028.

**Checkpoint**: production exists, and the way it came to exist can be read
top to bottom in one log.

---

## Phase 4: User Story 2 — The first business collects on day one (P2)

**Goal**: the release is verified by the product doing its job: a code that
arrives, an operator panel that opens, a top-up account that exists before
any ISP needs it, and one real validated transfer.

**Independent Test**: `quickstart.md` §2, walked in production with real
addresses and one small real transfer; every step has an observable outcome.

- [ ] T021 [US2] **ops, creator** — Your own business first (D9, FR-018): sign up at `https://app.devoladapago.com` with `leolicona.dev@gmail.com`; the code **arrives in the inbox** (Resend proven — if not, the release log's secrets step is where to look); create the business; `/operador` appears in the navigation (operator secret proven). Evidence: a sentence in chat with the time the code arrived; the panel's state.
- [ ] T022 [US2] **ops, creator** — In `/operador` set `topup_clabe`, `topup_bank`, `topup_beneficiary` (the platform's account for ISP top-ups) and `support_whatsapp`, `support_email` (spec US2 scenario 6). Check: as a business owner, the credit card in the panel no longer says top-ups are unavailable.
- [ ] T023 [US2] **ops, creator + the pilot ISP** — The first ISP (spec US2 scenarios 1, 3–5): sign-up with the code by email → `/settings/direct-payment` CLABE + bank (the SPEI banner disappears) → `/integrations/wisphub` key from WispHub's Staff panel (born observing) → Links: one per roster customer; share one → the customer transfers a small real amount and enters the transfer data → the verdict lands in the panel; the outcome reads as observation, nothing written to WispHub. Evidence: the payment's status in the panel; the `validations` row's provider status and remaining quota (read from the D1 console); dev's remaining quota unchanged (SC-006). Optional, when the ISP is ready: switch actions on.

**Checkpoint**: one real payment validated in production, and the pools are
separate.

---

## Phase 5: User Story 3 — A bad release is undone from CI (P3)

**Goal**: `rollback-prod.yml` exists before the first release, returns one
service to one version, tells the truth about whether it did, and touches no
data. It is rehearsed by the first release.

**Independent Test**: after T020, run it against the version that is
already live — completes, changes nothing, proves the path.

### Code

- [X] T024 [US3] Create `.github/workflows/rollback-prod.yml` (D7, research R7): `name: Rollback Prod`; `on: workflow_dispatch` with inputs `worker` (type `choice`, options `api`, `admin`, `pago`, required) and `version_id` (type `string`, required); `concurrency: { group: deploy-prod, cancel-in-progress: false }`; one job `rollback` with `environment: production`, `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` from the environment as in `deploy-prod.yml`, checkout + pnpm + node 22 + `pnpm install --frozen-lockfile`; a step that maps `worker` to `--config` (`api` → none, `admin` → `--config ../admin/wrangler.jsonc`, `pago` → `--config ../pago/wrangler.jsonc`), runs from `apps/api` `pnpm exec wrangler rollback "$VERSION_ID" --env prod -y -m "${{ github.actor }} · ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}" $CONFIG`, then reads `pnpm exec wrangler deployments list --env prod --json $CONFIG | jq -r '.[0].versions[0].version_id'` and exits 1 with `::error::Rollback did not take: live is <live>, asked for <id>. wrangler declines non-interactively when secrets changed since that version (production-launch D7).` unless equal; on success prints `<worker> now serves <id>`. Header comment: what it is, that it never touches D1/R2/secrets, that the release's `d1-backup-<tag>` artifact is the restore point and restoring is a human act (FR-011), and that it queues behind a release. Cite D7.

### Verification

- [ ] T025 [US3] **Rehearsal (spec US3 scenario 3)** — after T020: Actions → *Rollback Prod* → `worker: api`, `version_id: <the API's id from the release summary>` (the click is the act; no further pause); the job must complete and print `api now serves <that id>`. Check `curl -s https://api.devoladapago.com/health` still answers. A real rollback to a *previous* version (scenario 1) waits for the day a second release exists; the rehearsal proves the path. Record the run URL for T028.

**Checkpoint**: the undo exists, was exercised, and its verification is
what makes it trustworthy.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T026 Run the gates in CI order once more on the finished branch (the T001 list) and `/speckit-analyze` on this feature; resolve any CRITICAL finding before opening the PR.
- [ ] T027 Open the PR to `main` titled `feat(006): production launch — the release, the runbook, the undo`: body lists the decisions D1–D14, the evidence link from T019, and the pre-flight state from T002/T006 (names only). Merge only after CI is green; the *Deploy Dev* run of the merge commit is the commit T020 tags.
- [ ] T028 **After the launch** — append `## Launch record (<date>)` to `specs/006-production-launch/tasks.md` with: the release run URL (T020), the three version ids and the archive name, the day-one outcomes (T021–T023: code-arrival time, the first payment's status), the rehearsal run URL (T025), and any `::warning::` the release printed. Tick T020–T025. Open the follow-up PR (`docs(006): launch record`). This is the same shape as 004's post-merge note; the tree keeps the record, not the chat.

---

## Dependencies & Execution Order

```text
Setup (T001–T002)
   ├─▶ Foundational / environment (T003–T009)  ── outside the repo; blocks T020, not the code
   └─▶ US1 code (T010–T018)
          ├─▶ US3 code (T024)  ── before T018's syntax check and before the PR
          ├─▶ T019 (refusal proof, on the branch)
          └─▶ Polish T026–T027 (PR, merge)
                 └─▶ T020 (the release, on the creator's word; needs T003–T009 done)
                        ├─▶ US2 (T021–T023, in order)
                        ├─▶ US3 verification (T025)
                        └─▶ T028 (launch record, follow-up PR)
```

**Why the environment is foundational but not blocking**: nothing in
T003–T009 is read by the code tasks; all of it is read by the release. Do it
while the code is being written, in any order; T003 and T006 wait for the
creator's word, T005/T007/T009 are the creator's hands.

**Why T024 sits inside US1's checkpoint**: the smoke's failure text (T015)
and CLAUDE.md (T017) point at a workflow that must exist in the same PR.

**Within US1**: T010–T015 are one file, in order (they edit neighbouring
regions of `deploy-prod.yml`); T016 and T017 are independent files and run
beside them; T018 after T024.

**Why T020 follows the merge**: a tag names a `main` commit, and the gate
(T010) requires that commit's *Deploy Dev* run to be green — the merge
commit's own run.

## Parallel opportunities

| Wave | Tasks | Files / places |
| --- | --- | --- |
| Setup | T001, T002 | the gates; the environments (read-only) |
| Environment | T004, T005, T007, T008, T009 (T003 and T006 on the creator's word, any time) | GitHub variables; apiCEP; GitHub secrets; Cloudflare R2; Resend |
| Code | T016, T017 beside T010–T015; T024 beside all of them | `deploy-dev.yml`; `CLAUDE.md`; `rollback-prod.yml` |
| After the release | T021 → T022 → T023 (in order) beside T025 | the panel; the Actions tab |

## Implementation Strategy

### MVP first (User Story 1 + the undo's file)

1. Phase 1: baseline (T001–T002).
2. Phase 3 code + T024: the three workflows and CLAUDE.md. **Stop and
   validate**: T018 (syntax), T019 (the gate refuses on GitHub).
3. Phase 6: `/speckit-analyze`, the PR, the merge. Production is now
   *releasable*; nothing has been released.

### The launch

4. Phase 2 complete (every pre-flight box ticked).
5. T020: the tag — which is the approval — and the log. Production exists.
6. Phase 4: the day-one path — the creator's business, the operator
   panel, the first ISP, one real transfer.
7. T025: the rehearsal. T028: the record.

### One developer, one branch

Code lands on this branch and merges once. The release, the day-one path,
the rehearsal and the record happen after the merge — the only steps that
do — and the record's follow-up PR closes the feature.

---

## Notes

- [P] tasks touch different files or places and depend on nothing unfinished.
- The agent never sees a credential value: T005, T007, T009 are the
  creator's; T003, T006 wait for the creator's word; T008 carries an address
  the creator gave in session, not a secret.
- "Evidence" means a run URL, a curl output, a panel state or a D1 row —
  something a reader can open. It lands in the PR (T019) and in the launch
  record (T028), never only in chat.
