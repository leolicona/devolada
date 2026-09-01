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
  kind: z.enum(["welcome_bonus", "top_up", "validation_fee", "fee_reversal", "adjustment"]),
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

/* prepaid-credit D6: the two doors, one call. `amountCents` is required on
   the manual door (the minimum needs it); the receipt door lets the CEP
   decide. `proofId` comes from POST /credit/top-ups/proof. */
export const topUpRequest = z
  .object({
    transfer: z
      .object({
        trackingKey: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/),
        senderBank: z.string().trim().min(2),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amountCents: z.number().int().positive(),
      })
      .optional(),
    proofId: z.string().min(1).optional(),
  })
  .refine((b) => Boolean(b.transfer) !== Boolean(b.proofId), "one door at a time");

export const topUpItem = z.object({
  id: z.string(),
  status: z.enum(["validating", "credited", "invalid", "expired", "superseded"]),
  claimedCents: z.number().int(),
  creditedCents: z.number().int().nullable(),
  proofMode: z.enum(["receipt", "transfer"]),
  trackingKey: z.string().nullable(),
  validationAttempts: z.number().int(),
  nextValidationAt: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: z.number().int(),
  confirmedAt: z.number().int().nullable(),
});
export const topUpsResponse = z.object({ topUps: z.array(topUpItem) });

export type TopUpRequest = z.infer<typeof topUpRequest>;
export type TopUpItem = z.infer<typeof topUpItem>;
