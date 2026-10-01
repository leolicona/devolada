import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { businesses, payments } from "../db/schema";
import { integrationsFor } from "../integrations/store";
import { outcomeOf, parseHypothesis, settleDispatch } from "../integrations/dispatch";
/* provider-address-per-isp D4: the sweep already loads each business's
   integration row, so it passes that row — never a platform value.
   cash-at-stores D9: and reaches the business's system by capability,
   never by provider name (constitution IX). */
import { capabilitiesOf } from "../integrations/registry";

/* The reconnection queue (reconnection-queue spec). The payment row is the
   queue (D2; business-and-memberships D6 merged the charge twin into it): one cron sweep per minute claims what is due, attempts it,
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
  /* bug: queue-retry-forgets-action — registered without reconnecting,
     because the row's decision said so */
  registered: number;
  stillQueued: number;
  failed: number;
};

/* bug: queue-retry-forgets-action — the decision a retry runs. The row's
   own, written when the dispatch was decided; a row queued before the
   fix has none, and keeps the reconnect it was always retried with
   (the fallback `dispatchObserved` already used). */
export function decidedActionOf(row: { decidedAction: string | null; observedAction: string | null }) {
  return parseHypothesis(row.decidedAction ?? row.observedAction ?? "register_and_reconnect:reconnect");
}

/* The first attempt, made inline when the store records the charge
   (charge-record D2). Shares the scheduling rules with the sweep. */
export function firstAttemptSchedule(
  result: { status: "reconnected" | "queued" | "withheld"; error: string | null },
  now: Date,
): { attempts: number; nextAttemptAt: Date | null } {
  /* Both terminal: one because the service came back, the other because
     it was deliberately not restored (partial-payment D5). Neither is
     something the sweep should touch again. */
  if (result.status !== "queued") return { attempts: 1, nextAttemptAt: null };
  /* cash-at-stores D9: the core's word for a refused key */
  if (result.error === "INTEGRATION_AUTH_FAILED") {
    return { attempts: 0, nextAttemptAt: new Date(now.getTime() + minutes(AUTH_RETRY_MINUTES)) };
  }
  return { attempts: 1, nextAttemptAt: new Date(now.getTime() + minutes(BACKOFF_MINUTES[0])) };
}

export async function sweepReconnections(env: Bindings, now: Date = new Date()): Promise<SweepReport> {
  const db = drizzle(env.DB);
  const report: SweepReport = { claimed: 0, reconnected: 0, registered: 0, stillQueued: 0, failed: 0 };

  const due = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.actionOutcome, "queued"),
        isNotNull(payments.nextAttemptAt),
        lte(payments.nextAttemptAt, now),
      ),
    )
    .orderBy(payments.nextAttemptAt)
    .limit(BATCH);
  if (!due.length) return report;

  /* D4: lease first. An overlapping sweep skips these, and if this one
     dies mid-attempt they come back in two minutes instead of never. */
  await db
    .update(payments)
    .set({ nextAttemptAt: new Date(now.getTime() + minutes(LEASE_MINUTES)) })
    .where(
      inArray(
        payments.id,
        due.map((c) => c.id),
      ),
    );
  report.claimed = due.length;

  /* One key per ISP, not per charge — from the integration row
     (integrations-hub D2). The row carries the installation too
     (provider-address-per-isp D4), so the sweep addresses each charge to
     its own ISP's WispHub and never to a platform value: two businesses
     in one batch reach two different installations. */
  const ispIds = [...new Set(due.map((c) => c.businessId))];
  const integrationByBusiness = await integrationsFor(db, ispIds);
  /* bug: wisphub-payment-utc-time — each charge is registered on its own
     ISP's clock, so two businesses in one batch write two local times */
  const ispRows = await db
    .select({ id: businesses.id, timezone: businesses.timezone })
    .from(businesses)
    .where(inArray(businesses.id, ispIds));
  const ispById = new Map(ispRows.map((i) => [i.id, i]));

  for (const charge of due) {
    const integration = integrationByBusiness.get(charge.businessId);
    const actions = integration ? capabilitiesOf(integration, env).paymentActions : undefined;
    if (!integration?.apiKey || !actions) {
      /* Same shape as a rejected key: nothing to retry until Configuración */
      await db
        .update(payments)
        .set({
          actionError: "WISPHUB_NOT_CONFIGURED",
          nextAttemptAt: new Date(now.getTime() + minutes(AUTH_RETRY_MINUTES)),
        })
        .where(eq(payments.id, charge.id));
      report.stillQueued++;
      continue;
    }
    const business = ispById.get(charge.businessId);
    if (!business) continue; /* unreachable: the FK guarantees it */

    /* bug: queue-retry-forgets-action — the verdict's decision, never
       the adapter's default */
    const { action, reconnect } = decidedActionOf(charge);
    const result = await actions.attempt({
      business,
      /* D8: lookups need the usuario; the numeric id only serves the
         auto-activate PATCH. Charges from before 0006 have no stored
         usuario — the old identifier keeps their (broken) behavior. */
      usuario: charge.customerUsuario ?? charge.wisphubCustomerId ?? "",
      providerCustomerId: charge.wisphubCustomerId ?? "",
      /* What this payment registers against the debt (partial-payment
         D9), stored at confirmation so a retry days later registers the
         same number — not a debt that moved meanwhile. */
      registeredCents: charge.registeredCents ?? 0,
      invoiceId: charge.wisphubInvoiceId,
      paymentRegistered: charge.paymentRegisteredAt !== null,
      reconnect,
      now,
    });
    /* The payment landing is progress worth keeping even when the
       attempt as a whole did not convert (D8) */
    const paymentRegisteredAt = result.paymentRegistered
      ? (charge.paymentRegisteredAt ?? now)
      : null;

    /* bug: queue-retry-forgets-action — a register-only retry ends when
       the money lands: `done` under register_only, `withheld` under a
       threshold's withhold (integrations-hub D7). Both terminal, like a
       reconnection. */
    if (result.status === "withheld") {
      const outcome = outcomeOf(result.status, action);
      await db
        .update(payments)
        .set({
          actionOutcome: outcome,
          ...(outcome === "done" ? { actionDoneAt: now } : {}),
          actionAttempts: charge.actionAttempts + 1,
          wisphubInvoiceId: result.invoiceId,
          paymentRegisteredAt,
          nextAttemptAt: null,
          actionError: null,
        })
        .where(eq(payments.id, charge.id));
      await settleDispatch(db, charge.id, "acked", null, now);
      report.registered++;
      continue;
    }

    if (result.status === "reconnected") {
      await db
        .update(payments)
        .set({
          /* adapter says "reconnected"; the row says the generic word */
          actionOutcome: "done",
          actionDoneAt: now,
          actionAttempts: charge.actionAttempts + 1,
          wisphubInvoiceId: result.invoiceId,
          paymentRegisteredAt,
          nextAttemptAt: null,
          actionError: null,
        })
        .where(eq(payments.id, charge.id));
      /* integrations-hub D6: the decision that queued this closes acked */
      await settleDispatch(db, charge.id, "acked", null, now);
      report.reconnected++;
      continue;
    }

    /* D5: a rejected key waits without spending an attempt */
    if (result.error === "INTEGRATION_AUTH_FAILED") {
      await db
        .update(payments)
        .set({
          wisphubInvoiceId: result.invoiceId,
          paymentRegisteredAt,
          actionError: result.error,
          nextAttemptAt: new Date(now.getTime() + minutes(AUTH_RETRY_MINUTES)),
        })
        .where(eq(payments.id, charge.id));
      report.stillQueued++;
      continue;
    }

    const attempts = charge.actionAttempts + 1;
    const wait = BACKOFF_MINUTES[attempts - 1];
    await db
      .update(payments)
      .set({
        actionAttempts: attempts,
        wisphubInvoiceId: result.invoiceId,
        paymentRegisteredAt,
        actionError: result.error,
        ...(wait === undefined
          ? { actionOutcome: "failed" as const, nextAttemptAt: null }
          : { nextAttemptAt: new Date(now.getTime() + minutes(wait)) }),
      })
      .where(eq(payments.id, charge.id));
    if (wait === undefined) {
      /* integrations-hub D6: the schedule is spent — the ledger says so */
      await settleDispatch(db, charge.id, "failed", result.error, now);
      report.failed++;
    } else report.stillQueued++;
  }

  return report;
}

/* Kept for the dev sweep endpoint: how many payments are waiting. */
export async function queuedCount(env: Bindings): Promise<number> {
  const db = drizzle(env.DB);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(payments)
    .where(eq(payments.actionOutcome, "queued"));
  return Number(row?.n ?? 0);
}
