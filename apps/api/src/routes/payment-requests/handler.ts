import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { integrationOf } from "../../integrations/store";
import { capabilitiesOf } from "../../integrations/registry";
import { IntegrationError } from "../../integrations/capabilities";
import type { PaymentRequestsResponse, ReceivablesQuery } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* GET /payment-requests — the Por cobrar view of Links, one block at a
   time (cobros-in-links D1–D7, D18).

   The core asks the business's integration for one page of open
   invoices, by capability, and passes the cursor through untouched. It
   builds no provider path and imports nothing from an adapter's folder
   (constitution IX): the path, the window, the cursor and the reading
   of a row are the adapter's.

   Live only (D3, SC-006): no sweep copy and no display cache. The
   sweep's `pending` pass and `readPendingInvoices` stay exactly as they
   are — the payer's page and every money path still read them.

   Every member reads: "who owes me" is the daily question
   (cobros-live D4). */
export async function listPaymentRequests(c: Ctx, query: ReceivablesQuery) {
  const actor = c.get("actor");
  if (actor.type !== "business") {
    return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403);
  }
  const db = drizzle(c.env.DB);
  const receivables = capabilitiesOf(await integrationOf(db, actor.id), c.env).receivables;
  if (!receivables) {
    /* D13, FR-013: no integration, or one that cannot read open
       invoices. The panel never offers the chip then; an address that
       arrives with the view anyway falls back to the customer view. */
    return c.json({ success: false, error: { code: "NOT_CONFIGURED" } }, 409);
  }

  let page;
  try {
    page = await receivables.page(query.cursor ?? null, query.limit);
  } catch (e) {
    if (!(e instanceof IntegrationError)) throw e;
    /* Logged here because nothing else on this path does: the screen
       says it could not read, and this line says why. The detail is a
       status or a timeout, never the key (007 FR-013). */
    console.error("integration failure:", e.code, e.message);
    if (e.code === "INTEGRATION_AUTH_FAILED") {
      /* D7: a refused key is setup, not weather. The page sends the
         operator to Integraciones; a retry would send the same key to
         the same place (bug cobros-installation-fallback). */
      return c.json({ success: false, error: { code: "INTEGRATION_AUTH_FAILED" } }, 503);
    }
    /* D7: the integration being away is an ANSWER. With no copy of
       anyone's debt there is nothing to fall back on, so the block is
       empty and says why — the client keeps the blocks it already has
       and never reads this as "nobody owes" (FR-012). */
    return c.json({
      success: true,
      data: { results: [], nextCursor: null, total: null, integration: "unavailable" } satisfies PaymentRequestsResponse,
    });
  }

  if (page === "bad_cursor") {
    /* D2: a cursor is one this API wrote or it is refused, never guessed at */
    return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }

  const data: PaymentRequestsResponse = {
    results: page.invoices.map((f) => ({
      externalId: f.invoiceId,
      customerUsuario: f.usuario,
      customerName: f.customerName,
      amountCents: f.totalCents,
      invoiceDate: f.invoiceDate,
      dueDate: f.dueDate,
      periodCents: f.periodCents,
      carriedCents: f.carriedCents,
      period: f.period,
    })),
    nextCursor: page.cursor,
    total: page.total,
    integration: "ok",
  };
  return c.json({ success: true, data });
}
