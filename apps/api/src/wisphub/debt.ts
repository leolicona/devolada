import type { PendingInvoices, WispHubCustomer } from "./client";

/* What a customer owes, as debt-truth D7 defines it:
     total = Σ(pending invoice totals) + `saldo`
   WispHub keeps a running account, so neither half is the whole answer —
   a partly paid invoice closes as "Pagada" and its remainder lives in
   `saldo`, where the invoice list cannot see it. */
export type Debt = {
  /* What the pending invoices bill. Also where a credit is absorbed (D12). */
  invoiceCents: number;
  /* Debt already carried in the running account. Never negative: a credit
     lowers `invoiceCents` instead of appearing as a line of its own. */
  carriedBalanceCents: number;
  /* The two above. Zero means nothing is owed. */
  totalCents: number;
  /* The invoice a payment registers against (D15). `null` when nothing is
     pending — then the caller needs a zero-total vehicle, never an invoice
     sized to the debt, which WispHub would add to the account. */
  invoiceId: number | null;
};

export const NO_DEBT: Debt = {
  invoiceCents: 0,
  carriedBalanceCents: 0,
  totalCents: 0,
  invoiceId: null,
};

export function debtOf(
  customer: Pick<WispHubCustomer, "usuario" | "carriedBalanceCents">,
  pending: PendingInvoices,
): Debt {
  const mine = pending.invoices.filter((f) => f.usuario === customer.usuario);
  /* D21 of direct-payment kills "one invoice at a time": WispHub applies a
     payment to the customer, so showing one of several invoices asks for a
     number that will not settle anything. */
  const invoiceCents = mine.reduce((sum, f) => sum + f.totalCents, 0);
  /* Oldest first — the rule that was already here, and the invoice a
     payment will be registered against. */
  const invoiceId = mine.length ? Math.min(...mine.map((f) => f.invoiceId)) : null;
  const carried = customer.carriedBalanceCents;

  /* D12: a credit reduces what is charged and never leaves as money. It is
     netted here rather than surfaced, because a "$X a favor" line invites a
     refund request Devolada cannot honour — the money is in the ISP's
     account (direct-payment D4). */
  if (carried < 0) {
    const net = Math.max(invoiceCents + carried, 0);
    return { invoiceCents: net, carriedBalanceCents: 0, totalCents: net, invoiceId };
  }

  return {
    invoiceCents,
    carriedBalanceCents: carried,
    totalCents: invoiceCents + carried,
    invoiceId,
  };
}

/* bug: pending-invoice-cap — the debt of one customer, from a list that
   may be the sweep's snapshot. The customer record is always live, so
   where the two disagree about THIS customer the record wins: a
   "Pagadas" label empties the snapshot's rows for them (paid meanwhile,
   the snapshot has not seen it yet), and `saldo` is added as ever. A
   live list is as fresh as the record, so it is read as it is. */
export function debtFor(customer: WispHubCustomer, pending: PendingInvoices): Debt {
  if (pending.source === "snapshot" && customer.billingStatus === "paid") {
    return debtOf(customer, { ...pending, invoices: [] });
  }
  return debtOf(customer, pending);
}

/* Whether a debt of zero can be believed (debt-truth D4/D14, as amended
   by bug: pending-invoice-cap). A customer absent from a cut-off list
   proves nothing, and the plan's price is no longer the stand-in — the
   callers answer "cannot confirm" instead. What does prove it:

     - a credit in `saldo`: the record is never truncated (D14);
     - WispHub's own "Pagadas" label, for the same reason;
     - a live list read to its end;
     - a finished snapshot, unless the live label says the customer owes
       — then their invoice was issued after the pass and is not in it yet.

   `billingStatusOf` stood here with the old fallback and no caller. */
export function nothingOwedIsProven(customer: WispHubCustomer, pending: PendingInvoices): boolean {
  if (customer.carriedBalanceCents < 0) return true;
  if (customer.billingStatus === "paid") return true;
  if (!pending.complete) return false;
  return pending.source === "live" || customer.billingStatus !== "due";
}
