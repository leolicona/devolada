import { z } from "zod";

export const settlementMonth = z.object({
  /* "YYYY-MM" in the ISP's timezone (spec D2) */
  period: z.string(),
  chargeCount: z.number().int(),
  shareCents: z.number().int(),
  /* What the ISP writes on the transfer (spec D3) */
  reference: z.string(),
  current: z.boolean(),
});

export const settlementResponse = z.object({
  months: z.array(settlementMonth),
});

export type SettlementMonth = z.infer<typeof settlementMonth>;
export type SettlementResponse = z.infer<typeof settlementResponse>;
