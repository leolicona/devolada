import { z } from "zod";

/* Shareable contract: the admin derives types, MSW validates against it. */

/* D5: an allow-list, not a free string. Mexico has three zones and the
   UI names them; an unknown zone would silently move a business day. */
export const TIMEZONES = [
  { value: "America/Mexico_City", label: "Centro (Ciudad de México)", utc: "UTC−6" },
  { value: "America/Hermosillo", label: "Pacífico (Sonora)", utc: "UTC−7" },
  { value: "America/Tijuana", label: "Noroeste (Baja California)", utc: "UTC−8" },
] as const;

export const timezone = z.enum([
  "America/Mexico_City",
  "America/Hermosillo",
  "America/Tijuana",
]);

export const timeFormat = z.enum(["12h", "24h"]);

export const settingsResponse = z.object({
  serviceFeeCents: z.number().int(),
  storeCommissionCents: z.number().int(),
  /* D4: derived from the two above, never stored */
  platformShareCents: z.number().int(),
  timezone,
  timeFormat,
  wisphub: z.object({
    configured: z.boolean(),
    /* D1: the key is write-only — this is only enough to recognise it */
    keyTail: z.string().nullable(),
  }),
  /* Present when the patch carried a new key (D3) */
  wisphubTest: z
    .object({ ok: z.boolean(), code: z.string().nullable() })
    .optional(),
});

export const settingsPatchRequest = z
  .object({
    serviceFeeCents: z.number().int().nonnegative(),
    storeCommissionCents: z.number().int().nonnegative(),
    timezone,
    timeFormat,
    wisphubApiKey: z.string().trim().min(8),
  })
  .partial();

export const wisphubTestRequest = z.object({
  /* D2: test the typed candidate before it is saved; omit to test the stored one */
  apiKey: z.string().trim().min(8).optional(),
});

export const wisphubTestResponse = z.object({
  ok: z.boolean(),
  code: z.string().nullable(),
  sampleCustomerCount: z.number().int().nullable(),
});

export type SettingsResponse = z.infer<typeof settingsResponse>;
export type SettingsPatchRequest = z.infer<typeof settingsPatchRequest>;
export type WispHubTestResponse = z.infer<typeof wisphubTestResponse>;
