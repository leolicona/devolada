import { and, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { payments, wisphubPages, wisphubSweeps } from "../db/schema";
import { integrationOf } from "../integrations/store";
import { ensureLinks } from "../direct-payments/links";
import {
  PENDING_LIVE_PAGES,
  ROSTER_LIVE_PAGES,
  WispHubError,
  type PendingInvoice,
  type PendingInvoices,
  type WispHub,
  type WispHubCustomer,
} from "./client";
import { pendingInvoicesForDisplay, pendingVersion, rosterForDisplay } from "./cache";
/* provider-address-per-isp D4: the sweep's clients come from the factory */
import { wisphubFor } from "./factory";

/* The tenant's WispHub lists, read in the background
   (bug: pending-invoice-cap; generalised by bug: links-roster-cap).

   WispHub's invoice list has no customer filter, so "what does this
   customer owe" is answered by reading the whole tenant — and "who are
   my customers" is the whole tenant by definition. A request can pay a
   few pages (`PENDING_LIVE_PAGES`, `ROSTER_LIVE_PAGES`); a 6,509-customer
   ISP needs sixty-odd, 30–40 s at the measured 0.4–0.6 s per call. So
   the reads split by size, decided by data and never by config:

     - a tenant whose list fits the live budget is read live, as before —
       fresh, and complete by construction;
     - a tenant whose list does not fit is read by the every-minute sweep,
       `SWEEP_PAGES` per tick, and every reader — the payer's page, the
       submission, the verdict, Cobros, the Links roster — serves the last
       FINISHED pass.

   One sweep, two kinds of pass (`KINDS`): the same row, pages, lease,
   rest and swap; only the first path, the page fetcher and what lands
   with each page differ. Adding a list is adding a kind.

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
   lists is a debt, a customer it lists exists) but no longer proves an
   absence: the sweep has been failing for several passes' worth of
   ticks. */
export const SERVED_MAX_AGE_MS = 45 * 60_000;
/* A pass in flight this long is abandoned and restarted: its window has
   drifted and its early pages describe another day. */
export const STUCK_PASS_MS = 60 * 60_000;
/* The tick's lease (reconnection-queue D4): an overlapping trigger
   skips a claimed list instead of racing its cursor. */
const LEASE_MS = 55_000;

type DB = DrizzleD1Database;
type SweepRow = typeof wisphubSweeps.$inferSelect;
export type SweepKind = SweepRow["kind"];

/* What one kind of pass is made of. `rows` are stored as the adapter
   maps them, so a reader parses what it would have been handed live. */
type KindSpec = {
  kind: SweepKind;
  /* The in-request cap of the live read: a finished pass longer than
     this is what the readers serve, a shorter one means the live read
     is complete on its own — and fresher */
  livePages: number;
  firstPath: (wisphub: WispHub, now: Date) => string;
  page: (wisphub: WispHub, path: string) => Promise<{ rows: unknown[]; next: string | null }>;
  /* What lands with each page as it is stored, besides the page */
  onPage?: (db: DB, businessId: string, rows: unknown[]) => Promise<void>;
};

const KINDS: Record<SweepKind, KindSpec> = {
  pending: {
    kind: "pending",
    livePages: PENDING_LIVE_PAGES,
    firstPath: (wisphub, now) => wisphub.pendingInvoicesPath(now),
    page: async (wisphub, path) => {
      const { invoices, next } = await wisphub.pendingInvoicesPage(path);
      return { rows: invoices, next };
    },
  },
  roster: {
    kind: "roster",
    livePages: ROSTER_LIVE_PAGES,
    firstPath: (wisphub) => wisphub.customersPath(),
    page: async (wisphub, path) => {
      const { customers, next } = await wisphub.customersPage(path);
      return { rows: customers, next };
    },
    /* bug: links-roster-cap: the links are created where the list is
       read — a hundred customers a page, a handful of chunked statements
       — so the first open of Links on a 6,509-customer tenant is a read,
       not six hundred inserts inside one request (direct-payment D5:
       listing is what creates the missing links; now the sweep lists). */
    onPage: async (db, businessId, rows) => {
      await ensureLinks(db, businessId, rows as WispHubCustomer[]);
    },
  },
};

export type PendingRead = PendingInvoices & {
  /* When WispHub was asked (presence-freshness D7): the finished pass's
     end for a snapshot, the call itself for a live read */
  readAt: number;
};

export type RosterRead = {
  customers: WispHubCustomer[];
  complete: boolean;
  source: "live" | "snapshot";
  readAt: number;
};

async function sweepRowOf(db: DB, businessId: string, kind: SweepKind): Promise<SweepRow | undefined> {
  const [row] = await db
    .select()
    .from(wisphubSweeps)
    .where(and(eq(wisphubSweeps.businessId, businessId), eq(wisphubSweeps.kind, kind)));
  return row;
}

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
  const row = await sweepRowOf(db, businessId, "pending");
  if (row && servesSnapshot(row, wisphub)) {
    const snapshot = await snapshotRows<PendingInvoice>(db, row, now, (f) => f.invoiceId);
    if (snapshot) {
      /* What Devolada itself registered since the oldest page served is
         paid, whatever the snapshot says — the same fact
         presence-freshness D6 keys the display cache by. */
      const registered = await db
        .select({ invoiceId: payments.wisphubInvoiceId })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, businessId),
            isNotNull(payments.wisphubInvoiceId),
            gte(payments.paymentRegisteredAt, new Date(snapshot.oldest)),
          ),
        );
      for (const r of registered) if (r.invoiceId !== null) snapshot.byKey.delete(r.invoiceId);
      return {
        invoices: [...snapshot.byKey.values()],
        complete: snapshot.complete,
        source: "snapshot",
        readAt: snapshot.readAt,
      };
    }
  }

  const live = opts.display
    ? await pendingInvoicesForDisplay(businessId, wisphub, now, await pendingVersion(db, businessId))
    : { ...(await wisphub.pendingInvoices(now)), readAt: now.getTime() };
  /* A cut-off read is the signal the sweep exists for: from here on this
     tenant is read in the background, and the next tick starts. */
  if (!live.complete) await wakeSweep(db, businessId, "pending", wisphub.baseUrl, now);
  return { ...live, source: live.source ?? "live" };
}

/* Every reader of the customer list comes through here — the Links
   roster and the paged links door (bug: links-roster-cap). `display`
   takes the 30-second cache on the live path, as the roster always has;
   the paged door leaves it false and reads the adapter directly, as
   `listCustomers` did before it (US-D07 D5's recycled-id scenario pins
   that it sees WispHub's change at once). */
export async function readRoster(
  db: DB,
  businessId: string,
  wisphub: WispHub,
  now: Date,
  opts: { display?: boolean } = {},
): Promise<RosterRead> {
  const row = await sweepRowOf(db, businessId, "roster");
  if (row && servesSnapshot(row, wisphub)) {
    const snapshot = await snapshotRows<WispHubCustomer>(db, row, now, (c) => c.usuario);
    if (snapshot) {
      return {
        customers: [...snapshot.byKey.values()],
        complete: snapshot.complete,
        source: "snapshot",
        readAt: snapshot.readAt,
      };
    }
  }

  const live = opts.display
    ? await rosterForDisplay(businessId, wisphub, now)
    : { ...(await wisphub.listCustomersFull()), readAt: now.getTime() };
  if (!live.complete) await wakeSweep(db, businessId, "roster", wisphub.baseUrl, now);
  return { ...live, source: "live" };
}

/* A finished pass longer than the kind's live budget, read from the
   address the tenant is on today (provider-address-per-isp T046). A
   shorter one means the live read is complete on its own, and fresher. */
function servesSnapshot(row: SweepRow, wisphub: WispHub): boolean {
  return (
    row.baseUrl === wisphub.baseUrl &&
    row.servedPassId !== null &&
    (row.servedPages ?? 0) > KINDS[row.kind].livePages
  );
}

/* The rows a finished pass holds, plus the pass in flight's: a positive
   is a positive from either, and the pass in flight is the newer one —
   an invoice issued, or a customer added, after the served pass began
   shows up as soon as the sweep reaches it, not a whole pass later. */
async function snapshotRows<Row>(
  db: DB,
  row: SweepRow,
  now: Date,
  keyOf: (r: Row) => string | number,
): Promise<{ byKey: Map<string | number, Row>; complete: boolean; readAt: number; oldest: number } | null> {
  const servedPassId = row.servedPassId!;
  const passIds = row.livePassId ? [servedPassId, row.livePassId] : [servedPassId];
  const pages = await db
    .select({ passId: wisphubPages.passId, page: wisphubPages.page, rows: wisphubPages.rows })
    .from(wisphubPages)
    .where(
      and(
        eq(wisphubPages.businessId, row.businessId),
        eq(wisphubPages.kind, row.kind),
        inArray(wisphubPages.passId, passIds),
      ),
    )
    .orderBy(wisphubPages.page);
  /* The served pass's pages are collected a tick after the swap (see
     `tick`), so a reader that loaded the row first still finds them. A
     row whose pages are gone is treated as no snapshot at all. */
  if (!pages.some((p) => p.passId === servedPassId)) return null;

  const byKey = new Map<string | number, Row>();
  for (const passId of passIds) {
    for (const page of pages) {
      if (page.passId !== passId) continue;
      for (const r of JSON.parse(page.rows) as Row[]) byKey.set(keyOf(r), r);
    }
  }
  const finishedAt = row.servedFinishedAt?.getTime() ?? 0;
  return {
    byKey,
    complete: now.getTime() - finishedAt <= SERVED_MAX_AGE_MS,
    readAt: finishedAt,
    /* The oldest page served: what the pending reader's overlay counts from */
    oldest: Math.min(
      row.servedStartedAt?.getTime() ?? now.getTime(),
      row.liveStartedAt?.getTime() ?? Number.POSITIVE_INFINITY,
    ),
  };
}

/* Born on the first cut-off live read; cleared of its rest on every
   later one. Idempotent, and it makes no provider call. */
export async function wakeSweep(db: DB, businessId: string, kind: SweepKind, baseUrl: string, now: Date): Promise<void> {
  await db
    .insert(wisphubSweeps)
    .values({ businessId, kind, baseUrl, restUntil: null, updatedAt: now })
    .onConflictDoUpdate({
      target: [wisphubSweeps.businessId, wisphubSweeps.kind],
      set: { restUntil: null, updatedAt: now },
    });
}

export type SweepReport = { lists: number; pages: number; finished: number; failed: number };

/* One tick of the sweep, riding the every-minute trigger
   (`index.ts`, "sweeps ride one trigger"). Speaks only when it did
   something: the report is empty for a minute with nothing to read.
   `lists` counts tenant × kind — one tenant with both lists due is two. */
export async function sweepWispHubLists(env: Bindings, now: Date = new Date()): Promise<SweepReport> {
  const db = drizzle(env.DB);
  const report: SweepReport = { lists: 0, pages: 0, finished: 0, failed: 0 };

  const due = await db
    .select()
    .from(wisphubSweeps)
    .where(
      and(
        or(isNull(wisphubSweeps.restUntil), lte(wisphubSweeps.restUntil, now)),
        or(isNull(wisphubSweeps.claimedUntil), lte(wisphubSweeps.claimedUntil, now)),
      ),
    );

  for (const row of due) {
    const claimed = await db
      .update(wisphubSweeps)
      .set({ claimedUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now })
      .where(
        and(
          eq(wisphubSweeps.id, row.id),
          or(isNull(wisphubSweeps.claimedUntil), lte(wisphubSweeps.claimedUntil, now)),
        ),
      )
      .returning({ id: wisphubSweeps.id });
    if (!claimed.length) continue;
    report.lists++;
    try {
      await tick(db, env, row, now, report);
    } finally {
      await db.update(wisphubSweeps).set({ claimedUntil: null }).where(eq(wisphubSweeps.id, row.id));
    }
  }
  return report;
}

async function tick(db: DB, env: Bindings, row: SweepRow, now: Date, report: SweepReport): Promise<void> {
  const spec = KINDS[row.kind];
  const patch = (set: Partial<typeof wisphubSweeps.$inferInsert>) =>
    db
      .update(wisphubSweeps)
      .set({ ...set, updatedAt: now })
      .where(eq(wisphubSweeps.id, row.id));

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
    .delete(wisphubPages)
    .where(
      and(
        eq(wisphubPages.businessId, row.businessId),
        eq(wisphubPages.kind, row.kind),
        keep.length ? notInArray(wisphubPages.passId, keep) : undefined,
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
      liveCursor: spec.firstPath(wisphub, now),
      livePages: 0,
      liveStartedAt: now,
    };
    await patch(started);
    state = { ...state, ...started };
  }

  try {
    for (let i = 0; i < SWEEP_PAGES && state.liveCursor !== null; i++) {
      const { rows, next } = await spec.page(wisphub, state.liveCursor);
      const stored = JSON.stringify(rows);
      await db
        .insert(wisphubPages)
        .values({
          businessId: row.businessId,
          kind: row.kind,
          passId: state.livePassId!,
          page: state.livePages,
          rows: stored,
          fetchedAt: now,
        })
        .onConflictDoUpdate({
          target: [wisphubPages.businessId, wisphubPages.kind, wisphubPages.passId, wisphubPages.page],
          set: { rows: stored, fetchedAt: now },
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
          restUntil: state.livePages > spec.livePages ? null : new Date(now.getTime() + REST_MS),
          lastError: null,
        });
        report.finished++;
      } else {
        /* Progress is kept page by page: a tick that dies here resumes
           from this cursor, never from the top */
        await patch({ liveCursor: next, livePages: state.livePages });
      }

      /* After the cursor moved: a failure here costs this page's side
         effect one tick, never the page. `ensureLinks` is idempotent
         (BUG-020) and the roster read repeats it, so nothing is lost. */
      if (spec.onPage) {
        try {
          await spec.onPage(db, row.businessId, rows);
        } catch (e) {
          console.warn(`${row.kind} sweep: page side effect failed for ${row.businessId}:`, e instanceof Error ? e.message : String(e));
        }
      }
      if (next === null) return;
    }
  } catch (e) {
    const code = e instanceof WispHubError ? e.code : "WISPHUB_UNAVAILABLE";
    report.failed++;
    console.warn(
      `${row.kind} sweep failed for ${row.businessId}:`,
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
