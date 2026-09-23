# Quickstart: receipt-triage

How to prove the feature works, story by story, with the commands a
contributor runs. The shapes are in [contracts/](./contracts/) and
[data-model.md](./data-model.md); the steps to build them are in `tasks.md`.

## Prerequisites

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local      # applies 0036
pnpm --filter @devolada/api sandbox               # apiCEP mock on :8789
pnpm --filter @devolada/api dev                   # API on :8787, AI binding remote
pnpm --filter @devolada/pago dev                  # payment page on :5175
pnpm --filter @devolada/admin dev                 # panel on :5174
curl -X POST localhost:8787/dev/seed              # demo ISP + a link
```

`apps/api/.dev.vars` needs `APICEP_BASE_URL=http://localhost:8789` and any
`APICEP_TOKEN`. The `AI` binding runs against the real Workers AI in
`wrangler dev`, so the reader behaves as in dev.

## The gates, in CI order

```sh
node scripts/spec-lint.mjs            # every new test cites receipt-triage US<n>
node scripts/gen-banks.mjs --check    # the vocabulary is untouched
node scripts/contrast-lint.mjs        # the guide adds no token
node scripts/pending-lint.mjs
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -r --if-present build
```

## Step 0 — measure the reader on the receipts at hand (research R5, R8)

Before any engine work, against the real binding, with the four receipts of
the spec and at least one Spin receipt of each kind (SPEI out, Spin to Spin,
cash-in):

1. Upload each to a dev link and call `/read` with the new prompt.
2. Record, per receipt, what came back for `destino`, `cuentaOrigen` and
   `operacion`, and whether `claveDeRastreo` is null for receipts 1 and 2.
3. Write the table, dated, into the header comment of
   `consta/extraction/reader.ts` (the way the model choice is recorded
   there today). If the reader cannot tell a Spin SPEI transfer from a
   movement inside Spin, the `not_spei` stop ships disabled and the spec's
   Assumptions say so — the rest of the feature does not depend on it.

## User Story 1 — the payer is told exactly what is missing

```sh
pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "receipt-triage US1"
pnpm --filter @devolada/api test -- test/direct-payment.test.ts -t "receipt-triage US1"
pnpm --filter @devolada/pago test -- -t "receipt-triage US1"
```

Expected:

- A stub reading with `claveDeRastreo: null` and `legibilidad: "completa"`:
  `/read` answers `stop: { reason: "key_missing", fields: ["trackingKey"] }`,
  the receipt door throws `RECEIPT_INCOMPLETE`, **no request reaches the
  intercepted provider**, and the reading row's outcome is `key_missing`.
- The same with `legibilidad: "parcial"` or no `legibilidad` at all: no
  stop, one provider call (D7). A malformed clave: no stop (D8).
- A text PDF with no clave in its text: stopped like a picture.
- Page: the ask names the clave, shows Banorte's hint when the reading's
  bank is `BANORTE` and the generic hint otherwise; "Escribir los datos"
  opens the form pre-filled with amount, date and bank; a second keyless
  reading puts the form first.

By hand: upload receipt 1 to the seeded link at 360px and read the screen.

## User Story 2 — the capture guide

```sh
pnpm --filter @devolada/pago test -- -t "receipt-triage US2"
pnpm e2e -- tests/e2e/pago.spec.ts -g "receipt-triage US2"
```

Expected: the component test finds the four numbered fields named in text,
the three rules and the tips trigger, with axe clean; the upload control is
reachable without any other tap. The browser test measures no horizontal
scroll at 360, 768 and 1280px and the guide's contrast in both themes.

## User Story 3 — card and phone

```sh
pnpm --filter @devolada/api test -- test/settings.test.ts -t "receipt-triage US3"
pnpm --filter @devolada/api test -- test/direct-payment.test.ts -t "receipt-triage US3"
pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "receipt-triage US3"
pnpm --filter @devolada/pago test -- -t "receipt-triage US3"
pnpm --filter @devolada/admin test -- -t "receipt-triage US3"
```

Expected:

- Settings: an owner saves a Luhn-valid card with its bank and a 10-digit
  phone with its bank; a failing check digit, a 9-digit phone, a number
  without its bank are refused; an admin gets `FORBIDDEN_FOR_ROLE` and reads
  both masked.
- Link page payload carries `speiCard*` / `speiPhone*` only when set; an ISP
  with a CLABE alone gets today's payload byte for byte.
- Engine: a reading whose destination is `****1234` against a card ending
  1234 sends `beneficiary.cardNumber`; unreadable destination with three
  identifiers sends `potentialBeneficiaries`; the verdict's
  `beneficiaryUsed` says which; receipt 2's `***195` ends the CLABE …8195
  and receipt 3's `•3819` ends its account segment, so both match the CLABE;
  a clear `****9999` matches nothing and throws
  `RECEIPT_WRONG_DESTINATION` with no provider request.
- Lifecycle: the payment stores `beneficiary`; a later attempt uses it even
  after the business changed its card (FR-017); with candidates and no
  known beneficiary, retries stay on the receipt door (D10); a typed
  submission to a two-identifier link without `receivingAccount` is a 400.

By hand, in the sandbox: add a card in Cuenta, open the link, copy the card.

## User Story 4 — Spin

```sh
pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "receipt-triage US4"
pnpm --filter @devolada/api test -- test/direct-payment.test.ts -t "receipt-triage US4"
pnpm --filter @devolada/pago test -- -t "receipt-triage US4"
```

Expected:

- A Spin SPEI reading whose origin shows `728…`: `spinInstitution` is
  `SPIN BY OXXO`; `646…`: `STP`; masked origin: null, and the payment's
  retries never take the transfer door with a Spin bank.
- A clear Spin reading with `operacion: "misma_institucion"` or `"efectivo"`
  and no clave: `stop.reason === "not_spei"`, no provider request; the same
  reading with a clave printed: no stop.
- An `STP` reading from another fintech: behaviour identical to today.
- Page: the Spin message, and the picker note under `SPIN BY OXXO`.

## Regression — what must not move (SC-010, FR-024)

```sh
pnpm --filter @devolada/api test
pnpm --filter @devolada/pago test
```

Every two-eyes-receipt, direct-payment and top-up scenario passes unchanged,
except the ones research R13 names as rewritten, which now cite
`receipt-triage US1`.

## The numbers (FR-023)

After a week of traffic, from the dev or prod database:

```sql
-- captures stopped before a credit, by reason and bank
SELECT outcome, sender_bank, COUNT(*) FROM extractions
WHERE outcome IN ('key_missing','not_spei','wrong_destination')
GROUP BY outcome, sender_bank;

-- payments by the identifier that received them
SELECT json_extract(beneficiary,'$.kind') AS kind, status, COUNT(*)
FROM payments GROUP BY kind, status;
```

How an ask ended is the join from an `extractions.proof_key` (link id as its
prefix) to the next extraction or payment on the same link (research R12).
