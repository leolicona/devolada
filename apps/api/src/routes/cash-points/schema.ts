import { z } from "zod";

/* cash-at-stores — *Puntos de pago*, the business's view of its cash at
   the network's stores (contracts/business-cash-api.md, D20, D23). Every
   query filters by the actor's business (constitution V): two businesses
   at one store never see each other's cash (FR-042, SC-007). */

export const cashPointStore = z.object({
  storeId: z.string(),
  storeName: z.string(),
  address: z.string(),
  storeStatus: z.enum(["invited", "active", "suspended"]),
  /* D19: the same SUM *Mi caja* shows (SC-005) */
  heldCents: z.number().int(),
  lastConfirmed: z.object({ cents: z.number().int().positive(), at: z.number().int() }).nullable(),
  pending: z.object({ id: z.string(), cents: z.number().int().positive(), declaredAt: z.number().int() }).nullable(),
});

export const cashPointsResponse = z.object({
  channelOn: z.boolean(),
  stores: z.array(cashPointStore),
});

export const handoverRow = z.object({
  id: z.string(),
  storeId: z.string(),
  cents: z.number().int().positive(),
  status: z.enum(["pending", "confirmed", "disputed"]),
  note: z.string().nullable(),
  declaredAt: z.number().int(),
  resolvedAt: z.number().int().nullable(),
  /* Who confirmed or disputed it, by email */
  resolvedBy: z.string().nullable(),
});

/* D20 rule 4 (FR-035): a dispute needs a note */
export const disputeRequest = z.object({ note: z.string().trim().min(3).max(280) });

export const historyQuery = z.object({ cursor: z.string().optional() });
export const handoverHistoryResponse = z.object({
  handovers: z.array(handoverRow),
  nextCursor: z.string().nullable(),
});

export type CashPointStore = z.infer<typeof cashPointStore>;
export type CashPointsResponse = z.infer<typeof cashPointsResponse>;
export type HandoverRow = z.infer<typeof handoverRow>;
export type DisputeRequest = z.infer<typeof disputeRequest>;
export type HandoverHistoryResponse = z.infer<typeof handoverHistoryResponse>;
