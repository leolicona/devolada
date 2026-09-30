# Quickstart: confirmation-hierarchy

How to prove the feature works, story by story. The shapes are in
[contracts/](./contracts/) and [data-model.md](./data-model.md); the steps
to build them are in `tasks.md`. This feature is built with spec 012
(plan D1), so start from
[012's quickstart](../012-payment-without-receipt/quickstart.md): its
prerequisites, its Step 0 (turn the switch on) and its sandbox.

## Sandbox additions

012's sandbox answers a search by reference by what the reference ends in.
This feature fixes the claves of its several-matches scenarios and adds one:

| Reference ends in | Sandbox answer |
| --- | --- |
| `…44` | several: two CEPs from two accounts, tails 8301 and 4417; claves ending `…0412` and `…977I` |
| `…55` | several: two CEPs from two accounts, tails 8301 and 4417; claves that share their last four, `…5510` |
| `…66` | one CEP, account tail 8301, clave ending `…3O1K` |

`…977I` and `…3O1K` carry the letters a payer mistypes: `9771` and `3010`
must fit them.

## The gates, in CI order

```sh
node scripts/spec-lint.mjs            # every new test cites confirmation-hierarchy US<n>
node scripts/gen-banks.mjs --check
node scripts/contrast-lint.mjs        # no token added
node scripts/pending-lint.mjs
pnpm -r --if-present typecheck
pnpm -r --if-present test
pnpm -r --if-present build
pnpm e2e                              # the step at 360/768/1280, both themes
```

## US1 — Three ways to confirm, in a fixed order

1. Open a link with a reference; tap through to "Confirma tu pago".
   **Expect**: the bank, the day, the read-back and **Confirmar pago** (64px,
   the only decisive button); below it **Usé otra referencia** (48px,
   outlined); last, "Subir foto del comprobante" (48px, no box, small text).
2. Tap **Usé otra referencia**. **Expect**: "Escribe la referencia que usaste
   o tu clave de rastreo. Con una basta.", the form, **Volver**, the receipt
   link last. **Volver** returns to the confirmation; nothing was searched.
3. Tap the receipt link. **Expect**: today's capture guide and upload, and
   **Volver**. Upload a receipt: the receipt path works as today.
4. On a reference never proven, answer *No* to "¿Pusiste la referencia…?".
   **Expect**: the typed form, no search.
5. Reload on any view. **Expect**: the confirmation.
6. Confirm with a reference the sandbox does not find. **Expect**:
   "Seguimos buscando" with no receipt link; after round 3, the data check
   with the receipt link last. Refuse a day outside the last 30 days, and
   open a transfer already used: each view ends with the receipt link.
7. Turn the switch off and reopen. **Expect**: today's page, receipt first.
8. Keyboard only: Tab through the step. **Expect**: option 1's controls,
   then option 2, then the receipt link, each with a visible ring.

## US2 — The tie-break on a typed reference

1. Typed form, reference ending `…44`, the right amount, bank and day.
   **Expect**: one search; the tie-break screen, "Encontramos más de una
   transferencia…", both fields, the receipt link last; no digits or
   characters of either transfer anywhere on the page.
2. Answer the clave's `0412`. **Expect**: confirmed at once, no provider
   call (the sandbox's log shows none); the payment records `by:
   clave_tail`.
3. Repeat to the screen; answer the digits `4417`. **Expect**: confirmed,
   `by: sender_tail`.
4. Repeat; answer `9771` in the characters. **Expect**: it fits `…977I`.
5. Repeat; answer the digits `8301` and the characters `0412` together
   (two different transfers). **Expect**: nothing confirms; the miss line.
6. Repeat with `…55`; answer the characters `5510`. **Expect**: the screen
   asks the digits only; answer `4417` → confirmed.
7. Reference `…66` (one transfer). **Expect**: "Encontramos una
   transferencia…" — a single match is asked too. `3010` → confirmed.
8. On one link, answer three misses. **Expect**: the miss line twice, then
   the whole clave only, with the receipt link. A fourth answer sent by
   hand → `409 TIE_BREAK_EXHAUSTED`. Answers never trip the hourly
   `TOO_MANY_ATTEMPTS`. The window moves: 24 hours after the first miss,
   one answer is accepted again (the lifecycle suite steps the clock).
9. Leave a tie-break unanswered past the schedule. **Expect**: still "en
   revisión", no expiry, no further provider calls.

## US3 — An account that pays for several people

Two people paid by one account need two transfers from it, which the
sandbox's fixed answers cannot give by hand. The lifecycle suite
(`apps/api/test/confirmation-hierarchy.test.ts`) seeds them: confirmed
payments of customer A and of customer B (another phone, another name),
each adopting a clave whose `cep_records` row comes from the account ending
8301. Then:

1. A confirms a typed reference whose search finds a transfer from 8301 and
   one from 4417. **Expect**: the tie-break screen — 8301 is not exclusive,
   so history does not decide.
2. A answers the digits `8301`. **Expect**: the characters are asked ("Para
   confirmar que esta transferencia es tuya…"); the right characters
   confirm.
3. The same search for a customer whose learned 4417 is exclusive.
   **Expect**: confirmed with no question, `by: learned_account`.
4. An own-reference search that finds two of the person's transfers, the
   learned account shared with another person. **Expect**: the earliest
   transfer not yet used confirms.

## US4 — The payer reads about their transfer

1. `pnpm --filter @devolada/pago test -- test/payer-copy.test.ts`.
   **Expect**: green — no string the page can render names Banxico or says
   "internet".
2. On a business with the feature off, submit a receipt the sandbox does
   not find. **Expect**: "Seguimos buscando tu transferencia." and "Todavía
   no la vemos…"; after expiry, "No pudimos confirmar tu pago a tiempo.
   Contacta a {the business's name} con tu comprobante…".
3. With a provisional release standing (012 quickstart), **Expect**: "Tu
   servicio ya volvió…" — never "tu internet".
4. Open `/l/does-not-exist` and the bare origin with no saved link.
   **Expect**: "Pide el link correcto a quien te lo envió." and "Tu pago";
   the browser tab reads "Tu pago".
5. Open the typed form's bank list and "Otro banco". **Expect**: no
   "BANXICO".

## Reading the success criteria

With the business id `$B`, each is one query over that business
(data-model.md), except two: SC-003 is the pay route's latency on
answer rows (T030 records it on the sandbox), and SC-006 is the copy scan
(step 1 of US4). SC-001 from `match_trail.by` on typed rows that found
transfers; SC-004 from links with three `tie_break = 'none'` rows in a
window; SC-005 from the receipt rows of links with a reference.
