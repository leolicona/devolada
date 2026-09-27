# Contract: the public read — what an undecided payment awaits

**Feature**: cep-bundle-match · **Decisions**: D10, D17 · **Route**:
`apps/api/src/routes/v1/payments/{index,handler,schema}.ts` — `GET
/v1/payments?customerRef=` and `GET /v1/transfers`

A business on the `/v1` API reads its payments as programs do. An
undecided payment stays `validating` and never expires (D10), and no
webhook announces it: status is the only thing webhooks announce. So the
read says what the payment waits on, and why. The business's payers still
use Devolada's payment page, which asks them for the clave
(contracts/payment-page.md); this contract only lets the business see it.

## `apiPayment` — two fields, additive

```ts
/* cep-bundle-match D17: what the payment waits on, while it waits on the
   payer. Today only the clave de rastreo, after Banxico's answer did not
   say which transfer is the payer's. Null otherwise. */
awaiting: z.enum(["payer_tracking_key"]).nullable(),
/* Why it waits. Four public words over the engine's six reasons, so the
   internal vocabulary can move without breaking a caller. Null when
   `awaiting` is null. */
awaitingReason: z.enum(["all_used", "ambiguous", "no_match", "unreadable"]).nullable(),
```

| `match_trail.reason` (internal) | `awaitingReason` (public) | Meaning for the business |
| --- | --- | --- |
| `all_used` | `all_used` | Every transfer found with these data already confirmed another payment — possibly the payer's own |
| `no_signal`, `too_close` | `ambiguous` | More than one transfer could be the payer's |
| `none_fit` | `no_match` | The transfer found does not match the receipt |
| `unreadable`, `too_large` | `unreadable` | Banxico's answer could not be read |

- Set only while the row is `validating` with `last_error =
  'CEP_UNDECIDED'`; both null on every other row, confirmed ones included.
- Both reads (`/v1/payments`, `/v1/transfers`) carry them; the shape stays
  one (`transferList.transfers` is `apiPayment[]`).
- Unchanged: `status` and its vocabulary, the webhook event types, the
  webhook body (`webhookEventData`), and every existing field.
- Tenant-scoped and authenticated as today; no bundle, candidate or other
  sender's data ever travels here (FR-010).
