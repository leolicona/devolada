import type { Bindings } from "../src/env";
import type { D1Migration } from "@cloudflare/workers-types/experimental";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Bindings {
    TEST_MIGRATIONS: D1Migration[];
    /* automated-collections-api D8: the one destination every webhook
       test registers, pinned in vitest.config.ts and intercepted with
       fetchMock. The product never reads it. */
    WEBHOOK_TEST_DESTINATION_URL: string;
  }
}
