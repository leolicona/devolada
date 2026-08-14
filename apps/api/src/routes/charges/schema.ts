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
  monthlyFeeCents: z.number().int(),
});

export const customerSearchResponse = z.object({
  customers: z.array(customerResult),
});

export type CustomerResult = z.infer<typeof customerResult>;
export type CustomerSearchResponse = z.infer<typeof customerSearchResponse>;
