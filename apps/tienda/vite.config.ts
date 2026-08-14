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
  server: {
    port: 5173,
    /* Same-origin cookies in dev: /auth and /dev ride through to wrangler (spec D2) */
    proxy: {
      "/auth": "http://localhost:8787",
      "/dev": "http://localhost:8787",
    },
  },
});
