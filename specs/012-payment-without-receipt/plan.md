# Implementation Plan: payment-without-receipt

**Branch**: `claude/spec-012-reference-by-phone` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-payment-without-receipt/spec.md`

## Summary

A payer confirms a payment with their bank and the day, and never sends a
capture. What makes that safe is a reference that belongs to one person:
the last seven digits of their phone, shared by that phone's services,
unique in the business. What makes it quick is that Devolada remembers how
each customer pays, so a returning payer confirms in one tap.

The plan builds it on what exists, adding no status word, no trigger, no
secret and no route area:

- **The reference** lives in two new tables keyed by customer, not by
  link, because a link is identity-only by requirement and can be pruned
  (D1). The whole phone is never stored. Whether a phone is shared is
  counted live, through a new adapter capability, `customersWithPhone`
  (D4). Seven digits that look like a bank app's default, start with 0, or
  end the business's own account never become a reference (D3 — an
  amendment to FR-002 the creator confirms).
- **The confirmation** is today's typed door with one field,
  `referenceSource: "own"`: the server writes the reference, and every
  guard of the typed door still runs (D8). A per-person reference never
  meets the shared-reference stop (D9).
- **Several matches on one's own reference** are all theirs: the matcher
  gains an `own` mode that prefers a learned account, then the earliest
  transfer (D10).
- **Learned banks and accounts** are queries, not tables (D12). Spec 013's
  records widen to every `valid`, so every confirmation from now on
  teaches an account (D13).
- **The ladder** counts rounds that got an answer, carried along a
  correction chain: round 3 searches the neighbouring days, the data are
  asked after it, the clave after round 4, two more rounds, then expiry —
  seven calls at most (D14–D16). A clave's last four characters choose
  among kept candidates and are never searched (D17).
- The provisional release needs no change: a confirmation is already
  `human` evidence (D18). The provider's quota becomes a platform row the
  operator sees (D19). A per-business switch keeps every path of a
  business that has not turned it on exactly as it is today (D20).

Phase 0 found what the design leans on and what it had to work around:

- there is no local customer table, and a link must not hold a phone
  (R2, R4);
- `isGenericReference` already calls the fixture phone's tail generic
  (R3);
- `cep_records` holds accounts only for searches without a clave (R10);
- no date alternation exists since the printed-day fix, which left the
  misremembered day to this spec (R12);
- the quota is stored on every call and read by nobody, and reading it
  from `validations` would be a fourth cross-business statistic (R17);
- the link read already has a field called `reference` — the concepto —
  so the new number is `payerReference` everywhere (R21).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`;
Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4, Drizzle ORM over D1, zod, wrangler 4,
`@cloudflare/vitest-pool-workers`; React 19 + TanStack Query in
`apps/pago` and `apps/admin`. No new dependency. apiCEP at its pinned
origin; WispHub through its adapter

**Storage**: one D1; one additive migration
`0041_payment_without_receipt.sql` — three tables (`payer_references`,
`payer_reference_customers`, `provider_quota`), six columns on `payments`,
one on `businesses` (data-model.md)

**Testing**: Vitest in workerd with a real local D1; apiCEP and WispHub
intercepted with `fetchMock` at pinned origins; pure matcher tables for
`own`, `typed` and `fitClaveTail`; component tests for the page and the
panel on happy-dom with MSW and axe; the browser layer for the new
controls' sizes, focus and themes

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01;
`dev` and `prod` under `devoladapago.com`

**Project Type**: pnpm monorepo — `apps/api` (schema, engine, lifecycle,
routes, sandbox), `apps/pago` (reference, confirmation, ladder),
`apps/admin` (switch, reference, profile, feed, quota). `packages/ui`
untouched

**Performance Goals**: a confirmation of a transfer Banxico holds is
confirmed within a minute (SC-001) — the first round runs inline, 4–8 s at
the provider (measured 2026-09-26); at most seven provider calls per
payment without a new fact from the payer, and two on average (SC-003);
a reference costs one or two WispHub reads when it is born (0.4–0.6 s
each, measured), never on a payment

**Constraints**: migration additive; no new `status` word, trigger,
secret or var; the switch off leaves every path byte for byte as today;
the whole phone and the whole sending account never reach a payer's
schema; a link row stays identity-only (links-on-demand-search FR-010);
money in integer cents; "today" in the business's timezone

**Scale/Scope**: API — `phone.ts`, `direct-payments/payer-reference.ts`
(new); `db/schema.ts`, `consta/bundle/{match,types}.ts`,
`consta/validate.ts`, `consta/provider/apicep.ts`,
`direct-payments/{validation,cep-match}.ts`, `integrations/capabilities.ts`,
`wisphub/{client,receivables}.ts`, `receipt/index.ts`, `index.ts`, five
route areas; sandbox. Page — `PaymentPage.tsx`, a `ConfirmPayment`
component, `ChoiceGroup`, `reference-hints.ts`. Panel — Links, feed,
settings, operator. Tests: ~20 reference rules, ~35 lifecycle, ~15
matcher, ~12 page, ~8 panel, e2e sizes — cited `payment-without-receipt
US<n>`

## Decisions

The spec's clarifications (2026-09-26, 2026-09-29, 2026-09-30) are the
product decisions. The plan adds the ones below; code comments cite them as
`payment-without-receipt D<n>` (constitution I).

| # | Decision | Made in |
| --- | --- | --- |
| D1 | The reference lives in `payer_references` + `payer_reference_customers`, keyed by customer (`panel`+usuario, `api`+customerRef), never on `payment_links`; the seven digits are stored because they are the reference; the whole phone never | research R2 |
| D2 | A phone is ten digits after removing a leading `52`/`521` (`nationalPhone`, shared with `toWhatsAppPhone`); anything else is no phone | research R1 |
| D3 | Seven digits are never a reference when generic (`isGenericReference`), starting with 0, the tail of any registered receiving account, or already held in any state; each case assigns a number. Amends FR-002 | research R3 |
| D4 | Adapter capability `customersWithPhone`: the count is live and complete; ≤ 3 share, > 3 blocks the digits; no capability, no phone | research R4 |
| D5 | `ensurePayerReference` at link creation (panel, API), at the payer's read, and in a backfill joining the every-minute cron (20 links per business per minute); an adapter that cannot answer means no reference yet, never a guess | research R5 |
| D6 | Assigned numbers: random, first digit 1–9, outside D3, unique per business over all states for ever; reset retires one customer's number; "not personal" blocks the digits and gives each holder its own | research R6 |
| D7 | `bankOrder`: this business's confirmed payments of 90 days, most used banks first, five at most | research R20 |
| D8 | The confirmation is the typed door with `referenceSource: "own"`; the server writes the digits; the day within today − 30 … today; `preselected` rides along | research R7 |
| D9 | `own` and `typed` rows never meet a shared-reference stop; rows without a source keep today's four | research R8 |
| D10 | Matcher `own` mode: integrity → used → learned account → earliest; undecided only as `all_used` | research R9 |
| D11 | "No puse la referencia": another person's reference refused; no tail and no learned account at that bank → `SENDER_TAIL_NEEDED` before anything is billed; learned accounts compared whole before the tail; no fit asks the four digits, fitted without a call | research R11 |
| D12 | Learned banks per person and accounts per service are queries; `sender_account_new` marks a new account | research R10 |
| D13 | Spec 013 D5 widens: every `valid` of a business keeps a `cep_records` row | research R10 |
| D14 | A round is an attempt that got an answer; `ladder_round` rides the correction chain; round 3 searches the neighbouring days; after round 4 the 2-hour and last slots; expiry after round 6 | research R12 |
| D15 | Status `ask`: `check_data` after round 3, `clave` after round 4, `sender_tail`, `clave_tail`; "Todo está bien" lives on the device | research R13 |
| D16 | `correction_count` on the chain; a fourth search-spending correction without a clave or receipt → `CORRECTIONS_EXHAUSTED` | research R14 |
| D17 | `fitClaveTail` on the kept candidates' last four characters; one fit confirms; never searched | research R15 |
| D18 | Provisional release unchanged: a confirmation is `human` evidence; only the copy of the asks changes | research R16 |
| D19 | `provider_quota`, a platform row upserted from `X-RateLimit-Remaining`; shown in `/operador`; a `429` is not a round | research R17 |
| D20 | `businesses.pay_by_reference`, under `settings: update`; off is today, exactly | research R18 |
| D21 | `ChoiceGroup` on native radios in `apps/pago`; 48px choices, 64px **Confirmar pago**; `REFERENCE_HINTS` verified-only, Azteca first | research R19 |
| D22 | The number is `payerReference` everywhere (`reference` stays the concepto); the share message and `/v1`'s `paymentLink` carry it | research R21 |
| D23 | `reference_source`, `match_trail.by` and `payments.confirmation` make SC-001…SC-006 queries over one business | research R22 |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against v1.7.1. One gate per principle; verdicts re-read after
Phase 1 (below the table).

| # | Principle | Gate | Verdict |
| --- | --- | --- | --- |
| I | Spec-Driven, Every Decision Cited | Twenty-three decisions with the place each was made; every new rule cites `payment-without-receipt D<n>`. Comments that stop being true are rewritten, not left beside the code: receipt-triage D7's stops (D9), spec 013 D5's "clave-less only" in `consta/bundle/store.ts` and `db/schema.ts` (D13), the `validations.quota_remaining` comment (D19). FR-002's amendment is dated in the spec | PASS |
| II | Money Law | Amounts stay integer cents end to end; "Pagué otra cantidad" is parsed like every typed amount; the day bounds and "Hoy" use the business's timezone (`time/business-day.ts`), never the browser's | PASS |
| III | One Contract, Pure Routers | `linkStatusResponse`, `payRequest`, `directPaymentStatusResponse`, `customerRow`, `feedCharge`, `settings*`, `/v1` `paymentLink` change additively; `payerProfileResponse` and the quota response are new schemas; all exported from `@devolada/api`. The two new routes (`payer-profiles`, `provider-quota`) join existing routers, which stay pure | PASS |
| IV | Tests Run on the Real Runtime | apiCEP and WispHub intercepted at pinned origins; migrations per test; no database mocks; the matcher's new modes are pure tables; the page and panel on MSW with schema-validated fixtures and axe; sizes and focus on the browser layer | PASS |
| V | Tenant Isolation and Authorization by Area | Both reference tables carry `business_id`; every read filters on it; digits are unique per business, so one business's numbers never touch another's. `provider_quota` is a platform row with no `business_id`, like `platform_settings` — reading it reads no business, so it is not a fourth cross-business statistic. `bankOrder` reads one business. Profile under `payments: read`, reset and not-personal under `payments: operate`, the switch under `settings: update` | PASS |
| VI | Visual Foundations (NON-NEGOTIABLE) | `ChoiceGroup` from tokens, 48px, focus visible, the choice marked by icon and text; **Confirmar pago** 64px; the asks use the `Alert` recipe; the feed adds text beside `StatusBadge`; waiting breathes inside `<Pending>`; es-MX copy; no horizontal scroll at 360 | PASS |
| VII | Every Test Cites Its Story | New tests cite `payment-without-receipt US1`…`US5`; tasks carry `[US<n>]` | PASS |
| VIII | Absent Configuration Degrades, Never Breaks | No new binding. The switch is data, not configuration. An integration without `customersWithPhone`, or none, gives assigned numbers; an adapter that cannot answer leaves the link on today's flow until it can; no provider credential → no search, as today; a `429` never counts as a round and never reaches the payer as an error | PASS |
| IX | The Core Speaks Generic; Adapters Translate | The core asks `customersWithPhone` by capability; WispHub's `telefono` filter, its paging and its field live in `wisphub/`. Core contracts say customer, phone, reference; copy never names the provider. The phone rule (`nationalPhone`) is Mexican numbering — a core fact, not WispHub's | PASS |

**Post-design re-check (after Phase 1).** Still PASS on all nine. Re-read
on purpose: (III) `REFERENCE_SHARED` keeps its meaning for the rows it
still guards; the new refusals are new codes, not new meanings for old
ones. (V) `customersWithPhone` answers keys, and the core stores none of
the phones it compared. (VI) the profile shows accounts by their last four
digits only, like spec 013's feed; the payer's schemas carry no account at
all. (VIII) with `pay_by_reference = 0`, no new column is read on any path.

## Project Structure

### Documentation (this feature)

```text
specs/012-payment-without-receipt/
├── plan.md              # This file
├── spec.md              # five stories, FR-001…FR-039, clarified 2026-09-29/30; FR-002 amended by D3
├── research.md          # Phase 0: R1–R23
├── data-model.md        # Phase 1: three tables, seven columns, what is derived
├── quickstart.md        # Phase 1: two creator checks, validation per story, gates in CI order
├── contracts/
│   ├── payment-page.md  # link read, pay, status, the page's screens and copy
│   ├── panel.md         # switch, reference on Links, profile + actions, feed, quota
│   ├── public-api.md    # payerReference on /v1 paymentLink
│   └── engine.md        # phone, capability, reference, matcher modes, records, lifecycle
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── migrations/0041_payment_without_receipt.sql   # + payer_references, payer_reference_customers, provider_quota; payments ×6; businesses ×1
├── sandbox/apicep-mock.mjs                        # + by-reference scenarios …11, …22, …33, …44
├── src/
│   ├── phone.ts                                   # + nationalPhone (D2)
│   ├── receipt/index.ts                           # ~ toWhatsAppPhone on nationalPhone
│   ├── db/schema.ts                               # + three tables; payments, businesses columns
│   ├── index.ts                                   # ~ backfillPayerReferences in the cron chain (D5)
│   ├── integrations/capabilities.ts               # + customersWithPhone (D4)
│   ├── wisphub/client.ts, receivables.ts          # + telefono search, capability declared
│   ├── consta/
│   │   ├── validate.ts                            # ~ a record for every valid (D13)
│   │   ├── provider/apicep.ts                     # ~ provider_quota upsert (D19)
│   │   └── bundle/match.ts, types.ts              # ~ own/typed modes, knownAccounts, fitClaveTail (D10, D11, D17)
│   ├── direct-payments/
│   │   ├── payer-reference.ts                     # + ensure, assign, reset, not personal, learned queries (D1, D3–D7, D12)
│   │   ├── validation.ts                          # ~ rounds, neighbouring days, stops, typed, clave tail, new account (D9–D17)
│   │   └── cep-match.ts                           # ~ receipt side with knownAccounts
│   └── routes/
│       ├── direct-payments/index.ts, handler.ts, schema.ts   # ~ link read, pay, status, customerRow, shareText; + payer-profiles
│       ├── payments/handler.ts, schema.ts                    # ~ feedCharge
│       ├── settings/handler.ts, schema.ts                    # ~ payByReference
│       ├── platform/index.ts, handler.ts, schema.ts          # + provider-quota
│       └── v1/payment-links/handler.ts, schema.ts            # ~ payerReference
└── test/
    ├── payer-reference.test.ts                    # + US1: phone, sharing, D3 cases, reset, not personal, backfill
    ├── payment-without-receipt.test.ts            # + US2–US5: confirmation, rounds, asks, corrections, typed, learned
    ├── consta/match.test.ts                       # ~ own, typed, fitClaveTail tables
    ├── consta/validate.test.ts                    # ~ record for a clave valid; quota upsert
    └── collections-api-links.test.ts             # ~ payerReference

apps/pago/
├── src/components/ui/choice-group.tsx             # + native radios (D21)
├── src/features/pago/ConfirmPayment.tsx           # + step 2: question, bank, day, read-back, exits
├── src/features/pago/reference-hints.ts           # + REFERENCE_HINTS (verified only)
├── src/features/pago/PaymentPage.tsx              # ~ step 1 reference, validating read-back and asks
└── test/payment-without-receipt.test.tsx          # + US1, US2, US4, US5 screens

apps/admin/
├── src/features/links/LinksScreen.tsx             # ~ reference line
├── src/features/links/PayerProfile.tsx            # + profile sheet, reset, not personal
├── src/features/feed/FeedScreen.tsx               # ~ source, "Cuenta nueva", days searched
├── src/features/settings/…                        # ~ the switch
├── src/features/operator/…                        # ~ quota line in "Reglas"
└── test/payment-without-receipt.test.tsx          # + US1, US3 panel scenarios

tests/e2e/pago.spec.ts, stubs.ts                   # ~ the confirmation at 360/768/1280, both themes
```

**Structure Decision**: one new core module (`direct-payments/payer-reference.ts`)
and one new core helper (`phone.ts`); the matcher stays pure in
`consta/bundle/`; the lifecycle, five route areas, one page and four panel
screens are edited in place; the page's new step lives in its own
component so `PaymentPage.tsx` does not grow further. No new package,
area, token, trigger or dependency.

## Complexity Tracking

No constitution gate is violated. Two notes, not departures:

- **A WispHub read when a reference is born.** Counting a phone's customers
  costs one or two reads per new customer, and the backfill pays it for
  existing links at twenty a minute per business. The alternative that
  avoids it — keeping phones, even hashed — would store what a link must
  not (R2, R4).
- **FR-002 amended by the plan.** Default-looking and leading-zero tails
  become assigned numbers (D3). A generic tail is what strangers type by
  default, so it would bring back the shared reference this feature
  removes. The creator confirms it with this plan.
