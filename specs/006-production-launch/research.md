# Research: production-launch

**Feature**: 006 · **Date**: 2026-09-17 · **Phase**: 0

Every finding below was read out of the tree at `1720769` (main, after PRs
#200–#210), out of the Cloudflare account `devoladapago`, out of the GitHub
repository's environments, or out of wrangler 4.123.0's own bundle
(`node_modules/.pnpm/wrangler@4.123.0_*/node_modules/wrangler/wrangler-dist/cli.js`).
Where a number is given, it was counted with a command that can be run
again. The spec's four clarifications (spec it; on at launch with a second
token; one operator; open sign-up) are taken as settled; this document
resolves what they leave to the plan.

---

## R1 — The release refuses a commit whose dev deploy is not green, by asking the repository

**Decision**: a `gate` job runs first on every tag (and on manual dispatch)
and asks the repository, with the run's own `GITHUB_TOKEN`, whether a
*Deploy Dev* run exists for `github.sha` and concluded `success`:

```
GET /repos/{owner}/{repo}/actions/workflows/deploy-dev.yml/runs?head_sha=<sha>&per_page=10
```

filtered to `.workflow_runs[] | select(.conclusion == "success")`. None →
the job fails with the commit and the reason; the `test` and `deploy` jobs
`need` it and never start. The job declares `permissions: actions: read,
contents: read` explicitly so a repository that later tightens default
token permissions does not silently break the gate.

**Rationale**: CLAUDE.md promises that "the browser and passkey layers gate
[the dev deploy]" and the prod tag "deploys behind an approval gate" — but
today nothing ties the two. `pnpm e2e` and `pnpm e2e:passkey` run only in
`deploy-dev.yml` (lines 48–55); `deploy-prod.yml`'s `test` job is a strict
subset of the PR gate (§R2). A tag on a commit whose dev deploy failed would
reach the approval with a green `test` job and a red dev. The REST filter
`head_sha` is exact and free; the token needs only `actions: read`. A tag on
a commit that is not on `main` has no dev run at all and is refused for the
same reason, which is the rule the constitution wants ("Production deploys
from a `v*` tag" of `main`).

**Alternatives considered**: repeating `pnpm e2e` and `pnpm e2e:passkey` in
the tag job (rejected — 8–10 minutes and a chromium install to re-prove a
commit that already proved itself; and a flaky re-run could block a hotfix
that dev already accepted); trusting the tagger (rejected — that is the
status quo, and the status quo is a discipline, not a gate); requiring the
tag to be reachable from `main` with `git merge-base --is-ancestor`
(rejected as the only check — it proves lineage, not that the gates ran;
kept as a *second* line in the same step because it is free and names a
different mistake).

---

## R2 — The tag runs the PR loop's lint set: `pending-lint` joins both deploy workflows

**Decision**: `node scripts/pending-lint.mjs` is added to the `test` job of
`deploy-prod.yml` and `deploy-dev.yml`, in the position `ci.yml` gives it
(after `contrast-lint`, before typecheck).

**Rationale**: `ci.yml:29-30` runs it; neither deploy workflow does
(counted: `grep -c pending-lint` → 1, 0, 0). CLAUDE.md's stated CI order
includes it. A tag's `test` job must not be a subset of what a PR ran
(FR-003). The gate is cheap (a grep over the tree) and a rule that CI
enforces on PRs but not on releases is a rule with a hole.

**Alternatives considered**: a reusable workflow (`workflow_call`) holding
the shared job so the three files cannot drift (rejected for this feature —
a structural refactor of three workflows to add one line; worth a debt entry
if the set drifts again, not worth the diff now).

---

## R3 — The approval gate is a required reviewer plus a tag-only rule, set through the API on the creator's word

**Decision**: the GitHub `production` environment gets one required reviewer
(`leolicona`, user id read with `gh api users/leolicona --jq .id`), a
`deployment_branch_policy` of `custom_branch_policies`, and one policy of
type `tag` with pattern `v*`. Both are set with two `gh api` calls the
runbook prints verbatim, executed only after the creator says go (a
persistent configuration change):

```
PUT  /repos/leolicona/devolada/environments/production
     { "reviewers": [{ "type": "User", "id": <id> }],
       "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
POST /repos/leolicona/devolada/environments/production/deployment-branch-policies
     { "name": "v*", "type": "tag" }
```

`prevent_self_review` stays `false`: one developer builds this product.

**Rationale**: measured 2026-09-17 with `gh api …/environments`: the
`production` environment has `protection_rules: []` and
`deployment_branch_policy: null`. `deploy-prod.yml:34-35` says "Environment
with required reviewer: the job pauses here until human approval" — a comment
describing a gate that does not exist. The tag-only rule closes a second
hole: `workflow_dispatch` on `main` is allowed by the workflow (FR-001 wants
it, for re-planting a credential), and the rule must therefore admit the
`main` branch too — **so the policy holds two entries**: tag `v*` and branch
`main`. A dispatch from any other branch is refused by GitHub before the job
starts.

**Alternatives considered**: setting it by hand in Settings → Environments
(equally valid; the runbook allows either — the API form is recorded so the
act is reproducible and its log is in the conversation); a second reviewer
(rejected — there is no second person); `wait_timer` (rejected — a delay is
not a decision).

---

## R4 — A missing email key is a warning that names the consequence

**Decision**: in `deploy-prod.yml`'s secrets sync, the `RESEND_API_KEY`
branch prints `::warning::No RESEND_API_KEY in the production environment —
nobody can finish signing up: the verification code is only logged
(production-launch D5).` The deploy continues. `deploy-dev.yml` gets the same
sentence for the same reason. `BETTER_AUTH_SECRET` remains the only refusal.

**Rationale**: `apps/api/src/email/sender.ts:36-39` logs the code instead of
sending when the key is unset; `apps/api/src/auth/better.ts:49-51` sets
`requireEmailVerification: true`; so with no key, no person can complete
sign-up in production. Today the step prints a plain "skipping (TD-011)"
line — invisible in a green run. Constitution VIII: "Degrade loudly, in the
UI and in the deploy log", and "`BETTER_AUTH_SECRET` is the one exception".
Making Resend a second refusal would need an amendment for a case the
warning already makes impossible to miss.

**Alternatives considered**: refusing the deploy (rejected — constitution
VIII names one refusal, and a dark launch without email is a legitimate
state the spec's edge cases allow); leaving it (rejected — measured: the
production environment lacks the key today, and the line would have scrolled
past).

---

## R5 — The smoke proves three hostnames, each with its own wait

**Decision**: the smoke step loops over three URLs — `PROD_API_URL/health`,
`PROD_ADMIN_URL/`, `PROD_PAGO_URL/` — each with the existing 10 × 30 s wait,
skipping (with a warning) any whose variable is unset. The two new repository
variables are `PROD_ADMIN_URL=https://app.devoladapago.com` and
`PROD_PAGO_URL=https://link.devoladapago.com`. A failure names the URL and
points at `rollback-prod.yml`.

**Rationale**: the three services are three Workers on three custom domains
(`apps/api/wrangler.jsonc:76`, `apps/admin/wrangler.jsonc:16`,
`apps/pago/wrangler.jsonc:18`); each domain's first certificate is its own
race ("measured on the punto/admin domain move: DNS resolved, TLS was not
ready yet", `deploy-dev.yml`). `/health` proves only the API. An assets
Worker with `not_found_handling: single-page-application` answers `/` with
`200` and the SPA shell, so `curl -sf` is a valid probe for both.
`dig` on 2026-09-17: none of the three hostnames resolves yet — the first
release creates all three, and all three race.

**Alternatives considered**: hard-coding the two URLs (rejected — the
existing pattern is a variable with a skip; the constitution's "base URLs
are vars, never literals" is about Worker config but its reason applies);
probing a deeper route on the SPAs (rejected — the shell answering is what
the assets Worker can prove; the app's own health is the API's).

---

## R6 — The release log states what is live: version ids from the deploy output, into the job summary

**Decision**: each `wrangler deploy` step tees its output to a file; a final
step greps `Current Version ID:` out of the three files and writes a table —
service, version id — plus the archive artifact's name into
`$GITHUB_STEP_SUMMARY`, and echoes the same to the log. The version ids are
what `rollback-prod.yml` takes as input.

**Rationale**: wrangler 4.123.0 prints `Current Version ID: <uuid>` on every
deploy (string present in the bundle); `wrangler deployments list --json`
returns the same ids but needs three more API calls and a JSON shape to
parse. The job summary is the one place the creator reads after approving.
FR-009: "which version of each service is live and which archive was taken,
without opening another tool."

**Alternatives considered**: `wrangler versions list --json` per service
(kept for the rollback's *verification*, R7 — not needed here).

---

## R7 — Rollback is `wrangler rollback <id> -y` per service, verified by reading the active deployment

**Decision**: `.github/workflows/rollback-prod.yml`, `workflow_dispatch`
with inputs `worker` (choice: `api`, `admin`, `pago`) and `version_id`
(string), `environment: production` (so it pauses for the same reviewer),
`concurrency: deploy-prod` (so it queues behind a release rather than racing
it). From `apps/api` it runs
`wrangler rollback "$VERSION_ID" --env prod -y -m "rollback by <actor>: <run url>"`,
adding `--config ../admin/wrangler.jsonc` or `../pago/wrangler.jsonc` for the
two assets Workers. It then reads
`wrangler deployments list --env prod --json [--config …]` and fails unless
`.[0].versions[0].version_id == "$VERSION_ID"` — because wrangler's own
non-interactive path can *decline* silently.

**Rationale**: read in the bundle (rollback handler, ~line 425300):
`prompt2(...)` for the message falls back to `args.message` in CI;
`confirm2("Are you sure…", { defaultValue: true })` proceeds; but the
second confirmation — "The following secrets have changed since version X
was deployed" — has **no default** and in CI answers *no*, then
`cancel("Aborting rollback...")` returns without an error. A job that trusts
the exit code would report a rollback that did not happen. Reading the
active deployment afterwards makes the job honest. `deployments list --json`
is the raw `/workers/scripts/{name}/deployments` array, newest first, each
with `versions[{version_id, percentage}]`.

Rollback never touches D1: wrangler's own warning says so ("Rolling back to
a previous deployment will not rollback any of the bound resources"), and
the workflow's header repeats it. The export artifact from the release is
the restore point; restoring it is a human act by decision (FR-011).

**Alternatives considered**: re-running the previous tag's release (rejected
— re-migrates, re-plants, takes minutes, and "the previous tag" is not
always what you want back); `wrangler versions deploy` with a traffic split
(rejected — gradual rollouts are out of scope); rolling back all three
services in one job (rejected — a bad panel build should not move the API;
one service per run, three runs if needed).

---

## R8 — The apiCEP probe spends one credit per deploy; the comment says so

**Decision**: the probe step's comment in `deploy-prod.yml` (and
`deploy-dev.yml`, which carries the same paragraph) stops saying "The probe
is free" and says the probe costs one credit per deploy, citing the
measurement.

**Rationale**: the archive's apiCEP notes measured on 2026-08-19 that a
request rejected with 400 is still billed (quota decremented). The comment
was written from the assumption that an empty body is rejected "before
apiCEP touches Banxico, so no credit is spent"; the measurement says
otherwise. A comment that states a cost wrongly is worse than none — the
creator budgets against it. The probe itself stays: one credit per release
to avoid the six-hour silence of 2026-08-18 is the right trade.

**Alternatives considered**: removing the probe to save the credit
(rejected — the incident it guards against cost a day of payer trust);
probing only when the secret changed (rejected — a revoked token does not
change in the environment; the probe is about the provider's side).

---

## R9 — The bucket rule is applied by hand, once, and checked before the tag

**Decision**: `expire-15d` (15 days) on `devolada-transfer-proofs` is set in
the Cloudflare dashboard (R2 → bucket → Settings → Object lifecycle rules)
by the creator, and the runbook's pre-flight has it as a checkbox. The
release does not create, check or modify bucket policy.

**Rationale**: `apps/api/wrangler.jsonc:18-21` records the rule as "bucket
config, applied once per env"; the code assumes it
(`direct-payments/proofs.ts`: "the 15 days of proofs the lifecycle rule
keeps"). No CI step applies it; the dev bucket's rule was applied by hand in
the archive era. The deploy credential is scoped to what a deploy needs
(scripts, D1, Workers AI, the zone); R2 *management* is not among them, and
widening a deploy token to manage storage policy for a once-per-environment
act is the wrong trade. The Cloudflare MCP available in session does not
expose lifecycle rules, so the check is the dashboard.

**Alternatives considered**: a CI step `wrangler r2 bucket lifecycle add`
guarded by `lifecycle list` (rejected — needs R2 scope on the deploy token,
and its failure mode on a token without it is a red release for a rule that
is not the release's); a Terraform-shaped resource file (rejected — the
stack has no infrastructure-as-code layer and one rule does not justify one).

---

## R10 — The retired secrets are deleted from both environments with `gh secret delete`, on the creator's word

**Decision**: after the creator's explicit go-ahead in chat, run
`gh secret delete CONSTA_ISSUER_TOKEN --env production` and, for dev,
`gh secret delete CONSTA_API_KEY --env dev`, `CONSTA_ISSUER_TOKEN --env dev`,
`CONSTA_ADMIN_TOKEN --env dev`. Then re-list both environments and record the
count of unread secrets as zero.

**Rationale**: measured 2026-09-17 with `gh secret list --env …`:
`production` holds `CONSTA_ISSUER_TOKEN`; `dev` holds the three Consta-era
names. Nothing in any workflow on `main` reads them (`grep -rn CONSTA_
.github` → 0). Spec 004 T049 named exactly this act and left it open pending
the go-ahead. A secret nothing reads is a secret nobody rotates.

**Alternatives considered**: leaving them (rejected — SC-008 counts them).

---

## R11 — CLAUDE.md names the two acts; the archive citations in the workflows stay

**Decision**: in CLAUDE.md's "Commands" paragraph, beside "**Never deploy
from a local machine.**", two sentences: a release is `git tag vX.Y.Z &&
git push origin vX.Y.Z` on a `main` commit whose Deploy Dev is green;
rollback is Actions → *Rollback Prod* with the service and the version id
from the release's summary. The four workflow headers keep citing "CICD.md
path 1/2/3" — CLAUDE.md says archive citations stay intact, and they resolve
in `leolicona/devoladapago-legacy-documentation`. Only the smoke's failure
*hint* ("consider wrangler rollback (CICD.md)") changes, because it is an
instruction to a person in a red log, not a citation.

**Rationale**: the runbook lives in this feature's `quickstart.md`; the
agent guidance needs one line that points there. FR-014 and FR-015.

---

## R12 — What is accepted as-is, and why

- **The D1 export without `--env prod`** (`deploy-prod.yml:49`). Read in the
  bundle (`getDatabaseByNameOrBinding`): the name is looked up in the
  selected environment's `d1_databases` first, and when it is not there,
  wrangler calls `GET /accounts/{id}/d1/database/{name}` and accepts a name.
  `devolada-db-prod` exists in the account (listed 2026-09-17), so the step
  resolves it. The export command does not warn about unselected
  environments. Left as is: a working step is not changed for symmetry.
- **The export of an empty database.** The archive's runbook expected it
  ("The D1 export it takes first is empty the first time, which is
  correct"). `upload-artifact@v4` defaults to `warn` on a missing file, so an
  empty export cannot fail the run. Left as is.
- **The seconds between `wrangler deploy` and `secret put BETTER_AUTH_SECRET`
  on the first run.** TD-011: a secret can be planted only after the service
  exists and its latest version is deployed. On the very first release the
  API signs with the public dev value for a few seconds, before any person
  can hold a session; the window never recurs. Accepted and recorded in the
  spec's edge cases. The alternative — `versions upload`, plant, `versions
  deploy` — is a second deployment model for a one-time window with no users.
- **`workflow_dispatch` re-runs.** `github.ref_name` is `main`, so the
  archive artifact is `d1-backup-main`; artifact names are per run, so two
  dispatches do not collide. The gate (R1) applies to the dispatched
  commit exactly as to a tag.
- **`003-automated-collections-api`'s `WEBHOOK_SIGNING_KEYS`.** Declared in
  `env.ts` since PR #204 with a full degrade comment; read by later phases
  not on `main`. Its planting joins the sync step when those phases land, in
  their own tasks. This feature plants what `main` reads today.
- **The plan the account is on.** One ISP, an every-minute cron
  (1,440 invocations/day), a few validations and readings a day fit any
  Workers plan; the runbook names where to read usage (Workers & Pages →
  Overview; D1 and Workers AI dashboards) so the day it stops fitting is
  seen, not guessed.
