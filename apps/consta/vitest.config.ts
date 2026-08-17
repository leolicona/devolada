import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

/* Same test shape as apps/api (docs/TESTING.md): the Hono app runs in
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
            },
          },
        },
      },
    },
  };
});
