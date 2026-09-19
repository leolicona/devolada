import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";
import { D1_MAX_PARAMS } from "../src/db/params";
import { resetProviderCaches } from "../src/wisphub/cache";

/* D1's parameter cap, made real locally (bug cobros-links-lookup-params).

   Production D1 refuses a statement that binds more than 100 values;
   workerd's SQLite, which the suite runs on, does not — `db/params.ts`
   has said so since BUG-021, and the blindness cost a second bug: the
   Cobros link lookup gained a fixed parameter after its chunk size was
   set, bound 101 on a tenant with 99 debtors, and no test could see it.
   Every statement drizzle runs goes through `prepare(sql).bind(...)`, so
   a bind that is too wide throws here with D1's own message, on every
   test, and the count stops being a matter of discipline.

   `singleWorker` runs this file once per test FILE in one shared
   runtime, so `env.DB` may already be the guarded binding when it runs
   again: the real one is kept under a global and wrapped exactly once —
   `applyD1Migrations` insists on the real class, and a proxy of a proxy
   would count nothing new. */
const REAL_DB = Symbol.for("devolada.test.realDB");
const globals = globalThis as { [REAL_DB]?: D1Database };
const realDB = globals[REAL_DB] ?? (globals[REAL_DB] = env.DB);

/* Isolated storage gives every test a fresh D1; migrations run before each. */
await applyD1Migrations(realDB, env.TEST_MIGRATIONS);

const bound = (stmt: D1PreparedStatement): D1PreparedStatement =>
  new Proxy(stmt, {
    get(target, prop) {
      if (prop === "bind") {
        return (...values: unknown[]) => {
          if (values.length > D1_MAX_PARAMS) {
            throw new Error(
              `D1_ERROR: too many SQL variables (${values.length} bound, D1 allows ${D1_MAX_PARAMS})`,
            );
          }
          return bound(target.bind(...values));
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
if (env.DB === realDB) (env as { DB: D1Database }).DB = new Proxy(realDB, {
  get(target, prop) {
    if (prop === "prepare") return (sql: string) => bound(target.prepare(sql));
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

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

/* The same pin for the validation engine's provider (consta-api-merge
   D12): the engine's suite and the payment suites intercept apiCEP at
   its real origin, and `.dev.vars` pointing at the sandbox must not win. */
if (env.APICEP_BASE_URL !== "https://api.apicep.cloud") {
  throw new Error(
    `APICEP_BASE_URL must stay the mocked origin in tests, got ${env.APICEP_BASE_URL}. ` +
      "Check the binding in vitest.config.ts — .dev.vars must not win.",
  );
}

/* The receipt reader is a Workers AI binding, and the one binding tests
   stand in for (constitution IV): wrangler.jsonc binds `AI` for the
   deployed Worker, and miniflare hands the suite an object that would
   call Cloudflare for real. Unbound here, so `env.AI` is absent unless
   a test passes `aiReturning(...)` — exactly the contract the engine's
   suite was written against (consta-api-merge D12). */
delete (env as { AI?: unknown }).AI;

/* The provider caches (provider-latency spec D3, D5) are module state,
   and `singleWorker` gives the whole suite one runtime — so without this
   a cached pending list or payment-method id would cross test
   boundaries, and a test that counts provider calls would pass or fail
   depending on which file ran first. Same reason D1 gets isolated
   storage: a test starts from empty or it is not a test. */
beforeEach(() => resetProviderCaches());
