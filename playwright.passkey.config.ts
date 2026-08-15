import { defineConfig, devices } from "@playwright/test";

/* Scenario 9 of better-auth.spec.md (US-S07): the passkey ceremony needs
   a REAL API — WebAuthn challenges are minted and verified server-side —
   so unlike the responsive layer this config boots wrangler + D1 and
   builds the admin against it. Port 5174 because the API's local
   ALLOWED_ORIGINS (and so Better Auth's trustedOrigins and the passkey
   origin list) already trusts it. rpID is localhost (spec D7). */

const API_PORT = 8794;
const ADMIN_PORT = 5174;

export const API = `http://localhost:${API_PORT}`;
export const ADMIN = `http://localhost:${ADMIN_PORT}`;

export default defineConfig({
  testDir: "./tests/passkey",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { trace: "on-first-retry" },
  /* Virtual authenticator is CDP: chromium only */
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `pnpm --filter @devolada/api db:migrate:local && pnpm --filter @devolada/api exec wrangler dev --port ${API_PORT} --local`,
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
  ],
});
