# Research: two-eyes-receipt

**Feature**: 005 · **Date**: 2026-09-17 · **Phase**: 0

Every finding below was read out of the code on this branch, at `fd015ae`.
The spec's ten decisions are taken as settled; this document resolves what
they leave to the plan, and names the two facts that could not be verified
from this environment (R6).

---

## R1 — The provider-first flow lives in the engine's receipt door

**Decision**: `consta/validate.ts`'s receipt branch changes from "read at
the edge, gate, convert to a transfer call" to "read at the edge, refuse
only what D2 refuses, send the file to the provider's image door, classify
on the way back". The verdict carries the classification and the accepted
data (contracts/engine.md). The lifecycle (`direct-payments/validation.ts`,
`credit/topups.ts`) stores them and never compares anything itself.

**Rationale**: the engine already owns every ingredient. It loads the file
(`readProofFromBucket`), reads it (`readProof`), gates it (`gateReading`),
holds the shape rules (`loadShapeRules`, `checkShape`), signs the link the
provider fetches (`signedProofUrl`), calls both doors (`apiCepProvider`),
and already receives the provider's reading on image-door calls
(`verdict.reading`, "survives failure, measured 2026-08-26"). The
lifecycle's `classifyReading` was written for the minute-two cross because
the engine was a separate service then and the product could not reach the
shape rules; that reason left with consta-api-merge. Doing it in the engine
also gives top-ups the flow for free: `validateTopUp` calls the same door
and has no reading code of its own (R9).

**What changes in `validate.ts`**: the `readable` branch no longer builds a
transfer input from the reading. It keeps the reading, keeps the D2
refusals (`RECEIPT_UNREADABLE` for "not a receipt" and "not legible"),
drops `RECEIPT_INCOMPLETE` as a refusal (a hole no longer blocks, FR-005),
and lets `input` stay in receipt mode. After the provider answers, on
`not_found` or on the provider's own unreadable answer (R2), it calls
`compare.ts` and merges the result into the verdict. `providerOcr` keeps its
meaning for the D16 legacy cross and is otherwise unused by the product.

**Alternatives considered**: keeping the comparison in the lifecycle
(rejected: it would need the shape rules and the gate from the engine, and
top-ups would need a copy); a new engine function beside `validate`
(rejected: the paid call and the classification are one act, and a second
door would let a caller spend without classifying).

---

## R2 — The provider's "could not read" is a blind verdict, not a failure

**Decision**: on a provider-first call, apiCEP's `status: "error"` with
`missingFields` (the one OCR failure it names, `apicep.ts` scenario 13) is
mapped inside the engine to a verdict `status: "invalid", reason:
"not_found"` with `readingCheck: "blind"` and `blindSide: "provider"`. The
billed-call row is still written with `status: null` and its telemetry
exactly as today (validation spec D15). The `RECEIPT_UNREADABLE` failure
keeps existing for the legacy `providerOcr` cross.

**Rationale**: today that answer throws, the lifecycle records the code and
rides the schedule, and nothing learns that the provider was blind. The spec
(FR-009, FR-013) makes provider-blind a classified outcome: our reading, if
complete, goes through the transfer door next; if not, the payer is asked.
A verdict the lifecycle already knows how to handle (`not_found` rides the
schedule) with a classification attached is the smallest change that gets
there. Semantically it is honest: the provider found nothing, because it
read nothing.

**Alternatives considered**: attaching the classification to the thrown
`ConstaError` (rejected: the lifecycle's catch path handles every failure
alike and would need a special case); a new verdict status (rejected: every
caller and the page switch on the three statuses).

---

## R3 — The shape rules judge both claves, and decide only when they can

**Decision**: `compare.ts` computes, from our gated reading and the
provider's reading:

| Ours (passed the gate) | Provider's | Clave + amount | Result | Accepted data |
| --- | --- | --- | --- | --- |
| present | present | equal | `agreed` | the agreed fields (`acceptedFrom: agreed`) |
| present | present | differ, our clave fits the bank's shape and theirs does not | `disputed` | ours (`reader`) |
| present | present | differ, theirs fits and ours does not | `disputed` | theirs (`provider`) |
| present | present | differ, no rule / both fit / neither fits | `disputed` | none → ask the payer for the differing fields |
| present, complete | no clave | — | `blind`, `blindSide: provider` | ours (`reader`) |
| incomplete | no clave | — | `blind`, `blindSide: both` | none → ask the payer for the missing fields |
| empty | present | — | `blind`, `blindSide: reader` | theirs if the shape fits or there is no rule (`provider`); none if it mismatches → ask |

"Present" for ours means the field passed the gate (`gate.trackingKey ===
"ok"`, `gate.amount === "ok"`); a malformed or missing field on our side is
"empty" for that field and raises no dispute (D5). The provider's bank name
is resolved through `resolveBank` before `checkShape`; an unresolvable bank
gives shape `unknown`, which counts as "no rule". The amount comparison is
integer cents equality, as `classifyReading` does today. A bank-name or date
difference never disputes (reading-check D2, kept). The date in the accepted
data comes from whichever reading has one; when neither has one, the
accepted data is incomplete and the payer is asked for the date (spec edge
case).

**Rationale**: the table is the spec's D5–D8 written as one function.
`checkShape` already takes `(rules, bank, clave)` and returns `ok |
mismatch | unknown`; calling it twice is the whole change. Cold start
(`GRADUATION_SAMPLES = 10` per bank, uniform length) means `unknown` for
most banks at first, which lands in "ask the payer" as the spec intends.

**Alternatives considered**: a third paid call as the tiebreak (out of
scope by the spec); treating `unknown` as a fit (rejected: it would accept
a clave nothing vouched for).

---

## R4 — The next door is chosen from the row, not from `proof_mode`

**Decision**: the lifecycle stores the accepted data on the payment
(`tracking_key`, `sender_bank`, `transfer_date`, `claimed_amount_cents`,
plus `accepted_from`) and builds the next request as a transfer call when
the row holds a clave, a bank and an amount, and as a receipt call
otherwise. `proof_mode` keeps meaning what the payer submitted (`receipt` =
a file, `transfer` = a form), which is what the admin feed shows
(`FeedScreen.tsx`) and what `releaseEvidenceFor` reads for `human`.

**Rationale**: today `proof_mode` decides the door and the row's key fields
are empty until the CEP adopts them. Flipping `proof_mode` to `transfer`
after an agreement would lie to the feed and to the `human` evidence rule
(`proofMode === "transfer" && !proofKey`). Reading the door from the
accepted fields keeps every existing meaning and makes the agreed retry the
same code path a typed correction takes (D6, D17). The CEP-adoption write at
`valid` (reading-check D7) already handles a row whose stored key was a
misread the CEP corrected; it extends to `accepted_from = provider` rows
unchanged.

**Alternatives considered**: a new `retry_door` column (rejected: derivable
from the fields, and a column that can disagree with them).

---

## R5 — The pay request answers before the provider does

**Decision**: `pay` in `routes/direct-payments/handler.ts` inserts the row
(already born owned by the sweep, `next_validation_at = +2 min`) and hands
`runValidation` to `c.executionCtx.waitUntil(...)`. The response is `201
{ status: "validating" }` (or `queued_for_credit` as today). A test passes a
real execution context from `cloudflare:test` and awaits it after asserting
the response. When no execution context exists (a caller outside a Worker
request), the handler awaits inline, so nothing is ever dropped.

**Rationale**: the row's comment already records the rule the spec asks for
("the inline attempt is an optimisation, not the mechanism: if it never
finishes … the payment is still due at its first slot", found live
2026-08-18). `waitUntil` keeps the inline attempt alive past the response;
if the isolate dies, the +2 slot runs it. The page already polls
(`POLL_MS`) and already handles a `validating` answer; the inline
`confirmed` it could receive today becomes a `confirmed` it reads on the
first poll.

**Consequence on the page (D13)**: the silent path today sends `transfer`
built from the reading; after this feature a machine reading travels as
`proofId` alone (plus `receiptStatus` and `receiptAmountCents`, unchanged),
so the row is born `proof_mode = receipt` and the engine reads and goes
provider-first. `transfer` is sent only from a form the payer edited: the
disputed-field form, the escalated form, the manual door. The above-debt
confirmation (claimed-amount D2) becomes two actions: "Enviar así" sends
`proofId`; "Corregir" opens the form. The `supersedes` rule
(`supersedes only applies to a confirmed transfer`) is unchanged: a
re-upload is a new attempt by definition.

**The time budget, stated**: the platform bounds work handed to
`waitUntil` after the response (30 s by the published rule — verify on the
docs page when T031 lands and write the number into the handler's comment).
The worst case inside that window is the provider's 25 s deadline plus a
reused reading (no model call, D14) plus the D1 writes; the typical case is
6–10 s. When the window is exceeded the verdict is lost, and the design
already survives that: `validation_attempts` is written before the call
(the 2026-08-18 rule), so the retry at +2 min is the payment's own and the
replay carve-out applies (FR-021). T032 asserts a deferred attempt that
dies leaves the row due at its slot.

**Alternatives considered**: the sweep alone, no inline attempt (rejected:
+2 min for every payer, where today's fast majority confirms in seconds);
a queue (rejected: a new binding for what `waitUntil` already does).

---

## R6 — A PDF becomes text through the binding, then a text reading

**Decision**: `extraction/pdf-text.ts` wraps `env.AI.toMarkdown({ name,
blob })` and returns the `data` string of a `format: "markdown"` result, or
`null` on any other outcome (an `error` result, a thrown call, a binding
without the method, an empty string). `extraction/index.ts` routes a PDF to
it and, with text, calls `readProof` in text mode; without text the reading
is empty and the route continues (D15). The extraction row records
`source: reader`, `media_type: application/pdf`, and the PDF-specific
outcome when nothing was read. `readProof` gains a text variant of the
prompt ("This is the text extracted from a Mexican bank transfer receipt
PDF…") and sends a plain text message instead of an image part; the model
is the same var.

**Verified here**: the installed `@cloudflare/workers-types@4.20260702.1`
declares `Ai.toMarkdown(files: MarkdownDocument[] | MarkdownDocument,
options?) → ConversionResponse[] | ConversionResponse` with
`ConversionResponse = { name, mimeType, format: "markdown", tokens, data }
| { name, mimeType, format: "error", error }`; the changelog example converts
a PDF to markdown with page contents. The API's `tsconfig` uses these types,
so the call compiles as is.

**Not verified here** (egress to the docs was blocked; the assumption is
named in the spec): whether PDF conversion is free of charge — the
changelog's PDF example reports `tokens: 0`, and the recalled rule is that
document conversion is free while image conversion bills a vision model —
and whether scanned pages are OCR'd (recalled: not). Both are checked in
quickstart step 3 against the real binding, and the answer is written into
`pdf-text.ts`'s header comment with the date, as a measured fact.

**Read 2026-09-18, from the Cloudflare docs MCP index** (the docs site itself
is still blocked to this environment, so the feature page could not be opened;
these are the changelog entries the index does carry):

- *Pricing, partial.* The launch entry (2025-03-20, "Markdown conversion in
  Workers AI") converts a PDF and an image in one call and says "Workers AI
  models are used automatically to detect and summarize **the image**" — the
  models are named for the image, not for the PDF, and the same entry's PDF
  result is the `tokens: 0` this document already cites. The GIF/BMP entry
  (2026-07-08) describes the image path in full: each image is "passed to an
  object-detection model", whose output "prompt[s] a vision model that writes
  a natural-language description". So an *image* conversion runs two models
  and bills; a *PDF* conversion is not described as running any. This
  supports the recalled rule but does not confirm it — the pricing page was
  not reachable.
- *Scanned pages.* Nothing in the reachable entries says whether an
  image-only PDF page is OCR'd. Unresolved.

**Still to measure against the real binding** (quickstart step 3): this
environment has no `wrangler login` and no sample receipts, so the
`/dev/pdf-text` run could not be made. The design does not wait on it — D15
makes an empty conversion a silent fall-through either way, and
`pdf-text.ts` returns null on every failure — but the two numbers stay open:
the `tokens` a real receipt PDF reports, and whether a scanned PDF yields
text. Run it on a machine with a Cloudflare login before the feature reaches
prod and write the answers into `extraction/pdf-text.ts`'s header, which
carries them today as open questions, not as measured facts.

**Alternatives considered**: rendering the PDF to an image in the browser
(set aside by the creator, spec Clarifications); a PDF text library in the
Worker (rejected: a dependency for what the binding already does).

---

## R7 — Legibility is one more field the model answers

**Decision**: the vision prompt asks for `"legibilidad": "completa" |
"parcial" | "nula"` beside `esComprobante`, with rules: "nula" only when no
field on the receipt can be read at all; "parcial" when the receipt is
readable but at least one requested field is blurred, cut off or hidden;
"completa" otherwise. `Reading` gains `legibility: "full" | "partial" |
"none" | null` (null when the model omitted it, treated as "full"). The
gate's pre-spend refusal is `!isReceipt || legibility === "none"`; anything
else passes to the provider (FR-004, FR-005). The text variant never sets
`none` (D15).

**Rationale**: the model already answers `esComprobante` reliably (five of
five on a dark screenshot, 2026-08-19); a second yes-or-no on the same
picture costs nothing extra. Biasing toward "let it through" is the spec's
own assumption: a wrongly blocked photo costs the payer a step, a wrongly
passed one costs a credit the comparison may still salvage. The quickstart
measures the new field on the receipts at hand before the default is
trusted.

**Alternatives considered**: an image-quality heuristic at the edge
(rejected: a blurry receipt and a crisp screenshot of nothing look alike to
a pixel statistic; the question is semantic).

---

## R8 — The paid attempt reuses the draft's reading

**Decision**: before calling the model, the engine's receipt door looks up
the most recent `extractions` row for the same owner, same `proof_sha256`,
`source = reader`, younger than `PROOF_URL_TTL_MINUTES` (15), with a stored
reading, and rebuilds `Reading` from it; otherwise it reads. The `/read`
door itself never reuses (a payer re-reading their receipt is the flow
working, and the row is the measurement).

**Rationale**: today one Workers AI call serves a receipt: `/read` reads,
and the pay travels as transfer data. Under D13 the pay carries only the
file, so without reuse the engine would read the same file twice, ~2.7 s
each. The row already holds everything `Reading` needs (clave, bank,
amount, date, status, model) plus the new legibility; the hash is computed
on load anyway. Trust is server-side: the client names a `proofId`, never a
reading, and the match is on the owner and the bytes.

**Alternatives considered**: sending the draft back in the pay body
(rejected: a client-supplied reading deciding what is compared, which D18
of direct-payment forbids for money and which is one more thing to
validate); reading twice (rejected: doubles the reader's cost and latency for
nothing).

---

## R9 — Top-ups take the same door, with no human to ask

**Decision**: `validateTopUp` builds a receipt request as today and stores
what the verdict accepted (`tracking_key`, `sender_bank`, `transfer_date`;
`claimed_cents` already exists) so its next attempt takes the transfer door
by the same rule as a payment (D17). A top-up whose readings cannot be
decided keeps riding the receipt door on every slot, exactly as every
receipt top-up does today. Classification is recorded on the extraction row
(D19), which is where every count reads it from. The lifecycle also writes
the three-word verdict to `top_ups.reading_check`, a column that predates
this feature: it costs nothing, it keeps a top-up row as self-describing as
a payment row, and no query depends on it (amended 2026-09-18, analyze F6).

**Rationale**: the engine does the work; the top-up lifecycle only has to
store three fields it already has columns for. There is no operator-facing
form for a disputed top-up and the spec adds none; the receipt door is
today's behaviour and costs nothing new. The same holds for a top-up the
reader refuses as "not a receipt" or "not legible": it rides the schedule
with one reader call per slot and no provider credit, exactly as a
not-a-receipt top-up does today; the operator's remedy is a new upload.

---

## R10 — Payments born before the cut-over are identifiable without a column

**Decision**: the minute-two cross (`crossCheck` in `validation.ts`) keeps
running for rows with `proof_mode = 'transfer' AND proof_key IS NOT NULL
AND supersedes_id IS NULL AND reading_check IS NULL`, which after D13 no
new row can have: a machine reading is born `receipt`; a typed correction
is born with `supersedes_id`; the manual door has no `proof_key`. New rows
never enter that branch, and it dies with the last legacy row within the
12-hour late slot. Its removal is registered as debt
(`legacy-minute-two-cross`) at implementation so it is not forgotten.

**Rationale**: FR-020 wants two flows to never mix on one row and wants
no reprocessing; the shape test does both with no migration. A `flow`
column would outlive its only reader by design.

---

## R11 — One table carries the measurement

**Decision**: `extractions` gains `legibility`, `reading_check`,
`disputed_fields`, `blind_side`, `accepted_from`, `provider_tracking_key`,
`provider_amount_cents`; the row for a provider-first call links to its
`validation_id` as today. `payments` gains `reading_check_attempt`,
`blind_side` and `accepted_from` beside its existing `reading_check` and
`disputed_fields` (which the page reads). `top_ups` gains nothing but the
accepted fields it already has. Every FR-018 count is one `GROUP BY` over
`extractions` (data-model.md lists them).

**Rationale**: the reading record already exists for both owners and
already answers "what did the reader see"; adding "what did the provider
see" and "what did we decide" beside it makes the comparison auditable
row by row, and keeps top-ups countable without a payment row.

---

## R12 — What the tests assert today, and what they will assert

**Engine (`test/consta/validate.test.ts`, "validate — receipt door")**:
the scenarios that assert the image becomes a transfer call ("a reading
that passes the gate buys a direct-mode lookup", the `sender` captured
assertions), the `RECEIPT_INCOMPLETE` refusals, and "a PDF keeps the
provider's OCR door, untouched" are rewritten: the file goes to the image
door, `sender` is undefined, the verdict carries the classification, and a
PDF with text is a reader row. Eight new scenarios cover the table in R3
plus the reuse (R8) and the legibility refusal (R7). All cite
`two-eyes-receipt US1`, `US2` or `US3`.

**Lifecycle (`test/direct-payment.test.ts`)**: "US-D02 submitting proof"
inline-attempt assertions that expect `confirmed` on the POST expect
`validating` and then `confirmed` after `waitOnExecutionContext`; "US-D14
the classifier at minute two" keeps its scenarios for D16 rows (seeded with
the legacy shape) and gains a sibling describe for the first-call
classification, the door of the next attempt, and the agreed-at-minute-zero
release evidence. Cite `two-eyes-receipt US1`, `US4`.

**Payer page (`test/pago.test.tsx`)**: scenario 43 ("a reading that passes
the gate is submitted silently") asserts `proofId` alone travels; 44 ("the
payer overrides…") stays as the corrected-form path; 45 ("an image that is
not a receipt is caught here") asserts the new refusal message and no pay;
"a receipt claiming more than the debt is informed" asserts the two
actions; one new scenario each for "not legible" and "partially legible
goes through". Cite `two-eyes-receipt US2`, `US4`.

**Top-ups (`test/prepaid-credit.test.ts`)**: one scenario for a receipt
top-up through the image door and its transfer-door retry after agreement.
Cite `two-eyes-receipt US1`.

**Retired by name**: engine "US-V02 scenario 2: a PDF keeps the provider's
OCR door, untouched"; engine "scenario 3: routing follows magic bytes"
keeps its magic-byte assertion but its expectation changes from
`provider-ocr` to a reader row with `application/pdf`.
