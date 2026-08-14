import type { WispHub } from "./client";

/* One reconnection attempt (charge-record spec D3). The retry queue task
   reuses this. Steps: invoice → payment → verify. Only a verified active
   service returns "reconnected" — no optimistic green. Any failure means
   "queued": the charge is already safe in the ledger (US-C04). */

export async function attemptReconnection(
  wisphub: WispHub,
  usuario: string,
  monthlyFeeCents: number,
  now: Date,
): Promise<"reconnected" | "queued"> {
  try {
    const date = now.toISOString().slice(0, 10);
    const dateTime = `${date} ${now.toISOString().slice(11, 16)}`;

    const paymentMethodId = await wisphub.getCashPaymentMethodId();
    const invoiceId = await wisphub.createInvoice(usuario, monthlyFeeCents, date);
    await wisphub.registerPayment(invoiceId, paymentMethodId, monthlyFeeCents, dateTime);

    const customer = await wisphub.getCustomer(usuario);
    return customer?.serviceStatus === "active" ? "reconnected" : "queued";
  } catch {
    return "queued";
  }
}
