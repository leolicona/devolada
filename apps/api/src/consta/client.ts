/* Consta adapter (direct-payment spec). All Consta traffic goes through
   this file, like the WispHub adapter. Contract in
   docs/consta/validation.spec.md — same envelope as this API. Consta
   reports `alreadyValidated` without blocking (its D4): the replay
   policy is ours (direct-payment D8), applied by the caller. */

/* A deadline, for the same reason every WispHub call has one
   (provider-latency spec D1) — this was the last provider call in the
   API without one, and the 2026-08-18 spike is what found it: a stalled
   validation held the request open for over five minutes.

   The number cannot follow WispHub's "ten times the healthy call",
   because a healthy validation here is genuinely slow: OCR plus a
   Banxico lookup measured 13.5–14.6 s. This is ~2× that worst case.
   Cutting off early is cheap: a deadline is a retryable failure, so the
   payment stays `validating` and rides the D7 schedule instead of
   failing. What it must never be is unbounded. */
export const CONSTA_TIMEOUT_MS = 30_000;

export class ConstaError extends Error {
  constructor(
    public code: "CONSTA_UNAVAILABLE" | "CONSTA_AUTH_FAILED",
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

export type ConstaBeneficiary = {
  bank: string;
  clabe: string;
  name?: string;
};

export type ConstaRequest = (
  | {
      transfer: {
        date: string;
        amountCents: number;
        senderBank: string;
        trackingKey: string;
        beneficiary: ConstaBeneficiary;
      };
    }
  | {
      receiptUrl: string;
      beneficiary: ConstaBeneficiary;
      /* proof-extraction D11: skip Consta's reader — the provider's OCR
         reads the image itself. The reading-check cross (US-D14) sets
         this: the same model checking itself is no second opinion. */
      providerOcr?: true;
    }
) & {
  /* provisional-release D4 / trust-layer D1: opaque history refs, sent
     on every call from day one, toggle state irrespective — history only
     accumulates forward. `customerRef` is an HMAC of the WispHub usuario
     (the id is recognisable, so it never travels naked); `paymentRef` is
     the direct_payments id, chaining the attempts of one payment. */
  customerRef?: string;
  paymentRef?: string;
};

export type ConstaVerdict = {
  validationId: string;
  status: "valid" | "pending" | "invalid";
  /* Consta D11: which kind of `invalid`. Optional on the wire, and a
     missing value is read as the ambiguous one — an older Consta must
     not be able to turn an unverifiable payment back into a refusal. */
  reason?: "contradicted" | "not_found";
  alreadyValidated: boolean;
  cep?: {
    trackingKey: string;
    amountCents: number;
    date: string;
    senderBank: string;
    senderName: string;
    receiverBank: string;
    beneficiaryName: string;
  };
  /* proof-extraction D11: what the provider's OCR read off the image —
     a reading, never a verdict. Present on provider-OCR calls only, and
     it survives failure (measured 2026-08-26), which is exactly when the
     reading-check comparison needs it. */
  reading?: {
    trackingKey: string | null;
    amountCents: number | null;
    date: string | null;
    senderBank: string | null;
    referenceNumber: string | null;
  } | null;
  /* trust-layer US-V15: the payer's measured history, on pending and
     not_found verdicts when refs traveled. A measurement, never a
     verdict — v1 stores it as the graduation shadow (provisional-release
     D12) and decides nothing with it. Kept loosely typed on purpose:
     the snapshot is stored as received, and the day K exists the rule
     will read the fields it needs. */
  trust?: {
    customerRef: string;
    sample: { chains: number; effectiveN: number; halfLifeDays: number };
    eventualValidRate: number | null;
    raw: Record<string, number>;
    lastIncidentAt: string | null;
    medianMinutesToValid: number | null;
    tenantBaseline: { eventualValidRate: number | null; chains: number; effectiveN: number };
  };
};

/* proof-extraction D6: the reading, before a credit is spent. This is
   the half of Consta that exists so a human can look at what a machine
   read and say "that clave is wrong" in three seconds, instead of
   watching a spinner for six hours because nothing downstream can tell a
   misread from a transfer that never happened. */
export type ConstaGate = {
  trackingKey: "ok" | "malformed" | "missing";
  senderBank: "ok" | "unknown" | "missing";
  amount: "ok" | "malformed" | "missing";
};

export type ConstaReading = {
  extractionId: string;
  source: "reader" | "provider-ocr";
  isReceipt: boolean | null;
  trackingKey: string | null;
  senderBank: string | null;
  amountCents: number | null;
  date: string | null;
  receiptStatus: string | null;
  gate: ConstaGate;
};

export class Consta {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async extract(receiptUrl: string): Promise<ConstaReading> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/extract`, {
        method: "POST",
        signal: AbortSignal.timeout(CONSTA_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ receiptUrl }),
      });
    } catch (e) {
      throw new ConstaError("CONSTA_UNAVAILABLE", `extract: ${String(e)}`);
    }
    if (res.status === 401) throw new ConstaError("CONSTA_AUTH_FAILED", "status 401");
    const body = (await res.json().catch(() => null)) as
      | { success: true; data: ConstaReading }
      | { success: false; error: { code: string } }
      | null;
    if (!res.ok || !body?.success) {
      throw new ConstaError("CONSTA_UNAVAILABLE", body && !body.success ? body.error.code : `status ${res.status}`);
    }
    return body.data;
  }

  async validate(request: ConstaRequest): Promise<ConstaVerdict> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/validate`, {
        method: "POST",
        signal: AbortSignal.timeout(CONSTA_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
    } catch (e) {
      /* Timeout and network failure are the same thing to the caller:
         retryable, so the payment rides D7 (provider-latency D6). */
      const name = (e as { name?: string })?.name;
      const detail =
        name === "TimeoutError" || name === "AbortError"
          ? `timed out after ${CONSTA_TIMEOUT_MS}ms`
          : `network error: ${String(e)}`;
      throw new ConstaError("CONSTA_UNAVAILABLE", detail);
    }
    /* A rejected key is our setup problem, not a verdict */
    if (res.status === 401) {
      throw new ConstaError("CONSTA_AUTH_FAILED", "status 401");
    }
    if (!res.ok) {
      /* Includes 502 PROVIDER_ERROR: nothing was validated — retryable */
      throw new ConstaError("CONSTA_UNAVAILABLE", `status ${res.status}`);
    }
    const body = (await res.json()) as
      | { success: true; data: ConstaVerdict }
      | { success: false; error: { code: string } };
    if (!body.success) {
      throw new ConstaError("CONSTA_UNAVAILABLE", body.error.code);
    }
    return body.data;
  }
}
