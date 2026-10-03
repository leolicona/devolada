import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/* Component layer for the shared atoms (docs/legacy/TESTING.md). No MSW here:
   atoms take props, not network. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    /* One clock for every runner. The atoms print dates in the runner's
       own zone, as the browser does, and a fixture's calendar day moves at
       UTC+12 and beyond: noon UTC on 2 October is already the 3rd in
       Auckland (adversarial review, 2026-10-02). Mexico City, where the
       businesses are. */
    env: { TZ: "America/Mexico_City" },
  },
});
