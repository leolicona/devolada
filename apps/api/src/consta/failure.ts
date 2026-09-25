/* The engine's failure (consta-api-merge D6, D17). The class keeps the
   name the HTTP client gave it so the three callers' `instanceof` keeps
   compiling; what changed is the vocabulary — the transport's three codes
   (CONSTA_UNAVAILABLE, CONSTA_AUTH_FAILED, CONSTA_NOT_CONFIGURED)
   described a hop that no longer exists, and the row now carries the
   engine's own code instead (research R5).

   `retryable` is carried and NOT yet acted on: every caller still does
   `retryLater(code)`, so every failure rides the schedule exactly as it
   did through the hop (FR-011). Honouring `false` — stopping early when
   the request must change — is a product decision of its own; it will
   cost one `if` when it is taken. Lives in its own file only so
   `validate.ts` and `extract.ts` can throw it without importing the
   facade that imports them. */

export type ConstaErrorCode =
  /* The credential is absent in this environment (constitution VIII) */
  | "PROVIDER_NOT_CONFIGURED"
  /* validation spec D9: the provider's own taxonomy, passed through */
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_AUTH_FAILED"
  | "REQUEST_REJECTED"
  | "RECEIPT_UNREADABLE"
  /* proof-extraction D4: the reading did not survive the gate. No door
     threw it between two-eyes-receipt D3 and receipt-triage: a hole in
     our reading rides to the provider, whose own reading may fill it
     (FR-005). **Thrown again for one case** (receipt-triage D4, D15): a
     clear capture — a `completa` picture or a PDF's text — that shows
     neither a clave nor a reference, a generic reference counting as
     none. Before the provider call, nothing billed; `missingFields`
     carries the ask's fields. Every other hole still goes through. */
  | "RECEIPT_INCOMPLETE"
  /* receipt-triage D15, D24: a clear capture whose destination fits none
     of the ISP's registered accounts, current or retired. Stopped before
     the provider call; nothing billed. */
  | "RECEIPT_WRONG_DESTINATION"
  | "READER_UNAVAILABLE"
  | "READER_UNREADABLE"
  /* consta-api-merge D7: the bytes, from the product's own bucket */
  | "PROOF_NOT_FOUND"
  | "PROOF_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE";

export type ConstaErrorExtra = {
  /* ISO 8601, from X-RateLimit-Reset, when it is knowable (429) */
  retryAfter?: string | null;
  /* The fix, when there is exactly one: "provide_tracking_key" on a 422 */
  hint?: string | null;
  /* Which fields the provider's OCR could not read, verbatim */
  missingFields?: string[] | null;
  /* The request guard's refusals (D12/D13/D17), by field */
  issues?: { path: string; message: string }[];
  /* What the reader saw, on a RECEIPT_UNREADABLE / RECEIPT_INCOMPLETE
     the engine's own gate produced (proof-extraction D6): the payload a
     human can be shown instead of a spinner */
  reading?: Record<string, unknown>;
};

export class ConstaError extends Error {
  readonly retryAfter: string | null;
  readonly hint: string | null;
  readonly missingFields: string[] | null;
  readonly issues: { path: string; message: string }[] | null;
  readonly reading: Record<string, unknown> | null;

  constructor(
    public readonly code: ConstaErrorCode,
    public readonly retryable: boolean,
    detail?: string,
    extra: ConstaErrorExtra = {},
  ) {
    super(detail ?? code);
    this.retryAfter = extra.retryAfter ?? null;
    this.hint = extra.hint ?? null;
    this.missingFields = extra.missingFields ?? null;
    this.issues = extra.issues ?? null;
    this.reading = extra.reading ?? null;
  }
}
