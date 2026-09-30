import { z } from "zod";
import { SETTING_KEYS } from "../../platform/settings";

/* Shareable contract for the operator panel (operator-panel spec). */

export const settingKey = z.enum(SETTING_KEYS as [string, ...string[]]);

export const settingItem = z.object({
  key: z.string(),
  type: z.enum(["cents", "int", "clabe", "bank", "text", "enum"]),
  birth: z.string().nullable(),
  current: z.string().nullable(),
  history: z.array(z.object({ value: z.string(), authorUserId: z.string(), createdAt: z.number().int() })),
});
export const settingsListResponse = z.object({ settings: z.array(settingItem) });

export const setSettingRequest = z.object({ value: z.union([z.string(), z.number()]) });

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
});
export const businessesListResponse = z.object({ businesses: z.array(businessRow) });

export const patchBusinessRequest = z.object({
  feeOverrideCents: z.number().int().min(100).max(5000).nullable(),
});

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
