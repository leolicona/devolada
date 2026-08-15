import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/* Screenshot capture for the design review. Same servers and stubs as the
   e2e suite; a separate testDir so `pnpm e2e` never writes images. */

export default defineConfig({
  ...base,
  testDir: "./tests/design",
  retries: 0,
  reporter: "list",
});
