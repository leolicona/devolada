import { inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { payments, stores } from "../db/schema";
import type { ActionAttemptInput } from "../integrations/capabilities";

/* payment-method-per-channel D2, D10: what the core hands the adapter to
   tie a recorded payment back to Devolada — values in the core's words,
   never the text. The adapter writes them in its provider's format and
   limits (D7); the core names no provider's method (FR-011).

   Nothing about the payer is read here: not the customer's name, phone
   or account (FR-007). The folio finds the payment in Pagos, the clave
   finds the bank line, the store's name says who holds the cash. */

type DB = DrizzleD1Database;
type Row = Pick<typeof payments.$inferSelect, "channel" | "folio" | "trackingKey" | "storeId">;

/* D10: the store's name is read when the payment is recorded, so the
   reference carries the name as it is then. A store renamed later
   touches no payment already recorded (FR-006): once the money landed,
   no attempt records it again. One query for a whole batch, as the sweep
   already reads its businesses; none when no row has a store. */
export async function storeNamesFor(db: DB, rows: Pick<Row, "storeId">[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.storeId).filter((id): id is string => id !== null))];
  if (!ids.length) return new Map();
  const found = await db.select({ id: stores.id, name: stores.name }).from(stores).where(inArray(stores.id, ids));
  return new Map(found.map((s) => [s.id, s.name]));
}

export function recordReferenceOf(row: Row, names: Map<string, string>): ActionAttemptInput["recordReference"] {
  return {
    folio: row.folio,
    /* A store row's clave is not a bank's: the cash has none */
    trackingKey: row.channel === "spei" ? row.trackingKey : null,
    storeName: row.storeId ? (names.get(row.storeId) ?? null) : null,
  };
}
