import { eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { integrations } from "../db/schema";

/* The integration row, one per business (integrations-hub D2). Every
   reader of the old business columns — key, threshold, floor,
   provisional switch — comes through here now: one house, one shape.
   "Not connected" is no row or a row with no key. */

type DB = DrizzleD1Database;
export type Integration = typeof integrations.$inferSelect;

export async function integrationOf(db: DB, businessId: string): Promise<Integration | null> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(eq(integrations.businessId, businessId));
  return row ?? null;
}

/* The sweeps ask for many businesses at once — one query, one map. */
export async function integrationsFor(
  db: DB,
  businessIds: string[],
): Promise<Map<string, Integration>> {
  if (!businessIds.length) return new Map();
  const rows = await db
    .select()
    .from(integrations)
    .where(inArray(integrations.businessId, businessIds));
  return new Map(rows.map((r) => [r.businessId, r]));
}

/* Create-or-update, keyed by the unique businessId. A row born from a
   dials-only save has no key yet and the channel stays "unavailable";
   a NEW row is born observing (actions_enabled false, integrations-hub
   D4) — inert until the observation gate lands, and exactly right once
   it does. The phase-5 migration backfilled existing businesses with
   actions enabled, so the pilot's behavior never changed. */
export async function upsertIntegration(
  db: DB,
  businessId: string,
  patch: Partial<typeof integrations.$inferInsert>,
): Promise<Integration> {
  const existing = await integrationOf(db, businessId);
  if (existing) {
    const [row] = await db
      .update(integrations)
      .set(patch)
      .where(eq(integrations.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(integrations)
    .values({ businessId, ...patch })
    .returning();
  return row;
}
