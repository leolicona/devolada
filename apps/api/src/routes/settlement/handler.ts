import type { Context } from "hono";
import { and, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { charges, ledgerEntries } from "../../db/schema";
import { businessMonthKey } from "../../time/business-day";
import type { SettlementMonth, SettlementResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* 13 months of charges: 12 closed + the running one (spec D3) */
const WINDOW_DAYS = 400;
const MAX_MONTHS = 13;

/* The platform's share of one charge (spec D1): the service fee the
   charge was made with, minus the commission the ledger actually
   recorded for it. Commission entries are negative, so it is a sum. */

export async function getSettlement(c: Ctx, now: Date = new Date()) {
  const actor = c.get("actor");
  if (actor.type !== "isp") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);

  const rows = await db
    .select({
      createdAt: charges.createdAt,
      serviceFeeCents: charges.serviceFeeCents,
      commissionCents: ledgerEntries.cents,
    })
    .from(charges)
    .leftJoin(
      ledgerEntries,
      and(eq(ledgerEntries.chargeId, charges.id), eq(ledgerEntries.type, "commission")),
    )
    .where(
      and(
        eq(charges.ispId, actor.id),
        gte(charges.createdAt, new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000)),
      ),
    );

  /* Grouped here, not in SQL: SQLite knows no timezones, and the ISP's
     wall clock owns the month boundary (spec D2, settings D5). */
  const byPeriod = new Map<string, { chargeCount: number; shareCents: number }>();
  for (const row of rows) {
    const period = businessMonthKey(actor.timezone, row.createdAt);
    const bucket = byPeriod.get(period) ?? { chargeCount: 0, shareCents: 0 };
    bucket.chargeCount += 1;
    bucket.shareCents += row.serviceFeeCents + (row.commissionCents ?? 0);
    byPeriod.set(period, bucket);
  }

  const currentPeriod = businessMonthKey(actor.timezone, now);
  const months: SettlementMonth[] = [...byPeriod.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, MAX_MONTHS)
    .map(([period, bucket]) => ({
      period,
      ...bucket,
      /* spec D3: the reference the transfer travels with */
      reference: `DV-${period.replace("-", "")}-${actor.id.slice(-4)}`,
      current: period === currentPeriod,
    }));

  const data: SettlementResponse = { months };
  return c.json({ success: true, data });
}
