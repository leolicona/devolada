import { WispHubError, type WispHub } from "./client";
import { forgetPaymentMethods, paymentMethods } from "./cache";
import { cashMethodOf, devoladaMethodFor, referenceFor, type MethodChannel } from "./payment-methods";
import type { ActionAttemptInput } from "../integrations/capabilities";
import { businessWallClock } from "../time/business-day";

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
  status: "reconnected" | "queued" | "withheld";
  /* WISPHUB_AUTH_FAILED does not count toward the attempt budget (D5) */
  error: "WISPHUB_AUTH_FAILED" | "WISPHUB_UNAVAILABLE" | "NOT_ACTIVE_YET" | null;
};

/* payment-method-per-channel D2, D16: what the recording needs to say
   where the money came from — the channel picks the method, the
   reference ties the record back to Devolada, and `methodsSeenAt` is the
   version of the method-list cache key (the integration's
   `payment_methods_seen_at` in ms, or null). */
export type RecordContext = {
  channel: MethodChannel;
  reference: ActionAttemptInput["recordReference"];
  methodsSeenAt: number | null;
};

/* bug: transferred-invoice-paid — the invoice a payment should land on,
   given the one chosen earlier. The chosen one stays while WispHub says
   it can take the payment: pending, paid (D8's 422 then says "already
   landed") or unknown (the old behaviour). When the debt is gone from
   it, the payment follows the debt to the customer's oldest open invoice
   — the rule `debtOf` picks by — read fresh through the balance door
   (cobros-in-links D10), which lists open invoices only, never a moved
   one (measured 2026-10-01). The chosen id is left out whatever the door
   says: WispHub just said it no longer carries the debt. None open is
   null, debt-truth D15's empty vehicle, as for a customer with nothing
   pending. The door is asked with the id of the record read now, as
   `customerDebt` asks it: a stored id is a cache (direct-payment D5). */
async function invoiceToPay(wisphub: WispHub, usuario: string, invoiceId: number): Promise<number | null> {
  if ((await wisphub.invoiceState(invoiceId)) !== "gone") return invoiceId;
  const record = await wisphub.getCustomer(usuario);
  /* Gone from WispHub as well: there is nowhere to send the money. The
     queue retries and ends `failed` for the business to see — never a
     payment on an invoice that no longer carries the debt. */
  if (!record) throw new WispHubError("WISPHUB_UNAVAILABLE", "customer gone while its invoice moved");
  const open = (await wisphub.openInvoicesOf(record.wisphubId, record.usuario)).filter((f) => f.invoiceId !== invoiceId);
  return open.length ? Math.min(...open.map((f) => f.invoiceId)) : null;
}

export async function attemptReconnection(
  wisphub: WispHub,
  /* The tenant: its id keys the payment-method cache (provider-latency
     D5), its timezone is the clock WispHub's dates are written on
     (bug: wisphub-payment-utc-time) */
  business: { id: string; timezone: string },
  /* usuario for every lookup; the numeric id only for the PATCH (D8) */
  customer: { usuario: string; wisphubId: string },
  /* The whole debt this payment settles — pending invoices plus the
     carried balance (debt-truth D7/D15). Devolada's service fee is not
     in it: that money is not the ISP's. */
  debtCents: number,
  now: Date,
  state: AttemptState,
  /* partial-payment D5: `false` records the money and leaves the cut in
     place. The money still travels — the ISP's books are right either
     way — only the router is left alone. */
  reconnect: boolean,
  record: RecordContext,
): Promise<AttemptResult> {
  let { invoiceId, paymentRegistered } = state;
  try {
    if (!paymentRegistered) {
      /* bug: transferred-invoice-paid — a stored invoice is asked about
         before anything is written: WispHub takes a payment on an invoice
         whose debt moved to another (no 422 stops it, unlike a paid one).
         When the debt left it, the new id reaches the row BEFORE any money
         is registered on it: this attempt writes nothing and answers
         `queued` with that id, every caller keeps the id an attempt
         answers, and the queue's next attempt pays it — a minute later
         when this was the first. A retry after a lost answer then meets
         that same invoice, paid, and D8's 422 keeps its meaning. Measured
         2026-10-01: WispHub never moves a paid invoice, so a moved one is
         never a payment of Devolada's own. */
      if (invoiceId !== null) {
        const payable = await invoiceToPay(wisphub, customer.usuario, invoiceId);
        if (payable !== invoiceId) {
          return { status: "queued", invoiceId: payable, paymentRegistered: false, error: null };
        }
      }

      /* bug: wisphub-payment-utc-time — on the ISP's wall clock, because
         WispHub reads a date without a zone as its tenant's local time.
         This assumes the tenant's WispHub runs in the zone the ISP saved
         in Devolada's settings: two systems, set apart. The moment is
         still this attempt's, so a retry registers the retry's time. */
      const { date, dateTime } = businessWallClock(business.timezone, now);

      /* D9: the opt-in for payment-triggered reactivation, ensured
         before the payment that should trigger it. Non-fatal: a failed
         PATCH must not block the payment — the verify step still tells
         the truth, and a service that never flips ends in `failed`,
         which is the honest answer.
         provider-latency D2: it has nothing to do with the payment
         method, so the two wait together instead of in a row. */
      const [, methods] = await Promise.all([
        wisphub.ensureAutoActivate(customer.wisphubId).catch((e: unknown) => {
          console.warn(`auto_activar_servicio PATCH failed for ${customer.usuario}:`, e);
        }),
        paymentMethods(business.id, wisphub, now, record.methodsSeenAt),
      ]);
      /* payment-method-per-channel D4: the channel's method when the
         business created it (FR-001, FR-002), the cash method otherwise —
         never one of Devolada's names as the cash method (FR-012). The
         action never waits for the business's setup (FR-004). */
      const devolada = devoladaMethodFor(methods, record.channel);
      /* Chosen here, before any invoice is looked up or created: a tenant
         with no payment method at all fails as it always did, without an
         invoice left behind */
      const method = devolada ?? cashMethodOf(methods);

      /* D1 (pays TD-009): reuse before creating. The id we already
         stored wins — while the debt is still on it (above); otherwise ask
         WispHub for a pending one; only then create. */
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

      /* The payment settles the whole account, whichever invoice carries
         it (D15) — so what travels is the debt, not one invoice's total. */
      /* payment-method-per-channel D7: on every recording, the fallback's
         included (FR-007) */
      const reference = referenceFor(record.reference);
      const register = async (methodId: number) => {
        try {
          await wisphub.registerPayment(invoiceId!, methodId, debtCents, dateTime, reconnect, reference);
        } catch (e) {
          /* 422 is WispHub refusing to pay a paid invoice — which means
             the money already landed (an overlapping attempt, or a payment
             made in the panel). The refusal IS the goal state (D8). */
          if (!(e instanceof WispHubError && e.status === 422)) throw e;
        }
      };
      try {
        await register(method.id);
      } catch (e) {
        /* payment-method-per-channel D6: the provider refused Devolada's
           method — deleted or renamed since the list was read. Measured
           2026-10-02 (R9): 400 `{"forma_pago": ["Clave primaria … inválida
           - objeto no existe."]}`, and the invoice stays pending, so
           nothing was recorded and a second call cannot pay twice. The
           list this data center holds is dropped and the same payment
           goes once more, at once, with the cash method. Any other 400 is
           what it was (WISPHUB_UNAVAILABLE): an amount or a date refused
           under another method would hide the real error.
           The cash method is chosen without the method just refused: a
           business with only Devolada's methods could otherwise get the
           refused one back, and the action would wait in the queue for
           nothing (FR-004; /speckit-analyze C1, 2026-10-02). */
        const missingMethod = e instanceof WispHubError && e.status === 400 && (e.fields ?? []).includes("forma_pago");
        if (!devolada || !missingMethod) throw e;
        await forgetPaymentMethods(business.id, wisphub, record.methodsSeenAt);
        await register(cashMethodOf(methods.filter((m) => m.id !== devolada.id)).id);
      }
      paymentRegistered = true;
    }

    /* partial-payment D5: the money is on the ISP's books and the cut was
       deliberately left in place. There is nothing to verify and nothing
       to retry — reading the customer here would find them suspended and
       report `queued`, which would send the sweep chasing a reconnection
       nobody asked for and end in a red "Fallido" for a flow that worked. */
    if (!reconnect) {
      return { status: "withheld", invoiceId, paymentRegistered, error: null };
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
