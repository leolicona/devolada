import { BANKS } from "../../direct-payments/banks";
import type { LoadedProof } from "./proof";
import type { ReaderModel } from "./models";

/* D5 — the reader. `@cf/mistralai/mistral-small-3.1-24b-instruct` on
   Workers AI, measured 2026-08-19 at 30/30 claves against what Banxico
   returned, ~2.7 s, including 10/10 on the receipt apiCEP had failed
   twice. llama-3.2-11b-vision scored 0/10 on that same file with an
   identical 27-character misread every time, and moondream returned
   `{}`. receipt-reader-tuning D9: the model now arrives per reading,
   from the caller's plan — the operator's choice among the environment's
   list, the default when none was made (`models.ts`). No model is named
   in code except `DEFAULT_MODEL`.

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
   minus legibility: there is no photograph to judge (D15).

   receipt-triage D4/D16: legibility is also what decides whether a
   capture with no key is asked about before a credit — only a `completa`
   picture (or a PDF's text) is certain enough to stop. The rules below
   are unchanged word for word; `parcial` and an omitted answer still go
   to the provider with their hole.

   receipt-triage D12/D24: two more questions ride the same prompt, so no
   extra call — the referencia numérica (as printed, leading zeros kept,
   and told what is *not* one: a folio, an authorisation number, the
   clave, an account) and the destination account's visible digits with
   the kind its label names. Both prompts share `FIELDS`, so a PDF's text
   is asked the same. Nothing else is asked (spec Out of Scope).

   Measured with the new prompt (T016, quickstart Step 0): **not run —
   this implementation environment cannot reach the Workers AI binding**
   (2026-09-25). Receipt 1 and receipt 2 must be read on dev before the
   feature is called done; registered as debt
   (.specify/debt/receipt-triage-reader-unmeasured/).

   receipt-reader-tuning D13 — version "2" of the questions. Three
   failures were measured on dev on 2026-09-24/25 (spec "Where this comes
   from"): Nu's "Folio QVSBGOD7L" read as the clave; an Azteca receipt with
   no sending bank shown read as BBVA MEXICO — the bank beside the
   destination; and Azteca's clave `…368901I` read without its final
   letter. So the clave comes only from the field labelled as the clave,
   a final letter is kept and no letter is swapped for a digit, both banks
   are asked for (`bancoEmisor`, `bancoReceptor`), and each is read only
   from its own side. Everything else is word for word. Whether the new
   questions read better is measured on the bench, never asserted by a
   stub (D20) — the tally goes here with its date (tasks T039). */

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
  /* receipt-reader-tuning D13/D14: the bank the money went TO, as read.
     Resolved through the same vocabulary by the gate; never used to
     change `senderBank` (spec FR-012). */
  receivingBank: string | null;
  /* Reported, never authoritative (D3). Kept because a caller showing a
     confirmation screen has nothing else to show, and because `status`
     is what tells a payer their capture was taken too early. */
  amount: number | null;
  date: string | null;
  /* bug: spei-date-rollover — the time printed beside the date, "HH:MM"
     on a 24-hour clock, or null. SPEI changes its operation day at 18:00
     (Banxico, "Información operativa del SPEI"), and a receipt prints the
     calendar day. Since bug: reference-search-printed-day it no longer
     decides the day a search asks — Banxico answers the printed day only
     (measured 2026-09-26) — but it is kept: it is what pairs a receipt
     with one CEP when several share a reference. Reported like the date,
     never judged by the gate. */
  time: string | null;
  status: string | null;
  /* receipt-triage D12: as printed — text, never a number, so "038195"
     keeps its zero. Judged by the gate, not here. */
  referenceNumber: string | null;
  /* receipt-triage D24: what the receipt shows as the receiving account.
     `digits` has every mask removed ("•••• 8195" → "8195"); the kind
     only orders the search when it is tied, never rules a fit out. */
  destination: { kind: "clabe" | "card" | "phone" | "account" | null; digits: string | null };
  raw: string;
  /* receipt-reader-tuning D11: the model that produced this reading —
     the default, when it read in place of a chosen model that failed */
  model: string;
  /* D12: `QUESTIONS_VERSION` of the questions this reading answered */
  questionVersion: string;
  /* D11: how long the model call took, in ms */
  ms: number;
  /* D11: the chosen model that failed, when the default read instead */
  fallbackFrom: string | null;
};

export class ReaderError extends Error {
  constructor(
    public code: "READER_UNAVAILABLE" | "READER_UNREADABLE",
    detail?: string,
    /* receipt-reader-tuning D11: what the model answered, when it
       answered something with no JSON in it — the bench keeps it */
    public raw?: string,
  ) {
    super(detail ?? code);
  }
  /* receipt-reader-tuning D11: set by `extractProof` when a fallback was
     tried and failed too, so the caller's row still says which chosen
     model failed first */
  fallbackFrom?: string;
}

export const DEFAULT_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

/* receipt-reader-tuning D12 — the name of the questions below, recorded
   on every reading so a tally never mixes two wordings. "1" names the
   receipt-triage questions; "2" this feature's (D13). A test pins
   `sha256(PROMPT + "\n" + TEXT_PROMPT)` to it: changing a word without
   bumping the version fails the suite. */
export const QUESTIONS_VERSION = "2";

/* The vocabulary goes into the prompt rather than into a table of aliases
   we maintain: a receipt says "Nu", "BBVA" or "Banco Azteca", and mapping
   those to apiCEP's spellings is the one job a language model is better
   at than a regex. What it returns is still checked against the list
   (D4) — the prompt asks, the gate enforces. */
/* The fields both prompts ask for, so the two can never drift apart */
const FIELDS = `{"esComprobante": <true if this really is a bank transfer receipt, false otherwise>,
 "claveDeRastreo": "<the value of the field labelled 'Clave de rastreo', or null if no field has that label>",
 "bancoEmisor": "<the bank the money was sent FROM, or null if the receipt does not show it>",
 "bancoReceptor": "<the bank the money was sent TO, or null if the receipt does not show it>",
 "monto": <the amount in pesos as a number, or null>,
 "fecha": "<the operation date as YYYY-MM-DD, or null>",
 "hora": "<the time of the operation as HH:MM on a 24-hour clock, or null>",
 "estatus": "<the value of the 'Estatus' field, or null>",
 "referenciaNumerica": "<the value of the 'Referencia' or 'Referencia numérica' field, digits only, exactly as printed including leading zeros, or null>",
 "destino": {"tipo": "<clabe | tarjeta | celular | cuenta, or null>", "digitos": "<the digits of the destination account you can see, without asterisks or dots, or null>"}}`;

/* receipt-reader-tuning D13: the first three rules answer the three
   measured failures — the folio taken for the clave, the final letter
   dropped, the destination's bank taken for the sender's. */
const RULES = `- "claveDeRastreo" comes ONLY from a field labelled "Clave de rastreo" (also
  printed as "Clave rastreo" or "Rastreo"). A "Folio", a "Número de
  autorización", a "Número de operación", a "Referencia" or "Número de
  referencia", and an account number are NOT the clave de rastreo, even when
  they look like one. If no field carries that label, return null.
- The clave is 6 to 30 uppercase letters and digits. Copy it character by
  character. Some banks end it with a letter — Banco Azteca's end in the
  letter "I" — and that letter is part of it. Never turn a letter into a
  digit or a digit into a letter (I and 1, O and 0, S and 5, B and 8). It
  may be printed across two lines — join it with no space and no line
  break. Do not guess a missing character and do not pad it to a length you
  expect.
- If the receipt does not show a clave de rastreo at all, return null. A receipt
  captured while the transfer is still "En proceso" often has none.
- "bancoEmisor" is the bank of the account the money LEFT. Read it only from
  the sender's side: "Cuenta origen", "Banco emisor", "Ordenante", "Desde",
  or the name or logo of the bank that issued this receipt. The bank printed
  beside the destination account ("Cuenta destino", "Beneficiario", "Para",
  "Banco receptor") is NEVER the bancoEmisor, and neither is the "Concepto".
  If the receipt does not show the sending bank, return null — do not guess.
- "bancoReceptor" is the bank of the account the money went TO. Read it only
  from the destination's side: "Cuenta destino", "Beneficiario", "Para",
  "Banco receptor", "Banco destino". If it is not shown, return null.
- Both banks can be the same institution. Report each one as it is printed;
  never change one because of the other.
- "bancoEmisor" and "bancoReceptor" must each be one of these exact names,
  or null if none of them fits:
${BANKS.join(", ")}
- "referenciaNumerica" is the numeric reference the sender typed, at most 7
  digits. Copy it exactly as printed, keeping any leading zeros. A "Folio", a
  "Número de autorización", the "Clave de rastreo" or an account number is NOT
  a reference — if the receipt shows no field named "Referencia" or
  "Referencia numérica", return null.
- "destino" is the account the money was sent TO (the beneficiary's), never
  the sender's. "tipo" is what its label says it is; "digitos" are only the
  digits you can actually see, often the last three or four.
- "hora" is the time printed beside the date, converted to a 24-hour clock
  ("11:47 p.m." is "23:47"). Return null if the receipt prints no time; never
  guess one.
- If this is not a bank transfer receipt, set "esComprobante" to false and
  every other field to null.`;

export const PROMPT = `This is an image of a Mexican bank transfer receipt (comprobante SPEI).

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
export const TEXT_PROMPT = `This is the text extracted from a Mexican bank transfer receipt PDF (comprobante SPEI).

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
/* receipt-triage D24: the kind in the prompt's Spanish, the type's English.
   Anything else is null — the kind only orders the tie, so a word we did
   not ask for costs nothing. */
const DESTINATION_KIND = { clabe: "clabe", tarjeta: "card", celular: "phone", cuenta: "account" } as const;
export function destinationOf(v: unknown): Reading["destination"] {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const word = typeof o.tipo === "string" ? o.tipo.trim().toLowerCase() : null;
  const kind = word && word in DESTINATION_KIND ? DESTINATION_KIND[word as keyof typeof DESTINATION_KIND] : null;
  const raw = str(typeof o.digitos === "number" ? String(o.digitos) : o.digitos);
  const digits = raw ? raw.replace(/\D/g, "") || null : null;
  return { kind, digits };
}
/* receipt-triage D12: a reference the model returned as a JSON number
   has already lost its leading zeros — it is kept as the text of that
   number, and the gate judges it like any other */
const referenceOf = (v: unknown): string | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? String(v) : str(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/* bug: spei-date-rollover — a time is "HH:MM" on a 24-hour clock or it is
   nothing: a word, a 12-hour clock or an impossible hour is not stored */
export function timeOf(v: unknown): string | null {
  const t = str(v);
  const m = t ? /^(\d{1,2}):(\d{2})$/.exec(t) : null;
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

/* receipt-reader-tuning D10 — the answer's text. `response` is the
   shape measured on Mistral since 2026-08-19. `choices[0].message.content`
   is the OpenAI-style shape some Workers AI models answer in; it is
   **unmeasured** for Gemma 4 through this binding (research R5), never
   stubbed, and registered as debt until the bench captures a real
   answer (.specify/debt/reader-answer-shape-unmeasured/). Anything else
   is serialized whole, so the parser can still find a JSON object in it
   and the bench can still show what came back. */
export function answerText(out: unknown): string {
  const response = (out as { response?: unknown })?.response;
  if (typeof response === "string") return response;
  const content = (out as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  return JSON.stringify(out) ?? "";
}

/* `text` reads a PDF's converted text instead of a picture (D1). Both
   go to the same model with the same JSON shape, so nothing downstream
   has to know which one it got — except that a text reading never
   carries a legibility (D15).

   receipt-reader-tuning D9–D11: the model arrives from the caller — the
   plan's chosen model, its fallback, or one of the bench's — and its
   list entry's `input` is merged into the one request shape every model
   gets. `timeoutMs` races the call; omitted, there is no limit, which is
   the default model's case (it is never limited). */
export async function readProof(
  ai: Ai | undefined,
  proof: LoadedProof,
  model: ReaderModel,
  opts: { text?: string; timeoutMs?: number } = {},
): Promise<Reading> {
  if (!ai) throw new ReaderError("READER_UNAVAILABLE", "no AI binding");

  const content = opts.text
    ? [{ type: "text", text: `${TEXT_PROMPT}\n\n---\n${opts.text}` }]
    : [
        { type: "text", text: PROMPT },
        {
          type: "image_url",
          image_url: { url: `data:${proof.mediaType};base64,${base64(proof.bytes)}` },
        },
      ];

  const started = Date.now();
  let out: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = (ai as unknown as { run(m: string, i: unknown): Promise<unknown> }).run(model.id, {
      messages: [{ role: "user", content }],
      max_tokens: 400,
      ...(model.input ?? {}),
    });
    out = await (opts.timeoutMs == null
      ? call
      : Promise.race([
          call,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ReaderError("READER_UNAVAILABLE", "timeout")), opts.timeoutMs);
          }),
        ]));
  } catch (e) {
    if (e instanceof ReaderError) throw e;
    throw new ReaderError("READER_UNAVAILABLE", String(e));
  } finally {
    if (timer) clearTimeout(timer);
  }
  const ms = Date.now() - started;

  const raw = answerText(out);
  let parsed: Record<string, unknown>;
  try {
    parsed = parseReaderOutput(raw);
  } catch (e) {
    if (e instanceof ReaderError) e.raw = raw;
    throw e;
  }

  return {
    isReceipt: parsed.esComprobante !== false,
    /* D15: a text reading has no photograph to judge, so it is null
       here whatever the model volunteers — and null reads as `full`. */
    legibility: opts.text ? null : legibilityOf(parsed.legibilidad),
    trackingKey: str(parsed.claveDeRastreo),
    /* receipt-reader-tuning D13: `banco` is the version-1 key and still
       parses as the sender, so a reading in either wording means the same */
    senderBank: str(parsed.bancoEmisor) ?? str(parsed.banco),
    receivingBank: str(parsed.bancoReceptor),
    amount: num(parsed.monto),
    date: str(parsed.fecha),
    time: timeOf(parsed.hora),
    status: str(parsed.estatus),
    referenceNumber: referenceOf(parsed.referenciaNumerica),
    destination: destinationOf(parsed.destino),
    raw,
    model: model.id,
    questionVersion: QUESTIONS_VERSION,
    ms,
    fallbackFrom: null,
  };
}
