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
  /* automated-collections-api D6 (FR-031): `closed` is the one state an
     API link adds — a one-time link that was paid or whose deadline
     passed. The page explains itself in es-MX and offers no CLABE. */
  status: z.enum(["debt", "no_debt", "unavailable", "closed"]),
  /* With `closed` only: which of the two it was, because the payer who
     already paid and the payer who arrived late read different words */
  closedReason: z.enum(["paid", "expired"]).optional(),
  /* automated-collections-api FR-006: the description the caller
     supplied for the payer. Panel links carry none. */
  concept: z.string().optional(),
  invoiceCents: z.number().int().optional(),
  carriedBalanceCents: z.number().int().optional(),
  serviceFeeCents: z.number().int().optional(),
  totalCents: z.number().int().optional(),
  speiClabe: z.string().optional(),
  speiBank: z.string().optional(),
  speiBeneficiaryName: z.string().optional(),
  /* Goes in the transfer's concepto so the ISP can recognise the payer */
  reference: z.string().optional(),
  /* cobros-live D8 (US-R04): the invoices that make the total, oldest
     first. Information, never a picker — the payment stays whole (D21). */
  cobros: z
    .array(
      z.object({
        externalId: z.number().int(),
        amountCents: z.number().int(),
        invoiceDate: z.string().nullable(),
      }),
    )
    .optional(),
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

   The machine reads, and the provider reads beside it on the paid call
   (two-eyes-receipt D3). What comes back here is a *draft* — never a
   submission, and never anything that decides money. Since D13 the payer
   is not asked to confirm it as a matter of course: the page sends the
   file and the two readings settle what they can between them. */
export const readProofRequest = z.object({
  proofId: z.string().min(1),
});

export const proofReadingResponse = z.object({
  /* "provider-ocr" means nothing here could read the file — no AI
     binding, a PDF whose text conversion yielded nothing, or a model
     answer that would not parse. It used to mean "the file was a PDF",
     which two-eyes-receipt D1 retired: a PDF is turned into text at the
     edge and read by the same model, so it answers like a picture. The
     payer keeps the receipt door instead of confirming a draft. */
  source: z.enum(["reader", "provider-ocr"]),
  isReceipt: z.boolean().nullable(),
  /* two-eyes-receipt D2 (R7): how much of the picture the reader could
     read. The page refuses on `none` — and only on `none`, beside
     `isReceipt: false` — before any credit is spent (FR-004); `partial`
     goes through with its hole (FR-005). Null on a text reading of a PDF
     (no photograph to judge, D15) and when the model omitted the field,
     both read as `full`: the bias is to let files through. This endpoint
     reports it; the *page* is what refuses. */
  legibility: z.enum(["full", "partial", "none"]).nullable(),
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
  /* The terminal values are kept for compatibility and are **no longer
     produced inline** (two-eyes-receipt D4): the answer does not wait
     for the provider any more, so what a payer gets here is
     `validating`, or `queued_for_credit` while the business is paused.
     The outcome arrives on the first poll of the status endpoint, which
     the page was already doing. They stay in the enum because an
     integrator's client may still switch on them, and because a caller
     without an execution context (a test calling the app directly)
     still finishes the attempt inline and can see one. */
  status: z.enum(["validating", "confirmed", "partial", "invalid", "unapplied", "queued_for_credit"]),
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
    /* prepaid-credit D8/D9: waiting for the business to top up */
    "queued_for_credit",
  ]),
  /* partial-payment D7: the page speaks in pesos, never in percentages,
     so the three numbers it needs arrive computed. Present once a
     verdict exists. */
  receivedCents: z.number().int().optional(),
  debtCents: z.number().int().optional(),
  missingCents: z.number().int().optional(),
  /* integrations-hub D7: the generic outcome travels here too */
  actionOutcome: z.enum(["queued", "done", "withheld", "failed", "observation"]).optional(),
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
  /* reading-check D3/D4: what the two readings said. "agreed" lets the
     page retire the clock; "disputed" opens the form with the disputed
     fields empty. A blind comparison stays null on the wire — no evidence
     is the same as no comparison, and the page behaves as today.
     two-eyes-receipt D5: it arrives on the *first* poll after the first
     paid call now, instead of after the minute-two attempt. */
  readingCheck: z.enum(["agreed", "disputed"]).nullable().optional(),
  /* two-eyes-receipt D20: `"date"` joins them. The accepted data had no
     date on either reading, so the payer is asked for that one field
     while the agreement stands — the transfer door is never called with
     a date nobody read. The page empties exactly these fields. */
  disputedFields: z.array(z.enum(["trackingKey", "amount", "date"])).optional(),
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

/* GET /direct-payments/links/roster — ISP session (US-D07, pilot-UX
   round: the whole tenant, searched client-side by contains) */
export const linksRosterResponse = z.object({
  results: z.array(
    z.object({
      /* automated-collections-api FR-011 (US1 scenario 11): one list per
         business, every row marked with the channel that collects. */
      channel: z.enum(["panel", "api"]),
      /* Panel rows: the WispHub customer. Null on an API row. */
      wisphubId: z.number().nullable(),
      usuario: z.string().nullable(),
      /* API rows: the caller's reference, its display name and the ask
         stored on the row. Absent on a panel row. */
      customerRef: z.string().optional(),
      label: z.string().nullable().optional(),
      askCents: z.number().int().optional(),
      linkState: z.enum(["open", "paid", "expired"]).optional(),
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
  /* cobros-live's honesty flag, same meaning: the page cap was hit */
  complete: z.boolean(),
  readAt: z.number().int(),
});

/* ---- links-on-demand-search: the doors that replace the roster ---- */

/* GET /direct-payments/customers — ISP session (D1).

   The resource is the ISP's CUSTOMERS, each with their link if one
   exists — not a list of links. Browsing and searching are one door:
   the rows have the same shape and differ only in how they were found,
   so a page with one search box holds one query rather than swapping
   between two mid-keystroke. */

/* D3: the client sends what fills its viewport; the server decides what
   it is willing to read. The floor keeps a tall screen from paying four
   round trips to fill itself; the ceiling keeps one request at one
   provider call (50 is well inside the `limit=300` WispHub honours, and
   one call is 0.4–0.6 s measured). */
export const CUSTOMERS_LIMIT_MIN = 10;
export const CUSTOMERS_LIMIT_MAX = 50;
export const CUSTOMERS_LIMIT_DEFAULT = 20;

/* FR-002: three characters before anything leaves the browser. The page
   never sends less; the door refuses it anyway, because a contract that
   only holds while the client behaves is not a contract.
   Edge case: a box holding only spaces is an ABSENT q — browse, not a
   refusal. Trimmed to nothing therefore becomes undefined here rather
   than a two-character search. */
export const CUSTOMERS_SEARCH_MIN = 3;

export const customersQuery = z.object({
  q: z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    },
    z.string().min(CUSTOMERS_SEARCH_MIN).optional(),
  ),
  /* Clamped, never refused: a viewport is the client's own measurement
     and a number outside the band is not a malformed request. */
  limit: z.coerce
    .number()
    .int()
    .default(CUSTOMERS_LIMIT_DEFAULT)
    .transform((n) => Math.min(CUSTOMERS_LIMIT_MAX, Math.max(CUSTOMERS_LIMIT_MIN, n))),
  /* Opaque (D2). Only meaningful while `q` is absent — a search answers
     one block and no cursor (D5). */
  cursor: z.string().optional(),
});

/* One row shape for both channels and for both ways of finding one
   (data-model.md). What it does NOT carry is the point of FR-010: the
   link stores none of this — every field below is read live from the
   provider, or from the row Devolada owns. */
export const customerRow = z.object({
  /* automated-collections-api FR-011: who collects. Rendered as icon +
     text, never colour alone (constitution VI). */
  channel: z.enum(["panel", "api"]),
  /* Panel: the identity, and the only key any lookup uses. Null on an
     API row, which has no WispHub customer at all. */
  usuario: z.string().nullable(),
  wisphubId: z.number().int().nullable(),
  /* API: the caller's own reference, its display name and the stored ask */
  customerRef: z.string().nullable(),
  label: z.string().nullable(),
  askCents: z.number().int().nullable(),
  linkState: z.enum(["open", "paid", "expired"]).nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  /* D7: the row's link exists or it does not. Most rows have none now —
     a link is born on the act (FR-008), not on being listed. */
  hasLink: z.boolean(),
  /* D7: null when `hasLink` is false. A null URL means *no link yet*;
     it does NOT mean hide the buttons — that was the roster's rule and
     it is what FR-026 ends. Pressing one creates the link (D8). */
  url: z.string().nullable(),
  waLink: z.string().nullable(),
});

export const customersResponse = z.object({
  results: z.array(customerRow),
  /* Null when the walk is exhausted, and always null on a search (D5) */
  nextCursor: z.string().nullable(),
  /* Search only: a FLOOR, not a total (D5). The union of four filters
     cannot be sized without fetching all four whole, so the page says
     "más de N coincidencias" rather than claiming a number it did not
     compute. */
  matched: z.number().int().nullable(),
  /* Browse only: the provider's own count of the customer base */
  total: z.number().int().nullable(),
  /* D10, FR-014/FR-015: the provider being away is an ANSWER, never a
     503. `not_configured` is the same shape for a business that never
     connected WispHub — its API links, and the empty state says where
     links come from (constitution VIII). */
  wisphub: z.enum(["ok", "unavailable", "not_configured"]),
});

/* POST /direct-payments/links — the act FR-008 names (D8).

   Creates the customer's permanent link, or returns the one that
   already exists; it is never replaced (FR-005, FR-009). Links and
   Cobros both press this one door (D14), which is what keeps the two
   screens obeying one rule. */
export const createLinkRequest = z.object({
  usuario: z.string().trim().min(1),
});

export const createLinkResponse = z.object({
  token: z.string(),
  url: z.string(),
  /* D16: built from the phone this act just read, so WhatsApp opens the
     CUSTOMER'S OWN CHAT. `toWhatsAppPhone` still owns the rules and
     still refuses a number it cannot read — that refusal falls back to
     WhatsApp's picker, which is now the exception rather than the rule
     (FR-019, FR-028). */
  waLink: z.string(),
  /* False when the link already existed: the same link came back */
  created: z.boolean(),
});

export type LinkStatusResponse = z.infer<typeof linkStatusResponse>;
export type PayRequest = z.infer<typeof payRequest>;
export type PayResponse = z.infer<typeof payResponse>;
export type DirectPaymentStatusResponse = z.infer<typeof directPaymentStatusResponse>;
export type ProofUploadResponse = z.infer<typeof proofUploadResponse>;
export type ProofReading = z.infer<typeof proofReadingResponse>;
export type LinksListResponse = z.infer<typeof linksListResponse>;
export type LinksRosterResponse = z.infer<typeof linksRosterResponse>;
export type CustomersQuery = z.infer<typeof customersQuery>;
export type CustomerRow = z.infer<typeof customerRow>;
export type CustomersResponse = z.infer<typeof customersResponse>;
export type CreateLinkRequest = z.infer<typeof createLinkRequest>;
export type CreateLinkResponse = z.infer<typeof createLinkResponse>;
export type PublicPaymentError = z.infer<typeof publicPaymentError>;
