import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { integrationOf } from "../../integrations/store";
import { WispHubError } from "../../wisphub/client";
/* provider-address-per-isp D4 */
import { wisphubFor } from "../../wisphub/factory";
import { readPendingInvoices } from "../../wisphub/snapshot";
import type { PaymentRequestsResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* The Cobros section's live read (cobros-live spec, US-R01). Display
   only, so it goes through the 30-second cache (D3) — or, for a tenant
   no request can read whole, the sweep's last finished pass, the same
   list every money path reads (bug: pending-invoice-cap).
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
    const wisphub = wisphubFor(integration, c.env);
    /* presence-freshness D6: the key carries the tenant's last
       registration, so a payment registered anywhere is a miss here */
    const pending = await readPendingInvoices(db, actor.id, wisphub, now, { display: true });

    /* links-on-demand-search D16: the batch lookup of stored links is
       GONE, and with it the chunking under D1's parameter cap that
       `bug: cobros-links-lookup-params` exists for. The row carried a
       link because the roster had already created one for every
       customer; under FR-008 most debtors have none, and a link without
       a phone is exactly the field that sent the operator to WhatsApp's
       contact picker. Both buttons press `POST /direct-payments/links`
       now — one read, one rule, and the number rides along with it. */
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
      /* presence-freshness D7 (BUG-018): when WispHub was asked, not now */
      readAt: pending.readAt,
    };
    return c.json({ success: true, data });
  } catch (e) {
    if (e instanceof WispHubError) {
      /* D7: the section says so. The code travels as the adapter named
         it (bug cobros-installation-fallback): WISPHUB_UNAVAILABLE is
         weather and earns a Reintentar; WISPHUB_AUTH_FAILED is a setup
         problem the screen sends to Integraciones — a retry re-sends the
         same key to the same installation. Folding the two into one
         code is what let a good key on the wrong installation
         (provider-address-per-isp D5, the pilot's row with no choice
         recorded) read as an outage for a day.

         Logged here because nothing else on this path does: the screen
         said "no pudimos cargar" and no line said why. The detail is a
         status or a timeout, never the key (007 FR-013). */
      console.error("wisphub failure:", e.code, e.message);
      return c.json({ success: false, error: { code: e.code } }, 503);
    }
    throw e;
  }
}
