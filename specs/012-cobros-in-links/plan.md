# Implementation Plan: Cobros in Links

**Branch**: `claude/pr-237-propuesta-h2glb8` (spec directory `012-cobros-in-links`) | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-cobros-in-links/spec.md`

## Summary

Links keeps its name and gains a two-option chip beside its search box:
*Todos* (the customer view, unchanged from `main`) and **Por cobrar**. The
chip looks like a filter. Underneath, it reads the business's open
invoices from its integration, one block per scroll, live, never from the
sweep's copy.

**Core and adapter (constitution IX, D18).** The core asks the business's
integration for two capabilities, `receivables` and `customerDebt`, and
imports nothing from `wisphub/`. The WispHub adapter owns the invoice
path, the cursor, the period text and the billing-run rule. The chip
shows because the integration has the capability, as the session says.

Four pieces make that work:

- **The list.** `GET /payment-requests` keeps its path and changes its
  contract. It stops answering one whole list and answers blocks, with an
  opaque cursor rebuilt from numbers the provider's own `next` carries
  (D1–D4). A provider outage is an answer, not an error (D7).
- **The rows.** The browser groups the loaded invoices by customer, in
  order of arrival (D6).
- **Search.** A search in Por cobrar asks the existing customers door,
  panel rows only (D8). Then, row by row, it asks a new debt door. That
  door reads the customer record and WispHub's per-customer balance door
  in one operation, and composes them with the existing `debtFor` rule
  (D9–D11).
- **Navigation.** The Cobros section leaves the menu. Its address
  redirects to `/links?view=receivables` (D12).

The sweep and every money path are untouched.

**One change to the spec came out of research** (D9). A search result's
debt costs **two** WispHub reads, not one. The billing run moves the
carried balance into a new invoice at one instant (measured 2026-09-23),
and only reading both halves in the same operation keeps the total from
counting it twice. FR-017 and the Clarifications are amended in this
commit.

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM; Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4 + `@hono/zod-validator`, Drizzle (unchanged tables), React 19, TanStack Router + Query, shadcn `Tabs` (already in `apps/admin`), `@devolada/ui` (`StatusBadge`, `Amount`, `Pending`)

**Storage**: none new. D1 is read only for the `payment_links` lookup the customers door already makes. No migration.

**Testing**: Vitest 3 with `vitest-pool-workers` (API; WispHub intercepted by `fetchMock` at its origin); happy-dom + Testing Library + MSW (admin); Playwright + axe (`tests/e2e/links.spec.ts`)

**Target Platform**: Cloudflare Workers (API), assets Worker (admin), desktop-first panel with a floor of 360px

**Project Type**: web — `apps/api` + `apps/admin` + `packages/ui`

**Performance Goals**:
- the first Por cobrar block in under 3 s for 95% of presses (SC-002). One WispHub call is measured at 0.4–0.6 s;
- a search result's debt: two sequential calls, about 1 s, at most four at a time (D11).

**Constraints**:
- the per-call and per-operation deadlines stay 5 s and 12 s (`provider-latency` D1);
- no read of the sweep's snapshot or the display cache on this path (SC-006);
- money is integer cents through `decimalToCents` / `amountToCents`.

**Scale/Scope**:
- the pilot has 193 open invoices and 6,522 customers: 4–10 blocks of Por cobrar, depending on screen height;
- one new API door, one changed door, one new optional parameter, one adapter method, two `StatusBadge` statuses;
- one admin screen reshaped, one removed;
- one core module for integration capabilities, and one adapter module that fills it (D18).

**Measured 2026-09-27** (research, "Measurements recorded"): M1 pages by
`offset` and `count` is present; M3's money fields are JSON numbers.

**Still open**: M2 cases (b) two invoices and (c) a short-payer, and
whether the door lists an invoice older than 180 days. Only US3 waits on
them. M2 is the only measurement that can reopen a decision (D10).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes, with no violation. Re-checked 2026-09-27 against constitution v1.7.0 (IX added): the first design broke IX in two core handlers; D18 moves that logic into the adapter, and it passes.*

| Principle | Gate | Status |
| --- | --- | --- |
| I. Spec-driven, decisions cited | Spec → plan → tasks. Every non-obvious rule cites `cobros-in-links D<n>`, and measurement dates are carried (M1–M3 are added the day they run) | ✅ |
| II. Money law | Cents end to end. The invoice row's new amounts go through the string parsers (D5). The debt is `debtFor` + `nothingOwedIsProven`, unchanged (D9). Overdue is judged in the business's timezone (D6) | ✅ |
| III. One contract, pure routers | Changes in `routes/payment-requests/{index,handler,schema}.ts` and `routes/direct-payments/{…}`. Pure routers and zod schemas, exported as today. MSW and Playwright fixtures are validated by them. One envelope, `UPPER_SNAKE` codes. No `message`/`retryable` on these browser-facing routes | ✅ |
| IV. Tests on the real runtime | API tests in workerd with a real D1, and WispHub at its origin through `fetchMock`, including the measured cycle. Component tests with MSW and axe. Layout questions go to Playwright (D17) | ✅ |
| V. Tenant isolation, authorization by area | Every read uses the actor's own integration. The debt door is `requireArea("payments","read")`, like the customers door. `/payment-requests` keeps `requireSession` (every role reads, `cobros-live` D4). No cross-business read | ✅ |
| VI. Visual foundations | The chip is the existing `Tabs` primitive at compact 40px (D14). Status goes through `StatusBadge`, with two new entries in `packages/ui` (D15). Amounts use `Amount`. The waiting label is inside `<Pending>`. 360px with no horizontal scroll, checked by the browser layer. es-MX copy | ✅ |
| VII. Every test cites its story | Every new or changed test file cites `cobros-in-links US<n>`. Tasks carry `[US<n>]` | ✅ |
| VIII. Absent configuration degrades | No new binding. Without an integration that can read open invoices, no chip: the customer view says where links come from, as today (D13). A provider outage is an answer on both doors (D7, D9) | ✅ |
| IX. The core speaks generic; adapters translate | Added 2026-09-27. The core defines `IntegrationCapabilities` and one entry point, `capabilitiesOf` (D18). Both core handlers import nothing from `wisphub/`. The invoice path, the `inv:` cursor, the period text and the two-read debt rule live in `wisphub/receivables.ts`. New contracts say `integration` and `INTEGRATION_AUTH_FAILED`. The chip reads `integrationCapabilities` from the session. The money parsers move to the core (T003). Older leaks are registered debt (`core-reads-provider-directly`) | ✅ |
| Stack table | No departure | ✅ |
| One Worker trigger | No new periodic work. The sweep is untouched | ✅ |

## Project Structure

### Documentation (this feature)

```text
specs/012-cobros-in-links/
├── spec.md
├── plan.md              # this file
├── research.md          # D1–D18
├── data-model.md
├── quickstart.md        # M1–M3, then the checks
├── contracts/
│   ├── receivables-api.md
│   └── customer-debt-api.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks — not created here
```

### Source Code (repository root)

```text
apps/api/
├── src/money.ts                             # moved from src/wisphub/money.ts: the money parsers are core (IX, T003)
├── src/integrations/capabilities.ts         # new, core: IntegrationCapabilities, OpenInvoice, IntegrationError,
│                                            #   capabilitiesOf / capabilityNames — the one entry point (D18)
├── src/auth/middleware.ts                   # the session gains integrationCapabilities (D13)
├── src/wisphub/                             # the adapter
│   ├── client.ts                            # PendingInvoice +3 optional fields; pendingInvoicesPage reads count
│   │                                        #   and the new fields; openInvoicesOf(idServicio), GET only (D5, D10)
│   └── receivables.ts                       # new: both capabilities; the inv: cursor, the window, the /facturas/
│                                            #   path, the two-read debt; WispHubError → IntegrationError (D2, D9, D18)
├── src/routes/payment-requests/
│   ├── schema.ts                            # block contract; receivables query (D1)
│   ├── handler.ts                           # asks the receivables capability; D7 answers; no wisphub/ import
│   └── index.ts                             # zValidator for the query
├── src/routes/direct-payments/
│   ├── schema.ts                            # customersQuery.channel; customerDebtQuery/Response (D8, D9)
│   ├── handler.ts                           # listCustomers honours channel=panel; customerDebt asks the
│   │                                        #   customerDebt capability, no wisphub/ import (D8, D9, D18)
│   └── index.ts                             # GET /customers/debt
└── test/
    ├── cobros-in-links.test.ts              # new (US1, US3, US4)
    └── payment-requests.test.ts             # rewritten for the block contract

apps/admin/
├── src/features/auth/session.ts             # BusinessActor.integrationCapabilities (D13)
├── src/router.tsx                           # linksSearch += view; /payment-requests → redirect (D12)
├── src/features/shell/Shell.tsx             # Cobros leaves baseSections
├── src/features/links/
│   ├── LinksScreen.tsx                      # the chip; renders the view (D14)
│   ├── useReceivables.ts                    # new: blocks of open invoices, grouping (D4, D6)
│   ├── ReceivablesList.tsx                  # new: rows moved from CobrosScreen, never sorted
│   ├── useCustomerDebt.ts                   # new: per-row debt queries, four at a time (D11)
│   ├── useCustomers.ts                      # key and memory include the view; passes channel=panel
│   └── seen.ts                              # memory keyed by view
├── src/features/cobros/CobrosScreen.tsx     # deleted (D16)
└── test/
    ├── cobros-in-links.test.tsx             # new
    ├── cobros.test.tsx                      # reduced to the redirect
    ├── presence-freshness.test.tsx          # Cobros cases retired with D16
    └── msw.ts                               # fixtures for the new contracts

packages/ui/src/components/status-badge.tsx  # debtNone, debtUnconfirmed (D15)
tests/e2e/{stubs.ts,links.spec.ts}           # stubs validated by the new schemas; the chip at three widths
```

**Structure Decision**: this is the existing web layout, with `apps/api`,
`apps/admin` and `packages/ui`. Nothing is added at the top level. The Por
cobrar view lives inside `features/links`, because it is a view of that
page and not a section (spec, Context).

## Complexity Tracking

No constitution violation to justify.
