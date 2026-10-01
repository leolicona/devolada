import { z } from "zod";
import { SETTING_KEYS } from "../../platform/settings";
import { nationalPhone } from "../../phone";

/* cash-at-stores D31: the receipt template's rules, for the panel to check
   a draft by the same rules the API saves by (FR-043) */
export {
  DEFAULT_RECEIPT_TEMPLATE,
  RECEIPT_PLACEHOLDERS,
  RECEIPT_PLACEHOLDER_HELP,
  RECEIPT_TEMPLATE_MAX,
  RECEIPT_TEMPLATE_MIN,
  receiptTemplateProblem,
  type TemplateProblem,
} from "../../receipt/template";

/* Shareable contract for the operator panel (operator-panel spec). */

export const settingKey = z.enum(SETTING_KEYS as [string, ...string[]]);

export const settingItem = z.object({
  key: z.string(),
  /* cash-at-stores D31: `template`, the receipt's multi-line message */
  type: z.enum(["cents", "int", "clabe", "bank", "text", "enum", "template"]),
  birth: z.string().nullable(),
  current: z.string().nullable(),
  history: z.array(z.object({ value: z.string(), authorUserId: z.string(), createdAt: z.number().int() })),
});
export const settingsListResponse = z.object({ settings: z.array(settingItem) });

export const setSettingRequest = z.object({ value: z.union([z.string(), z.number()]) });

/* cash-at-stores D7, D8, D9: what the integration can do, by name */
export const CAPABILITY_NAMES = ["receivables", "customerDebt", "customersWithPhone", "customerSearch", "paymentActions"] as const;
/* FR-007: the three the store channel needs */
export const STORE_CHANNEL_CAPABILITIES = ["customerSearch", "customerDebt", "paymentActions"] as const;

export const businessRow = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  status: z.enum(["active", "suspended"]),
  balanceCents: z.number().int(),
  step: z.enum(["ok", "low", "empty", "paused"]),
  feeCents: z.number().int(),
  feeOverrideCents: z.number().int().nullable(),
  createdAt: z.number().int(),
  /* cash-at-stores D7: the switch; `since` is never cleared */
  storeChannel: z.object({ on: z.boolean(), since: z.number().int().nullable() }),
  /* cash-at-stores FR-007: the panel names what is missing from these,
     with no network call (`capabilityNames`) */
  capabilities: z.array(z.enum(CAPABILITY_NAMES)),
  /* cash-at-stores D19: the business's cash held across every store */
  storeHeldCents: z.number().int(),
});
export const businessesListResponse = z.object({ businesses: z.array(businessRow) });

/* operator-panel D6, and cash-at-stores D7: each field optional — a PATCH
   changes what it names */
export const patchBusinessRequest = z
  .object({
    feeOverrideCents: z.number().int().min(100).max(5000).nullable().optional(),
    storeChannel: z.boolean().optional(),
  })
  .refine((b) => b.feeOverrideCents !== undefined || b.storeChannel !== undefined, "nothing to change");

/* operator-panel D5: signed cents and a reason worth reading later */
export const adjustmentRequest = z.object({
  cents: z.number().int().refine((n) => n !== 0, "zero is not an adjustment"),
  reason: z.string().trim().min(10).max(300),
});

export type SettingsListResponse = z.infer<typeof settingsListResponse>;
export type BusinessesListResponse = z.infer<typeof businessesListResponse>;
export type PlatformBusinessRow = z.infer<typeof businessRow>;

/* payment-without-receipt D19 (FR-038): GET /platform/provider-quota — the
   provider's remaining calls as its latest answer said, and when. Null
   until an answer has carried the header. A platform row: it names no
   business. */
export const providerQuotaResponse = z
  .object({
    provider: z.literal("apicep"),
    remaining: z.number().int(),
    observedAt: z.number().int(),
  })
  .nullable();
export type ProviderQuotaResponse = z.infer<typeof providerQuotaResponse>;

/* ---- cash-at-stores: the operator's stores (contracts/platform-stores-api.md) ---- */

/* D3, L5: a store's phone is ten national digits once spaces and dashes
   are dropped — the core's own rule, so the sign-in name and the
   WhatsApp link read it the same way */
const storePhone = z
  .string()
  .trim()
  .refine((v) => nationalPhone(v) !== null, "ten digits");

export const createStoreRequest = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(5).max(200),
  shopkeeperName: z.string().trim().min(2).max(80),
  phone: storePhone,
});

export const patchStoreRequest = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    address: z.string().trim().min(5).max(200).optional(),
    shopkeeperName: z.string().trim().min(2).max(80).optional(),
    phone: storePhone.optional(),
    /* `invited` is never set by hand (data-model) */
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "nothing to change");

export const storeRow = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  shopkeeperName: z.string(),
  phone: z.string(),
  status: z.enum(["invited", "active", "suspended"]),
  createdAt: z.number().int(),
  /* FR-001: the business with the channel on (for an active store), plus
     every business it still holds cash for */
  collectsFor: z.array(z.object({ businessId: z.string(), businessName: z.string(), heldCents: z.number().int() })),
});
export const storesListResponse = z.object({ stores: z.array(storeRow) });

/* D4: the plaintext link, shown in this answer and in a resend's only */
export const storeInvitation = z.object({
  url: z.string().url(),
  expiresAt: z.number().int(),
  waLink: z.string().url(),
});
export const createStoreResponse = z.object({ store: storeRow, invitation: storeInvitation });

/* GET /platform/stores/:id/ledger/:businessId — the store's own row shape
   plus the payment and, on a correction, its author */
export const platformLedgerRow = z.object({
  id: z.string(),
  kind: z.enum(["collection", "handover", "correction"]),
  cents: z.number().int(),
  at: z.number().int(),
  businessId: z.string(),
  businessName: z.string(),
  folio: z.string().nullable(),
  customerName: z.string().nullable(),
  feeCents: z.number().int().nullable(),
  reason: z.string().nullable(),
  paymentId: z.string().nullable(),
  authorEmail: z.string().nullable(),
});
export const platformLedgerResponse = z.object({
  heldCents: z.number().int(),
  rows: z.array(platformLedgerRow),
  nextCursor: z.string().nullable(),
});

/* D21 (FR-030): an amount of either sign and a reason worth reading later */
export const correctionRequest = z.object({
  paymentId: z.string().min(1),
  cents: z.number().int().refine((n) => n !== 0, "zero is not a correction"),
  reason: z.string().trim().min(3).max(280),
});
export const correctionResponse = z.object({
  id: z.string(),
  cents: z.number().int(),
  reason: z.string(),
  createdAt: z.number().int(),
});

export type StoreRow = z.infer<typeof storeRow>;
export type StoresListResponse = z.infer<typeof storesListResponse>;
export type CreateStoreRequest = z.infer<typeof createStoreRequest>;
export type PatchStoreRequest = z.infer<typeof patchStoreRequest>;
export type StoreInvitation = z.infer<typeof storeInvitation>;
export type CreateStoreResponse = z.infer<typeof createStoreResponse>;
export type PlatformLedgerRow = z.infer<typeof platformLedgerRow>;
export type PlatformLedgerResponse = z.infer<typeof platformLedgerResponse>;
export type CorrectionRequest = z.infer<typeof correctionRequest>;
export type CorrectionResponse = z.infer<typeof correctionResponse>;
export type PatchBusinessRequest = z.infer<typeof patchBusinessRequest>;
