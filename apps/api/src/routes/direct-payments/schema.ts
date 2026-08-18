import { z } from "zod";

/* Shareable contract (ARCHITECTURE.md): apps/pago derives types from
   these schemas and its MSW handlers validate against them. */

/* GET /direct-payments/links/:token (US-D01). `unavailable` means the
   ISP has not configured SPEI (D4): the page points at the store
   network — the customer never transfers into the void. */
export const linkStatusResponse = z.object({
  ispName: z.string(),
  customerName: z.string().optional(),
  status: z.enum(["debt", "no_debt", "unavailable"]),
  monthlyFeeCents: z.number().int().optional(),
  serviceFeeCents: z.number().int().optional(),
  totalCents: z.number().int().optional(),
  speiClabe: z.string().optional(),
  speiBank: z.string().optional(),
  speiBeneficiaryName: z.string().optional(),
  /* Goes in the transfer's concepto so the ISP can recognise the payer */
  reference: z.string().optional(),
});

/* POST /direct-payments/links/:token/pay (US-D02). Exactly one proof
   door, same principle as Consta's own contract: a screenshot already
   uploaded (proofId) or the transfer's data typed by the customer.
   Amount and beneficiary are server-side (D1): the client never sends
   its own money. */
export const payRequest = z
  .object({
    proofId: z.string().min(1).optional(),
    transfer: z
      .object({
        trackingKey: z.string().trim().min(5).max(50),
        senderBank: z.string().trim().min(2).max(80),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .optional(),
  })
  .superRefine((body, ctx) => {
    if (Boolean(body.proofId) === Boolean(body.transfer)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exactly one of proofId or transfer",
      });
    }
  });

/* Validation errors the page may show the customer. Internal codes
   (provider down, WispHub down) never travel: the payment simply stays
   `validating` and the sweep keeps trying. */
export const publicPaymentError = z.enum([
  "TRANSFER_ALREADY_USED",
  "AMOUNT_MISMATCH",
  "STALE_TRANSFER",
]);

export const payResponse = z.object({
  directPaymentId: z.string(),
  status: z.enum(["validating", "confirmed", "invalid", "unapplied"]),
  error: publicPaymentError.nullable(),
});

/* GET /direct-payments/:id/status (US-D03, US-D04) */
export const directPaymentStatusResponse = z.object({
  status: z.enum(["validating", "confirmed", "invalid", "expired", "unapplied"]),
  reconnectionStatus: z.enum(["queued", "reconnected", "failed"]).optional(),
  folio: z.string().optional(),
  validationAttempts: z.number().int(),
  error: publicPaymentError.nullable(),
});

/* POST /direct-payments/links/:token/proof (D12) */
export const proofUploadResponse = z.object({
  proofId: z.string(),
});

/* GET /direct-payments/links — ISP session (US-D05, US-D06) */
export const linksListQuery = z.object({
  cursor: z.string().optional(),
});

export const linksListResponse = z.object({
  links: z.array(
    z.object({
      token: z.string(),
      usuario: z.string(),
      url: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

/* GET /direct-payments/links/search — ISP session (US-D07) */
export const linksSearchQuery = z.object({
  q: z.string().trim().min(2),
});

export const linksSearchResponse = z.object({
  results: z.array(
    z.object({
      wisphubId: z.number(),
      usuario: z.string(),
      name: z.string(),
      phone: z.string().nullable(),
      url: z.string(),
      /* Ready to open (D3): the API owns the message and the country
         code, exactly like the receipt's wa.me link. Falls back to
         WhatsApp's contact picker when the stored phone is unreadable —
         better than opening a stranger's chat (receipt spec D3). */
      waLink: z.string(),
    }),
  ),
});

export type LinkStatusResponse = z.infer<typeof linkStatusResponse>;
export type PayRequest = z.infer<typeof payRequest>;
export type PayResponse = z.infer<typeof payResponse>;
export type DirectPaymentStatusResponse = z.infer<typeof directPaymentStatusResponse>;
export type ProofUploadResponse = z.infer<typeof proofUploadResponse>;
export type LinksListResponse = z.infer<typeof linksListResponse>;
export type LinksSearchResponse = z.infer<typeof linksSearchResponse>;
export type PublicPaymentError = z.infer<typeof publicPaymentError>;
