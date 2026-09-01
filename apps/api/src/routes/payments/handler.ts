import type { Context } from "hono";
import { and, count, desc, eq, gte, inArray, lt, lte, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { payments } from "../../db/schema";
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

/* The ISP's live feed (charge-feed spec). Tenant isolation by businessId (D6). */
export async function listPaymentFeed(
  c: Ctx,
  q: {
    cursor?: number;
    status?: "queued" | "reconnected" | "failed" | "withheld";
    from?: number;
    to?: number;
  },
) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const PAGE = 20;

  /* Only money that arrived is a feed row (D6): confirmed and partial */
  const filters = [
    eq(payments.businessId, actor.id),
    inArray(payments.status, ["confirmed", "partial"]),
    ...(q.cursor ? [lt(payments.createdAt, new Date(q.cursor))] : []),
    ...(q.status ? [eq(payments.reconnectionStatus, q.status)] : []),
    ...(q.from ? [gte(payments.createdAt, new Date(q.from))] : []),
    ...(q.to ? [lte(payments.createdAt, new Date(q.to))] : []),
  ];

  /* `storeName` stays in the response shape until the payments merge
     revises charge-feed.spec.md (business-and-memberships D6); with the
     store network gone it is always null. */
  const rows = await db
    .select({ charge: payments })
    .from(payments)
    .where(and(...filters))
    .orderBy(desc(payments.createdAt))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);

  /* Settings D5: the ISP's timezone decides where its day starts */
  const todayStartMs = startOfBusinessDayMs(actor.timezone);
  const [t] = await db
    .select({ count: count(), total: sum(payments.receivedCents) })
    .from(payments)
    .where(
      and(
        eq(payments.businessId, actor.id),
        inArray(payments.status, ["confirmed", "partial"]),
        gte(payments.createdAt, new Date(todayStartMs)),
      ),
    );
  const today = {
    count: Number(t?.count ?? 0),
    totalCents: Number(t?.total ?? 0),
    startedAtMs: todayStartMs,
  };

  return c.json({
    success: true,
    data: {
      /* `charges` stays the key until charge-feed.spec.md's phase-4 revision */
      charges: page.map(({ charge }) => ({
        id: charge.id,
        folio: charge.folio ?? "",
        channel: charge.channel,
        reconnectionStatus: charge.reconnectionStatus ?? "queued",
        /* `totalCents` stays the response's name for what arrived until
           the phase-4 revision of charge-feed.spec.md */
        totalCents: charge.receivedCents ?? charge.amountCents,
        invoiceCents: charge.invoiceCents,
        carriedBalanceCents: charge.carriedBalanceCents,
        serviceFeeCents: charge.serviceFeeCents,
        customerName: charge.customerName ?? "",
        storeName: null,
        createdAt: charge.createdAt.getTime(),
        reconnectedAt: charge.reconnectedAt?.getTime() ?? null,
        attempts: charge.reconnectionAttempts,
        lastError: charge.reconnectionError,
      })),
      nextCursor: rows.length > PAGE ? page[page.length - 1].charge.createdAt.getTime() : null,
      today,
    },
  });
}
