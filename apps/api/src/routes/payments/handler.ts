import type { Context } from "hono";
import { and, count, desc, eq, gte, inArray, like, lt, lte, or, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { businesses, paymentLinks, payments } from "../../db/schema";
import { startOfBusinessDayMs, startOfIsoDateMs } from "../../time/business-day";
import { effectiveOverTreatment } from "../../direct-payments/classes";
import { signedProofUrl } from "../../direct-payments/proofs";
import type { ProofResponse } from "./schema";

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

function businessGuard(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return { error: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403) };
  }
  return { actor, db: drizzle(c.env.DB) };
}

/* The day after a calendar date, still as a calendar date — the `to`
   filter is inclusive, so the boundary is the NEXT midnight. */
function nextDayIso(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/* The ISP's live feed (payments-and-classes D4). Tenant isolation by
   businessId (charge-feed D6, unchanged in spirit). */
export async function listPaymentFeed(
  c: Ctx,
  q: {
    cursor?: number;
    status?: (typeof payments.$inferSelect)["status"];
    reconnection?: "queued" | "reconnected" | "failed" | "withheld";
    class?: "exact" | "short" | "over";
    q?: string;
    from?: string;
    to?: string;
  },
) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const { actor, db } = ctx;
  const PAGE = 20;

  /* D2: what a surplus means today, said once per response */
  const [business] = await db.select().from(businesses).where(eq(businesses.id, actor.id));

  const filters = [
    eq(payments.businessId, actor.id),
    /* D4: the whole lifecycle is filterable; the default answers money
       that arrived — confirmed, partial and (scenario 11) unapplied. */
    q.status
      ? eq(payments.status, q.status)
      : inArray(payments.status, ["confirmed", "partial", "unapplied"]),
    ...(q.cursor ? [lt(payments.createdAt, new Date(q.cursor))] : []),
    ...(q.reconnection ? [eq(payments.reconnectionStatus, q.reconnection)] : []),
    ...(q.class ? [eq(payments.reconciliationClass, q.class)] : []),
    /* D4: calendar dates on the BUSINESS's wall clock (settings D5) */
    ...(q.from
      ? [gte(payments.createdAt, new Date(startOfIsoDateMs(actor.timezone, q.from)))]
      : []),
    ...(q.to
      ? [lt(payments.createdAt, new Date(startOfIsoDateMs(actor.timezone, nextDayIso(q.to))))]
      : []),
    /* D4: customer by usuario and by name. The link's usuario covers the
       rows that never denormalized one (validating, unapplied). */
    ...(q.q
      ? [
          or(
            like(payments.customerName, `%${q.q}%`),
            like(payments.customerUsuario, `%${q.q}%`),
            like(paymentLinks.customerUsuario, `%${q.q}%`),
          ),
        ]
      : []),
  ];

  /* `storeName` stays in the response shape until the payments merge
     revises charge-feed.spec.md (business-and-memberships D6); with the
     store network gone it is always null. */
  const rows = await db
    .select({ charge: payments, linkUsuario: paymentLinks.customerUsuario })
    .from(payments)
    .innerJoin(paymentLinks, eq(paymentLinks.id, payments.paymentLinkId))
    .where(and(...filters))
    .orderBy(desc(payments.createdAt))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);

  /* Settings D5: the ISP's timezone decides where its day starts.
     "Today" keeps counting the money that landed: confirmed + partial. */
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
    total: Number(t?.total ?? 0),
    startedAtMs: todayStartMs,
  };

  return c.json({
    success: true,
    data: {
      /* payments-and-classes D6: the feed answers `payments` */
      payments: page.map(({ charge, linkUsuario }) => {
        const receivedCents = charge.receivedCents ?? charge.amountCents;
        const askedCents =
          charge.invoiceCents + charge.carriedBalanceCents + charge.serviceFeeCents;
        return {
          id: charge.id,
          folio: charge.folio ?? "",
          channel: charge.channel,
          status: charge.status,
          reconnectionStatus: charge.reconnectionStatus,
          reconciliationClass: charge.reconciliationClass,
          receivedCents,
          invoiceCents: charge.invoiceCents,
          carriedBalanceCents: charge.carriedBalanceCents,
          serviceFeeCents: charge.serviceFeeCents,
          askedCents,
          /* Below the debt no fee is covered (partial D3): the ISP and
             the payer quote the same missing figure. */
          missingCents: Math.max(
            0,
            charge.invoiceCents + charge.carriedBalanceCents - receivedCents,
          ),
          /* D3: for `unapplied` the debt at the verdict was zero, so the
             whole payment is the surplus. */
          surplusCents:
            charge.status === "unapplied"
              ? receivedCents
              : Math.max(0, receivedCents - askedCents),
          customerName: charge.customerName ?? linkUsuario,
          storeName: null,
          createdAt: charge.createdAt.getTime(),
          reconnectedAt: charge.reconnectedAt?.getTime() ?? null,
          attempts: charge.reconnectionAttempts,
          lastError: charge.reconnectionError,
        };
      }),
      nextCursor: rows.length > PAGE ? page[page.length - 1].charge.createdAt.getTime() : null,
      effectiveOverTreatment: effectiveOverTreatment(business),
      today: { count: today.count, totalCents: today.total, startedAtMs: today.startedAtMs },
    },
  });
}

/* payments-and-classes D4: the proof, whole — the CEP as Banxico
   answered it plus the payer's capture through a short-lived signed URL
   (direct-payment D12's own mechanism). Read for every role: a dispute
   is answered by whoever picks up the phone. */
export async function getPaymentProof(c: Ctx, id: string) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const { actor, db } = ctx;

  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.businessId, actor.id)));
  if (!row) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  const [business] = await db.select().from(businesses).where(eq(businesses.id, actor.id));

  /* The CEP block exists once money was confirmed against the row —
     confirmed, partial or unapplied. The CEP Consta returns carries no
     account, so the masked-CLABE rule never meets this door. */
  const validated = ["confirmed", "partial", "unapplied"].includes(row.status);
  const data: ProofResponse = {
    folio: row.folio,
    proofMode: row.proofMode,
    cep: validated
      ? {
          trackingKey: row.trackingKey,
          amountCents: row.receivedCents ?? row.claimedAmountCents ?? row.amountCents,
          date: row.transferDate,
          senderBank: row.senderBank,
          senderName: row.cepSenderName,
          beneficiaryName: business.speiBeneficiaryName,
        }
      : null,
    imageUrl: row.proofKey ? await signedProofUrl(c.env, row.proofKey, new Date()) : null,
  };
  return c.json({ success: true, data });
}

/* payments-and-classes D5: an operator puts a failed reconnection back
   in the queue — next attempt now — touching neither the payment nor the
   credit. The sweep does the rest with the idempotency it already has
   (TD-009's invoice guard); the attempt counter is spent, so one click
   buys exactly one fresh attempt. */
export async function retryReconnection(c: Ctx, id: string) {
  const ctx = businessGuard(c);
  if ("error" in ctx) return ctx.error;
  const { actor, db } = ctx;

  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.businessId, actor.id)));
  if (!row) {
    return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  }
  if (row.reconnectionStatus !== "failed") {
    return c.json({ success: false, error: { code: "NOT_RETRYABLE" } }, 409);
  }
  const now = new Date();
  const [updated] = await db
    .update(payments)
    .set({ reconnectionStatus: "queued", nextAttemptAt: now })
    .where(eq(payments.id, row.id))
    .returning();
  return c.json({
    success: true,
    data: {
      reconnectionStatus: updated.reconnectionStatus ?? "queued",
      nextAttemptAt: updated.nextAttemptAt?.getTime() ?? null,
    },
  });
}
