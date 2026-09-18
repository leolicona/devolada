import { BANKS } from "../../direct-payments/banks";
import type { LoadedProof } from "./proof";

/* D5 — the reader. `@cf/mistralai/mistral-small-3.1-24b-instruct` on
   Workers AI, measured 2026-08-19 at 30/30 claves against what Banxico
   returned, ~2.7 s, including 10/10 on the receipt apiCEP had failed
   twice. llama-3.2-11b-vision scored 0/10 on that same file with an
   identical 27-character misread every time, and moondream returned
   `{}`. The model is read from config so replacing it is a deploy.

   The measured output is fenced JSON — ```json … ``` — every time.

   two-eyes-receipt D2: the prompt asks one more question, legibility,
   and the answer is one of the two things that refuse a file before a
   provider credit is spent. The bias is deliberate and it is the spec's
   own (Assumptions): a wrongly blocked photo costs the payer a step, a
   wrongly passed one costs a credit that the comparison with the
   provider's reading may still salvage. So `nula` is defined as narrowly
   as the prompt can say it — *no* field readable at all — and everything
   else goes through, hole and all.

   D1: the same model reads a PDF, through the text its conversion
   produces (`pdf-text.ts`). A text reading is asked the same questions
   minus legibility: there is no photograph to judge (D15). */

export type Reading = {
  isReceipt: boolean;
  /* two-eyes-receipt D2 (R7): how much of the picture the model could
     read. `none` is the one value that refuses before a credit is spent,
     beside `isReceipt: false`; `partial` goes to the provider with its
     hole (FR-005). Null when the model omitted the field, and on a text
     reading of a PDF, where there is no photograph to judge (D15) —
     both read as `full`, because the bias is to let files through. */
  legibility: "full" | "partial" | "none" | null;
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
/* The fields both prompts ask for, so the two can never drift apart */
const FIELDS = `{"esComprobante": <true if this really is a bank transfer receipt, false otherwise>,
 "claveDeRastreo": "<the value of the 'Clave de rastreo' field, or null if it is absent>",
 "banco": "<the bank the money was sent FROM, or null>",
 "monto": <the amount in pesos as a number, or null>,
 "fecha": "<the operation date as YYYY-MM-DD, or null>",
 "estatus": "<the value of the 'Estatus' field, or null>"}`;

const RULES = `- "claveDeRastreo" is between 6 and 30 characters of uppercase letters and digits.
  Different banks use different lengths. It may be printed across two lines —
  join it with no space and no line break. Copy it exactly; do not guess a
  missing character and do not pad it to a length you expect.
- If the receipt does not show a clave de rastreo at all, return null. A receipt
  captured while the transfer is still "En proceso" often has none.
- "banco" must be one of these exact names, or null if none of them fits:
${BANKS.join(", ")}
- If this is not a bank transfer receipt, set "esComprobante" to false and
  every other field to null.`;

const PROMPT = `This is an image of a Mexican bank transfer receipt (comprobante SPEI).

Read it and reply with ONLY a JSON object and no prose:
${FIELDS.slice(0, -1)},
 "legibilidad": "<completa | parcial | nula>"}

Rules:
${RULES}
- "legibilidad" describes how well you could READ THE IMAGE, not how complete
  the receipt is:
  - "nula" ONLY when the image is so blurred, dark, cropped or obscured that you
    cannot read a single one of the fields above. If you could read even one of
    them, it is not "nula".
  - "parcial" when the receipt is readable but at least one of the fields above
    is blurred, cut off or hidden behind something.
  - "completa" otherwise — including when a field is simply not printed on this
    receipt. A field the bank did not print is not a legibility problem.`;

/* D1/D15 — the text variant. Same JSON, same rules, no legibility: text
   either exists or it does not, and a conversion that yielded text has
   nothing blurry about it. A PDF whose conversion yields nothing never
   reaches this prompt at all — it goes to the provider unread (D15). */
const TEXT_PROMPT = `This is the text extracted from a Mexican bank transfer receipt PDF (comprobante SPEI).

Read it and reply with ONLY a JSON object and no prose:
${FIELDS}

Rules:
${RULES}`;

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

/* The prompt asks in Spanish, like every other field, and the type is
   English like every other identifier. Anything the model invents that is
   not one of the three words is null — "unreadable" is far too costly a
   reading to infer from a word we did not ask for (two-eyes-receipt D2). */
const LEGIBILITY = { completa: "full", parcial: "partial", nula: "none" } as const;
export function legibilityOf(v: unknown): Reading["legibility"] {
  const word = typeof v === "string" ? v.trim().toLowerCase() : null;
  return word && word in LEGIBILITY ? LEGIBILITY[word as keyof typeof LEGIBILITY] : null;
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/* `text` reads a PDF's converted text instead of a picture (D1). Both
   go to the same model with the same JSON shape, so nothing downstream
   has to know which one it got — except that a text reading never
   carries a legibility (D15). */
export async function readProof(
  env: { AI?: Ai; EXTRACTION_MODEL?: string },
  proof: LoadedProof,
  opts: { text?: string } = {},
): Promise<Reading> {
  if (!env.AI) throw new ReaderError("READER_UNAVAILABLE", "no AI binding");
  const model = env.EXTRACTION_MODEL ?? DEFAULT_MODEL;

  const content = opts.text
    ? [{ type: "text", text: `${TEXT_PROMPT}\n\n---\n${opts.text}` }]
    : [
        { type: "text", text: PROMPT },
        {
          type: "image_url",
          image_url: { url: `data:${proof.mediaType};base64,${base64(proof.bytes)}` },
        },
      ];

  let out: unknown;
  try {
    out = await (env.AI as unknown as { run(m: string, i: unknown): Promise<unknown> }).run(model, {
      messages: [{ role: "user", content }],
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
    /* D15: a text reading has no photograph to judge, so it is null
       here whatever the model volunteers — and null reads as `full`. */
    legibility: opts.text ? null : legibilityOf(parsed.legibilidad),
    trackingKey: str(parsed.claveDeRastreo),
    senderBank: str(parsed.banco),
    amount: num(parsed.monto),
    date: str(parsed.fecha),
    status: str(parsed.estatus),
    raw,
    model,
  };
}
