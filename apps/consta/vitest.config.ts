import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

/* Same test shape as apps/api (docs/legacy/TESTING.md): the Hono app runs in
   workerd with a real local D1; the provider is intercepted with fetchMock. */
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      setupFiles: ["./test/setup.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              /* Test-only values; real ones are worker secrets set by CI */
              APICEP_TOKEN: "test-apicep-token",
              CONSTA_ADMIN_TOKEN: "test-admin-token",
              CONSTA_ISSUER_TOKEN: "test-issuer-token",
              /* Pinned, not defaulted: `wrangler.configPath` above also
                 loads .dev.vars, so a developer running the local apiCEP
                 sandbox (APICEP_BASE_URL=http://localhost:8789) would send
                 every test's provider call there instead of to the
                 interceptor, and the whole suite would fail on their
                 machine only. The tests mock this origin. */
              APICEP_BASE_URL: "https://api.apicep.cloud",
            },
          },
        },
      },
    },
  };
});
