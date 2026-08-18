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

export type ConstaRequest =
  | {
      transfer: {
        date: string;
        amountCents: number;
        senderBank: string;
        trackingKey: string;
        beneficiary: ConstaBeneficiary;
      };
    }
  | { receiptUrl: string; beneficiary: ConstaBeneficiary };

export type ConstaVerdict = {
  validationId: string;
  status: "valid" | "pending" | "invalid";
  alreadyValidated: boolean;
  /* How well the receipt could be read, 0.0–1.0 (consta D9). Carried so
     the contract is visible here, not yet consumed: acting on it means
     telling the customer "no pudimos leer tu captura" instead of "no
     pudimos verificar tu transferencia", which is a direct-payment copy
     decision and needs a threshold nobody can pick until a real failed
     OCR has been scored. */
  confidence?: number | null;
  cep?: {
    trackingKey: string;
    amountCents: number;
    date: string;
    senderBank: string;
    senderName: string;
    receiverBank: string;
    beneficiaryName: string;
  };
};

export class Consta {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

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
