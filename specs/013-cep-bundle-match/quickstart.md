# Quickstart: cep-bundle-match

How to prove the feature works, story by story, with the commands a
contributor runs. The shapes are in [contracts/](./contracts/) and
[data-model.md](./data-model.md); the steps to build them are in `tasks.md`.

## Prerequisites

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local      # applies 0040
pnpm --filter @devolada/api sandbox               # apiCEP mock on :8789, now with a several scenario
pnpm --filter @devolada/api dev                   # API on :8787
pnpm --filter @devolada/pago dev                  # payment page on :5175
pnpm --filter @devolada/admin dev                 # panel on :5174
curl -X POST localhost:8787/dev/seed              # demo ISP + links
```

`apps/api/.dev.vars` needs `APICEP_BASE_URL=http://localhost:8789`,
`APICEP_STORAGE_ORIGIN=http://localhost:8789` and any `APICEP_TOKEN`. The
sandbox answers a reference it "shares" with `invalid` +
`banxicoConfirmed: true` and a link to a ZIP of two synthetic CEPs from two
senders (tails 8301 and 4417, credited 07:11:20 and 11:40:47).

## The gates, in CI order

```sh
node scripts/spec-lint.mjs            # every new test cites cep-bundle-match US<n> or its bug
node scripts/gen-banks.mjs --check    # the vocabulary is untouched
node scripts/contrast-lint.mjs        # no token added
node scripts/pending-lint.mjs
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -r --if-present build
```

## Step 0 — the reader against the real CEPs, locally (research R4, R18)

The eight real CEPs stay on the creator's machine, outside every
worktree, in `~/labs/devolada-evidencia/`. Before release, read them
with the shipped reader, in the real runtime, through a dev-only route
(`POST /dev/cep-read`, 404 outside `ENVIRONMENT=dev` like `/dev/seed`):

```sh
E=~/labs/devolada-evidencia
for f in $E/apicep-probe-lote1/E1 $E/apicep-probe-lote1/E6 $E/apicep-probe-lote2/F1; do
  curl -s -X POST localhost:8787/dev/cep-read \
    -H 'content-type: application/zip' --data-binary "@$f.cep-bundle.zip"
done
```

Expected: 8 records, 0 unreadable; per record the clave, the credit day and
time (07:08:21, 07:11:20, 11:40:47; 23:40:49, 23:43:47, 23:48:18;
11:42:13, 11:43:36 — measurement.md), account type `40`, tail `3010`,
amount `300` or `500` cents. The route returns what `parseCadena` returns:
no name, no RFC, and it stores nothing.

## Step 1 — the reader's two new answers, measured before any stub (D15, tasks T015)

With the API on the real `AI` binding (`pnpm --filter @devolada/api dev`)
and the bench marking `time` and `senderTail` (T014), open `/operador` →
Lector. Add real captures — an Azteca receipt that prints seconds and
"Guardadito ***8301", one that prints `HH:MM` only, one with no sender
account — beside the bench's own receipts; read them all with question
version 3; mark every field. Expected: `time` `HH:MM:SS` on the Azteca
capture, `senderTail` `8301`, `null` where no sender account shows, and a
tally with no field worse than version 2. The raw answers become the test
stubs (T016) and a dated table in `extraction/reader.ts`. A field worse in
version 3 stops the work there.

## User Story 1 — a shared reference resolves (P1)

- **Tests**: `pnpm --filter @devolada/api test -- test/cep-bundle-match.test.ts -t "US1"`.
  Expected: a receipt at 07:10:58 with tail 8301 against a ZIP of two CEPs
  confirms with the 8301 clave, `match_trail.by = "tail"`, one
  `validations` row (`reason = 'several'`), one R2 object under
  `bundles/<business_id>/`, the business's action queued; the single `valid`
  credited 07:19:52 against a receipt printed 18:58 does not confirm
  (`CEP_UNDECIDED`, reason `none_fit`); with neither time nor tail a single
  `valid` confirms as today.
- **By hand**: pay a sandbox link with the shared reference and a capture
  showing 07:10:58 and "***8301". The page shows "pago confirmado"; the
  panel's proof dialog shows "Varias coincidencias · resuelta por cuenta",
  two candidates, one "Elegida" and one "Otra cuenta".

## User Story 2 — the same payer twice (P1)

- **Tests**: `-t "US2"`. Expected: receipt 11:43:20 → the 11:43:36 CEP
  (the 11:42:13 one is outside the window); receipt 11:42:05 → the
  11:42:13 CEP (83 s apart, nearest wins); two CEPs credited within 30 s →
  `CEP_UNDECIDED`, reason `too_close`; no time → reason `no_signal`.

## User Story 3 — undecided asks for the clave (P2)

- **Tests**: `-t "US3"`. Expected: every clave used → `CEP_ALL_USED` on the
  status endpoint; no time and no tail with three CEPs → `CEP_UNDECIDED`,
  `next_validation_at` NULL, no further `validations` rows after a sweep
  well past twelve hours, status still `validating`; a superseding row
  with one candidate's clave typed with an O for a 0 confirms with no
  provider call; a clave that fits no candidate makes one ordinary clave
  call.
- **Page**: `pnpm --filter @devolada/pago test -- -t "cep-bundle-match"`:
  both asks render the clave form with their copy, axe clean.
- **Public API**: `pnpm --filter @devolada/api test -- test/collections-api-verify.test.ts`:
  an undecided payment of an API link reads `awaiting:
  "payer_tracking_key"` and its `awaitingReason` on `/v1/payments` (by id
  and by `customerRef`); `/v1/transfers` lists money received only, so it
  carries both as `null` and never lists the undecided payment; every other
  payment reads both as `null` (contracts/public-api.md, clarified
  2026-09-27).

## User Story 4 — other customers' CEPs (P3)

- **Tests**: `-t "US4"`. Expected: a second customer's pending payment
  whose clave is in the first customer's bundle is confirmed by the next
  sweep without a provider call (one `validations` row in total), and its
  own action fires; the other CEP appears in `GET
  /payments/unmatched-transfers` with amount, credit time and tail; the
  payer's endpoints never carry it.
- **Panel**: `pnpm --filter @devolada/admin test -- -t "cep-bundle-match"`:
  the "Sin pago" chip lists the transfer; the undecided row shows its
  reason and opens the candidates.

## Cross-cutting checks

- **FR-015**: a receipt whose reference another payment shares, with a time
  on the capture, reaches the provider (one call); without time or tail it
  is asked for the clave with no call.
- **FR-016**: a clave whose single `valid` the filter refused is later
  validated by clave for its real owner with `cepPreviouslyValidated: true`
  and confirms — not `TRANSFER_ALREADY_USED`.
- **D16**: a bundle link on another origin is never fetched; a failed
  download gives `CEP_BUNDLE_PENDING`, the next slot downloads without a
  provider call, and the third failure gives reason `unreadable`.
- **SC-003**: across every test above, a several answer is followed by no
  second provider call for the same payment.
