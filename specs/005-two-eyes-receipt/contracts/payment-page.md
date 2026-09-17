# Contract: the payer's page and the direct-payments routes

**Feature**: two-eyes-receipt · **Schema**: `apps/api/src/routes/direct-payments/schema.ts`
(exported as `@devolada/api/direct-payments-schema`)

## `POST /direct-payments/links/:token/read` — `proofReadingResponse`

One field added; everything else unchanged.

```ts
proofReadingResponse = {
  source: "reader" | "provider-ocr",   // "provider-ocr" now means: nothing here could read the file
                                        // (no binding, a PDF with no text, an unparseable answer)
  isReceipt: boolean | null,
  legibility: "full" | "partial" | "none" | null,   // NEW (D2, R7)
  amountCents, trackingKey, senderBank, date, receiptStatus, gate   // as today
}
```

A PDF with text answers like a picture (D1). The `503 READER_UNAVAILABLE`
answer on any engine failure is unchanged.

## What the page does with it (D2, D13)

| Reading | Page |
| --- | --- |
| `isReceipt === false` or `legibility === "none"` | Refuses before paying: shows the es-MX message ("Esto no parece un comprobante" / "La foto no se lee bien; toma otra con más luz y sin mover el teléfono") in the existing `Alert`, keeps the picker open, sends nothing. No credit is spent |
| a reading, `full` or `partial`, amount not above the debt | Pays silently: `POST …/pay { proofId, receiptStatus?, receiptAmountCents? }` — **no `transfer`** |
| a reading whose amount is above the debt (claimed-amount D2) | Shows the two numbers as today, with two actions: **Enviar así** → `{ proofId, receiptStatus?, receiptAmountCents }`; **Corregir** → opens the form → `{ proofId, transfer, … }` |
| no reading (`503`, or `source: "provider-ocr"`) | Pays with `{ proofId }` as today |

`transfer` in a pay body now means, and only means, "the payer edited a
form": the disputed-field form, the escalated form, the manual door. The
server treats it as the human's data (FR-015): transfer door, no contrast.

## `POST /direct-payments/links/:token/pay` — `payRequest`, `payResponse`

Shapes unchanged. Behaviour:

- The response never waits for the provider (D4): `201 { status:
  "validating" }` (or `queued_for_credit`). The inline `confirmed` /
  `partial` / `invalid` / `unapplied` values stay in the enum for
  compatibility and are no longer produced inline. The page reads the
  outcome on its first poll.
- `supersedes` still requires `transfer` (a re-upload is a new attempt).

## `GET /direct-payments/:id/status` — `directPaymentStatusResponse`

Unchanged. `readingCheck` (`agreed` | `disputed`; blind stays null on the
wire) and `disputedFields` now arrive on the first poll after the first
call instead of after the minute-two attempt. `trackingKey`, `senderBank`,
`transferDate`, `claimedAmountCents` carry the accepted data once written
(D17), so the disputed-field form pre-fills the undisputed fields as today.

## Copy (es-MX, constitution VI)

Two new sentences on the payer's page, rendered in the existing `Alert`
atom with icon + text:

- Not a receipt: *"Esto no parece un comprobante de transferencia. Sube la
  captura o el PDF que te dio tu banco."*
- Not legible: *"No pudimos leer tu comprobante. Toma otra foto con más
  luz, sin mover el teléfono, y que se vea completo."*

Above-debt confirmation actions: *"Enviar así"* (decisive, 64px) and
*"Corregir los datos"* (secondary, 48px). No new tokens, no new atoms.

## Top-up proof (`POST /credit/top-ups`, `credit-schema`)

Unchanged contract. A receipt top-up now takes the provider-first flow
inside the engine (R9); the operator sees the same statuses.
