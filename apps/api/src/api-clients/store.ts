import { and, desc, eq, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { apiCredentials, businesses } from "../db/schema";
import { generateApiKey, hashApiKey, keyTail } from "./credentials";

/* Reads and writes of `api_credentials` (automated-collections-api D11).
   Every function takes the business explicitly and filters by it
   (constitution V): a credential belongs to exactly one business, and no
   read here can cross that line. The hash never leaves this module. */

type DB = DrizzleD1Database;
export type ApiCredential = typeof apiCredentials.$inferSelect;
export type Business = typeof businesses.$inferSelect;

/* What the panel may see of a credential (FR-003): the tail identifies
   it, the hash is never returned, the plaintext never existed here. */
export type CredentialSummary = Pick<
  ApiCredential,
  "id" | "name" | "keyTail" | "isTest" | "lastUsedAt" | "revokedAt" | "createdAt"
>;

const summaryColumns = {
  id: apiCredentials.id,
  name: apiCredentials.name,
  keyTail: apiCredentials.keyTail,
  isTest: apiCredentials.isTest,
  lastUsedAt: apiCredentials.lastUsedAt,
  revokedAt: apiCredentials.revokedAt,
  createdAt: apiCredentials.createdAt,
};

/* Issue a credential. The plaintext is returned exactly once, here; the
   row keeps only its hash and tail (constitution V). */
export async function issueCredential(
  db: DB,
  businessId: string,
  opts: { name: string; isTest?: boolean },
): Promise<{ credential: CredentialSummary; plaintext: string }> {
  const plaintext = generateApiKey();
  const [credential] = await db
    .insert(apiCredentials)
    .values({
      businessId,
      name: opts.name,
      keyHash: await hashApiKey(plaintext),
      keyTail: keyTail(plaintext),
      isTest: opts.isTest ?? false,
    })
    .returning(summaryColumns);
  return { credential, plaintext };
}

/* Every credential the business ever issued, newest first, revoked ones
   included — the panel names them by tail and shows which are gone. */
export async function listCredentials(db: DB, businessId: string): Promise<CredentialSummary[]> {
  return db
    .select(summaryColumns)
    .from(apiCredentials)
    .where(eq(apiCredentials.businessId, businessId))
    .orderBy(desc(apiCredentials.createdAt));
}

/* Revocation is a timestamp, never a delete (FR-004). Idempotent: an
   already revoked credential keeps its first revocation time. Returns
   whether a live credential of this business was revoked by this call. */
export async function revokeCredential(
  db: DB,
  businessId: string,
  credentialId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(apiCredentials)
    .set({ revokedAt: now })
    .where(
      and(
        eq(apiCredentials.id, credentialId),
        eq(apiCredentials.businessId, businessId),
        isNull(apiCredentials.revokedAt),
      ),
    )
    .returning({ id: apiCredentials.id });
  return rows.length === 1;
}

/* The one read the middleware makes: the live credential this plaintext
   hashes to, with its business in the same query. Null for an unknown
   key and for a revoked one alike (FR-005) — the caller learns nothing
   from which. */
export async function resolveCredential(
  db: DB,
  plaintext: string,
): Promise<{ credential: ApiCredential; business: Business } | null> {
  const keyHash = await hashApiKey(plaintext);
  const [row] = await db
    .select({ credential: apiCredentials, business: businesses })
    .from(apiCredentials)
    .innerJoin(businesses, eq(businesses.id, apiCredentials.businessId))
    .where(and(eq(apiCredentials.keyHash, keyHash), isNull(apiCredentials.revokedAt)));
  return row ?? null;
}

/* `last_used_at`, so a business can retire a credential it no longer
   recognises. Written on every authenticated request. */
export async function touchCredential(db: DB, credentialId: string, now: Date): Promise<void> {
  await db.update(apiCredentials).set({ lastUsedAt: now }).where(eq(apiCredentials.id, credentialId));
}
