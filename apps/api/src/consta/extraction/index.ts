import type { LoadedProof } from "./proof";
import { readProof, ReaderError, type Reading } from "./reader";
import type { ReaderModel, ReaderPlan } from "./models";
import { pdfToText } from "./pdf-text";
import { gateReading, type GatedReading } from "./gate";

export { ProofFetchError, MAX_PROOF_BYTES, loadProof, readProofFromBucket, sha256Hex } from "./proof";
export type { LoadedProof } from "./proof";
export { ReaderError } from "./reader";
export { gateReading, gateReference, gateTrackingKey, passesGate, receivingOf, resolveBank } from "./gate";
export { checkShape, loadShapeRules, resetShapeRules, suggestBank } from "./shape";
export type { Reading } from "./reader";
export type { Gate, GatedReading, ReceivingBank } from "./gate";
export type { ShapeRule, ShapeVerdict } from "./shape";
export { DEFAULT_MODEL, QUESTIONS_VERSION } from "./reader";
export { readerModels, readerChoice, readerPlan, READER_MODEL_KEY } from "./models";
export type { ReaderModel, ReaderPlan, ReaderChoice } from "./models";
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
  | {
      route: "provider-ocr";
      proof: LoadedProof;
      reason: "no-binding" | "no-text" | "unreadable";
      /* receipt-reader-tuning D11: the chosen model that failed before the
         default failed too — the row records it */
      fallbackFrom?: string | null;
    }
  /* The file was read here — a picture, or a PDF through its text */
  | { route: "reader"; proof: LoadedProof; reading: Reading; gated: GatedReading };

/* The chosen model's time limit when a fallback stands behind it —
   research R6: the default answers in ~2.7 s, so 8 s is a failing model */
const CHOSEN_TIMEOUT_MS = 8000;

/* consta-api-merge D7: the proof arrives already loaded from the
   product's own bucket — the fetch left with the URL door. Routing by
   magic bytes is unchanged.

   receipt-reader-tuning D9, D11: the model comes from the caller's plan.
   A chosen model that is not the default is read under a time limit, and
   on a `ReaderError` — unavailable, too slow, or an answer with no JSON —
   the default reads once, with no limit and the same picture or text.
   A *wrong* answer is not a failure (spec D3): only an answer we cannot
   use falls back. A PDF is converted once, whoever reads it. */
export async function extractProof(
  env: { AI?: Ai; READER_TIMEOUT_MS?: string },
  proof: LoadedProof,
  plan: ReaderPlan,
): Promise<ExtractionResult> {
  let text: string | undefined;
  if (proof.kind === "pdf") {
    /* two-eyes-receipt D1: text at the edge, then the same model. No
       binding, no text in the file, or a conversion that threw — all
       three are "no text", and none of them is an error the payer hears
       about (D15). The file goes to the provider unread instead. */
    text = (await pdfToText(env, proof)) || undefined;
    if (!text) return { route: "provider-ocr", proof, reason: env.AI ? "no-text" : "no-binding" };
  }

  const read = (model: ReaderModel, timeoutMs?: number) => readProof(env.AI, proof, model, { text, timeoutMs });
  let reading: Reading;
  try {
    reading = await read(
      plan.chosen,
      plan.fallback ? Number(env.READER_TIMEOUT_MS ?? CHOSEN_TIMEOUT_MS) : undefined,
    );
  } catch (err) {
    if (!(err instanceof ReaderError) || !plan.fallback || !env.AI) throw err;
    console.error(`reader ${plan.chosen.id} failed (${err.message}); the default reads instead`);
    try {
      reading = { ...(await read(plan.fallback)), fallbackFrom: plan.chosen.id };
    } catch (second) {
      if (second instanceof ReaderError) second.fallbackFrom = plan.chosen.id;
      throw second;
    }
  }
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

/* receipt-triage D15, D24: the two pure rules the reading now answers */
export { askBeforeCredit, isClearReading, type Ask, type AskField } from "./ask";
export {
  accountKind,
  accountValue,
  asBeneficiary,
  sameAccount,
  tieCepAccount,
  receivingBankTie,
  tieDestination,
  visibleTail,
  type AccountKind,
  type TieResult,
} from "./destination";
