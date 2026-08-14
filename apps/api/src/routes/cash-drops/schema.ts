import { z } from "zod";

export const cashDropRequest = z.object({
  cents: z.number().int().positive(),
});

export const cashDropStatus = z.enum(["pending", "confirmed", "disputed"]);

export const cashDropResponse = z.object({
  id: z.string(),
  cents: z.number().int(),
  status: cashDropStatus,
  createdAt: z.number().int(),
});

/* Admin view of a drop: the store travels with it, because the ISP
   confirming cash needs to know whose cash it is (spec D5). */
export const adminCashDrop = z.object({
  id: z.string(),
  storeId: z.string(),
  storeName: z.string(),
  storeZone: z.string().nullable(),
  cents: z.number().int(),
  status: cashDropStatus,
  note: z.string().nullable(),
  createdAt: z.number().int(),
  confirmedAt: z.number().int().nullable(),
  /* Filled for pending drops only (D5) */
  storeBalanceCents: z.number().int().nullable(),
});

export const cashDropsResponse = z.object({
  drops: z.array(adminCashDrop),
  nextCursor: z.number().int().nullable(),
});

export const confirmResponse = z.object({
  drop: adminCashDrop,
  /* The balance after the ledger entry (D1) */
  storeBalanceCents: z.number().int(),
});

export const disputeRequest = z.object({
  /* D2: a dispute with no reason is an accusation the store cannot answer */
  note: z.string().trim().min(3).max(280),
});

export const disputeResponse = z.object({ drop: adminCashDrop });

export type CashDropResponse = z.infer<typeof cashDropResponse>;
export type AdminCashDrop = z.infer<typeof adminCashDrop>;
export type CashDropsResponse = z.infer<typeof cashDropsResponse>;
export type ConfirmResponse = z.infer<typeof confirmResponse>;
export type DisputeResponse = z.infer<typeof disputeResponse>;
