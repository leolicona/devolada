# Implementation Plan: receipt-triage


**Branch**: `claude/payment-receipt-info-handling-bhqn5o` | **Date**: 2026-09-24 (first planned 2026-09-23) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-receipt-triage/spec.md`

## Summary

Four changes around the receipt upload. **Before it**, the payer sees what a
good capture shows. **During the check**, the referencia numérica becomes a
second key — read, compared and sent to Banxico whenever there is no clave de
rastreo — and the check asks Banxico about the account the receipt shows as
its destination, which can now be the ISP's CLABE, debit card or phone.
**After the reading**, a clear capture that shows neither key is stopped
before any paid call, and the payer is told exactly which data is missing,
where their bank shows it, and that they can type it — with everything the
capture did show already filled in. **In Cuenta**, the owner registers a
CLABE, a card and a phone and chooses one — the *cuenta de cobro* — which is
the only account the payer sees (re-planned 2026-09-24: D29–D32).

Phase 0 found that the engine already speaks both new languages: the request
guard, the provider adapter and the billing log carry the reference, and the
request guard already accepts a card, a phone and a list of accounts
(research R1, R12). What stops them is the layer above: two facade types, one
`readable` test, the reader, the gate, the comparison, the payment row, the
lifecycle's `accepted` test and the pay contract. The ask reuses the two-eyes
refusal's exact shape — `/read` reports, the page renders, the receipt door
enforces — and revives a failure code the engine still declares
(`RECEIPT_INCOMPLETE`).

Three things are genuinely new and named:

- Banxico's clave is adopted onto a confirmed row found by reference, or the
  reference would reopen the double payment direct-payment D8 closed (R4);
- the provider's "this reference matches more than one transfer" stops the
  retries and asks for the clave, or every slot would buy the same refusal
  (R7);
- a payment remembers the accounts registered when it was submitted and is
  always checked against **one** of them — the one its receipt's digits name,
  else the cuenta de cobro — so the design never depends on the provider
  choosing among candidates (re-planned 2026-09-24, R19; the list door and
  D23 are retired); a confirmation to a removed account, or one with no
  clave the provider cannot vouch for, is held for the ISP (D31)
  (R12, R15).

Production has no traffic yet (measured 2026-09-23), so the feature's rates
are unknown today and countable from its first week (FR-028, D21).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`;
Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4.7, Drizzle ORM 0.40 over D1, zod 3.24,
wrangler 4, `@cloudflare/vitest-pool-workers` 0.8; React 19 + TanStack Query
on the payer page and the panel; Workers AI through the `AI` binding — the
reader model is a var (`@cf/mistralai/mistral-small-3.1-24b-instruct` by
default); apiCEP at `https://api.apicep.cloud`, whose direct mode takes
`referenceNumber` when there is no `trackingKey`, and whose beneficiary is a
CLABE, a card or a phone, with a list of candidates when it reads a picture
(documented, unmeasured — research, "What was measured")

**Storage**: one D1 (`devolada-db`); one additive migration `0036` (columns listed in data-model.md, re-planned 2026-09-24): four
columns on `businesses`, three on `payments`, five on `extractions`, no new
table. R2 `PROOFS` unchanged

**Testing**: Vitest 3.2 in workerd with a real local D1; apiCEP intercepted
with `fetchMock` at its pinned origin, now also answering reference searches,
the 422, and card and phone bodies; the reader stubbed at the binding
(`aiReturning`) with `referenciaNumerica` and `destino`; component tests for
the payer page and the panel on happy-dom with MSW, axe on every state; the
capture guide's contrast and width in Playwright (`tests/e2e/pago.spec.ts`)

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01;
`dev` and `prod` under `devoladapago.com`

**Project Type**: pnpm monorepo — `apps/api` (engine, lifecycle, routes,
schema, migration), `apps/pago` (the payer page), `apps/admin` (the Cuenta
screen). `packages/ui` untouched

**Performance Goals**: zero provider credits on a clear capture with no key or
with a destination that fits none of the ISP's accounts (SC-001, SC-007); no
extra Workers AI call — the new fields ride the same prompt, and the paid
attempt still reuses the draft's reading (two-eyes D14); a reference-only
receipt confirms in at most two paid calls (SC-002); a transfer to a card or
phone in as many as one to the CLABE (SC-006); a reference matching more than
one transfer costs at most one (SC-005)

**Constraints**: migration additive; what a verdict means, the fee, partial
settlement and the schedule are unchanged (FR-029); every row born before the
migration keeps today's path (FR-027); the shape rules' cross-business read is
untouched and never consulted for a reference (constitution V, D13); es-MX
copy on both surfaces; no new token, layer or motion (constitution VI)

**Scale/Scope**: engine — `reader.ts` (+2 fields), `gate.ts` (+1 verdict),
`compare.ts` (key = clave or reference), `ask.ts` and `destination.ts` (new,
pure), `validate.ts` (read with a list, ask before the provider, tie the
account, `beneficiaryUsed`), `extract.ts` (ask on the reading, new outcomes,
new columns), `index.ts` (facade types), `failure.ts` (+1 code, one comment),
`provider/apicep.ts` (comment); lifecycle — `validation.ts` (accepted with
either key and a known account, account from the row, adoption, the 422);
routes — `direct-payments/{handler,schema}.ts`, `settings/{handler,schema}.ts`;
schema + migration; sandbox; pago — `PaymentPage.tsx`, `CaptureGuide.tsx`,
`bank-hints.ts`; admin — `SettingsScreen.tsx`. Tests: ~12 engine, ~10
lifecycle, ~5 settings, ~15 page, ~3 panel, 1 browser — all cited
`receipt-triage US<n>`; the ones research R17 names are rewritten

## Decisions

The spec fixes D1–D10. The plan adds the ones below; code comments cite them
as `receipt-triage D<n>` (constitution I).

**Re-planned 2026-09-24** for the rescoped Story 3 (spec D9, D10, FR-016–
FR-021, FR-020a) and the clarified FR-005/FR-006: D29–D32 added; D22, D25
and D26 amended; D23 retired with the list door. Contracts: payment-page,
settings, engine updated; review.md added.

**Amended 2026-09-24** after `/speckit-analyze`: D27 added (finding G1); the
other findings were folded into the spec, the contracts, the data model and
the tasks with dated notes.

| # | Decision | Made in |
| --- | --- | --- |
| D1–D10 | A key is a clave or a reference; a reference is up to seven digits as printed; Banxico's clave kept for every confirmation; a clear capture with neither key asked about before any credit; the feedback's when, where, words and ways forward; the same pattern for later asks; a reference matching more than one transfer asks for the clave; the capture guide inside the step; one card and one phone beside the CLABE; the check asks about the account the receipt shows as destination | spec |
| D11 | The reference is threaded through every layer as an optional sibling of the clave, with one rule: the reference travels only when there is no clave; when both exist, only the clave travels (clarified 2026-09-24) | research R1 |
| D12 | The reader asks for "Referencia"/"Referencia numérica" and is told what is not one; the gate accepts `^\d{1,7}$` as printed, and calls a repeated digit or a run of consecutive digits `generic` — no key (clarified 2026-09-24). The engine's guard stays at 20 digits for other callers | research R2 |
| D13 | The comparison's key is the clave when either side read one, the reference otherwise; the shape rules never judge a reference; a disputed reference goes to the payer. A disputed clave the shape rules cannot settle, as the only field in doubt, falls back to a reference both sides read and the gate passed: `accepted` carries that reference and no clave, nothing is asked, and the payer is asked for the clave only when that reference's search does not confirm (clarified 2026-09-24) | research R3 |
| D14 | A confirmed row with a reference and no clave adopts the CEP's clave whatever its `proof_mode`, under the existing unique index | research R4 |
| D15 | One pure `askBeforeCredit(extracted, accounts)` in the engine — `no_key` or `wrong_destination`: `/read` reports it, the receipt door throws `RECEIPT_INCOMPLETE` or `RECEIPT_WRONG_DESTINATION` on it before the provider call | research R5 |
| D16 | The ask fires only on a *certain* reading — `legibility === "full"` on a picture, or a PDF's text — and `no_key` only when both keys are *missing*. Omitted legibility, `partial`, and a malformed clave go through | research R6 |
| D17 | On the provider's `provide_tracking_key`, the row asks for the clave (`disputed_fields`, `REFERENCE_AMBIGUOUS`) and skips the provider on later slots until it has one | research R7 |
| D18 | The ask reuses the refusal `Alert` and `TransferForm`: the sentences, focus on arrival, two buttons, the key block, the account choice, "No aparece en tu captura", the form first on a second ask in one visit | research R8 |
| D19 | Bank hints are es-MX copy in the payer app, keyed by `Bank`, each with its source and date; an entry only from a real receipt or the bank's own documentation. Launch: Banorte | research R9 |
| D20 | The capture guide is app-local and compact (re-planned 2026-09-24): one line on the transfer step; on the upload step a four-item checklist with "Ver ejemplo" opening, in the existing `Collapsible`, the inline-SVG drawing in token classes, the rules and the bank tips; after a reading the items show seen / not seen by icon + word, cross-faded; no other motion | research R10, spec D8 |
| D21 | `extractions` gains `proof_key`, both references, the destination and two outcomes, so every count in FR-028 is one query | research R11 |
| D22 | The lifecycle hands the engine the cuenta de cobro and the payment's registered accounts; the engine reads the file, ties the destination, names the tied account (else the cuenta de cobro) and reports `beneficiaryUsed`. On `valid`, Banxico's `cepDetails.beneficiaryAccount` — kept by the adapter — is tied too and outranks `beneficiaryUsed`; a whole account that fits none is `TRANSFER_CONTRADICTED` (amended and re-planned 2026-09-24) | research R12, R19 |
| D23 | ~~While a payment's account is unknown, its retries keep the receipt door with the list~~ — **retired 2026-09-24** with the list door (R19) | research R12 |
| D24 | The destination is tied by visible trailing digits against every form of each account — whole CLABE, its 11-digit account segment, card, phone. Fewer than three digits, or more than one fit, is *unknown*; only a clear reading that fits nothing is a mismatch | research R14 |
| D25 | The payment snapshots, at submission, `beneficiary` (the cuenta de cobro, or the account the draft reading tied) and `registered_accounts` (current and retired); attempts read the payment, never the business. Rows with neither keep today's fallback (simplified 2026-09-24) | research R15, R20 |
| D26 | Card and phone are columns on `businesses` in the `clabe` area (owner only), masked like the CLABE — **their "CLABE stays required" half is replaced by D32** | research R16 |
| D28 | `recentReading` rebuilds the reference (gate re-derived from the stored text), the destination and `passes` with the new rule, and also reuses `key_missing` and `wrong_destination` rows — or a reused reading silently drops the reference and the ask stops receipt 2 | research R18 (review 2026-09-24) |
| D29 | One cuenta de cobro: `spei_collect_kind` (NULL = `clabe`); the link payload carries one `collectAccount`; the pay contract has no `receivingAccount`; the ask never names the account | research R19 |
| D30 | `spei_retired_accounts` keeps every number the ISP changed or cleared; the pay handler snapshots current + retired into `registered_accounts`; the tie runs against the snapshot, 3–4 trailing digits, retired ones included | research R20 |
| D31 | A confirmation to a retired account, or with no clave and an unknown replay flag, is held: `confirmed` + `action_outcome = "review"` + `review_reason`, no queue, no webhook, until `POST /payments/:id/review` accepts (queue, announce) or rejects (`invalid`, `REJECTED_BY_BUSINESS`). Every reader that settles on `confirmed` — the queue, the link's paid state, provisional release, the webhooks — is audited to skip `review` | research R21 |
| D32 | No CLABE required: `configured` = the cuenta de cobro is set with a known bank; one helper `collectAccount(business)` replaces every `speiClabe!` beneficiary read | research R22 |
| D27 | A payment with neither `beneficiary` nor `registered_accounts` was born before this feature; its receipt-door requests carry `legacy`, and the engine skips the ask and the destination tie for it (FR-027) | `/speckit-analyze` 2026-09-24, finding G1 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against v1.5.0. One gate per principle; verdicts re-read after
Phase 1 (below the table).

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Twenty-seven decisions with the place each was made. Every new rule in code cites `receipt-triage D<n>`. Comments that say a hole never refuses (`consta/validate.ts` D2/D3 block, `consta/failure.ts` on `RECEIPT_INCOMPLETE`, `reader.ts` on legibility, the `/read` handler's header), that the beneficiary is the business's CLABE (`direct-payments/validation.ts`), and that Devolada "cannot hit" the 422 (`provider/apicep.ts`) are rewritten, not left contradicting the code. The two-eyes spec carries a dated note pointing at receipt-triage D4 (done with this plan) | PASS |
| II | Money Law | No amount is added or converted. A reference and a destination are text, never parsed as numbers, so leading zeros survive. The amount the ask names as missing is a field name, not a value | PASS |
| III | One Contract, Pure Routers | `linkStatusResponse`, `proofReadingResponse`, `payRequest`, `directPaymentStatusResponse`, `publicPaymentError`, `settingsResponse`, `settingsPatchRequest` and the new `reviewDecisionRequest` change additively (`configured` changes meaning — D32, owned by this spec) (contracts/). Routers untouched; the logic is in handlers. The engine's facade changes are internal (contracts/engine.md). The bank hints and the account banks are keyed by the `Bank` type the schemas re-export, so the vocabulary keeps one source (`gen-banks`) | PASS |
| IV | Tests Run on the Real Runtime | apiCEP stays intercepted at its pinned origin, answering reference searches, the 422 and card and phone bodies as the adapter already parses them; the reader stays the one binding a test stands in for; migrations applied per test. The guide's contrast and width are measured in the browser layer | PASS |
| V | Tenant Isolation and Authorization by Area | Every new column sits on a table that already carries `business_id`, or on `businesses` itself. Card, phone and the cuenta de cobro use the existing `clabe` area; the review decision uses `payments/operate` — no new area or action. Retired accounts live on the business row and are snapshotted per payment. The destination is tied only against the ISP's own accounts, and those accounts are never written on `extractions`. No new cross-business read; the shape rules are not consulted for references | PASS |
| VI | Visual Foundations (NON-NEGOTIABLE) | The guide draws with token classes; markers are numbered and named in text, never colour alone; the ask reuses the existing `Alert` (icon + text) and the form's fields; buttons at the 48px touch size on the page, 40px compact in the panel; no motion; checked at 360/768/1280 in both themes. es-MX copy throughout. The guide is app-local because only one surface renders it | PASS |
| VII | Every Test Cites Its Story | New and rewritten tests cite `receipt-triage US1`…`US4`; research R17 names the two-eyes assertions that change, so none disappears unnamed | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | No `AI` binding → no reading, so no ask, no reference from our side and no tied account: the file goes to the provider with the whole list of accounts, and the provider's own reference, when it reads one, still counts. An ISP with no card or phone → today's payload and today's single account. No `APICEP_TOKEN` → unchanged. The `AI` comment in `env.ts` gains the sentence saying so | PASS |

**Post-design re-check (after Phase 1).** Still PASS on all eight. Re-read on
purpose: (II) references and destination digits are `text` and compared as
strings, so `038195` and `38195` never merge. (III) the payer page receives
the card and phone because they are public on the transfer step by design,
like the CLABE; the panel shows them to other roles exactly as it shows the
CLABE. (V) the adoption of Banxico's clave (D14) is scoped by the existing
index, which is per business — one business's reference search can never
collide with another's row.

## Project Structure

### Documentation (this feature)

```text
specs/010-receipt-triage/
├── plan.md              # This file
├── spec.md              # D1–D10, four stories, FR-001…FR-029
├── research.md          # Phase 0: what was measured, R1–R17
├── data-model.md        # Phase 1: columns, reading fields, the ask, tying
├── quickstart.md        # Phase 1: validation per story, gates in CI order
├── contracts/
│   ├── engine.md        # facade types, the ask, tying, the comparison, the 422
│   ├── payment-page.md  # link payload, /read, pay, status, errors, page behaviour and copy
│   └── settings.md      # card and phone in Cuenta
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── migrations/0036_receipt_triage.sql          # + additive columns (data-model.md)
├── src/
│   ├── db/schema.ts                            # ~ businesses, payments, extractions columns; outcome vocabulary
│   ├── env.ts                                  # ~ AI comment: no reading → no ask, the cuenta de cobro
│   ├── consta/
│   │   ├── index.ts                            # ~ ConstaBeneficiary widened; transfer keys; receivingAccounts; verdict and reading fields
│   │   ├── failure.ts                          # ~ RECEIPT_INCOMPLETE thrown again; + RECEIPT_WRONG_DESTINATION
│   │   ├── validate.ts                         # ~ ask before the provider; tie the account (retired included); name it; beneficiaryUsed
│   │   ├── extract.ts                          # ~ ask on the reading; two outcomes; proof_key, references, destination on the row
│   │   ├── provider/apicep.ts                  # ~ the 422 comment: Devolada can hit it now
│   │   └── extraction/
│   │       ├── reader.ts                       # ~ referenciaNumerica, destino in FIELDS (both prompts)
│   │       ├── gate.ts                         # ~ referenceNumber verdict; passes with either key
│   │       ├── compare.ts                      # ~ key = clave or reference; accepted with both keys
│   │       ├── ask.ts                          # + askBeforeCredit (pure)
│   │       └── destination.ts                  # + tieDestination (pure)
│   ├── direct-payments/
│   │   └── validation.ts                       # ~ account from the row (D25); accepted needs a key; adoption and the no-clave guard (D14, FR-006); the 422 (D17); review hold (D31)
│   └── routes/
│       ├── direct-payments/
│       │   ├── handler.ts                      # ~ link payload collectAccount; /read: accounts in, ask out; pay: reference, snapshot (D30); status: reference, inReview
│       │   └── schema.ts                       # ~ contracts/payment-page.md
│       ├── payments/
│       │   ├── index.ts                        # + POST /:id/review (payments/operate)
│       │   ├── handler.ts                      # + reviewDecision (D31)
│       │   └── schema.ts                       # ~ contracts/review.md
│       └── settings/
│           ├── handler.ts                      # ~ card/phone, cuenta de cobro, retired accounts, configured (D29, D30, D32)
│           └── schema.ts                       # ~ contracts/settings.md
├── sandbox/apicep-mock.mjs                     # ~ reference found / 422; card and phone bodies
└── test/
    ├── consta/helpers.ts                       # ~ stub readings carry referenciaNumerica and destino
    ├── consta/validate.test.ts                 # ~ R17 rewrites; + reference comparison, the ask, tying
    ├── direct-payment.test.ts                  # + reference door, adoption, the 422, account snapshot, review hold
    └── settings.test.ts                        # + card, phone, cuenta de cobro, retired accounts

apps/pago/
├── src/features/pago/
│   ├── PaymentPage.tsx                         # ~ one account on the transfer step; the ask; the key block (reference first); lead with typing; later asks; in review
│   ├── CaptureGuide.tsx                        # + the guide (D20)
│   └── bank-hints.ts                           # + BANK_HINTS (D19)
└── test/pago.test.tsx                          # + US1–US4 scenarios

apps/admin/
├── src/features/settings/SettingsScreen.tsx    # ~ three accounts and the cuenta de cobro choice (D29)
├── src/features/payments/…                     # ~ "En revisión" row: Aceptar / Rechazar (contracts/review.md)
└── test/settings.test.tsx, payments test       # + scenarios

tests/e2e/pago.spec.ts                          # + the guide at 360/768/1280, both themes
specs/005-two-eyes-receipt/spec.md              # ~ dated note: D2/FR-005 narrowed by receipt-triage D4 (done with this plan)
```

The platform's top-ups (`credit/topups.ts`) need no edit: they keep the
platform's single CLABE, and their `accepted` test requires a clave, so a
top-up whose readings agree on a reference only keeps the receipt door, as
the spec's Edge Cases say; the ask reaches them through the engine exactly as
the two-eyes refusals do, with the platform's CLABE as the only account.

**Structure Decision**: the feature edits the engine, the lifecycle, two route
handlers, one page and one panel screen in place. Two new pure engine modules
(`ask.ts`, `destination.ts`) keep the rules testable without a database, the
way `compare.ts` holds the two-eyes comparison. No new package, route, table,
area or token.

## Complexity Tracking

No constitution gate is violated; nothing to justify.
