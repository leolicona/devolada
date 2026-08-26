import { z } from "zod";
import { BANKS } from "../../provider/banks";

/* D12 — apiCEP never rejects a bank name. Measured 2026-08-19: it aliases a
   near-miss ("Nu" validated fine) and answers `invalid`, with no cepDetails,
   when the name is a different real bank — indistinguishable from a transfer
   that never happened. So this enum is the only thing that turns a silent
   false rejection into a fixable 400. Trim first: a pasted trailing space is
   harmless, an unknown name is not. */
const bank = z.string().trim().pipe(z.enum(BANKS));

/* D13 — Banxico's clave de rastreo is alphanumeric, at most 30 characters.
   The range matters more than any single number: apiCEP's own example carries
   10 (`HSBC712057`) and Nu's carries 28, so a fixed length would be wrong for
   a product that validates every bank. What this actually catches is the
   receipt that prints the key across two lines and arrives with a space or a
   newline inside it — trim the harmless edges, reject the meaningful middle. */
const trackingKey = z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/, {
  message: "must be 6–30 letters and digits, with no spaces or line breaks",
});

/* Numeric, bounded well above anything Banxico issues (7 digits in apiCEP's
   example). Their real maximum is undocumented — apiCEP 400s past it without
   publishing the number (docs/integrations/apicep.md, open items). */
const referenceNumber = z.string().trim().regex(/^\d{1,20}$/, {
  message: "must be digits only",
});

const beneficiarySchema = z
  .object({
    bank,
    clabe: z.string().regex(/^\d{18}$/).optional(),
    phoneNumber: z.string().regex(/^\d{10}$/).optional(),
    cardNumber: z.string().regex(/^\d{16}$/).optional(),
    name: z.string().optional(),
  })
  .refine((b) => [b.clabe, b.phoneNumber, b.cardNumber].filter(Boolean).length === 1, {
    message: "exactly one of clabe, phoneNumber or cardNumber",
  });

const transferSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountCents: z.number().int().positive(),
    senderBank: bank,
    trackingKey: trackingKey.optional(),
    referenceNumber: referenceNumber.optional(),
    beneficiary: beneficiarySchema,
  })
  .refine((t) => t.trackingKey || t.referenceNumber, {
    message: "trackingKey or referenceNumber is required",
  })
  /* D17 — an intra-bank transfer never produces a SPEI CEP (the limit is
     Banxico's), and apiCEP charges a credit for rejecting it (measured
     2026-08-19: the same-institution 400 bills like any call). Refusing
     here is free and carries the actual reason, which the provider's
     rejection never names in a stable way. */
  .refine((t) => t.senderBank !== t.beneficiary.bank, {
    message:
      "senderBank and beneficiary.bank are the same institution — SPEI transfers only exist between different banks, so no CEP can validate this",
  });

/* One endpoint, two doors (spec D1): exactly one of transfer / receiptUrl.
   The receipt door needs someone to match against: a beneficiary or a
   candidate list, not both. */
export const validateRequestSchema = z
  .object({
    transfer: transferSchema.optional(),
    receiptUrl: z.string().url().optional(),
    beneficiary: beneficiarySchema.optional(),
    potentialBeneficiaries: z.array(beneficiarySchema).min(1).optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.transfer === !body.receiptUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exactly one of transfer or receiptUrl" });
    }
    if (body.transfer && (body.beneficiary || body.potentialBeneficiaries)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "the transfer door carries its own beneficiary" });
    }
    if (body.receiptUrl && !body.beneficiary === !body.potentialBeneficiaries) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "the receipt door needs beneficiary or potentialBeneficiaries (not both)",
      });
    }
  });

export type ValidateRequest = z.infer<typeof validateRequestSchema>;
