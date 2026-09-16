# Contract: configuration and deploy

**Feature**: consta-api-merge · **Files**: `apps/api/src/env.ts`,
`apps/api/wrangler.jsonc`, `apps/api/vitest.config.ts`,
`.github/workflows/{ci,deploy-dev,deploy-prod}.yml`

Constitution VIII: every binding says what "unset" means. This is the
after-state; every row is either kept, added or removed relative to
`31c4c71`.

## Bindings on the API (`env.ts`)

| Binding | Kind | Change | Unset means |
| --- | --- | --- | --- |
| `APICEP_TOKEN` | secret | **added** (moved from Consta) | The SPEI channel is unavailable: `speiAvailable` is false, the link answers `unavailable`, the page says so. A payment already in flight retries as `PROVIDER_NOT_CONFIGURED` |
| `APICEP_BASE_URL` | var, optional | **added** (moved) | The real provider. The sandbox sets it to `http://localhost:8789`; tests pin it |
| `APICEP_DEADLINE_MS` | var, optional | **added** (moved) | 25 s (Consta D16). Tests only |
| `AI` | binding | **added** (moved) | The image route degrades to the provider's OCR (proof-extraction D5) |
| `EXTRACTION_MODEL` | var | **added** (moved) | `@cf/mistralai/mistral-small-3.1-24b-instruct` (reader.ts `DEFAULT_MODEL`) |
| `PROOFS` | R2 | kept | — (already required) |
| `API_BASE_URL`, `BETTER_AUTH_SECRET` | | kept | The engine signs the provider's proof link with them, as `signedProofUrl` already does |
| `CONSTA_BASE_URL` | var | **removed** | — |
| `CONSTA_API_KEY` | secret | **removed** | — |
| `CONSTA_ISSUER_TOKEN` | secret | **removed** | — |
| `CUSTOMER_REF_SECRET` | secret | **removed** (research R4) | — |

Consta's own `CONSTA_ADMIN_TOKEN` disappears with the Worker.

**Count**: validation depended on six secret slots and one URL; it depends
on one secret (SC-003). `APICEP_BASE_URL` is an optional override that
existed before and is not a dependency.

## `wrangler.jsonc` (API)

| Block | Change |
| --- | --- |
| top level | `+ "ai": { "binding": "AI" }`; `vars`: `+ EXTRACTION_MODEL`, `− CONSTA_BASE_URL` |
| `env.dev` | `+ ai`; `vars`: `+ EXTRACTION_MODEL`, `− CONSTA_BASE_URL` |
| `env.prod` | `+ ai`; `vars`: `+ EXTRACTION_MODEL`; the comment "No CONSTA_BASE_URL: Consta has no prod env yet" is replaced by "No APICEP_TOKEN planted here by this feature — switching production on is a separate decision (consta-api-merge, spec Q3); until it is, the channel is unavailable and says so" |

The wrangler `ai` binding is inherited by no env block (like `d1_databases`
and `r2_buckets`, an env's block replaces the top-level one), so it is
repeated in each — the same rule `EMAIL_FROM` already documents.

## Tests (`vitest.config.ts`, `test/setup.ts`)

| Pin | Value | Why |
| --- | --- | --- |
| `APICEP_BASE_URL` | `https://api.apicep.cloud` | The suite intercepts this origin; `.dev.vars` may point at the sandbox and must not win (constitution IV) |
| `APICEP_TOKEN` | `test-apicep-token` | The channel must be *available* in tests; the value never reaches a real host |
| `WISPHUB_BASE_URL`, `RESEND_API_KEY`, `AUTH_RATE_LIMIT` | unchanged | |

`test/setup.ts` throws when `APICEP_BASE_URL` is not the pinned origin, as
it does for WispHub. `AI` is not bound in tests; a test that needs the reader
passes `{ ...env, AI: aiReturning(reading) }` as the engine's `env`, exactly
as the Consta suite does today.

## CI (`ci.yml`)

Unchanged in shape. `pnpm -r` stops visiting `apps/consta` because the
directory is gone. `gen-banks --check` checks one constant.

## Deploy to dev (`deploy-dev.yml`)

| Step | Change |
| --- | --- |
| Sync worker secrets (API) | `− CONSTA_API_KEY`, `− CONSTA_ISSUER_TOKEN`, `− CUSTOMER_REF_SECRET`; `+ APICEP_TOKEN`, guarded: absent → `::warning::No APICEP_TOKEN in the dev environment — the SPEI channel stays unavailable.` |
| D1 consta dev migrations | **removed** |
| Deploy dev Consta | **removed** |
| Sync Consta worker secrets | **removed** |
| Verify the Consta provider credential | **kept, renamed** "Verify the provider credential"; moves after the API secret sync; body unchanged (the five 401 readings, the whitespace checks, the retry on the transient body) |
| Smoke test | unchanged |

## Deploy to prod (`deploy-prod.yml`)

| Step | Change |
| --- | --- |
| Sync worker secrets | `− CUSTOMER_REF_SECRET`, `− CONSTA_ISSUER_TOKEN`; `+ APICEP_TOKEN`, guarded: absent → `::warning::No APICEP_TOKEN in the production environment — the SPEI channel stays unavailable (consta-api-merge: switching production on is a separate decision).` |
| Verify the provider credential | **added**, same body as dev; skips with a warning when the secret is absent |
| The comment "the channel stays unavailable until Consta has a prod env" | replaced by the sentence above |

**What this feature does not do**: plant `APICEP_TOKEN` in the production
GitHub environment. That act, when the creator takes it, needs no code
change (SC-005).

## Retirement (`retire-consta.yml`, one-shot)

`workflow_dispatch`, environment `dev`, run from `apps/api` (the only
wrangler left in the tree — `apps/consta/` and its config are gone by the
time this runs, so every command names its target explicitly), in this
order, each step failing the job if it fails:

1. `wrangler d1 export devolada-consta-db-dev --remote --output consta-dev.sql`
   → uploaded as artifact `consta-dev-final-export`, retention 90 days.
2. `wrangler delete --name devolada-consta-dev` (the custom domain
   `consta.dev.devoladapago.com` is released with the Worker). CI is
   non-interactive; the task that writes this workflow verifies on its dry
   run that wrangler 4 proceeds without a prompt there, and adds the flag it
   needs if it does not.
3. `wrangler d1 delete devolada-consta-db-dev -y`.

Run once by the creator after the dev deploy that stops calling Consta has
finished. The workflow file is deleted in the feature's last task; git keeps
the record.

## GitHub environment secrets (manual, after the merge)

Remove from `dev`: `CONSTA_API_KEY`, `CONSTA_ISSUER_TOKEN`,
`CONSTA_ADMIN_TOKEN`, `CUSTOMER_REF_SECRET`. Remove from `prod`:
`CONSTA_ISSUER_TOKEN`, `CUSTOMER_REF_SECRET`. Keep `APICEP_TOKEN` in `dev`
(it is re-pointed, not re-created). Nothing in the workflows reads the
removed names after this feature, so the order does not matter.
