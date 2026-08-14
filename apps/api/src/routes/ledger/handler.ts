import type { Context } from "hono";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { charges, ledgerEntries } from "../../db/schema";
import type { LedgerResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

const PAGE = 20;

export async function listLedger(c: Ctx, cursor?: number) {
  const actor = c.get("actor");
  if (actor.type !== "store") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);

  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(
      cursor
        ? and(eq(ledgerEntries.storeId, actor.id), lt(ledgerEntries.createdAt, new Date(cursor)))
        : eq(ledgerEntries.storeId, actor.id),
    )
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(PAGE + 1);

  const page = rows.slice(0, PAGE);
  const chargeIds = [...new Set(page.flatMap((r) => (r.chargeId ? [r.chargeId] : [])))];
  const chargeRows = chargeIds.length
    ? await db.select().from(charges).where(inArray(charges.id, chargeIds))
    : [];
  const byId = new Map(chargeRows.map((ch) => [ch.id, ch]));

  const data: LedgerResponse = {
    entries: page.map((r) => {
      const ch = r.chargeId ? byId.get(r.chargeId) : undefined;
      return {
        id: r.id,
        type: r.type,
        cents: r.cents,
        createdAt: r.createdAt.getTime(),
        reference: ch ? { folio: ch.folio, customerName: ch.customerName } : null,
      };
    }),
    nextCursor: rows.length > PAGE ? page[page.length - 1].createdAt.getTime() : null,
  };
  return c.json({ success: true, data });
}
