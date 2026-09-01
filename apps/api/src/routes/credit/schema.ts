import { z } from "zod";

/* Shareable contract (prepaid-credit spec): the chip and the page read one thing. */
export const creditResponse = z.object({
  balanceCents: z.number().int(),
  feeCents: z.number().int(),
  capCents: z.number().int(),
  minTopUpCents: z.number().int(),
  step: z.enum(["ok", "low", "empty", "paused"]),
  /* null until the operator sets the platform's account (operator-panel D1) */
  topUp: z.object({ clabe: z.string(), bank: z.string(), beneficiary: z.string().nullable() }).nullable(),
});

export const creditEntry = z.object({
  id: z.string(),
  kind: z.enum(["welcome_bonus", "top_up", "validation_fee", "adjustment"]),
  cents: z.number().int(),
  reason: z.string().nullable(),
  createdAt: z.number().int(),
});
export const creditEntriesResponse = z.object({
  entries: z.array(creditEntry),
  nextCursor: z.number().int().nullable(),
});

export type CreditResponse = z.infer<typeof creditResponse>;
export type CreditEntriesResponse = z.infer<typeof creditEntriesResponse>;
