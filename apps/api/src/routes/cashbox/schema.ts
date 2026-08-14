import { z } from "zod";

/* Shareable contract: the PWA derives types, MSW validates against it. */

export const cashboxResponse = z.object({
  storeName: z.string(),
  balanceCents: z.number().int(),
  commissionEarnedCents: z.number().int(),
  cap: z.object({
    capCents: z.number().int(),
    approaching: z.boolean(),
    blocked: z.boolean(),
  }),
  /* Nullable on purpose (spec D4): the drops task adds data, not a contract change.
     `note` arrived with that task — cash-drops D7: both sides read the
     same dispute, not only the side that wrote it. */
  lastCashDrop: z
    .object({
      id: z.string(),
      cents: z.number().int(),
      status: z.enum(["pending", "confirmed", "disputed"]),
      note: z.string().nullable(),
      createdAt: z.number().int(),
    })
    .nullable(),
});

export type CashboxResponse = z.infer<typeof cashboxResponse>;
