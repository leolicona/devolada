import type { Context } from "hono";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses, storeHandovers, stores, user as userTable } from "../../db/schema";
import { decodeLedgerCursor, encodeLedgerCursor, heldByPair, recordHandover } from "../../store-ledger";
import type { CashPointsResponse, DisputeRequest, HandoverHistoryResponse, HandoverRow } from "./schema";

/* cash-at-stores D20, D23 — *Puntos de pago*. The actor's business filters
   every read and every write; a hand-over of another business is NOT_FOUND,
   never "not pending" (FR-042). */

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
type DB = DrizzleD1Database;
type Handover = typeof storeHandovers.$inferSelect;

const refuse = (c: Ctx, code: string, status: 404 | 409 | 400) => c.json({ success: false, error: { code } }, status);

async function rowOf(db: DB, h: Handover): Promise<HandoverRow> {
  const [resolver] = h.resolvedByUserId
    ? await db.select({ email: userTable.email }).from(userTable).where(eq(userTable.id, h.resolvedByUserId))
    : [];
  return {
    id: h.id,
    storeId: h.storeId,
    cents: h.cents,
    status: h.status,
    note: h.note,
    declaredAt: h.declaredAt.getTime(),
    resolvedAt: h.resolvedAt?.getTime() ?? null,
    resolvedBy: resolver?.email ?? null,
  };
}

/* GET /cash-points — FR-034: every store with a movement for this
   business, its cash held, the last confirmed hand-over and the pending one */
export async function listCashPoints(c: Ctx) {
  const db = drizzle(c.env.DB);
  const actor = c.get("actor");
  const [business] = await db.select({ on: businesses.storeChannelOn }).from(businesses).where(eq(businesses.id, actor.id));
  const held = await heldByPair(db, { businessIds: [actor.id] });
  const storeIds = held.map((h) => h.storeId);
  const [rows, handovers] = storeIds.length
    ? await Promise.all([
        db.select().from(stores).where(inArray(stores.id, storeIds)),
        db
          .select()
          .from(storeHandovers)
          .where(and(eq(storeHandovers.businessId, actor.id), inArray(storeHandovers.storeId, storeIds), inArray(storeHandovers.status, ["pending", "confirmed"])))
          .orderBy(desc(storeHandovers.declaredAt)),
      ])
    : [[], []];
  const data: CashPointsResponse = {
    channelOn: business?.on ?? false,
    stores: rows
      .map((s) => {
        const pending = handovers.find((h) => h.storeId === s.id && h.status === "pending");
        const last = handovers
          .filter((h) => h.storeId === s.id && h.status === "confirmed")
          .sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0))[0];
        return {
          storeId: s.id,
          storeName: s.name,
          address: s.address,
          storeStatus: s.status,
          heldCents: held.find((h) => h.storeId === s.id)?.heldCents ?? 0,
          lastConfirmed: last ? { cents: last.cents, at: (last.resolvedAt ?? last.declaredAt).getTime() } : null,
          pending: pending ? { id: pending.id, cents: pending.cents, declaredAt: pending.declaredAt.getTime() } : null,
        };
      })
      .sort((a, b) => a.storeName.localeCompare(b.storeName, "es-MX")),
  };
  return c.json({ success: true, data });
}

/* A refusal for a hand-over that is not pending: 409 when it is this
   business's, 404 when it is nobody's this actor may see */
async function notPending(c: Ctx, db: DB, id: string) {
  const [h] = await db
    .select({ id: storeHandovers.id })
    .from(storeHandovers)
    .where(and(eq(storeHandovers.id, id), eq(storeHandovers.businessId, c.get("actor").id)));
  return h ? refuse(c, "HANDOVER_NOT_PENDING", 409) : refuse(c, "NOT_FOUND", 404);
}

/* POST /cash-points/handovers/:id/confirm — D20 rule 3: the `handover`
   movement and the status change in one batch, once (store-ledger) */
export async function confirmHandover(c: Ctx, id: string) {
  const db = drizzle(c.env.DB);
  const actor = c.get("actor");
  const confirmed = await recordHandover(db, { id, businessId: actor.id, resolvedByUserId: actor.userId });
  if (!confirmed) return notPending(c, db, id);
  return c.json({ success: true, data: await rowOf(db, confirmed) });
}

/* POST /cash-points/handovers/:id/dispute — D20 rule 4: terminal, a note,
   no movement; the store sees the note in *Mi caja* */
export async function disputeHandover(c: Ctx, id: string, body: DisputeRequest) {
  const db = drizzle(c.env.DB);
  const actor = c.get("actor");
  const [disputed] = await db
    .update(storeHandovers)
    .set({ status: "disputed", note: body.note, resolvedByUserId: actor.userId, resolvedAt: new Date() })
    .where(and(eq(storeHandovers.id, id), eq(storeHandovers.businessId, actor.id), eq(storeHandovers.status, "pending")))
    .returning();
  if (!disputed) return notPending(c, db, id);
  return c.json({ success: true, data: await rowOf(db, disputed) });
}

const HISTORY_PAGE = 20;

/* GET /cash-points/stores/:storeId/history — this business's hand-overs
   at that store, newest first */
export async function handoverHistory(c: Ctx, storeId: string, rawCursor: string | undefined) {
  const db = drizzle(c.env.DB);
  const actor = c.get("actor");
  const cursor = decodeLedgerCursor(rawCursor);
  if (cursor === "bad") return refuse(c, "VALIDATION_ERROR", 400);
  const rows = await db
    .select()
    .from(storeHandovers)
    .where(
      and(
        eq(storeHandovers.businessId, actor.id),
        eq(storeHandovers.storeId, storeId),
        ...(cursor
          ? [
              or(
                lt(storeHandovers.declaredAt, new Date(cursor.at)),
                and(eq(storeHandovers.declaredAt, new Date(cursor.at)), lt(storeHandovers.id, cursor.id)),
              ),
            ]
          : []),
      ),
    )
    .orderBy(desc(storeHandovers.declaredAt), desc(storeHandovers.id))
    .limit(HISTORY_PAGE + 1);
  const page = rows.slice(0, HISTORY_PAGE);
  const last = page.at(-1);
  const data: HandoverHistoryResponse = {
    handovers: await Promise.all(page.map((h) => rowOf(db, h))),
    nextCursor: rows.length > HISTORY_PAGE && last ? encodeLedgerCursor({ at: last.declaredAt.getTime(), id: last.id }) : null,
  };
  return c.json({ success: true, data });
}
