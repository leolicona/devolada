import { BANKS } from "../provider/banks";
import type { FetchedProof } from "./fetch";

/* D5 — the reader. `@cf/mistralai/mistral-small-3.1-24b-instruct` on
   Workers AI, measured 2026-08-19 at 30/30 claves against what Banxico
   returned, ~2.7 s, including 10/10 on the receipt apiCEP had failed
   twice. llama-3.2-11b-vision scored 0/10 on that same file with an
   identical 27-character misread every time, and moondream returned
   `{}`. The model is read from config so replacing it is a deploy.

   The measured output is fenced JSON — ```json … ``` — every time. */

export type Reading = {
  isReceipt: boolean;
  trackingKey: string | null;
  senderBank: string | null;
  /* Reported, never authoritative (D3). Kept because a caller showing a
     confirmation screen has nothing else to show, and because `status`
     is what tells a payer their capture was taken too early. */
  amount: number | null;
  date: string | null;
  status: string | null;
  raw: string;
  model: string;
};

export class ReaderError extends Error {
  constructor(
    public code: "READER_UNAVAILABLE" | "READER_UNREADABLE",
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

export const DEFAULT_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

/* The vocabulary goes into the prompt rather than into a table of aliases
   we maintain: a receipt says "Nu", "BBVA" or "Banco Azteca", and mapping
   those to apiCEP's spellings is the one job a language model is better
   at than a regex. What it returns is still checked against the list
   (D4) — the prompt asks, the gate enforces. */
const PROMPT = `This is an image of a Mexican bank transfer receipt (comprobante SPEI).

Read it and reply with ONLY a JSON object and no prose:
{"esComprobante": <true if this image really is a bank transfer receipt, false otherwise>,
 "claveDeRastreo": "<the value of the 'Clave de rastreo' field, or null if it is absent>",
 "banco": "<the bank the money was sent FROM, or null>",
 "monto": <the amount in pesos as a number, or null>,
 "fecha": "<the operation date as YYYY-MM-DD, or null>",
 "estatus": "<the value of the 'Estatus' field, or null>"}

Rules:
- "claveDeRastreo" is between 6 and 30 characters of uppercase letters and digits.
  Different banks use different lengths. It may be printed across two lines —
  join it with no space and no line break. Copy it exactly; do not guess a
  missing character and do not pad it to a length you expect.
- If the receipt does not show a clave de rastreo at all, return null. A receipt
  captured while the transfer is still "En proceso" often has none.
- "banco" must be one of these exact names, or null if none of them fits:
${BANKS.join(", ")}
- If this image is not a bank transfer receipt, set "esComprobante" to false and
  every other field to null.`;

function base64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000; // spreading the whole array blows the argument limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/* Measured: the model wraps its JSON in a ```json fence every time. Take
   the first {…} block rather than trusting the fence to be well formed. */
export function parseReaderOutput(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ReaderError("READER_UNREADABLE", "no JSON object in the model output");
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    throw new ReaderError("READER_UNREADABLE", `unparseable model output: ${String(e)}`);
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function readProof(
  env: { AI?: Ai; EXTRACTION_MODEL?: string },
  proof: FetchedProof,
): Promise<Reading> {
  if (!env.AI) throw new ReaderError("READER_UNAVAILABLE", "no AI binding");
  const model = env.EXTRACTION_MODEL ?? DEFAULT_MODEL;

  let out: unknown;
  try {
    out = await (env.AI as unknown as { run(m: string, i: unknown): Promise<unknown> }).run(model, {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${proof.mediaType};base64,${base64(proof.bytes)}` },
            },
          ],
        },
      ],
      max_tokens: 400,
    });
  } catch (e) {
    throw new ReaderError("READER_UNAVAILABLE", String(e));
  }

  const text = (out as { response?: unknown })?.response;
  const raw = typeof text === "string" ? text : JSON.stringify(out);
  const parsed = parseReaderOutput(raw);

  return {
    isReceipt: parsed.esComprobante !== false,
    trackingKey: str(parsed.claveDeRastreo),
    senderBank: str(parsed.banco),
    amount: num(parsed.monto),
    date: str(parsed.fecha),
    status: str(parsed.estatus),
    raw,
    model,
  };
}
