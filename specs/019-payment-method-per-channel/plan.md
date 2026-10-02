# Implementation Plan: payment-method-per-channel

**Branch**: `claude/spec-019-devolada-as-collector` | **Date**: 2026-10-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/019-payment-method-per-channel/spec.md`

## Summary

A business must be able to tell, in its own system, which payments came
through Devolada, and filter and download them there (spec US1–US2). The
WispHub adapter records every payment with the payment method of its
channel — `SPEI - LINK.DEVOLADAPAGO` for SPEI, `CASH - RED.DEVOLADAPAGO`
for the whole store network — which the business creates once in its
WispHub with those exact names. It writes a reference that ties each
record back to Devolada (`folio · clave`, `folio · tienda`, US3). When a
method does not exist, or the provider refuses it, the payment records
with the business's cash method, as today, and the action never waits
(FR-004). The cash method itself can never be one of Devolada's names
(FR-012): measured on the demo, today's rule would take
`CASH - RED.DEVOLADAPAGO` (R11). The WispHub screen and *Probar conexión*
show whether each method exists, with its name and description ready to
copy (US4). Turning on automatic execution requires the methods of the
business's channels (FR-013): a business collects from the connection on,
in observation mode, and Devolada starts writing in its system only once
the methods exist, and never before the business has connected.
Devolada never turns an execution off (D14). A method Devolada has seen —
on the screen, in the test, at the gate — is used by the next payment
wherever it is recorded (FR-014, D16).

The increment lives in the adapter (FR-011, constitution IX). The core's
only change is to hand the adapter the payment's channel and the parts of
its reference through the capability it already calls
(`paymentActions.attempt`, D2). One additive column on the integration row
(D16), no table, no new trigger.

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM; Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4 + `@hono/zod-validator`, Drizzle ORM, zod;
React 19, TanStack Query, `@devolada/ui` (admin)

**Storage**: D1 — reads `payments.channel`, `folio`, `tracking_key`,
`store_id` → `stores.name`, `businesses.store_channel_on`; one additive
nullable column, `integrations.payment_methods_seen_at` (D16); the Cache
API for the provider's method list (ten minutes, per business, address
and seen stamp)

**Testing**: Vitest in workerd (`vitest-pool-workers`, real D1, WispHub
at its origin with `fetchMock`); happy-dom + Testing Library + MSW + axe
for the admin

**Target Platform**: Cloudflare Workers (`apps/api`, `apps/admin`)

**Project Type**: web service + web panel, in the existing monorepo

**Performance Goals**: no extra provider call per recording in the common
case — the list read replaces today's cash-method read and shares its
cache (D3); one extra call only when the provider refuses a method (D6)

**Constraints**: the reference ≤ 200 characters (R7); the method list is
read-only through the API (R6, FR-010); a method created in the panel is
used within ten minutes (D3); WispHub's facts stay inside
`apps/api/src/wisphub/`

**Scale/Scope**: every business with the WispHub integration; the pilot
first. Three call sites, one adapter module, one route, one guard on the
existing execution switch, one screen block, three badge statuses

All of it was known before the plan: the spec closed M1–M4 (R8–R13) on
2026-10-02. No NEEDS CLARIFICATION.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Verdict |
| --- | --- | --- |
| I. Spec-driven, decisions cited | Spec → plan → tasks; every rule in code cites `payment-method-per-channel D<n>`, the measured ones with their date (R8–R13, 2026-10-01/02) | PASS |
| II. Money law | No amount changes. `total_cobrado` keeps today's cents conversion; the reference carries no amount | PASS |
| III. One contract, pure routers | The new read is `routes/integrations/{index,handler,schema}.ts`; the router stays pure; the block is a zod schema exported through `@devolada/api/integrations-schema` and validates the admin's MSW fixtures; the gate lives in the handler and answers with two new `UPPER_SNAKE` codes (`PAYMENT_METHODS_MISSING`, `PAYMENT_METHODS_UNCHECKED`) in the one envelope, no `message` on a browser route | PASS |
| IV. Tests on the real runtime | API suite in workerd with a real D1; WispHub intercepted at its origin; assertions on the `registrar-pago` body (D13). The screen block in the component layer with axe. No browser-layer change: the block uses existing atoms and tokens | PASS |
| V. Tenant isolation, authorization by area | The setup read is `requireArea("integrations", "manage")`, like the hub; the method list is cached per business and address; the store's name is read for the payment's own `store_id`, which carries `business_id`. The reference carries nothing about the payer (FR-007) | PASS |
| VI. Visual foundations | Three statuses join `StatusBadge` (icon + text, tones from tokens); method names in JetBrains Mono; the waiting label inside `<Pending>`; es-MX copy | PASS |
| VII. Every test cites its story | `payment-method-per-channel US1`–`US4` on every new test; tasks carry `[US<n>]` | PASS |
| VIII. Absent config degrades | A missing method degrades to cash, as today, and the screen says so as a setup step; an unreachable provider reads `checked: false`, never "missing" (FR-009). The gate (D14) guards only the act of turning execution on: collecting never waits on it, and nothing working is ever turned off — not at the release, not when a method disappears. No new binding or secret | PASS |
| IX. Core generic, adapters translate | Names, the list, the choice rule, the normalization, the reference's format and limit, and the 400 fallback all live in `wisphub/` (D1, D3–D7). The core passes `channel` and `recordReference` in its own words (D2) and names no method. The new route and the gate are the WispHub integration's own setup, where the provider's name may appear; the handler asks the adapter and builds no path. Only the capability entry point and the integration's own setup routes reach the adapter — the rule recorded in the debt `core-reads-provider-directly` ("Confirm on the tree"). The adapter reads the seen stamp from the row its caller holds and never writes a core row (D16). Collecting, the core's own feature, does not depend on the methods (FR-013). No new leak. The existing debt `core-reads-provider-directly` is untouched: the three call sites already reach the adapter through the capability (`cash-at-stores` D9) | PASS |
| Stack & constraints | No new dependency; one additive migration (D11, D16), safe for the per-PR preview against the live dev database; no new trigger — the queue sweep is the existing one | PASS |

**Post-design re-check** (after research, data model and contracts): no
change. The contracts add one in-process type widening, one browser
route, one field on an existing response, one guard with two error codes
on an existing patch, and three badge statuses — all inside the gates
above. Complexity Tracking stays empty.

**Revision 2026-10-02** (the creator's decisions after the first plan:
the execution gate and the descriptions, D14 and D15): re-checked; every
gate still passes.

**Revision after `/speckit-analyze`** (2026-10-02): execution needs a
saved key (D14); the setup reads stamp the integration and the cache key
carries the stamp (D16, the creator's choice of an exact switch-over),
which brings one additive column; FR-005's other recording paths and the
connection test's failed probe are specified. Re-checked: every gate
still passes.

## Project Structure

### Documentation (this feature)

```text
specs/019-payment-method-per-channel/
├── spec.md
├── plan.md              # this file
├── research.md          # D1–D16
├── data-model.md        # no migration; what is read; the widened type
├── quickstart.md        # automated proof, demo check, rollout order
├── contracts/
│   ├── action-attempt.md                 # core → adapter (D2)
│   ├── wisphub-recording.md              # adapter → WispHub (D3–D7)
│   └── integrations-payment-methods.md   # setup read, test block, screen (D8)
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks — not created here
```

### Source Code (repository root)

```text
apps/api/src/
├── db/schema.ts                      # integrations.payment_methods_seen_at (D16), and its generated migration in apps/api/migrations/
├── integrations/capabilities.ts      # ActionAttemptInput gains channel + recordReference (D2)
├── direct-payments/record-reference.ts  # NEW: storeNamesFor, recordReferenceOf (D2, D10)
├── wisphub/
│   ├── payment-methods.ts            # NEW: the two names and descriptions, normalize, choose, reference, setup block (D1, D4, D5, D7, D8, D15)
│   ├── client.ts                     # list all methods (paged); registerPayment sends referencia; WispHubError keeps a 400's field names (D6)
│   ├── cache.ts                      # cashPaymentMethodId → paymentMethods (the list), keyed also by the seen stamp; drop on refusal (D3, D6, D16)
│   ├── reconnection.ts               # attemptReconnection picks the channel's method, falls back once on a forma_pago 400 (D4, D6, D9)
│   ├── actions.ts                    # passes the new input and the row's seen stamp through
│   └── receivables.ts                # wisphubCapabilities takes the integration with its seen stamp
├── direct-payments/validation.ts     # settleConfirmed fills channel + recordReference (folio, clave, store name)
├── routes/payments/handler.ts        # dispatchObserved fills them (Ejecutar ahora, the held accept)
├── reconnection/queue.ts             # the sweep fills them; store names read once per batch (D10)
└── routes/integrations/
    ├── index.ts                      # GET /wisphub/payment-methods
    ├── handler.ts                    # the read and the probe (both stamp, D16); patchWisphub's gate on turning execution on (D14)
    └── schema.ts                     # devoladaMethods; wisphubTestResponse.devoladaMethods

apps/api/test/
└── payment-method-per-channel.test.ts   # NEW (D13)

apps/admin/
├── src/features/integrations/WispHubScreen.tsx   # the block after the connection card; the Ejecución switch's gate and refusal copy (D14)
└── test/payment-method-per-channel.test.tsx       # NEW: the block and the switch (D13); integrations.test.tsx gains a handler for the new read

packages/ui/src/components/status-badge.tsx   # methodFound, methodMissing, methodDuplicate
```

**Structure Decision**: the existing monorepo layout. The adapter work is
in `apps/api/src/wisphub/`; the core touches only the three call sites
that already call the capability and the capability's input type; the
setup surface is the WispHub integration's own route and screen.

## Complexity Tracking

None. No principle is broken, so nothing needs justifying.
