import { and, eq, gt, max, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { ledgerEntries } from "../db/schema";

/* The ledger module (ARCHITECTURE.md law): every read and write of
   ledger_entries goes through this file. The table is append-only.
   A balance is never stored — it is always this SUM. */

export async function storeBalanceCents(
  db: ReturnType<typeof drizzle>,
  storeId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sum(ledgerEntries.cents) })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.storeId, storeId));
  return Number(row?.total ?? 0);
}

/* The commission of the current drop cycle (cashbox spec D5): entries
   after the last confirmed drop. The `cash_drop` entry only exists once
   the ISP confirms, so a pending drop resets nothing. Before the first
   confirmed drop, `sinceMs` is null and the sum is all-time. Positive
   number (commission entries are negative in the ledger). */
export async function commissionCycle(
  db: ReturnType<typeof drizzle>,
  storeId: string,
): Promise<{ cents: number; sinceMs: number | null }> {
  const [drop] = await db
    .select({ at: max(ledgerEntries.createdAt) })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.storeId, storeId), eq(ledgerEntries.type, "cash_drop")));
  const since = drop?.at ?? null;

  const [row] = await db
    .select({ total: sum(ledgerEntries.cents) })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.storeId, storeId),
        eq(ledgerEntries.type, "commission"),
        ...(since ? [gt(ledgerEntries.createdAt, since)] : []),
      ),
    );
  return { cents: -Number(row?.total ?? 0), sinceMs: since ? since.getTime() : null };
}

/* A confirmed cash drop takes the handed-over cash out of the store's
   balance. Written only when the ISP confirms (cash-drops spec D1):
   the ledger records the agreement, not the promise. */
export async function recordCashDropEntry(
  db: ReturnType<typeof drizzle>,
  input: { storeId: string; cashDropId: string; cents: number },
): Promise<void> {
  await db.insert(ledgerEntries).values({
    storeId: input.storeId,
    type: "cash_drop",
    cents: -input.cents,
    cashDropId: input.cashDropId,
  });
}

/* A charge writes exactly two entries: the full total in, the store's
   commission out (the store keeps it from the cash in hand). */
export async function recordChargeEntries(
  db: ReturnType<typeof drizzle>,
  input: { storeId: string; chargeId: string; totalCents: number; commissionCents: number },
): Promise<void> {
  await db.insert(ledgerEntries).values([
    { storeId: input.storeId, type: "charge", cents: input.totalCents, chargeId: input.chargeId },
    {
      storeId: input.storeId,
      type: "commission",
      cents: -input.commissionCents,
      chargeId: input.chargeId,
    },
  ]);
}
