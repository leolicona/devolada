/* What the core may ask a business's integration, in the core's own
   words (constitution IX, cobros-in-links D18).

   An adapter says what it can do by filling these shapes; the core
   offers a feature because the business's integration has the
   capability, never because it is one provider or another. Nothing here
   names a provider's path, cursor, field or rule — those are the
   adapter's, and a core route that needs one is a leak.

   Dependencies point one way: an adapter imports this file (the types
   and `IntegrationError`), and only `registry.ts` imports an adapter.
   This file imports none. */

/* One unpaid invoice, as the core reads it. Devolada shows it and never
   keeps it (cobros-in-links Key Entities). */
export type OpenInvoice = {
  invoiceId: number;
  /* The customer's identity in the business's system. The name is
     inherited: it is already the payment link's identity in the core
     table (`customer_usuario`), so 014 keeps it rather than split the
     vocabulary — registered debt `core-reads-provider-directly` (D18). */
  usuario: string;
  customerName: string | null;
  totalCents: number;
  /* YYYY-MM-DD, or null when the integration does not say */
  invoiceDate: string | null;
  dueDate: string | null;
  /* What this period bills, and the part carried from before (the
     *saldo anterior*, FR-006). Null when the integration does not say
     or the value could not be read (D5) — never a zero stand-in. */
  periodCents: number | null;
  carriedCents: number | null;
  /* The period in the integration's own words, e.g. "Periodo del
     15/Sept./2026 al 15/Oct./2026" (D5) */
  period: string | null;
};

/* One block of the business's open invoices (D1).

   `cursor` is opaque to the core: the adapter writes it and reads it
   back, and the core passes it through untouched (D2, D18). Null when
   the walk has ended. `total` is the integration's own count of open
   invoices, or null when it does not report one (FR-007). */
export type ReceivablesPage = {
  invoices: OpenInvoice[];
  cursor: string | null;
  total: number | null;
};

/* One open invoice inside a customer's debt */
export type DebtInvoice = {
  invoiceId: number;
  invoiceDate: string | null;
  dueDate: string | null;
  totalCents: number;
};

/* What one customer owes (D9, FR-018): an amount above zero, a proven
   zero, or "could not confirm" — never a guess. `unconfirmed` carries no
   amount, so nothing downstream can render it as zero. */
export type CustomerDebtAnswer =
  | {
      state: "owes" | "none";
      totalCents: number;
      /* After a credit is netted (`debt-truth` D12) */
      invoiceCents: number;
      /* Never negative */
      carriedBalanceCents: number;
      /* Every open invoice, with no date window (FR-017) */
      invoices: DebtInvoice[];
    }
  | { state: "unconfirmed" };

/* payment-without-receipt D4: one customer whose phone is the phone
   asked, with its name. The key is the customer's identity in the
   business's system (the usuario, as `OpenInvoice` names it); the name
   comes in the integration's two halves. The core compares and forgets
   them — no phone and no name is ever stored (D1). */
export type CustomerWithPhone = {
  usuario: string;
  firstName: string;
  lastName: string;
};

/* What an integration can do for the core. Each capability is optional:
   an adapter that cannot answer one leaves it out, and the core does not
   offer the feature (constitution IX, FR-013). */
export type IntegrationCapabilities = {
  /* One block of open invoices. `cursor` is null for the first block.
     A cursor the adapter did not write answers "bad_cursor", which the
     core turns into VALIDATION_ERROR (D2). */
  receivables?: {
    page(cursor: string | null, limit: number): Promise<ReceivablesPage | "bad_cursor">;
  };
  /* What one customer owes right now, read when it is shown (D9) */
  customerDebt?: {
    of(usuario: string): Promise<CustomerDebtAnswer>;
  };
  /* payment-without-receipt D4: every customer of this business whose
     phone is `phone` — ten national digits, as `nationalPhone` reads them
     — read to the end. The core groups them into people by name when a
     payer's reference is born. Throws `IntegrationError` when it cannot
     answer; the core then makes no reference (D5). `phoneOf` reads one
     customer's phone as the business typed it (null when it has none, or
     when the customer is gone), for the backfill, which holds a link and
     not a customer (D5). */
  customersWithPhone?: {
    of(phone: string): Promise<CustomerWithPhone[]>;
    phoneOf(usuario: string): Promise<string | null>;
  };
};

/* The names the session carries (D13), so the panel can decide what to
   offer without a network call */
export type CapabilityName = keyof IntegrationCapabilities;

/* How an integration fails, in the core's words (D7, D18). An adapter
   translates its own errors into these two, and the core never sees a
   provider's error vocabulary:

   - `INTEGRATION_UNAVAILABLE` is weather: a timeout, an outage, an
     unreadable answer. The core answers with what it can and says so.
   - `INTEGRATION_AUTH_FAILED` is setup: the provider refused the
     business's credential. The panel sends the operator to
     Integraciones; a retry would send the same credential again. */
export class IntegrationError extends Error {
  constructor(
    public code: "INTEGRATION_UNAVAILABLE" | "INTEGRATION_AUTH_FAILED",
    /* For the log line only. Never the credential. */
    detail?: string,
  ) {
    super(detail ?? code);
  }
}
