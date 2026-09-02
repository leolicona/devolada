import { and, desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { integrationEvents } from "../db/schema";
import type { ReconciliationClass } from "../direct-payments/classes";
import type { Integration } from "./store";

/* The action side of the hub (integrations-hub D3/D5/D6).

   Pure vocabulary here plus the event ledger. The retry schedule stays
   on the payment row (reconnection-queue D2 survives unamended); the
   ledger is what the queue writes THROUGH — one row per dispatch
   decision, carrying the reconciliation class (pivot Open item 5),
   acked when the action reaches its terminal outcome. D17's webhooks
   arrive later as its second reader. */

type DB = DrizzleD1Database;
export type MappedAction = "register_and_reconnect" | "register_only";

/* D3: the class picks its mapped action. */
export function actionForClass(integration: Integration, klass: ReconciliationClass): MappedAction {
  if (klass === "exact") return integration.exactAction;
  if (klass === "short") return integration.shortAction;
  return integration.overAction;
}

/* D5: the hypothesis recorded at a gated verdict — the action plus the
   threshold's answer, both computable right there and never recomputed
   (the policy may move; the record must not). */
export function hypothesisOf(action: MappedAction, reconnect: boolean): string {
  return action === "register_only"
    ? "register_only"
    : `register_and_reconnect:${reconnect ? "reconnect" : "withhold"}`;
}

export function parseHypothesis(observed: string): { action: MappedAction; reconnect: boolean } {
  if (observed === "register_only") return { action: "register_only", reconnect: false };
  return { action: "register_and_reconnect", reconnect: observed.endsWith(":reconnect") };
}

/* The adapter speaks "reconnected"/"withheld"; the row speaks the
   generic word (D7). Under `register_only` the router was deliberately
   never asked, so the completed registration IS the mapped action done
   — "withheld" would send the ISP hunting for a threshold that never
   voted. */
export function outcomeOf(
  attemptStatus: "reconnected" | "queued" | "withheld",
  action: MappedAction,
): "done" | "queued" | "withheld" {
  if (attemptStatus === "reconnected") return "done";
  if (attemptStatus === "withheld" && action === "register_only") return "done";
  return attemptStatus;
}

/* D6: a dispatch decision opens a ledger row. Decisions, not attempts:
   the inline dispatch at the verdict, an operator's retry, an
   "Ejecutar ahora" — each is one row; the sweep's retries ride the
   decision that queued them. */
export async function recordDispatch(
  db: DB,
  event: {
    businessId: string;
    integrationId: string;
    paymentId: string;
    class: ReconciliationClass;
    action: MappedAction;
  },
): Promise<void> {
  await db.insert(integrationEvents).values(event);
}

/* The acknowledgment (D6): the open row for this payment closes with
   the terminal outcome. Best-effort by design — a ledger hiccup must
   never fail a payment that already moved money. */
export async function settleDispatch(
  db: DB,
  paymentId: string,
  status: "acked" | "failed",
  error: string | null,
  now: Date,
): Promise<void> {
  try {
    const [open] = await db
      .select({ id: integrationEvents.id })
      .from(integrationEvents)
      .where(
        and(eq(integrationEvents.paymentId, paymentId), eq(integrationEvents.status, "dispatched")),
      )
      .orderBy(desc(integrationEvents.createdAt))
      .limit(1);
    if (!open) return;
    await db
      .update(integrationEvents)
      .set({ status, error, ackedAt: now })
      .where(eq(integrationEvents.id, open.id));
  } catch (e) {
    console.error(`event ack failed for payment ${paymentId}:`, e);
  }
}
