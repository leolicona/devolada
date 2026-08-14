import { z } from "zod";

export const cashDropRequest = z.object({
  cents: z.number().int().positive(),
});

export const cashDropResponse = z.object({
  id: z.string(),
  cents: z.number().int(),
  status: z.enum(["pending", "confirmed", "disputed"]),
  createdAt: z.number().int(),
});

export type CashDropResponse = z.infer<typeof cashDropResponse>;
