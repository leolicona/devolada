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
  /* debt-truth D13: the invoice's own total, not the plan's list price */
  invoiceCents: z.number().int(),
  /* Debt carried in WispHub's running account (D7). Its own field so the
     UI can give it its own line and never fold it in (D11). */
  carriedBalanceCents: z.number().int(),
  /* Whether a phone for the receipt is known — from WispHub or captured
     here before (customer-phone D4). The number itself stays on the
     server, as customer-search D2's allow-list has it: the confirm screen
     only needs to know whether to ask for one. */
  hasPhone: z.boolean(),
});

export const customerSearchResponse = z.object({
  customers: z.array(customerResult),
});

export const customerQuoteResponse = z.object({
  customer: customerResult,
  quote: z.object({
    invoiceCents: z.number().int(),
    carriedBalanceCents: z.number().int(),
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
  /* Optional capture for the receipt (customer-phone D2): 10 national
     digits. Ignored when WispHub already has a number (D4). */
  customerPhone: z
    .string()
    .regex(/^\d{10}$/)
    .optional(),
});

export const chargeResponse = z.object({
  id: z.string(),
  folio: z.string(),
  reconnectionStatus: z.enum(["queued", "reconnected", "failed", "withheld"]),
  totalCents: z.number().int(),
  customerName: z.string(),
});

export const feedQuery = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  status: z.enum(["queued", "reconnected", "failed", "withheld"]).optional(),
  storeId: z.string().optional(),
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
});

export const feedCharge = z.object({
  id: z.string(),
  folio: z.string(),
  /* 'spei' = direct payment, no store involved (direct-payment D6);
     the feed marks the channel so the two are visually distinct */
  channel: z.enum(["store", "spei"]),
  reconnectionStatus: z.enum(["queued", "reconnected", "failed", "withheld"]),
  totalCents: z.number().int(),
  invoiceCents: z.number().int(),
  carriedBalanceCents: z.number().int(),
  serviceFeeCents: z.number().int(),
  customerName: z.string(),
  /* null for channel = 'spei': no store handled this money */
  storeName: z.string().nullable(),
  createdAt: z.number().int(),
  reconnectedAt: z.number().int().nullable(),
  attempts: z.number().int(),
  /* Why the last attempt did not work, for the ISP's detail view
     (reconnection-queue spec UI contract) */
  lastError: z.string().nullable(),
});

/* The receipt (receipt spec D2): the API hands over finished copy. */
export const receiptResponse = z.object({
  folio: z.string(),
  customerName: z.string(),
  totalCents: z.number().int(),
  invoiceCents: z.number().int(),
  carriedBalanceCents: z.number().int(),
  serviceFeeCents: z.number().int(),
  reconnectionStatus: z.enum(["queued", "reconnected", "failed", "withheld"]),
  text: z.string(),
  waLink: z.string(),
  phone: z.string().nullable(),
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

export type ReceiptResponse = z.infer<typeof receiptResponse>;
export type FeedCharge = z.infer<typeof feedCharge>;
export type FeedResponse = z.infer<typeof feedResponse>;
export type ChargeResponse = z.infer<typeof chargeResponse>;
export type CustomerResult = z.infer<typeof customerResult>;
export type CustomerSearchResponse = z.infer<typeof customerSearchResponse>;
export type CustomerQuoteResponse = z.infer<typeof customerQuoteResponse>;
