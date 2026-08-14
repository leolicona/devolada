import { eq, sum } from "drizzle-orm";
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
