# Data model: payment-method-per-channel

**No migration.** No table, column or index is added, changed or removed
(D11). The feature reads what exists and widens one in-process type.

## What is read

| Where | What | Used for |
| --- | --- | --- |
| `payments.channel` | `"spei"` or `"store"` | Which of Devolada's two methods the payment carries (FR-001, FR-002) |
| `payments.folio` | The DV- folio, set when the money is confirmed | The reference's first part (FR-007) |
| `payments.tracking_key` | The clave de rastreo, when known | The SPEI reference's second part |
| `payments.store_id` → `stores.name` | The store's name, read at recording (D10) | The store reference's second part |
| `businesses.store_channel_on` | Whether the business has the store channel | Whether the screen shows the network's line (FR-008) |

## The widened type (core → adapter)

`ActionAttemptInput` in `apps/api/src/integrations/capabilities.ts` gains,
in the core's words (D2):

| Field | Type | Meaning |
| --- | --- | --- |
| `channel` | `"spei" \| "store"` | Where the money came in: the row's `channel` |
| `recordReference.folio` | `string \| null` | The payment's DV- folio |
| `recordReference.trackingKey` | `string \| null` | The clave de rastreo; null on a store row or when unknown |
| `recordReference.storeName` | `string \| null` | The store's name as it is now; null on a SPEI row |

Nothing else in `ActionAttemptInput` or `ActionAttempt` changes. An adapter
whose system has no payment methods ignores the new fields (FR-011).

## Adapter-side values (WispHub only, never in the core)

| Value | Shape | Rule |
| --- | --- | --- |
| Devolada's names | `{ spei: "SPEI - LINK.DEVOLADAPAGO", store: "CASH - RED.DEVOLADAPAGO" }` | Constants (D1) |
| A payment method | `{ id: number, nombre: string }` | As the provider lists it; cached per business and address for ten minutes (D3) |
| The chosen method | `{ id, kind: "devolada" \| "cash" }` | The channel's method by normalized name, lowest id; otherwise the cash method without Devolada's names (D4, D5) |
| The reference | string, ≤ 200 characters | `folio · clave` or `folio · tienda`; only the store's name is shortened (D7) |

## The setup state (integration contract)

Returned by the setup read and by the connection test (D8). See
[contracts/integrations-payment-methods.md](contracts/integrations-payment-methods.md).

| Field | Values |
| --- | --- |
| `checked` | `true` when the provider answered; `false` when it could not be reached |
| `link` | `{ name, status }`, always present when checked |
| `network` | `{ name, status }` when the store channel is on, otherwise `null` |
| `status` | `found`, `missing`, `duplicate` |

## State transitions

None new. A payment's life (`validating → confirmed …`, the action queue
`queued → done | withheld | failed …`) is unchanged. The method is decided
inside the attempt that records the money (D9); once
`payment_registered_at` is set, no later attempt records again, so no later
attempt changes the method.
