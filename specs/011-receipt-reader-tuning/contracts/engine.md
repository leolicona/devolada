# Contract: the engine's reader — models, fallback, both banks, the questions

Internal to `apps/api` (the engine is a module, not a surface — constitution
III). Callers: `consta/extract.ts` (the `/read` door), `consta/validate.ts`
(the receipt door; top-ups ride it), and the bench handler
(`routes/reader/handler.ts`), which is the only caller that asks for **no**
fallback. Cited as `receipt-reader-tuning D<n>`.

## Models (`consta/extraction/models.ts`, new) — D7, D8, D9

```ts
type ReaderModel = { id: string; label: string; input?: Record<string, unknown> };
type ReaderPlan  = { chosen: ReaderModel; fallback: ReaderModel | null };

readerModels(env): { list: ReaderModel[]; defaultModel: ReaderModel };
// Parses EXTRACTION_MODELS (zod) and EXTRACTION_MODEL ?? DEFAULT_MODEL.
// Unset or invalid list → [default]; invalid also warns once per isolate.
// The default is prepended when the list lacks it. Ids unique (first wins).

readerChoice(db, list): Promise<{ active: ReaderModel; choice: "default" | "applies" | "stale"; stale: string | null }>;
// Latest platform_settings row with key "reader_model". No cache (SC-003).

readerPlan(env, db): Promise<ReaderPlan>;
// { chosen: active, fallback: active.id === default.id ? null : default }
```

`platform/reader-model.ts` holds the write (`chooseReaderModel(db, id,
author)`, refusing ids outside the list) and the history read; the
`reader_model` key is **not** in `SETTINGS` (D8).

## Reading (`consta/extraction/reader.ts`) — D10, D12, D13

```ts
export const QUESTIONS_VERSION = "2";

readProof(ai: Ai, proof: LoadedProof, model: ReaderModel,
          opts: { text?: string; timeoutMs?: number }): Promise<Reading>;
```

- Request: today's `messages` (text part + `image_url` data-URI part; text
  part alone for a PDF's text), `max_tokens: 400`, then `{ ...model.input }`
  merged in (D10). No model is named in code except `DEFAULT_MODEL`.
- `timeoutMs`: the call races a timer; on expiry → `ReaderError
  ("READER_UNAVAILABLE", "timeout")`. Omitted → no limit (the default, as
  today).
- Answer text: `response` if a string; else `choices[0].message.content` if
  a string; else the serialized answer. Then `parseReaderOutput` (unchanged).
- Parse: `bancoEmisor ?? banco` → `senderBank`; `bancoReceptor` →
  `receivingBank`; the rest unchanged. `model` = `model.id`;
  `questionVersion` = `QUESTIONS_VERSION`; `ms` = the call's duration.
- A test pins `sha256(PROMPT + "\n" + TEXT_PROMPT)` to `QUESTIONS_VERSION`
  (D12).

## Extraction with a plan (`consta/extraction/index.ts`) — D9, D11

```ts
extractProof(env, proof, plan: ReaderPlan, opts?: { timeoutMs?: number }): Promise<ExtractionResult>;
```

1. PDF → `pdfToText` **once** (unchanged rules; no text → `provider-ocr`,
   as today).
2. Read with `plan.chosen`, with `timeoutMs` = `READER_TIMEOUT_MS ?? 8000`
   **only when** `plan.fallback` is set.
3. On `ReaderError` and `plan.fallback` set → read once with
   `plan.fallback`, no limit, same text/picture; the reading carries
   `fallbackFrom = plan.chosen.id`.
4. On a second `ReaderError` (or the first with no fallback) → rethrow as
   today; the callers' existing degradation applies (the receipt door sends
   the file to the provider unread; `/read` answers 503 and records
   `unreadable`/`refused`), and the row records `fallback_from` when a
   fallback was tried.
5. `gateReading(reading)` as today, plus `receiving` (below).

The bench calls `readProof` directly per model with a 30 000 ms limit and
never falls back (spec D6).

## Both banks through the gate (`consta/extraction/gate.ts`) — D14

```ts
type GatedReading = /* as today */ & {
  receiving: { bank: Bank | null; verdict: "ok" | "unknown" | "missing"; sameBank: boolean };
};
```

- `receiving.bank = resolveBank(reading.receivingBank)`; verdict like the
  sender's (`missing` if not read, `unknown` if not in the vocabulary).
- `sameBank = gate.senderBank === "ok" && receiving.verdict === "ok" &&
  senderBank === receiving.bank`.
- **Nothing reads `sameBank` to change the flow**, and the gate never
  changes `senderBank` because of `receiving` (FR-012, FR-012a). The
  same-institution guard (validation spec D17) is untouched.
- `Gate` (the object `/read` returns to the payer page) is unchanged.

## Recording (`consta/extract.ts` `recordExtraction`) — D11, D14, D15

New columns written on every row that holds a reading: `question_version`,
`reader_ms`, `fallback_from`, `receiving_bank`, `gate_receiving_bank`,
`same_bank`; and, where the caller tied the destination,
`receiving_bank_tie`:

```ts
receivingBankTie(gated, tie): "match" | "mismatch" | null
// tie = tieDestination(reading.destination, accounts) as computed today in
// extract() and validate(); "match" when receiving.bank === tied.bank,
// "mismatch" when both are known and differ, else null.
```

A row that read nothing (`routed`, `refused`, `unreadable`) records
`fallback_from` when a fallback was attempted, and nothing else new.

## The reused draft (`recentReading`) — D15

Rebuilds `receiving` from `receiving_bank` / `gate_receiving_bank` (the
flag re-derived), and carries `model`, `question_version`, `reader_ms`,
`fallback_from` onto the new row. A reused reading is never re-read with the
newly chosen model.

## The questions, version "2" — D13

`FIELDS` (both prompts) — changed lines marked `+`/`~`:

```text
{"esComprobante": <true if this really is a bank transfer receipt, false otherwise>,
~ "claveDeRastreo": "<the value of the field labelled 'Clave de rastreo', or null if no field has that label>",
+ "bancoEmisor": "<the bank the money was sent FROM, or null if the receipt does not show it>",
+ "bancoReceptor": "<the bank the money was sent TO, or null if the receipt does not show it>",
 "monto": <the amount in pesos as a number, or null>,
 "fecha": "<the operation date as YYYY-MM-DD, or null>",
 "estatus": "<the value of the 'Estatus' field, or null>",
 "referenciaNumerica": "<… unchanged …>",
 "destino": {"tipo": "<… unchanged …>", "digitos": "<… unchanged …>"}}
```

`RULES` — the three failures, then what stays:

```text
- "claveDeRastreo" comes ONLY from a field labelled "Clave de rastreo" (also
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
- If the receipt does not show a clave de rastreo at all, return null. A
  receipt captured while the transfer is still "En proceso" often has none.
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
  <BANKS>
- (referenciaNumerica — unchanged, receipt-triage D12)
- (destino — unchanged, receipt-triage D24)
- (not a receipt → esComprobante false, every other field null — unchanged)
```

The picture prompt keeps its legibility block word for word; the text
prompt keeps having none (two-eyes-receipt D15).

## Test stand-in (`test/consta/helpers.ts`) — D20

```ts
aiReturning(
  reading: StubbedReading | string | Record<string /* model id */, StubbedReading | string | AiBehaviour>,
  calls?: unknown[],
  opts?: { pdfText?: string; shape?: "response" | "choices" },
): Ai;
type AiBehaviour = { throws: string } | { waitsMs: number; then: StubbedReading | string };
```

`StubbedReading` gains `bancoEmisor?` and `bancoReceptor?`; `banco` still
parses as the sending bank, so existing fixtures keep their meaning.
`vitest.config.ts` pins `EXTRACTION_MODELS` (two test ids) and
`READER_TIMEOUT_MS` (50) so a developer's `.dev.vars` cannot move a suite.
