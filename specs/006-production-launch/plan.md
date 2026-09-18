# Implementation Plan: production-launch

**Branch**: `claude/production-deployment-b1e0c6` | **Date**: 2026-09-17, amended 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-production-launch/spec.md`

## Summary

Make the first production release a repeatable act, and make it. The
pipeline that deploys from a `v*` tag already exists and has never run; what
this feature adds around it is the gate that ties a tag to a green dev
deploy, the lint parity with the PR loop, a deployment policy on the
environment in place of the reviewer the workflow's comment promised (the
tag is the approval — amended 2026-09-18), warnings that name
consequences instead of variables, a smoke that proves all three public
hostnames, a job summary that says what landed, a rollback job that is
honest about whether it rolled back, and the runbook that tells one person
what to do before, during and after. No application code, copy or schema
moves.

Phase 0 read the pipeline, the environments, the account and wrangler's
bundle rather than assuming them. Three findings shaped the design:

- **The approval gate does not exist — and cannot, on this plan.**
  `deploy-prod.yml` says "the job pauses here until human approval"; the
  `production` environment has no protection rule, and GitHub refuses to
  add a required reviewer to a private repository on the Free plan
  (measured 2026-09-18). The creator chose the tag as the approval: the
  deliberate act is the push, and the mechanical gate below is what keeps
  it safe (R3, constitution v1.4.0).
- **Nothing ties the tag to the dev gates.** The browser and passkey layers
  run only on merge to `main`; a tag's `test` job is a strict subset of the
  PR gate. The release now asks the repository for the commit's green
  *Deploy Dev* run before it touches production (R1, R2).
- **`wrangler rollback` can decline silently in CI.** Its second
  confirmation (secrets changed since that version) has no default and
  answers *no* non-interactively, then returns without an error. The
  rollback job reads the live deployment afterwards and fails unless it is
  the version asked for (R7).

The rest is operations the pipeline cannot do for itself — three secrets the
creator plants, one deployment policy, two variables, one bucket rule, a
second provider token — and the day-one path: the creator's own business first, so
the operator panel opens and the platform's top-up account exists before any
ISP runs through its welcome allowance.

## Technical Context

**Language/Version**: GitHub Actions YAML; bash in steps; `gh` CLI (present
on `ubuntu-latest`) against the GitHub REST API; wrangler 4.123.0 (pinned in
the lockfile) for deploy, `d1 export`, `secret put`, `rollback`,
`deployments list`. No TypeScript is touched.

**Primary Dependencies**: `actions/checkout@v4`, `pnpm/action-setup@v4`,
`actions/setup-node@v4`, `actions/upload-artifact@v4` (already in use);
GitHub environments (deployment branch/tag policies; required reviewers are
not available to a private repository on the Free plan — R3);
Cloudflare Workers, D1, R2, Workers AI, the `devoladapago.com` zone; apiCEP
(`https://api.apicep.cloud`, one billed call per release); Resend
(`devoladapago.com` verified).

**Storage**: none added. D1 `devolada-db-prod` receives the migration history
(0000–0029 on 2026-09-17) on the first release; the export before it is an
artifact kept 30 days. R2 `devolada-transfer-proofs` gains a lifecycle rule
by hand (D10).

**Testing**: no test file (constitution IV has no layer for a workflow;
quickstart §4). The feature's proof is executable but not by vitest: the
`gate` job refusing a commit without a green dev run; the first release's
log read against quickstart §1; the day-one path (US2) ending in a verdict;
the rollback rehearsal (US3). Each is a verification task with evidence
recorded in the PR.

**Target Platform**: GitHub Actions `ubuntu-latest`; Cloudflare Workers
`compatibility_date` 2025-05-01; environment `prod` under
`devoladapago.com` — `api.`, `app.`, `link.` custom domains created by the
first release.

**Project Type**: pnpm monorepo; this feature is pipeline + guidance +
runbook. Files: 2 workflows edited, 1 added; `CLAUDE.md`; this spec's
artifacts.

**Performance Goals**: a release completes in one run — gate < 30 s, test
job ≈ 6 min (as today), deploy ≈ 4 min plus up to 5 min per hostname on the
first certificate; rollback < 5 min from click to verified live version
(SC-007).

**Constraints**: never deploy from a laptop (constitution, Development
Workflow); secrets planted after the deploy (TD-011) and the provider
credential verified by reading the body (constitution VIII); `BETTER_AUTH_SECRET`
stays the one refusal (VIII); the agent never handles a credential value —
the creator plants `RESEND_API_KEY` and `APICEP_TOKEN`; persistent
configuration (deployment policy, secret deletion) only on the creator's
explicit word in chat.

**Scale/Scope**: one developer, whose tag push is the approval, one pilot ISP; first tag
`v1.0.0`; 29 migrations replayed on an empty database; three Workers, three
hostnames, five secrets, five variables.

## Decisions

Code comments cite these as `production-launch D<n>` (constitution I).

| # | Decision | Made in |
| --- | --- | --- |
| D1 | The tag is the release, cut only from a `main` commit whose *Deploy Dev* run finished green. A `gate` job asks the repository (REST, `head_sha`) and requires `main` lineage before `test` runs | spec FR-002, research R1 |
| D2 | The tag runs the PR loop's lint set: `pending-lint` joins `deploy-prod.yml` and `deploy-dev.yml` | spec FR-003, research R2 |
| D3 | The tag is the approval: pushing a `v*` tag is the deliberate act; the `production` environment accepts deployments only from tags `v*` and the branch `main` (set via `gh api` on the creator's word). No required reviewer — not available to this private repository on the Free plan (measured 2026-09-18), and GitHub Pro and a third-party pause were declined | spec Clarifications 2026-09-18, FR-004, research R3; constitution v1.4.0 |
| D4 | Validation is on at launch with a production-only apiCEP token; dev keeps its own | spec Clarifications, FR-016 |
| D5 | A missing `RESEND_API_KEY` is a `::warning::` that says "nobody can finish signing up"; not a refusal | spec FR-006, research R4 |
| D6 | The smoke proves `PROD_API_URL/health`, `PROD_ADMIN_URL/`, `PROD_PAGO_URL/`, each with its own wait; two new repository variables; failure names the URL and the undo | spec FR-008, FR-014, research R5 |
| D7 | Rollback is `rollback-prod.yml`: `workflow_dispatch`, `production` environment, one service and one version per run, `wrangler rollback -y`, then the live deployment is read and must match; never touches data | spec FR-010, FR-011, research R7 |
| D8 | Open sign-up at launch; admission policy is the next feature | spec Clarifications |
| D9 | One operator address; the creator's own business is production's first row so the operator can sign in; the top-up account and support contact are set on day one | spec Clarifications, FR-018 |
| D10 | The bucket rule `expire-15d` is applied once by hand and checked in the pre-flight; the release does not manage bucket policy | spec Edge Cases, research R9 |
| D11 | The provider probe spends one credit per release; the comment that said "free" is corrected, the probe stays | spec FR-007, research R8 |
| D12 | The release log states what landed: version ids captured from each deploy's output and the archive name, in the job summary | spec FR-009, research R6 |
| D13 | The retired `CONSTA_*` secrets are deleted from both environments with `gh secret delete`, on the creator's go-ahead | spec FR-020, research R10 |
| D14 | `CLAUDE.md` names the two acts beside "never deploy from a local machine"; the workflows' archive citations stay; only the smoke's red-log hint changes | spec FR-014, FR-015, research R11 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Planned against v1.3.0. One gate per principle.

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Fourteen decisions, each with the place it was made. Every rule the workflows gain — the gate, the lint line, the warning text, the three-host smoke, the summary, the rollback verification, the corrected probe cost — cites `production-launch D<n>` in the YAML comment beside it. Archive citations (`CICD.md path 1/2/3`) stay intact per CLAUDE.md | PASS |
| II | Money Law | No amount is touched. The only number this feature states is a cost in provider credits (D11), stated as a count | PASS (N/A) |
| III | One Contract, Pure Routers | No route, schema or envelope changes. The bank vocabulary check keeps running in the tag job as today | PASS (N/A) |
| IV | Tests Run on the Real Runtime | No product code changes, so nothing to prove in workerd or happy-dom; no test file is added and none is mocked. The feature's runtime is the pipeline itself, which the constitution's four layers do not cover: its proof is the release run read against the runbook, the gate refusing a commit without a green dev run, and the rollback rehearsal — each a verification task with its evidence linked in the PR. Recorded in *Complexity Tracking* as a judgement, not a violation | PASS (with judgement) |
| V | Tenant Isolation and Authorization by Area | No query changes. `PLATFORM_OPERATOR_EMAILS` is planted by the release, which is exactly the principle's rule: "changing it is a deploy". Open sign-up (D8) touches no isolation rule — a business born active is the status quo the constitution left open on purpose | PASS |
| VI | Visual Foundations | No token, component, copy or screen is touched | PASS (N/A) |
| VII | Every Test Cites Its Story | No `*.test.*` or `*.spec.*` file is added or changed; `spec-lint` runs in the tag job as it does on PRs (D2). The stories' proofs are tasks, cited `[US1]`–`[US3]` in `tasks.md`, with evidence, because the layer that can answer them is a CI run | PASS (with the same judgement as IV) |
| VIII | Absent Configuration Degrades, Never Breaks | `BETTER_AUTH_SECRET` remains the one refusal. Every other absence is now a `::warning::` that names the consequence — email (D5), provider, operator; the smoke skips an unset URL with a warning (D6). Secrets are planted after the deploy (TD-011) and the provider credential is verified by reading the body, at a stated cost (D11). The proofs bucket rule is a documented manual act, not an accident (D10) | PASS |

**Stack table**: the Environments row — "`dev` and `prod` per Worker under
`devoladapago.com`; per-PR preview versions" — describes what the first
release creates. No departure.

**Development Workflow & Quality Gates**: planned against v1.3.0's bullet
("through the `production` environment's approval gate"); on 2026-09-18 the
gate proved unavailable to this repository and the creator amended the law
rather than route around it — v1.4.0 reads "the tag is the approval: pushing
it is the deliberate act, taken on a `main` commit whose dev deploy finished
green — the release refuses any other commit before it touches production —
with a D1 export archived before migrating." This feature makes each clause
true: the refusal (D1), the deployment policy (D3), the archive (kept).

**Post-design re-check (after Phase 1)**: PASS, unchanged. **Re-check after
the 2026-09-18 amendment**: PASS — D3 changed mechanism, not principle; the
constitution's own bullet was amended first (governance: the feature's plan
proposes the amendment, it does not route around it). The data model
adds no table; the contracts describe a pipeline and an environment, not an
API; the runbook prescribes acts, not code. The one judgement (IV/VII) is
the one expected before research began and is recorded below.

## Project Structure

### Documentation (this feature)

```text
specs/006-production-launch/
├── plan.md                    # This file
├── research.md                # Phase 0 — R1–R12
├── data-model.md              # Phase 1 — release, environment, archive, version, runbook, first business
├── quickstart.md              # Phase 1 — THE RUNBOOK: pre-flight, release, verify, undo, after
├── contracts/
│   ├── release-pipeline.md    #   what Deploy Prod and Rollback Prod accept, refuse, print, leave
│   └── environment.md         #   what must exist outside the repo, who sets it, how it is checked
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md                   # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
.github/workflows/
├── deploy-prod.yml            # ~ + gate job (D1); + pending-lint (D2); RESEND ::warning:: (D5);
│                              #   probe comment "one credit" (D11); tee deploy outputs + summary (D12);
│                              #   smoke over three URLs, failure names rollback-prod.yml (D6, D14)
├── deploy-dev.yml             # ~ + pending-lint (D2); RESEND ::warning:: (D5); probe comment (D11)
├── rollback-prod.yml          # + workflow_dispatch: worker + version_id; production env;
│                              #   wrangler rollback -y; verify live version; never data (D7)
├── ci.yml                     # unchanged
└── retire-consta.yml          # unchanged (004 T050 removes it after it runs)

CLAUDE.md                      # ~ two sentences beside "Never deploy from a local machine" (D14)

apps/ packages/ scripts/       # unchanged — no application code, copy, schema or test
```

Outside the tree, by the runbook (contracts/environment.md): the
`production` environment's deployment policy (D3); secrets
`RESEND_API_KEY`, `APICEP_TOKEN` (creator), `PLATFORM_OPERATOR_EMAILS`;
variables `PROD_ADMIN_URL`, `PROD_PAGO_URL`; deletion of `CONSTA_*` (D13);
the R2 lifecycle rule (D10); the second apiCEP token (D4); the Resend domain
check.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

| Judgement | Why | Simpler alternative rejected because |
| --- | --- | --- |
| Stories proven by verification tasks with evidence, not by cited test files (IV, VII) | The feature changes no application code; its subject is the pipeline, whose only real runtime is a CI run. A vitest for a workflow would mock the pipeline — the thing constitution IV forbids | A shell test harness for the gate's `jq` filter was considered: it would prove the filter and nothing about the run. The gate is instead exercised for real — once against a commit with no dev run (refusal, US1 scenario 2) and once by the release (US1 scenario 1) — and both logs are linked from the PR |
