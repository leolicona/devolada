import { fetchProof, ProofFetchError, type FetchedProof } from "./fetch";
import { readProof, ReaderError, type Reading } from "./reader";
import { gateReading, type GatedReading } from "./gate";

export { ProofFetchError, MAX_PROOF_BYTES } from "./fetch";
export { ReaderError } from "./reader";
export { gateReading, resolveBank } from "./gate";
export type { Reading } from "./reader";
export type { Gate, GatedReading } from "./gate";
export { DEFAULT_MODEL } from "./reader";

/* D2 — routing is by what the file *is*, never by whether something failed.

     image/*          → read here → apiCEP direct mode
     application/pdf  → apiCEP OCR mode, unchanged

   "Try OCR, fall back to AI" has no detectable trigger: apiCEP answers an
   unreadable image with the same faceless `invalid` a nonexistent transfer
   and an unpublished CEP get, so falling back on it means calling twice
   always. PDFs keep the provider's OCR alive for a concrete reason —
   several Mexican banks issue the comprobante as a PDF, and vision models
   take images. */

export type ExtractionResult =
  /* The file is a PDF: nothing was read here, the URL goes to the provider */
  | { route: "provider-ocr"; proof: FetchedProof }
  /* The file is an image and was read here */
  | { route: "reader"; proof: FetchedProof; reading: Reading; gated: GatedReading };

export async function extractProof(
  env: { AI?: Ai; EXTRACTION_MODEL?: string },
  receiptUrl: string,
): Promise<ExtractionResult> {
  const proof = await fetchProof(receiptUrl);
  if (proof.kind === "pdf") return { route: "provider-ocr", proof };

  const reading = await readProof(env, proof);
  return { route: "reader", proof, reading, gated: gateReading(reading) };
}

/* An image the model says is not a receipt at all. Measured 2026-08-19:
   the model answered `esComprobante: false` on a dark UI screenshot five
   times out of five — and that same screenshot, sent to apiCEP, makes it
   answer `status: "error"`, which is retryable, so the payment rides
   Devolada's whole six-hour schedule at up to seven paid calls. This is
   the case the gate exists for. */
export function isNotAReceipt(result: ExtractionResult): boolean {
  return result.route === "reader" && !result.reading.isReceipt;
}
