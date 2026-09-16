# Quickstart: consta-api-merge

**Feature**: 004 · **Date**: 2026-09-12 · **Phase**: 1

How to prove this feature works. Each section names what it answers and what
a pass looks like; none of it duplicates the contracts.

## Prerequisites

```sh
pnpm install                                  # pnpm 10 workspace, Node 22
pnpm --filter @devolada/api db:migrate:local  # the one migration this feature adds
pnpm --filter @devolada/api sandbox           # apiCEP stand-in on 8789 (moved from consta)
pnpm --filter @devolada/api dev               # the API — and the engine — on 8787
```

`apps/api/.dev.vars` for local validation: `APICEP_TOKEN=anything` and
`APICEP_BASE_URL=http://localhost:8789`. With the API up,
`curl -X POST localhost:8787/dev/seed` creates the demo ISP
(`demo@devolada.app` / `devolada123`).

There is no `pnpm --filter @devolada/consta dev` any more. If a shell still
tab-completes it, the branch is not checked out.

## The gates, in CI order

```sh
node scripts/spec-lint.mjs        # every moved and new test cites its story
node scripts/gen-banks.mjs --check  # one constant now, still in step
node scripts/contrast-lint.mjs
node scripts/pending-lint.mjs
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -r --if-present build
```

None may be skipped or quarantined to get green. `typecheck` carries weight
here: deleting `CONSTA_BASE_URL`, `CONSTA_API_KEY`, `CONSTA_ISSUER_TOKEN` and
`CUSTOMER_REF_SECRET` from `Bindings`, and `receiptUrl` from the request
type, makes every stale reader a compile error (SC-009).

## User Story 1 — the product validates its own payments

**Automated**

```sh
pnpm --filter @devolada/api test -- test/direct-payment.test.ts
pnpm --filter @devolada/api test -- test/topups-pause.test.ts
pnpm --filter @devolada/api test -- test/consta
```

Answers: every outcome the lifecycle produces today is produced with the
provider intercepted at `https://api.apicep.cloud` and no other origin
registered (SC-001) — with `fetchMock.disableNetConnect()` in force, a call
to any Consta URL would fail the test that made it (SC-004). The engine's own
suite proves the taxonomy, the gate, the shape rules, the trust block and the
retry moment in-process (SC-010).

**By hand**, against the sandbox:

1. Open the demo ISP's payment link, pay by transfer data with a tracking key
   containing `PEND` → the page waits ("verificando"); the row is `validating`
   with `constaStatus = pending`.
2. Same with `BAD` → `invalid`, `TRANSFER_CONTRADICTED`; with `NF` →
   `validating`, `TRANSFER_NOT_FOUND`; with `E500` → `validating`,
   `PROVIDER_UNAVAILABLE` (not `CONSTA_UNAVAILABLE`); with a clean key →
   `confirmed`.
3. Upload a PNG receipt → the reader reads it **locally** (this never worked
   locally before — research R6); a PDF → the sandbox's OCR door answers.
4. `sqlite3` the local D1 (or `wrangler d1 execute devolada-db --local`):
   every attempt above is one `validations` row with `business_id` = the demo
   ISP; the receipt attempts have an `extractions` row with `proof_sha256`
   set and no bytes anywhere.

**Cut-over** (scenario 6): seed a payment row with `validation_attempts = 1`
and `consta_status = 'pending'` and a Consta-era `consta_validation_id`, let
the sweep run, and confirm the next attempt reads `isRetry` true and the
replay carve-out applies. `direct-payment.test.ts` "scenario 9: the sweep
picks it up" already seeds exactly this row shape.

## User Story 2 — one product to deploy, one credential to keep

**Automated**: the PR's CI run. Read the job list: `quality` and `preview`
only, and `preview` uploads three Workers.

**On the dev deploy after merge**, read the log (SC-002, SC-003):

- exactly one `wrangler d1 migrations apply`, on `devolada-db-dev`;
- exactly three `wrangler deploy`;
- the secret sync plants `APICEP_TOKEN` on `devolada-api-dev` and mentions no
  `CONSTA_*` name;
- "Verify the provider credential" runs against `api.apicep.cloud` and prints
  `accepted the credential (HTTP 400 on an empty body)`.

**Production able, not on** (SC-005): on a preview version, set
`APICEP_TOKEN` and `APICEP_BASE_URL` pointing at an intercepted or sandbox
provider, open a link → `status: "debt"` with the CLABE; unset the token,
redeploy → `status: "unavailable"`. No code changed between the two.

**Retirement**: run `retire-consta.yml` from the Actions tab once; confirm
the artifact `consta-dev-final-export` exists, and that
`https://consta.dev.devoladapago.com/health` no longer answers. Then delete
the workflow file (the feature's last task).

## User Story 3 — the validation record lives beside the payment

**Automated**

```sh
pnpm --filter @devolada/api test -- -t "attributed"
pnpm --filter @devolada/api test -- test/consta/trust.test.ts
```

Answers: a business's validation and a top-up write rows with
`business_id` set and NULL respectively (SC-006); a query scoped to one
business returns none of another's (SC-007); the trust block on a `pending`
verdict is computed from seeded rows of that business, with the chain in
flight excluded; the release shadow stores what the engine computed, not
what a mock injected.

**The report** (SC-008):

```sh
node scripts/cep-latency-report.mjs --env local
```

Reads `devolada-db` only and joins `payments` to `validations` by tracking
key. Before this feature it queried `direct_payments` and `isps` — tables
renamed in 0018/0019 — and failed on its first statement.

## User Story 4 — the standalone identity is retired cleanly

```sh
git grep -n "CONSTA_BASE_URL\|CONSTA_API_KEY\|CONSTA_ISSUER_TOKEN\|CONSTA_ADMIN_TOKEN\|CUSTOMER_REF_SECRET\|consta.test\|consta.dev.devoladapago" -- ':!specs' ':!.specify'
```

Expected: no matches (SC-009). Then:

```sh
git grep -c "D[0-9]" apps/api/src/consta/            # citations present…
git show 31c4c71:apps/consta/src/routes/validate/index.ts | grep -c "D[0-9]"   # …as many as there were
```

The moved files carry every `D<n>` the originals carried (SC-011); the diff
of the engine's comments between `31c4c71:apps/consta/src/**` and
`apps/api/src/consta/**` is the list of citations this feature *added*
(`consta-api-merge D<n>`) and nothing removed.

```sh
node scripts/spec-lint.mjs
```

Every file under `apps/api/test/consta/` cites `US-V##` (moved) or
`consta-api-merge US<n>` (new). Finally, the constitution: its stack table
names three apps and one engine inside the API, and `/speckit-analyze` on
this feature reports no CRITICAL finding against Principle V (SC-014).

## Local development, after

| Before | After |
| --- | --- |
| Two `wrangler dev` processes (8787, 8788), two local D1s, two `.dev.vars` | One process, one D1, one `.dev.vars` |
| `pnpm --filter @devolada/consta sandbox` | `pnpm --filter @devolada/api sandbox` |
| Receipt uploads never validated locally (the engine refused `http://localhost`) | The reader reads the local bucket; PDFs reach the sandbox |
