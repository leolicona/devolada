import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { businesses, paymentLinks, payments, storeLedger } from "../db/schema";
import type { Bindings } from "../env";
import { integrationOf, type Integration } from "../integrations/store";
import { announcingWriter, settleConfirmed } from "../direct-payments/validation";
import { recordCollection } from "../store-ledger";
import type { Defer } from "../webhooks/queue";

/* cash-at-stores T072 (SC-003, SC-005, FR-039; D15, D19, D25) — a cash
   payment always ends settled and in the cash book.

   The record is three writes: the row, the settlement, the `collection`
   movement. A request that dies between them (a lost signal can end the
   Worker mid-request) used to leave a row `validating` for good — no fee,
   no movement, no action — while the retry with the same key answered its
   folio as if all were well. Now:

   - the row is born carrying everything its settlement needs: the
     customer, the debt's two halves and the invoice the payment pays;
   - it is born LEASED on `next_attempt_at`, which no sweep reads while
     `action_outcome` is null (the queue takes `queued` rows only, the
     validation sweep `next_validation_at` ones), so whoever settles it
     holds the lease and nobody settles twice;
   - a retry with the same key, and the every-minute sweep below, finish a
     row whose lease ran out, and write a movement a settled row lacks. */

type DB = DrizzleD1Database;
type Payment = typeof payments.$inferSelect;
type Isp = typeof businesses.$inferSelect;

/* Long enough for one record to settle; short enough that a stranded
   payment is finished within the SC-002 window */
export const SETTLE_LEASE_MS = 2 * 60_000;

const BATCH = 25;

/* The lease a fresh row is born with */
export const settleLeaseFrom = (now: Date) => new Date(now.getTime() + SETTLE_LEASE_MS);

/* Takes an unsettled cash row whose lease ran out, or null when it is
   settled, or someone else is settling it right now */
export async function claimUnsettled(db: DB, id: string, now: Date): Promise<Payment | null> {
  const [row] = await db
    .update(payments)
    .set({ nextAttemptAt: settleLeaseFrom(now) })
    .where(
      and(
        eq(payments.id, id),
        eq(payments.channel, "store"),
        eq(payments.status, "validating"),
        isNull(payments.actionOutcome),
        or(isNull(payments.nextAttemptAt), lte(payments.nextAttemptAt, now)),
      ),
    )
    .returning();
  return row ?? null;
}

/* The settlement and the movement of one leased cash row, from what the
   row carries. The first action attempt runs past the response when a
   `defer` is given, and is otherwise due at once for the queue (D25). */
export async function settleStoreRow(
  env: Bindings,
  db: DB,
  row: Payment,
  opts: { business?: Isp; integration?: Integration; defer?: Defer; now?: Date } = {},
): Promise<Payment> {
  const now = opts.now ?? new Date();
  const [business] = opts.business ? [opts.business] : await db.select().from(businesses).where(eq(businesses.id, row.businessId));
  const integration = opts.integration ?? (await integrationOf(db, row.businessId));
  const [link] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, row.paymentLinkId));
  if (!business || !integration || !link || !row.customerUsuario || !row.wisphubCustomerId) {
    throw new Error(`store payment ${row.id} cannot be settled: its business, integration, link or customer is missing`);
  }
  const settled = await settleConfirmed(env, db, {
    payment: row,
    business,
    integration,
    customer: {
      usuario: row.customerUsuario,
      providerCustomerId: row.wisphubCustomerId,
      name: row.customerName ?? row.customerUsuario,
      zone: row.customerZone,
      /* D18: never kept — the receipt reads it live */
      phone: null,
    },
    receivedCents: row.amountCents,
    /* D14: the fresh debt the record read, kept on the row */
    debtCents: row.invoiceCents + row.carriedBalanceCents,
    /* D13: the store's fee stays outside settle() and classifyPayment() —
       fed in, a $15 fee would quietly turn a $490 payment of a $500 debt
       into a registered $500 */
    serviceFeeCents: 0,
    invoiceId: row.wisphubInvoiceId,
    now,
    update: announcingWriter(env, db, row, link, now, opts.defer),
    verdictFields: {},
    hold: null,
    firstAttempt: { mode: "deferred", defer: opts.defer },
  });
  /* D19: + the amount applied, once per payment */
  await recordCollection(db, settled, now);
  return settled;
}

/* A retry with the same key, or the race's loser: finish what the first
   try left, then answer the row as it stands. A row still leased is being
   settled by the first try — the folio is the answer. */
export async function finishCollection(env: Bindings, db: DB, row: Payment, defer?: Defer): Promise<Payment> {
  const now = new Date();
  if (row.status === "validating") {
    const claimed = await claimUnsettled(db, row.id, now);
    return claimed ? settleStoreRow(env, db, claimed, { defer, now }) : row;
  }
  /* settled, and the movement idempotent by its unique index */
  await recordCollection(db, row, now);
  return row;
}

export type FinishReport = { settled: number; movements: number; failed: number };

/* The every-minute pass (`src/index.ts`): cash rows a dead request left
   unsettled past their lease, and settled ones missing their movement.
   Speaks only when it did something. */
export async function sweepUnsettledCollections(env: Bindings, now: Date = new Date()): Promise<FinishReport> {
  const db = drizzle(env.DB);
  const report: FinishReport = { settled: 0, movements: 0, failed: 0 };

  const stranded = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.channel, "store"),
        eq(payments.status, "validating"),
        isNull(payments.actionOutcome),
        or(isNull(payments.nextAttemptAt), lte(payments.nextAttemptAt, now)),
      ),
    )
    .limit(BATCH);
  for (const { id } of stranded) {
    const claimed = await claimUnsettled(db, id, now);
    if (!claimed) continue;
    try {
      await settleStoreRow(env, db, claimed, { now });
      report.settled++;
    } catch (e) {
      report.failed++;
      console.error(`settling stranded store payment ${id} failed:`, e);
    }
  }

  /* A settled row whose movement never landed (the request died between
     the two writes). Old enough that its own request is surely done. */
  const unbooked = await db
    .select({ payment: payments })
    .from(payments)
    .leftJoin(storeLedger, and(eq(storeLedger.paymentId, payments.id), eq(storeLedger.kind, "collection")))
    .where(
      and(
        eq(payments.channel, "store"),
        inArray(payments.status, ["confirmed", "partial"]),
        isNull(storeLedger.id),
        lt(payments.createdAt, new Date(now.getTime() - SETTLE_LEASE_MS)),
      ),
    )
    .limit(BATCH);
  for (const { payment } of unbooked) {
    await recordCollection(db, payment, now);
    report.movements++;
  }
  return report;
}
