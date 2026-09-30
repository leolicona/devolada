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

/* receipt-triage D9/D26: a debit card is 16 digits whose last one is the
   Luhn check digit — the one check a card number carries. Pure, and
   exported so the admin's form speaks the same rule inline. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/* receipt-triage D29: the three kinds of account an ISP can be paid at */
export const COLLECT_KINDS = ["clabe", "card", "phone"] as const;

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
    /* receipt-triage D32 — changed meaning: the cuenta de cobro is
       registered with a bank the provider knows. A CLABE is no longer
       needed; for a business with a CLABE and no choice made it is
       exactly the test it always was. */
    configured: z.boolean(),
    /* receipt-triage D9/D26: a debit card (16 digits) and a phone (10)
       that receive SPEI, each with its bank. Masked to the last four for
       a role that cannot update settings, like the CLABE. Defaulted so
       fixtures born before them still parse. */
    card: z.string().nullable().default(null),
    cardBank: z.string().nullable().default(null),
    phone: z.string().nullable().default(null),
    phoneBank: z.string().nullable().default(null),
    /* receipt-triage D29: which registered account the payers see — NULL
       on the column reads `clabe`, so a business born before this feature
       reads "clabe" here */
    collectKind: z.enum(COLLECT_KINDS).nullable().default("clabe"),
  }),
  /* payments-and-classes D1/D2: the business's own reconciliation
     policy. `effectiveOverTreatment` is read-only — `credit` when the
     integration absorbs surplus on its own, whatever the policy says. */
  reconciliationPolicy: z.object({
    toleranceCents: z.number().int().min(0).max(10000),
    overTreatment: z.enum(["flag", "credit"]),
    effectiveOverTreatment: z.enum(["flag", "credit"]),
  }),
  /* payment-without-receipt D20 (FR-039): payers pay with their own
     reference and confirm with bank and day; the receipt stays one tap
     away. Off by default. Defaulted so fixtures born before it parse. */
  payByReference: z.boolean().default(false),
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
    /* receipt-triage D9/D26: explicit null clears, like the CLABE. The
       pairs (number, bank) and the cuenta de cobro are checked against the
       merged row in the handler — a patch may send one half and rely on
       the stored other. All in the `clabe` area: owner only. */
    speiCard: z
      .string()
      .trim()
      .regex(/^\d{16}$/)
      .refine(luhnValid, { message: "the card number fails its check digit" })
      .nullable(),
    speiCardBank: z.string().trim().pipe(z.enum(BANKS)).nullable(),
    speiPhone: z.string().trim().regex(/^\d{10}$/).nullable(),
    speiPhoneBank: z.string().trim().pipe(z.enum(BANKS)).nullable(),
    speiCollectKind: z.enum(COLLECT_KINDS),
    /* payments-and-classes D1 */
    toleranceCents: z.number().int().min(0).max(10000),
    overTreatment: z.enum(["flag", "credit"]),
    /* payment-without-receipt D20: under `settings: update` (owner,
       admin), like the rest of this body. Turning it on starts the
       references' backfill (D5); off keeps every reference. */
    payByReference: z.boolean(),
  })
  .partial();

export type SettingsResponse = z.infer<typeof settingsResponse>;
export type SettingsPatchRequest = z.infer<typeof settingsPatchRequest>;
