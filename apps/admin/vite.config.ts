import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  /* No API proxy (shell.spec.md D2): /stores, /settings and /cash-drops
     are SPA routes here, so proxying them would answer a page reload
     with JSON. The app calls the worker directly instead — see
     src/lib/base.ts. */
  server: { port: 5174 },
});
