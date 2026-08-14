import { and, eq, sum } from "drizzle-orm";
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

/* Accumulated commission: the store's earnings so far, as a positive
   number (commission entries are negative in the ledger). */
export async function commissionEarnedCents(
  db: ReturnType<typeof drizzle>,
  storeId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sum(ledgerEntries.cents) })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.storeId, storeId), eq(ledgerEntries.type, "commission")));
  return -Number(row?.total ?? 0);
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
