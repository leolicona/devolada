import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/* The Worker in front of the page, proved in workerd (landing-page D18):
   `HTMLRewriter` exists in no other runtime, so its test runs in the one
   the deploy uses (constitution IV). Vitest 4 with the matching pool
   (D13): the pool is a Vite plugin here, not a `poolOptions` block.

   The `ASSETS` binding is stubbed as a service binding answering a fixture
   page — two forms with their hidden `channel` inputs, one non-HTML path —
   so the suite needs no `astro build` first. Declared inline rather than
   through `wrangler.configPath`: the config's `assets` block points the
   pool at `./dist`, which does not exist on a clean checkout, and the two
   `ASSETS` bindings would collide (tasks T005). `API_ORIGIN` is pinned to
   the value the Worker test asserts inside the CSP. */
const fixture = readFileSync(decodeURIComponent(new URL("./test/fixtures/index.html", import.meta.url).pathname), "utf8");

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./worker/index.ts",
      miniflare: {
        compatibilityDate: "2025-05-01",
        bindings: { API_ORIGIN: "https://api.landing-test.devolada.internal" },
        serviceBindings: {
          ASSETS: async (request) => {
            const { pathname } = new URL(request.url);
            if (pathname === "/" || pathname === "/index.html") {
              return new Response(fixture, { headers: { "content-type": "text/html; charset=utf-8" } });
            }
            if (pathname === "/robots.txt") {
              return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
            }
            return new Response("<!doctype html><title>404</title><p>No encontrada</p>", {
              status: 404,
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          },
        },
      },
    }),
  ],
});
