import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/* Component + network layers (docs/TESTING.md): Testing Library on
   happy-dom, network mocked with MSW honoring the API's envelope. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
  },
});
