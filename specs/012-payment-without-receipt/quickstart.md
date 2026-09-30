# Quickstart: payment-without-receipt

How to prove the feature works, story by story, with the commands a
contributor runs. The shapes are in [contracts/](./contracts/) and
[data-model.md](./data-model.md); the steps to build them are in `tasks.md`.

## Before tasks: two things only the creator can do

1. **Count the pilot's phones** (research R4). In the pilot business's
   WispHub, count customers with no phone and phones held by more than one
   customer. Record the numbers in `research.md`, R4. They say how often an
   assigned number appears, and whether "more than three" is the right line.
2. **Verify Banco Azteca's field** (research R19, D21). In Azteca's app,
   note where a numeric reference is typed when sending, and whether a saved
   contact keeps it. That becomes the first `REFERENCE_HINTS` entry, with
   its source and date.

## Prerequisites

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local      # applies 0041
pnpm --filter @devolada/api sandbox               # apiCEP mock on :8789, with the scenarios below
pnpm --filter @devolada/api dev                   # API on :8787
pnpm --filter @devolada/pago dev                  # payment page on :5175
pnpm --filter @devolada/admin dev                 # panel on :5174
curl -X POST localhost:8787/dev/seed              # demo business (demo@devolada.app / devolada123)
```

`apps/api/.dev.vars`: `APICEP_BASE_URL=http://localhost:8789`,
`APICEP_STORAGE_ORIGIN=http://localhost:8789`, any `APICEP_TOKEN`. A panel
link needs a WispHub connection (`WISPHUB_API_KEY`); without one, walk the
stories on a `/v1` link, whose customer always gets an assigned number.

The sandbox answers a search by reference, by what the reference ends in:

| Reference ends in | Sandbox answer |
| --- | --- |
| `…11` | `valid` on the day asked |
| `…22` | `valid` only on the day before the day asked |
| `…33` | several: two CEPs from one account, 07:11 and 07:13 |
| `…44` | several: two CEPs from two accounts, tails 8301 and 4417 |
| anything else | not found |

## The gates, in CI order

```sh
node scripts/spec-lint.mjs            # every new test cites payment-without-receipt US<n>
node scripts/gen-banks.mjs --check    # the vocabulary is untouched
node scripts/contrast-lint.mjs        # no token added
node scripts/pending-lint.mjs         # the rounds' waiting copy sits inside a <Pending>
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -r --if-present build
```

## Step 0 — turn it on

In the panel, **Ajustes** → "Pagar con referencia" on (owner or admin). Or:

```sh
curl -X PATCH localhost:8787/settings -H 'content-type: application/json' \
  -b cookies.txt -d '{"payByReference":true}'
```

Expected: within a minute, the business's existing links hold references
(the backfill, D5); the Links page shows "Ref. … · celular" or "· asignada".

## User Story 1 — the payer knows their reference

```sh
pnpm --filter @devolada/api test -- test/payer-reference.test.ts
pnpm --filter @devolada/api test -- test/collections-api-links.test.ts -t "payerReference"
pnpm --filter @devolada/admin test -- -t "payment-without-receipt US1"
```

By hand: create a link (panel or `/v1`), open it on the page. Step 1 shows
"Tu referencia" with a copy button, where it goes, and the save-as-contact
tip; the WhatsApp message from the panel carries the number. Expected per
the tests: a phone alone → its last seven; two customers, one phone → the
same number; four → an assigned number each; no phone, `2345678`-like,
starting with 0, or the business's own account tail → assigned.

## User Story 2 — confirm with bank and day

```sh
pnpm --filter @devolada/api test -- test/payment-without-receipt.test.ts -t "US2"
pnpm --filter @devolada/pago test -- -t "payment-without-receipt US2"
```

By hand, on a link whose reference ends in `11`: step 2 → the first-time
question → *Sí* → pick the bank, keep "Hoy" → **Confirmar pago**. Expected:
confirmed within the minute, the action queued, the feed shows "Con su
referencia". On `33`: confirmed with the 07:11 transfer, the 07:13 one
listed as a transfer without a payment. On `22`: "Seguimos buscando", then
confirmed at round 3 (the 8-minute slot) — the neighbouring day.

## User Story 3 — Devolada remembers

```sh
pnpm --filter @devolada/api test -- test/payment-without-receipt.test.ts -t "US3"
pnpm --filter @devolada/api test -- test/consta/match.test.ts -t "own"
```

Expected: after a confirmed payment, the next confirmation preselects that
bank; "Otro banco" lists the business's most used banks first; on `44`,
with the 4417 account learned for this customer, that transfer confirms
with no question; from a new account, the feed shows "Cuenta nueva". No
screen of the page ever shows an account digit.

## User Story 4 — the read-back and the ladder

```sh
pnpm --filter @devolada/api test -- test/payment-without-receipt.test.ts -t "US4"
pnpm --filter @devolada/pago test -- -t "payment-without-receipt US4"
```

The tests move the clock through the slots. Expected on a reference that
is never found: rounds 1–3 ask nothing; after round 3, "Revisa que estos
datos…"; after round 4, the clave with "Sube tu comprobante"; two more
rounds; `expired` — seven calls at most. "Corregir" changing the bank
searches at once; changing nothing spends nothing; a fourth correction is
refused with `CORRECTIONS_EXHAUSTED`.

## User Story 5 — "No puse la referencia"

```sh
pnpm --filter @devolada/api test -- test/payment-without-receipt.test.ts -t "US5"
pnpm --filter @devolada/api test -- test/consta/match.test.ts -t "typed|fitClaveTail"
```

By hand, on `44` typed as the reference: no learned account → the
four-digit field; `8301` → confirmed. Another customer's reference →
`REFERENCE_OF_ANOTHER`. Several that nothing picks → "Escribe los últimos 4
caracteres de tu clave".

## The browser layer

```sh
pnpm e2e -- tests/e2e/pago.spec.ts -g "payment-without-receipt"
```

Measures the new controls at 360, 768 and 1280 with axe: 48px choices,
the 64px **Confirmar pago**, a measured focus ring, both themes, no
horizontal scroll.

## The quota

`/operador` → "Reglas": "Consultas restantes del proveedor: …" after any
search. With the sandbox answering `429`, the page stays on "Seguimos
buscando" and the round count does not move.
