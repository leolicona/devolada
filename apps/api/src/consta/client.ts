/* Consta adapter (direct-payment spec). All Consta traffic goes through
   this file, like the WispHub adapter. Contract in
   docs/consta/validation.spec.md — same envelope as this API. Consta
   reports `alreadyValidated` without blocking (its D4): the replay
   policy is ours (direct-payment D8), applied by the caller. */

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
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
    } catch (e) {
      throw new ConstaError("CONSTA_UNAVAILABLE", `network error: ${String(e)}`);
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
