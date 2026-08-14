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

export const feedQuery = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  status: z.enum(["queued", "reconnected", "failed"]).optional(),
  storeId: z.string().optional(),
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
});

export const feedCharge = z.object({
  id: z.string(),
  folio: z.string(),
  reconnectionStatus: z.enum(["queued", "reconnected", "failed"]),
  totalCents: z.number().int(),
  monthlyFeeCents: z.number().int(),
  serviceFeeCents: z.number().int(),
  customerName: z.string(),
  storeName: z.string(),
  createdAt: z.number().int(),
  reconnectedAt: z.number().int().nullable(),
  attempts: z.number().int(),
  /* Why the last attempt did not work, for the ISP's detail view
     (reconnection-queue spec UI contract) */
  lastError: z.string().nullable(),
});

export const feedResponse = z.object({
  charges: z.array(feedCharge),
  nextCursor: z.number().int().nullable(),
  /* The day starts in the ISP's timezone, so it is always present.
     `startedAtMs` is that boundary — the server says which day it counted
     (settings D5), instead of leaving the client to assume. */
  today: z.object({
    count: z.number().int(),
    totalCents: z.number().int(),
    startedAtMs: z.number().int(),
  }),
});

export type FeedCharge = z.infer<typeof feedCharge>;
export type FeedResponse = z.infer<typeof feedResponse>;
export type ChargeResponse = z.infer<typeof chargeResponse>;
export type CustomerResult = z.infer<typeof customerResult>;
export type CustomerSearchResponse = z.infer<typeof customerSearchResponse>;
export type CustomerQuoteResponse = z.infer<typeof customerQuoteResponse>;
