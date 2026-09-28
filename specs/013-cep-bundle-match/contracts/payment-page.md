# Contract: the payer's page — the undecided ask

**Feature**: cep-bundle-match · **Decisions**: D10, D11, D12 · **Route**:
`apps/api/src/routes/direct-payments/{handler,schema}.ts` · **Page**:
`apps/pago/src/features/pago/PaymentPage.tsx`

The payer never sees a bundle, a candidate, another sender's data, or the
word "ZIP" (FR-010). What changes for them: an undecided payment asks for
the clave, like `REFERENCE_AMBIGUOUS` does today, with words that fit what
happened; a clave that fits a kept candidate confirms without a new wait.

## `publicPaymentError` — three codes

```ts
/* cep-bundle-match D10: the bundle, or a single match, did not say which
   transfer is the payer's. Still `validating`; no call is made until the
   clave arrives, and the payment does not expire meanwhile. */
"CEP_UNDECIDED",
/* cep-bundle-match D10: every transfer found with these data already
   confirmed another payment of the business — possibly the payer's own */
"CEP_ALL_USED",
/* bug: single-cep-unreadable (D19): the search found ONE transfer and
   could not confirm it is the payer's */
"CEP_SINGLE_UNDECIDED",
```

`getDirectPaymentStatus` maps `last_error = 'CEP_UNDECIDED'` to
`CEP_ALL_USED` when `match_trail.reason = 'all_used'`, to
`CEP_SINGLE_UNDECIDED` when `match_trail.source = 'single'` (amended
2026-09-28), else to `CEP_UNDECIDED`. `CEP_BUNDLE_PENDING` is not public: `publicError()` turns
it into `null`, and the page shows its ordinary waiting state.

`disputedFields` carries `["trackingKey"]` for both codes, as it does for
`REFERENCE_AMBIGUOUS`. `nextValidationAt` is `null` (no automatic attempt).
No other field of `directPaymentStatusResponse` changes.

## The page

- All three codes open the same ask as `REFERENCE_AMBIGUOUS`: `TransferForm`
  with `keys = "clave"`, the other fields filled from the row, focus on the
  clave. The undecided write keeps the row's bank and day when it has
  none — the bank Banxico named for a single, the one the search stood on
  for a bundle, and the day the receipt printed (D19) — so a receipt-door
  row opens the form filled too. The correction goes out with `supersedes` as today (two-eyes D18).
- Copy (es-MX, in `payErrors`):
  - `CEP_UNDECIDED`: "Encontramos más de una transferencia que podría ser
    la tuya. Escribe tu clave de rastreo para saber cuál es."
  - `CEP_ALL_USED`: "Las transferencias que encontramos con estos datos ya
    se usaron para otros pagos. Si ya habías pagado, tu pago puede estar
    confirmado. Si esta transferencia es nueva, escribe su clave de
    rastreo."
  - `CEP_SINGLE_UNDECIDED`: "Encontramos una transferencia con tus datos,
    pero no pudimos confirmar que sea tuya. Escribe tu clave de rastreo
    para confirmarla."
- Icon + text, never colour alone; the existing `Alert` recipe; 48px
  fields and buttons; no new motion (constitution VI).
- A clave that fits a kept candidate (D11) confirms in the attempt that
  follows the submission, with no provider wait: the page's ordinary
  confirmed state.

## `/read` and pay (D12)

- `/read`'s `sharedAsk` asks for the clave only when the reading has
  neither a time nor a sender tail. With either, the payer continues as
  with any receipt, and the bundle decides later.
- The typed pay's `409 REFERENCE_SHARED` is unchanged: a typed transfer
  carries neither time nor tail.
- `ConstaReading` — what `/read` returns to the page — gains `time` and
  `senderTail`; the page does not show them.
