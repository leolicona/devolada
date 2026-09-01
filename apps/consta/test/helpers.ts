import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { apiKeys, extractions, validations } from "../src/db/schema";
import { generateApiKey, hashApiKey } from "../src/auth/api-key";

export { app } from "../src/index";
export { apiKeys, extractions, validations };

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

/* proof-extraction D7: routing follows magic bytes, so the fixtures only
   need to carry the right first few. The rest is padding — no test here
   asserts anything about image content, because nothing in Consta reads
   it: the model does, and the model is stubbed. */
const pad = (head: number[], size = 64): Uint8Array => {
  const out = new Uint8Array(size);
  out.set(head);
  return out;
};

export const PNG = (size = 64) => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size);
export const JPEG = (size = 64) => pad([0xff, 0xd8, 0xff, 0xe0], size);
export const PDF = (size = 64) => pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], size);
export const NOT_A_FILE = (size = 64) => pad([0x00, 0x01, 0x02, 0x03], size);

/* The reader, stubbed. Measured 2026-08-19: the real model answers with
   its JSON inside a ```json fence every single time, so the stub does
   too — a fixture that is tidier than reality tests a parser we do not
   ship. */
export const fenced = (obj: unknown) => "```json\n" + JSON.stringify(obj, null, 2) + "\n```";

export type StubbedReading = {
  esComprobante?: boolean;
  claveDeRastreo?: string | null;
  banco?: string | null;
  monto?: number | null;
  fecha?: string | null;
  estatus?: string | null;
};

export function aiReturning(reading: StubbedReading | string, calls?: unknown[]) {
  return {
    run: async (model: string, input: unknown) => {
      calls?.push({ model, input });
      return { response: typeof reading === "string" ? reading : fenced(reading) };
    },
  };
}

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers/config").D1Migration[];
    APICEP_TOKEN: string;
    CONSTA_ADMIN_TOKEN: string;
    CONSTA_ISSUER_TOKEN: string;
  }
}
