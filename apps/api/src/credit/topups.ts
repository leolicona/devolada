import { and, asc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { businesses, creditEntries, paymentLinks, payments, topUps } from "../db/schema";
import { isApiLink, realOnly } from "../direct-payments/links";
import { enqueueDelivery } from "../webhooks/queue";
import { consta, ConstaError, type ConstaRequest } from "../consta";
import { nextValidationSlot, suggestedSlot } from "../direct-payments/schedule";
import { getSetting } from "../platform/settings";
import { creditSummary } from "./index";

/* prepaid-credit D6 (US-B05) — a top-up is the platform's own
   transaction: the business pays, the platform receives. It reuses the
   payment lifecycle's machinery (Consta's two doors, D7's schedule, the
   lease discipline) against the PLATFORM's account from the operator's
   settings, under the platform's own attribution — never a business's
   (consta-api-merge D3: a NULL owner on the engine's row) — and is
   billed to nobody. On a valid CEP the CEP's amount is credited. */

type DB = DrizzleD1Database<Record<string, unknown>>;
export type TopUp = typeof topUps.$inferSelect;

const LEASE_MINUTES = 2;
const BATCH = 20;
const minutes = (n: number) => n * 60 * 1000;

export async function validateTopUp(env: Bindings, db: DB, topUp: TopUp, now: Date): Promise<TopUp> {
  const update = async (values: Partial<typeof topUps.$inferInsert>): Promise<TopUp> => {
    const [row] = await db.update(topUps).set(values).where(eq(topUps.id, topUp.id)).returning();
    return row;
  };
  const retryLater = (error: string, opts: { lateSlot?: boolean; suggestedAt?: Date | null } = {}) => {
    const slot = nextValidationSlot(topUp.createdAt, now, opts);
    return update(
      slot
        ? { lastError: error, nextValidationAt: slot }
        : { status: "expired", lastError: error, nextValidationAt: null },
    );
  };

  if (!env.APICEP_TOKEN) return retryLater("PROVIDER_NOT_CONFIGURED");
  const [clabe, bank, name] = await Promise.all([
    getSetting(db, "topup_clabe"),
    getSetting(db, "topup_bank"),
    getSetting(db, "topup_beneficiary"),
  ]);
  /* operator-panel D1: an unset account means "top-ups unavailable" —
     the form already says so; a row that got here waits, it does not die */
  if (!clabe || !bank) return retryLater("TOPUP_NOT_CONFIGURED");
  const beneficiary = { bank, clabe, ...(name ? { name } : {}) };

  const request: ConstaRequest =
    topUp.proofMode === "transfer"
      ? {
          transfer: {
            date: topUp.transferDate ?? now.toISOString().slice(0, 10),
            amountCents: topUp.claimedCents,
            senderBank: topUp.senderBank ?? "",
            trackingKey: topUp.trackingKey ?? "",
            beneficiary,
          },
        }
      : { receipt: { proofKey: topUp.proofKey ?? "" }, beneficiary };

  /* Same carve-out as direct-payment D8: a prior attempt may have set the
     provider's replay flag; the counter is written before the call. */
  const isRetry = topUp.validationAttempts > 0 || topUp.constaStatus !== null;
  const attempts = topUp.validationAttempts + 1;
  await db.update(topUps).set({ validationAttempts: attempts }).where(eq(topUps.id, topUp.id));

  let verdict;
  try {
    /* prepaid-credit D6 / payments-and-classes D7: a top-up is the
       platform's own transaction, so it ALWAYS validates under the
       platform — never the business (consta-api-merge D3: NULL owner). */
    verdict = await consta(env, db, { platform: true }).validate(request);
  } catch (e) {
    const code = e instanceof ConstaError ? e.code : "PROVIDER_UNAVAILABLE";
    console.error("top-up validation failed:", code);
    return retryLater(code);
  }
  const base = {
    validationAttempts: attempts,
    constaValidationId: verdict.validationId,
    constaStatus: verdict.status,
  };

  if (verdict.alreadyValidated && !isRetry) {
    /* One transfer credits once (direct-payment D8's rule) */
    return update({ ...base, status: "invalid", lastError: "TRANSFER_ALREADY_USED", nextValidationAt: null });
  }
  if (verdict.status === "pending") {
    return update({ ...base, ...(await pendingWrite(retryLater, "CEP_PENDING", false, verdict.retryAfter)) });
  }
  if (verdict.status === "invalid" && verdict.reason !== "contradicted") {
    /* direct-payment D17: not_found is not a refusal */
    return update({ ...base, ...(await pendingWrite(retryLater, "TRANSFER_NOT_FOUND", true, verdict.retryAfter)) });
  }
  if (verdict.status === "invalid") {
    return update({ ...base, status: "invalid", lastError: "TRANSFER_CONTRADICTED", nextValidationAt: null });
  }

  /* valid: the CEP's amount is what arrived (claimed-amount D1) */
  const credited = verdict.cep?.amountCents ?? topUp.claimedCents;
  const row = await update({
    ...base,
    status: "credited",
    creditedCents: credited,
    trackingKey: verdict.cep?.trackingKey ?? topUp.trackingKey,
    confirmedAt: now,
    nextValidationAt: null,
    lastError: null,
  });
  try {
    await db.insert(creditEntries).values({
      businessId: topUp.businessId,
      kind: "top_up",
      cents: credited,
      topUpId: topUp.id,
    });
  } catch (e) {
    /* The partial unique index on top_up_id: booked once, whatever retries */
    if (!String(e).includes("UNIQUE")) throw e;
  }
  return row;
}

/* A pending write goes through retryLater (which may expire the row) and
   returns nothing extra to merge — the helper exists so the two pending
   branches above stay one line each. */
async function pendingWrite(
  retryLater: (error: string, opts?: { lateSlot?: boolean; suggestedAt?: Date | null }) => Promise<TopUp>,
  error: string,
  lateSlot: boolean,
  retryAfter: string | undefined,
): Promise<Record<string, never>> {
  await retryLater(error, { lateSlot, suggestedAt: suggestedSlot(retryAfter) });
  return {};
}

export type TopUpSweepReport = { claimed: number; credited: number; stillValidating: number; invalid: number; expired: number };

/* Rides the every-minute scheduled handler with the other sweeps (D7). */
export async function sweepTopUps(env: Bindings, now: Date = new Date()): Promise<TopUpSweepReport> {
  const db = drizzle(env.DB);
  const report: TopUpSweepReport = { claimed: 0, credited: 0, stillValidating: 0, invalid: 0, expired: 0 };
  const due = await db
    .select()
    .from(topUps)
    .where(and(eq(topUps.status, "validating"), isNotNull(topUps.nextValidationAt), lte(topUps.nextValidationAt, now)))
    .orderBy(topUps.nextValidationAt)
    .limit(BATCH);
  if (!due.length) return report;
  await db
    .update(topUps)
    .set({ nextValidationAt: new Date(now.getTime() + minutes(LEASE_MINUTES)) })
    .where(inArray(topUps.id, due.map((t) => t.id)));
  report.claimed = due.length;
  for (const topUp of due) {
    try {
      const row = await validateTopUp(env, db, topUp, now);
      if (row.status === "credited") report.credited++;
      else if (row.status === "invalid") report.invalid++;
      else if (row.status === "expired") report.expired++;
      else report.stillValidating++;
    } catch (e) {
      console.error(`top-up sweep failed for ${topUp.id}:`, e);
      report.stillValidating++;
    }
  }
  return report;
}

/* prepaid-credit D8: when a top-up or an adjustment lifts a business
   above the cap, its queued proofs go back to `validating` in arrival
   order — staggered by a second each so the direct sweep, which orders
   by next_validation_at, keeps that order. Runs every minute before the
   direct sweep; a business still paused releases nothing. */
export async function releaseQueuedForCredit(env: Bindings, now: Date = new Date()): Promise<number> {
  const db = drizzle(env.DB);
  /* The link rides along (automated-collections-api D17): a released
     API-link payment announces `validating` again, and the row's kind
     decides that without a second read per payment */
  const queued = await db
    .select({ id: payments.id, businessId: payments.businessId, link: paymentLinks })
    .from(payments)
    .innerJoin(paymentLinks, eq(paymentLinks.id, payments.paymentLinkId))
    /* automated-collections-api D12: a test row is never queued by the
       payer's door, and one the caller rehearsed into this state moves
       only when the caller says — never by a sweep */
    .where(and(eq(payments.status, "queued_for_credit"), realOnly(payments)))
    .orderBy(asc(payments.createdAt), asc(payments.id));
  if (!queued.length) return 0;
  const byBusiness = new Map<string, typeof queued>();
  for (const row of queued) byBusiness.set(row.businessId, [...(byBusiness.get(row.businessId) ?? []), row]);
  let released = 0;
  for (const [businessId, rows] of byBusiness) {
    const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
    if (!business) continue;
    /* payments-and-classes D9: suspension freezes the queue exactly as
       the credit pause does — queued rows included. */
    if (business.status === "suspended") continue;
    const { step } = await creditSummary(db, business);
    if (step === "paused") continue;
    for (const [i, { id, link }] of rows.entries()) {
      const [row] = await db
        .update(payments)
        .set({ status: "validating", nextValidationAt: new Date(now.getTime() + i * 1000) })
        .where(eq(payments.id, id))
        .returning();
      /* automated-collections-api D17 (FR-013): the caller heard
         `queued_for_credit`; it hears `validating` again as the row
         moves. A sweep has no `waitUntil`, so the webhook sweep chained
         after the direct one delivers it this same minute. */
      if (isApiLink(link)) await enqueueDelivery(db, { payment: row, link, now });
      released++;
    }
  }
  return released;
}
