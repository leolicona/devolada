import type { LoadedProof } from "./proof";
import { readProof, ReaderError, type Reading } from "./reader";
import { pdfToText } from "./pdf-text";
import { gateReading, type GatedReading } from "./gate";

export { ProofFetchError, MAX_PROOF_BYTES, loadProof, readProofFromBucket } from "./proof";
export type { LoadedProof } from "./proof";
export { ReaderError } from "./reader";
export { gateReading, resolveBank } from "./gate";
export { checkShape, loadShapeRules, resetShapeRules, suggestBank } from "./shape";
export type { Reading } from "./reader";
export type { Gate, GatedReading } from "./gate";
export type { ShapeRule, ShapeVerdict } from "./shape";
export { DEFAULT_MODEL } from "./reader";
export { pdfToText } from "./pdf-text";

/* D2 — routing is by what the file *is*, never by whether something failed.

     image/*          → the vision prompt
     application/pdf  → text at the edge, then the text prompt (two-eyes-receipt D1)

   "Try OCR, fall back to AI" has no detectable trigger: apiCEP answers an
   unreadable image with the same faceless `invalid` a nonexistent transfer
   and an unpublished CEP get, so falling back on it means calling twice
   always. Routing by what the file is stays; what changed with
   two-eyes-receipt D1 is that *both* kinds are read here now. A PDF used
   to be handed to the provider unread, because vision models take images
   and several Mexican banks issue the comprobante as a PDF; the same
   binding's `toMarkdown` turns it into text, and the same model reads
   the text. So a PDF gets the draft, the gate and the protections a
   photograph gets.

   Nothing here throws for a hole (FR-005). A file nothing could read —
   no binding, a PDF with no text in it, an answer that would not parse —
   comes back as `provider-ocr` with the reason, and the caller sends it
   to the provider anyway with an empty reading on our side (D15). */

export type ExtractionResult =
  /* Nothing here read the file. `reason` is what the reading record
     stores, so "handed over unread" is countable by cause (D19):
     `no-binding` — no AI binding at all (constitution VIII);
     `no-text`    — a PDF the conversion yielded nothing for (a scan);
     `unreadable` — the model answered something with no JSON in it. */
  | { route: "provider-ocr"; proof: LoadedProof; reason: "no-binding" | "no-text" | "unreadable" }
  /* The file was read here — a picture, or a PDF through its text */
  | { route: "reader"; proof: LoadedProof; reading: Reading; gated: GatedReading };

/* consta-api-merge D7: the proof arrives already loaded from the
   product's own bucket — the fetch left with the URL door. Routing by
   magic bytes is unchanged. */
export async function extractProof(
  env: { AI?: Ai; EXTRACTION_MODEL?: string },
  proof: LoadedProof,
): Promise<ExtractionResult> {
  if (proof.kind === "pdf") {
    /* two-eyes-receipt D1: text at the edge, then the same model. No
       binding, no text in the file, or a conversion that threw — all
       three are "no text", and none of them is an error the payer hears
       about (D15). The file goes to the provider unread instead. */
    const text = await pdfToText(env, proof);
    if (!text) return { route: "provider-ocr", proof, reason: env.AI ? "no-text" : "no-binding" };
    const reading = await readProof(env, proof, { text });
    return { route: "reader", proof, reading, gated: gateReading(reading) };
  }

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
