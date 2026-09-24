# Contract: the validation engine facade

**Feature**: receipt-triage · **Files**: `apps/api/src/consta/index.ts`
(types), `consta/validate.ts`, `consta/extract.ts`,
`consta/extraction/{reader,gate,compare,ask}.ts`, `consta/provider/apicep.ts`
(one comment)

The engine is a component of `apps/api`, not a surface (constitution III):
this contract is between the engine and its callers in the same Worker — the
payment lifecycle (`direct-payments/validation.ts`), the `/read` route, and the
top-up lifecycle (`credit/topups.ts`), which changes only as the Edge Cases
say. Additions only; nothing is renamed and no field changes meaning.

## `ConstaRequest` transfer variant — a key, not a clave (D1, D9)

```ts
transfer: {
  date: string;
  amountCents: number;
  senderBank: string;
  /* receipt-triage D1: at least one of the two; both when both exist */
  trackingKey?: string;
  referenceNumber?: string;
  beneficiary: ConstaBeneficiary;
};
```

The request guard already enforces "at least one" (`transferSchema.refine`)
and refuses a request with neither as `REQUEST_REJECTED` before any credit.
The receipt variant is unchanged.

## `ConstaVerdict` — the accepted data carries both keys (D11)

```ts
accepted?: {
  trackingKey: string | null;
  referenceNumber: string | null; // at least one of the two is set
  senderBank: string;
  amountCents: number;
  date: string | null;
} | null;
disputedFields?: ("trackingKey" | "referenceNumber" | "amount" | "date")[];
```

`ourReading` (the payload the lifecycle stores) gains `referenceNumber`.

## `ConstaReading` (`extract`) — the reference and the ask (D13)

```ts
referenceNumber: string | null;                 // only when the gate says ok
gate: {
  trackingKey: "ok" | "malformed" | "missing";
  referenceNumber: "ok" | "malformed" | "missing"; // + new
  senderBank: "ok" | "unknown" | "missing";
  amount: "ok" | "malformed" | "missing";
};
/* receipt-triage D13: the one rule, reported. Null when the capture may
   go on to the paid call. */
ask: null | { fields: ("key" | "amount" | "date" | "senderBank")[] };
```

`extract` never throws on an ask: it reports it, and records the reading with
outcome `key_missing`.

## The receipt door enforces the ask

Before the provider call, after reading (or reusing the draft's reading,
two-eyes D14): when `askBeforeCredit(extracted)` is not null, the engine
records the reading (`key_missing`) and throws

| Code | `retryable` | Billed | `extra` |
| --- | --- | --- | --- |
| `RECEIPT_INCOMPLETE` — revived; declared since proof-extraction D4, thrown by no door since two-eyes D3 | `false` | no | `reading` (the payload a human can be shown) and `missingFields` = `ask.fields` |

The lifecycle's catch is unchanged: every engine failure is
`retryLater(code)` (consta-api-merge D6).

## The comparison (`compareReadings`, pure) — D11

- The **key** of a comparison is the clave when either reading found one; the
  reference otherwise.
- Key = reference: equal (as text) → `agreed`; different → `disputed` with
  `referenceNumber`; one side missing → `blind` on that side. The shape rules
  are never consulted for a reference; a disputed reference is asked of the
  payer.
- Key = clave: exactly today's rules. The reference, when read, rides along in
  `accepted` from whichever side read it (ours first).

## The provider's "more than one" answer — D15

Unchanged in the engine: a 422 on the transfer door throws `REQUEST_REJECTED`
with `retryable: false` and `hint: "provide_tracking_key"`. What changes is
the caller (see [payment-page.md](./payment-page.md) and the data model): the
lifecycle reads the hint, asks for the clave, and stops calling. The comment
in `provider/apicep.ts` that says Devolada "cannot hit" this answer is
rewritten: it can now.
