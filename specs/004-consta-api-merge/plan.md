# Implementation Plan: consta-api-merge

**Branch**: `claude/speckit-specify-consta-integration-1b39b5` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-consta-api-merge/spec.md`

## Summary

Fold Consta — the SPEI validation engine that runs as its own Worker with
its own database, key table and secret set — into the product's API as a
module. Validation becomes an in-process call attributed to the business (or
the platform, for top-ups); every verdict, reason, reading, trust block and
retry suggestion is produced by the same rules as today; the deploy ships
three Workers and one database; the provider credential is the one secret
validation needs. Production becomes *able* to validate; switching it on
stays a separate decision.

Phase 0 found the work is a **move with a seam already in place**.
`apps/api/src/consta/client.ts` defines every type the payment lifecycle
reads, and the engine's route handler returns exactly those shapes. So the
engine's ~1,900 lines move under `apps/api/src/consta/` with their
comments and decision citations intact, the HTTP client becomes the function
that calls them, and the three callers — the payment lifecycle, the top-up
lifecycle, the reader route — each change one constructor line. What is
deleted is the standalone identity: the key table, the issuer and admin
doors, the backfill sweep, the URL fetcher and its address guard, the HMAC
that disguised a payer whose identity no longer crosses a network, five
secrets and a base URL.

Three things surfaced while reading and are folded in because the move is
the moment to fix them:

- **The engine breaks the money law in four places.** `Math.round(x * 100)`
  converts the provider's and the reader's decimals; constitution II forbids
  `value * 100` and the API already has `amountToCents`. The moved code uses
  it (D18).
- **The receipt door has never worked locally.** The engine refused
  `http://localhost` signed URLs before deciding which door a file takes.
  Reading from the bucket removes the fetch and the gap (D7).
- **The latency report is dead.** It queries `direct_payments` and `isps`,
  renamed by migrations 0018 and 0019. Reading one database, it is repaired
  (D14).

The biggest single cost is the tests, not the code: 91 call sites in four
API test files mock Consta's verdict envelope and must mock apiCEP's wire
instead, and the engine's 71 tests move in-process (D12). Constitution IV
allows no shortcut there — product code is not mocked.

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`;
Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4.7, Drizzle ORM 0.40 over D1, zod 3.24,
wrangler 4, `@cloudflare/vitest-pool-workers` 0.8; Workers AI
(`@cf/mistralai/mistral-small-3.1-24b-instruct`, a var); apiCEP at
`https://api.apicep.cloud`, the only provider the engine talks to

**Storage**: one D1 (`devolada-db`; two tables added, one column retired in
place); R2 `PROOFS` (already there — the reader now reads it directly). The
Consta D1 is exported and deleted

**Testing**: Vitest 3.2 in workerd with a real local D1 (migrations per
test, isolated storage); providers intercepted with `fetchMock` at their real
origins, pinned in `vitest.config.ts` (`https://api.apicep.cloud` joins
`https://api.wisphub.net/api`); the reader stubbed per call through
`env.AI`; proofs seeded into the miniflare R2 bucket

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01,
`nodejs_compat`; environments `dev` and `prod` under `devoladapago.com`;
per-PR preview versions against the dev database

**Project Type**: pnpm monorepo. This feature is backend-only: one Worker
absorbs another. No frontend file changes; no product copy changes

**Performance Goals**: a validation is exactly one provider call (≤ 25 s,
Consta D16) plus at most one reader call (~2.7 s measured 2026-08-19), and
zero calls between parts of the product. The inline attempt on `POST /pay`
is bounded at 25 s where it was 30 s. The every-minute sweep's per-payment
bound is unchanged (it awaited the same provider call through a hop before)

**Constraints**: migrations additive — the PR preview applies them to the
dev database while the deployed dev Worker keeps serving (D11); never deploy
from a laptop — retirement runs in CI (D13); secrets planted after deploy
(TD-011) and verified by reading the provider's body, not its status
(constitution VIII); every verdict, wording and schedule unchanged
(FR-002); the engine's decision citations survive verbatim (FR-016)

**Scale/Scope**: ~1,900 engine lines move, ~300 retire (`index.ts`,
`env.ts`, `auth/api-key.ts`, `routes/admin/keys.ts`, `routes/banks.ts`,
`extraction/fetch.ts`'s URL half, `db/schema.ts`); 2 tables, 1 migration;
3 callers; 71 engine tests — 62 move, 1 rewritten, 8 retire by name — plus 4
API test files with 91 mock sites and 18 captured-body assertions, and 1
file (`consta-keys.test.ts`, 7 tests) retired; 3 workflows edited, 1 one-shot
workflow added then removed; 2 scripts; `CLAUDE.md`; the constitution

## Decisions

Code comments cite these as `consta-api-merge D<n>` (constitution I).

| # | Decision | Made in |
| --- | --- | --- |
| D1 | One service, one database. The engine is a module of `apps/api`; no service binding, no second D1 binding, no external door | spec Clarifications Q1, Assumptions |
| D2 | The engine keeps its facade — `validate` / `extract` over `(env, db, owner)` — so the three callers change one line each | research R1 |
| D3 | Attribution is a nullable `business_id` on `validations` and `extractions`; NULL is the platform's own top-up | research R2 |
| D4 | Shape rules and retry cells read across businesses; they return rules, never rows. The trust block is per business | research R3 |
| D5 | The payer's identity in the log is the link's own customer, undisguised — the usuario for a panel link, the caller's reference for an API link (`003`); the HMAC and its secret retire | spec FR-006, research R4 |
| D6 | The row carries the engine's own failure codes. Every failure still rides the schedule; `retryable` is carried, not yet acted on | research R5 |
| D7 | The reader takes the file from the bucket; the provider gets a signed link only when it must read; the URL fetcher and its guard retire | spec FR-008, research R6 |
| D8 | The request guard (D12/D13/D17 of the validation spec) stays, in-process, before any credit | research R7 |
| D9 | Configuration: one secret, one binding, three vars. Production gets the binding and the vars, not the secret | spec Clarifications Q3, research R8 |
| D10 | One deadline — the engine's 25 s; the client's 30 s goes with the client | research R9 |
| D11 | `businesses.consta_api_key` is retired in place and never dropped by this feature; debt logged | research R10 |
| D12 | Tests move in two shapes; eight retire with the door, by name; the provider origin is pinned | research R11 |
| D13 | One additive migration, no data carried; retirement is a one-shot `workflow_dispatch` that exports, then deletes | spec Clarifications Q2, research R12 |
| D14 | One bank constant; the latency report reads one database and is repaired on the way | research R13 |
| D15 | The constitution is amended (MINOR) to describe one API that validates; the plan proposes the text | spec FR-024, research R14 |
| D16 | `003-automated-collections-api` is a sibling; FR-002 is the only promise it needs from here | research R15 |
| D17 | The engine keeps its name — the module is `consta/`, the failure class stays `ConstaError` — so every existing citation resolves | spec Assumptions |
| D18 | The engine's four inbound decimal conversions use `amountToCents`; the one outbound `cents / 100` stays because the provider demands a number | Constitution Check II, research R16 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Planned against v1.1.0; **amended to v1.3.0 on 2026-09-16** by T002 with the
text research R14 proposes, stacked on PR #197's v1.2.0 (the Purpose
widening and the `retryable` grant, both kept). One gate per principle; the
verdicts below are re-read against v1.3.0.

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Eighteen decisions, each with the place it was made. The moved code keeps every `D<n>` it carries (FR-016; quickstart counts them); each new rule — the owner column, the cross-tenant reads, the retired column, the undisguised ref — cites `consta-api-merge D<n>` | PASS |
| II | Money Law | Cents end to end, unchanged. **Found and fixed by the move**: four `Math.round(x * 100)` sites in the engine (`provider/apicep.ts` ×2, `extraction/gate.ts`, `routes/extract/index.ts`) convert provider and reader decimals by float multiplication, which the law forbids by name. They become `amountToCents` (D18). The outbound `input.amountCents / 100` stays: apiCEP takes a JSON number, and an integer divided by 100 serialises to the two decimals it means | PASS (after D18) |
| III | One Contract, Pure Routers | No API schema changes; `direct-payments/schema.ts` is not edited and its export list is unchanged. The engine's two route files dissolve into handler functions — the routers they were mounted on cease to exist. No route emits `retryable`; v1.2.0's grant now names `/v1/*` alone (v1.3.0), so the engine is neither granted nor in violation. The bank vocabulary keeps one source and its CI check (D14) | PASS |
| IV | Tests Run on the Real Runtime | The engine's tests run in workerd against the API's real D1, provider at its real origin, pinned so `.dev.vars` cannot redirect a suite; the reader stubbed at the binding as today; proofs in the miniflare bucket. The API's tests intercept apiCEP where they intercepted Consta — an origin that was a provider only because the engine was one. Nothing in the product is module-mocked (D12) | PASS |
| V | Tenant Isolation and Authorization by Area | Both new tables carry `business_id` and every per-business read filters on it. **One named exception**: two statistical reads — bank clave shape (proof-extraction D14) and Banxico latency per bank pair (learned-retry D2) — read across businesses, as they do inside the engine today; they return rules, never rows, and read no column that names a business or a payer (D4). Recorded in *Complexity Tracking*; **since v1.3.0 the principle names these two reads itself**, so the exception is now the law's own text. The Consta-key bullet is generalised, not deleted — 003's credentials rely on it | PASS |
| VI | Visual Foundations (NON-NEGOTIABLE) | No token, component, copy or screen is touched | PASS (N/A) |
| VII | Every Test Cites Its Story | Moved tests keep their `US-V##` citations (archive-era, accepted by `spec-lint`); rewritten and new tests cite `consta-api-merge US1`…`US4`; retired tests are listed by name in research R11 so nothing vanishes unnamed | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | `env.ts` says what unset means for every added binding (contracts/configuration.md): no `APICEP_TOKEN` → the channel is unavailable and the page says so; no `AI` → the provider's OCR; no `APICEP_BASE_URL` → the real provider. The deploy plants the credential after the deploy and verifies it by reading the body. Production without the secret degrades exactly as it does today without the URL | PASS |

**Stack table**: v1.1.0's fixed stack named `apps/consta` in its API row and
promised it "no prod env until its first external consumer" in its
Environments row. This feature departs from both on purpose — that departure
*is* the feature — and the departure was justified in *Complexity Tracking*
and is resolved by v1.3.0 (D15), whose table now names the engine inside
`apps/api`. The plan did not route around the table; it changed it.

**Post-design re-check (after Phase 1)**: PASS, unchanged. The data model
adds two tables with an owner column and retires one column in place; the
engine contract is the existing client's shape over a proof key instead of a
URL; the configuration contract replaces six secret slots and a URL with one
secret and a binding. No new exception surfaced. The two rows in *Complexity
Tracking* are the two that were expected before research began.

## Project Structure

### Documentation (this feature)

```text
specs/004-consta-api-merge/
├── plan.md              # This file
├── research.md          # Phase 0 output — R1–R16
├── data-model.md        # Phase 1 output — validations, extractions, the owner
├── quickstart.md        # Phase 1 output — how each story is proven
├── contracts/           # Phase 1 output
│   ├── engine.md        #   the in-process facade; the HTTP surface after
│   └── configuration.md #   bindings, wrangler, tests, the three workflows, retirement
├── checklists/
│   └── requirements.md
├── baselines/
│   └── citations.md     # T001 records every D<n> the engine carries; T047 checks it
├── spec.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
apps/api/src/consta/                 # the engine's home (D1, D17)
├── index.ts                         # ~ was client.ts: consta(env, db, owner) → { validate, extract };
│                                    #   every exported type kept; ConstaError keeps its name (D2)
├── validate.ts                      # + was consta/routes/validate/index.ts, as a function returning
│                                    #   ConstaVerdict; writes validations under `owner` (D3)
├── extract.ts                       # + was consta/routes/extract/index.ts: recordExtraction,
│                                    #   readingPayload, shapeSignals, extractionFailure + extract()
├── request.ts                       # + was consta/routes/validate/schema.ts, the guard (D8);
│                                    #   `receiptUrl` → `receipt.proofKey`
├── provider/
│   ├── apicep.ts                    # + moved; two `* 100` → amountToCents (D18)
│   └── types.ts                     # + moved verbatim
├── extraction/
│   ├── index.ts                     # + moved; extractProof takes a loaded proof, not a URL (D7)
│   ├── proof.ts                     # + was fetch.ts: loadProof(bytes) — sniff + ceiling; the
│   │                                #   URL fetch, isBlockedHost and redirect handling retire
│   ├── reader.ts                    # + moved; BANKS from ../../direct-payments/banks (D14)
│   ├── gate.ts                      # + moved; `* 100` → amountToCents (D18)
│   └── shape.ts                     # + moved; reads validations from ../../db/schema (D4 cited)
├── trust/history.ts                 # + moved; filters by business_id (D3)
└── retry/suggest.ts                 # + moved; whole-table window kept (D4 cited)
                                     # − client.ts (becomes index.ts), − issuer.ts, − refs.ts (D5)

apps/api/src/
├── env.ts                           # ~ + APICEP_TOKEN/BASE_URL/DEADLINE_MS, AI, EXTRACTION_MODEL;
│                                    #   − CONSTA_*, CUSTOMER_REF_SECRET (D9)
├── index.ts                         # ~ − backfillConstaKeys from the scheduled handler (FR-014)
├── db/schema.ts                     # ~ + validations, extractions (data-model); consta_api_key
│                                    #   retired in place with its comment (D11)
├── direct-payments/validation.ts    # ~ consta(env, db, { businessId }); refs unconditional (D5);
│                                    #   receipt: { proofKey }; APICEP_TOKEN gate; − constaKey
├── direct-payments/proofs.ts        # unchanged — signedProofUrl now called by the engine
├── credit/topups.ts                 # ~ consta(env, db, { platform: true })
├── routes/direct-payments/handler.ts# ~ readProof: extract({ proofKey }); 503 code READER_UNAVAILABLE
├── routes/businesses/handler.ts     # ~ − key issuance on birth
└── direct-payments/banks.ts         # generated — now the only constant (D14)

apps/api/
├── wrangler.jsonc                   # ~ + ai binding and EXTRACTION_MODEL per env; − CONSTA_BASE_URL
├── vitest.config.ts                 # ~ pins APICEP_BASE_URL and APICEP_TOKEN (D12)
├── package.json                     # ~ + "sandbox" script (moved mock)
├── sandbox/apicep-mock.mjs          # + moved from apps/consta/sandbox
└── migrations/0028_*.sql            # + validations, extractions, three indexes (D13)

apps/api/test/
├── setup.ts                         # ~ asserts the APICEP_BASE_URL pin
├── consta/                          # + the engine's suite, in-process (D12)
│   ├── helpers.ts                   #   seedValidations, aiReturning, PNG/JPEG/PDF, putProof
│   ├── validate.test.ts             #   45 moved (US-V01…V17) + 1 rewritten (scenario 9)
│   ├── learned-retry.test.ts        #   8 moved (US-V16)
│   ├── trust.test.ts                #   9 moved (US-V15: the refs and the block), split out
│   ├── attribution.test.ts          #   new: business_id / NULL, isolation (consta-api-merge US3)
│   └── availability.test.ts         #   new: unavailable without the credential, able with it (US2)
├── direct-payment.test.ts           # ~ mockConsta → mockApiCep (75 sites); trust/retry seeded;
│                                    #   "older Consta" test retired; refs tests → attribution
├── topups-pause.test.ts             # ~ 7 sites
├── integration-dispatch.test.ts     # ~ 6 sites
├── payment-classes.test.ts          # ~ 3 sites
├── payment-requests.test.ts         # ~ env only
└── consta-keys.test.ts              # − retired whole (7 tests; subject removed)

apps/consta/                         # − deleted entirely, after its tests have moved

scripts/
├── gen-banks.mjs                    # ~ one target (D14)
├── banks.data.md                    # ~ names one constant
└── cep-latency-report.mjs           # ~ one database; payments/businesses, not direct_payments/isps

.github/workflows/
├── deploy-dev.yml                   # ~ − 4 Consta steps; + APICEP_TOKEN sync; probe renamed
├── deploy-prod.yml                  # ~ + guarded APICEP_TOKEN sync; + probe (skips when absent)
├── ci.yml                           # unchanged in text; visits one fewer workspace
└── retire-consta.yml                # + one-shot workflow_dispatch; − removed after it has run

.specify/
├── memory/constitution.md           # ~ the amendment (D15), via /speckit-constitution
└── debt/retired-consta-key-column/  # + logged via /speckit-debt-log (D11)

CLAUDE.md                            # ~ commands and architecture: no consta dev, one sandbox
```

**Structure Decision**: the engine lives at `apps/api/src/consta/`, under
the name it already has in every citation, as a sibling of `wisphub/` — the
API's other provider adapter — rather than as a workspace package. A package
would suggest a second consumer, and the spec's first clarification says
there is none. Inside the module the engine's own directory shape survives
(`provider/`, `extraction/`, `trust/`, `retry/`) so a citation of
`docs/legacy/consta/…` still lands a reader in a file with the same name.
The only files that change name are the two route files, which stop being
routes.

## Complexity Tracking

Two departures from constitution v1.1.0, both intended, both resolved by the
amendment D15 proposed and T002 landed as v1.3.0 on 2026-09-16. Kept here so
the reasoning survives the resolution.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| The fixed stack table names `apps/consta` as a Worker with its own D1, and promises it no prod env until an external consumer arrives. This feature removes the Worker and the database | The feature's subject: one service, one database, one credential, and a production that can validate. No external consumer came, and the product's door for other companies is `003`'s `/v1/*`, which exposes payments, not the engine | Keeping the Worker behind a service binding (spec Q1, option C): removes the public hop and the keys but keeps two deploys, two databases, two secret sets and two migration histories — most of the cost for a fraction of the gain. Rejected by the clarification |
| Principle V: "every business query filters by the actor's business". Two reads over `validations` — shape rules and retry cells — read all businesses (D4) | Both are statistics about banks: a clave pattern Banxico proved, a publication latency per bank pair. They return rules, never rows; the columns read name no business and no payer; and each gets measurably worse partitioned (a bank's first customer at a new business would meet silence the product need not give). The engine has run them tenant-wide since they were written | Partition by business: worse rules and suggestions for no tenant benefit. A separate engine-wide aggregate table: a second copy of the log, which the engine's own law forbids ("no aggregate tables, ever") |
