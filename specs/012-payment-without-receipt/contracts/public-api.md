# Contract: the collections API (`/v1`) — the payer's reference on a link

**Feature**: payment-without-receipt · **Decision**: D22 · **Route**:
`apps/api/src/routes/v1/payment-links/{schema,handler}.ts`

A business on `/v1` sends its own messages; FR-005 lets it print the
number its customer should use.

## `paymentLink` — one field

```ts
/* payment-without-receipt D22: the seven digits this customer puts in the
   transfer's «Referencia numérica». An API link carries no phone, so it is
   always an assigned number (D2, D4). Null while the business has
   `pay_by_reference` off. */
payerReference: z.string().regex(/^[1-9]\d{6}$/).nullable(),
```

Mapped in `toPublic` (`handler.ts:32-48`). Every read of a link (create,
list by `customerRef`, get, patch) carries it. A reusable link and a
one-time link of the same `customerRef` share it: the reference belongs to
the customer, not the link (D1).

Additive: no field changes type, no status word, no new event; the webhook
body is unchanged. The `/v1` payment (`apiPayment`) is unchanged too — it
exposes no bank and no tail today, and this feature adds none.
