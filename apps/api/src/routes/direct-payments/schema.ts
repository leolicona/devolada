import { z } from "zod";
import { BANKS } from "../../direct-payments/banks";

/* D16: re-exported so the payer's form is built from the same list that
   validates it — the TIMEZONES pattern in settings-schema. A picker that can
   offer a name the server refuses is the bug this closes (BUG-007). */
export { BANKS, type Bank } from "../../direct-payments/banks";

/* Shareable contract (ARCHITECTURE.md): apps/pago derives types from
   these schemas and its MSW handlers validate against them. */

/* GET /direct-payments/links/:token (US-D01). `unavailable` means the
   ISP has not configured SPEI (D4): the page points at the store
   network — the customer never transfers into the void. */
export const linkStatusResponse = z.object({
  ispName: z.string(),
  customerName: z.string().optional(),
  status: z.enum(["debt", "no_debt", "unavailable"]),
  invoiceCents: z.number().int().optional(),
  carriedBalanceCents: z.number().int().optional(),
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
        /* BUG-006/D16: a clave de rastreo is alphanumeric and at most 30
           characters. A range, not a fixed 28 — that is Nu's length, while
           apiCEP's own example carries ten (`HSBC712057`), and a payer may
           bank anywhere. Trimming the edges while enforcing the middle is
           the point: a pasted trailing newline is harmless, a space inside
           is the two-line receipt wrap that costs a paid call and comes
           back `invalid`. */
        trackingKey: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/),
        /* D16: apiCEP answers `invalid` — never an error — for a bank name
           it does not know, which reads exactly like a transfer that never
           happened. Refusing here is the only way the payer ever learns. */
        senderBank: z.string().trim().pipe(z.enum(BANKS)),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        /* claimed-amount D3: the amount the payer says they transferred.
           Pre-filled with the expected total on the page, editable —
           only the payer knows what really left their account, and the
           lookup asks Banxico with it. Never what is charged: the charge
           comes from the CEP and a fresh debt read, so lying here cannot
           buy a cheaper payment (same posture as receiptAmountCents). */
        amountCents: z.number().int().positive().optional(),
      })
      .optional(),
    /* D18: the payment this submission corrects. Set only when the payer
       answered a `not_found` confirmation. If the three fields come back
       unchanged, the existing row is kept and nothing is spent; if they
       changed, the old row is `superseded` so it releases its claim on
       `(business_id, tracking_key)` before the new one takes it. */
    supersedes: z.string().min(1).optional(),
    /* D18: the `Estatus` the reader saw on the receipt, carried forward
       so the row can answer a reload. Client-supplied and harmless: it
       decides which of two waiting messages the payer reads, never a
       verdict, never an amount, never whether anything is confirmed. */
    receiptStatus: z.string().max(60).optional(),
    /* D18: the amount the reader saw on the receipt. Client-supplied and
       **never** used to decide what is charged — that is computed here
       from a fresh WispHub read (D2), and omitting this field cannot buy
       anyone a cheaper payment. It exists because `sender.amount` is a
       filter in apiCEP's direct mode (measured 2026-08-19), so a receipt
       whose amount is not the debt produces a lookup that cannot succeed
       and a faceless `not_found` six hours long. Refusing it here costs
       nothing and answers the payer immediately. */
    receiptAmountCents: z.number().int().positive().optional(),
  })
  .superRefine((body, ctx) => {
    /* D18: the two travel together on the read path — the payer uploaded
       a receipt, a machine read it, and what validates is the transfer
       door while the image stays attached as the evidence the ISP will
       want. `transfer` wins the routing; the proof is kept, not
       consulted. */
    if (!body.proofId && !body.transfer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "proofId or transfer is required",
      });
    }
    if (body.supersedes && !body.transfer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "supersedes only applies to a confirmed transfer",
      });
    }
  });

/* Validation errors the page may show the customer. Internal codes
   (provider down, WispHub down) never travel: the payment simply stays
   `validating` and the sweep keeps trying.

   D17: the last two are the two halves of what used to be one silent
   `invalid`. `TRANSFER_CONTRADICTED` is a refusal backed by a CEP;
   `TRANSFER_NOT_FOUND` is the honest admission that nothing came back,
   and it travels while the payment is still `validating` precisely so
   the page can say what is happening instead of blaming the payer. */
export const publicPaymentError = z.enum([
  "TRANSFER_ALREADY_USED",
  "AMOUNT_MISMATCH",
  "STALE_TRANSFER",
  "TRANSFER_CONTRADICTED",
  "TRANSFER_NOT_FOUND",
]);

/* POST /direct-payments/links/:token/read (US-D11, D18)

   The machine reads, the human confirms, the direct door validates. What
   comes back is a *draft* of the form the payer is about to submit —
   never a submission, and never anything that decides money. */
export const readProofRequest = z.object({
  proofId: z.string().min(1),
});

export const proofReadingResponse = z.object({
  /* "provider-ocr" means the file was a PDF and nothing was read here:
     the payer keeps the receipt door instead of confirming a draft */
  source: z.enum(["reader", "provider-ocr"]),
  isReceipt: z.boolean().nullable(),
  /* Fields the payer may confirm, plus the amount — which they never
     confirm and never edit. **Correction, 2026-08-19**: the first version
     of this contract left the amount out, on the argument that it is
     server-supplied (D2) and a reading must not go near money (D11).
     Both still hold, and the omission was still wrong: `sender.amount` is
     a **filter** in apiCEP's direct mode (measured — a known-good clave
     with a wrong amount returns the same faceless `invalid` a nonexistent
     transfer does), so a receipt whose amount differs from the debt makes
     the lookup fail with nothing to show for it. The reading is not used
     to decide money here. It is used to decide **whether to bother the
     provider at all**, which is what D3 always said it was for. */
  amountCents: z.number().int().nullable(),
  trackingKey: z.string().nullable(),
  senderBank: z.string().nullable(),
  date: z.string().nullable(),
  receiptStatus: z.string().nullable(),
  gate: z.object({
    trackingKey: z.enum(["ok", "malformed", "missing"]),
    senderBank: z.enum(["ok", "unknown", "missing"]),
    amount: z.enum(["ok", "malformed", "missing"]),
  }),
});

export const payResponse = z.object({
  directPaymentId: z.string(),
  /* `partial` included: the inline attempt can finish the validation, and
     a short transfer's verdict travels back on the POST itself — the
     status endpoint is not the only door it comes through (US-D10 D6). */
  status: z.enum(["validating", "confirmed", "partial", "invalid", "unapplied"]),
  error: publicPaymentError.nullable(),
});

/* GET /direct-payments/:id/status (US-D03, US-D04) */
export const directPaymentStatusResponse = z.object({
  status: z.enum([
    "validating",
    "confirmed",
    "partial",
    "invalid",
    "expired",
    "unapplied",
    "superseded",
  ]),
  /* partial-payment D7: the page speaks in pesos, never in percentages,
     so the three numbers it needs arrive computed. Present once a
     verdict exists. */
  receivedCents: z.number().int().optional(),
  debtCents: z.number().int().optional(),
  missingCents: z.number().int().optional(),
  reconnectionStatus: z.enum(["queued", "reconnected", "failed", "withheld"]).optional(),
  folio: z.string().optional(),
  validationAttempts: z.number().int(),
  /* validation-status-ux D5: ms epoch of the next automatic attempt, so
     the page can say "volveremos a intentarlo alrededor de las {hora}".
     Null once terminal. */
  nextValidationAt: z.number().int().nullable().optional(),
  error: publicPaymentError.nullable(),
  /* D18: what the silent attempt was built from, so the confirmation
     screen can render from the row rather than from whatever the browser
     still holds — a reload must not lose the question. All of it is the
     payer's own data. */
  trackingKey: z.string().nullable().optional(),
  senderBank: z.string().nullable().optional(),
  transferDate: z.string().nullable().optional(),
  /* claimed-amount D3: what the payment asked Banxico with, so the
     correction form pre-fills the amount that actually travelled */
  claimedAmountCents: z.number().int().nullable().optional(),
  /* reading-check D3/D4: the minute-two classification. "agreed" lets
     the page retire the clock; "disputed" opens the form now with the
     disputed fields empty. A blind cross stays null on the wire — no
     evidence is the same as no cross, and the page behaves as today. */
  readingCheck: z.enum(["agreed", "disputed"]).nullable().optional(),
  disputedFields: z.array(z.enum(["trackingKey", "amount"])).optional(),
  /* The receipt's own `Estatus`: decides whether the payer is asked to
     confirm or simply told their bank has not released it yet */
  receiptStatus: z.string().nullable().optional(),
  /* provisional-release D9 (US-D15): present only when the service was
     actually given back, with the evidence that bought it — the page
     never speaks in conditionals */
  provisionalRelease: z
    .object({
      evidence: z.enum(["pending", "agreed", "human"]).nullable(),
      /* which face acted: reconnect (was suspended) | protect (was
         current) — the copy differs and must never lie */
      kind: z.enum(["reconnect", "protect"]).nullable(),
    })
    .optional(),
  /* provisional-release D7: on `expired` only — whether the one manual
     retry per clave is still unclaimed */
  retryAvailable: z.boolean().optional(),
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
export type ProofReading = z.infer<typeof proofReadingResponse>;
export type LinksListResponse = z.infer<typeof linksListResponse>;
export type LinksSearchResponse = z.infer<typeof linksSearchResponse>;
export type PublicPaymentError = z.infer<typeof publicPaymentError>;
