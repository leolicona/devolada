# Implementation Plan: Provider Address per ISP

**Branch**: `007-provider-address-per-isp` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-provider-address-per-isp/spec.md`

## Summary

Move the provider's address from the platform to the business. Today one
deploy-time setting names one installation for every tenant at once, so an ISP
hosted elsewhere cannot connect and serving them cuts off everyone else.

The approach: the business row stores an installation **key**, not a URL
(research D1), resolved through a small compiled-in catalogue that both the
API and the admin import (D2, D3). One factory builds every provider client, so
"each business reaches its own installation" is a structure rather than a
convention (D4). The existing platform binding stops overriding and becomes the
fallback for rows that chose nothing, which is how every current business
carries over untouched (D5).

The connection test grows from one code to four outcomes, each naming the
installation it tried — the change that stops the panel blaming a valid key
for a wrong address.

## Technical Context

**Language/Version**: TypeScript 5, Node 22, pnpm 10 workspace

**Primary Dependencies**: Hono 4, Drizzle, zod, Better Auth (API); TanStack
Router + Query, Tailwind with `@devolada/ui` tokens (admin). No new dependency.

**Storage**: Cloudflare D1. One additive nullable column on `integrations`
(`installation TEXT`), one migration, no backfill.

**Testing**: `@cloudflare/vitest-pool-workers` in workerd against a real local
D1 for the API; happy-dom + Testing Library + MSW for the admin; Playwright +
axe for the browser layer. Providers intercepted at their real origin with
`fetchMock`; this feature adds a **second** intercepted origin (D8).

**Target Platform**: Cloudflare Workers (`apps/api`), assets Worker
(`apps/admin`).

**Project Type**: multi-app pnpm workspace — Workers API + two SPAs + a shared
UI package.

**Performance Goals**: unchanged. The resolution adds one in-memory catalogue
lookup per provider client; no extra network call, no extra query — the
`integrations` row is already loaded on every path that builds a client.

**Constraints**: the provider's existing deadlines stand (5 s per call, 12 s
per operation, `provider-latency D1`). The admin picker must render at the
360px floor and satisfy the token and target-size rules (constitution VI).

**Scale/Scope**: three catalogue entries; 11 provider call sites to route
through one factory; one column; one screen section; four new API-layer tests
plus one component test.

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1 design.*

| Principle | Gate | Verdict |
| --- | --- | --- |
| **I. Spec-Driven, Every Decision Cited** | spec → plan → tasks → implement, under `specs/007-*`; every non-obvious rule cites `provider-address-per-isp D<n>` | **Pass.** Spec and this plan are committed. Each new rule in code cites a D-number from `research.md`. |
| **II. Money Law** | integer cents, string-parsed provider decimals, business timezone | **Pass, not engaged.** This feature moves an address. It touches no amount, no conversion and no timestamp. |
| **III. One Contract, Pure Routers** | one envelope, `UPPER_SNAKE` codes, `index.ts` pure, schema exported and shared | **Pass.** The four test outcomes are *data* on a successful response, not error codes — `testWisphubKey` already answers 200 either way (settings D2). Logic stays in `handler.ts`; `installations.ts` is exported from `@devolada/api` and consumed by the admin. |
| **IV. Tests Run on the Real Runtime** | workerd + real D1, no DB mocks, providers intercepted at their real origin, config pins the origin | **Pass, and strengthened.** The pin in `vitest.config.ts` stays. Storing a key rather than a URL (D1) is what keeps it meaningful: no database row can name an origin outside the compiled catalogue. A second intercepted origin is added to prove isolation (D8). |
| **V. Tenant Isolation and Authorization by Area** | `business_id` on every row, every query filtered, area+action authorization, credential stored as the row's trust allows, auditable with grep | **Pass.** `installation` rides the existing per-business `integrations` row. Authorization is the existing `integrations: ["manage"]` — no role-matrix change. The factory (D4) makes "every call reaches the actor's own installation" a one-line grep, which is the auditability this principle asks for. |
| **VI. Visual Foundations** | semantic tokens only, declared sizes, status never colour alone, shared atoms before new ones | **Pass, with work.** The picker uses an existing shadcn primitive themed with tokens; the test-installation badge is `StatusBadge` (icon + text, never colour alone). No new atom is expected; if one is needed it belongs in `packages/ui`, not in the admin. |
| **VII. Every Test Cites Its Story** | every test file cites `<feature-slug> US<n>` | **Pass.** New test files cite `provider-address-per-isp US1/US2/US3`; tasks carry their `[US<n>]` label. |
| **VIII. Absent Configuration Degrades, Never Breaks** | every binding documents "unset", absent config degrades loudly, never throws at the edge | **Pass, and improved.** `WISPHUB_BASE_URL` keeps its comment and gains a clearer meaning: default, not override (D5). An unknown installation key resolves to the default rather than throwing. A business on an unreachable installation still receives and validates payments; only the provider action waits (FR-012). |

**One gap, named rather than routed around** — see *Complexity Tracking*:
FR-011 as written cannot be met read-only. Research D7 proposes the amendment
and the plan implements the honest version.

## Project Structure

### Documentation (this feature)

```text
specs/007-provider-address-per-isp/
├── spec.md                      # what and why (committed)
├── plan.md                      # this file
├── research.md                  # Phase 0 — D1..D8
├── data-model.md                # Phase 1 — the column, the catalogue, the resolution rule
├── quickstart.md                # Phase 1 — how to prove it, and the debt it pays
├── contracts/
│   └── integrations.md          # Phase 1 — the zod contract and what the admin reads
├── checklists/
│   └── requirements.md          # 16/16
└── tasks.md                     # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
apps/api/
├── migrations/
│   └── NNNN_integration_installation.sql   # ALTER TABLE … ADD COLUMN installation TEXT
└── src/
    ├── db/schema.ts                        # + integrations.installation, with its D-citation
    ├── env.ts                              # WISPHUB_BASE_URL comment: default, not override (D5)
    └── wisphub/
        ├── installations.ts                # NEW — the catalogue, pure data (D2, D3)
        ├── factory.ts                      # NEW — wisphubFor(integration, env) (D4)
        └── client.ts                       # unchanged behaviour; constructor no longer called directly
    └── routes/integrations/
        ├── schema.ts                       # + installation, effectiveInstallation, the four outcomes
        └── handler.ts                      # test against the installation being saved (FR-009)

apps/api/test/
├── installations.test.ts                   # catalogue invariants (D2) — replaces a generator
├── integrations-installation.test.ts       # US1, US2 — save, resolve, the four outcomes
└── installation-isolation.test.ts          # US3 — two origins, and the negative assertion (D8)

apps/admin/
├── src/features/integrations/WispHubScreen.tsx   # the picker, the resolved installation, the new messages
└── test/integrations.test.tsx                    # US1, US2 at the component layer

apps/api/package.json                        # + "./installations" export
apps/api/wrangler.jsonc                      # the stopgap bindings come OUT (quickstart, release)
```

**Structure Decision**: no new app, no new package. The feature lives where the
integration already lives — `apps/api/src/wisphub/` for the catalogue and the
factory, `routes/integrations/` for the contract and the handler, one admin
screen. The catalogue is exported from `@devolada/api` because the admin
renders it, which is the same arrangement `role-matrix.ts` already has and for
the same stated reason (constitution V).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **FR-011 cannot be met as written**: a connection is required to prove the credential can perform *every* action, but four of the seven are writes into a real ISP's live billing. | The alternative is writing test invoices and test payments into a production billing system to check a permission — worse than the problem it detects. `OPTIONS` was considered and does not close it: the most important write (`registrar-pago`) answers 500 to `OPTIONS`, and whether `OPTIONS` varies by key permission is unverified because this session's egress blocks both provider hosts. | Silently reporting "healthy" after checking only reads is what the product does **today**, and it is the failure mode that let a read-only key look fine until money arrived. The plan implements the honest version instead: verify the three reads, name the four writes as unverified on the screen, and let the first real payment exercise them where the queue already shows the outcome. **This asks for FR-011 to be amended** (research D7), per governance — a blocked requirement's plan proposes the amendment rather than routing around it. |
| **A second intercepted origin in the API suite** where the config pins one. | US3's promise is that two businesses reach two installations and neither reaches the other's. A single origin cannot express the negative assertion that catches a missed call site. | Asserting only that business A reaches origin A is the weak half of the test and would pass with the bug present. The pin is not weakened: it still names the platform default, and D1's catalogue bounds what any row can name, so neither config nor data can redirect the suite somewhere unexpected. |

## Dependencies and sequencing

- **Before implementing**: one `curl` against `api.wisphub.io` with a real key.
  The catalogue ships that host; it is DNS-confirmed only, and shipping a wrong
  entry leaves the pilot exactly where they are today (quickstart, last
  section).
- **Not in the same week**: `.specify/bugs/customer-lookup-misses`. It edits
  `apps/api/src/wisphub/client.ts`, which this feature also touches, and it is
  the more urgent of the two if the pilot's usuarios turn out to lack `@`.
- **Same release, not later**: removing `WISPHUB_BASE_URL` from both wrangler
  environments. Until it is gone the platform default still overrides every
  business that recorded nothing, which is the debt this feature was written to
  pay (D5, quickstart).
