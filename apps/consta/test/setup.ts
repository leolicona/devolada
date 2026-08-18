import { applyD1Migrations, env } from "cloudflare:test";

/* Isolated storage gives every test a fresh D1; migrations run before each. */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/* The suite mocks one provider origin, so it must be the one the code
   will call. `.dev.vars` is loaded here too (vitest.config.ts pins the
   binding over it): without the pin, a developer pointing at the local
   apiCEP sandbox failed every provider test on their machine alone, with
   "mock dispatch not matched" instead of anything naming the cause. */
if (env.APICEP_BASE_URL !== "https://api.apicep.cloud") {
  throw new Error(
    `APICEP_BASE_URL must stay the mocked origin in tests, got ${env.APICEP_BASE_URL}. ` +
      "Check the binding in vitest.config.ts — .dev.vars must not win.",
  );
}
