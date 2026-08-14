import { z } from "zod";

export const ledgerQuery = z.object({
  cursor: z.coerce.number().int().positive().optional(),
});

export const ledgerEntry = z.object({
  id: z.string(),
  type: z.enum(["charge", "commission", "cash_drop"]),
  cents: z.number().int(),
  createdAt: z.number().int(),
  /* D4: rows carry their context */
  reference: z.object({ folio: z.string(), customerName: z.string() }).nullable(),
});

export const ledgerResponse = z.object({
  entries: z.array(ledgerEntry),
  nextCursor: z.number().int().nullable(),
});

export type LedgerEntryItem = z.infer<typeof ledgerEntry>;
export type LedgerResponse = z.infer<typeof ledgerResponse>;
