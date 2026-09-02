import { z } from "zod";

/* Shareable contract (ARCHITECTURE.md): the admin derives its types from
   these schemas. cobros-live spec, US-R01. */

export const cobroRow = z.object({
  /* WispHub's invoice id — the only id there is: Devolada stores nothing
     (cobros-live D6) */
  externalId: z.number().int(),
  customerUsuario: z.string(),
  /* Rides in the invoice row's `cliente` serializer; null when WispHub
     omits it — the UI falls back to the usuario */
  customerName: z.string().nullable(),
  amountCents: z.number().int(),
  /* YYYY-MM-DD as WispHub stamps them, or null when the row lacks the
     field (verified against the live tenant per the spec's contract) */
  invoiceDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  /* pilot-UX round: the debtor's permanent link, when it already exists
     (the roster lazy-creates them); null hides the buttons */
  linkUrl: z.string().nullable(),
  waLink: z.string().nullable(),
});

export const paymentRequestsResponse = z.object({
  cobros: z.array(cobroRow),
  /* pendingInvoices D4: false means the 5-page window was cut off — the
     client renders a warning, never a silent truncation (cobros-live D4) */
  complete: z.boolean(),
  /* When the api answered; the 30-second display cache means the provider
     read may be up to that much older — noise under the client's 2-minute
     staleTime (cobros-live D3) */
  readAt: z.number().int(),
});

export type CobroRow = z.infer<typeof cobroRow>;
export type PaymentRequestsResponse = z.infer<typeof paymentRequestsResponse>;
