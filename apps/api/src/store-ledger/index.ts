import { and, desc, eq, gte, inArray, lt, max, or, sql, sum } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { payments, storeHandovers, storeLedger } from "../db/schema";

/* cash-at-stores D19: the store's cash book — the ONLY writer of
   `store_ledger`. Append-only: nothing here updates or deletes a
   movement. What a store holds for a business is a SUM over that pair,
   never stored (the house rule `credit_entries` follows, prepaid-credit
   D3), and the same SUM feeds *Mi caja* and *Puntos de pago*, so the two
   agree to the cent (FR-039, SC-005). The store's fee is never a
   movement: it is the store's money, derived from the payments. */

type DB = DrizzleD1Database;
type Movement = typeof storeLedger.$inferSelect;

/* D19: `+` the amount applied to the debt, once per payment — the unique
   `(payment_id) WHERE kind = 'collection'` index makes a second call a
   no-op, so every path may call it. */
export async function recordCollection(
  db: DB,
  payment: { id: string; storeId: string | null; businessId: string; receivedCents: number | null; amountCents: number },
  now: Date = new Date(),
): Promise<void> {
  if (!payment.storeId) throw new Error(`payment ${payment.id} is not a store's`);
  await db
    .insert(storeLedger)
    .values({
      storeId: payment.storeId,
      businessId: payment.businessId,
      kind: "collection",
      cents: payment.receivedCents ?? payment.amountCents,
      paymentId: payment.id,
      createdAt: now,
    })
    .onConflictDoNothing();
}

/* D20 rule 3: confirming a hand-over writes its `−cents` movement in the
   SAME batch as the status change, and only while it is still pending —
   the insert reads the hand-over's own row, so a second confirm (or a
   race) finds it confirmed and writes nothing. The unique
   `(handover_id) WHERE kind = 'handover'` index is the second guard.
   Answers the confirmed hand-over, or null when it was not pending for
   this business. */
export async function recordHandover(
  db: DB,
  handover: { id: string; businessId: string; resolvedByUserId: string },
  now: Date = new Date(),
): Promise<typeof storeHandovers.$inferSelect | null> {
  const [, confirmed] = await db.batch([
    db.run(sql`INSERT INTO store_ledger (id, store_id, business_id, kind, cents, handover_id, created_at)
      SELECT ${crypto.randomUUID()}, store_id, business_id, 'handover', -cents, id, ${now.getTime()}
      FROM store_handovers
      WHERE id = ${handover.id} AND business_id = ${handover.businessId} AND status = 'pending'`),
    db
      .update(storeHandovers)
      .set({ status: "confirmed", resolvedByUserId: handover.resolvedByUserId, resolvedAt: now })
      .where(
        and(
          eq(storeHandovers.id, handover.id),
          eq(storeHandovers.businessId, handover.businessId),
          eq(storeHandovers.status, "pending"),
        ),
      )
      .returning(),
  ]);
  return confirmed[0] ?? null;
}

/* D21 (FR-030): the operator's correction — an amount of either sign, a
   reason and its author, linked to the payment it corrects. Never an
   undo: the payment row is not touched. */
export async function recordCorrection(
  db: DB,
  correction: {
    storeId: string;
    businessId: string;
    paymentId: string;
    cents: number;
    reason: string;
    authorUserId: string;
  },
  now: Date = new Date(),
): Promise<Movement> {
  const [row] = await db
    .insert(storeLedger)
    .values({ ...correction, kind: "correction", createdAt: now })
    .returning();
  return row;
}

/* D19: what the store holds for the business, in cents */
export async function heldCents(db: DB, storeId: string, businessId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(storeLedger.cents) })
    .from(storeLedger)
    .where(and(eq(storeLedger.storeId, storeId), eq(storeLedger.businessId, businessId)));
  return Number(row?.total ?? 0);
}

/* The same SUM for every pair a set of stores or businesses touches, in
   one query: the operator's list and the business's page read many. */
export async function heldByPair(
  db: DB,
  filter: { storeIds?: string[]; businessIds?: string[] },
): Promise<{ storeId: string; businessId: string; heldCents: number }[]> {
  const where = [
    ...(filter.storeIds ? [inArray(storeLedger.storeId, filter.storeIds.length ? filter.storeIds : [""])] : []),
    ...(filter.businessIds ? [inArray(storeLedger.businessId, filter.businessIds.length ? filter.businessIds : [""])] : []),
  ];
  const rows = await db
    .select({ storeId: storeLedger.storeId, businessId: storeLedger.businessId, total: sum(storeLedger.cents) })
    .from(storeLedger)
    .where(and(...where))
    .groupBy(storeLedger.storeId, storeLedger.businessId);
  return rows.map((r) => ({ storeId: r.storeId, businessId: r.businessId, heldCents: Number(r.total ?? 0) }));
}

/* D19, `cashbox` D5 re-specified per business (FR-037): the fees the store
   earned since its last confirmed hand-over to this business — the
   `store_fee_cents` of its confirmed or partial cash payments since that
   movement's time, or from the start when there is none. */
export async function feesSinceHandoverCents(db: DB, storeId: string, businessId: string): Promise<number> {
  const [last] = await db
    .select({ at: max(storeLedger.createdAt) })
    .from(storeLedger)
    .where(
      and(eq(storeLedger.storeId, storeId), eq(storeLedger.businessId, businessId), eq(storeLedger.kind, "handover")),
    );
  const since = last?.at ?? null;
  const [row] = await db
    .select({ total: sum(payments.storeFeeCents) })
    .from(payments)
    .where(
      and(
        eq(payments.storeId, storeId),
        eq(payments.businessId, businessId),
        eq(payments.channel, "store"),
        inArray(payments.status, ["confirmed", "partial"]),
        ...(since ? [gte(payments.createdAt, since)] : []),
      ),
    );
  return Number(row?.total ?? 0);
}

/* The movements of one store, newest first, for the store's *Movimientos*
   and the operator's view of one pair. The cursor is the last row's time
   and id, so two movements in the same millisecond never repeat or
   vanish between pages. */
export type LedgerCursor = { at: number; id: string };

export function encodeLedgerCursor(c: LedgerCursor): string {
  return btoa(`${c.at}:${c.id}`).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeLedgerCursor(raw: string | undefined): LedgerCursor | null | "bad" {
  if (!raw) return null;
  try {
    const plain = atob(raw.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (raw.length % 4)) % 4));
    const [at, id] = plain.split(":");
    const n = Number(at);
    if (!Number.isSafeInteger(n) || !id) return "bad";
    return { at: n, id };
  } catch {
    return "bad";
  }
}

export async function movementsOf(
  db: DB,
  filter: { storeId: string; businessIds: string[] },
  cursor: LedgerCursor | null,
  limit: number,
): Promise<{ rows: Movement[]; next: LedgerCursor | null }> {
  if (!filter.businessIds.length) return { rows: [], next: null };
  const rows = await db
    .select()
    .from(storeLedger)
    .where(
      and(
        eq(storeLedger.storeId, filter.storeId),
        inArray(storeLedger.businessId, filter.businessIds),
        ...(cursor
          ? [
              or(
                lt(storeLedger.createdAt, new Date(cursor.at)),
                and(eq(storeLedger.createdAt, new Date(cursor.at)), lt(storeLedger.id, cursor.id)),
              ),
            ]
          : []),
      ),
    )
    .orderBy(desc(storeLedger.createdAt), desc(storeLedger.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page,
    next: rows.length > limit && last ? { at: last.createdAt.getTime(), id: last.id } : null,
  };
}
