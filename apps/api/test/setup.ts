import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";
import { resetProviderCaches } from "../src/wisphub/cache";

/* Isolated storage gives every test a fresh D1; migrations run before each. */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/* The suite mocks one WispHub origin, so it must be the one the code
   will call. `.dev.vars` is loaded here too (vitest.config.ts pins the
   binding over it): without the pin, pointing at a local WispHub clone
   failed the provider tests with "mock dispatch not matched" instead of
   anything naming the cause. */
if (env.WISPHUB_BASE_URL !== "https://api.wisphub.net/api") {
  throw new Error(
    `WISPHUB_BASE_URL must stay the mocked origin in tests, got ${env.WISPHUB_BASE_URL}. ` +
      "Check the binding in vitest.config.ts — .dev.vars must not win.",
  );
}

/* The provider caches (provider-latency spec D3, D5) are module state,
   and `singleWorker` gives the whole suite one runtime — so without this
   a cached pending list or payment-method id would cross test
   boundaries, and a test that counts provider calls would pass or fail
   depending on which file ran first. Same reason D1 gets isolated
   storage: a test starts from empty or it is not a test. */
beforeEach(() => resetProviderCaches());
