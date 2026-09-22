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
  /* links-on-demand-search D16: `linkUrl` and `waLink` are GONE.

     They existed because the roster had already made a link for every
     customer, so the row could carry one. Under FR-008 most debtors have
     none, and the field that remained would produce the worse behaviour:
     a link with no phone, for a debtor who already has one, sending the
     operator to WhatsApp's contact picker to find them by hand.

     Both buttons now take one path — `POST /direct-payments/links`, the
     act — which reads the customer fresh and therefore carries their
     NUMBER, so WhatsApp opens their own chat (FR-025, FR-026, FR-028).
     The batch lookup of stored links went with these two fields, and the
     chunking under D1's parameter cap it needed with it
     (`bug: cobros-links-lookup-params`). */
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
