import {
  ProviderError,
  type ProviderVerdict,
  type ReceiptInput,
  type TransferInput,
  type ValidationProvider,
} from "./types";

/* apiCEP adapter (docs read 2026-08-17 at apicep.cloud/documentacion).
   One endpoint, POST /validate-transfer, Bearer auth. Our transfer door is
   their Direct Mode; our receipt door is their OCR modes. */

const DEFAULT_BASE_URL = "https://api.apicep.cloud";

type ApiCepResponse = {
  validationId?: string;
  status?: string;
  error?: string;
  validation?: {
    cepStatus?: string;
    cepPreviouslyValidated?: boolean | null;
    cepDetails?: {
      trackingKey?: string;
      amount?: number;
      operationDate?: string;
      senderBank?: string;
      senderName?: string;
      receiverBank?: string;
      beneficiaryName?: string;
      digitalSignature?: string;
    };
  };
  downloads?: { cepXml?: string; cepPdf?: string };
};

function requestBody(input: TransferInput | ReceiptInput): Record<string, unknown> {
  if (input.mode === "transfer") {
    return {
      system: "SPEI",
      beneficiary: input.beneficiary,
      sender: {
        date: input.date,
        /* Cents at our edge, decimal pesos at theirs (spec D7) */
        amount: input.amountCents / 100,
        bank: input.senderBank,
        trackingKey: input.trackingKey ?? null,
        referenceNumber: input.referenceNumber ?? null,
      },
    };
  }
  return {
    system: "SPEI",
    imageUrl: input.receiptUrl,
    ...(input.beneficiary ? { beneficiary: input.beneficiary } : {}),
    ...(input.potentialBeneficiaries ? { potentialBeneficiaries: input.potentialBeneficiaries } : {}),
  };
}

/* The trap measured in the spike (spec D3): a CEP can take hours to exist.
   Both their explicit "pending" and an "invalid" whose cepStatus is still
   EN PROCESO mean "ask again later", never "the transfer is fake". */
function mapStatus(body: ApiCepResponse): "valid" | "pending" | "invalid" {
  const cepStatus = body.validation?.cepStatus;
  if (body.status === "valid") return "valid";
  if (body.status === "pending" || cepStatus === "EN PROCESO") return "pending";
  return "invalid";
}

export function apiCepProvider(env: { APICEP_TOKEN?: string; APICEP_BASE_URL?: string }): ValidationProvider {
  return {
    async validate(input) {
      if (!env.APICEP_TOKEN) throw new ProviderError("APICEP_TOKEN is not configured");
      const res = await fetch(`${env.APICEP_BASE_URL ?? DEFAULT_BASE_URL}/validate-transfer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.APICEP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody(input)),
      });
      if (!res.ok) throw new ProviderError(`apiCEP responded ${res.status}`, res.status);
      const body = (await res.json()) as ApiCepResponse;
      if (body.status === "error") throw new ProviderError(body.error ?? "apiCEP status: error");

      const details = body.validation?.cepDetails;
      return {
        providerValidationId: body.validationId ?? null,
        status: mapStatus(body),
        alreadyValidated: body.validation?.cepPreviouslyValidated === true,
        cepStatus: body.validation?.cepStatus ?? null,
        cep: details
          ? {
              trackingKey: details.trackingKey ?? null,
              amountCents: details.amount != null ? Math.round(details.amount * 100) : null,
              date: details.operationDate ?? null,
              senderBank: details.senderBank ?? null,
              senderName: details.senderName ?? null,
              receiverBank: details.receiverBank ?? null,
              beneficiaryName: details.beneficiaryName ?? null,
              digitalSignature: details.digitalSignature ?? null,
            }
          : null,
        downloads: body.downloads ?? null,
      } satisfies ProviderVerdict;
    },
  };
}
