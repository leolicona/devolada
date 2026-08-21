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

/* debt-truth D7 + D14. A carried balance is read from the customer record,
   which is never truncated, so it proves a debt on its own. The label is
   only consulted when the invoice list was cut off, the customer was not in
   the fetched part, and nothing is carried — a narrower gap than D4 left. */
export function billingStatusOf(
  customer: WispHubCustomer,
  pending: PendingInvoices,
  debt: Debt,
): WispHubCustomer["billingStatus"] {
  if (debt.totalCents > 0) return "due";
  if (customer.carriedBalanceCents < 0) return "paid";
  return pending.complete ? "paid" : customer.billingStatus;
}
