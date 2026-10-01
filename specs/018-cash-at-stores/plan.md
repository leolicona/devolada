# Implementation Plan: Cash at Stores

**Branch**: `claude/spec-018-cash-at-stores` (spec directory `018-cash-at-stores`) | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/018-cash-at-stores/spec.md`

## Summary

A shopkeeper at a neighbourhood store collects cash for a business's
customer. The payment becomes an ordinary Devolada payment: it is listed
with the SPEI payments, and it runs the same actions in the business's
system. The money stays in the store's drawer until the business confirms
a hand-over.

The plan builds it in seven pieces, each traced to its decisions:

1. **A fifth surface, `apps/red`** (D1, D26). A phone-first app at
   `red.devoladapago.com`, inside this monorepo. It renders the shared
   atoms and imports the API's contracts.
2. **A second kind of actor** (D2–D5). The shopkeeper is a Better Auth
   user who belongs to no business.
   - They are resolved by `requireStore`, from their own `stores` row.
   - They sign in with their phone through Better Auth's `username`
     plugin. Only the acceptance route may write that phone.
   - Business routes refuse them. They can never create a business, and
     never be an operator.
3. **Stores, run by the operator** (D4, D6, D7, D21, D22).
   - A Tiendas tab: stores, hashed invitations sent by WhatsApp,
     suspension, and corrections in a store's cash book.
   - A switch per business, with a capability check and a one-business
     guard that keeps FR-006's deferred decision open.
   - The network fee as one platform setting.
4. **The counter, through capabilities** (D8, D9, D14, D24).
   - `customerSearch` is new. `customerDebt` gains the customer's
     identity. Both are read live.
   - `paymentActions` is new. It pays the action half of the
     `core-reads-provider-directly` debt: the three places that call
     WispHub by name to register and reconnect go through it.
5. **One payment row, one settlement** (D11–D13, D15–D17, D25).
   - A cash payment hangs off the customer's own panel link, with
     `channel: "store"`.
   - The store fee stays outside the debt arithmetic.
   - The settlement code SPEI uses is extracted as `settleConfirmed`, and
     the cash path calls it too.
   - The record is idempotent, answers with a folio at once, and acts in
     the background.
6. **The cash book and hand-overs** (D19, D20). An append-only
   `store_ledger` per store and business, and hand-overs that the store
   declares and the business confirms or disputes.
7. **The business's view** (D23). Cash appears in Pagos with a channel
   filter, and a new *Puntos de pago* page shows each store's cash and
   pending hand-overs.

**One bug lands first** (D10). The action queue retries a payment with
"reconnect" whatever the payment decided, and a short cash payment
depends on that queue. It takes the lite path before the capability work.

**The receipt was settled after /speckit-analyze** (D18 rewritten, D31
added, constitution v1.9.0). The creator chose option B on 2026-10-01:

- The WhatsApp link is addressed to the customer's phone in the
  business's system, read live when the shopkeeper taps *Enviar
  comprobante*, through the existing `customersWithPhone.phoneOf`.
- The phone is never stored: not on the payment row (a cash row's
  `customer_phone` stays null), not per customer.
- When there is no phone, the shopkeeper types one. It builds that one
  link in the app and never reaches the server (FR-027, amended at
  planning).
- The message is a platform template, `store_receipt_template`, with a
  default the operator edits in Reglas (FR-043, D31).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM; Node 22; pnpm 10 workspace

**Primary Dependencies**:
- API: Hono 4 + `@hono/zod-validator`, Drizzle (sqlite), Better Auth 1.6.29 with its `username` plugin added (D3), `@better-auth/passkey`;
- `apps/red`: React 19, Vite 6, Tailwind 4, TanStack Router + Query, `better-auth` client with `passkeyClient`, `@devolada/ui` (`Button`, `Card`, `Amount`, `AmountBreakdown`, `StatusBadge`, `Pending`, `ListError`, `Alert`, `Input`/`Field`), lucide.

**Storage**: D1. One additive migration:
- four new tables: `stores`, `store_invitations`, `store_ledger`,
  `store_handovers`;
- new columns on `user` (the username plugin), `businesses` (the switch)
  and `payments` (store, fee, key);
- no rebuild (data-model).

R2 and Workers AI are untouched.

**Testing**:
- Vitest 3 with `vitest-pool-workers` for the API. WispHub goes through
  `fetchMock` at its origin, with `seedBusiness` and `payer-helpers`'
  WispHub mocks.
- happy-dom + Testing Library + MSW + axe for `apps/red` and
  `apps/admin`.
- Playwright + axe in `tests/e2e`, with red's screens added to the
  contrast and responsive suites.
- One passkey case on red's origin.

**Target Platform**:
- Cloudflare Workers for the API, and assets Workers for `apps/red` (new)
  and `apps/admin`;
- the store app on Android Chrome and iOS Safari at 360px and up;
- the panel desktop-first.

**Project Type**: web. `apps/api`, `apps/admin`, `packages/ui`, and a new
`apps/red`.

**Performance Goals**:
- **SC-001**, from search to folio in under 60 s. A search is one
  provider call (0.4–0.6 s, measured 2026-09-20). A quote is two (≈1 s).
  The record makes the same two reads plus D1 writes, and answers before
  any action (D25).
- **SC-002**, reconnected within 2 minutes on 95% of payments. The first
  attempt runs in `waitUntil` right after the answer, then the
  every-minute sweep takes over.

**Constraints**:
- provider deadlines stay 5 s per call and 12 s per operation
  (`provider-latency` D1);
- the debt is never read from the sweep's snapshot on this path (D14);
- money is integer cents, and the store fee stays outside `settle()`
  (D13);
- the store sees name, usuario and zone, and nothing else (D24).

**Scale/Scope**:
- the pilot is one business, one or two stores, and tens to a few
  hundred collections a month;
- one new app with 9 routes;
- 2 new API areas (`store`, `cash-points`) and one extended
  (`platform`);
- 3 capabilities: 2 new, 1 extended;
- one function extracted from validation (`settleConfirmed`);
- one migration;
- one bug on the lite path first;
- one new debt (`store-cash-no-cap`), and one debt partly paid
  (`core-reads-provider-directly`, its action anchors).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1
design. First checked against v1.7.1, where four gates blocked. Re-checked
2026-10-01 against v1.8.0, which carries amendments 1–3 below, and again
against v1.9.0 (amendment 4, the receipt's phone). Every gate passes.*

**Result: every gate passes under v1.9.0.** Against v1.7.1, four gates
blocked: the Purpose, Principle V, and the stack table's Frontend and Auth
rows with the quality gates. Governance asks the plan to propose the
amendment rather than route around it. Complexity Tracking proposed three,
and the creator ran `/speckit-constitution` on 2026-10-01: constitution
v1.8.0. /speckit-analyze then found the receipt's phone outside V
(finding C1), and the creator's choice became v1.9.0. The rows below say
which amended text each gate now passes against.

| Principle | Gate | Status |
| --- | --- | --- |
| **Purpose** | "collect payments by SPEI and validates every transfer". A cash payment is neither a transfer nor validated by Banxico: the store's word confirms it | ✅ v1.8.0 Purpose |
| I. Spec-driven, decisions cited | Spec → plan → tasks. Every non-obvious rule cites `cash-at-stores D<n>`. The old network's decisions are re-specified, never cited as law. The FR-027 change and the `links-on-demand-search` FR-008 clause are recorded (D11, D18) | ✅ |
| II. Money law | Cents end to end, with two kinds of fee: `store_fee_cents` for the store and the prepaid credit's fee for Devolada. The store fee never enters `settle()` or `classifyPayment()` (D13). Times are in the business's timezone on the receipt (D18). Tolerance is the business's own, unchanged | ✅ |
| III. One contract, pure routers | New `routes/store/`, `routes/cash-points/` and extended `routes/platform/`, each `{index,handler,schema}.ts` with a pure router. Schemas are exported (`./store-schema`, `./cash-points-schema`) and used by MSW and Playwright stubs. One envelope; no `message` or `retryable`. Better Auth's sign-in, OTP and passkey endpoints stay the one exemption (`baPost`) | ✅ |
| IV. Tests on the real runtime | API on workerd with a real D1, WispHub at its origin, and the new capabilities exercised through the adapter. Component tests with MSW and axe. Contrast, touch targets and scroll in Playwright. The passkey ceremony on red's origin (D28) | ✅ |
| **V. Tenant isolation, authorization by area** | (a) "The actor is resolved from Better Auth's membership" does not hold: a store is a non-member actor (D2). (b) "Every business table carries `business_id`": `stores` and `store_invitations` are platform rows without it (D6), while `store_ledger`, `store_handovers` and `payments` carry it. (c) A store reads a business's customers, though narrowly: a typed search returning name, usuario and zone; one debt (D24); and, for a payment it recorded, the phone read live for that receipt, never stored (D18). (d) Authorization by area for the business side: `payments:read` and `payments:operate` (D20, D23) ✅. (e) The invitation token is hashed (D4) ✅ | ✅ v1.9.0 V, store-actor bullet (the receipt's live phone admitted in v1.9.0, D18) |
| VI. Visual foundations | Tokens only. `decisive` 64px for *Cobrar $X*, `standard` 48px touch. The statuses already exist in `StatusBadge` (D23). Waiting labels sit inside `<Pending>`. The floor is 360px with no horizontal scroll. es-MX copy, and the receipt says *pago*, never *cobro* (D18, D27). Light and dark are checked by contrast-lint and the browser layer, both of which now read `apps/red` (D29) | ✅ |
| VII. Every test cites its story | `cash-at-stores US1`–`US5`; the bug's test cites `bug: queue-retry-forgets-action` | ✅ |
| VIII. Absent configuration degrades | `RED_BASE_URL` is declared in `env.ts`. Unset, it has the same meaning as `PAGO_BASE_URL`: the invitation link is built against the local default, and the operator panel warns. Without a capable integration, the switch refuses with a reason (FR-007). A provider outage is an answer on every counter door (D8, D14) | ✅ |
| IX. Core generic, adapters translate | The counter asks by capability (`customerSearch`, `customerDebt`, `paymentActions`), and no new core file imports `wisphub/`. The three existing action call sites move behind `paymentActions`: a debt anchor paid, none added (D9). Contracts say `integration` and `INTEGRATION_*`. The payment row's `wisphub_customer_id` column is an existing, registered leak, filled through the capability's `providerCustomerId` | ✅ |
| **Stack table, Frontend row** | "`apps/admin` (panel) and `apps/pago` (public payment page)". A third React app is a new surface (D1) | ✅ v1.8.0 stack table and gates |
| **Stack table, Auth row** | "email + password with OTP verification, passkeys, organization plugin". The `username` plugin is new (D3) | ✅ v1.8.0 stack table and gates |
| **Quality gates** | "every PR uploads no-traffic preview versions of the four Workers". It becomes five (D29) | ✅ v1.8.0 stack table and gates |
| Migrations additive | All new tables and nullable or defaulted columns; no rebuild. D11 rejects the rebuild on purpose | ✅ |
| One Worker trigger | No new periodic work. Cash rows ride the existing reconnection sweep | ✅ |

**Re-check after Phase 1 design**: unchanged. The data model, contracts and
quickstart add no new departure. Every row that blocked under v1.7.1 is
covered by v1.8.0's text, and
nothing is routed around.

## Project Structure

### Documentation (this feature)

```text
specs/018-cash-at-stores/
├── spec.md
├── plan.md              # this file
├── research.md          # D1–D31, M1–M3
├── data-model.md
├── quickstart.md        # §0 measurements, §1 the bug first, §2 CI, §3 walk on dev
├── contracts/
│   ├── store-api.md            # the shopkeeper's routes
│   ├── platform-stores-api.md  # the operator's stores, switch, corrections
│   └── business-cash-api.md    # Pagos changes, Puntos de pago
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks — not created here
```

### Source Code (repository root)

```text
apps/api/
├── migrations/00NN_cash_at_stores.sql        # additive: 4 tables, user.username, businesses.store_channel_*, payments.store_*
├── src/db/schema.ts                          # stores, store_invitations, store_ledger, store_handovers;
│                                             #   payments.channel enum + store columns; proof_mode enum + "none"
├── src/db/auth-schema.ts                     # user.username, user.display_username (D3)
├── src/env.ts                                # StoreActor, Variables.store, RED_BASE_URL (D2, D4)
├── src/auth/better.ts                        # username(); hooks.before refuses username on public endpoints;
│                                             #   allowUserToCreateOrganization false for a store user (D2, D3)
├── src/auth/middleware.ts                    # requireStore; requireSession refuses a store user (WRONG_ACTOR) (D2)
├── src/folio.ts                              # makeFolio, moved from routes/payments/handler.ts (D17)
├── src/integrations/capabilities.ts          # CustomerSearch, CustomerDebt.customer, PaymentActions (D8, D9)
├── src/integrations/registry.ts              # names and wiring for the two new capabilities
├── src/wisphub/receivables.ts (or actions.ts)# the adapter fills customerSearch, customerDebt.customer, paymentActions
├── src/direct-payments/validation.ts         # settleConfirmed extracted; settlePanelPayment calls it (D13)
├── src/direct-payments/handler.ts (routes)   # attempt budget filters channel = 'spei' (D12)
├── src/direct-payments/provisional.ts        # incident history filters channel = 'spei' (D12)
├── src/credit/index.ts                       # no contradicted-fee reversal for a cash row (D12)
├── src/reconnection/queue.ts                 # paymentActions; the row's decided action on retry (D9, D10)
├── src/store-ledger/index.ts                 # the only writer of store_ledger; held and fees SUMs (D19)
├── src/routes/store/{index,handler,schema}.ts          # invitation, counter, receipt, cash book, hand-overs
├── src/routes/cash-points/{index,handler,schema}.ts    # Puntos de pago (D23)
├── src/routes/platform/{index,handler,schema}.ts       # stores, invitation, ledger, corrections, storeChannel (D4, D7, D21)
├── src/routes/payments/{handler,schema}.ts             # channel filter, storeName, storeFeeCents, corrections;
│                                                       #   retry/execute through paymentActions (D9, D23)
├── src/routes/auth.ts                         # /auth/me answers the store branch
├── src/platform/settings.ts                   # store_fee_cents (D22)
├── src/index.ts                               # mounts /store and /cash-points
├── package.json                               # exports ./store-schema, ./cash-points-schema
├── wrangler.jsonc                             # RED_BASE_URL; ALLOWED_ORIGINS + red origins (D29)
└── test/
    ├── cash-at-stores-access.test.ts          # US3 + D2 refusals
    ├── cash-at-stores-operator.test.ts        # US2
    ├── cash-at-stores-counter.test.ts         # US1
    ├── cash-at-stores-business.test.ts        # US4
    ├── cash-at-stores-handover.test.ts        # US5
    └── store-helpers.ts                       # seedStore, storeSession, mockCustomerSearch

apps/red/                                      # new (D1, D26)
├── package.json, vite.config.ts (port 5177), tsconfig.json, components.json, index.html
├── wrangler.jsonc                             # devolada-red[-dev], red[.dev].devoladapago.com
├── public/manifest.webmanifest, icons
├── src/{main.tsx,router.tsx,styles.css}
├── src/lib/{api.ts,auth-client.ts}            # credentials: include; passkeyClient
├── src/features/auth/                         # Entrar, Recuperar, Invitación, session, WRONG_ACTOR and suspended screens
├── src/features/counter/                      # Cobrar (search), Cobro (quote + amount), Cobros/:id (outcome + receipt)
├── src/features/cashbox/                      # Mi caja, Entrega, Movimientos
├── src/layout/TabLayout.tsx                   # three tabs, offline banner
└── test/                                      # setup, msw, a11y, one file per feature citing US<n>

apps/admin/
├── src/features/auth/                         # WRONG_ACTOR screen for a store account (D2)
├── src/features/shell/Shell.tsx               # Puntos de pago when storeChannel.since (D23)
├── src/features/feed/FeedScreen.tsx           # channel chip; "Efectivo · <tienda>"; store fee; corrections
├── src/features/cash-points/                  # new: Puntos de pago, confirm dialog, dispute
├── src/features/operator/                     # Tiendas tab (new); switch in BusinessDetail; KEY_LABELS += store_fee_cents
├── src/router.tsx                             # /puntos-de-pago
└── test/                                      # cash-points, feed channel, operator stores, wrong actor

tests/e2e/{stubs.ts,contrast.spec.ts,responsive.spec.ts}   # stubRedApi; red and Puntos de pago screens
tests/passkey/                                 # one case on red's origin
playwright.config.ts                           # RED_PORT 4177
scripts/{pending-lint.mjs,contrast-lint.mjs}   # + apps/red/src
.github/workflows/{ci,deploy-dev,deploy-prod,rollback-prod}.yml   # the fifth Worker (D29)
.specify/memory/constitution.md                # amendments 1–3, via /speckit-constitution
.specify/debt/store-cash-no-cap/               # via /speckit-debt-log (D30)
.specify/debt/core-reads-provider-directly/    # note: action anchors paid (D9)
.specify/bugs/queue-retry-forgets-action/      # the lite path, first (D10)
CLAUDE.md                                      # five Workers; red dev command
```

**Structure Decision**: the existing web layout, plus one app. `apps/red`
sits beside `apps/pago` and `apps/admin`, built the same way as an
assets-only Worker. The API keeps one resource folder per area: the
shopkeeper's area is `store`, and the business's view is `cash-points`.
The ledger's single writer is a module of its own, `store-ledger/`, as
`credit/` is for the prepaid credit.

## Complexity Tracking

Three amendments, proposed for `/speckit-constitution` as v1.8.0 (MINOR),
and applied on 2026-10-01 in the texts below.
They materially expand the Purpose, Principle V and the stack table. No
principle is removed, redefined or renumbered.

| Departure | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| **1. Purpose** | Cash at a store is a second way to collect, and its truth is the store's word, not Banxico's | **Proposed text**, after "validates every transfer": *"A business may also collect in cash at a store of the network Devolada runs. There the store's word confirms the payment and the business confirms each hand-over of the cash. The money never touches Devolada either way."* **Rejected**: running the network as a separate product (spec clarifications, 2026-09-30), and leaving the Purpose silent (Governance: no tolerated gap) |
| **2. Principle V** | A store is the first actor that is not a member of a business, and it reads a narrow slice of a business's customers | **Proposed new bullet**: *"A store is the one actor that is not a member of a business. It is resolved from its own record, never from a membership. It reaches only the businesses the platform operator switched the cash channel on for, and of their customers only what a typed search returns (name, usuario, zone) and one customer's debt. `stores` and `store_invitations` are platform rows without `business_id`; every movement of a business's money (payment, cash book, hand-over) carries it."* The first bullet's "Every business table" stays true: a store is not a business table. **Rejected**: a store as an organization with a role (D2), which would blur the one boundary V protects |
| **3. Stack table and gates** | A third React surface, a sign-in plugin, and a fifth Worker | **Proposed edits**: Frontend row adds *"and `apps/red` (the shopkeeper's app, phone-first)"*; Auth row adds *"`username` plugin for the shopkeeper's phone sign-in"*; the gates bullet says *"the five Workers"*. CLAUDE.md follows. **Rejected**: the store screens inside the panel (D1) |
| **4. Principle V, the receipt's phone** (applied as v1.9.0, 2026-10-01) | /speckit-analyze C1: the receipt's WhatsApp link carries the customer's phone, which v1.8.0 did not let a store see. The creator chose to address the receipt to it | **Applied text**: the store sees *"three things: what a typed search returns (name, usuario, zone); one customer's debt; and, for a payment it recorded, that customer's phone. The phone is read from the business's system when the receipt is sent, used only to address that receipt, and never stored."* **Rejected**: never using the system's phone (option A); keeping typed numbers (option C) |
