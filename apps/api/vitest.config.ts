import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

/* API-layer tests (docs/TESTING.md): the Hono app runs in workerd — the
   real Workers runtime — with a real local D1, no database mocks.
   Migrations are read here and applied per test in test/setup.ts. */
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      setupFiles: ["./test/setup.ts"],
      poolOptions: {
        workers: {
          /* One workerd runtime for the whole suite (tests keep isolated
             storage). Per-file runtimes exhausted the ephemeral port
             space once Better Auth's module graph joined the suite —
             measured locally: 15 parallel runtimes → 16k TIME_WAIT
             sockets and "Fallback service ... Connection refused". */
          singleWorker: true,
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
