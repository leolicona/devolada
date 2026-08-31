import type { Context } from "hono";
import { and, count, desc, eq, gte, lt, lte, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { charges, stores } from "../../db/schema";
import { startOfBusinessDayMs } from "../../time/business-day";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* Shared with the direct SPEI channel: one folio format, one guard */
export function makeFolio(): string {
  /* DV- + 6 uppercase base36 chars; the unique index is the real guard */
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += chars[b % 36];
  return `DV-${out}`;
}

/* The ISP's live feed (charge-feed spec). Tenant isolation by ispId (D6). */
export async function listChargeFeed(
  c: Ctx,
  q: {
    cursor?: number;
    status?: "queued" | "reconnected" | "failed" | "withheld";
    storeId?: string;
    from?: number;
    to?: number;
  },
) {
  const actor = c.get("actor");
  if (actor.type !== "isp") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const PAGE = 20;

  const filters = [
    eq(charges.ispId, actor.id),
    ...(q.cursor ? [lt(charges.createdAt, new Date(q.cursor))] : []),
    ...(q.status ? [eq(charges.reconnectionStatus, q.status)] : []),
    ...(q.storeId ? [eq(charges.storeId, q.storeId)] : []),
    ...(q.from ? [gte(charges.createdAt, new Date(q.from))] : []),
    ...(q.to ? [lte(charges.createdAt, new Date(q.to))] : []),
  ];

  /* leftJoin: a direct SPEI charge has no store (direct-payment D6) and
     must still appear in the feed */
  const rows = await db
    .select({ charge: charges, storeName: stores.name })
    .from(charges)
    .leftJoin(stores, eq(charges.storeId, stores.id))
    .where(and(...filters))
    .orderBy(desc(charges.createdAt))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);

  /* Settings D5: the ISP's timezone decides where its day starts */
  const todayStartMs = startOfBusinessDayMs(actor.timezone);
  const [t] = await db
    .select({ count: count(), total: sum(charges.totalCents) })
    .from(charges)
    .where(and(eq(charges.ispId, actor.id), gte(charges.createdAt, new Date(todayStartMs))));
  const today = {
    count: Number(t?.count ?? 0),
    totalCents: Number(t?.total ?? 0),
    startedAtMs: todayStartMs,
  };

  return c.json({
    success: true,
    data: {
      charges: page.map(({ charge, storeName }) => ({
        id: charge.id,
        folio: charge.folio,
        channel: charge.channel,
        reconnectionStatus: charge.reconnectionStatus,
        totalCents: charge.totalCents,
        invoiceCents: charge.invoiceCents,
        carriedBalanceCents: charge.carriedBalanceCents,
        serviceFeeCents: charge.serviceFeeCents,
        customerName: charge.customerName,
        storeName,
        createdAt: charge.createdAt.getTime(),
        reconnectedAt: charge.reconnectedAt?.getTime() ?? null,
        attempts: charge.reconnectionAttempts,
        lastError: charge.lastError,
      })),
      nextCursor: rows.length > PAGE ? page[page.length - 1].charge.createdAt.getTime() : null,
      today,
    },
  });
}
