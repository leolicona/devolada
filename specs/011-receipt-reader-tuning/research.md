# Research: receipt-reader-tuning

**Date**: 2026-09-25 · **Plan**: [plan.md](./plan.md) · **Spec**: [spec.md](./spec.md)

Phase 0. Each item ends with a decision; the plan's table cites the item it
came from. "Measured" means read from a real system on the date given;
everything else is read from code or documentation and says so.

## What was measured

Read from the dev D1 (`devolada-db-dev`) on 2026-09-25, business
`eae33e15…` (the creator's test ISP, cuenta de cobro BBVA MEXICO CLABE
`…9784417`):

| Case | Rows | What the reader said | What happened |
| --- | --- | --- | --- |
| Nu, "Folio QVSBGOD7L", "Número de referencia 250926", no clave | extractions `c02611ae`, `20dbf5e4`; payment `221a806c` | `claveDeRastreo: "QVSBGOD7L"`, `banco: "NUBANK"`, `referenciaNumerica: "250926"`, `legibilidad: "completa"` | Gate `ok` on all four fields; shape `unknown` (0 Nu `valid` rows on dev and prod). Image door: apiCEP `status: "error"` (5.4 s) → `blind`, `provider` side, accepted from `reader`. Four transfer-door searches with the folio, all `not_found` (T+2, 9, 23, 46 min); the reference never travelled (receipt-triage D1) |
| Azteca, "Cuenta origen: Guardadito ***8301", "Cuenta destino: … Bbva Mexico ***417", no clave | extractions `0d0cf338`, `66e0c984`; payment `0ecde90f` | `banco: "BBVA MEXICO"`, `referenciaNumerica: "9784417"`, `destino: {cuenta, 417}` | Image door `error` → accepted from reader. Six retries refused in-process by the same-institution guard (validation spec D17, `REQUEST_REJECTED`, no credit); `expired`, `last_error REQUEST_REJECTED`; the payer was never asked |
| Azteca family, all captures | 7 fresh readings of 5 files (sha256 `a54d…`, `b548…`, `edb1…`, `9265…`, `e045…` ×3) | `banco: "BBVA MEXICO"` in **7 of 7** | The ones with a clave were confirmed by the provider's own reading (`AZTECA`) on the first call; ours never mattered |
| Azteca claves | `2311b175`, `bdbdff2e`, `8bc7757a` | `2609250711443782331`, `260925071144368901`, `2609250711443930841` | Provider read `…78233I`, `…68901I`, `…93084I`: the final letter read as `1` twice, dropped once (**3 of 3 wrong**) |

What was **not** measured: any reading by Gemma 4; any reading of the
questions written by this plan; the answer shape of Gemma 4 through the
binding (R5). The bench this feature builds is the instrument that measures
them (quickstart Step 2).

## R1 — Where the reader runs, and where the model is decided

Read from code, 2026-09-25. The reader (`consta/extraction/reader.ts`,
`readProof`) is reached only through `extractProof`
(`consta/extraction/index.ts`), which has exactly two callers:

- `consta/extract.ts` — the free reading door, called by the payer page's
  `POST /direct-payments/links/:token/read`;
- `consta/validate.ts` — the receipt door, before the provider call, for
  direct payments and for the platform's top-ups (`credit/topups.ts` goes
  through the same `validate`). Its draft reuse (`recentReading`,
  two-eyes-receipt D14) skips the call entirely when `/read` just read the
  same bytes.

Both callers already hold `env` and `db`. The model today comes from
`env.EXTRACTION_MODEL ?? DEFAULT_MODEL` inside `readProof`.

**Decision (D9)**: the model is resolved **once per reading, by the caller
that holds `db`**, and handed to `extractProof` as a *reader plan*
(`{ chosen, fallback }`, R6). `readProof` no longer reads `env` for the
model. No other file calls the reader, so no other door can bypass the
choice.

## R2 — The allowed list: a JSON var

Constitution VIII: "model ids … are `vars`, never literals"; the stack
table: "Workers AI for receipt reading (model is a var)". The creator wants
the model chosen in a screen (spec D1). The two meet if the **set** of ids
stays a var and the screen only picks among them.

Wrangler's `vars` accept JSON values in `wrangler.jsonc`, handed to the
Worker parsed. The list needs, per model, a label for the panel and, for
some models, extra input for the call (R5), so it is an array of objects,
not a comma-separated string.

**Decision (D7)**:

- `EXTRACTION_MODELS` — a JSON var: `[{ "id": "@cf/…", "label": "…",
  "input": { … }? }]`. Repeated in the top-level, `dev` and `prod` blocks
  like every var (consta-api-merge D9).
- `EXTRACTION_MODEL` stays and keeps its meaning: the **default**. If the
  list does not contain it, it is prepended with its id as label, so the
  default is always choosable and always the fallback.
- **Unset** list → the list is the default alone: today's behaviour, and the
  panel shows one option. **Unparseable or invalid** list → the same, with a
  `console.warn` once per isolate (constitution VIII: degrade loudly, never
  throw at the edge). Validated with zod at first use.
- Launch values: dev → Mistral Small 3.1 (default) and Gemma 4 26B A4B with
  thinking off (R5); prod → Mistral Small 3.1 alone (spec D1, SC-005).
- `READER_TIMEOUT_MS` — a test knob like `APICEP_DEADLINE_MS`, never set by a
  deploy (R6).

Alternatives rejected: model ids as a code constant (a literal —
constitution VIII); letting the operator type any id (a typo becomes every
payer's broken reading, and a model outside Workers AI would change the
stack); a D1 table of models (a deploy-time fact stored as runtime data,
editable by nobody on purpose).

## R3 — Where the choice is stored

`platform_settings` is the operator's append-only key/value store: every
write is a row with its author and time, the latest row wins, and the
history is the rows (operator-panel D1, D4). Its registry (`SETTINGS` in
`platform/settings.ts`) holds each key's type, birth value and validation
**in code**; the Reglas tab lists every registry key.

The reader model does not fit the registry: its vocabulary is the
environment's list, not a code constant, and it belongs on its own tab next
to the bench (R12), not in Reglas.

**Decision (D8)**: the choice is a `platform_settings` row with key
`reader_model` and the model id as value, written and read by
`platform/reader-model.ts` — not added to `SETTINGS`, so Reglas does not
show it and `validateSetting` does not need the environment. It gets:

- history and authorship for free, with no new table and no migration for
  the choice itself;
- **no cache**: one indexed read (`platform_settings_key_created_idx`) per
  reading, so the next reading after a save uses the new model (SC-003).
  The shape rules' 60-second cache (proof-extraction D14) is not copied
  here on purpose;
- **"applies"**: a stored id no longer in the list resolves to the default,
  and the panel says so (FR-004). No row → the default, marked as such.

## R4 — The route

Constitution III: a resource is `routes/<area>/{index,handler,schema}.ts`,
with the schema exported from `@devolada/api`. The landing page set the
precedent for an operator-only area outside `routes/platform/`: its
operator router is mounted by `routes/platform/index.ts` behind that file's
`requireSession, requirePlatformOperator` (landing-page D5).

**Decision (D18)**: a new area `routes/reader/` whose operator router is
mounted at `/platform/reader`, exported as `@devolada/api/reader-schema`.
Contract in [contracts/reader-api.md](./contracts/reader-api.md). No new
role-matrix area: the platform operator is not a membership role
(constitution V, `PLATFORM_OPERATOR_EMAILS`).

## R5 — Asking different models, and reading their answers

Read from the Workers AI docs on 2026-09-25 (not measured):

- Mistral Small 3.1 is called today with `messages: [{ role: "user",
  content: [{ type: "text" }, { type: "image_url", image_url: { url:
  "data:…;base64,…" } }] }]` and answers `{ response: "<text>" }`. Measured
  since 2026-08-19 (proof-extraction D5), and every dev row above.
- Gemma 4 26B A4B (`@cf/google/gemma-4-26b-a4b-it`, April 2026) is listed
  with Vision, Reasoning and "Batch"; Cloudflare's own example calls it with
  `messages` and `chat_template_kwargs: { enable_thinking: false }` to turn
  reasoning off. Its image-input shape through the binding and its output
  shape (`response` or an OpenAI-style `choices[0].message.content`) are
  **not documented in what was reachable**, and not measured.
- Pricing: Mistral $0.351 / $0.555 per M tokens (in/out), Gemma 4 $0.10 /
  $0.30. Neither is on the May 2026 deprecation list.

**Decision (D10)**:

- One request shape for every model, today's: `messages` with the text part
  and the `image_url` data-URI part (or the text part alone for a PDF's
  text), `max_tokens: 400`. A list entry's `input` object is **merged into
  the request** — which is how Gemma's `chat_template_kwargs:
  { enable_thinking: false }` rides without the reader knowing any model by
  name. Thinking stays off for payer readings: the payer waits for the
  reading, and SC-005 caps that wait.
- The answer's text is taken from `response` when it is a string, else from
  `choices[0].message.content` when that is a string, else the whole answer
  serialized — then `parseReaderOutput` as today (first `{` to last `}`).
  An answer with no JSON in it stays `READER_UNREADABLE`.
- Unmeasured on purpose, and designed to show itself: the bench records the
  raw answer of every reading, failed ones included, so the first Gemma 4
  upload on dev proves or disproves both shapes (quickstart Step 2). If
  Gemma needs a different image part, the fix is its list entry's `input`
  or one branch in `readProof`, and the bench shows it the same minute.
- Amended 2026-09-25 (analyze C2): no test stubs the `choices` shape,
  because constitution IV admits only measured answers. The branch is
  registered as debt (`reader-answer-shape-unmeasured`) the day it lands.
  The bench's first Gemma 4 raw answer becomes the fixture, and any branch
  no measured answer uses is removed.

Alternatives rejected: a per-model adapter table keyed by id in code
(model ids as literals, and a code change per model); the OpenAI-compatible
REST endpoint (needs an API token secret the Worker does not hold, and the
binding already reaches every model); JSON mode (`response_format`) —
documented for none of the vision models.

## R6 — The fallback, the time limit, and what is recorded

Spec D3: a failed answer from the chosen model is read again by the
default; a wrong answer is not a failure.

**Decision (D11)**:

- **Failure** = `ReaderError`: `READER_UNAVAILABLE` (the binding threw —
  model retired, capacity, network — or the time limit fired) or
  `READER_UNREADABLE` (no JSON in the answer). Nothing else.
- **Time limit** for a chosen model that is **not** the default: 8 s
  (`READER_TIMEOUT_MS`, default 8000), by racing the call against a timer.
  Reason: the default reads in about 2.7 s (proof-extraction D5, measured
  2026-08-19), so 8 s is three times the norm; the payer's worst case is
  then about 8 + 3 = 11 s, once, and only while a bad model is chosen. The
  late answer is ignored; the binding offers no abort that is documented.
- **The default is never limited**, as today: there is nothing to fall back
  to, and a slow reading beats none. When the chosen model *is* the
  default, there is one call and no fallback (FR-006).
- **PDF**: the text conversion (`toMarkdown`) runs once; the fallback reads
  the same text. The conversion itself is model-independent.
- **Recorded** on the reading row (R9): `model` = the model that actually
  produced the reading; `fallback_from` = the chosen model that failed, else
  NULL; `reader_ms` = the time of the reading that counted (the fallback's,
  on a fallback); and when both fail, the row records today's degradation
  (`routed`/`unreadable` with the reason) plus `fallback_from`.
- The chosen model's failures are countable per week from `fallback_from`
  (the panel shows the count of the last 7 days next to the choice, FR-002,
  edge case "a model stops existing"). That count reads across businesses,
  and constitution V admits it as its third such statistic since v1.6.0
  (analyze C1).

## R7 — The question version

Spec D2: every reading records the version of the questions it answered.

**Decision (D12)**: `QUESTIONS_VERSION` — an explicit label exported by
`reader.ts`. `"1"` names the receipt-triage questions and arrives first,
pinned to today's prompts. `"2"` names this feature's questions and arrives
with Story 2. Rows before this feature read NULL (spec edge case). A row
carries `"1"` only if Story 1 is released before Story 2 (amended
2026-09-25, analyze I1). A test computes the SHA-256 of the two
prompt texts and asserts it equals the hash pinned beside the label, so a
change of wording without a new label fails CI. Rejected: a version derived
automatically from the hash (unreadable in the panel), and a date label
(two changes in one day collide).

## R8 — The questions, rewritten

Spec D4 and D5. The failures are about telling fields apart, so the rules
name the labels banks print. Full text in
[contracts/engine.md](./contracts/engine.md).

**Decision (D13)**:

- The JSON keys name both banks: `bancoEmisor` and `bancoReceptor` replace
  `banco` — a key the model fills is itself an instruction. The parser
  still accepts `banco` as the sending bank, so an old answer (and the
  existing test stubs) parse unchanged.
- Rules added, one per failure: the clave only from a field labelled
  "Clave de rastreo" (or "Clave rastreo", "Rastreo"), and "Folio", "Número
  de autorización", "Número de operación", "Referencia" or an account
  number never; the clave copied character by character, a final letter
  kept ("Banco Azteca's claves end in the letter I"), no letter turned into
  a digit or the reverse; the sending bank only from the sender's side
  ("Cuenta origen", "Banco emisor", "Desde", the name or logo of the bank
  that issued the receipt), never from "Cuenta destino", "Beneficiario",
  "Para" or the concepto; the receiving bank only from the destination's
  side; `null` for anything not shown.
- Kept word for word: legibility, the reference rules (receipt-triage D12),
  the destination (D24), "not a receipt". FR-014's no-regression is
  measured on the bench, not asserted by a unit test.
- Both prompts (picture, PDF text) still share `FIELDS` and `RULES`
  (receipt-triage D12/D24), so a PDF gets the same rules (spec edge case).

## R9 — Both banks through the gate, and the same-bank flag

Spec D5: read both banks, alter neither, flag the pair; cross-check the
receiving bank against the account the destination ties to.

`Gate` is part of what `/read` sends the payer page (`gate` in the
response, receipt-triage contracts); the page does not need the receiving
bank.

**Decision (D14)**:

- The receiving bank is resolved through the same vocabulary as the
  sending one (`resolveBank`), into a sibling of the gate —
  `GatedReading.receiving = { bank, verdict: ok | unknown | missing,
  sameBank }` — **not** into `Gate`, so the payer contract does not move.
- `sameBank` = both banks resolved (`ok`) and equal. Nothing reads it to
  decide anything in this feature (FR-012a); the engine's same-institution
  guard (validation spec D17) is untouched and still refuses the search.
- The tie check lives where the tie is computed today (`extract.ts` and
  `validate.ts`, `tieDestination`): when the destination ties to an
  account, `receivingBankTie` = `match` if the receiving bank read is that
  account's bank, `mismatch` if it is another, NULL when either is unknown.
- Never written: the ISP's account itself (constitution V,
  receipt-triage D21) — only the verdict.

## R10 — The reused draft carries what it read

Two-eyes D14 rebuilds a reading from the stored row; receipt-triage D28
learned that a field the rebuild forgets is silently dropped on the paid
attempt.

**Decision (D15)**: `recentReading` copies `model` (as today),
`question_version` and `reader_ms`, rebuilds `receiving` from the stored
receiving bank and its verdict, and the new row records `fallback_from` as
stored. A reused reading is never re-read with the newly chosen model
(spec Story 1, scenario 6).

## R11 — The bench: where files and readings live

Spec D6. What the bench needs: a file store that forgets on the proofs'
schedule, readings that no payer measurement can see, and one reading per
model per question version per receipt.

- The proofs bucket (`PROOFS`) carries a 15-day lifecycle rule applied to
  the whole bucket (`wrangler r2 bucket lifecycle add … --expire-days 15`,
  direct-payment D12). A `bench/` prefix inherits it with no configuration.
- Every count of payer readings is a query over `extractions`
  (receipt-triage D21, FR-028). A reading that never enters `extractions`
  can never be counted.

**Decision (D16)**:

- Files: `PROOFS` at `bench/<uuid>`, same limits as a payer's proof (1 MB,
  image or PDF, magic bytes sniffed by `loadProof`) — the bench measures
  what a payer can send.
- Readings: two new platform tables, `bench_receipts` and
  `bench_readings` (data-model.md), with no `business_id` — the precedent is
  `platform_settings` and `access_requests`: rows that belong to no
  business and that only the operator reads. **Nothing** the bench does
  writes to `extractions`, `payments`, `validations` or the credit ledger,
  and it never calls the provider.
- Reading: synchronous in the upload request, every listed model **in
  parallel**, each with its own 30-second limit, **no fallback** (spec D6),
  the PDF converted once. A model that fails is a `failed` reading with
  its code and its raw answer.
- One reading per (receipt, model, question version), enforced by a unique
  index; "read again" fills only the missing combinations — after a new
  question version or a model added to the list.
- A file uploaded twice (same SHA-256) is the same bench receipt; the
  second upload answers with it and `duplicate: true` (spec edge case).
- The 15-day rule is bucket configuration, applied once per environment
  (direct-payment D12) and not visible from the repository. It is verified
  on both buckets before the bench runs, and added if missing (analyze U1).
- After 15 days the file is gone and the readings, marks and tally stay:
  they hold what was read, never the image or a name (the reader is never
  asked for names).

## R12 — Marks and the tally

Spec FR-017, FR-018.

**Decision (D17)**:

- The fields judged: `isReceipt`, `legibility`, `trackingKey`,
  `referenceNumber`, `senderBank`, `receivingBank`, `amount`, `date`,
  `destination`.
- What is judged is **the value the product would act on** — after the gate
  and the vocabulary (a clave the gate refuses shows as "not read") — with
  the raw answer one click away. The product's reading, not the model's
  prose, is what the payer and Banxico would see.
- Marks per field: `right`, `wrong`, or `absent` — the operator saying the
  receipt does not show that field. `absent` is judged by the bench: right
  when the reading also says "not shown", wrong when it names something
  (the folio read as a clave is exactly that).
- Tally per (model, question version): readings, failures, fields judged,
  fields right, the share right, the wrong count per field, and the reading
  time 9 of 10 readings finished within (SC-005). That time is the model's
  own reading time (`reader_ms`): the call alone, not the upload or a PDF's
  conversion. After launch, SC-005 is checked with the same measure on real
  payer readings (analyze A1). Computed on request from
  the rows — the bench is small for the life of this feature (tens of
  receipts). `asOf` on the answer is the date that goes into `reader.ts`'s
  header and closes the debt (FR-020).

## R13 — The panel: a fourth tab

`/operador` has three tabs (Reglas, Negocios, Landing). The model choice is
one field; the bench is a list, a detail and a tally.

**Decision (D19)**: a fourth tab, **Lector**: a *Modelo* card (the active
model, "por defecto" or not, whether the choice applies, the last choices
with author and time, the fallbacks of the last 7 days, and a select + save
at compact size), a *Banco de pruebas* card (upload, receipts newest first,
each with its per-model summary), a receipt detail (the image beside one
column per model, field rows with the three-state mark control, the time,
the raw answer in a collapsible) and a *Resultados* card (the tally). The
image is fetched through the API client as a blob with the session and shown
by object URL; a PDF opens by object URL in a new tab. Status (failed, same
bank, marks) is icon + text (constitution VI). The detail is responsive by
stacking columns below 768 px.

## R14 — What each test layer can prove

Constitution IV. The reader is the one binding a test stands in for, so a
test can prove that a reading is **routed, recorded and never altered** —
not that a real model reads a real receipt right. Accuracy (SC-001, SC-002,
SC-005) is measured on the bench with real models (quickstart Step 2).

**Decision (D20)**:

- `aiReturning` learns three things: an answer **per model id**; a model
  that **throws**; a model that **waits** (with `READER_TIMEOUT_MS` pinned
  low in the suite). Every answer uses the measured `response` shape. An
  unmeasured shape is never stubbed (constitution IV, analyze C2).
- API tests (workerd, real D1): the choice and its guard; resolution and
  "applies"; the fallback on each failure kind, with and without a PDF;
  what the row records; the reused draft; both banks, the flag, the tie
  verdict, and that neither bank is ever altered; the version pin; the
  bench's isolation (no row in `extractions`, `payments`, `validations`,
  `credit_entries`; no provider fetch — `fetchMock` would fail on one), the
  parallel reading, dedupe, re-read, marks, `absent` judging, the tally.
- Component (admin): the Lector tab — choice, history, applies/default
  states, bench upload, detail, marks, tally — MSW with schema-parsed
  fixtures, axe on each state.
- Browser: the Lector tab joins `responsive.spec.ts` (no horizontal scroll
  at 360/768/1280) and `contrast.spec.ts` (both themes), stubbed.

## R15 — Closing `receipt-triage-reader-unmeasured`

The debt's exit condition: `grep -n "not run" reader.ts` returns nothing,
and a dated measurement table sits in its header.

**Decision**: the bench's tally at the date of the creator's run, for the
question version this feature ships, is that table (quickstart Step 3). The
debt is closed with `/speckit-debt-pay` citing it; the plan does not close
it by writing code.

## R16 — The stack table's wording

The stack table says "Workers AI for receipt reading (model is a var)".
After this feature, every model id the reader can use is still a var
(`EXTRACTION_MODELS`, `EXTRACTION_MODEL`); the operator picks among them at
runtime. VIII's "model ids are vars" holds word for word. **Amended**:
constitution v1.6.0 (2026-09-25) rewrote the table's parenthesis to "the
models are a var; the platform operator picks one of them in `/operador`",
in the same amendment that admitted the fallback count into V (analyze C1).
