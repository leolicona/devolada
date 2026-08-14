import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    /* Same-origin cookies in dev: /auth and /dev ride through to wrangler (spec D2) */
    proxy: {
      "/auth": "http://localhost:8787",
      "/dev": "http://localhost:8787",
    },
  },
});
