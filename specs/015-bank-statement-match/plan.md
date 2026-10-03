# Implementation Plan: bank-statement-match

**Branch**: `claude/spec-015-bank-statement-match` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-bank-statement-match/spec.md`

## Summary

The business's own bank confirms what Banxico cannot. First, a payment
from an account at the business's own bank, which never reaches SPEI, stops
expiring in silence: it is recognized when the payer confirms, waits
without a clock, gets the provisional reconnection like any payment, and is
confirmed — or marked "no llegó" — by an operator who checked the bank.
Then the business's statement confirms everything it shows, and each bank's
reader joins once its real file is measured.

The creator fixed the order on 2026-10-02 (D1):

- **Phase A — the same-bank payment, without a file** (User Story 4 but
  its scenarios 4 and 6). No new table, column, status word, route area or
  trigger:
  - **Recognized** in `runValidation`, before any provider check, when the
    payer's bank equals the collection account's — CLABE, card or phone
    (D2).
  - **Waits** as `validating` with no next attempt and the reason
    `SAME_BANK`, the pattern 013's undecided rows already use (D3).
  - **Released** at once with the payer's own evidence, for the promise's
    usual date (D4).
  - **Ends** `expired` + `NOT_RECEIVED` when it did not arrive: no fee, a
    burned ride only if released (D5).
  - **Decided** in the panel by `POST /payments/:id/bank-check`, which
    settles with no CEP through the verdict's own settlement (D6).
  - **The payer** reads 017's words and nothing new (D7).
  - **The panel** gets a chip, a strip, two badges and two confirmed
    buttons (D8).
  - **A receipt** read as same-bank asks the payer's bank before it
    submits (D9).
- **Phase B — the statement's core** (User Stories 1–3, and 4's scenarios
  4 and 6): imports, credits that are imported once, the match, "abonos sin
  cliente" and assignment, all around a generic credit and tested with
  synthetic ones (D12–D15).
- **Phase C — the readers**: one per bank format, written only against a
  real, measured, anonymized file (D16).

Phase 0 found what this leans on:

- the engine already refuses a same-bank pair for free, but nothing acts on
  it: the row retries for six hours and expires with an error the payer
  never sees (R1);
- a wait without a clock already exists — `next_validation_at` null — and
  every reader of open payments already copes with it (R3);
- settling a payment with no CEP is already done, by the kept verdict and by
  cash at stores, and the review already records who decided a row (R6);
- `expired` already carries everything "no llegó" needs: no fee, 017's
  words for the payer, and the burned-ride rule (R5);
- spec 019 had promised such a payment a method of its own; the creator
  chose the SPEI method instead and 019 is amended (R10).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`;
Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4, Drizzle ORM over D1, zod,
`@cloudflare/vitest-pool-workers`; React 19 + TanStack Query in
`apps/admin` and `apps/pago`; `@devolada/ui`'s `StatusBadge`, `Button`,
`Alert`, the app's `AlertDialog` and `Tabs`. No new dependency

**Storage**: one D1. Phase A: no migration — new `last_error` codes on
existing columns (data-model.md). Phase B: `statement_imports`,
`statement_credits` and `payments.statement_credit_id`, one additive
migration

**Testing**: lifecycle in workerd with a real D1, apiCEP and WispHub
intercepted at their pinned origins, asserting the absence of provider
calls; the panel and the page on happy-dom with MSW, schema-validated
fixtures and axe; the chip, strip and dialogs on the browser layer

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01;
`dev` and `prod` under `devoladapago.com`

**Project Type**: pnpm monorepo — `apps/api`, `apps/admin`, `apps/pago`,
`packages/ui`

**Performance Goals**: Phase A adds no provider call and one conditional
update per decision. Phase B: a month of a 1,000-customer business matched
and reported in under 2 minutes (SC-001), inside the upload request

**Constraints**: no payer-facing field, code or sentence that says how a
payment is validated (FR-019); a payment is confirmed once (FR-009, D6's
claim); amounts exact to the cent (constitution II, FR-010); a bank file
never stored, only its credits (FR-002)

**Scale/Scope**: Phase A — `direct-payments/validation.ts` (the pre-check,
`settleWithoutCep`), `routes/payments/{index,handler,schema}.ts` (the
filter and `bank-check`), `db/schema.ts` (two comments),
`FeedScreen.tsx`, `status-badge.tsx`, `apps/pago`'s receipt step. Tests:
~16 API, ~8 panel, ~5 page, 2 badge, the e2e feed — cited
`bank-statement-match US4`

## Decisions

The spec's clarifications (2026-09-26 to 2026-10-02) are the product
decisions. The plan adds the ones below; code comments cite them as
`bank-statement-match D<n>` (constitution I).

| # | Decision | Made in |
| --- | --- | --- |
| D1 | Three phases, in order: A, the same-bank payment without a file; B, the statement's core around a generic credit; C, each bank's reader once its real file is measured | creator 2026-10-02 |
| D2 | Recognition is a pre-check in `runValidation`, beside `SPEI_BANK_UNKNOWN` and before `PROVIDER_NOT_CONFIGURED`: a transfer-door row whose `senderBank` equals `beneficiary.bank` (the snapshot; legacy rows fall back to `collectAccount`), any collection kind, exact `BANKS` equality. The engine's D17 guard stays as the backstop | research R2, creator 2026-10-02 |
| D3 | The wait: `status` stays `validating`, `next_validation_at` null, `last_error = 'SAME_BANK'`. No status word; no enum copy changes | research R3 |
| D4 | The release is evaluated once at recognition, through `releasable()`, with evidence `human`; `promiseDeadline` unchanged; no expiry email — the panel shows the lapse | research R4, creator 2026-10-02 |
| D5 | "No llegó" is `expired` + `NOT_RECEIVED`: 017's words for the payer, no fee, a burned ride only when released. Never `invalid`. The status comment names it | research R5, creator 2026-10-02 |
| D6 | `POST /payments/:id/bank-check { received }` under `payments: operate`. A conditional claim (`SAME_BANK` → `BANK_CHECKING`, with a two-minute lease on `next_validation_at` that the sweep's pre-check reclaims) makes one decision win; `received` settles through `settleWithoutCep` (`settlePanelPayment` / `settleApiPayment` with `cep: null`, D14's re-check kept), the payer's claimed amount as received; `reviewedBy`/`reviewedAt` record who; the fee as any confirmed payment; a failed read of the business's system restores the wait and answers 503 | research R6, creator 2026-10-02 |
| D7 | The payer's contract and page change nothing: 017's words already render the wait, the release, the confirmation and the end; one test proves no text says how | research R7, creator 2026-10-02 |
| D8 | Panel: chip "Por confirmar en tu banco" (`awaiting=bank`), a strip when N > 0, `StatusBadge` kinds `awaitingBank` and `notReceived`, **Sí, llegó** / **No llegó** behind `AlertDialog`s, a new `release` field (kind and lapse) shown on the row, "Confirmado a mano por {nombre}" | research R8 |
| D9 | `askBeforeCredit` — reported by `/read`, enforced by the receipt door — asks the payer's bank on a clear same-bank reading: a new reason `same_bank` when the receipt has a key, `senderBank` added to `no_key`'s fields when it has none. The page asks "¿Desde qué banco pagaste?" with 017's chips; the answer is `transfer.senderBank`. A reading alone never makes a payment same-bank | research R9 |
| D10 | The method in the business's system is SPEI: the row keeps `channel = 'spei'`; spec 019 carries the amendment | research R10, creator 2026-10-02 |
| D11 | `/v1` links wait the same way, without a release, and the verdict webhook announces the decision | research R11 |
| D12 | Readers return a generic `StatementRead`; the core keeps only credits, matches on the operation date and parses amounts with its own parsers | research R12 |
| D13 | A credit's identity: clave, else bank + folio, else date + cents + reference + sender + its occurrence that day in the file | research R13 |
| D14 | The match order: clave; same-bank; registered payer (waiting or expired unfound); a new payment for an exact amount asked on or before the credit's day; else "sin cliente". Undecided 013 rows are never decided. Same-bank rows inside the file's period without their credit end "no llegó" | research R14 |
| D15 | `apps/api/src/statements/` (core) with `readers/`; route area `statements`; panel screen **Estado de cuenta**; the file is never stored | research R15 |
| D16 | No reader before its real file. The monthly PDF as a second format, and what BBVA prints on the receiving side of a same-bank credit, stay open until the files arrive | research R16 |
| D17 | After "no llegó", the payer's confirmation of the same data is a new payment that waits again (`identicalAttempt` skips rows ended `NOT_RECEIVED`), and an ended row never offers a retry (`retryAvailable` false) | research R5, creator 2026-10-03 |
| D18 | **Asignar** is offered only where the integration can search customers; elsewhere the list shows with `canAssign: false` and the route answers 409 `ASSIGNMENT_UNAVAILABLE` | research R15, creator 2026-10-03 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against v1.9.2, then re-checked against **v1.10.0** (2026-10-02),
which ratified the Purpose amendment this plan proposed (TODO(015-PLAN-CHECK)
closed). One gate per principle, plus the Purpose and the
stack, as 018 did.

| Principle | Gate | Verdict |
| --- | --- | --- |
| **Purpose** | "Devolada lets Mexican businesses … collect payments by SPEI and validates every transfer"; cash is the one named exception, confirmed by the store's word. A transfer within one bank never reaches SPEI and is confirmed by the business's own word or its statement — a way the Purpose does not name | ✅ PASS under v1.10.0: the Purpose now says a transfer from an account at the business's own bank is confirmed by the business, by hand or with its bank statement (was ⛔ under v1.9.2) |
| I. Spec-Driven, Every Decision Cited | Eighteen decisions with where each was made; code cites `bank-statement-match D<n>`; spec 019's amendment is dated and quoted in both specs | PASS |
| II. Money Law | Cents end to end; the received amount is the payer's claim in cents (Phase A) or the credit's, parsed by the core's parsers (Phase B); "today" for the lapse is the business's timezone; matches exact to the cent | PASS |
| III. One Contract, Pure Routers | `bank-check` joins `routes/payments`; `awaiting` and `bankCheck` in `payments/schema.ts`, exported as today; Phase B is a new area with its own export; routers stay pure; new codes are new meanings, not old ones reused | PASS |
| IV. Tests Run on the Real Runtime | Lifecycle in workerd on a real D1 with providers at pinned origins, including the assertion that none is called; panel and page on MSW with validated fixtures and axe; layout on the browser layer; Phase C fixtures are real files, anonymized | PASS |
| V. Tenant Isolation and Authorization by Area | Every query and the claim filter by `business_id`; deciding is `payments: operate`, reading `payments: read`; no cross-business read; statement data never in a payer contract (FR-015) | PASS |
| VI. Visual Foundations | Two `StatusBadge` kinds with icon + text on existing tones; `AlertDialog` with the one dimming treatment; compact 40px buttons in the desktop panel; the payer's bank question reuses 017's 48px chips and a 64px decisive action; es-MX copy; no new token | PASS |
| VII. Every Test Cites Its Story | Every new test cites `bank-statement-match US<n>`; tasks carry `[US<n>]` | PASS |
| VIII. Absent Configuration Degrades | No new binding. Without the provider credential the pay route still refuses new payments, as today (`channelOpen`); a same-bank row already in flight is recognized before the provider check, so it waits instead of expiring on `PROVIDER_NOT_CONFIGURED`; without WispHub the confirmation settles as the business's mode says | PASS |
| IX. The Core Speaks Generic | "Same bank", "collection account", "release", "integration" are core words; the release and the action go through the integration's capabilities as today; no WispHub word in a contract or in the panel's copy; a bank's export format lives in one reader file | PASS |
| Stack, migrations, one trigger | No dependency; Phase A no migration, Phase B one additive migration; no new trigger — Phase A needs no sweep and Phase B runs in the upload request | PASS |

**Post-design re-check (after Phase 1).** PASS on I–IX, the stack and,
since v1.10.0, the Purpose.
Re-read on purpose:
- (III) `NOT_AWAITING_BANK` is a new code; `NOT_FOUND` and
  `INTEGRATION_UNAVAILABLE` are reused with their existing meanings.
- (V) the filter, and the strip that reuses it, read one business's rows.
- (IX) `settleWithoutCep` calls the same capability-driven settlement as
  the verdict, so no adapter detail enters the new code.

## Project Structure

### Documentation (this feature)

```text
specs/015-bank-statement-match/
├── plan.md              # This file
├── spec.md              # four stories, FR-001…FR-024, clarified 2026-09-26 … 2026-10-03
├── research.md          # Phase 0: R1–R16
├── data-model.md        # Phase 1: Phase A's codes and states; Phase B's tables
├── quickstart.md        # Phase 1: validation per phase, gates
├── contracts/
│   ├── panel.md         # the filter, bank-check, the feed screen, two badges
│   ├── payment-page.md  # no new field; the words per moment; the receipt's bank question
│   └── statements.md    # Phases B–C: the reader interface, the routes, the screen
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── db/schema.ts                              # ~ comments: expired + NOT_RECEIVED (D5); reviewedBy widens (D6)
│   │                                             #   [B] + statement_imports, statement_credits, payments.statement_credit_id
│   ├── direct-payments/validation.ts             # ~ same-bank pre-check (D2, D3, D4); + settleWithoutCep (D6)
│   ├── consta/extraction/ask.ts                  # ~ askBeforeCredit: same_bank; senderBank in no_key (D9)
│   ├── routes/direct-payments/handler.ts         # ~ identicalAttempt skips NOT_RECEIVED; retryAvailable false (D17)
│   ├── consta/index.ts                           # ~ the Ask union gains same_bank (D9)
│   ├── routes/direct-payments/schema.ts          # ~ proofReadingResponse.ask: same_bank (D9)
│   ├── routes/payments/
│   │   ├── index.ts                              # + POST /payments/:id/bank-check
│   │   ├── handler.ts                            # + bankCheck; ~ listPaymentFeed: awaiting=bank, bankCheck, release
│   │   └── schema.ts                             # + awaiting, bankCheck, bankCheckBody (D6, D8)
│   ├── statements/                               # [B] import.ts, identity.ts, match.ts (D12–D14)
│   │   └── readers/                              # [C] one file per measured format (D16)
│   └── routes/statements/{index,handler,schema}.ts   # [B] (D15)
├── migrations/00NN_bank_statement_match.sql      # [B] additive
├── package.json                                  # [B] + ./statements-schema export
└── test/
    ├── bank-statement-match.test.ts              # + US4 (Phase A)
    └── bank-statement-match-statements.test.ts   # [B] US1–US4 with synthetic credits

apps/admin/
├── src/features/feed/FeedScreen.tsx              # ~ chip, strip, row actions and dialogs (D8)
├── src/features/statements/StatementsScreen.tsx  # [B] Estado de cuenta (D15)
└── test/bank-statement-match.test.tsx            # + US4 panel; [B] US1–US3

apps/pago/
├── src/features/pago/PaymentPage.tsx             # ~ the receipt's bank question for ask same_bank (D9)
└── test/bank-statement-match.test.tsx            # + US4: words only, no "how" (D7, D9)

packages/ui/src/components/status-badge.tsx       # + awaitingBank, notReceived (D8)

tests/e2e/responsive.spec.ts, contrast.spec.ts, stubs.ts   # ~ the chip, the strip and the dialogs at 360/768/1280, both themes
```

**Structure Decision**: Phase A is a change of what exists — one
pre-check and one exported settlement in the lifecycle, one route beside
the review, one chip in the feed — because the same-bank payment is a
payment like any other that waits on a different party. Phase B adds the
only new module and route area, because a statement is a new thing the
business brings. `[B]` and `[C]` mark what waits for its phase.

## Complexity Tracking

| Departure | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| **Purpose amendment** (ratified by the creator on 2026-10-02 as constitution v1.10.0, as 018's was in v1.8.0). After "…the business confirms each hand-over of the cash.", add: "A transfer from an account at the business's own bank never reaches SPEI, so Banxico has no record of it: the business confirms it, by hand or with its bank statement." | The Purpose names two ways a payment is confirmed — Banxico's record and a store's word. Phase A adds a third: the business's own word, and Phase B its statement. Governance requires the plan to say so rather than route around it | Leaving same-bank payments out keeps them expiring in silence, which the creator rejected (Session 2026-10-02). Treating the business's word as "validation" stretches a word the Purpose uses for Banxico's record |

Two notes, not departures:

- **One `expired` with two reasons** (D5). A reader must look at
  `last_error` to tell "ran out of time" from "did not arrive". The schema
  comment says so, and every place that shows the difference — the panel's
  badge, the strip — reads it.
- **`reviewedBy` serves two decisions** (D6): receipt-triage's review and
  this bank check. Both are "who decided this row by hand"; the panel tells
  them apart by `actionOutcome`'s review history and by `bankCheck`.
