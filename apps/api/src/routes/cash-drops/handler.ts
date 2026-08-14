import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { cashDrops } from "../../db/schema";
import { storeBalanceCents } from "../../ledger";
import type { CashDropResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

export async function recordCashDrop(c: Ctx, cents: number) {
  const actor = c.get("actor");
  if (actor.type !== "store") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);

  /* D2: one pending drop at a time */
  const [pending] = await db
    .select()
    .from(cashDrops)
    .where(and(eq(cashDrops.storeId, actor.id), eq(cashDrops.status, "pending")));
  if (pending) {
    return c.json({ success: false, error: { code: "DROP_ALREADY_PENDING" } }, 409);
  }

  /* D3: you cannot hand over money you do not hold */
  const balance = await storeBalanceCents(db, actor.id);
  if (cents > balance) {
    return c.json({ success: false, error: { code: "AMOUNT_EXCEEDS_BALANCE" } }, 400);
  }

  /* D1: no ledger entry here — that happens when the ISP confirms */
  const [drop] = await db.insert(cashDrops).values({ storeId: actor.id, cents }).returning();
  const data: CashDropResponse = {
    id: drop.id,
    cents: drop.cents,
    status: drop.status,
    createdAt: drop.createdAt.getTime(),
  };
  return c.json({ success: true, data }, 201);
}
