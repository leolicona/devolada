# Contract: the release pipeline

**Feature**: 006 · **Date**: 2026-09-17 · **Phase**: 1

What `deploy-prod.yml` and `rollback-prod.yml` accept, refuse, print and
leave behind. The workflows are the implementation; this is what a person
or a later feature may rely on.

## `deploy-prod.yml` — Deploy Prod

### Triggers

| Trigger | Ref | Use |
| --- | --- | --- |
| `push` of a tag `v*` | the tag | a release (D1) |
| `workflow_dispatch` | the branch it is started from — the environment rule admits `main` only | re-plant a credential added after launch; redeploys the same code (spec edge case) |

### Jobs, in order

1. **`gate`** (D1) — `permissions: actions: read, contents: read`.
   - Reads the *Deploy Dev* runs for `github.sha`; requires one with
     `conclusion == "success"`. Otherwise fails:
     `::error::No green Deploy Dev run for <sha>. Tag a main commit whose dev deploy finished green (production-launch D1).`
   - Also requires `github.sha` to be reachable from `origin/main`
     (`git merge-base --is-ancestor`); otherwise fails naming the branch
     mistake.
2. **`test`** (D2) — `needs: gate`. In this order, none skippable:
   `spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint`,
   typecheck, test, build.
3. **`deploy`** — `needs: test`, `environment: production` (pauses for the
   reviewer, D3), `concurrency: deploy-prod`. Steps and their promises:

| Step | Promise |
| --- | --- |
| D1 export → artifact `d1-backup-<ref>` | taken before the first migration; kept 30 days; empty on the first run |
| D1 migrations `--env prod --remote` | additive history replayed; per-file rollback on failure |
| Deploy API | output tee'd; `Current Version ID` captured |
| Sync secrets | `BETTER_AUTH_SECRET` absent → `::error::` and exit 1 (the one refusal). `RESEND_API_KEY` absent → `::warning::… nobody can finish signing up (D5)`. `PLATFORM_OPERATOR_EMAILS` absent → `::warning::… operator panel is closed to everyone`. `APICEP_TOKEN` absent → `::warning::… SPEI channel stays unavailable`. Present → planted, one line each |
| Verify provider credential | absent → warning, exit 0. Present → one billed call (D11); 400 = accepted; 401 = `::error::` naming the measured cause, exit 1; anything else = warning |
| Build + deploy admin, build + deploy pago | `VITE_API_URL` from `vars.PROD_API_URL`; outputs tee'd |
| Smoke (D6) | for each of `PROD_API_URL/health`, `PROD_ADMIN_URL/`, `PROD_PAGO_URL/`: up to 10 × 30 s; unset variable → `::warning::` and skip; failure → `::error::<url> did not answer in 5 minutes. To return a service to its previous version run Actions → Rollback Prod (production-launch D7).` exit 1 |
| What landed (FR-009) | job summary and log: a table `service | version id` for the three, and the archive artifact name |

### What it never does

- Deploy from anywhere but a CI run.
- Roll back or restore data.
- Manage bucket policy (D10) or create environments, reviewers or variables.

## `rollback-prod.yml` — Rollback Prod

### Trigger

`workflow_dispatch` only, `environment: production` (same reviewer),
`concurrency: deploy-prod` (queues behind a release).

| Input | Type | Meaning |
| --- | --- | --- |
| `worker` | choice `api` / `admin` / `pago` | which service |
| `version_id` | string | the version to make live — from a release's summary, or `wrangler versions list` in a previous log |

### Promise

- Runs `wrangler rollback <version_id> --env prod -y -m "<actor> · <run url>"`
  from `apps/api`, with `--config ../admin/wrangler.jsonc` or
  `../pago/wrangler.jsonc` for the assets Workers.
- Then reads the live deployment (`wrangler deployments list --env prod
  --json`) and **fails unless** `.[0].versions[0].version_id` equals the
  input — wrangler's non-interactive path can decline a rollback across a
  changed secret without a non-zero exit (research R7).
- Touches no database, bucket or secret; its header says so (FR-010).
- Prints the version now live.

### What it never does

- Restore data (FR-011). The archive from the release is the restore point,
  and using it is a decision a person makes.
- Roll back more than one service per run.
