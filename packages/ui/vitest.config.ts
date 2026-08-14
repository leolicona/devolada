import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/* Component layer for the shared atoms (docs/TESTING.md). No MSW here:
   atoms take props, not network. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
  },
});
