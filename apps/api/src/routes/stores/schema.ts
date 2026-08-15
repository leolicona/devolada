import { z } from "zod";

/* Shareable contract for the Tiendas section. */

export const storeCreateRequest = z.object({
  name: z.string().min(2),
  contactName: z.string().min(2),
  phone: z.string().min(10).max(15),
  zone: z.string().optional(),
  commissionCents: z.number().int().positive().nullable().optional(),
  balanceCapCents: z.number().int().positive().optional(),
});

export const storePatchRequest = z.object({
  commissionCents: z.number().int().positive().nullable().optional(),
  balanceCapCents: z.number().int().positive().optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const storeItem = z.object({
  id: z.string(),
  name: z.string(),
  contactName: z.string(),
  phone: z.string(),
  zone: z.string().nullable(),
  status: z.enum(["invited", "active", "suspended"]),
  invitationStatus: z.enum(["sent", "accepted"]).nullable(),
  commissionCents: z.number().int().nullable(),
  balanceCents: z.number().int(),
  cap: z.object({
    capCents: z.number().int(),
    approaching: z.boolean(),
    blocked: z.boolean(),
  }),
});

/* Detail adds the shopkeeper's recovery email (owner decision,
   better-auth.spec.md): visible to the ISP, read-only, null until the
   invitation is accepted. */
export const storeDetail = storeItem.extend({ recoveryEmail: z.string().nullable() });

export const storesResponse = z.object({ stores: z.array(storeItem) });
export const storeCreateResponse = z.object({
  store: storeItem,
  invitationLink: z.string(),
});
export const resendResponse = z.object({ invitationLink: z.string() });

export type StoreItem = z.infer<typeof storeItem>;
export type StoreDetail = z.infer<typeof storeDetail>;
export type StoresResponse = z.infer<typeof storesResponse>;
export type StoreCreateResponse = z.infer<typeof storeCreateResponse>;
