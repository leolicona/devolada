import { z } from "zod";
import { BANKS } from "../../direct-payments/banks";

/* Same reason as TIMEZONES below: the admin's picker is built from the list
   that validates it (D16). The ISP's bank is the more dangerous of the two —
   it travels as `beneficiary.bank` on every validation this ISP ever runs. */
export { BANKS, type Bank } from "../../direct-payments/banks";

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
  /* Survives the store retirement as the SPEI fee's fallback (D3) */
  serviceFeeCents: z.number().int(),
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
  /* Direct SPEI channel (direct-payment spec D3, D4): the ISP's own
     account — nothing here belongs to Devolada. */
  spei: z.object({
    clabe: z.string().nullable(),
    bank: z.string().nullable(),
    beneficiaryName: z.string().nullable(),
    /* null → falls back to serviceFeeCents (D3) */
    serviceFeeCents: z.number().int().nullable(),
    effectiveServiceFeeCents: z.number().int(),
    /* The bank is set but outside apiCEP's vocabulary (BUG-008) */
    bankUnknown: z.boolean(),
    configured: z.boolean(),
  }),
  /* partial-payment D2/D4: when a transfer falls short, these two decide
     whether the router is touched. Both must hold; the defaults (100 / $0)
     mean only a full payment reconnects. */
  reconnection: z.object({
    thresholdPercent: z.number().int().min(0).max(100),
    floorCents: z.number().int().nonnegative(),
    /* provisional-release D10 (US-D15): the one switch, no dials */
    provisionalReleaseEnabled: z.boolean(),
  }),
  /* payments-and-classes D1/D2: the business's own reconciliation
     policy. `effectiveOverTreatment` is read-only — `credit` when the
     integration absorbs surplus on its own, whatever the policy says. */
  reconciliationPolicy: z.object({
    toleranceCents: z.number().int().min(0).max(10000),
    overTreatment: z.enum(["flag", "credit"]),
    effectiveOverTreatment: z.enum(["flag", "credit"]),
  }),
});

export const settingsPatchRequest = z
  .object({
    serviceFeeCents: z.number().int().nonnegative(),
    timezone,
    timeFormat,
    wisphubApiKey: z.string().trim().min(8),
    /* SPEI config (direct-payment D3, D4): explicit null clears a field */
    speiClabe: z.string().trim().regex(/^\d{18}$/).nullable(),
    /* D16: this travels as `beneficiary.bank` on every validation, so a
       name apiCEP does not know poisons every payment to this ISP, not one. */
    speiBank: z.string().trim().pipe(z.enum(BANKS)).nullable(),
    speiBeneficiaryName: z.string().trim().min(3).max(120).nullable(),
    speiServiceFeeCents: z.number().int().nonnegative().nullable(),
    /* partial-payment D2/D4: one percentage and one floor — two extremes
       of the same dial, never a separate switch that could disagree. */
    reconnectionThresholdPercent: z.number().int().min(0).max(100),
    reconnectionFloorCents: z.number().int().nonnegative(),
    /* payments-and-classes D1 */
    toleranceCents: z.number().int().min(0).max(10000),
    overTreatment: z.enum(["flag", "credit"]),
    /* provisional-release D10: on = evidence buys the promise while
       Banxico confirms; the fixed rule lives in the spec */
    provisionalReleaseEnabled: z.boolean(),
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
