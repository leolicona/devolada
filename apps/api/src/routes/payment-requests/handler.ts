import type { Context } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { paymentLinks } from "../../db/schema";
import { integrationOf } from "../../integrations/store";
import { WispHub, WispHubError } from "../../wisphub/client";
import { pendingInvoicesForDisplay, pendingVersion } from "../../wisphub/cache";
import { toWhatsAppPhone, whatsAppLink } from "../../receipt";
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
    /* presence-freshness D6: the key carries the tenant's last
       registration, so a payment registered anywhere is a miss here */
    const pending = await pendingInvoicesForDisplay(actor.id, wisphub, now, await pendingVersion(db, actor.id));

    /* pilot-UX round: the debtor's permanent link rides the row, so
       "veo quién me debe → le mando su link" is one expansion away.
       STORED links only — the invoice list carries no numeric id to
       lazy-create with; the roster (which does) creates them all, and a
       missing one simply hides the buttons. The wa.me link has no phone
       here (the invoice row carries none): it opens WhatsApp's own
       picker with the message ready, never a stranger's chat. */
    const usuarios = [...new Set(pending.invoices.map((f) => f.usuario))];
    const links = usuarios.length
      ? await db
          .select({ customerUsuario: paymentLinks.customerUsuario, token: paymentLinks.token })
          .from(paymentLinks)
          .where(and(eq(paymentLinks.businessId, actor.id), inArray(paymentLinks.customerUsuario, usuarios)))
      : [];
    const urlByUsuario = new Map(
      links.map((l) => [l.customerUsuario, `${c.env.PAGO_BASE_URL}/p/${l.token}`]),
    );
    const shareTextFor = (url: string) =>
      `Hola, aquí está tu link de pago de internet. Guárdalo: sirve cada mes.\n\n${url}`;

    const data: PaymentRequestsResponse = {
      cobros: pending.invoices.map((f) => {
        const linkUrl = urlByUsuario.get(f.usuario) ?? null;
        return {
        externalId: f.invoiceId,
        customerUsuario: f.usuario,
        customerName: f.customerName,
        amountCents: f.totalCents,
        invoiceDate: f.invoiceDate,
        dueDate: f.dueDate,
        linkUrl,
        waLink: linkUrl ? whatsAppLink(shareTextFor(linkUrl), toWhatsAppPhone(null)) : null,
        };
      }),
      complete: pending.complete,
      /* presence-freshness D7 (BUG-013): when WispHub was asked, not now */
      readAt: pending.readAt,
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
