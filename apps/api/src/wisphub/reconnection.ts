import { WispHubError, type WispHub } from "./client";
import { cashPaymentMethodId } from "./cache";

/* One reconnection attempt (charge-record D3, reconnection-queue spec).
   Two phases, and the split is the point (D8): the payment happens at
   most once, because WispHub refuses to pay an already-paid invoice
   (422, measured live 2026-08-16) — a retry that re-paid would die on
   that refusal before ever verifying, so no queued charge could ever
   convert. Once the payment landed, every later attempt only asks the
   question that is actually open: is the service active yet?
   Only a verified active service is "reconnected" — no optimistic
   green. Everything else stays "queued": the charge is already safe in
   the ledger (US-C04). */

export type AttemptState = {
  /* The invoice this charge is paying, so a retry never creates another */
  invoiceId: number | null;
  /* True once registrar-pago landed: later attempts verify only (D8) */
  paymentRegistered: boolean;
};

export type AttemptResult = AttemptState & {
  status: "reconnected" | "queued";
  /* WISPHUB_AUTH_FAILED does not count toward the attempt budget (D5) */
  error: "WISPHUB_AUTH_FAILED" | "WISPHUB_UNAVAILABLE" | "NOT_ACTIVE_YET" | null;
};

export async function attemptReconnection(
  wisphub: WispHub,
  /* The tenant, for the payment-method cache (provider-latency D5) */
  ispId: string,
  /* usuario for every lookup; the numeric id only for the PATCH (D8) */
  customer: { usuario: string; wisphubId: string },
  /* The whole debt this payment settles — pending invoices plus the
     carried balance (debt-truth D7/D15). Devolada's service fee is not
     in it: that money is not the ISP's. */
  debtCents: number,
  now: Date,
  state: AttemptState,
): Promise<AttemptResult> {
  let { invoiceId, paymentRegistered } = state;
  try {
    if (!paymentRegistered) {
      const date = now.toISOString().slice(0, 10);
      const dateTime = `${date} ${now.toISOString().slice(11, 16)}`;

      /* D9: the opt-in for payment-triggered reactivation, ensured
         before the payment that should trigger it. Non-fatal: a failed
         PATCH must not block the payment — the verify step still tells
         the truth, and a service that never flips ends in `failed`,
         which is the honest answer.
         provider-latency D2: it has nothing to do with the payment
         method, so the two wait together instead of in a row. */
      const [, paymentMethodId] = await Promise.all([
        wisphub.ensureAutoActivate(customer.wisphubId).catch((e: unknown) => {
          console.warn(`auto_activar_servicio PATCH failed for ${customer.usuario}:`, e);
        }),
        cashPaymentMethodId(ispId, wisphub, now),
      ]);

      /* D1 (pays TD-009): reuse before creating. The id we already
         stored wins; otherwise ask WispHub for a pending one; only then
         create. */
      if (invoiceId === null) {
        invoiceId = await wisphub.findPendingInvoiceId(customer.usuario, now);
      }
      if (invoiceId === null) {
        /* debt-truth D15: nothing pending, so the payment needs a vehicle
           — and the vehicle is empty on purpose. Sizing it to the debt
           would add that debt to WispHub's running account, and the
           customer's payment would clear only the invoice we just
           invented. Measured: 72.00 carried + a 72.00 invoice, paid
           72.00, leaves 72.00 carried.

           This is the ordinary aftermath of a short payment, not an edge:
           the invoice closed as "Pagada" and the payer came back with the
           rest. */
        invoiceId = await wisphub.createInvoice(customer.usuario, 0, date, "Adeudo anterior");
      }

      try {
        /* The payment settles the whole account, whichever invoice carries
           it (D15) — so what travels is the debt, not one invoice's total. */
        await wisphub.registerPayment(invoiceId, paymentMethodId, debtCents, dateTime);
      } catch (e) {
        /* 422 is WispHub refusing to pay a paid invoice — which means
           the money already landed (an overlapping attempt, or a payment
           made in the panel). The refusal IS the goal state (D8). */
        if (!(e instanceof WispHubError && e.status === 422)) throw e;
      }
      paymentRegistered = true;
    }

    const verified = await wisphub.getCustomer(customer.usuario);
    if (verified?.serviceStatus === "active") {
      return { status: "reconnected", invoiceId, paymentRegistered, error: null };
    }
    /* Paid, but WispHub's async task has not flipped the service yet.
       This is the case the retries exist for (D6). */
    return { status: "queued", invoiceId, paymentRegistered, error: "NOT_ACTIVE_YET" };
  } catch (e) {
    const error = e instanceof WispHubError ? e.code : "WISPHUB_UNAVAILABLE";
    return { status: "queued", invoiceId, paymentRegistered, error };
  }
}
