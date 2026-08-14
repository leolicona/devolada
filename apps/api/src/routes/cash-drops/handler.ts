import type { Context } from "hono";
import { and, desc, eq, inArray, lt, ne, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { cashDrops, ledgerEntries, stores } from "../../db/schema";
import { recordCashDropEntry, storeBalanceCents } from "../../ledger";
import type { AdminCashDrop, CashDropResponse, CashDropsResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
type Db = ReturnType<typeof drizzle>;

const PAGE = 20;

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

/* ── Admin side (docs/cash-drops/confirm-cash-drop.spec.md) ───────── */

function ispGuard(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "isp") {
    return { error: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403) };
  }
  return { actor, db: drizzle(c.env.DB) };
}

function toAdminDrop(
  drop: typeof cashDrops.$inferSelect,
  store: { id: string; name: string; zone: string | null },
  balanceCents: number | null,
): AdminCashDrop {
  return {
    id: drop.id,
    storeId: store.id,
    storeName: store.name,
    storeZone: store.zone,
    cents: drop.cents,
    status: drop.status,
    note: drop.note,
    createdAt: drop.createdAt.getTime(),
    confirmedAt: drop.confirmedAt?.getTime() ?? null,
    storeBalanceCents: balanceCents,
  };
}

/* D3: the tenant boundary is the store — a drop belongs to the ISP that
   owns its store, so every admin read starts from the ISP's stores. */
async function ownStores(db: Db, ispId: string) {
  const rows = await db
    .select({ id: stores.id, name: stores.name, zone: stores.zone })
    .from(stores)
    .where(eq(stores.ispId, ispId));
  return new Map(rows.map((s) => [s.id, s]));
}

async function balancesFor(db: Db, storeIds: string[]) {
  if (!storeIds.length) return new Map<string, number>();
  const rows = await db
    .select({ storeId: ledgerEntries.storeId, total: sum(ledgerEntries.cents) })
    .from(ledgerEntries)
    .where(inArray(ledgerEntries.storeId, storeIds))
    .groupBy(ledgerEntries.storeId);
  return new Map(rows.map((r) => [r.storeId, Number(r.total ?? 0)]));
}

/* D4: two scopes, one endpoint. Pending is unpaged (a store holds at
   most one); resolved is the paged history. */
export async function listCashDrops(c: Ctx, scope: "pending" | "resolved", cursor?: number) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;

  const storesById = await ownStores(ctx.db, ctx.actor.id);
  const ids = [...storesById.keys()];
  if (!ids.length) {
    return c.json({ success: true, data: { drops: [], nextCursor: null } satisfies CashDropsResponse });
  }

  const mine = inArray(cashDrops.storeId, ids);
  const rows =
    scope === "pending"
      ? await ctx.db
          .select()
          .from(cashDrops)
          .where(and(mine, eq(cashDrops.status, "pending")))
          .orderBy(desc(cashDrops.createdAt))
      : await ctx.db
          .select()
          .from(cashDrops)
          .where(
            cursor
              ? and(mine, ne(cashDrops.status, "pending"), lt(cashDrops.createdAt, new Date(cursor)))
              : and(mine, ne(cashDrops.status, "pending")),
          )
          .orderBy(desc(cashDrops.createdAt))
          .limit(PAGE + 1);

  const page = scope === "pending" ? rows : rows.slice(0, PAGE);
  /* D5: only pending cards need the store's current balance */
  const balances =
    scope === "pending"
      ? await balancesFor(ctx.db, [...new Set(page.map((d) => d.storeId))])
      : new Map<string, number>();

  const data: CashDropsResponse = {
    drops: page.map((d) =>
      toAdminDrop(d, storesById.get(d.storeId)!, scope === "pending" ? (balances.get(d.storeId) ?? 0) : null),
    ),
    nextCursor:
      scope === "resolved" && rows.length > PAGE ? page[page.length - 1].createdAt.getTime() : null,
  };
  return c.json({ success: true, data });
}

/* Both actions act on a drop that must be pending and must belong to
   one of the ISP's stores (D2, D3). */
async function pendingDropOf(db: Db, ispId: string, id: string) {
  const [drop] = await db.select().from(cashDrops).where(eq(cashDrops.id, id));
  if (!drop) return { code: "NOT_FOUND" as const };
  const [store] = await db
    .select({ id: stores.id, name: stores.name, zone: stores.zone, ispId: stores.ispId })
    .from(stores)
    .where(eq(stores.id, drop.storeId));
  if (!store || store.ispId !== ispId) return { code: "NOT_FOUND" as const };
  if (drop.status !== "pending") return { code: "DROP_NOT_PENDING" as const, store };
  return { drop, store };
}

export async function confirmCashDrop(c: Ctx, id: string) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;

  const found = await pendingDropOf(ctx.db, ctx.actor.id, id);
  if ("code" in found) {
    const status = found.code === "NOT_FOUND" ? 404 : 409;
    return c.json({ success: false, error: { code: found.code } }, status);
  }

  /* D1: this is the moment the ledger learns about the handover */
  const confirmedAt = new Date();
  await ctx.db
    .update(cashDrops)
    .set({ status: "confirmed", confirmedAt })
    .where(eq(cashDrops.id, found.drop.id));
  await recordCashDropEntry(ctx.db, {
    storeId: found.store.id,
    cashDropId: found.drop.id,
    cents: found.drop.cents,
  });

  const balanceCents = await storeBalanceCents(ctx.db, found.store.id);
  return c.json({
    success: true,
    data: {
      drop: toAdminDrop(
        { ...found.drop, status: "confirmed", confirmedAt },
        found.store,
        balanceCents,
      ),
      storeBalanceCents: balanceCents,
    },
  });
}

export async function disputeCashDrop(c: Ctx, id: string, note: string) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;

  const found = await pendingDropOf(ctx.db, ctx.actor.id, id);
  if ("code" in found) {
    const status = found.code === "NOT_FOUND" ? 404 : 409;
    return c.json({ success: false, error: { code: found.code } }, status);
  }

  /* D1: a disputed drop writes no ledger entry — nothing was agreed.
     D2: terminal, so the store settles in person and records a new one. */
  await ctx.db
    .update(cashDrops)
    .set({ status: "disputed", note })
    .where(eq(cashDrops.id, found.drop.id));

  const balanceCents = await storeBalanceCents(ctx.db, found.store.id);
  return c.json({
    success: true,
    data: {
      drop: toAdminDrop({ ...found.drop, status: "disputed", note }, found.store, balanceCents),
    },
  });
}
