# Testing rules

## Strategy (in force from the first feature)

The API layer landed with `auth/isp-signup.spec.md` and the component + network layers with `store-pwa/shell.spec.md` (both 2026-08-13); every feature ships its scenarios automated as part of its DoD — tests are not a later phase, they are part of development. The E2E + accessibility layer (Playwright + axe) lands once there is a deployed charge flow worth traversing. Run everything with `pnpm -r --if-present test`.

| Layer | Tooling | Where | Covers |
|-------|---------|-------|--------|
| API | Vitest + `@cloudflare/vitest-pool-workers` | `apps/api` | The Hono app running in workerd (the real Workers runtime) with real local D1 — no database mocks. Routes, middleware, money invariants. |
| Components | Vitest + React Testing Library + happy-dom | `packages/ui`, apps | Atoms and screens by what the user sees (`getByRole`, visible text), not implementation details. |
| Network | MSW (Mock Service Worker) | frontend apps | Full flows with TanStack Query without a running backend: error states, WispHub queued, loading. Handlers are validated against the API's Zod schemas so mocks can't lie. |
| E2E + accessibility | Playwright + `@axe-core/playwright` | root (`tests/e2e/`) | **Landed 2026-08-14** (`polish/responsive.spec.md`): breakpoints and touch-target geometry, real colour contrast in light and dark, against built previews with the API stubbed. Runs on deploy-dev (CICD D3), `pnpm e2e` locally. Still to come: the payment path against `wrangler dev`. |

Out of scope for now (a decision, not an oversight): Storybook/Chromatic and visual regression — the playground (`pnpm playground`) is the living catalog; visual regression comes post-MVP once the UI stabilizes.

## Rules when writing tests

1. **Every test cites its story**: `describe("US-D03: a valid transfer becomes a charge and reconnects", …)`. Spec coverage is traced with grep, not faith.
2. **Money is tested in cents**: never assert on formatted strings except in the formatter's own tests.
3. **Append-only money tables are tested by invariants**: a derived balance = sum of entries, and no test may edit/delete rows to build its scenario — it builds them with entries, like production does. (Born with the store ledger, now in `devolada-red`; it returns with the pivot's `credit_entries`.)
4. **The spec's scenarios are the minimum**: each `.spec.md` lists its scenarios and the DoD is not checked without their automated tests passing.
5. **External integrations** (Agnostic Auth, WispHub, Resend): simulated respecting the contracts in `integrations/*.md`, including their real error shapes (not the official guide's when they differ).
6. **Simulated DOM doesn't verify styles**: assertions about real color/contrast belong to the Playwright+axe layer (or Vitest Browser Mode if ever adopted), not happy-dom.
7. **Async waits are a ceiling of 5s, not the 1s default** (`configure({ asyncUtilTimeout })` in each app's `test/setup.ts`). Test files run in parallel and the first render in each pays the transform + router cost, which passes 1s on a loaded machine — with the default, whichever file lost the race failed, and which one that was changed run to run (real case 2026-08-14: adding one file to `apps/tienda` broke three unrelated ones, each of which passed alone in 119ms). Raising the ceiling does not slow a passing test or hide a broken query; it only stops the CPU race from deciding the result. If a test genuinely needs to wait 5s for data, that is the test to fix.
8. **A mocked origin is pinned, never inherited.** The Workers test pool loads each app's `.dev.vars` through `wrangler.configPath`, so any base URL a developer sets for local work reaches the tests too. Every provider base the suite intercepts is therefore bound explicitly in `vitest.config.ts` and asserted in `test/setup.ts`, which fails with the cause named instead of "mock dispatch not matched" (real case 2026-08-17: `apps/consta`'s whole provider suite failed on the machine running the local apiCEP sandbox, and only there). A provider base a test passes in itself (Consta's, in `apps/api`) needs no pin — it never comes from the environment.
9. **Travel from the origin screen, don't mount the destination.** A screen that is reached by tapping something must have at least one test that starts on the previous screen and taps. Mounting a route directly with hand-written params tests the screen but not the link — and the link is where the wrong identifier hides (real case 2026-08-14: search cards linked with the numeric WispHub id while the quote endpoint loads by `usuario`; every unit test passed, the deployed app was broken).

10. **Module-state caches are reset per test, in `setup.ts`, not per file.** `singleWorker` gives the whole API suite one runtime, so anything cached in module scope outlives the test that filled it — and a suite that counts provider calls then passes or fails depending on which file ran first. The provider caches (`src/wisphub/cache.ts`, provider-latency.spec.md D3/D5) are cleared in a global `beforeEach`, the same way D1 gets isolated storage: a test starts from empty or it is not a test.
11. **Interceptor counts are an assertion, so leave them exact.** `fetchMock.assertNoPendingInterceptors()` fails when a mocked provider call never happens, which is how a change in caching or call ordering announces itself. Resist the temptation to silence it with `.persist()` — persisted interceptors still count as pending in the pooled mock agent, and a mock that tolerates any number of calls stops describing the flow. When the real call count changes, change the mocks and say why in a comment (real case 2026-08-18: three tests dropped mocks for calls the new caches serve).

## Retroactive debt

`auth/sessions.spec.md` was verified with curl before this strategy existed; its 8 scenarios must become API-layer tests when the infrastructure lands (TD-005).
