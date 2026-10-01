# Contract: the payer's page — three options and the tie-break

**Feature**: confirmation-hierarchy · **Decisions**: D2, D3, D5, D6, D8,
D9, D11–D22 · **Route**: `apps/api/src/routes/direct-payments/{handler,schema}.ts`
· **Page**: `apps/pago/src/features/pago/{PaymentPage,ConfirmPayment}.tsx`

A delta on [012's page contract](../../012-payment-without-receipt/contracts/payment-page.md).
What this file does not mention, 012's contract says. Every shape here is
exported from `@devolada/api/direct-payments-schema` (constitution III).
With `pay_by_reference` off, or on a link without a reference, nothing here
applies and the page is today's.

## `payRequest.transfer` — the answer (D6, D11)

012 adds `senderTail` and `claveTail`. This feature changes when they may
travel:

```ts
/* confirmation-hierarchy D6: an answer to the tie-break — either way, or
   both — on a row that supersedes the one waiting on it. Never searched. */
senderTail: z.string().regex(/^\d{4}$/).optional(),
claveTail: z.string().regex(/^[A-Za-z0-9]{4}$/).optional(),
```

- Either one requires `supersedes` (the refinement 012 gives `claveTail`
  now covers both).
- A typed confirmation (`referenceSource: "typed"`) carries neither: it
  searches at once (D5).

## Refusals of `POST /links/:token/pay`

| HTTP | `error.code` | When | Page |
| --- | --- | --- | --- |
| 409 | `TIE_BREAK_EXHAUSTED` | The body carries a tail and the link has three answers that fitted nothing in the last 24 hours (D8). No row is written | The clave field, focused, and the receipt link |
| 409 | `TIE_BREAK_NOT_ASKED` | The body carries a tail and the row it supersedes is not waiting on a tie-break (D11). No row, no search | The page re-reads the status |

Removed from 012's table, never built: `SENDER_TAIL_NEEDED` (D5).

`TOO_MANY_ATTEMPTS` (429) never refuses a row that carries a tail (either
way), a clave or a receipt (012 D25, amended by D8); confirmations and
corrections still count.

## `directPaymentStatusResponse` — the ask (D9)

Replaces 012's `ask` enum; `senderTail` and the rest of 012's fields stay.

```ts
/* confirmation-hierarchy D9: what the page asks now; null when it asks
   nothing. `tie_break` is one screen with two ways to answer. */
ask: z.enum(["check_data", "clave", "tie_break"]).nullable().optional(),
/* D9: with `tie_break` only — which fields the screen shows, and whether
   the last answer fitted nothing. Field names and a boolean: nothing of a
   transfer found ever travels (FR-018). */
tieBreak: z
  .object({
    ways: z.array(z.enum(["sender_tail", "clave_tail"])).min(1),
    missed: z.boolean(),
    /* whether one transfer or several were found — which sentence opens
       the screen (D12) */
    several: z.boolean(),
  })
  .nullable()
  .optional(),
```

## The page (D2, D3)

**Step 2 on a link with a reference** has three views, switched in place.
A reload lands on the confirmation.

1. **The confirmation** (default) — 012's step 2 items 0–5 unchanged
   (the transition notice, the question when `proven` is false, the bank,
   the day, the read-back, **Confirmar pago** as the only `primary` /
   `decisive` button). "Pagué otra cantidad" stays inside it, above the
   button. Then, in this order:
   - **Usé otra referencia** — `Button variant="secondary"`, standard
     (48px), full width. Opens the typed form.
   - `ReceiptLink` — "Subir foto del comprobante". Opens the receipt view.

   This replaces 012's item 6 (the small exits).
2. **The typed form** (option 2) — "Escribe la referencia que usaste o tu
   clave de rastreo. Con una basta." above `TransferForm`'s key fields in
   `keys = "either"`; the amount, the bank and the day are the ones chosen
   on the confirmation, shown as tags (D21, "The design" below); then
   **Buscar mi pago**, **Volver** (`ghost`, 48px) and `ReceiptLink`, last. The *No* of
   012's question opens this view.
3. **The receipt** (option 3) — `PaymentPage`'s existing receipt block
   (capture guide, upload, the reader's refusals and asks), passed into
   `ConfirmPayment` and shown here, never moved; then **Volver** (D3).

**`ReceiptLink`** — one component in `apps/pago`: `Button
variant="ghost"`, 48px high, `text-sm`, full width, "Subir foto del
comprobante"; the recipe of today's "No tengo el comprobante a la mano"
(`PaymentPage.tsx:1936-1939`) — the quiet action the spec clarified. On a
page with a reference it is the only way the receipt is offered, and it is
always the last action of its view, on exactly the views spec FR-005 names:

| View | `ReceiptLink` |
| --- | --- |
| The confirmation; the typed form | yes, last |
| An ask: `check_data`, `clave`, `tie_break` | yes, last |
| "Ya se usó para…" (`TRANSFER_ALREADY_USED`) | yes, last |
| A refusal: `REFERENCE_OF_ANOTHER`, `TRANSFER_DATE_OUT_OF_RANGE`, `CORRECTIONS_EXHAUSTED`, `TIE_BREAK_EXHAUSTED` | yes, last |
| Expired | yes, last |
| The plain wait: `validating` with `ask: null` ("Seguimos buscando") | **no** — nothing is asked yet (012 FR-027) |
| Confirmed, partial, unapplied, in review by the business | no — the transfer was found |

On a row that waits or has stopped, it opens the receipt block on 012
T042's re-submission path.

**The tie-break screen** (`ask: "tie_break"`), under 012's read-back:

| Part | Copy (es-MX) / control |
| --- | --- |
| Opening, `several: false` | "Encontramos una transferencia con esos datos. Para confirmar que es tuya, escribe uno de estos datos. Con uno basta." |
| Opening, `several: true` | "Encontramos más de una transferencia con esos datos. Para saber cuál es la tuya, escribe uno de estos datos. Con uno basta." |
| Opening, `ways = ["clave_tail"]` | "Para confirmar que esta transferencia es tuya, escribe los últimos 4 caracteres de tu clave de rastreo." |
| Opening, `ways = ["sender_tail"]` | "Escribe también los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste." |
| `missed: true`, above the fields | "Ese dato no coincide con ninguna de las transferencias que encontramos. Revísalo en el detalle de tu transferencia." (`Alert`, icon and text) |
| Field `sender_tail` | "Últimos 4 dígitos de la cuenta o tarjeta con la que pagaste" — `inputMode="numeric"`, four digits |
| Field `clave_tail` | "Últimos 4 caracteres de tu clave de rastreo" — mono, four letters or digits, upper-cased as typed |
| Between the two fields | "o" |
| Action | **Confirmar** — `primary` / standard, enabled when a shown field is complete |
| Last | `ReceiptLink` |

The screen shows only the fields in `ways`. It sends `{ supersedes,
transfer: { …the waiting row's reference, bank, day and amount, senderTail?,
claveTail? } }`. It never pre-fills either field.

**`TIE_BREAK_EXHAUSTED`** and `ask: "clave"` show 012's clave ask
unchanged ("Para encontrarla con seguridad, escribe tu clave de rastreo…"),
with `ReceiptLink` last.

Removed from 012's contract, never built: the asks `sender_tail` and
`clave_tail`, and the "No puse la referencia" paragraph's four-digit field
on `SENDER_TAIL_NEEDED`.

**Constitution VI**: one `decisive` button per view at most; option 2 and
`ReceiptLink` 48px, focus visible; tab order is the visual order; tokens
only; no horizontal scroll at 360; the miss line is an `Alert` with icon and
text, never colour alone.

## The payer's copy (User Story 4; D13–D16)

Everything below applies to the payer page on every business, with the
feature on or off. "{negocio}" is the link read's business name
(`ispName`); `payErrorCopy` takes it where a sentence names the business.
Lines are those of `main` at `77bc503`.

### The vocabulary (spec FR-022)

| Moment | Copy (es-MX) |
| --- | --- |
| A search is running | "Verificando tu transferencia…" — in a list of steps, "Verificamos tu transferencia" |
| Nothing seen yet; we try again alone | "Seguimos buscando tu transferencia." + "Todavía no la vemos. Es normal al principio: volvemos a buscar solos, sin que hagas nada." |
| The evidence is already good; only the last word is missing | "Solo falta confirmar tu transferencia" ("Solo falta confirmarla" right after the transfer was named); inside a sentence, "mientras terminamos de confirmar tu transferencia" |
| Confirmed | "Confirmamos tu transferencia" (the badge keeps "Pago confirmado") |
| Out of time | "No pudimos confirmar tu transferencia a tiempo" |

### Sentence by sentence (`apps/pago/src/features/pago/PaymentPage.tsx` unless named)

| Where | Today | Becomes |
| --- | --- | --- |
| 144, `payErrors.TRANSFER_NOT_FOUND` | "No encontramos tu transferencia en Banxico. Si ya la hiciste, contacta a tu proveedor de internet con tu comprobante para que la registre." | "No pudimos confirmar tu transferencia a tiempo. Si ya la hiciste, contacta a {negocio} con tu comprobante para que la registre." |
| 848, sourced row, `ask: null` | "Seguimos buscando tu transferencia en Banxico." | "Seguimos buscando tu transferencia." |
| 859, 1636, release after the payer confirmed their data | "Gracias por confirmar tus datos. Tu internet ya volvió mientras Banxico responde." | "Gracias por confirmar tus datos. Tu servicio ya volvió mientras terminamos de confirmar tu transferencia." |
| 860, 1515, 1637, release, other evidence | "Tu transferencia está en camino y tu internet ya volvió. Solo esperamos la confirmación de Banxico — no necesitas hacer nada." | "Tu transferencia está en camino y tu servicio ya volvió. Solo falta confirmarla — no necesitas hacer nada." |
| 1634, release, both readings agree | "Revisamos tu comprobante dos veces y los datos coinciden. Tu internet ya volvió mientras esperamos la respuesta de Banxico — no necesitas hacer nada." | "Revisamos tu comprobante dos veces y los datos coinciden. Tu servicio ya volvió mientras terminamos de confirmar tu transferencia — no necesitas hacer nada." |
| 1653–1654, the long wait | "…Puedes cerrar esta página y volver después, o contactar a tu proveedor de internet con tu comprobante." | "…Puedes cerrar esta página y volver después, o contactar a {negocio} con tu comprobante." |
| 1669–1670, both readings agree, no release | "Revisamos tu comprobante dos veces y los datos coinciden. Solo esperamos la respuesta de Banxico — no necesitas hacer nada." | "Revisamos tu comprobante dos veces y los datos coinciden. Solo falta confirmar tu transferencia — no necesitas hacer nada." |
| 1681–1682, the default wait | "Validación en proceso: esperamos la respuesta de Banxico. No necesitas hacer nada." | "Seguimos buscando tu transferencia. Todavía no la vemos. Es normal al principio: volvemos a buscar solos, sin que hagas nada." |
| 2013, expired after a release, retry open | "Banxico no publicó tu transferencia y tu servicio volvió a pausa. Si ya pagaste, reintenta ahora — o contacta a tu proveedor de internet con tu comprobante." | "No pudimos confirmar tu transferencia a tiempo y tu servicio volvió a pausa. Si ya pagaste, reintenta ahora — o contacta a {negocio} con tu comprobante." |
| 2014, expired after a release | "Banxico no publicó tu transferencia y tu servicio volvió a pausa. Contacta a tu proveedor de internet con tu comprobante — puede registrar tu pago a mano." | "No pudimos confirmar tu transferencia a tiempo y tu servicio volvió a pausa. Contacta a {negocio} con tu comprobante — puede registrar tu pago a mano." |
| 2017, expired, readings agreed, retry open | "Tus datos coinciden con tu comprobante, pero Banxico no publicó la transferencia. Si ya pagaste, reintenta ahora — o contacta a tu proveedor de internet con tu comprobante." | "Tus datos coinciden con tu comprobante, pero no pudimos confirmar la transferencia a tiempo. Si ya pagaste, reintenta ahora — o contacta a {negocio} con tu comprobante." |
| 2018, expired, readings agreed | "Tus datos coinciden con tu comprobante, pero Banxico no publicó la transferencia. Contacta a tu proveedor de internet con tu comprobante — puede registrar tu pago a mano." | "Tus datos coinciden con tu comprobante, pero no pudimos confirmar la transferencia a tiempo. Contacta a {negocio} con tu comprobante — puede registrar tu pago a mano." |
| 2021, expired, default | "No pudimos confirmar tu pago a tiempo. Contacta a tu proveedor de internet con tu comprobante para resolverlo." | "No pudimos confirmar tu pago a tiempo. Contacta a {negocio} con tu comprobante para resolverlo." |
| 1349, a link that does not exist | "Este link de pago no existe. Pide a tu proveedor de internet el link correcto." | "Este link de pago no existe. Pide el link correcto a quien te lo envió." |
| `RootScreen.tsx:28`, no saved link, heading | "Pago de internet" | "Tu pago" |
| `RootScreen.tsx:33–34`, no saved link | "Aún no tienes un link de pago guardado en este dispositivo. Pídeselo a tu proveedor de internet." | "Aún no tienes un link de pago guardado en este dispositivo. Pídeselo a quien te envió el link." |
| `apps/pago/index.html:7`, the tab | "Pago de internet" | "Tu pago" |

Comments that quote a sentence being changed follow it (for example the
one at `PaymentPage.tsx:2026`, "the screen that just told them Banxico did
not publish their transfer").

### The bank list (D15)

`payerBanks` — `BANKS` without `BANXICO` — in a new
`apps/pago/src/features/pago/payer-banks.ts`, used by `TransferForm`
(`PaymentPage.tsx:420`) and by "Otro banco" (`ConfirmPayment.tsx:159`). A
draft or a status whose bank is `BANXICO` pre-selects nothing.

### The check (D16, spec SC-006)

`apps/pago/test/payer-copy.test.ts` (cite `confirmation-hierarchy US4`)
walks every string literal, template literal and JSX text under
`apps/pago/src` with the TypeScript compiler API, plus the `<title>` of
`apps/pago/index.html`, and fails on `/banxico/i` or `/internet/i`, naming
file and line. Comments are not read.

## The design (User Story 5; D17–D22)

Proposal E of the design canvas "Confirma tu pago — propuesta"
(2026-10-01). Only links with a reference; tokens and today's atoms only
(D17). Copy is es-MX and final; `{negocio}` is `ispName`, `{ref}` the
grouped digits.

### Step 1 — "Haz tu transferencia" (D19)

In this order, inside today's `Card`:

| Part | Copy / control |
| --- | --- |
| Header | today's `stepHeader(1, "Haz tu transferencia")`, with a two-segment progress mark beside "Paso 1 de 2" (decorative, `aria-hidden`) |
| Amount | today's `AmountBreakdown` and "Copiar monto exacto" |
| Account, heading | "Transfiere a", and a tag by `collectAccount.kind`: "CLABE", "Tarjeta de débito" or "Celular", with its icon (landmark, credit card, smartphone) |
| Account, row | the kind's label, the number in mono, `CopyButton` ("Copiar" → "Copiado"); for `card` and `phone`, a second row "Banco" with the bank and "Tu app te lo pide junto al número" |
| Account, line | CLABE: "{negocio} recibe sus pagos en esta CLABE. El dinero llega directo a su cuenta." Card: "{negocio} recibe sus pagos en esta tarjeta. Elige «Tarjeta de débito» como destino en tu app; el dinero llega directo a su cuenta." Phone: "{negocio} recibe sus pagos en este celular. Elige «Celular» como destino en tu app; el dinero llega directo a su cuenta." — with a lock icon |
| `ReferenceBox` | heading "Tu referencia", a tag "Solo tuya", `{ref}` in mono at `text-3xl`, `CopyButton` copying the seven digits ("Copiar" → "Copiada"), "Son los últimos 7 números de tu celular." when `fromPhone`; under a rule, `referenceHint(learnedBanks[0])` in medium weight and "Con ella reconocemos tu transferencia: no tendrás que mandar comprobante." Accent-subtle surface, focus-colour border; one glow when the step opens |
| `TransferExample` | heading "Así se llena en tu app", a ghost "Ver otra vez"; four rows on a well — the account by kind ("Cuenta CLABE", "Número de tarjeta", "Número de celular") with its number, "Monto" `$…`, "Referencia numérica" `{ref}` with a tag "Tu referencia" and the focus-colour outline, "Concepto" "Opcional: lo que quieras" in faint ink; under it, "Los nombres cambian un poco según tu banco. La referencia siempre va en el campo de números." |
| Tip | today's contact tip, led by "El próximo mes, en dos toques." |
| Then | today's "Ver los demás datos", **Ya hice mi transferencia** and its line |

### Step 2 — "Confirma tu pago" (D18, D21)

| Part | Copy / control |
| --- | --- |
| Under the header | a box on the accent-subtle surface: "Buscaremos con tu referencia" and `{ref}` in mono |
| Bank, day | `ChoiceGroup layout="chips"`: same legends, labels "Hoy · {día abreviado}", "Ayer · {día abreviado}", "Otro día"; the learned banks, then "Otro banco" |
| Under the banks, when one was preselected | "Elegimos el banco de tu último pago. Cámbialo si pagaste desde otro." |
| Why | a link-styled button "¿Por qué te preguntamos esto?" (`aria-expanded`), 48px, opening in a well: "Tu referencia, el banco y el día nos bastan para encontrar tu transferencia entre todas las de ese día. Por eso no te pedimos comprobante." Nothing is sent |
| Then | the read-back, "Pagué otra cantidad", **Confirmar pago**, **Usé otra referencia**, `ReceiptLink`, as "The page" says |
| Option 2's tags | "Con lo que ya elegiste:" and three tags — the amount, the bank (or "Elige tu banco"), the day |

### After the confirmation (D22)

| Moment | Copy / control |
| --- | --- |
| The plain wait | under the "Verificando pago" badge, an ordered list: "Recibimos tus datos" / "Referencia, banco, día y monto"; "Verificamos tu transferencia" / "Buscamos la que coincide con tus datos"; "Confirmamos tu pago" / "Y {negocio} lo registra". From the row: a sourced `validating` row marks the second current (`aria-current="step"`, breathing); then "Suele tomar menos de un minuto. Puedes cerrar esta página y volver después." No `ReceiptLink` |
| The tie-break | above the fields, a figure on a well: "Búscalos en el detalle de tu transferencia:", a row "Cuenta de origen" with "••••" and a tag "4 dígitos", a row "Clave de rastreo" with "…" and a tag "4 caracteres". Placeholders only |
| Confirmed, `referenceSource = "own"` | after the folio, on a well with a star icon: "**Así de fácil cada mes.** Usa la misma referencia, {ref}, y confirmas tu pago en dos toques." |

### Motion (D20, spec FR-033)

| What | How | Reduced motion |
| --- | --- | --- |
| Step 1's sections | fade with a 6px rise, staggered 70ms, `--duration-normal` | fade only |
| `ReferenceBox` | one glow of the focus colour after the sections land | none |
| `TransferExample` | each value revealed by a stepped `clip-path`, 600ms apart; the reference row's outline last | every value shown, no keyframe |
| Chips | the check fades in, `--duration-fast` | the same (opacity) |
| The wait | the current step breathes, `--duration-breath` | the same (opacity) |
| Views and outcomes | cross-fade, `--duration-normal`; the confirmed check draws in `--duration-slow` | fade only |

Nothing spins or bounces. **Browser layer**: chips, the copy buttons, "Ver
otra vez" and "¿Por qué te preguntamos esto?" are 48px targets with a
measured focus ring; the reference's box and
the tags pass contrast in both themes; no horizontal scroll at 360 with a
CLABE, a card or a phone.
