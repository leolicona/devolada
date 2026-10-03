# Contract: the action capability's input (core → adapter)

`IntegrationCapabilities.paymentActions.attempt(input)`, in
`apps/api/src/integrations/capabilities.ts`. In-process, typed; not an HTTP
surface. Widened by D2; the answer (`ActionAttempt`) does not change.

## Input

```ts
export type ActionAttemptInput = {
  business: { id: string; timezone: string };
  usuario: string;
  providerCustomerId: string;
  registeredCents: number;
  invoiceId: number | null;
  paymentRegistered: boolean;
  reconnect: boolean;
  now: Date;
  /* payment-method-per-channel D2: where the money came in */
  channel: "spei" | "store";
  /* payment-method-per-channel D2/D7: what ties the record back to
     Devolada. The adapter writes it in its provider's words and limits. */
  recordReference: {
    folio: string | null;
    trackingKey: string | null;
    storeName: string | null;
  };
};
```

## Who fills it

| Call site | `channel` | `folio` | `trackingKey` | `storeName` |
| --- | --- | --- | --- | --- |
| `settleConfirmed` (`direct-payments/validation.ts`), SPEI verdict and store record | the row's `channel` | the row's `folio` | the row's `trackingKey` (a SPEI row) | the store's name (a store row) |
| `dispatchObserved` (`routes/payments/handler.ts`), *Ejecutar ahora* and the held accept | `row.channel` | `row.folio` | `row.trackingKey` (a SPEI row) | the store's name (a store row) |
| The sweep (`reconnection/queue.ts`) | `charge.channel` | `charge.folio` | `charge.trackingKey` (a SPEI row) | the batch's store names, read in one query (D10) |

In `settleConfirmed`, "the row" is the one its verdict write returns, not
the `payment` it was handed: the folio is born in that write, and the
clave may have been adopted onto the row after `payment` was read.

## Rules

- The core passes values; it never builds the reference text and never
  names a provider's method (FR-011).
- A store row's `trackingKey` is `null`. A SPEI row's `storeName` is `null`.
- Nothing about the payer (name, phone, account) is passed for the
  reference (FR-007).
- Tests that exercise a call site assert what reached the provider (the
  `registrar-pago` body), not this object: the contract is proven at the
  edge (constitution IV).
