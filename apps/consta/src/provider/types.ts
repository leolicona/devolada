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

export type ProviderVerdict = {
  providerValidationId: string | null;
  status: "valid" | "pending" | "invalid";
  reason: InvalidReason | null;
  alreadyValidated: boolean;
  /* Raw provider CEP status ("EN PROCESO", "LIQUIDADO", …), for the log */
  cepStatus: string | null;
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
};

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export interface ValidationProvider {
  validate(input: TransferInput | ReceiptInput): Promise<ProviderVerdict>;
}
