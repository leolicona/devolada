# Contract: the payer's page — the undecided ask

**Feature**: cep-bundle-match · **Decisions**: D10, D11, D12 · **Route**:
`apps/api/src/routes/direct-payments/{handler,schema}.ts` · **Page**:
`apps/pago/src/features/pago/PaymentPage.tsx`

The payer never sees a bundle, a candidate, another sender's data, or the
word "ZIP" (FR-010). What changes for them: an undecided payment asks for
the clave, like `REFERENCE_AMBIGUOUS` does today, with words that fit what
happened; a clave that fits a kept candidate confirms without a new wait.

## `publicPaymentError` — two codes

```ts
/* cep-bundle-match D10: the bundle, or a single match, did not say which
   transfer is the payer's. Still `validating`; no call is made until the
   clave arrives, and the payment does not expire meanwhile. */
"CEP_UNDECIDED",
/* cep-bundle-match D10: every transfer found with these data already
   confirmed another payment of the ISP — possibly the payer's own */
"CEP_ALL_USED",
```

`getDirectPaymentStatus` maps `last_error = 'CEP_UNDECIDED'` to
`CEP_ALL_USED` when `match_trail.reason = 'all_used'`, else to
`CEP_UNDECIDED`. `CEP_BUNDLE_PENDING` is not public: `publicError()` turns
it into `null`, and the page shows its ordinary waiting state.

`disputedFields` carries `["trackingKey"]` for both codes, as it does for
`REFERENCE_AMBIGUOUS`. `nextValidationAt` is `null` (no automatic attempt).
No other field of `directPaymentStatusResponse` changes.

## The page

- Both codes open the same ask as `REFERENCE_AMBIGUOUS`: `TransferForm`
  with `keys = "clave"`, the other fields filled from the row, focus on the
  clave. The correction goes out with `supersedes` as today (two-eyes D18).
- Copy (es-MX, in `payErrors`):
  - `CEP_UNDECIDED`: "Encontramos más de una transferencia que podría ser
    la tuya. Escribe tu clave de rastreo para saber cuál es."
  - `CEP_ALL_USED`: "Las transferencias que encontramos con estos datos ya
    se usaron para otros pagos. Si ya habías pagado, tu pago puede estar
    confirmado. Si esta transferencia es nueva, escribe su clave de
    rastreo."
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
