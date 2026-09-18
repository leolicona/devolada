# Quickstart: production-launch — the runbook

**Feature**: 006 · **Date**: 2026-09-17 · **Phase**: 1

How a release is made, verified and undone. This replaces the archive's
`CICD.md` for everything production needs. Each section says what it
answers and what a pass looks like; the contracts hold the reference tables
and are not repeated here.

The one rule above all of it: **nothing touches production from a laptop.**
Every act is a CI run with a log — the release, the rollback, the retirement
of old things. What a person does by hand is configuration *around* the
pipeline, and this document lists all of it.

## 0. Before the first tag — pre-flight (once)

Tick every box before pushing `v1.0.0`. Who does what is in
[contracts/environment.md](./contracts/environment.md).

**Repository**

- [x] `production` environment's deployment policy is `tag v*` + `branch main`
      (D3; done 2026-09-18). There is no reviewer: **the tag is the approval**
      — pushing it is the deliberate act. Check:
      `gh api repos/leolicona/devolada/environments/production/deployment-branch-policies --jq '.branch_policies[] | "\(.type) \(.name)"'`
- [ ] Secrets in `production`: `BETTER_AUTH_SECRET`, `CLOUDFLARE_API_TOKEN`,
      `RESEND_API_KEY`, `APICEP_TOKEN`, `PLATFORM_OPERATOR_EMAILS`. Check:
      `gh secret list --env production`
- [ ] No `CONSTA_*` secret remains in `production` or `dev` (FR-020).
- [ ] Repository variables `PROD_API_URL`, `PROD_ADMIN_URL`, `PROD_PAGO_URL`.
      Check: `gh variable list`

**Cloudflare**

- [ ] R2 `devolada-transfer-proofs` has lifecycle rule `expire-15d`
      (15 days), set in the dashboard (D10).
- [ ] The deploy token's scopes still cover Workers Scripts, D1, Workers AI
      and the zone. (A green dev deploy today is the evidence.)

**Providers**

- [ ] apiCEP: a **second** `apicep_…` token exists for production and is
      the one in `APICEP_TOKEN` (D4). Dev keeps its own. The pool is 800
      calls/month; every release spends one on the probe (D11).
- [ ] Resend: `devoladapago.com` shows *verified* in the Resend dashboard
      (it was on 2026-08-15; the zone moved accounts on 2026-09-01).

**The commit**

- [ ] The commit to tag is the head of `main`, and its *Deploy Dev* run is
      green: `gh run list --workflow "Deploy Dev" --limit 1`
      (the gate checks this too — D1 — but a red tag is a wasted minute).

## 1. Make a release

```sh
git fetch origin main
git tag v1.0.0 origin/main
git push origin v1.0.0
```

**The push is the approval.** There is no second click; what stands between
the push and production is the gate. Then, in GitHub → Actions → *Deploy
Prod*:

1. `gate` passes (green dev run found for the commit, and it is on `main`).
2. `test` passes; `deploy` runs straight on.
3. Watch it: `gh run watch` (or the run page).

**What a pass looks like** (read the log top to bottom):

- `D1 prod backup` produced `d1-backup-v1.0.0` (empty on the first release
  — correct).
- `D1 prod migrations`: the whole history applied (29+ files on the first
  release; only new ones after).
- `Sync worker secrets`: one line per secret planted; **no** `::warning::`.
  If you see one, read it — it names what will not work.
- `Verify the provider credential`: `apiCEP accepted the credential`.
- `Smoke`: the API, the panel and the payment page each answered.
- The job summary shows a table — service, version id — and the archive
  name. Keep the version ids: they are what a rollback takes.

**Known first-run shape**: the three hostnames are created by this run;
each waits on its certificate (up to 5 minutes, per host). The API signs
sessions with the public dev value for the few seconds between its first
deploy and the secret step — nobody can hold a session in that window and
it never recurs.

**Re-planting a credential later** (a secret added after launch): Actions →
*Deploy Prod* → *Run workflow* on `main` (the click is the deliberate act).
The same gate, archive and probe run; the code is redeployed unchanged; the new secret is planted.

## 2. Verify — the product doing its job, not a health answer

**The addresses**

```sh
curl -s https://api.devoladapago.com/health     # {"success":true,"status":"healthy"}
curl -sI https://app.devoladapago.com/ | head -1  # HTTP/2 200
curl -sI https://link.devoladapago.com/ | head -1 # HTTP/2 200
```

**Your own business first** (D9) — at `https://app.devoladapago.com`:

1. Sign up with `leolicona.dev@gmail.com`. **The code arrives in your
   inbox** — that is Resend proven. (If it does not, the release log's
   secrets step is where to look.)
2. Create the business ("Devolada"). `/operador` appears in the navigation —
   that is the operator secret proven.
3. In `/operador`, set: `topup_clabe`, `topup_bank`, `topup_beneficiary`
   (the platform's account for ISP top-ups) and `support_whatsapp`,
   `support_email`. Until these exist, a business that runs through its
   welcome allowance (20 validations, then ~10 more on the negative cap)
   pauses with no way to pay — so this happens on day one, before any ISP.

**The first ISP** — the launch is verified when this ends with a verdict:

1. The ISP signs up; the code arrives; the business is born.
2. `/settings/direct-payment`: CLABE + bank from the catalog (owner only).
   The shell's banner about SPEI disappears.
3. `/integrations/wisphub`: paste the key generated in WispHub (Mi Empresa →
   Staff → Generate API Key). The integration is born **observing** —
   verdicts land, nothing is written to WispHub yet.
4. Links: open the roster; a link exists per customer. Share one.
5. The customer transfers a small real amount to the ISP's CLABE and enters
   the transfer data on the page. The payment validates against Banxico
   with the production token. The ISP sees the verdict in the panel.
6. Optional, when the ISP is ready: switch actions on in
   `/integrations/wisphub` so a confirmed payment reconnects the customer.

**Evidence to keep**: the `validations` row for that payment carries the
provider's status and the remaining quota; the dev environment's quota is
unchanged by it (SC-006 — the pools are separate).

**The sweep**: Cloudflare dashboard → Workers → `devolada-api` → Triggers
shows the cron; the log shows the sweep speaking only when it did something.

## 3. Undo — from CI, code only

Actions → *Rollback Prod* → *Run workflow*:

- `worker`: `api`, `admin` or `pago` — one per run
- `version_id`: from the release's job summary (or a previous run's)

The click is the act; nothing else pauses it. **A pass**: the job prints the version now live
and it equals the one you asked for. If wrangler declined (it can, across a
changed secret), the job fails and says so — nothing moved.

**Rehearsal after the first release**: run it once with the version that is
already live. It completes, changes nothing, and proves the path exists
before you need it.

**Data is never rolled back by this.** The archive `d1-backup-<tag>` from
the release is the restore point. Restoring it is a decision a person makes
with their eyes open: anything written between the export and the failure
is lost by it. Nothing in the pipeline does it for you.

## 4. The gates, in CI order (for a PR to this feature)

```sh
node scripts/spec-lint.mjs
node scripts/gen-banks.mjs --check
node scripts/contrast-lint.mjs
node scripts/pending-lint.mjs
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -r --if-present build
```

This feature adds no test file: it changes no application code, and its
subject (a workflow) has no layer in constitution IV that can run it short
of running it. Its proof is the first release's log, read against §1, and
the rehearsal in §3 — recorded in `tasks.md` as the verification tasks.

## 5. After the launch

- Pay `.specify/debt/retired-consta-key-column` — its trigger is the first
  migration after the production deploy that carries `0028`. That is now.
- Spec 004 T050: run `retire-consta.yml` (dev, dry run then real) from the
  Actions tab, then remove the file.
- Next specs: admission policy (D8); observability — today nothing pages
  anyone, and a red release or a payer's complaint is the alarm.
