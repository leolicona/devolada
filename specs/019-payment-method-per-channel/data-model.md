# Data model: payment-method-per-channel

**One additive column, no table** (D11, D16). The feature reads what
exists, widens one in-process type, and adds one nullable column to the
integration row.

## The new column

| Table | Column | Type | Written by | Read by |
| --- | --- | --- | --- | --- |
| `integrations` | `payment_methods_seen_at` | integer, timestamp ms, nullable | the setup read, the test of the saved connection, and the gate (D14), each time the provider answers a fresh list for the stored key and installation; and a save of a new key or installation, with no provider call | the adapter, from the integration row its caller already holds, as the version of the method-list cache key (D16) |

Nullable and additive: existing rows read `null`, which is a version of
its own, so nothing changes for them until a setup read stamps it. It
carries `business_id` through its row (constitution V). One migration,
generated with `pnpm --filter @devolada/api db:generate`.

## What is read

| Where | What | Used for |
| --- | --- | --- |
| `payments.channel` | `"spei"` or `"store"` | Which of Devolada's two methods the payment carries (FR-001, FR-002) |
| `payments.folio` | The DV- folio, set when the money is confirmed | The reference's first part (FR-007) |
| `payments.tracking_key` | The clave de rastreo, when known | The SPEI reference's second part |
| `payments.store_id` → `stores.name` | The store's name, read at recording (D10) | The store reference's second part |
| `businesses.store_channel_on` | Whether the business has the store channel | Whether the screen shows the network's line (FR-008), and whether turning on execution requires the network's method (FR-013) |
| `integrations.actions_enabled` | The execution switch (`integrations-hub` D4) | Whether a patch turns execution on, the one moment the methods are checked (D14) |

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
| The cache key's version | `payment_methods_seen_at` in ms, or none | Taken from the integration row; a new stamp is a new key in every data center (D16) |
| Devolada's descriptions | es-MX text, one per name | Constants beside the names, given to copy, never checked (D15) |
| A payment method | `{ id: number, nombre: string }` | As the provider lists it; cached per business, address and seen stamp for ten minutes (D3, D16) |
| The chosen method | `{ id, nombre }`, one of the provider's | The channel's method by normalized name, lowest id; otherwise the cash method without Devolada's names; after a refusal, without the refused one (D4–D6) |
| The reference | string, ≤ 200 characters | `folio · clave` or `folio · tienda`; only the store's name is shortened (D7) |

## The setup state (integration contract)

Returned by the setup read and by the connection test (D8). See
[contracts/integrations-payment-methods.md](contracts/integrations-payment-methods.md).

| Field | Values |
| --- | --- |
| `checked` | `true` when the provider answered; `false` when it could not be reached |
| `link` | `{ name, description, status }`, always present when checked |
| `network` | `{ name, description, status }` when the store channel is on, otherwise `null` |
| `status` | `found`, `missing`, `duplicate` |

## State transitions

One new guard, on an existing transition: `integrations.actions_enabled`
false → true requires a saved key and every required line of the setup
block to be `found` or `duplicate` (D14). true → false is unguarded, and nothing
moves true → false on its own.

Nothing else is new. A payment's life (`validating → confirmed …`, the action queue
`queued → done | withheld | failed …`) is unchanged. The method is decided
inside the attempt that records the money (D9); once
`payment_registered_at` is set, no later attempt records again, so no later
attempt changes the method.
