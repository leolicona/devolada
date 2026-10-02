import { defineConfig, devices } from "@playwright/test";

/* Scenario 9 of better-auth.spec.md (US-S07): the passkey ceremony needs
   a REAL API — WebAuthn challenges are minted and verified server-side —
   so unlike the responsive layer this config boots wrangler + D1 and
   builds the admin against it. Port 5174 because the API's local
   ALLOWED_ORIGINS (and so Better Auth's trustedOrigins and the passkey
   origin list) already trusts it. rpID is localhost (spec D7). */

const API_PORT = 8794;
const ADMIN_PORT = 5174;
/* cash-at-stores T043: red on its dev port — the one the API's local
   ALLOWED_ORIGINS (and so the passkey origins) and RED_BASE_URL name */
const RED_PORT = 5177;

export const API = `http://localhost:${API_PORT}`;
export const ADMIN = `http://localhost:${ADMIN_PORT}`;
export const RED = `http://localhost:${RED_PORT}`;
/* cash-at-stores T043: the store case creates a store the way the
   operator does, so the demo account is this harness's operator — pinned
   here, like the suites pin their secrets, never read from a .dev.vars */
export const OPERATOR_EMAIL = "demo@devolada.app";

export default defineConfig({
  testDir: "./tests/passkey",
  fullyParallel: false,
  /* passwordless-access D14: one journey at a time. They share one API and
     the demo account, and `POST /dev/code` mints the demo's código fresh,
     replacing the live one — two journeys signing the demo in at once
     would void each other's código. */
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { trace: "on-first-retry" },
  /* Virtual authenticator is CDP: chromium only */
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      /* passwordless-access D3: the limiter off — the journeys ask several
         códigos a minute from one address, and three a minute is the
         door's rule; the limiter's proof is the API suite's
         (rate-limit.test.ts) */
      command: `pnpm --filter @devolada/api db:migrate:local && pnpm --filter @devolada/api exec wrangler dev --port ${API_PORT} --local --var PLATFORM_OPERATOR_EMAILS:${OPERATOR_EMAIL} --var AUTH_RATE_LIMIT:off`,
      url: `${API}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `VITE_API_URL=${API} pnpm --filter @devolada/admin build --outDir dist-passkey && pnpm --filter @devolada/admin preview --outDir dist-passkey --port ${ADMIN_PORT} --strictPort`,
      url: ADMIN,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `VITE_API_URL=${API} pnpm --filter @devolada/red build --outDir dist-passkey && pnpm --filter @devolada/red preview --outDir dist-passkey --port ${RED_PORT} --strictPort`,
      url: RED,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
