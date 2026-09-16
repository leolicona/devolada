/* The provider boundary (validation spec D2): the handler only knows these
   shapes. apiCEP is today's implementation; a direct Banxico adapter or a
   second provider is a new file behind the same interface. */

export type Beneficiary = {
  bank: string;
  clabe?: string;
  phoneNumber?: string;
  cardNumber?: string;
  name?: string;
};

export type TransferInput = {
  mode: "transfer";
  date: string; // YYYY-MM-DD
  amountCents: number;
  senderBank: string;
  trackingKey?: string;
  referenceNumber?: string;
  beneficiary: Beneficiary;
};

export type ReceiptInput = {
  mode: "receipt";
  receiptUrl: string;
  beneficiary?: Beneficiary;
  potentialBeneficiaries?: Beneficiary[];
};

/* D11: an `invalid` is two different answers wearing one word.
   `contradicted` — a CEP came back and disagrees with the claim.
   `not_found`   — nothing came back at all: no cepDetails, no cepStatus.
   The second is ambiguous by construction (a transfer that never
   happened, a misread tracking key, a wrong sender bank, or a CEP
   Banxico has not published yet all look identical on the wire), so it
   is never a verdict the caller may act on as "this is fake". */
export type InvalidReason = "contradicted" | "not_found";

/* D14 — what the call cost and how long the provider took. Read from
   response headers; they ride 200s only (measured 2026-08-19), so any
   field can be null without the call having failed. `providerMs` is the
   one instrument that separates "we asked Banxico" (5.9–7.0 s) from "the
   provider gave up early" (1.3–2.6 s) on a faceless `invalid`. */
export type ProviderTelemetry = {
  httpStatus: number;
  providerMs: number | null;
  quotaRemaining: number | null;
};

export type ProviderVerdict = {
  providerValidationId: string | null;
  status: "valid" | "pending" | "invalid";
  reason: InvalidReason | null;
  alreadyValidated: boolean;
  /* Raw provider CEP status ("EN PROCESO", "LIQUIDADO", …), for the log */
  cepStatus: string | null;
  telemetry: ProviderTelemetry;
  cep: {
    trackingKey: string | null;
    amountCents: number | null;
    date: string | null;
    senderBank: string | null;
    senderName: string | null;
    receiverBank: string | null;
    beneficiaryName: string | null;
    digitalSignature: string | null;
  } | null;
  /* Provider-hosted CEP documents; their URLs expire (apiCEP: 15 days) */
  downloads: { cepXml?: string; cepPdf?: string } | null;
  /* proof-extraction D11: what the provider's OCR read off the image — a
     READING, never a verdict. Present only on OCR-mode calls (measured
     2026-08-26: it survives failure, complete); null on the transfer
     door, where "extracted" would only echo the caller's own input. */
  reading: {
    trackingKey: string | null;
    amountCents: number | null;
    date: string | null;
    senderBank: string | null;
    referenceNumber: string | null;
  } | null;
};

/* D9 — a failure names itself and says whether waiting can help. Five
   codes replace the one PROVIDER_ERROR that turned a revoked token and a
   duplicate reference into the same six-hour silence (BUG-002). The
   provider is the only party that saw the answer, so retryability is its
   knowledge to state here — never the caller's to infer from an HTTP
   status. */
export type ProviderFailureCode =
  | "PROVIDER_UNAVAILABLE" // 500, network, our own deadline, apiCEP's own transient 401
  | "PROVIDER_RATE_LIMITED" // 429 — retry, but only after `retryAfter`
  | "PROVIDER_AUTH_FAILED" // 401 with a fatal body — an operator must act
  | "REQUEST_REJECTED" // 400, 405, 422 — the request must change
  | "RECEIPT_UNREADABLE"; // 200 + status "error" on the receipt door

export class ProviderFailure extends Error {
  constructor(
    message: string,
    public code: ProviderFailureCode,
    public retryable: boolean,
    public extra: {
      /* ISO 8601, from X-RateLimit-Reset, when it is knowable (429) */
      retryAfter?: string | null;
      /* The fix, when there is exactly one: "provide_tracking_key" on a
         422. Same pattern D11 uses for `not_found` (verify_inputs). */
      hint?: string | null;
      /* Which fields the OCR could not read — the one failure apiCEP
         names out loud, passed through verbatim */
      missingFields?: string[] | null;
      /* Set when a response came back at all: the D15 signal that this
         call was (probably) billed and must land in the log */
      telemetry?: ProviderTelemetry | null;
      /* The envelope-shaped 400 carries a validationId we are billed
         for; it used to be discarded unread (D15, scenario 12) */
      providerValidationId?: string | null;
    } = {},
  ) {
    super(message);
  }
}

export interface ValidationProvider {
  validate(input: TransferInput | ReceiptInput): Promise<ProviderVerdict>;
}
