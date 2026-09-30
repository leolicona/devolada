# Implementation Plan: confirmation-hierarchy

**Branch**: `claude/spec-017-confirmation-hierarchy` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-confirmation-hierarchy/spec.md`

## Summary

The payer's page puts its three ways to confirm in a fixed order — their own
reference in the centre, "Usé otra referencia" as a clear second, the
receipt as a quiet link at the end — and a reference the payer types is
tied to them by history, or by one short answer, before it confirms.

Spec 012 is designed and not built, so this plan is a delta on 012's plan
and is built with it (D1). It adds no route area, no trigger, no secret, no
status word and no token:

- **The step** is 012's `ConfirmPayment` with three views switched in place.
  The three options use `Button` recipes that already exist: `primary` /
  decisive, `secondary` / standard, and — for the receipt — the `ghost`
  recipe of today's quiet "No tengo el comprobante a la mano", which the
  receipt takes over everywhere on a page with a reference (D2, D3).
- **Exclusive accounts** are a query at the moment of a tie, over the
  candidates' accounts, through one new index (D4). Only they decide alone,
  in every mode (D10).
- **The typed door searches at once** (D5), and the tie-break is one screen
  with two ways to answer. An answer is a superseding row read by one pure
  function, `fitTieBreak`, against the kept candidates, without a call
  (D6). A miss carries the candidates forward.
- **Wrong answers are bounded per link**: three misses in 24 hours, then
  the whole clave (D8). Answers never count toward the hourly budget.
- **The payer's copy** (User Story 4, added 2026-09-30) is a sweep of the
  page as built on `main`: fourteen Banxico sentences, fifteen ISP
  phrases and two titles move to one vocabulary per moment (D13), the
  business's own name (D14), a bank list without Banxico (D15), and a test
  that reads every string the page can render (D16).

Phase 0 found what this leans on and what it had to change:

- 012's `typed` mode takes the account's digits with the search, before the
  payer has seen anything (012 D11) — the clave's characters cannot work
  that way (R1, R6);
- nothing reads which people an account has paid, and `cep_records` has no
  account index (R2);
- a superseding row that fits nothing has no planned place (R3);
- 012 D25 exempts clave tails from every limit, which was safe only while
  the digits came first (R4);
- the shared `Button`'s `link` variant is not a 48px target; today's quiet
  door is a `ghost` button that is (R7).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`;
Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4, Drizzle ORM over D1, zod,
`@cloudflare/vitest-pool-workers`; React 19 + TanStack Query in `apps/pago`;
`@devolada/ui`'s `Button`, `Alert`, `Input`. No new dependency

**Storage**: one D1; one column (`payments.tie_break`) and one index
(`cep_records (business_id, sender_account)`), joining 012's additive
migration `0041_payment_without_receipt.sql` (data-model.md)

**Testing**: pure `fitTieBreak` and matcher-mode tables; lifecycle in
workerd with a real D1 and apiCEP intercepted at its pinned origin; the
page on happy-dom with MSW and axe; the browser layer for order, sizes,
focus and themes

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01;
`dev` and `prod` under `devoladapago.com`

**Project Type**: pnpm monorepo — `apps/api` (schema, matcher, lifecycle,
pay and status routes, sandbox) and `apps/pago` (step 2, asks). `apps/admin`
and `packages/ui` untouched

**Performance Goals**: a tie-break answer shows its result within 5 seconds
for 95% of answers (SC-003) — it makes no provider call: one D1 read of the
waiting row, one exclusivity query over a handful of accounts by index, one
write

**Constraints**: additive schema; the switch off, or a link without a
reference, leaves the page and every path as today; no account digits, no
clave characters and no candidate list in any payer-facing schema; at most
three answers that fit nothing per link in 24 hours; the whole clave and the
receipt never limited

**Scale/Scope**: API — `db/schema.ts`, `consta/bundle/{match,types}.ts`,
`direct-payments/{validation,cep-match,payer-reference}.ts`,
`routes/direct-payments/{handler,schema}.ts`, the sandbox. Page —
`ConfirmPayment.tsx`, `PaymentPage.tsx`, a `ReceiptLink` and a
`TieBreakForm` component; for User Story 4, `PaymentPage.tsx`,
`ConfirmPayment.tsx`, `RootScreen.tsx` and `index.html` (copy only), and
seventeen assertions in six existing test files that name the old
words. Tests: ~12 `fitTieBreak` cases, ~6 mode cases, ~14 lifecycle, ~10
page, one copy scan, the e2e step — cited `confirmation-hierarchy US<n>`

## Decisions

The spec's clarifications (2026-09-30) are the product decisions. The plan
adds the ones below; code comments cite them as `confirmation-hierarchy
D<n>` (constitution I).

| # | Decision | Made in |
| --- | --- | --- |
| D1 | One build with spec 012. 012's tasks stay the backbone and keep their order; the ones this feature changes (T021, T027, T030, T035, T038, T041, T042, T043–T049, T051, T055, T056) carry a note in 012's `tasks.md`, and this feature's `tasks.md` holds what they build instead. 012's plan, data model and contracts carry dated amendment notes | research R10 |
| D2 | The step's recipes: option 1 the only `primary` / decisive button; option 2 "Usé otra referencia" `secondary` / standard, below it; option 3 a `ReceiptLink` on today's quiet-door recipe (`ghost`, 48px, `text-sm`, full width) — the quiet action the spec clarified — last on the views FR-005 names and absent from the plain wait of the first rounds. No new recipe or token | research R7, creator 2026-09-30 |
| D3 | Three views of step 2, switched in place — the confirmation (default), the typed form, the receipt — each of the last two with **Volver**; 012's *No* opens the typed form; the view is page state, so a reload lands on the confirmation. The receipt view renders `PaymentPage`'s existing receipt block, passed in and never moved, so the upload, its reading and its asks stay where they are; a `ReceiptLink` on a waiting or stopped row opens that same block on today's re-submission path (012 T042) | research R8 |
| D4 | Exclusivity is a query at the tie over the candidates' accounts: the persons each has paid, through `cep_records` → adopted claves → links → `payer_reference_customers`; a customer with no reference is another person unless it is the one confirmed. `knownAccounts` = learned for the service and exclusive; `othersAccounts` = paid another person. New index `cep_records (business_id, sender_account)` | research R2 |
| D5 | The typed door searches at once; the tie-break is asked after the search. `SENDER_TAIL_NEEDED` is never built. Amends 012 D11 | research R6 |
| D6 | An answer is a row superseding the waiting one, carrying `senderTail`, `claveTail` or both and the waiting row's data; never searched, never a correction. `fitTieBreak` (pure, `match.ts`): each way picks its fits; with both, only a common fit counts; one fit confirms unless only the digits chose an account in `othersAccounts`; several ask the other way, then the whole clave. A way that fitted rides forward to the next answer. A miss copies the waiting row's trail and stays undecided. Amends 012 D17: the characters are a first answer, not a follow-up | research R3 |
| D7 | `payments.tie_break` (`none` \| `one` \| `several`) records each answer; `match_trail.by` names what decided (`learned_account`, `sender_tail`, `clave_tail`, `clave`); `confirmation.tieBreakMisses` counts a confirmed chain's misses | research R12 |
| D8 | Three rows with `tie_break = 'none'` on a link in any 24 hours in a row — a moving window, each miss counting for 24 hours after it (clarified 2026-09-30) — close the tie-break on that link: a tail is refused `409 TIE_BREAK_EXHAUSTED` and the ask becomes `clave`. Answers of either way never count toward the hourly budget (clarified 2026-09-30). Amends 012 D25; the whole clave and the receipt stay outside every limit | research R4, creator 2026-09-30 |
| D9 | Status `ask` becomes `check_data` \| `clave` \| `tie_break`, with `tieBreak { ways, missed, several }`; derived from the row, never stored. The `sender_tail` and `clave_tail` asks are never built. Amends 012 D15 | research R5 |
| D10 | `knownAccounts` holds exclusive accounts only, in every mode: `own` prefers them, then the earliest; `typed` takes one or goes undecided (the tail and the window leave the mode); a transition's held candidate asks `tie_break`. Amends 012 D10, D11, D26 | research R1, R2 |
| D11 | A tail on a row whose superseded row does not wait on a tie-break is refused `409 TIE_BREAK_NOT_ASKED`: no row, no search. Two answers racing on one waiting row (two tabs) meet 012's one-open-attempt rule: the first supersedes it, so the second finds a row no longer waiting and is refused the same way | research R3 |
| D12 | The es-MX copy of the three options, the views, the tie-break screen, the miss and the asks; "genérica" never appears | research R9 |
| D13 | One wording per moment of a payment (spec FR-022), and the page's fourteen Banxico sentences mapped onto it one by one (contracts/payment-page.md, "The payer's copy"); the prototypes already speak it | research R13, creator 2026-09-30 |
| D14 | The business by its own name (`ispName` of the link read, already on every link view) wherever the page sends the payer back; "a quien te envió el link" where no link is known; "tu servicio" for a service that came back; the tab and the no-link screen read "Tu pago" | research R13, constitution IX |
| D15 | Banxico leaves the payer's bank list by one filter in `apps/pago` (`payerBanks`), used by `TransferForm` and by "Otro banco"; `banks.ts` stays generated and whole, because the API's vocabulary is the provider's; a draft that names Banxico drops its bank | research R13 |
| D16 | SC-006 is a unit test in `apps/pago` that walks every string literal, template literal and JSX text of `apps/pago/src` (and the title of `index.html`) with the TypeScript compiler API and fails on `/banxico/i` or `/internet/i`; comments are not strings, so the decision comments that explain Banxico stay | research R13 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against v1.7.1. One gate per principle; verdicts re-read after
Phase 1 (below the table).

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Sixteen decisions with the place each was made; code cites `confirmation-hierarchy D<n>`. The 012 decisions this amends (D10, D11, D15, D17, D25, D26) carry dated notes in 012's plan, so a reader of either finds the other; 012's spec already points here | PASS |
| II | Money Law | No amount changes path or shape; the answer carries no money; the 24-hour window and "today" stay in ms and the business's timezone | PASS |
| III | One Contract, Pure Routers | Changes are to 012's not-yet-built shapes in `routes/direct-payments/schema.ts` (`ask`, `tieBreak`, the tails' refinement) plus two new codes; exported from `@devolada/api/direct-payments-schema`; no new route; the router stays pure, the rules live in the handler and the lifecycle | PASS |
| IV | Tests Run on the Real Runtime | `fitTieBreak` and the modes are pure tables; the lifecycle runs in workerd on a real D1 with apiCEP at its pinned origin and asserts that answers make no call; the page on MSW with schema-validated fixtures and axe; order, sizes and focus on the browser layer | PASS |
| V | Tenant Isolation and Authorization by Area | The exclusivity query filters every join by `business_id` and reads one business's records; nothing crosses businesses, so no cross-business statistic is added. No account, clave character or candidate reaches a payer schema: `tieBreak` is field names and booleans | PASS |
| VI | Visual Foundations (NON-NEGOTIABLE) | Existing `Button` variants and declared sizes only: one decisive 64px per view, option 2 and the receipt link 48px, focus visible, tab order = visual order; the miss line is an `Alert` with icon and text; es-MX copy; no new token; no horizontal scroll at 360 | PASS |
| VII | Every Test Cites Its Story | New tests cite `confirmation-hierarchy US1`…`US4`; tasks carry `[US<n>]`. 012's tests that this changes keep citing 012 and gain the 017 citation where they now prove this spec | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | No new binding. Without the switch, nothing new is read. Without a provider credential the typed door rides the schedule as today; an answer needs no provider at all | PASS |
| IX | The Core Speaks Generic; Adapters Translate | Accounts, claves, references and tails are SPEI's words, core facts; no provider name in contracts or copy; nothing enters an adapter. User Story 4 pays a leak the page already had: fifteen phrases and two titles that assumed an ISP become the business's name and "tu servicio" (D14) | PASS |

**Post-design re-check (after Phase 1).** Still PASS on all nine. Re-read
on purpose: (III) `TIE_BREAK_EXHAUSTED` and `TIE_BREAK_NOT_ASKED` are new
codes, not new meanings for old ones; `CEP_UNDECIDED` keeps spec 013's
meaning for the rows waiting on a tie-break. (V) `accountsOfOthers` returns
a set of accounts to the matcher inside the engine; the status derives
`ways` from the row's own columns, and no account leaves the API. (VI) the
receipt link on the `ghost` recipe is 48px; the `link` variant, which is
not, is not used.

## Project Structure

### Documentation (this feature)

```text
specs/017-confirmation-hierarchy/
├── plan.md              # This file
├── spec.md              # three stories, FR-001…FR-019, clarified 2026-09-30
├── research.md          # Phase 0: R1–R12
├── data-model.md        # Phase 1: one column, one index, the ask, the states
├── quickstart.md        # Phase 1: sandbox additions, validation per story, gates
├── contracts/
│   ├── payment-page.md  # the answer, two refusals, the ask, the three views and the tie-break screen
│   └── engine.md        # accountsOfOthers, fitTieBreak, the modes, the lifecycle of an answer
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── migrations/0041_payment_without_receipt.sql   # ~ + payments.tie_break; + cep_records_business_account_idx (D4, D7)
├── sandbox/apicep-mock.mjs                        # ~ claves fixed for …44; + …55, …66 (quickstart)
├── src/
│   ├── db/schema.ts                               # ~ tie_break; the index
│   ├── consta/bundle/match.ts, types.ts           # ~ fitTieBreak, othersAccounts, typed mode without the tail (D6, D10)
│   ├── direct-payments/
│   │   ├── payer-reference.ts                     # ~ accountsOfOthers (D4)
│   │   ├── cep-match.ts                           # ~ receipt side with knownAccounts (exclusive) and othersAccounts
│   │   └── validation.ts                          # ~ typed door searches at once; answers; carried trail (D5, D6)
│   └── routes/direct-payments/
│       ├── schema.ts                              # ~ ask, tieBreak, the tails' refinement (D9)
│       └── handler.ts                             # ~ refusals, hourly exemption, the ask derivation (D8, D9, D11)
└── test/
    ├── confirmation-hierarchy.test.ts             # + US2, US3 lifecycle
    └── consta/match.test.ts                       # ~ fitTieBreak; modes with exclusive accounts

apps/pago/
├── src/features/pago/ConfirmPayment.tsx           # ~ three views, option 2, the receipt link (D2, D3)
├── src/features/pago/ReceiptLink.tsx              # + the quiet receipt action (D2)
├── src/features/pago/TieBreakForm.tsx             # + the tie-break screen (D9, D12)
├── src/features/pago/PaymentPage.tsx              # ~ the asks and the expired view use ReceiptLink and TieBreakForm; US4 copy (D13, D14)
├── src/features/pago/payer-banks.ts               # + payerBanks: BANKS without Banxico (D15)
├── src/features/pago/RootScreen.tsx, index.html   # ~ "Tu pago", no ISP (D14)
├── test/confirmation-hierarchy.test.tsx           # + US1, US2, US4 screens
└── test/payer-copy.test.ts                        # + the copy scan (D16)

tests/e2e/pago.spec.ts, stubs.ts                   # ~ order, sizes and focus at 360/768/1280, both themes
```

**Structure Decision**: no new module or package. The two new page
components keep `PaymentPage.tsx` from growing further, as 012 did with
`ConfirmPayment`; the matcher stays pure in `consta/bundle/`; the
exclusivity query lives beside 012's learned-account queries in
`payer-reference.ts`.

## Complexity Tracking

No constitution gate is violated. Two notes, not departures:

- **One provider call before the ask** (D5). A typed confirmation that
  finds transfers spends its search even when the payer then leaves. It is
  the only order in which the clave's characters can be compared, and 012
  spent the same call after the digits.
- **A query per tie** (D4). Exclusivity is read, not stored, so it cannot go
  stale; the new index keeps it a seek over a handful of accounts.
