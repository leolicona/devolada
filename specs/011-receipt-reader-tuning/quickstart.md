# Quickstart: receipt-reader-tuning

How to prove the feature works, story by story, with the commands a
contributor runs. The shapes are in [contracts/](./contracts/) and
[data-model.md](./data-model.md); the steps to build them are in `tasks.md`.

## Prerequisites

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local      # applies 0037
pnpm --filter @devolada/api dev                   # API on :8787, AI binding remote
pnpm --filter @devolada/admin dev                 # panel on :5174
pnpm --filter @devolada/pago dev                  # payment page on :5175
curl -X POST localhost:8787/dev/seed              # demo ISP + a link
```

The seeded user must be the platform operator: `PLATFORM_OPERATOR_EMAILS`
in `apps/api/.dev.vars` includes `demo@devolada.app`. The `AI` binding runs
against the real Workers AI in `wrangler dev` and bills like dev. The
top-level `vars` of `apps/api/wrangler.jsonc` carry the dev list (Mistral
Small 3.1 default, Gemma 4 26B A4B with thinking off).

## The gates, in CI order

```sh
node scripts/spec-lint.mjs            # every new test cites receipt-reader-tuning US<n>
node scripts/gen-banks.mjs --check    # the vocabulary is untouched
node scripts/contrast-lint.mjs        # the Lector tab adds no token
node scripts/pending-lint.mjs         # the bench's "Leyendo…" sits inside <Pending>
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -r --if-present build
```

## Story 1 — the operator chooses the model

Automated (API, workerd, real D1, the reader stubbed per model id):

```sh
pnpm --filter @devolada/api test -- test/reader-model.test.ts
pnpm --filter @devolada/admin test -- -t "Lector"
```

Proves: default state with no row; choosing appends a row with its author
and the next reading uses it; an id outside the list is `INVALID_MODEL` and
writes nothing; a stale choice reads the default and says so; a
non-operator gets `NOT_PLATFORM_OPERATOR`; the chosen model throwing, timing
out or answering without JSON falls back to the default once, for a picture
and for a PDF (converted once); the row records `model`, `fallback_from`,
`question_version`, `reader_ms`; a reused draft keeps the model that read
it; with the default chosen there is exactly one call.

By hand, on `localhost:5174/operador` → **Lector**:

1. The Modelo card shows Mistral Small 3.1 "Por defecto".
2. Choose Gemma 4 and save. Upload a receipt through the demo link on
   `localhost:5175`. In D1:
   `SELECT model, question_version, reader_ms, fallback_from FROM extractions ORDER BY created_at DESC LIMIT 1;`
   → Gemma 4's id, `"2"`, a time, NULL.
3. Choose Mistral back; upload again → Mistral's id.

## Story 2 — the fields read right

Automated — what a stub can prove (research R14):

```sh
pnpm --filter @devolada/api test -- test/consta/reader-questions.test.ts
```

Proves: the prompts carry the three new rules and both bank keys; the pin
of `QUESTIONS_VERSION` to the prompts' hash; `bancoEmisor`/`bancoReceptor`
parse (and `banco` still parses as the sender); the receiving bank resolves
through the vocabulary; `same_bank` is set on an Azteca→Azteca reading and
**neither bank is altered**; `receiving_bank_tie` is `match` / `mismatch`
against the tied account; the payer's `/read` answer is unchanged in shape.

What only real models can prove — accuracy (SC-001, SC-002) — is Story 3.

## Story 3 — the bench, and the measurement that decides

Automated:

```sh
pnpm --filter @devolada/api test -- test/reader-bench.test.ts
pnpm --filter @devolada/admin test -- -t "banco de pruebas"
pnpm e2e -- --grep "Lector"
```

Proves: upload reads with every listed model in parallel; a failed model is
a failed column, never replaced; nothing is written to `extractions`,
`payments`, `validations` or `credit_entries`, and no provider fetch happens
(`fetchMock` refuses any); the same file twice is one receipt; "read again"
fills only missing combinations; marks save, `absent` is judged right or
wrong against the reading; the tally adds up; a non-operator is refused; the
tab has no horizontal scroll at 360/768/1280 and passes contrast in both
themes.

### Step 1 — keep the test receipts (before 2026-10-09)

The dev captures of 2026-09-24 and 2026-09-25 live in the dev proofs bucket
for 15 days. Save them now (the creator's phone has the originals; the
bucket keys are in `extractions.proof_key` on dev):

- Nu, "Folio QVSBGOD7L" (the folio case);
- Azteca without clave, "Cuenta origen Guardadito" (the sending-bank case);
- Azteca with clave `…368901I` (the final-letter case), and the other two;
- receipts 1 (Banorte) and 2 (Azteca, "Referencia 038195") of receipt-triage;
- at least one receipt that shows a labelled "Clave de rastreo" read right
  today (no-regression), and one PDF.

### Step 1b — the buckets forget on time (analyze U1)

```sh
pnpm --filter @devolada/api exec wrangler r2 bucket lifecycle list devolada-transfer-proofs-dev
pnpm --filter @devolada/api exec wrangler r2 bucket lifecycle list devolada-transfer-proofs
```

Each must show a 15-day expiry with no prefix that leaves `bench/` out. If
one is missing, add it before Step 2 (direct-payment D12).

### Step 2 — run the bench on dev

After deploy to dev: `app.dev.devoladapago.com/operador` → **Lector** →
**Banco de pruebas**. Upload each receipt. For each, check the two columns
and mark every field: "Correcto", "Incorrecto", or "No aparece" when the
receipt does not show it.

The first Gemma 4 upload also proves the call and answer shapes (research
R5): a column that reads "Respuesta sin datos" with a raw answer that holds
the JSON inside another structure means the answer-text rule needs one more
branch — fix, deploy, "Leer de nuevo". Either way, copy one raw answer per
model into the test fixtures and pay `reader-answer-shape-unmeasured`
(constitution IV).

Expected on the known failures, for the model that goes to prod (SC-001):

| Receipt | Field | Expected |
| --- | --- | --- |
| Nu, folio | Clave de rastreo | No se ve |
| Nu, folio | Referencia | 250926 |
| Azteca without clave | Banco emisor | AZTECA or No se ve — never BBVA MEXICO |
| Azteca without clave | Banco receptor | BBVA MEXICO |
| Azteca with clave | Clave de rastreo | 260925071144368901I (the I kept) |
| Receipt 2 | Referencia | 038195 |
| Receipt 1 | Destino | clabe · 8195 |

### Step 3 — decide and record

Open **Resultados**. The model for prod is the one that meets SC-001 and
SC-002 on the whole set and reads 9 of 10 under 5 s (SC-005).

1. Copy the tally rows, with the "Al …" date, into the header of
   `apps/api/src/consta/extraction/reader.ts`, replacing "not run".
2. `/speckit-debt-pay receipt-triage-reader-unmeasured` with that table as
   the evidence (FR-020, SC-009).
3. If the winner is not Mistral: add it to prod's `EXTRACTION_MODELS` (a
   deploy), then choose it in prod's `/operador` → Lector (one action).
   Going back is one action too.

## After launch — the counts (one query each)

```sql
-- SC-004: every reading names its model and version
SELECT count(*) FROM extractions WHERE created_at > :launch AND model IS NOT NULL AND question_version IS NULL;
-- SC-006: fallbacks of the chosen model
SELECT fallback_from, count(*) FROM extractions WHERE fallback_from IS NOT NULL GROUP BY 1;
-- SC-005: the model's own reading time, 9 of 10 (read the 90th row of the sorted times)
SELECT model, reader_ms FROM extractions WHERE created_at > :launch AND reader_ms IS NOT NULL ORDER BY model, reader_ms;
-- SC-007: same-bank readings per ISP per week
SELECT business_id, strftime('%Y-%W', created_at / 1000, 'unixepoch') AS week, count(*)
FROM extractions WHERE same_bank = 1 GROUP BY 1, 2;
```
