# CI/CD

All infrastructure lives on Cloudflare (Workers + D1). **No deploy ever runs from a local machine**; everything goes through GitHub Actions with configuration injected at build time. AI agents can break a build, never production.

**Status: active** — first dev deploy verified 2026-08-13 (TD-006 paid).

## Branching model: trunk-based

A single `main` branch. No `develop` — for a solo engineer the intermediate branch doubles merges without adding isolation (decision D1 of this doc; revisited if the team grows).

- **PR → `main`**: quality gate + preview for the client.
- **Merge to `main`**: automatic deploy to **dev**.
- **`v*` tag** (or `workflow_dispatch`): deploy to **prod** with approval gate.

## Local work with worktrees (parallel features with AI)

Parallel development uses `git worktree`: one branch + one directory + one AI session per feature, each ending in its own PR (and its own preview URL for the client).

```sh
git worktree add ../devolada-wt-<feature> -b feat/<feature-slug>
# AI session works there; once its PR merges:
git worktree remove ../devolada-wt-<feature>
```

Rules for two worktrees to coexist:

1. **Own ports per worktree**: the defaults (5173 playground, 8787 api) collide; the second session uses different `--port` values (e.g. 5174/8788).
2. **Local D1 is per-worktree**: state lives in each worktree's `apps/api/.wrangler/` — free isolation, but each worktree runs `pnpm db:migrate:local` once.
3. **One spec per worktree**: each parallel feature carries its own `.spec.md`; if two features touch the same spec, they are not parallel — they serialize.
4. **`pnpm install` per worktree** (node_modules is not shared).

## Environments

| Environment | API | Admin | Pago | D1 |
|-------------|-----|-------|------|-----|
| dev | `devolada-api-dev` | `devolada-admin-dev` | `devolada-pago-dev` | `devolada-db-dev` |
| prod | `devolada-api` | `devolada-admin` | `devolada-pago` | `devolada-db-prod` |
| preview (per PR) | API version upload | **admin version upload — the URL the client opens** | version upload | points at `devolada-db-dev` |

Custom domains live under `devoladapago.com` (`api.` / `admin.` / `pago.` / `consta.`, and `.dev.` variants — pivot D19 is the map). The store PWA and its `punto.*` domains left with `devolada-red` (2026-08-31).

Frontends inject `VITE_API_URL` at build time. Secrets (BETTER_AUTH_SECRET, RESEND_API_KEY, CUSTOMER_REF_SECRET, `PLATFORM_OPERATOR_EMAILS` — the comma-separated operators of the platform, operator-panel D2 —, Cloudflare token) live in GitHub Environments, never in the repo — and reach the Worker through the sync step in D5. `AUTH_JWT_SECRET` is optional on dev and **required on prod**: the deploy fails without it rather than shipping an API that skips signature checks (TD-001).

Everything runs in the project's **own Cloudflare account, `devoladapago`** (`714b01a4209c57b8d51a7a91847357f9`), since 2026-09-01 (decision D7; the from-zero runbook is below). The `devoladapago.com` zone (Cloudflare Registrar) lives there; previews land on `*.devoladapago-14b.workers.dev`, the account's subdomain, which is why it appears in dev's `ALLOWED_ORIGINS`. The pipeline reaches the account through `CLOUDFLARE_ACCOUNT_ID` (repo variable) and `CLOUDFLARE_API_TOKEN` (environment secret in `dev` and `production`; token `devoladapago-deploy`: Workers Scripts, D1 and Workers AI on the account, Workers Routes and DNS on the zone). `DEV_API_URL`/`PROD_API_URL` are repo variables feeding the smoke tests.

## The three paths

### 1. `ci.yml` — Pull Request into `main`

Quality gate; deploys nothing to stable environments.

1. Lint + typecheck (per affected workspace: path filtering, don't rebuild all 3 apps when one changed).
2. Fast-layer tests (`TESTING.md`): API in workerd, components, network with MSW.
3. Build of what's affected.
4. **Spec-driven enforcement** (pays TD-004): every `*.spec.md` is in SPEC.md's index; tests cite `US-` IDs.
5. **Preview deploy**: a unique URL per PR (Workers versions / preview) pointing at `api-dev` — **the client reviews in the PR, before the merge**. This is the direct-feedback mechanism, not a courtesy. The job applies pending D1 migrations to `devolada-db-dev` first (added 2026-08-14): a preview binds the dev database, so a PR that adds a migration would otherwise preview against a schema it does not have.

### 2. `deploy-dev.yml` — push to `main`

1. Tests (same as CI; the merge may have combined PRs).
2. Migrations to `devolada-db-dev` (`wrangler d1 migrations apply`).
3. Deploy of API + store PWA + admin to dev domains.
4. **Smoke test**: `curl /health` and loading both apps; if it fails, the job fails — "deployed" without smoke is not "working".
5. Playwright + axe E2E against dev (the slow layer runs here, not on every PR).

### 3. `deploy-prod.yml` — `v*` tag

1. **Native approval gate**: GitHub Environment `production` with required reviewer (`leolicona`). The deploy job pauses until human approval. Active since 2026-08-13 (the repo was made public to enable it on the free plan).
2. **Backup**: `wrangler d1 export` of `devolada-db-prod` as a run artifact, before migrating.
3. Migrations to `devolada-db-prod`.
4. Deploy of API + apps to prod domains.
5. Post-deploy smoke test.

## Migration rules

- Only drizzle-kit-generated files, append-only (never edit an applied migration).
- **Expand-contract mandatory in prod**: migration and deploy are not atomic, so nothing destructive (drop/rename) ships in the same release as the code that still depended on the old shape — expand in one release, contract in the next.
- Every migration runs in dev first through the normal flow; prod never premieres a migration.

## Rollback

- **Code**: `wrangler rollback` (Workers keeps versions) or re-deploy of the previous tag.
- **Data**: restore from the step-2 export; assume loss of whatever was written between export and failure (hence the immediate smoke).
- A prod rollback always creates an entry in `BUGS.md`.

## Standing up an account from zero

The path the account move of 2026-09-01 walked (D7), which is also the path prod takes at the pilot's go-live. Steps 1–4 are the only manual ones; from step 5 on, the pipeline does the work — that is the point of D5.

1. **Account**: Cloudflare account, `workers.dev` subdomain (assigned automatically), R2 subscription (needs a payment method even on Free), API token with the scopes listed under *Environments*.
2. **Zone**: add `devoladapago.com` as a site (Free plan). If the domain comes from another Cloudflare account: export its DNS as BIND there, import it here (Resend's MX/DKIM/SPF live in it), check DNSSEC is off, then *Domain Registration → Move to another account* from the old account and accept in the new one's Action Center (≤5 days; 30-day lock afterwards). Nameservers propagate on their own.
3. **Data stores**, empty: `wrangler d1 create devolada-db-dev`, `devolada-db-prod`, `devolada-consta-db-dev` → the three `database_id` in `apps/api/wrangler.jsonc` and `apps/consta/wrangler.jsonc`; `wrangler r2 bucket create devolada-transfer-proofs` and `-dev`, each followed by `wrangler r2 bucket lifecycle add <bucket> --name expire-15d --expire-days 15` (the rule needs a name) (direct-payment D12). Workers AI needs nothing: the binding has no id.
4. **GitHub**: `CLOUDFLARE_ACCOUNT_ID` (repo variable) and `CLOUDFLARE_API_TOKEN` (secret in `dev` and `production`). The Worker secrets already live in those environments and are re-planted on every deploy (D5).
5. **Dev**: the PR carrying the new ids has no previews — a version upload needs a deployed Worker, and none exists yet; `scripts/preview-upload.sh` warns and passes on exactly that failure, and fails on any other. Merge it → `deploy-dev` applies every migration, deploys the four Workers, plants and verifies the secrets, runs the smoke. Then `curl -X POST https://api.dev.devoladapago.com/dev/seed` for the demo ISP.
6. **Prod**: `v*` tag → approval gate → `deploy-prod`. The D1 export it takes first is empty the first time, which is correct.
7. **Old account**: delete the Devolada Workers, databases and buckets there only after step 5 is green.

## Decisions

- **D1 — Trunk-based over git-flow.** Discarded alternative: `develop` + `main` (double merging with no benefit for a single engineer; the extra latency fights the client-feedback loop).
- **D2 — Per-PR preview as the client feedback channel.** Discarded alternative: client reviews dev only (one step too late, on already-merged work).
- **D3 — E2E on deploy-dev, not on every PR.** Discarded alternative: E2E in PR (minutes of waiting per iteration; the fast layers already cover the gate).
- **D5 — Worker secrets are set by the pipeline, right after the deploy.** `wrangler secret put` refuses while the newest version of a Worker is undeployed, and D2's per-PR `wrangler versions upload` leaves exactly that behind — so setting a secret from a laptop fails with *"the latest version of your Worker isn't currently deployed"* almost any time a PR is open. Found the hard way on 2026-08-15 (TD-011). Both deploy workflows now set them from a GitHub environment secret in the step after `wrangler deploy`, where latest and deployed agree. Discarded alternative: setting them in the Cloudflare dashboard (works, but leaves no record of where a secret came from, and a fresh environment has to be rebuilt by hand). The "skip when unset" guard is shell, not `if:` — the `secrets` context is not allowed in a step condition, and putting it there makes GitHub reject the entire workflow file: a run with **zero jobs** and no logs, which never appears in `gh pr checks` because a deploy workflow is not a PR check. Query `actions/runs?head_sha=…` to see those.
- **D6 — A secret the pipeline plants is verified against its provider, not just counted.** D5 makes every deploy overwrite the worker secret with whatever the GitHub environment holds, which is what makes a bad value *recurring*: the channel breaks again on the next merge, with nobody touching it. The guard D5 describes only asks whether the value is empty, so a wrong-but-present token deploys under a green tick — the same shape as TD-011's lesson, one level down (there a skipped step was green; here a step succeeds with a value nothing checked). Measured on 2026-08-18: dev carried a token apiCEP answered **401** to, and the failure then hid for six hours, because Consta maps a provider 401 to `PROVIDER_ERROR` and the api maps that to retryable — direct payments sat in `validating` showing the customer *"Verificando tu pago"* until they expired. So `deploy-dev` now probes apiCEP with the credential it just planted. The probe costs nothing: an empty body is rejected before Banxico is touched, and the two answers that matter separate cleanly — **401 is our credential, 400 is the provider confirming the credential was fine and only the body was wrong**. Anything else is the provider having a bad day and only warns; a deploy must not hinge on someone else's uptime. Shape is checked before the network, because a newline inside the value does **not** come back as 401 — it measured **500**, and in the Worker the same value builds an invalid `Authorization` header, so `fetch` throws and Consta answers 500: retryable all the way down, the same six-hour silence by another road. A trailing space is not fatal (apiCEP trims it; measured). Discarded alternative: probing through the deployed Consta `/validate` instead — it is the truer end-to-end check, but it needs an issued `ck_` key and spends a paid provider call on every deploy, and it would not have caught anything this probe misses. Accepted limit: this verifies the value the pipeline *has*, not the bytes that landed in the Worker.
- **D4 — Previews share `devolada-db-dev`.** D1 has no data branching; a DB per PR is over-engineering at this scale. Accepted risk: a PR can dirty dev data — and, since 2026-08-14, its migrations land in dev before the merge. Both are additive by our own rule (a migration adds; it never drops a column another PR still reads), so dev keeps working for every open branch.
- **D7 — Devolada runs in its own Cloudflare account, rebuilt from zero rather than migrated.** On 2026-09-01 the shared `liconadev` account hit the Free plan's D1 ceiling — 5M rows read per day, **per account** — and every Devolada Worker answered errors for the rest of the day. Devolada had nothing to do with it: `wrangler d1 info` over 24 h showed `devolada-db-dev` at 90k rows read and prod at 0, while two databases of an unrelated project had read 19M between them (~10k rows per query — full scans). A payments product cannot share a quota with hobby projects, so Devolada moved to `devoladapago`, with nothing copied: databases, buckets and secrets are created empty and the pipeline fills them, which is the exact path prod takes at the pilot's go-live — the move is its rehearsal, and it left the runbook above. Free plan until the pilot (Devolada's reads are ~2 % of the ceiling); Workers Paid (USD 5/month, 25 billion rows read/month included) when real money flows. Discarded alternatives: upgrading `liconadev` to Workers Paid (removes the ceiling, keeps the shared blast radius, and mixes the bill); exporting/importing the dev database (its data was demo residue, and carrying it over would have hidden whichever step of the from-zero path was still manual); deploying without moving the zone (Custom Domains require the zone in the Worker's account, and on `*.workers.dev` — a public suffix — admin and api are different sites, the cross-site cookie case sessions D7 already measured as broken). Measured cost of the move: the Registrar domain moves between accounts on its own (inter-account transfer), but its DNS records do not — BIND export/import first.
