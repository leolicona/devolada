import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /* The alias the shadcn CLI writes into generated primitives */
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  /* No API proxy (shell.spec.md D2): /cashbox, /ledger and /charges/:id
     are SPA routes here, so proxying them would answer a page reload
     with JSON. The app calls the worker directly instead — see
     src/api/base.ts. */
  server: { port: 5173 },
});
