# Quickstart: bank-statement-match

How to see each phase work, and the gates it must pass. It points at the
contracts and the data model instead of repeating them.

## Prerequisites

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local
pnpm --filter @devolada/api sandbox           # apiCEP mock on 8789 — Phase A never calls it
pnpm --filter @devolada/api dev               # 8787, with APICEP_BASE_URL=http://localhost:8789
pnpm --filter @devolada/admin dev             # 5174
pnpm --filter @devolada/pago dev              # 5175
curl -X POST localhost:8787/dev/seed          # demo@devolada.app / devolada123
```

In the panel, **Cuenta** (`/settings`): give the demo business a CLABE,
pick **BBVA MEXICO** as its bank, and choose it under "¿Dónde quieres que
te paguen tus clientes?". To see the release, connect WispHub with
`WISPHUB_API_KEY` and turn on the provisional reconnection in
**Integraciones**.

## Phase A — the same-bank payment (User Story 4 without a file)

1. Open a customer's link on the payer's page, tap **Ya hice mi
   transferencia**, choose **BBVA MEXICO** and today, and confirm.
   - The page reads "Seguimos buscando tu transferencia." and nothing
     else about how (contracts/payment-page.md).
   - The API log shows no apiCEP request.
   - With the release on: the customer is reconnected and the invoice is
     still open in WispHub.
2. In the panel, **Pagos** shows the strip "1 pago espera que lo confirmes
   en tu banco". **Verlos** opens the chip **Por confirmar en tu banco**,
   and the row wears "Por confirmar".
3. Move the clock past six hours (or run the sweep twice with the row's
   `created_at` set back): the row is still waiting, not expired.
4. **Sí, llegó** → confirm. The row becomes confirmed with its folio,
   "Confirmado a mano por {nombre}", and the action (or the observation)
   as the business's mode says. The payer's page shows the confirmed view.
   One validation fee is debited.
5. Repeat with a second payment and **No llegó** → confirm. The row shows
   "No llegó". The payer's page shows "No pudimos confirmar tu
   transferencia a tiempo…". No fee. If it had been released, the
   customer's next payment is not released for 90 days.
6. Receipt: upload a capture whose reading shows BBVA on both sides. The
   page asks "¿Desde qué banco pagaste?" before it submits; answer BBVA and
   the payment waits as in step 1.

**Tests** (each file cites `bank-statement-match US4`):

```sh
pnpm --filter @devolada/api test -- test/bank-statement-match.test.ts
pnpm --filter @devolada/admin test -- -t "bank-statement-match"
pnpm --filter @devolada/pago test -- test/bank-statement-match.test.tsx
pnpm --filter @devolada/ui test -- -t "awaitingBank"
```

What the API suite proves, in workerd with a real D1 (constitution IV):
- recognition with `fetchMock` asserting **no** apiCEP call, for a CLABE,
  a card and a phone collection account;
- recognition before the provider checks (no `APICEP_TOKEN`);
- the wait survives the sweep past every D7 slot;
- the release is evaluated once, with evidence `human` and today's promise
  date (WispHub intercepted at its pinned origin);
- `bank-check` received on a panel link (D14's re-check, the folio, the
  action, the fee) and on an API link (the verdict webhook);
- `bank-check` not received (`expired` + `NOT_RECEIVED`, no fee, a burned
  ride only when released);
- `409 NOT_AWAITING_BANK` on a second decision, `404` across businesses,
  `503 INTEGRATION_UNAVAILABLE` leaving the row waiting;
- `awaiting=bank` and the count, filtered by business.

## Phase B — the statement's core

With synthetic credits (no bank reader yet), the core's tests cover
identity and dedupe (R13), the match order (R14), "no llegó" by a
statement covering the day, "abonos sin cliente" and assignment, and the
import report. They cite `bank-statement-match US1`, `US2`, `US3` and
`US4`.

## Phase C — a bank's reader

Only after a real file arrives (D16):
1. Save it anonymized as a fixture under
   `apps/api/test/fixtures/statements/` (names, accounts and claves
   replaced, amounts and dates kept).
2. Write the reader to that fixture. Test that it reads every credit,
   skips the rest, and that its counts match the file.
3. Upload it in **Estado de cuenta** and check the report against the
   file by hand.

## Gates (every PR, in order)

```sh
node scripts/spec-lint.mjs
node scripts/gen-banks.mjs --check
node scripts/contrast-lint.mjs
node scripts/pending-lint.mjs
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -r --if-present build
pnpm e2e        # the chip, the strip and the dialogs at 360/768/1280, both themes
```
