import { z } from "zod";

const beneficiarySchema = z
  .object({
    bank: z.string().min(1),
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
    senderBank: z.string().min(1),
    trackingKey: z.string().min(1).optional(),
    referenceNumber: z.string().min(1).optional(),
    beneficiary: beneficiarySchema,
  })
  .refine((t) => t.trackingKey || t.referenceNumber, {
    message: "trackingKey or referenceNumber is required",
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
