# Testing rules

## Strategy (in force from the first feature)

The API layer landed with `auth/isp-signup.spec.md` (2026-08-13); every feature ships its scenarios automated as part of its DoD — tests are not a later phase, they are part of development. The component, network and E2E layers land with the first frontend app (no UI surface exists yet). Run with `pnpm --filter @devolada/api test`.

| Layer | Tooling | Where | Covers |
|-------|---------|-------|--------|
| API | Vitest + `@cloudflare/vitest-pool-workers` | `apps/api` | The Hono app running in workerd (the real Workers runtime) with real local D1 — no database mocks. Routes, middleware, ledger invariants. |
| Components | Vitest + React Testing Library + happy-dom | `packages/ui`, apps | Atoms and screens by what the user sees (`getByRole`, visible text), not implementation details. |
| Network | MSW (Mock Service Worker) | frontend apps | Full flows with TanStack Query without a running backend: error states, WispHub queued, loading. Handlers are validated against the API's Zod schemas so mocks can't lie. |
| E2E + accessibility | Playwright + `@axe-core/playwright` | root | Critical charge path against `wrangler dev`, PWA offline mode (`context.setOffline`), automated AA checks. |

Out of scope for now (a decision, not an oversight): Storybook/Chromatic and visual regression — the playground (`pnpm playground`) is the living catalog; visual regression comes post-MVP once the UI stabilizes.

## Rules when writing tests

1. **Every test cites its story**: `describe("US-C02: charges the exact monthly fee", …)`. Spec coverage is traced with grep, not faith.
2. **Money is tested in cents**: never assert on formatted strings except in the formatter's own tests.
3. **The ledger is tested by invariants**: balance = sum of entries; no test may edit/delete ledger entries to build its scenario — it builds them with entries, like production does.
4. **The spec's scenarios are the minimum**: each `.spec.md` lists its scenarios and the DoD is not checked without their automated tests passing.
5. **External integrations** (Agnostic Auth, WispHub, Resend): simulated respecting the contracts in `integrations/*.md`, including their real error shapes (not the official guide's when they differ).
6. **Simulated DOM doesn't verify styles**: assertions about real color/contrast belong to the Playwright+axe layer (or Vitest Browser Mode if ever adopted), not happy-dom.

## Retroactive debt

`auth/sessions.spec.md` was verified with curl before this strategy existed; its 8 scenarios must become API-layer tests when the infrastructure lands (TD-005).
