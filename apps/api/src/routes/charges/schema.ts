import { z } from "zod";

/* Shareable contract (ARCHITECTURE.md): the admin derives types from
   these schemas and MSW handlers validate against them. Store-channel
   shapes retired to devolada-red. */

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
     'store' survives as a historical value until the phase-2 rename
     merges charges into payments (pivot D14). */
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
