import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

/* The landing page (landing-page D1): static output and no adapter — every
   word is HTML before any script runs, and the page reads when the product
   is down. `site` is set by CI per environment through PUBLIC_SITE_URL (D14)
   so canonical and Open Graph URLs name the host that serves them.

   D2: the shared atoms from @devolada/ui render here at build through
   @astrojs/react and never hydrate — nothing framework-shaped reaches the
   browser. `ssr.noExternal` lists the workspace packages so Vite transforms
   their TypeScript and JSX, plus the packages those two import: with pnpm's
   strict layout they live under packages/ui and apps/api, where a bare
   import from the built server bundle would not find them.

   D12: stylesheets are never inlined so the Worker's CSP needs no hash —
   and neither are scripts: Astro inlines a hoisted script under Vite's
   `assetsInlineLimit` (measured 2026-09-20: the /no-enviada page's few
   lines came out as an inline <script>, which `script-src 'self'` would
   block), so the limit is zero and every script is a file of its own. */
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "https://devoladapago.com",
  output: "static",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "never" },
  integrations: [react()],
  server: { port: 5176 },
  vite: {
    plugins: [tailwindcss()],
    build: { assetsInlineLimit: 0 },
    ssr: {
      noExternal: [
        "@devolada/ui",
        "@devolada/api",
        "zod",
        "class-variance-authority",
        "clsx",
        "tailwind-merge",
        "@radix-ui/react-slot",
      ],
    },
  },
});
