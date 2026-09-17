# Quickstart: two-eyes-receipt

How to prove the feature works, story by story, with the commands a
contributor runs. Implementation detail lives in `tasks.md`; the shapes are
in `contracts/` and `data-model.md`.

## Prerequisites

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local      # applies 0029
pnpm --filter @devolada/api sandbox               # apiCEP mock on :8789 (for the manual runs)
pnpm --filter @devolada/api dev                   # API on :8787, AI binding remote
pnpm --filter @devolada/pago dev                  # payment page on :5175
curl -X POST localhost:8787/dev/seed              # demo ISP + a link
```

The `AI` binding in `wrangler dev` runs against the real Workers AI, so the
reader and the PDF conversion behave as in dev. The provider is the
sandbox; set `APICEP_BASE_URL=http://localhost:8789` and any `APICEP_TOKEN`
in `apps/api/.dev.vars`.

## The gates, in CI order

```sh
node scripts/spec-lint.mjs            # every new test cites two-eyes-receipt US<n>
node scripts/gen-banks.mjs --check
node scripts/contrast-lint.mjs
node scripts/pending-lint.mjs
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -r --if-present build
```

## Step 3 — verify the two unverified facts first (research R6)

Before any engine work, against the real binding:

1. Upload a text PDF receipt to a dev link, call `/read`, and confirm the
   draft carries the clave, bank, amount and date. Note the `tokens` field
   of the conversion in the Worker log.
2. Upload a scanned (image-only) PDF and confirm `/read` answers
   `source: "provider-ocr"` with every field null and no error.
3. Read the Markdown Conversion page of the Workers AI docs for the pricing
   rule and the scanned-page behaviour, and write both, with the date, into
   the header comment of `extraction/pdf-text.ts`.

If PDF conversion turns out to bill, it is a cost fact for the spec's
Assumptions, not a blocker: the flow is the same and the number is recorded.

## User Story 1 — the first paid call carries two readings

```sh
pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "two-eyes-receipt US1"
pnpm --filter @devolada/api test -- test/direct-payment.test.ts -t "two-eyes-receipt US1"
```

Expected: the receipt-door scenarios capture a provider body with
`imageUrl` and no `sender`; on `not_found` the verdict carries
`readingCheck`, `accepted`, `acceptedFrom` per the table in
`contracts/engine.md`; the lifecycle writes them on the row; the next
sweep's captured body is a `sender` call exactly when `accepted` was set,
at the next slot and never inline; a `blind` provider answer with a
complete reading of ours becomes a transfer call at the next slot; a dispute
with no rule leaves `disputedFields` on the row and spends nothing more;
`releaseEvidenceFor` answers `agreed` on the first call.

Manual: upload a receipt whose sandbox answer is `not_found` with an
`extracted` reading equal to what the reader saw; watch the row reach
`reading_check = agreed`, `accepted_from = agreed`, and the next attempt
(two minutes later) go through the transfer door in the API log.

## User Story 2 — a bad photo never costs a credit

```sh
pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "two-eyes-receipt US2"
pnpm --filter @devolada/pago test -- -t "two-eyes-receipt US2"
```

Expected: a stubbed reading with `esComprobante: false` or `legibilidad:
"nula"` throws `RECEIPT_UNREADABLE`, writes one extraction row with outcome
`not_a_receipt` or `illegible` and no `validation_id`, and the provider
mock records zero calls; `legibilidad: "parcial"` or a missing field goes to
the provider. On the page: the refusal message renders, the picker stays,
no `/pay` request is made; a partial reading pays with `proofId` alone.

Measure before trusting the default (research R7): run the reader on the
receipts at hand — the 30 from 2026-08-19 and any new ones — and record how
many `nula` verdicts land on a receipt a human can read. The number goes in
`reader.ts`'s header with the date.

## User Story 3 — a PDF gets the same reading and protections

```sh
pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "two-eyes-receipt US3"
```

Expected: a `%PDF` fixture whose stubbed `toMarkdown` returns receipt text
produces a reader row (`source = reader`, `media_type = application/pdf`)
with the same gate fields as a picture; the same fixture with an empty
conversion produces an empty reading, no refusal, and a provider-first call;
a PDF served as `image/png` still takes the PDF route; a top-up PDF takes
the same path under the platform owner.

Manual: the two uploads from step 3, then `/pay`, then watch the sandbox log
show the image door.

## User Story 4 — the payer never waits on the paid call

```sh
pnpm --filter @devolada/api test -- test/direct-payment.test.ts -t "two-eyes-receipt US4"
pnpm --filter @devolada/pago test -- -t "two-eyes-receipt US4"
```

Expected: with the provider mock delayed, `POST …/pay` answers `201
validating` before the mock resolves; `waitOnExecutionContext` then finds
the row confirmed; with no execution context the handler still finishes the
attempt. On the page: "Verificando" renders on the POST's answer and the
outcome arrives on a poll.

Manual: set `APICEP_DEADLINE_MS=20000` and make the sandbox sleep 10 s;
submit; the page shows "Verificando" at once.

## User Story 5 — the numbers become visible

```sh
pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "two-eyes-receipt US5"
```

Expected: after the US1 and US2 scenarios, the queries in `data-model.md`
return the agreed / disputed / blind counts with `reading_check_attempt`
distinguishing first calls from legacy crosses, the "provider blind while
we read fully" count, and refusals with zero `validation_id`.

Manual, on dev after a week: run the same queries through the D1 console
and read the ratio the spec's D10 asks for.

## Cut-over check (FR-020)

Seed a row with the legacy shape (`proof_mode = transfer`, `proof_key`
set, `supersedes_id` null, `reading_check` null, `validation_attempts = 1`,
`last_error = TRANSFER_NOT_FOUND`) and run the sweep: it takes the
minute-two cross with `providerOcr`, exactly as `US-D14` scenarios assert
today, and writes `reading_check_attempt = 2`. A row born through the new
`/pay` never matches that shape.

## Local development, after

Nothing new to configure. A missing `AI` binding degrades to a
provider-first call with no reading of ours and the page never blocks; a
missing `APICEP_TOKEN` keeps saying the channel is unavailable.
