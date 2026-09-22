# Implementation Plan: Cobros On-Demand Search

**Branch**: `010-cobros-on-demand-search` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-cobros-on-demand-search/spec.md`

## Summary

Cobros stops reading the tenant's whole pending-invoice list to draw one
screen. It gains the two halves `009` gave Links: **blocks**, asked for as
the operator scrolls, and a **search** asked of the provider rather than of
the rows already in the browser.

The provider's invoice list takes no customer filter (measured twice — see
[research.md](./research.md)), so the search is asked of the **customer**
list with the four `__contains` filters `009` already built, and each
match's debt is resolved with `debtFor` over the pending read the product
already uses. That detour is what lets Cobros find the debtor it cannot show
today: the customer who short-paid, whose invoice closed as *Pagada* and
whose remainder lives in `saldo`.

One door keeps its name, `GET /payment-requests`, and answers both.

## Technical Context

**Language/Version**: TypeScript 5, Node 22 toolchain, pnpm 10 workspace

**Primary Dependencies**: Hono 4 + zod on Workers (`apps/api`); React 19 +
TanStack Router/Query on Vite 6 (`apps/admin`); `@devolada/ui` atoms

**Storage**: D1 via Drizzle — **read only** in this feature. No table, no
column, no migration (see [data-model.md](./data-model.md))

**Testing**: Vitest 3 — `@cloudflare/vitest-pool-workers` in workerd with a
real local D1 for the API; happy-dom + Testing Library + MSW + axe for the
admin; Playwright + axe for the browser layer

**Target Platform**: Cloudflare Workers; the panel is desktop-first at a
360px floor

**Project Type**: Web — Workers API plus an assets-Worker SPA

**Performance Goals**: first block usable within 1 s of opening for an ISP
of any size (SC-002); 95% of searches answered within 3 s of the operator's
pause (SC-003); opening the page costs one provider read whatever the ISP's
size (SC-004)

**Constraints**: provider calls carry the existing 5 s per-call / 12 s
per-operation deadlines (`provider-latency D1`) — this feature does not
widen them, because one block and one search are each a single round trip
inside them. Money is integer cents end to end. "Today" is the business's
timezone.

**Scale/Scope**: the connected ISP is 6,513 customers (measured
2026-09-20); one API route trio, one admin screen and its hook, one shared
browser-memory module

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design — still passes.*

| Principle | How this feature satisfies it |
| --- | --- |
| **I. Spec-Driven, Every Decision Cited** | `specs/010-cobros-on-demand-search/`, specify → plan → tasks → implement. Code cites `cobros-on-demand-search D<n>` against [research.md](./research.md) D1–D13. Two provider measurements carry their dates. |
| **II. Money Law** | No new money path. Amounts stay integer cents; the provider's JSON numbers keep converting through `amountToCents` (string parsing, never `× 100`). `debtFor` is read, not edited. Overdue is decided in the business timezone (FR-025). |
| **III. One Contract, Pure Routers** | `routes/payment-requests/{index,handler,schema}.ts` keeps its shape: the router stays pure (`requireSession`, `zValidator`, wiring), logic in the handler, zod as the contract exported via `@devolada/api/payment-requests-schema` and imported by the admin, MSW and the Playwright stubs. One envelope, `UPPER_SNAKE` codes, no `message` and no `retryable` on a browser-facing route. |
| **IV. Tests Run on the Real Runtime** | API tests in workerd against a real local D1, WispHub intercepted with `fetchMock` at its real origin — no database mocks. Component tests on happy-dom with MSW answering schema-validated fixtures and `axe` on every rendered screen. The browser layer owns the scroll, the contrast in both themes, the target sizes and no horizontal scroll at 360/768/1280. |
| **V. Tenant Isolation and Authorization by Area** | Every read filters by the actor's business; the actor is resolved by `requireSession`. Authorization is unchanged: every member reads Cobros (`cobros-live D4`), the handler refuses a non-business actor, and the row's actions stay behind `payments: operate` plus a configured CLABE. |
| **VI. Visual Foundations** | Tokens only; the block's waiting state uses the existing `Pending` shape and the breath vocabulary; the three debt states are icon + text, never colour alone; the search box and rows keep 40px compact controls, and the browser layer measures contrast, targets and the 360px floor. |
| **VII. Every Test Cites Its Story** | Every test file added cites `cobros-on-demand-search US<n>`; each task in `tasks.md` carries its `[US<n>]` label so the test inherits it. |
| **VIII. Absent Configuration Degrades, Never Breaks** | No new binding. No WispHub key is a state of the world, not a failure: the page keeps today's "Conecta WispHub" door, a refused key keeps its Integraciones door with no Reintentar, and an outage keeps rows under a quiet note. |

**Result**: no violation. [Complexity Tracking](#complexity-tracking) is
empty.

## Project Structure

### Documentation (this feature)

```text
specs/010-cobros-on-demand-search/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 — decisions D1–D13
├── data-model.md        # Phase 1 — shapes that travel; no migration
├── quickstart.md        # Phase 1 — how to see it work
├── contracts/
│   └── cobros-api.md    # Phase 1 — GET /payment-requests
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — /speckit-tasks, not this command
```

### Source Code (repository root)

```text
apps/api/src/
├── routes/payment-requests/
│   ├── index.ts         # pure router: + zValidator on the new query
│   ├── schema.ts        # THE contract — rows, cursor, filter, debt state
│   ├── handler.ts       # browse block | search; maps to CobroRow
│   └── cursor.ts        # NEW — opaque cursor, live path | snapshot offset
└── wisphub/
    ├── client.ts        # + a block walk by the provider's own `next`;
    │                    #   + the due-date window per filter (D7)
    ├── snapshot.ts      # + serve one block from the served pass (D3)
    ├── debt.ts          # READ ONLY — debtFor, nothingOwedIsProven
    └── cache.ts         # READ ONLY — the 30 s display cache

apps/admin/src/
├── features/cobros/
│   ├── CobrosScreen.tsx # search box, blocks, tabs, the three debt states
│   └── useCobros.ts     # NEW — mirrors features/links/useCustomers.ts
└── lib/
    └── search-memory.ts # NEW — readResults/writeResults, lifted out of
                         #   features/links/seen.ts so both pages share one

apps/api/test/
└── cobros-search.test.ts        # NEW — workerd + real D1 + fetchMock

apps/admin/test/
└── cobros.test.tsx              # EXTENDED — search, blocks, debt states

tests/e2e/
└── cobros.spec.ts               # EXTENDED — scroll, contrast, targets
```

**Structure Decision**: the existing web split is kept exactly — the API
route trio under `apps/api/src/routes/payment-requests/` and the screen
under `apps/admin/src/features/cobros/`. Two files are new rather than
invented: `cursor.ts` follows the precedent of
`routes/direct-payments/cursor.ts`, and `useCobros.ts` mirrors
`features/links/useCustomers.ts` rather than growing the screen component.
`lib/search-memory.ts` exists so the two-minute search memory has one
definition instead of a copy per page (D10).

## Complexity Tracking

No constitution violation to justify. This feature adds no project, no
binding, no table and no pattern the codebase does not already run: the
cursor, the block walk, the four-filter search and the browser-side search
memory all exist today for Links and are reused or mirrored.

## Dependencies and sequencing

The two halves are independent on purpose, and the spec's assumption says
why: if the invoice list turns out not to walk as expected, the search still
stands on its own.

1. **Contract first** — `schema.ts` and `cursor.ts`. Everything else derives
   from it: the handler, the admin types, the MSW fixtures, the Playwright
   stubs (constitution III).
2. **US1 — the search** (P1). Handler search branch over `searchCustomers` +
   `debtFor`; the screen's search box, the three debt states, the floor
   count. Shippable alone: the list below keeps working as it does today.
3. **US2 — the blocks** (P1). The provider block walk and the snapshot
   block; the cursor; the infinite scroll; the tabs as provider walks; the
   incompleteness warning removed.
4. **US3 — the memory** (P2). `?q=` in the URL, `search-memory.ts`, the
   two-minute reuse. Depends on US1 having a search to remember.
5. **US4 — the provider away** (P3). The asymmetry of D9, on both halves.
   Last because it is the behaviour of the other three under failure.

Then the browser layer, which is the only one that can answer the scroll,
the contrast in both themes and the 360px floor.
