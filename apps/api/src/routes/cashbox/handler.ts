import type { Context } from "hono";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { cashDrops, stores } from "../../db/schema";
import { commissionEarnedCents, storeBalanceCents } from "../../ledger";
import type { CashboxResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* D1: "approaching" is 80% of the cap, computed here and nowhere else */
const APPROACHING_RATIO = 0.8;

export async function getCashbox(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "store") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }

  const db = drizzle(c.env.DB);
  const [store] = await db.select().from(stores).where(eq(stores.id, actor.id));
  const balanceCents = await storeBalanceCents(db, actor.id);
  const earned = await commissionEarnedCents(db, actor.id);
  const [lastDrop] = await db
    .select()
    .from(cashDrops)
    .where(eq(cashDrops.storeId, actor.id))
    .orderBy(desc(cashDrops.createdAt))
    .limit(1);

  const data: CashboxResponse = {
    storeName: store.name,
    balanceCents,
    commissionEarnedCents: earned,
    cap: {
      capCents: store.balanceCapCents,
      approaching: balanceCents >= store.balanceCapCents * APPROACHING_RATIO,
      blocked: balanceCents >= store.balanceCapCents,
    },
    lastCashDrop: lastDrop
      ? {
          id: lastDrop.id,
          cents: lastDrop.cents,
          status: lastDrop.status,
          note: lastDrop.note,
          createdAt: lastDrop.createdAt.getTime(),
        }
      : null,
  };
  return c.json({ success: true, data });
}
