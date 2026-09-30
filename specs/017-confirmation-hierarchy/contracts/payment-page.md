# Contract: the payer's page — three options and the tie-break

**Feature**: confirmation-hierarchy · **Decisions**: D2, D3, D5, D6, D8,
D9, D11, D12 · **Route**: `apps/api/src/routes/direct-payments/{handler,schema}.ts`
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
   clave de rastreo. Con una basta." above today's `TransferForm` in `keys =
   "either"`, with the amount (the link's, editable), the bank and the day;
   then **Volver** (`ghost`, 48px) and `ReceiptLink`, last. The *No* of
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
