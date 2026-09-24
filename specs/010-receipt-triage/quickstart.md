# Quickstart: receipt-triage

> **Story 3 rescoped 2026-09-24 — this file is behind the spec.** The ISP now
> chooses one *cuenta de cobro*, the only account the payment page shows;
> the CLABE is no longer required; a receipt's destination is checked by its
> last four digits; a transfer to another account registered at submission
> is checked against that account (spec D9, D10, Story 3, FR-016–FR-021).
> Everything here about showing several accounts, the account choice on the
> form (`receivingAccount`), the candidate list (`potentialBeneficiaries`,
> `beneficiary_candidates`, D23), three visible digits, or the CLABE staying
> required is superseded until the plan is redone for Story 3.

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
`wrangler dev`, so the reader behaves as in dev. The sandbox gains a
reference it "finds", a reference it answers 422 for, and acceptance of card,
phone and account-list bodies.

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

## Step 0 — measure the reader on the receipts at hand (research R2, R14)

Before any engine work, against the real binding, with receipts 1 and 2 of
the spec and any other captures the product creator supplies:

1. Upload each to a dev link and call `/read` with the new prompt.
2. Record, per receipt, `claveDeRastreo`, `referenciaNumerica`, `destino` and
   `legibilidad`. Expected: receipt 1 — both keys null, `completa`,
   destination `clabe` / `8195`; receipt 2 — reference `038195` (leading zero
   kept), clave null, destination digits `195`.
3. Write the table, dated, into the header comment of
   `consta/extraction/reader.ts`, the way the model choice is recorded there.
   If the reader takes a folio for a reference, or misreads destination
   digits, the prompt is tightened before the gate is relied on.

## User Story 1 — the referencia numérica

```sh
pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "receipt-triage US1"
pnpm --filter @devolada/api test -- test/direct-payment.test.ts -t "receipt-triage US1"
pnpm --filter @devolada/pago test -- -t "receipt-triage US1"
```

Expected:

- Comparison (pure): no clave on either side, equal references → `agreed`,
  `accepted.referenceNumber` set; different → `disputed: ["referenceNumber"]`;
  a clave on either side → today's result, the reference riding along.
- Engine: an accepted row with a reference and no clave sends
  `sender.referenceNumber` and no `trackingKey` to the intercepted provider;
  with both, only `trackingKey` travels.
- Gate: `038195` passes; `0082918812` (ten digits) is `malformed`, never sent;
  `0000`, `1234567` and `1` are `generic` — no key, so a clear capture showing
  only one is asked about before any credit; a typed `1234567` without a
  clave is a `VALIDATION_ERROR`.
- Lifecycle: a typed submission with only a reference is accepted; Banxico
  confirms and the row now carries the CEP's clave; a second submission whose
  search returns that clave ends `invalid` with `TRANSFER_ALREADY_USED`.
- Lifecycle: the provider answers 422 `provide_tracking_key` → the row has
  `disputed_fields = ["trackingKey"]`, `last_error = REFERENCE_AMBIGUOUS`, and
  the next slot makes **no** provider request.
- Page: the manual form accepts a reference alone and refuses both empty.

- **The first real confirmation by reference** (spec FR-006, amended
  2026-09-24): once a payment found by its reference alone confirms on dev,
  read its row — `tracking_key` MUST hold Banxico's clave. If it is empty,
  the guard fired: find the "unexpected" record, and take the provider's raw
  answer to apiCEP before relying on the reference door in prod.

## User Story 2 — the missing-data feedback

```sh
pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "receipt-triage US2"
pnpm --filter @devolada/api test -- test/direct-payment.test.ts -t "receipt-triage US2"
pnpm --filter @devolada/pago test -- -t "receipt-triage US2"
```

Expected:

- A stub reading with both keys null and `legibilidad: "completa"`: `/read`
  answers `ask: { reason: "no_key", fields: ["key"] }`; the receipt door
  throws `RECEIPT_INCOMPLETE`; **no request reaches the intercepted
  provider**; the reading row's outcome is `key_missing`. With the date null
  too: `fields: ["key", "date"]`.
- The same with `legibilidad: "parcial"`, with no `legibilidad`, or with a
  malformed clave: no ask, one provider call. With a reference only: no ask.
- A text PDF with neither key: asked like a picture.
- Page: the `Alert` names the key and only the other missing fields, shows
  Banorte's hint when the reading's bank is `BANORTE` and the general one
  otherwise, and has focus; "Escribir los datos" opens the form pre-filled,
  with "No aparece en tu captura" under each empty field; a second ask in the
  same visit puts the form first; axe is clean on every state.
- Page: the later asks name `referenceNumber` and the `REFERENCE_AMBIGUOUS`
  case in their own words.

By hand: upload receipt 1 to the seeded link at 360px and read the screen.

## User Story 3 — the card and the phone

```sh
pnpm --filter @devolada/api test -- test/settings.test.ts -t "receipt-triage US3"
pnpm --filter @devolada/api test -- test/consta/validate.test.ts -t "receipt-triage US3"
pnpm --filter @devolada/api test -- test/direct-payment.test.ts -t "receipt-triage US3"
pnpm --filter @devolada/pago test -- -t "receipt-triage US3"
pnpm --filter @devolada/admin test -- -t "receipt-triage US3"
```

Expected:

- Settings: the owner saves a Luhn-valid card with its bank and a 10-digit
  phone with its bank; a failing check digit, a 9-digit phone, a number
  without its bank are refused; an admin gets `FORBIDDEN_FOR_ROLE` on either;
  an operator reads both masked.
- Link payload carries `speiCard*` / `speiPhone*` only when set; an ISP with a
  CLABE alone gets today's payload, field for field.
- Engine: a reading whose destination is `tarjeta` / `1234` against a card
  ending 1234 sends `beneficiary.cardNumber`; unreadable destination with
  three accounts sends `potentialBeneficiaries`; `beneficiaryUsed` says which.
  Receipt 2's `***195` ends the CLABE …8195 and receipt 3's `•3819` ends its
  account segment, so both tie to the CLABE; a clear `****9999` ties to
  nothing and throws `RECEIPT_WRONG_DESTINATION` with no provider request.
- Lifecycle: the payment stores `beneficiary`; a later attempt uses it even
  after the ISP changed its card (FR-021); with candidates and no known
  account, retries stay on the receipt door with the list (D23); a typed
  submission to a link with more than one account and no `receivingAccount`
  is a 400.
- Page: the transfer step lists the card and the phone, copyable; the form
  offers the account choice, pre-selecting the tied account from a reading.

By hand, with the sandbox: add a card in Cuenta, open the link, copy the card.

## User Story 4 — the capture guide

```sh
pnpm --filter @devolada/pago test -- -t "receipt-triage US4"
pnpm e2e -- tests/e2e/pago.spec.ts -g "receipt-triage US4"
```

Expected: the component test finds the four numbered items named in text,
the three rules and the tips trigger, with axe clean, and the upload control
reachable without any other tap. The browser test measures no horizontal
scroll at 360, 768 and 1280px and the guide's contrast in both themes.

## Regression — what must not move (SC-012, FR-029)

```sh
pnpm --filter @devolada/api test
pnpm --filter @devolada/pago test
pnpm --filter @devolada/admin test
```

Every two-eyes-receipt, direct-payment, settings and top-up scenario passes
unchanged, except the ones research R17 names as rewritten, which now cite
`receipt-triage US2`.

## The numbers (FR-028)

After a week of traffic, from the dev or prod database:

```sql
-- captures stopped before a credit, by reason and bank
SELECT outcome, sender_bank, COUNT(*) FROM extractions
WHERE outcome IN ('key_missing', 'wrong_destination')
GROUP BY outcome, sender_bank;

-- searches by reference alone, and how they ended
SELECT status, reason, provider_http_status, COUNT(*) FROM validations
WHERE reference_number IS NOT NULL AND tracking_key IS NULL
GROUP BY status, reason, provider_http_status;

-- payments by the account that received them
SELECT json_extract(beneficiary, '$.kind') AS kind, status, COUNT(*)
FROM payments GROUP BY kind, status;
```

How an ask ended is the join from `extractions.proof_key` (the link id is its
prefix) to the next extraction or payment on the same link (research R11).
