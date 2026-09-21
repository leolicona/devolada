# Implementation Plan: Links On-Demand Search

**Branch**: `009-links-on-demand-search` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-links-on-demand-search/spec.md`

## Summary

The Links page stops reading the ISP's customer base and starts asking for what
it shows. It opens with a search box and one viewport-sized block of customers
read live from WispHub, asks for the next block only when the operator scrolls
toward it, and answers a search by putting the text to the provider's four
`__contains` filters at once. A payment link is created the first time an
operator copies or sends one — never on being listed — and the same rule reaches
Cobros, so the collections screen can send too.

Behind it, three things are retired: the two link doors, the sweep's `roster`
pass, and the bulk link writer. A one-shot cron pass then deletes the panel
links the roster created before this feature that no payment ever referenced,
and tells the business how many went.

The technical decisions are in [research.md](./research.md), numbered `D1`–`D14`
for citation in code.

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`; Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4 + `@hono/zod-validator` (API); React 19, Vite 6, Tailwind 4, TanStack Router + Query, shadcn/ui over Radix (admin); `@devolada/ui` atoms and tokens

**Storage**: D1 via Drizzle ORM. One new table (`link_prunes`); no column added to `payment_links` — FR-010 is a decision *not* to store, so the schema change this feature makes is a deletion of rows, not of fields

**Testing**: Vitest 3 — `@cloudflare/vitest-pool-workers` against a real local D1 for the API, happy-dom + Testing Library + MSW for components, Playwright 1.6x + axe for the browser layer

**Target Platform**: Cloudflare Workers (`compatibility_date` 2025-05-01); the admin is an assets Worker with SPA fallback

**Project Type**: Web application — Workers API plus two assets-only frontends; this feature touches the API and the admin

**Performance Goals**: the page ready to search within 1 s of opening (SC-002); 95% of searches showing results within 3 s of the operator's pause (SC-003). One block and one search are each **one round trip** inside today's operation budget — a block is one provider call (0.4–0.6 s measured), a search is four in parallel

**Constraints**: the provider pages by `limit`/`offset` with no ordering parameter and no filter that takes several identities at once (D4, D6); a link never stores anything about the customer (FR-010); no background work may create a link (SC-009); `pnpm e2e` must stay green at 360/768/1280 in both themes

**Scale/Scope**: the connected ISP holds 6,513 customers (measured 2026-09-20) and roughly as many panel links, nearly all of which the prune deletes. Two API doors added, three removed; two admin screens changed; one new table

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1 design.*

| Principle | Verdict | How |
| --- | --- | --- |
| I. Spec-Driven, Every Decision Cited | **Pass** | Spec clarified 2026-09-21 (six decisions); every non-obvious rule lands with `links-on-demand-search D<n>`. The measured provider facts carry their date. |
| II. Money Law | **Pass** | No amount is read, written or displayed differently. `askCents` stays an integer on API rows; the prune's `deleted_count` is a count, not money. A panel link's ask is still read live from WispHub and never stored. |
| III. One Contract, Pure Routers | **Pass** | Both new doors are `routes/direct-payments/{index,handler,schema}.ts` — the router does middleware, `zValidator` and wiring only. Schemas are zod, already exported as `@devolada/api/direct-payments-schema`, and the admin, MSW handlers and Playwright stubs all take their types and fixtures from them. One envelope throughout, including the provider-unavailable answer (D10). |
| IV. Tests Run on the Real Runtime | **Pass** | API tests in workerd with a real local D1 and `fetchMock` at WispHub's pinned origin — including the four parallel filters, the cursor's two phases, and the prune. Component tests on happy-dom with MSW answering schema-validated fixtures. The browser layer owns what only it can answer: the infinite scroll at 360/768/1280, contrast in both themes, target size, focus. |
| V. Tenant Isolation and Authorization by Area | **Pass** | Every query filters by the actor's business; the provider client comes from `wisphubFor(integration)`, so an ISP's key only ever reaches its own installation. Reading is `requireArea("payments", "read")`; creating a link is `requireArea("payments", "operate")` plus the CLABE gate (FR-016). `link_prunes` carries `business_id`. |
| VI. Visual Foundations | **Pass** | Semantic tokens only; the channel stays `StatusBadge` (icon + text, never colour alone); 48px touch targets on Copiar and WhatsApp; the list floor holds at 360px with no horizontal scroll. The block that is loading breathes rather than spins, and reduced motion keeps the opacity breath (constitution VI, `@devolada/ui/motion`). |
| VII. Every Test Cites Its Story | **Pass** | `links-on-demand-search US1`–`US4` on every test file this feature adds; the prune's tests cite `US1` (it is what makes SC-004 and SC-009 observable). |
| VIII. Absent Configuration Degrades, Never Breaks | **Pass** | No WispHub key → the search and the list answer with the business's API links under `wisphub: "not_configured"`, and the empty state says where links come from (FR-015). Provider down → `"unavailable"`, same shape, no error block (FR-014, D10). Neither is a 503. |

**Re-check after Phase 1**: no new violation. The one deliberate risk — the prune
deleting links that were sent and are waiting to be paid — is not a
constitutional violation; it is a product decision the spec records with its
cost (FR-023, FR-024, D13), and it is listed under Complexity Tracking so a
reviewer meets it rather than discovers it.

## Project Structure

### Documentation (this feature)

```text
specs/009-links-on-demand-search/
├── plan.md              # This file
├── research.md          # Phase 0 — D1–D14
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── links-api.md     # Phase 1 — the doors added, changed and removed
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/api/src/
├── routes/direct-payments/
│   ├── index.ts              # + GET /customers, + POST /links;
│   │                         #   − GET /links, − GET /links/roster
│   ├── handler.ts            # + listCustomers, + createLink;
│   │                         #   − listLinks, − linksRoster
│   └── schema.ts             # + customersQuery, customersResponse,
│                             #   createLinkRequest/Response;
│                             #   − linksListQuery/Response, linksRosterResponse
├── routes/payment-requests/
│   ├── handler.ts            # a link miss stops hiding the buttons (D14)
│   └── schema.ts             # cobroRow: linkUrl/waLink keep null, new meaning
├── wisphub/
│   ├── client.ts             # + searchCustomers (four filters, D4),
│   │                         #   + customersBlock (limit/offset, D2/D3);
│   │                         #   − listCustomersFull, − customersPath,
│   │                         #   − queryParamFor
│   ├── cache.ts              # − rosterForDisplay
│   └── snapshot.ts           # − readRoster, − the `roster` entry in KINDS
├── direct-payments/
│   └── links.ts              # ensureLinks (bulk) → ensureLink (one), D8
├── links/
│   └── prune.ts              # the one-shot pass, PRUNE_CUTOVER_MS (D13)
├── db/schema.ts              # + link_prunes
└── index.ts                  # the prune joins the every-minute cron

apps/api/test/
├── links-customers.test.ts       # US1 — browse, search, merge, cap, dedupe
├── links-create-on-act.test.ts   # US1, US4 — born on act, never on sight
├── links-offline.test.ts         # US3 — provider down / not configured
├── links-prune.test.ts           # US1 — what goes, what stays, second run
└── links-roster-cap.test.ts      # retired with the roster it tested

apps/admin/src/features/
├── links/
│   ├── LinksScreen.tsx       # search box + infinite blocks; ?q= in the URL
│   ├── useCustomers.ts       # useInfiniteQuery, cursor, viewport block size
│   ├── useLinkAction.ts      # create-on-act + the WhatsApp window (D9)
│   ├── seen.ts               # sessionStorage: names, marks, results (D11)
│   └── PruneNotice.tsx       # the one-time count (D13)
└── cobros/
    └── CobrosScreen.tsx      # the same buttons and the same action (D14)

packages/ui/                  # no new atom expected; StatusBadge and the
                              # existing recipes carry the row

tests/
├── e2e/links.spec.ts         # scroll, 360/768/1280, contrast, target size
├── e2e/stubs.ts              # roster stub → customers stub
└── design/review-links.spec.ts  # the dead /links/search stub goes (D12)
```

**Structure Decision**: the workspace layout is unchanged. This feature lives in
the existing `direct-payments` area of the API, the existing `links` and
`cobros` features of the admin, and adds one module (`apps/api/src/links/`) for
the one-shot prune, which belongs to neither the route nor the provider adapter.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A one-shot pass that **deletes rows**, with a timestamp constant as its boundary | FR-023. The boundary cannot be "when it ran": the previous Worker is still serving during a deploy and would recreate what a migration deleted, and an ongoing rule would delete the links FR-008 has just created (D13) | A migration — races the deploy. A platform endpoint — tells the operator, not the business. An ongoing "delete unused links" rule — deletes the feature's own output |
| The prune deletes links that were **sent and are waiting to be paid** | Devolada records no sending. The creator chose the full cleanup with this cost stated (spec, Clarifications) | Deleting only where the customer is gone, or waiting for delivery states — both offered and declined. Recorded here so a reviewer meets the cost rather than finds it |
| A new table (`link_prunes`) for one row per business | The pass must run once and the business must be told once. Both facts have to live somewhere durable | Reusing `wisphub_sweeps` — its kinds read WispHub; a prune reads nothing. A config flag — cannot carry a per-business count |

## Dependencies and sequencing

1. **The API doors first** (`GET /customers`, `POST /links`) with their schemas.
   Nothing in the admin can be built against a contract that does not exist, and
   the schema is what MSW and Playwright validate fixtures against.
2. **`ensureLink` replaces `ensureLinks`** before the roster goes, so the act has
   a writer while the bulk writer is still there to delete.
3. **The admin's Links screen**, then **Cobros** — Cobros reuses
   `useLinkAction` whole (D14), so it follows rather than leads.
4. **Retirement** (D12) once nothing calls the old doors: the two routes, the
   sweep kind, the adapter methods, the dead Playwright stub.
5. **The prune last** (D13), because it is only safe once the code that stops
   recreating links is live. `PRUNE_CUTOVER_MS` is set to the ship date at this
   step, not before.

**US4 ships with the prune or the prune does not ship.** FR-023 empties the
stored links Cobros reads; without FR-025/FR-026 the collections screen can send
nothing. Steps 3 and 5 are one release.
