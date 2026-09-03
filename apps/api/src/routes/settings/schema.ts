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
  /* Read-only since D9: the birth default the SPEI fee inherits until the
     business saves one (direct-payment D3). Nothing edits it anymore —
     `spei.effectiveServiceFeeCents` is the number in force. */
  serviceFeeCents: z.number().int(),
  timezone,
  timeFormat,
  /* The WispHub key and the reconnection dials moved to the hub
     (integrations-hub D9): GET /integrations owns them now. */
  /* Direct SPEI channel (direct-payment spec D3, D4): the ISP's own
     account — nothing here belongs to Devolada. */
  spei: z.object({
    clabe: z.string().nullable(),
    bank: z.string().nullable(),
    beneficiaryName: z.string().nullable(),
    /* null → never saved yet; falls back to serviceFeeCents (D3) */
    serviceFeeCents: z.number().int().nullable(),
    /* The fee in force — the one control on the settings page (D9) */
    effectiveServiceFeeCents: z.number().int(),
    /* The bank is set but outside apiCEP's vocabulary (BUG-008) */
    bankUnknown: z.boolean(),
    configured: z.boolean(),
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

/* D9: the service fee has one control and it writes `speiServiceFeeCents`
   — `serviceFeeCents` is not patchable; a second writable fee is how the
   page grew two cards for one number. */
export const settingsPatchRequest = z
  .object({
    timezone,
    timeFormat,
    /* SPEI config (direct-payment D3, D4): explicit null clears a field */
    speiClabe: z.string().trim().regex(/^\d{18}$/).nullable(),
    /* D16: this travels as `beneficiary.bank` on every validation, so a
       name apiCEP does not know poisons every payment to this ISP, not one. */
    speiBank: z.string().trim().pipe(z.enum(BANKS)).nullable(),
    speiBeneficiaryName: z.string().trim().min(3).max(120).nullable(),
    speiServiceFeeCents: z.number().int().nonnegative().nullable(),
    /* payments-and-classes D1 */
    toleranceCents: z.number().int().min(0).max(10000),
    overTreatment: z.enum(["flag", "credit"]),
  })
  .partial();

export type SettingsResponse = z.infer<typeof settingsResponse>;
export type SettingsPatchRequest = z.infer<typeof settingsPatchRequest>;
