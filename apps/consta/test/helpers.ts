import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { apiKeys, validations } from "../src/db/schema";
import { generateApiKey, hashApiKey } from "../src/auth/api-key";

export { app } from "../src/index";
export { apiKeys, validations };

export const db = () => drizzle(env.DB);

/* Issues a key straight into the DB and returns its plaintext */
export async function seedApiKey(name = "test-integrator") {
  const key = generateApiKey();
  const [row] = await db()
    .insert(apiKeys)
    .values({ name, keyHash: await hashApiKey(key) })
    .returning({ id: apiKeys.id });
  return { id: row.id, key };
}

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers/config").D1Migration[];
    APICEP_TOKEN: string;
    CONSTA_ADMIN_TOKEN: string;
  }
}
