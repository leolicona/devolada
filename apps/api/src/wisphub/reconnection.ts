import { WispHubError, type WispHub } from "./client";

/* One reconnection attempt (charge-record D3, reconnection-queue spec).
   Steps: pay the invoice the customer already has (D1) → registrar-pago →
   read the customer back. Only a verified active service is "reconnected"
   — no optimistic green. Everything else stays "queued": the charge is
   already safe in the ledger (US-C04). */

export type AttemptResult = {
  status: "reconnected" | "queued";
  /* The invoice this charge is paying, so a retry never creates another */
  invoiceId: number | null;
  /* WISPHUB_AUTH_FAILED does not count toward the attempt budget (D5) */
  error: "WISPHUB_AUTH_FAILED" | "WISPHUB_UNAVAILABLE" | "NOT_ACTIVE_YET" | null;
};

export async function attemptReconnection(
  wisphub: WispHub,
  usuario: string,
  monthlyFeeCents: number,
  now: Date,
  knownInvoiceId?: number | null,
): Promise<AttemptResult> {
  let invoiceId = knownInvoiceId ?? null;
  try {
    const date = now.toISOString().slice(0, 10);
    const dateTime = `${date} ${now.toISOString().slice(11, 16)}`;

    const paymentMethodId = await wisphub.getCashPaymentMethodId();

    /* D1 (pays TD-009): reuse before creating. The id we already stored
       wins; otherwise ask WispHub for a pending one; only then create. */
    if (invoiceId === null) {
      invoiceId = await wisphub.findPendingInvoiceId(usuario, now);
    }
    if (invoiceId === null) {
      invoiceId = await wisphub.createInvoice(usuario, monthlyFeeCents, date);
    }

    await wisphub.registerPayment(invoiceId, paymentMethodId, monthlyFeeCents, dateTime);

    const customer = await wisphub.getCustomer(usuario);
    if (customer?.serviceStatus === "active") {
      return { status: "reconnected", invoiceId, error: null };
    }
    /* Paid, but WispHub's async task has not flipped the service yet.
       This is the case the retries exist for (D6). */
    return { status: "queued", invoiceId, error: "NOT_ACTIVE_YET" };
  } catch (e) {
    const error = e instanceof WispHubError ? e.code : "WISPHUB_UNAVAILABLE";
    return { status: "queued", invoiceId, error };
  }
}
