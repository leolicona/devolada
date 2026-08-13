import type { Bindings } from "../src/env";
import type { D1Migration } from "@cloudflare/workers-types/experimental";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Bindings {
    TEST_MIGRATIONS: D1Migration[];
  }
}
