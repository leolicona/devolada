import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { charges, isps } from "../db/schema";
import { WispHub } from "../wisphub/client";
import { attemptReconnection } from "../wisphub/reconnection";

/* The reconnection queue (reconnection-queue spec). The charge row is the
   queue (D2): one cron sweep per minute claims what is due, attempts it,
   and writes the next date back. No extra service holds state the admin
   feed cannot read. */

/* D3: the wait after each failed attempt. Five waits, so six attempts in
   all — the inline one when the store records the charge, then five
   retries across about five hours. When the list runs out there is
   nothing left to schedule and the charge is `failed`. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;

/* D5: a rejected key is the ISP's to fix, so it waits without counting */
const AUTH_RETRY_MINUTES = 30;

/* D4: the lease a claimed charge holds while its attempt runs */
const LEASE_MINUTES = 2;

const BATCH = 20;
const minutes = (n: number) => n * 60 * 1000;

export type SweepReport = {
  claimed: number;
  reconnected: number;
  stillQueued: number;
  failed: number;
};

/* The first attempt, made inline when the store records the charge
   (charge-record D2). Shares the scheduling rules with the sweep. */
export function firstAttemptSchedule(
  result: { status: "reconnected" | "queued"; error: string | null },
  now: Date,
): { attempts: number; nextAttemptAt: Date | null } {
  if (result.status === "reconnected") return { attempts: 1, nextAttemptAt: null };
  if (result.error === "WISPHUB_AUTH_FAILED") {
    return { attempts: 0, nextAttemptAt: new Date(now.getTime() + minutes(AUTH_RETRY_MINUTES)) };
  }
  return { attempts: 1, nextAttemptAt: new Date(now.getTime() + minutes(BACKOFF_MINUTES[0])) };
}

export async function sweepReconnections(env: Bindings, now: Date = new Date()): Promise<SweepReport> {
  const db = drizzle(env.DB);
  const report: SweepReport = { claimed: 0, reconnected: 0, stillQueued: 0, failed: 0 };

  const due = await db
    .select()
    .from(charges)
    .where(
      and(
        eq(charges.reconnectionStatus, "queued"),
        isNotNull(charges.nextAttemptAt),
        lte(charges.nextAttemptAt, now),
      ),
    )
    .orderBy(charges.nextAttemptAt)
    .limit(BATCH);
  if (!due.length) return report;

  /* D4: lease first. An overlapping sweep skips these, and if this one
     dies mid-attempt they come back in two minutes instead of never. */
  await db
    .update(charges)
    .set({ nextAttemptAt: new Date(now.getTime() + minutes(LEASE_MINUTES)) })
    .where(
      inArray(
        charges.id,
        due.map((c) => c.id),
      ),
    );
  report.claimed = due.length;

  /* One key per ISP, not per charge */
  const ispIds = [...new Set(due.map((c) => c.ispId))];
  const ispRows = await db.select().from(isps).where(inArray(isps.id, ispIds));
  const keyByIsp = new Map(ispRows.map((i) => [i.id, i.wisphubApiKey]));

  for (const charge of due) {
    const apiKey = keyByIsp.get(charge.ispId);
    if (!apiKey) {
      /* Same shape as a rejected key: nothing to retry until Configuración */
      await db
        .update(charges)
        .set({
          lastError: "WISPHUB_NOT_CONFIGURED",
          nextAttemptAt: new Date(now.getTime() + minutes(AUTH_RETRY_MINUTES)),
        })
        .where(eq(charges.id, charge.id));
      report.stillQueued++;
      continue;
    }

    const result = await attemptReconnection(
      new WispHub(apiKey, env.WISPHUB_BASE_URL),
      charge.wisphubCustomerId,
      charge.monthlyFeeCents,
      now,
      charge.wisphubInvoiceId,
    );

    if (result.status === "reconnected") {
      await db
        .update(charges)
        .set({
          reconnectionStatus: "reconnected",
          reconnectedAt: now,
          reconnectionAttempts: charge.reconnectionAttempts + 1,
          wisphubInvoiceId: result.invoiceId,
          nextAttemptAt: null,
          lastError: null,
        })
        .where(eq(charges.id, charge.id));
      report.reconnected++;
      continue;
    }

    /* D5: a rejected key waits without spending an attempt */
    if (result.error === "WISPHUB_AUTH_FAILED") {
      await db
        .update(charges)
        .set({
          wisphubInvoiceId: result.invoiceId,
          lastError: result.error,
          nextAttemptAt: new Date(now.getTime() + minutes(AUTH_RETRY_MINUTES)),
        })
        .where(eq(charges.id, charge.id));
      report.stillQueued++;
      continue;
    }

    const attempts = charge.reconnectionAttempts + 1;
    const wait = BACKOFF_MINUTES[attempts - 1];
    await db
      .update(charges)
      .set({
        reconnectionAttempts: attempts,
        wisphubInvoiceId: result.invoiceId,
        lastError: result.error,
        ...(wait === undefined
          ? { reconnectionStatus: "failed" as const, nextAttemptAt: null }
          : { nextAttemptAt: new Date(now.getTime() + minutes(wait)) }),
      })
      .where(eq(charges.id, charge.id));
    if (wait === undefined) report.failed++;
    else report.stillQueued++;
  }

  return report;
}

/* Kept for the dev sweep endpoint: how many charges are waiting. */
export async function queuedCount(env: Bindings): Promise<number> {
  const db = drizzle(env.DB);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(charges)
    .where(eq(charges.reconnectionStatus, "queued"));
  return Number(row?.n ?? 0);
}
