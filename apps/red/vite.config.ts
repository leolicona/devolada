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
  /* Own port per app: 5174 admin, 5175 pago, 5176 landing, 5177 the
     store app (cash-at-stores D29). No API proxy: SPA routes and API
     paths share names (`/store/…`), so the app calls the Worker
     directly — src/lib/base.ts. */
  server: { port: 5177 },
});
