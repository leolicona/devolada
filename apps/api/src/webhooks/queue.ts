import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { apiWebhooks, payments, webhookDeliveries } from "../db/schema";
import type { ApiLink } from "../direct-payments/links";
import { isVerdictEvent, makeEventId, renderEvent } from "./events";
import { SIGNING_KEY_MISSING, signDelivery } from "./sign";
import { WEBHOOK_HEADERS, type WebhookEventType } from "../routes/v1/webhook/schema";

/* The webhook queue (automated-collections-api D8). The row is the
   queue, exactly as the reconnection queue is the payment row
   (reconnection-queue D2): a first attempt runs inline at the verdict
   under `waitUntil` (FR-017 — the payer's verdict never waits on the
   caller's endpoint), retries are claimed by a lease in a sweep that
   rides the every-minute cron — no new trigger (constitution) — and the
   sweep speaks only when it did something. */

type DB = DrizzleD1Database;
export type Delivery = typeof webhookDeliveries.$inferSelect;
type DirectPayment = typeof payments.$inferSelect;

/* D8: the same five waits the reconnection queue uses, so the product
   has one retry rhythm to explain — six attempts over about five hours,
   then `failed`, readable and re-sendable (FR-016, FR-041). */
export const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;

/* D8 (set by the developer, 2026-09-17): an attempt waits this long for
   a 2xx; no answer counts as a failure like any other (FR-016). Ten
   seconds is generous for an endpoint that only records an event, and
   short enough that one dead destination cannot hold the every-minute
   sweep past its own cadence with the whole batch in flight. */
export const DELIVERY_TIMEOUT_MS = 10_000;

/* D10, constitution VIII: with no signing key nothing is attempted —
   an unsigned webhook would break FR-015. The row waits without
   spending an attempt, the way the reconnection queue waits on a
   rejected key (reconnection-queue D5), and is picked up again once
   the secret lands. */
const UNSIGNED_RETRY_MINUTES = 30;

/* The lease a claimed row holds while its attempt runs (reconnection-
   queue D4): an overlapping sweep skips it, and if this one dies
   mid-attempt it comes back in two minutes instead of never. */
const LEASE_MINUTES = 2;
const BATCH = 20;
const minutes = (n: number) => n * 60 * 1000;

/* What a delivery attempt may be handed to so it runs past the
   handler's return: `ctx.waitUntil` in a Worker. Absent, the row simply
   waits for the sweep, which is due the same minute. */
export type Defer = (work: Promise<unknown>) => void;

export type EnqueueOptions = {
  payment: DirectPayment;
  link: Pick<ApiLink, "id" | "customerRef" | "askCents">;
  now: Date;
};

/* Record that the payment entered a state, for the business's endpoint
   (FR-013). No address registered → nothing is sent and nothing fails
   (spec US2 scenario 8): returns null and writes nothing. A verdict's
   enqueue also marks the payment's after-money outcome `queued` — the
   webhook IS an API payment's mapped action (data-model, FR-026); a
   pre-verdict delivery never touches that column. */
export async function enqueueDelivery(db: DB, opts: EnqueueOptions): Promise<Delivery | null> {
  const { payment, link, now } = opts;
  const [endpoint] = await db
    .select({ id: apiWebhooks.id })
    .from(apiWebhooks)
    .where(eq(apiWebhooks.businessId, payment.businessId));
  if (!endpoint) return null;

  const eventId = makeEventId();
  const { type, body } = renderEvent(payment, link, eventId, now);
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      businessId: payment.businessId,
      paymentId: payment.id,
      eventId,
      eventType: type,
      payload: body,
      status: "pending",
      attempts: 0,
      /* due now: the inline attempt leases it first; failing that, the
         sweep chained after the verdict's own sweep finds it this minute */
      nextAttemptAt: now,
    })
    .returning();
  if (isVerdictEvent(type)) {
    await db
      .update(payments)
      .set({ actionOutcome: "queued", actionAttempts: 0, actionError: null, actionDoneAt: null })
      .where(eq(payments.id, payment.id));
  }
  return delivery;
}

/* Enqueue and, when the caller can defer work, attempt at once (FR-017:
   under `waitUntil`, never in the verdict's own path). */
export async function enqueueAndDeliver(env: Bindings, db: DB, opts: EnqueueOptions, defer?: Defer): Promise<Delivery | null> {
  const delivery = await enqueueDelivery(db, opts);
  if (delivery && defer) {
    defer(
      attemptDelivery(env, db, delivery, opts.now).catch((e) => {
        console.error(`webhook delivery ${delivery.id} first attempt failed:`, e);
      }),
    );
  }
  return delivery;
}

export type AttemptResult = "delivered" | "pending" | "failed" | "unsigned";

/* One attempt (FR-016): POST the stored body, signed now with the
   active key (D10 — a re-send may carry a newer `kid` than the first
   attempt did), wait DELIVERY_TIMEOUT_MS for a 2xx, and write the
   result on the row, on the endpoint's health, and — for a verdict —
   on the payment's outcome. */
export async function attemptDelivery(env: Bindings, db: DB, delivery: Delivery, now: Date): Promise<AttemptResult> {
  /* Lease first, so an overlapping sweep skips this row (D8) */
  await db
    .update(webhookDeliveries)
    .set({ nextAttemptAt: new Date(now.getTime() + minutes(LEASE_MINUTES)) })
    .where(eq(webhookDeliveries.id, delivery.id));

  const [endpoint] = await db.select().from(apiWebhooks).where(eq(apiWebhooks.businessId, delivery.businessId));
  if (!endpoint) {
    /* The address was removed while this was pending: nothing to send
       to. Terminal, and named, rather than a row the sweep re-reads
       every minute forever. */
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", nextAttemptAt: null, lastError: "ENDPOINT_REMOVED" })
      .where(eq(webhookDeliveries.id, delivery.id));
    await settlePaymentOutcome(db, delivery, "failed", delivery.attempts, "ENDPOINT_REMOVED", now);
    return "failed";
  }

  const timestamp = now.getTime();
  const signed = await signDelivery(env, timestamp, delivery.payload);
  if (!signed) {
    await db
      .update(webhookDeliveries)
      .set({ lastError: SIGNING_KEY_MISSING, nextAttemptAt: new Date(now.getTime() + minutes(UNSIGNED_RETRY_MINUTES)) })
      .where(eq(webhookDeliveries.id, delivery.id));
    return "unsigned";
  }

  const timeoutMs = Number(env.WEBHOOK_DELIVERY_TIMEOUT_MS ?? DELIVERY_TIMEOUT_MS);
  let responseStatus: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WEBHOOK_HEADERS.eventId]: delivery.eventId,
        [WEBHOOK_HEADERS.timestamp]: String(timestamp),
        [WEBHOOK_HEADERS.keyId]: signed.kid,
        [WEBHOOK_HEADERS.signature]: `v1=${signed.signature}`,
      },
      body: delivery.payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
    responseStatus = res.status;
    if (!res.ok) error = `HTTP_${res.status}`;
  } catch (e) {
    /* What `AbortSignal.timeout` throws when the deadline fires — a
       TimeoutError by the spec, an AbortError in workerd today (the same
       pair wisphub/client.ts and the apiCEP provider read); everything
       else is the network's */
    const name = e instanceof Error ? e.name : "";
    error = name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "UNREACHABLE";
  }

  const attempts = delivery.attempts + 1;
  if (error === null) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "delivered",
        attempts,
        keyId: signed.kid,
        responseStatus,
        lastError: null,
        deliveredAt: now,
        nextAttemptAt: null,
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    await db
      .update(apiWebhooks)
      .set({ consecutiveFailures: 0, lastSuccessAt: now })
      .where(eq(apiWebhooks.id, endpoint.id));
    await settlePaymentOutcome(db, delivery, "done", attempts, null, now);
    return "delivered";
  }

  const wait = BACKOFF_MINUTES[attempts - 1];
  const spent = wait === undefined;
  await db
    .update(webhookDeliveries)
    .set({
      attempts,
      keyId: signed.kid,
      responseStatus,
      lastError: error,
      ...(spent
        ? { status: "failed" as const, nextAttemptAt: null }
        : { nextAttemptAt: new Date(now.getTime() + minutes(wait)) }),
    })
    .where(eq(webhookDeliveries.id, delivery.id));
  /* FR-018: the endpoint's health, what the panel reads */
  await db
    .update(apiWebhooks)
    .set({ consecutiveFailures: sql`${apiWebhooks.consecutiveFailures} + 1`, lastFailureAt: now })
    .where(eq(apiWebhooks.id, endpoint.id));
  await settlePaymentOutcome(db, delivery, spent ? "failed" : "queued", attempts, error, now);
  return spent ? "failed" : "pending";
}

/* FR-026 / data-model: an API payment's after-money outcome reflects the
   VERDICT's delivery only — `done` when accepted, `queued` while
   retried, `failed` when the schedule is spent. A pre-verdict delivery
   never writes it: its failures live on the delivery row and on the
   panel's health line, where endpoint trouble belongs. */
async function settlePaymentOutcome(
  db: DB,
  delivery: Delivery,
  outcome: "done" | "queued" | "failed",
  attempts: number,
  error: string | null,
  now: Date,
): Promise<void> {
  if (!delivery.paymentId || !isVerdictEvent(delivery.eventType as WebhookEventType)) return;
  await db
    .update(payments)
    .set({
      actionOutcome: outcome,
      actionAttempts: attempts,
      actionError: error,
      ...(outcome === "done" ? { actionDoneAt: now } : {}),
    })
    .where(eq(payments.id, delivery.paymentId));
}

/* FR-041: a failed delivery goes back to `pending` with the SAME event
   id and the SAME body (D9); the next attempt signs it with the key
   active then (D10). The schedule starts over — the business fixed its
   endpoint, and six more tries is what a fresh delivery gets. */
export async function requeueDelivery(db: DB, delivery: Delivery, now: Date): Promise<Delivery> {
  const [row] = await db
    .update(webhookDeliveries)
    .set({ status: "pending", attempts: 0, nextAttemptAt: now, lastError: null, responseStatus: null })
    .where(eq(webhookDeliveries.id, delivery.id))
    .returning();
  if (delivery.paymentId && isVerdictEvent(delivery.eventType as WebhookEventType)) {
    await db
      .update(payments)
      .set({ actionOutcome: "queued", actionAttempts: 0, actionError: null })
      .where(eq(payments.id, delivery.paymentId));
  }
  return row;
}

export type WebhookSweepReport = {
  claimed: number;
  delivered: number;
  stillPending: number;
  failed: number;
  unsigned: number;
};

export async function sweepWebhookDeliveries(env: Bindings, now: Date = new Date()): Promise<WebhookSweepReport> {
  const db = drizzle(env.DB);
  const report: WebhookSweepReport = { claimed: 0, delivered: 0, stillPending: 0, failed: 0, unsigned: 0 };

  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        isNotNull(webhookDeliveries.nextAttemptAt),
        lte(webhookDeliveries.nextAttemptAt, now),
      ),
    )
    .orderBy(webhookDeliveries.nextAttemptAt)
    .limit(BATCH);
  if (!due.length) return report;

  /* Lease the whole batch first (D8); each attempt renews its own */
  await db
    .update(webhookDeliveries)
    .set({ nextAttemptAt: new Date(now.getTime() + minutes(LEASE_MINUTES)) })
    .where(
      inArray(
        webhookDeliveries.id,
        due.map((d) => d.id),
      ),
    );
  report.claimed = due.length;

  for (const delivery of due) {
    try {
      const result = await attemptDelivery(env, db, delivery, now);
      if (result === "delivered") report.delivered++;
      else if (result === "failed") report.failed++;
      else if (result === "unsigned") report.unsigned++;
      else report.stillPending++;
    } catch (e) {
      /* One broken row must not stall the rest; the lease brings it back */
      console.error(`webhook sweep failed for ${delivery.id}:`, e);
      report.stillPending++;
    }
  }
  /* D10: once per run, not once per row — the condition is the
     platform's and the fix is one secret */
  if (report.unsigned) {
    console.warn(`webhook sweep: ${report.unsigned} deliveries waiting on WEBHOOK_SIGNING_KEYS (${SIGNING_KEY_MISSING})`);
  }
  return report;
}
