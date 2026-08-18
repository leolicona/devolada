import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { customerContacts } from "../db/schema";

/* Phones the shopkeeper captured (customer-phone spec). WispHub's
   `telefono` is read-only through its API, so a number captured at the
   counter can only live here. */

type Db = DrizzleD1Database<Record<string, never>>;

/* Digits only, exactly the national 10 — the shape the receipt's
   `toWhatsAppPhone` prefixes with 52. Anything else is not a phone. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

/* D4: WispHub wins, ours fills the gap. Callers pass what WispHub said;
   we only answer for the customers it had nothing for. */
export async function capturedPhones(
  db: Db,
  ispId: string,
  wisphubCustomerIds: string[],
): Promise<Map<string, string>> {
  if (!wisphubCustomerIds.length) return new Map();
  const rows = await db
    .select()
    .from(customerContacts)
    .where(
      and(
        eq(customerContacts.ispId, ispId),
        inArray(customerContacts.wisphubCustomerId, wisphubCustomerIds),
      ),
    );
  return new Map(rows.map((r) => [r.wisphubCustomerId, r.phone]));
}

export async function capturedPhone(
  db: Db,
  ispId: string,
  wisphubCustomerId: string,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(customerContacts)
    .where(
      and(
        eq(customerContacts.ispId, ispId),
        eq(customerContacts.wisphubCustomerId, wisphubCustomerId),
      ),
    );
  return row?.phone ?? null;
}

/* D3/D5: remembered per customer, and a later capture replaces the
   earlier one — a wrong number is corrected by typing a new one. */
export async function rememberPhone(
  db: Db,
  ispId: string,
  wisphubCustomerId: string,
  phone: string,
): Promise<void> {
  await db
    .insert(customerContacts)
    .values({ ispId, wisphubCustomerId, phone })
    .onConflictDoUpdate({
      target: [customerContacts.ispId, customerContacts.wisphubCustomerId],
      set: { phone, updatedAt: new Date() },
    });
}
