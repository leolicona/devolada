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
            bindings: {
              TEST_MIGRATIONS: migrations,
              /* Pinned, not defaulted: `wrangler.configPath` above also
                 loads .dev.vars, and the queue and direct-payment paths
                 pass this straight to the adapter. A developer pointing
                 it at a local WispHub clone would send their provider
                 calls there instead of to the interceptor, failing the
                 suite on their machine alone. The tests mock this
                 origin. (Consta's base is passed per-test, not from the
                 environment, so it needs no pin.) */
              WISPHUB_BASE_URL: "https://api.wisphub.net/api",
              /* Same rule for the email provider: .dev.vars carries a real
                 key on a developer's machine, and without this pin every
                 seeded signup's OTP reached Resend for real (measured
                 2026-09-01: 429s in the test output). Empty = log only. */
              RESEND_API_KEY: "",
              /* better-auth.spec.md D11: the suite signs in hundreds of
                 times from one address; the limiter's own test hands the
                 app an env without this pin. */
              AUTH_RATE_LIMIT: "off",
            },
          },
        },
      },
    },
  };
});
