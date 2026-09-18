import type { LoadedProof } from "./proof";

/* two-eyes-receipt D1/D15 — a PDF becomes text, and then a reading.

   Several Mexican banks hand the comprobante out as a PDF, and a vision
   model takes images, so until this feature a PDF was handed to the
   provider unread: no draft on the payer's page, no gate, no second pair
   of eyes. The model binding the reader already uses carries its own
   document conversion, so the PDF becomes text here and the same model
   reads the text (`reader.ts`'s TEXT_PROMPT). A PDF now gets the same
   draft, the same pre-spend refusals and the same comparison a
   photograph gets.

   **Never throws.** Every failure is the same answer — no text — and D15
   makes that a silent fall-through: the file goes to the provider unread
   with an empty reading on our side, and the payer is told nothing,
   because there is nothing they could do about it. A scanned PDF is the
   ordinary case of that, not an error.

   Two facts about the binding are still open (research R6, quickstart
   step 3), and both are cost-or-coverage facts rather than flow facts:

   - **Cost.** The Workers AI changelog's own PDF example reports
     `tokens: 0`, and the image path is described as running an
     object-detection model and then a vision model while the PDF path is
     not described as running any — so document conversion is very likely
     free while image conversion bills. Read from the docs index on
     2026-09-18; the pricing page itself was not reachable from that
     environment, and no `toMarkdown` call has been made against the real
     binding yet. **Not measured — do not quote this as a measurement.**
   - **Scanned pages.** Whether an image-only PDF page is OCR'd is
     unresolved. The design does not wait on the answer: no text is no
     text, and the fall-through above is the same either way.

   Both are settled by one run of quickstart step 3 on a machine with a
   Cloudflare login; write the answers here, with the date, when they
   are. */

/* The binding's own shape (`@cloudflare/workers-types`): one result per
   file, `format: "markdown"` with the text, or `format: "error"`. Typed
   structurally rather than imported so an older runtime whose binding
   has no `toMarkdown` at all still compiles and simply returns null. */
type Conversion = { format?: string; data?: string };
type WithToMarkdown = {
  toMarkdown(files: { name: string; blob: Blob }): Promise<Conversion | Conversion[]>;
};

export async function pdfToText(
  env: { AI?: Ai },
  proof: LoadedProof,
): Promise<string | null> {
  const ai = env.AI as unknown as Partial<WithToMarkdown> | undefined;
  if (!ai || typeof ai.toMarkdown !== "function") return null;

  try {
    const out = await ai.toMarkdown({
      name: "receipt.pdf",
      blob: new Blob([proof.bytes], { type: "application/pdf" }),
    });
    const one = Array.isArray(out) ? out[0] : out;
    if (!one || one.format !== "markdown") return null;
    const text = typeof one.data === "string" ? one.data.trim() : "";
    /* An empty conversion is the scanned-PDF case, and it is not an
       error: the file simply has no text in it (D15). */
    return text.length > 0 ? text : null;
  } catch {
    /* A thrown call is one more way to have no text. The receipt still
       has a provider to go to, and the payer still has a page that never
       blocks (constitution VIII). */
    return null;
  }
}
