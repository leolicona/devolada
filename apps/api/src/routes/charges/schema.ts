import { z } from "zod";

/* Shareable contract (ARCHITECTURE.md): the PWA derives types from
   these schemas and MSW handlers validate against them. */

export const customerSearchQuery = z.object({
  q: z.string().trim().min(2),
});

export const customerResult = z.object({
  wisphubId: z.number(),
  usuario: z.string(),
  name: z.string(),
  zone: z.string().nullable(),
  serviceStatus: z.enum(["active", "suspended", "unknown"]),
  billingStatus: z.enum(["paid", "due", "unknown"]),
  monthlyFeeCents: z.number().int(),
});

export const customerSearchResponse = z.object({
  customers: z.array(customerResult),
});

export const customerQuoteResponse = z.object({
  customer: customerResult,
  quote: z.object({
    monthlyFeeCents: z.number().int(),
    serviceFeeCents: z.number().int(),
    totalCents: z.number().int(),
  }),
  cap: z.object({
    balanceCents: z.number().int(),
    capCents: z.number().int(),
    blocked: z.boolean(),
  }),
});

export const chargeRecordRequest = z.object({
  /* D1: the client sends only the customer; the server computes the money */
  usuario: z.string().min(3),
});

export const chargeResponse = z.object({
  id: z.string(),
  folio: z.string(),
  reconnectionStatus: z.enum(["queued", "reconnected", "failed"]),
  totalCents: z.number().int(),
  customerName: z.string(),
});

export type ChargeResponse = z.infer<typeof chargeResponse>;
export type CustomerResult = z.infer<typeof customerResult>;
export type CustomerSearchResponse = z.infer<typeof customerSearchResponse>;
export type CustomerQuoteResponse = z.infer<typeof customerQuoteResponse>;
