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
  /* Worktree rule: own port per app (CICD.md). 5173 tienda, 5174 admin. */
  server: { port: 5175 },
});
