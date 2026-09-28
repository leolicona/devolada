# Implementation Plan: cep-bundle-match

**Branch**: `claude/spec-013-cep-bundle-match` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-cep-bundle-match/spec.md`

## Summary

When a search without a clave finds several transfers, the provider hands
over a ZIP of CEPs and Devolada reads it as "not found": about eight paid
calls, twelve hours, then `expired`. When it finds one, nothing checks it
can be the receipt's transfer — the critical bug
`reference-finds-other-transfer`. This plan makes both one path.

The **engine** recognises the several answer (`invalid` +
`banxicoConfirmed` + a bundle link), downloads the file from the
provider's storage only, reads each CEP with a reader built for Banxico's
layout, and keeps every transfer a clave-less search returns — bundle or
single `valid` — as a record under the business. The **lifecycle** decides with
one pure matcher: integrity, used claves, the account tail by account type,
then the time window (−60 s / +180 s, nearest, 30 s margin). A decided
match is **promoted to the ordinary `valid` verdict**, so every check that
confirms a payment today runs unchanged. An undecided one stops calling,
asks the payer for the clave and never expires; a typed clave that fits a
kept candidate confirms without a call. One provider call per payment for
this outcome, where today there are about eight.

Phase 0 found what the design leans on and what it had to build:

- the seal cannot be verified — the certificate the CEP names cannot be
  obtained (R2) — so the bundle is trusted as the provider's answer, like
  every `valid`, and no second call buys anything (clarified 2026-09-27);
- the clave and the reference are not in the cadena, and the PDF prints the
  cadena over three lines; every field this feature keeps joins exactly
  without spaces (R4, R5);
- the receipt's time never reached a payment — it stopped in
  `extractions.transfer_time` — and there is no question for the sender's
  account at all (R15);
- `downloads` is never stored, `banxicoConfirmed` never read, no zip or pdf
  library exists, the proofs bucket keeps a file 15 days, and the panel
  shows no `last_error` (R1, R3, R6, contracts/panel.md);
- the shared-reference stop of receipt-triage D7 lives in four places, all
  narrowed the same way (R12).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`;
Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4, Drizzle ORM over D1, zod, wrangler 4,
`@cloudflare/vitest-pool-workers`; React 19 + TanStack Query in `apps/pago`
and `apps/admin`; Workers AI through `AI` for the reader. **New:** `fflate`
(runtime, `apps/api`) — unzip and zlib for the bundle, zip and zlib for
the test fixtures (R3). apiCEP at `https://api.apicep.cloud`; its bundles
at `https://storage.apicep.cloud` (R1)

**Storage**: one D1; one additive migration `0040_cep_bundle_match.sql` —
two tables (`cep_bundles`, `cep_records`), four columns on `payments`, one
on `extractions` (data-model.md). R2 `PROOFS` gains the prefix
`bundles/<business_id>/`, under the bucket's 15-day rule

**Testing**: Vitest in workerd with a real local D1; apiCEP and its storage
intercepted with `fetchMock` at pinned origins; synthetic CEP PDFs and ZIPs
built with `fflate` to the measured layout (R18); the reader stubbed at the
binding (`aiReturning`) with `hora` in seconds and `cuentaOrigen`;
component tests for the payer page and the feed on happy-dom with MSW and
axe. The eight real CEPs stay out of git; quickstart re-reads them locally

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01;
`dev` and `prod` under `devoladapago.com`

**Project Type**: pnpm monorepo — `apps/api` (engine, lifecycle, routes,
schema, migration, sandbox), `apps/pago` (the ask), `apps/admin` (the
feed). `packages/ui` untouched

**Performance Goals**: at most one provider call per payment for a several
answer (SC-003); decided in the attempt that receives it — ~5 s provider,
≤ 10 s download, milliseconds to read three 28 KB CEPs — so a receipt with
a time or a tail confirms within 2 minutes (SC-001) and an undecided one
asks within the minute (SC-004); a transfer is parsed once per business however
many bundles repeat it (D3, D16)

**Constraints**: migration additive; no new `status` word, no new trigger,
no new secret; one new var, `APICEP_STORAGE_ORIGIN`, set in
`wrangler.jsonc` with no URL written in code (constitution VIII); names and
RFCs never stored; the bundle's link
never leaves the API; what a verdict means, the fee, partial settlement
and the WispHub half are unchanged (spec Assumptions)

**Scale/Scope**: engine — `provider/{apicep,types}.ts`, `index.ts`,
`validate.ts`, `extract.ts`, `extraction/reader.ts`, five new files in
`consta/bundle/`; lifecycle — `direct-payments/validation.ts`; routes —
`direct-payments/{handler,schema}.ts`, `payments/{index,handler,schema}.ts`;
schema + migration; env, wrangler, vitest config; sandbox; pago —
`PaymentPage.tsx`; admin — `FeedScreen.tsx`. Tests: ~25 engine (reader,
matcher tables), ~20 lifecycle, ~4 panel routes, ~4 page, ~4 feed — cited
`cep-bundle-match US<n>` or `bug: reference-finds-other-transfer`

## Decisions

The spec's clarifications (sessions 2026-09-26 and 2026-09-27) are the
product decisions. The plan adds the ones below; code comments cite them as
`cep-bundle-match D<n>` (constitution I). D17 and D18 came from the analysis of 2026-09-27.

| # | Decision | Made in |
| --- | --- | --- |
| D1 | "Several" is a provider reason: `invalid` + `banxicoConfirmed: true` + no `cepDetails`/`cepStatus` + `downloads.cepPdf`. Logged as `validations.reason = 'several'`; never rides the `not_found` schedule. The adapter also reads `processingTime`, `cdaChain`, `senderAccountType`, `senderAccount`, `certificateNumber` on a `valid` | research R1 |
| D2 | No seal verification: the bundle is trusted as the provider's answer, like every `valid`; one call, no second call by clave. The seal is stored per record, `seal_status = 'not_verified'` | research R2, clarified 2026-09-27 |
| D3 | The bundle is recognised by its first bytes (`PK\x03\x04` ZIP, `%PDF-` one CEP), unzipped with `fflate`; the clave comes from the entry name and must equal the printed one; days never come from a name; a clave the business already holds as a record is not opened again. Each CEP is read by a purpose-built reader of Banxico's layout: streams sliced by `/Length`, cp1252 runs, the cadena's three lines joined without spaces; anything unexpected is `unreadable` | research R3, R4 |
| D4 | One `parseCadena` for a bundle's CEPs and a `valid`'s `cdaChain`: version `01`, positions 1–18 and the certificate; names and RFC/CURP never leave the parser; amount by string parsing; credit instant = credit day + time in `America/Mexico_City` | research R5 |
| D5 | The engine writes `cep_bundles` (search keys, status, claves, hash, R2 key; the URL only until read) and `cep_records` (unique `(business_id, clave)`) for every transfer a clave-less search returns; the file goes to `PROOFS` under `bundles/<business_id>/`. "Used" and "unmatched" are queries, never a stored fate. Never for the platform's own top-ups (owner `platform`): they keep today's path | research R6 |
| D6 | The window: `d = credit − receipt`, inside when `−60 s ≤ d ≤ +180 s` (an `HH:MM` receipt is the whole minute); the nearest by `\|d\|` wins unless the two nearest were credited within 30 s; `d` is recorded as `match_distance_s` | research R7, clarified 2026-09-27 |
| D7 | The tail follows the CEP's account type: `40` — the CLABE's end or its first 17 digits' end; `3`, `10`, others — the number's end; fewer than three digits is no tail | research R8, clarified 2026-09-27 |
| D8 | The engine reads, the lifecycle decides: `matchCandidates` (pure, `consta/bundle/match.ts`) runs integrity → used → tail → window on a receipt side taken from the attempt's own reading when it has one (`verdict.ourReading`), else from the row — a first receipt-door attempt has an empty row (analyze I1); a decided match is promoted to the ordinary `valid` verdict (`alreadyValidated: false`, `previouslyValidated: null`) and the existing valid branch runs unchanged; `match_trail` records every candidate's fate | research R9 |
| D9 | Every CEP a clave-less search returns passes the matcher, the single `valid` included. A search is clave-less when the transfer door asked by reference, or when neither reading on the receipt door carried a clave the gate passed (analyze A1). With neither time nor tail, a single candidate confirms as today | research R9, clarified 2026-09-27 |
| D10 | Undecided = `validating` + `last_error = 'CEP_UNDECIDED'` + `disputed_fields ["trackingKey"]` + `next_validation_at = NULL`: no call, no expiry; the reason in `match_trail.reason`. Public codes `CEP_UNDECIDED` and `CEP_ALL_USED`; no new `status` | research R10, clarified 2026-09-27 |
| D11 | A clave on a row that supersedes an undecided one is first fitted against the superseded row's candidates — O as 0, I as 1, or one character missing — and exactly one fit confirms without a call | research R11, clarified 2026-09-27 |
| D12 | The shared-reference stop (receipt-triage D7) fires, in all four places, only when there is neither a time nor a tail | research R12, clarified 2026-09-27 |
| D13 | A "validated before" flag traces to Devolada when the clave is in the business's `cep_records`; the transfer door's billing row records the CEP's clave when the request had none | research R13 |
| D14 | Other customers' CEPs by pull: a payment holding a clave looks up `cep_records` before any call; a stored bundle nudges the business's `validating` payments whose clave it holds (`next_validation_at = now`) | research R14 |
| D15 | The reader asks `hora` with seconds when printed and `cuentaOrigen`; `QUESTIONS_VERSION` 3; `ConstaReading` and `extractions` carry the tail; the payment takes `transfer_time` and `sender_tail` from `verdict.ourReading` on every attempt that carries one, not only on `not_found` (analyze I1). The two answers are measured on spec 011's bench — which learns to mark them — before any test stub stands on them (constitution IV, analyze C1) | research R15 |
| D17 | A business on the `/v1` API sees what an undecided payment awaits: `apiPayment` gains `awaiting` (`"payer_tracking_key"` or null) and `awaitingReason` (`all_used`, `ambiguous`, `no_match`, `unreadable`, or null), derived from `last_error = 'CEP_UNDECIDED'` and `match_trail.reason`; additive, no status word, no new event, the webhook body unchanged | research R19, clarified 2026-09-27 |
| D18 | A clave the matcher chose that another payment took between the read and the write — the unique index refuses it — joins `used` and the matcher runs again, twice at most; such a payment is never `TRANSFER_ALREADY_USED` for a transfer it only chose, and with nothing left it is undecided (`all_used`). A clave the payer typed or the receipt showed keeps today's refusal | research R9, analyze U3 |
| D19 | A single `valid`'s facts come from its cadena, or — when it is missing or not as measured — from the same answer's own fields: `processingTime` as the credit time on the day the receipt printed (the operation day 0–5 days after it), the accounts when whole, the amount. Unreadable only when both fail. Whatever did not read says why: `recordWhy` on the verdict, `readWhy` on the trail's candidate, the check a bundle entry's cadena failed. An undecided single is `CEP_SINGLE_UNDECIDED` to the payer and "Una coincidencia…" to the panel (`undecidedSource`); an undecided row keeps the bank Banxico named and the printed day for the clave form | creator 2026-09-28 (Rule 1), bug single-cep-unreadable |
| D16 | The download: only from `APICEP_STORAGE_ORIGIN` — a `wrangler.jsonc` var, no URL in code; unset, nothing is downloaded and the payment asks for the clave — 10 s, 4 MB, no credit; a failure is `CEP_BUNDLE_PENDING` and its next slot downloads, never calls; three failures `unreadable`, over the cap `too_large` — both undecided | research R16 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against v1.6.0. One gate per principle; verdicts re-read after
Phase 1 (below the table).

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Sixteen decisions with the place each was made; every new rule cites `cep-bundle-match D<n>`. Comments that stop being true are rewritten, not left beside the code: the D11 comment on `not_found` in `provider/{apicep,types}.ts` (a third `invalid` exists), the 422 comment (the provider answers several with a bundle, measured, never a 422), the `last_error` word list in `db/schema.ts`, the reader's `time` comment (now the pairing it promised), receipt-triage D7's four stops. The bug `reference-finds-other-transfer` gets a dated note pointing at FR-014 and is closed with `/speckit-bug-test` after implementation | PASS |
| II | Money Law | The CEP's amount is parsed from the cadena's text with `amountToCents`; the matcher compares cents to cents; `credited_at` is epoch ms. The one zone read is the CEP's own (Mexico City, printed on it) — a fact of the document, not "today" | PASS |
| III | One Contract, Pure Routers | `publicPaymentError` +2, `feedCharge.undecided`, `proofResponse.match`, the new `unmatchedTransfers` schemas and the public `apiPayment` (two nullable fields, contracts/public-api.md) change additively and are exported from `@devolada/api` (contracts/). The new route's router is pure; the logic sits in the handler. The engine's changes are internal (contracts/engine.md) | PASS |
| IV | Tests Run on the Real Runtime | apiCEP and its storage are intercepted at pinned origins (`APICEP_BASE_URL`, `APICEP_STORAGE_ORIGIN`); the reader stays the one stubbed binding, and its two new answers are measured on the bench before a stub copies them (T015–T016); migrations per test; no database mocks. The fixtures are synthetic PDFs and ZIPs reproducing the measured layout, because real CEPs carry names and RFCs | PASS |
| V | Tenant Isolation and Authorization by Area | Both tables carry `business_id`; every read filters on it; records are unique per business, so one business's transfers never touch another's. The list and the dialog use `payments/read`. No read across businesses: recalibrating the window from `match_distance_s` is the creator's manual query today, and becomes an amendment if it ever becomes a panel number | PASS |
| VI | Visual Foundations (NON-NEGOTIABLE) | The ask reuses `TransferForm` and the `Alert` recipe (icon + text); the feed keeps `StatusBadge` and adds text; tokens only; 48px on the page, 40px compact in the panel; no motion; es-MX copy | PASS |
| VII | Every Test Cites Its Story | New tests cite `cep-bundle-match US1`…`US4`; the single-`valid` refusal also cites `bug: reference-finds-other-transfer`; tasks carry `[US<n>]` | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | `APICEP_STORAGE_ORIGIN` is a var in `wrangler.jsonc` (local, dev, prod), with no URL written in code, and `env.ts` says what unset means: no bundle is downloaded and the payment asks for the clave; a link to any other origin is never fetched. `APICEP_BASE_URL` still carries its URL in code — the same gap, registered as debt (`.specify/debt/provider-url-defaults/`), not repeated here. (WispHub's default is a compiled catalogue entry of a per-business choice, spec 007 — not the same case.) No provider credential → no call → no bundle, as today. No `AI` binding → no time and no tail → a single match confirms as today and a bundle asks for the clave | PASS |

**Post-design re-check (after Phase 1).** Still PASS on all eight. Re-read
on purpose: (III) `proofResponse.match` shows other senders by the last
four digits and a clave — the business's own incoming money, the same its bank
statement shows; no name, no whole account, and nothing of it reaches the
payer's schemas. (V) the pull of D14 and the fit of D11 read
`cep_records` by `(business_id, clave)` only. (VIII) the promoted `valid`
(D8) runs every existing guard, so a bundle can never confirm what a
`valid` could not.

## Project Structure

### Documentation (this feature)

```text
specs/013-cep-bundle-match/
├── plan.md              # This file
├── spec.md              # four stories, FR-001…FR-017, clarified 2026-09-27
├── research.md          # Phase 0: what was measured, R1–R18
├── data-model.md        # Phase 1: two tables, five columns, the trail, the state
├── quickstart.md        # Phase 1: validation per story, gates in CI order
├── contracts/
│   ├── engine.md        # adapter, verdict, bundle reading, records, the matcher, the reader
│   ├── payment-page.md  # the two codes and the ask
│   ├── panel.md         # undecided reason, the trail in the proof, unmatched transfers
│   └── public-api.md    # what an undecided payment awaits, on the /v1 read
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── migrations/0040_cep_bundle_match.sql      # + cep_bundles, cep_records; payments ×4; extractions ×1
├── package.json                               # + fflate
├── wrangler.jsonc                             # + APICEP_STORAGE_ORIGIN in vars (local, dev, prod)
├── vitest.config.ts                           # + APICEP_STORAGE_ORIGIN pinned
├── sandbox/apicep-mock.mjs                    # + a several scenario serving a ZIP of synthetic CEPs
├── src/
│   ├── env.ts                                 # + APICEP_STORAGE_ORIGIN and its "unset means"
│   ├── db/schema.ts                           # + cepBundles, cepRecords; payments/extractions columns; validations.reason; last_error words
│   ├── consta/
│   │   ├── index.ts                           # ~ ConstaVerdict.bundle/.record; ConstaReading.time/.senderTail
│   │   ├── validate.ts                        # ~ several → bundle; single valid → record; billing clave (D13); referenceTaken narrowed (D12)
│   │   ├── extract.ts                         # ~ sender_tail, time with seconds
│   │   ├── provider/apicep.ts, types.ts       # ~ banxicoConfirmed, "several"; cepDetails fields
│   │   ├── extraction/reader.ts               # ~ hora with seconds, cuentaOrigen, QUESTIONS_VERSION 3
│   │   └── bundle/
│   │       ├── zip.ts                         # + sniff, list, inflate (D3)
│   │       ├── cep-pdf.ts                     # + the CEP layout reader (D3)
│   │       ├── cadena.ts                      # + parseCadena (D4)
│   │       ├── store.ts                       # + download, R2, bundles, records, readPendingBundle (D5, D16)
│   │       └── match.ts                       # + matchCandidates, fitClave — pure (D6–D8, D11)
│   ├── platform/bench.ts                      # ~ productReading, notShown: time and senderTail
│   ├── direct-payments/validation.ts          # ~ matcher → promoted valid | undecided; bundle retry; fit; pull + nudge; narrowed stop; tracing; receipt side
│   └── routes/
│       ├── dev.ts                                  # + POST /dev/cep-read — reads a bundle, stores nothing (quickstart Step 0)
│       ├── direct-payments/handler.ts, schema.ts   # ~ two public codes, status mapping, sharedAsk narrowed
│       ├── payments/index.ts, handler.ts, schema.ts  # ~ feedCharge.undecided, proofResponse.match; + GET /unmatched-transfers
│       ├── reader/schema.ts                        # ~ BENCH_FIELDS + time, senderTail
│       └── v1/payments/schema.ts, handler.ts       # ~ apiPayment.awaiting, .awaitingReason (D17)
└── test/
    ├── consta/bundle-fixtures.ts              # + synthetic CEP PDF and ZIP builders (R18)
    ├── consta/bundle.test.ts                  # + zip, CEP reader, cadena
    ├── consta/match.test.ts                   # + matcher and fitClave tables
    ├── consta/validate.test.ts                # ~ several recognised; bundle read and stored; single record; billing clave
    ├── consta/reader-questions.test.ts        # ~ version 3, pinned hash
    ├── consta/helpers.ts                      # ~ stubs copied from the bench's measured answers (T016)
    ├── reader-bench.test.ts                   # ~ the tally counts time and senderTail
    ├── collections-api-verify.test.ts         # + awaiting on the /v1 read
    ├── cep-bundle-match.test.ts               # + lifecycle: US1–US4, FR-014–FR-016, SC-003 call counts, download retry
    └── payments-unmatched.test.ts             # + feed reason, proof match, unmatched list

apps/pago/
├── src/features/pago/PaymentPage.tsx          # ~ CEP_UNDECIDED, CEP_ALL_USED: copy and the clave ask
└── test/pago.test.tsx                         # + both asks

apps/admin/
├── src/features/feed/FeedScreen.tsx           # ~ undecided reason, candidates in the proof dialog, "Sin pago" list
├── src/features/operator/BenchReceipt.tsx     # ~ "Hora" and "Cuenta de origen" can be marked
├── test/feed.test.tsx                         # + scenarios
└── test/operator-reader.test.tsx              # + the two bench fields

.specify/bugs/reference-finds-other-transfer/assessment.md   # ~ dated note: fixed by spec 013 FR-014
CLAUDE.md                                      # ~ opens with the business, as the constitution does (done with this plan); the .dev.vars table gains APICEP_STORAGE_ORIGIN
```

**Structure Decision**: the engine gains one folder, `consta/bundle/`, whose
reading and matching are pure and testable without a database, the way
`extraction/compare.ts` holds the two-eyes comparison; the lifecycle, two
route areas, one page and one screen are edited in place. No new package,
area, token or trigger.

## Complexity Tracking

No constitution gate is violated. One note, not a departure: `fflate` is a
new runtime dependency of `apps/api`. The stack table fixes frameworks and
runtimes, not every library; Workers have no ZIP reader, and the same
library builds the test fixtures (R3).
