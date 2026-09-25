# Data Model: receipt-reader-tuning

**Date**: 2026-09-25 · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

One additive migration, `0037_receipt_reader_tuning.sql`: seven `ADD
COLUMN`s on `extractions`, two new platform tables with their indexes.
Nothing dropped, renamed or rebuilt. Every existing `extractions` row reads
NULL on the new columns — "no model version rather than a guessed one"
(spec edge case). If `0037` is taken between planning and implementation,
the next free number is used and this line is amended.

## Configuration (not stored) — the allowed list (D7)

| Var | Shape | Unset means |
| --- | --- | --- |
| `EXTRACTION_MODEL` | model id (existing) | `DEFAULT_MODEL` in `reader.ts` — the **default** model, today's meaning |
| `EXTRACTION_MODELS` | JSON array of `{ id: string, label: string, input?: object }` | the list is the default alone (today). Invalid → the same, with one warning |
| `READER_TIMEOUT_MS` | integer ms | 8000. A test knob, never set by a deploy (D11) |

Rules: ids are unique; the default is always in the resolved list (prepended
with its id as label when missing); `input` is merged into the model call
(D10). Launch: dev = Mistral Small 3.1 (default) + Gemma 4 26B A4B with
`input: { chat_template_kwargs: { enable_thinking: false } }`; prod =
Mistral Small 3.1 alone.

## `platform_settings` — the choice (D8)

No schema change. The choice is a row of the existing append-only table:

| Column | Value |
| --- | --- |
| `key` | `reader_model` |
| `value` | a model id from the list at the time of writing |
| `author_user_id`, `created_at` | the operator who chose, and when |

Resolution per reading (no cache): the latest `reader_model` row → its id
if it is in the resolved list (**applies**), else the default (**does not
apply**, stale choice); no row → the default (**default**). `reader_model`
is not in the `SETTINGS` registry, so the Reglas tab never lists it (D8).

## `extractions` — what every payer reading now records (D11, D12, D14, D15)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `question_version` | text | yes | `QUESTIONS_VERSION` of the questions this reading answered (`"2"` with this feature's questions; `"1"` only if Story 1 ships before Story 2). NULL on rows before this feature and on rows that read nothing |
| `reader_ms` | integer | yes | How long the reading that counted took, in ms — the fallback's own time on a fallback |
| `fallback_from` | text | yes | The chosen model that failed, when the default read instead (D11). NULL when the chosen model read, or was the default |
| `receiving_bank` | text | yes | The receiving bank as read, resolved to the vocabulary (`Bank`), else NULL |
| `gate_receiving_bank` | text | yes | `ok \| unknown \| missing` — the receiving bank's verdict, as `gate_sender_bank` is the sender's |
| `same_bank` | integer (0/1) | yes | 1 when both banks resolved to the same institution. NULL when either did not resolve (D14) |
| `receiving_bank_tie` | text | yes | `match \| mismatch` — the receiving bank against the bank of the account the destination tied to. NULL when nothing tied or the bank did not resolve |

Unchanged in meaning: `model` — now **the model that produced the reading**
(which it already was, since there was one). `sender_bank` and
`gate_sender_bank` keep what the model said about the sender. **Neither
bank is ever changed because of the other** (FR-012).

Countable after launch, each one query (SC-004, SC-006, SC-007):

- readings per model and question version: `GROUP BY model, question_version`;
- fallbacks of the chosen model: `WHERE fallback_from IS NOT NULL AND model
  IS NOT NULL` — the chosen model failed and the default read; the
  cross-business count constitution V admits since v1.6.0. A row where both
  failed (`model` NULL) is a different fact and is not in this count;
- same-bank readings per ISP and week: `WHERE same_bank = 1 GROUP BY
  business_id, week`;
- receiving-bank disagreements: `WHERE receiving_bank_tie = 'mismatch'`.

## `bench_receipts` — a receipt on the bench (D16)

A platform row: no `business_id`, like `platform_settings` and
`access_requests` (constitution V — it belongs to no business, and only the
platform operator reads it).

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `id` | text (uuid) | no | |
| `proof_key` | text | no | `bench/<uuid>` in `PROOFS` — the bucket's 15-day lifecycle applies |
| `sha256` | text | no | **unique** — the same file twice is one bench receipt |
| `media_type` | text | no | as sniffed by magic bytes (`loadProof`), never as claimed |
| `byte_size` | integer | no | ≤ 1 MB (`PROOF_MAX_BYTES`) |
| `uploaded_by` | text | no | → `user.id` |
| `created_at` | integer (ms) | no | |

The file expires with the bucket rule; the row stays. "File gone" is
learned by a `head` miss and shown as such — never an error for the
readings.

## `bench_readings` — one model's reading of one bench receipt (D16, D17)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `id` | text (uuid) | no | |
| `bench_receipt_id` | text | no | → `bench_receipts.id` |
| `model` | text | no | the model id |
| `model_label` | text | no | its label at the time — the list can change later |
| `question_version` | text | no | `QUESTIONS_VERSION` at the time |
| `status` | text | no | `read \| failed` |
| `failure_code` | text | yes | `READER_UNAVAILABLE \| READER_UNREADABLE \| TIMEOUT` when `failed` |
| `reader_ms` | integer | no | the call's time, success or failure |
| `reading` | text (JSON) | yes | the product-facing reading, when `read`: `{ isReceipt, legibility, trackingKey, referenceNumber, senderBank, receivingBank, amountCents, date, destination: { kind, digits }, sameBank }` — **after** the gate and the vocabulary (D17) |
| `raw_output` | text | yes | the model's answer, verbatim, success or failure |
| `marks` | text (JSON) | yes | `{ [field]: "right" \| "wrong" \| "absent" }` for any subset of the nine fields |
| `marked_by`, `marked_at` | text, integer (ms) | yes | the last marking |
| `created_at` | integer (ms) | no | |

Indexes: **unique** `(bench_receipt_id, model, question_version)` — one
reading per combination; "read again" fills only what is missing.
`(created_at)` for the tally window.

Rules:

- Amounts are integer cents, converted from the model's pesos by
  `amountToCents` (constitution II).
- A `failed` reading has no `reading` and cannot be marked; it counts in the
  tally's failures.
- **Judging a mark** (D17): `right` and `wrong` are taken as marked.
  `absent` becomes right when the reading's value for that field is "not
  shown" (`null`; for `destination`, no digits; for `isReceipt` and
  `legibility`, `absent` is not offered), and wrong otherwise.

## The tally (computed, not stored) (D17)

Per `(model, question_version)`, over bench readings:

| Value | Meaning |
| --- | --- |
| `readings` | readings made |
| `failures` | `status = failed` |
| `judged` | marked fields, over `read` readings |
| `right` | judged fields that came out right |
| `wrongByField` | per field, how many came out wrong |
| `p90Ms` | the reading time within which 9 of 10 `read` readings finished (nearest-rank) — the model call alone (`reader_ms`), not the upload or a PDF's conversion (SC-005) |

With `asOf` — the time of the answer, the date that closes the debt
(FR-020).

## In-memory shapes (engine) (D9, D10, D14)

- **Reader model** `{ id, label, input? }` — one entry of the resolved list.
- **Reader plan** `{ chosen: ReaderModel, fallback: ReaderModel | null }` —
  `fallback` is the default when `chosen` is not the default, else `null`.
- **Reading** gains `receivingBank: string | null` (as read),
  `questionVersion`, `ms`, `fallbackFrom: string | null`; `model` is the
  model that produced it.
- **GatedReading** gains `receiving: { bank: Bank | null, verdict: "ok" |
  "unknown" | "missing", sameBank: boolean }`. `Gate` — what the payer page
  receives — is unchanged.
