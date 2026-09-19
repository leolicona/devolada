import { and, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { payments, wisphubPendingPages, wisphubPendingSweeps } from "../db/schema";
import { integrationOf } from "../integrations/store";
import {
  PENDING_LIVE_PAGES,
  WispHubError,
  type PendingInvoice,
  type PendingInvoices,
  type WispHub,
} from "./client";
import { pendingInvoicesForDisplay, pendingVersion } from "./cache";
/* provider-address-per-isp D4: the sweep's clients come from the factory */
import { wisphubFor } from "./factory";

/* The tenant's pending invoices, read in the background
   (bug: pending-invoice-cap).

   WispHub's invoice list has no customer filter, so "what does this
   customer owe" is answered by reading the whole tenant. A request can
   pay five pages (`PENDING_LIVE_PAGES`); a 6,509-customer ISP needs
   sixty-odd, 30–40 s at the measured 0.4–0.6 s per call. So the reads
   split by size, decided by data and never by config:

     - a tenant whose list fits the live budget is read live, as before —
       fresh, and complete by construction;
     - a tenant whose list does not fit is read by the every-minute sweep,
       `SWEEP_PAGES` per tick, and every reader — the payer's page, the
       submission, the verdict, Cobros — serves the last FINISHED pass.

   This amends provider-latency D3 ("money paths read the adapter fresh"):
   for a large tenant fresh is impossible, and the choice is between a
   list minutes old and a list that is wrong. The customer record stays
   live in every path and outranks the snapshot for its own customer
   (`debt.ts`), and an invoice the snapshot names is re-read fresh before
   money is registered against it (`validation.ts`). */

/* Pages per tick: ~5 s at the measured rate, inside one instance's
   budget (provider-latency D1) with room for a slow day. A 66-page
   tenant finishes a pass in seven ticks. */
export const SWEEP_PAGES = 10;
/* A tenant that fits the live budget rests this long between passes —
   its readers never use the snapshot, so the pass only re-measures the
   size. A cut-off live read clears the rest at once. */
export const REST_MS = 30 * 60_000;
/* Past this age a finished pass still answers positives (an invoice it
   lists is a debt) but no longer proves an absence: the sweep has been
   failing for several passes' worth of ticks. */
export const SERVED_MAX_AGE_MS = 45 * 60_000;
/* A pass in flight this long is abandoned and restarted: its window has
   drifted and its early pages describe another day. */
export const STUCK_PASS_MS = 60 * 60_000;
/* The tick's lease (reconnection-queue D4): an overlapping trigger
   skips a claimed tenant instead of racing its cursor. */
const LEASE_MS = 55_000;

type DB = DrizzleD1Database;
type SweepRow = typeof wisphubPendingSweeps.$inferSelect;

export type PendingRead = PendingInvoices & {
  /* When WispHub was asked (presence-freshness D7): the finished pass's
     end for a snapshot, the call itself for a live read */
  readAt: number;
};

/* Every reader of the pending list comes through here. `display` takes
   the 30-second cache on the live path (provider-latency D3); a money
   path leaves it false and reads the adapter directly, as before. */
export async function readPendingInvoices(
  db: DB,
  businessId: string,
  wisphub: WispHub,
  now: Date,
  opts: { display?: boolean } = {},
): Promise<PendingRead> {
  const [row] = await db
    .select()
    .from(wisphubPendingSweeps)
    .where(eq(wisphubPendingSweeps.businessId, businessId));
  if (row && servesSnapshot(row, wisphub)) {
    const snapshot = await readSnapshot(db, row, now);
    if (snapshot) return snapshot;
  }

  const live = opts.display
    ? await pendingInvoicesForDisplay(businessId, wisphub, now, await pendingVersion(db, businessId))
    : { ...(await wisphub.pendingInvoices(now)), readAt: now.getTime() };
  /* A cut-off read is the signal the sweep exists for: from here on this
     tenant is read in the background, and the next tick starts. */
  if (!live.complete) await wakePendingSweep(db, businessId, wisphub.baseUrl, now);
  return { ...live, source: live.source ?? "live" };
}

/* A finished pass longer than the live budget, read from the address
   the tenant is on today (provider-address-per-isp T046). A shorter one
   means the live read is complete on its own, and fresher. */
function servesSnapshot(row: SweepRow, wisphub: WispHub): boolean {
  return (
    row.baseUrl === wisphub.baseUrl &&
    row.servedPassId !== null &&
    (row.servedPages ?? 0) > PENDING_LIVE_PAGES
  );
}

async function readSnapshot(db: DB, row: SweepRow, now: Date): Promise<PendingRead | null> {
  const servedPassId = row.servedPassId!;
  const passIds = row.livePassId ? [servedPassId, row.livePassId] : [servedPassId];
  const pages = await db
    .select({
      passId: wisphubPendingPages.passId,
      page: wisphubPendingPages.page,
      rows: wisphubPendingPages.rows,
    })
    .from(wisphubPendingPages)
    .where(
      and(
        eq(wisphubPendingPages.businessId, row.businessId),
        inArray(wisphubPendingPages.passId, passIds),
      ),
    )
    .orderBy(wisphubPendingPages.page);
  /* The served pass's pages are collected a tick after the swap (see
     `tick`), so a reader that loaded the row first still finds them. A
     row whose pages are gone is treated as no snapshot at all. */
  if (!pages.some((p) => p.passId === servedPassId)) return null;

  /* A positive is a positive from either pass, and the pass in flight
     is the newer one: an invoice issued after the served pass began
     shows up as soon as the sweep reaches it, not a whole pass later. */
  const byId = new Map<number, PendingInvoice>();
  for (const passId of passIds) {
    for (const page of pages) {
      if (page.passId !== passId) continue;
      for (const invoice of JSON.parse(page.rows) as PendingInvoice[]) byId.set(invoice.invoiceId, invoice);
    }
  }

  /* What Devolada itself registered since the oldest page served is
     paid, whatever the snapshot says — the same fact presence-freshness
     D6 keys the display cache by. */
  const oldest = Math.min(
    row.servedStartedAt?.getTime() ?? now.getTime(),
    row.liveStartedAt?.getTime() ?? Number.POSITIVE_INFINITY,
  );
  const registered = await db
    .select({ invoiceId: payments.wisphubInvoiceId })
    .from(payments)
    .where(
      and(
        eq(payments.businessId, row.businessId),
        isNotNull(payments.wisphubInvoiceId),
        gte(payments.paymentRegisteredAt, new Date(oldest)),
      ),
    );
  for (const r of registered) if (r.invoiceId !== null) byId.delete(r.invoiceId);

  const finishedAt = row.servedFinishedAt?.getTime() ?? 0;
  return {
    invoices: [...byId.values()],
    complete: now.getTime() - finishedAt <= SERVED_MAX_AGE_MS,
    source: "snapshot",
    readAt: finishedAt,
  };
}

/* Born on the first cut-off live read; cleared of its rest on every
   later one. Idempotent, and it makes no provider call. */
export async function wakePendingSweep(db: DB, businessId: string, baseUrl: string, now: Date): Promise<void> {
  await db
    .insert(wisphubPendingSweeps)
    .values({ businessId, baseUrl, restUntil: null, updatedAt: now })
    .onConflictDoUpdate({
      target: wisphubPendingSweeps.businessId,
      set: { restUntil: null, updatedAt: now },
    });
}

export type PendingSweepReport = { tenants: number; pages: number; finished: number; failed: number };

/* One tick of the sweep, riding the every-minute trigger
   (`index.ts`, "sweeps ride one trigger"). Speaks only when it did
   something: the report is empty for a minute with nothing to read. */
export async function sweepPendingInvoices(env: Bindings, now: Date = new Date()): Promise<PendingSweepReport> {
  const db = drizzle(env.DB);
  const report: PendingSweepReport = { tenants: 0, pages: 0, finished: 0, failed: 0 };

  const due = await db
    .select()
    .from(wisphubPendingSweeps)
    .where(
      and(
        or(isNull(wisphubPendingSweeps.restUntil), lte(wisphubPendingSweeps.restUntil, now)),
        or(isNull(wisphubPendingSweeps.claimedUntil), lte(wisphubPendingSweeps.claimedUntil, now)),
      ),
    );

  for (const row of due) {
    const claimed = await db
      .update(wisphubPendingSweeps)
      .set({ claimedUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now })
      .where(
        and(
          eq(wisphubPendingSweeps.businessId, row.businessId),
          or(isNull(wisphubPendingSweeps.claimedUntil), lte(wisphubPendingSweeps.claimedUntil, now)),
        ),
      )
      .returning({ businessId: wisphubPendingSweeps.businessId });
    if (!claimed.length) continue;
    report.tenants++;
    try {
      await tick(db, env, row, now, report);
    } finally {
      await db
        .update(wisphubPendingSweeps)
        .set({ claimedUntil: null })
        .where(eq(wisphubPendingSweeps.businessId, row.businessId));
    }
  }
  return report;
}

async function tick(db: DB, env: Bindings, row: SweepRow, now: Date, report: PendingSweepReport): Promise<void> {
  const patch = (set: Partial<typeof wisphubPendingSweeps.$inferInsert>) =>
    db
      .update(wisphubPendingSweeps)
      .set({ ...set, updatedAt: now })
      .where(eq(wisphubPendingSweeps.businessId, row.businessId));

  const integration = await integrationOf(db, row.businessId);
  if (!integration?.apiKey) {
    /* Disconnected since: nothing to read. The row rests instead of
       leaving — a key saved again wakes it on its first cut-off read. */
    await patch({ restUntil: new Date(now.getTime() + REST_MS), lastError: "WISPHUB_NOT_CONFIGURED" });
    return;
  }
  const wisphub = wisphubFor(integration, env);
  let state: SweepRow = row;

  /* Garbage, one tick late on purpose: pages of a pass that is neither
     served nor in flight. The delay is what keeps a reader that loaded
     the row just before a swap from finding an empty pass. */
  const keep = [state.servedPassId, state.livePassId].filter((id): id is string => id !== null);
  await db
    .delete(wisphubPendingPages)
    .where(
      and(
        eq(wisphubPendingPages.businessId, row.businessId),
        keep.length ? notInArray(wisphubPendingPages.passId, keep) : undefined,
      ),
    );

  if (state.baseUrl !== wisphub.baseUrl) {
    /* provider-address-per-isp T046: the tenant moved installation, and
       everything read from the old one is somebody else's list */
    const reset = {
      baseUrl: wisphub.baseUrl,
      servedPassId: null,
      servedPages: null,
      servedStartedAt: null,
      servedFinishedAt: null,
      livePassId: null,
      liveCursor: null,
      livePages: 0,
      liveStartedAt: null,
    };
    await patch(reset);
    state = { ...state, ...reset };
  }

  if (
    state.livePassId !== null &&
    state.liveStartedAt !== null &&
    now.getTime() - state.liveStartedAt.getTime() > STUCK_PASS_MS
  ) {
    const abandoned = { livePassId: null, liveCursor: null, livePages: 0, liveStartedAt: null };
    await patch(abandoned);
    state = { ...state, ...abandoned };
  }

  if (state.livePassId === null) {
    const started = {
      livePassId: crypto.randomUUID(),
      liveCursor: wisphub.pendingInvoicesPath(now),
      livePages: 0,
      liveStartedAt: now,
    };
    await patch(started);
    state = { ...state, ...started };
  }

  try {
    for (let i = 0; i < SWEEP_PAGES && state.liveCursor !== null; i++) {
      const { invoices, next } = await wisphub.pendingInvoicesPage(state.liveCursor);
      await db
        .insert(wisphubPendingPages)
        .values({
          businessId: row.businessId,
          passId: state.livePassId!,
          page: state.livePages,
          rows: JSON.stringify(invoices),
          fetchedAt: now,
        })
        .onConflictDoUpdate({
          target: [wisphubPendingPages.businessId, wisphubPendingPages.passId, wisphubPendingPages.page],
          set: { rows: JSON.stringify(invoices), fetchedAt: now },
        });
      report.pages++;
      state = { ...state, livePages: state.livePages + 1, liveCursor: next };

      if (next === null) {
        /* The swap: readers serve this pass from the next query on. A
           tenant that fit the live budget goes back to resting — its
           readers read live — and one that did not is read again at once. */
        await patch({
          servedPassId: state.livePassId,
          servedPages: state.livePages,
          servedStartedAt: state.liveStartedAt,
          servedFinishedAt: now,
          livePassId: null,
          liveCursor: null,
          livePages: 0,
          liveStartedAt: null,
          restUntil: state.livePages > PENDING_LIVE_PAGES ? null : new Date(now.getTime() + REST_MS),
          lastError: null,
        });
        report.finished++;
        return;
      }
      /* Progress is kept page by page: a tick that dies here resumes
         from this cursor, never from the top */
      await patch({ liveCursor: next, livePages: state.livePages });
    }
  } catch (e) {
    const code = e instanceof WispHubError ? e.code : "WISPHUB_UNAVAILABLE";
    report.failed++;
    console.warn(
      `pending-invoice sweep failed for ${row.businessId}:`,
      e instanceof Error ? e.message : String(e),
    );
    /* reconnection-queue D5: a rejected key is the ISP's to fix, so it
       waits without hammering; an outage retries next minute from the
       same cursor */
    await patch({
      lastError: code,
      ...(code === "WISPHUB_AUTH_FAILED" ? { restUntil: new Date(now.getTime() + REST_MS) } : {}),
    });
  }
}
