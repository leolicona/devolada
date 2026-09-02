import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { integrationOf } from "../../integrations/store";
import { WispHub, WispHubError } from "../../wisphub/client";
import { pendingInvoicesForDisplay } from "../../wisphub/cache";
import type { PaymentRequestsResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* The Cobros section's live read (cobros-live spec, US-R01). Display
   only, so it goes through the 30-second cache (D3) — every decision
   that moves money keeps reading the adapter directly (debt truth).
   Every member reads: "who owes me" is the daily question (D4). */
export async function listPaymentRequests(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const integration = await integrationOf(db, actor.id);
  if (!integration?.apiKey) {
    /* D9: without an integration there are no Cobros to read */
    return c.json({ success: false, error: { code: "NOT_CONFIGURED" } }, 409);
  }

  const now = new Date();
  try {
    const wisphub = new WispHub(integration.apiKey, c.env.WISPHUB_BASE_URL);
    const pending = await pendingInvoicesForDisplay(actor.id, wisphub, now);
    const data: PaymentRequestsResponse = {
      cobros: pending.invoices.map((f) => ({
        externalId: f.invoiceId,
        customerUsuario: f.usuario,
        customerName: f.customerName,
        amountCents: f.totalCents,
        invoiceDate: f.invoiceDate,
        dueDate: f.dueDate,
      })),
      complete: pending.complete,
      readAt: now.getTime(),
    };
    return c.json({ success: true, data });
  } catch (e) {
    if (e instanceof WispHubError) {
      /* D7: the section says so — error state with Reintentar */
      return c.json({ success: false, error: { code: "WISPHUB_UNAVAILABLE" } }, 503);
    }
    throw e;
  }
}
