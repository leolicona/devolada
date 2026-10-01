import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { businesses } from "../db/schema";

/* cash-at-stores D7, FR-006: the one business whose customers a store
   collects for. The operator's switch keeps the channel on for at most
   one business at a time, so "the business at the counter" is a fact,
   never a choice the store makes and never a `businessId` the client
   sends (contract store-api.md, "The business, at the counter"). When the
   guard is lifted, this is the one function that learns which stores
   serve which business — the deferred decision lives here and in the
   switch's guard, nowhere else. */
export async function channelBusiness(db: DrizzleD1Database) {
  const [row] = await db.select().from(businesses).where(eq(businesses.storeChannelOn, true)).limit(1);
  return row ?? null;
}
