import { defineConfig, devices } from "@playwright/test";

/* Layer 4 of docs/TESTING.md: the questions a simulated DOM cannot
   answer. happy-dom applies no stylesheet and reports no layout, so
   touch-target size, breakpoint behaviour and real colour contrast all
   waited for a browser. This is that browser.

   Both apps are served as built static bundles; the API is stubbed per
   test with route interception. For the responsive pass what matters is
   geometry, not backend truth — and a static preview starts in seconds
   instead of booting wrangler, D1 and the IdP. */

const TIENDA_PORT = 4173;
const ADMIN_PORT = 4174;
const PAGO_PORT = 4175;

export const TIENDA = `http://localhost:${TIENDA_PORT}`;
export const ADMIN = `http://localhost:${ADMIN_PORT}`;
export const PAGO = `http://localhost:${PAGO_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: { trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      /* Build here so `pnpm e2e` works from a clean checkout: CI has
         no dist/ yet, and a stale one would test yesterday's UI. */
      command: `pnpm --filter @devolada/tienda build && pnpm --filter @devolada/tienda preview --port ${TIENDA_PORT} --strictPort`,
      url: TIENDA,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @devolada/admin build && pnpm --filter @devolada/admin preview --port ${ADMIN_PORT} --strictPort`,
      url: ADMIN,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      /* The customer's page joins the browser layer because the values it
         asks people to proofread are long enough to run out of a phone
         (BUG-009), and no simulated DOM can measure that. */
      command: `pnpm --filter @devolada/pago build && pnpm --filter @devolada/pago preview --port ${PAGO_PORT} --strictPort`,
      url: PAGO,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
