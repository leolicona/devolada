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

export type ProviderVerdict = {
  providerValidationId: string | null;
  status: "valid" | "pending" | "invalid";
  alreadyValidated: boolean;
  /* Raw provider CEP status ("EN PROCESO", "LIQUIDADO", …), for the log */
  cepStatus: string | null;
  /* How well the receipt could be read, 0.0–1.0 (D9). Null when the
     provider does not say. `1` in transfer mode, where there is no image
     to read — a score describes an image. */
  confidence: number | null;
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
