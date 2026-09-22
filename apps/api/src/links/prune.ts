import { and, eq, inArray, isNull, lt, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import {
  businesses,
  linkPrunes,
  paymentLinks,
  payments,
  proofRejections,
  wisphubPages,
  wisphubSweeps,
} from "../db/schema";

/* The one-time cleanup (links-on-demand-search FR-023, D13).

   The retired roster created a panel link for every customer of every
   tenant, on every read — roughly 6,513 of them on the connected ISP
   alone, nearly all of which nobody ever sent. This pass deletes the
   ones that were made before this feature shipped and that no payment
   and no clave attempt ever referenced, and tells the business how many
   went.

   **The boundary is a constant, not "when it ran".** Three things force
   that (D13):

   1. It cannot ride a migration. Migrations are applied while the
      PREVIOUS Worker is still serving, and that Worker still runs the
      roster — it would recreate within the minute what the migration
      deleted.
   2. It must never delete a link FR-008 has just created. A boundary of
      "now" would delete the feature's own output on a slow tenant.
   3. A second run must be a no-op, which a fixed past timestamp makes
      true by construction.

   **What this costs, recorded because the spec chose it knowingly.**
   Devolada has no record that a link was ever SENT — no copy, no send,
   no payer visit. A link an operator sent last week and one the sweep
   made that nobody touched are identical in the data. This deletes
   both, and the first customer's copy stops working. FR-024 is the
   consequence: they get a new link at a new address the next time an
   operator acts, and nothing reissues the old one. */

/* The feature's ship timestamp. Set at the RELEASE commit (tasks T057),
   never before: a value in the future makes the pass delete nothing,
   which is exactly what every environment should do until the code that
   stops recreating links is actually live.
   `0` therefore means "not yet shipped" — no link was created before
   the epoch, so nothing is in scope. */
export const PRUNE_CUTOVER_MS = 0;

export type PruneReport = {
  /* Businesses pruned this tick */
  businesses: number;
  /* Panel links deleted across them */
  links: number;
  /* Orphaned `roster` sweep rows deleted (D12 left them behind) */
  sweeps: number;
};

/* How many businesses one tick takes. The pass runs once per business
   and never again, so the whole platform drains in a few minutes at
   this rate — and one minute's tick stays inside the budget it shares
   with every other sweep on the trigger. */
const PER_TICK = 25;

export async function prunePanelLinks(env: Bindings, now: Date = new Date()): Promise<PruneReport> {
  const db = drizzle(env.DB);
  const report: PruneReport = { businesses: 0, links: 0, sweeps: 0 };

  /* The row's EXISTENCE is what stops a second run (D13), so the work
     list is "businesses with no row" */
  const pending = await db
    .select({ id: businesses.id })
    .from(businesses)
    .leftJoin(linkPrunes, eq(linkPrunes.businessId, businesses.id))
    .where(isNull(linkPrunes.businessId))
    .limit(PER_TICK);
  if (!pending.length) return report;

  for (const business of pending) {
    const deleted = await pruneOne(db, business.id, now);
    report.businesses++;
    report.links += deleted.links;
    report.sweeps += deleted.sweeps;
  }
  return report;
}

async function pruneOne(
  db: DrizzleD1Database,
  businessId: string,
  now: Date,
): Promise<{ links: number; sweeps: number }> {
  /* The two foreign keys that point at `payment_links.id` are the only
     durable evidence a link was ever used. Read as id lists rather than
     as a NOT EXISTS: D1 binds a bounded number of parameters, and a
     business's used links are few — the whole point of the prune is
     that almost none were. */
  const paid = await db
    .select({ id: payments.paymentLinkId })
    .from(payments)
    .where(eq(payments.businessId, businessId));
  const attempted = await db
    .select({ id: proofRejections.paymentLinkId })
    .from(proofRejections)
    .where(eq(proofRejections.businessId, businessId));
  const used = [...new Set([...paid, ...attempted].map((row) => row.id))];

  const doomed = await db
    .select({ id: paymentLinks.id })
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.businessId, businessId),
        /* An API link is never touched, whatever its age: the business's
           own software made it and still holds its address (Edge Cases) */
        eq(paymentLinks.source, "panel"),
        /* D13: the constant, never "when the prune ran" */
        lt(paymentLinks.createdAt, new Date(PRUNE_CUTOVER_MS)),
        ...(used.length ? [notInArray(paymentLinks.id, used)] : []),
      ),
    );

  if (doomed.length) {
    const ids = doomed.map((row) => row.id);
    /* One statement per chunk, under D1's parameter cap */
    for (let i = 0; i < ids.length; i += 50) {
      await db.delete(paymentLinks).where(inArray(paymentLinks.id, ids.slice(i, i + 50)));
    }
  }

  /* D12 left these behind: the sweep kind nothing reads any more. The
     `sweep_kind` enum keeps both values — narrowing it would be a
     non-additive migration for no gain — so the rows are what go. */
  const orphans = await db
    .select({ id: wisphubSweeps.id })
    .from(wisphubSweeps)
    .where(and(eq(wisphubSweeps.businessId, businessId), eq(wisphubSweeps.kind, "roster")));
  await db
    .delete(wisphubPages)
    .where(and(eq(wisphubPages.businessId, businessId), eq(wisphubPages.kind, "roster")));
  if (orphans.length) {
    await db
      .delete(wisphubSweeps)
      .where(and(eq(wisphubSweeps.businessId, businessId), eq(wisphubSweeps.kind, "roster")));
  }

  /* Written once, whatever the count — a business with no pre-cutover
     links is pruned too, and is told nothing (data-model.md). The
     insert is what makes the pass idempotent, so it lands last: a tick
     that died mid-delete runs again and finds less to do. */
  await db
    .insert(linkPrunes)
    .values({ businessId, ranAt: now, deletedCount: doomed.length })
    .onConflictDoNothing();

  return { links: doomed.length, sweeps: orphans.length };
}

/* What the business is owed once (FR-023): the count, or null when
   there is nothing to tell — the pass has not run for them, it deleted
   nothing, or an operator has already dismissed it. */
export async function pruneNoticeFor(
  db: DrizzleD1Database,
  businessId: string,
): Promise<{ deletedCount: number; ranAt: number } | null> {
  const [row] = await db.select().from(linkPrunes).where(eq(linkPrunes.businessId, businessId));
  if (!row || row.noticeSeen || row.deletedCount === 0) return null;
  return { deletedCount: row.deletedCount, ranAt: row.ranAt.getTime() };
}

/* Idempotent: dismissing twice is not an error (contract) */
export async function dismissPruneNotice(db: DrizzleD1Database, businessId: string): Promise<void> {
  await db
    .update(linkPrunes)
    .set({ noticeSeen: true })
    .where(eq(linkPrunes.businessId, businessId));
}
