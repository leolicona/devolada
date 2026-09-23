# Contract: the validation engine facade

**Feature**: receipt-triage · **File**: `apps/api/src/consta/index.ts`
(types), `consta/validate.ts`, `consta/extract.ts`,
`consta/extraction/{reader,gate,stop,destination}.ts`

The engine is a component of `apps/api`, not a surface (constitution III): this
contract is between the engine and its two callers in the same Worker — the
payment lifecycle (`direct-payments/validation.ts`) and the `/read` route —
plus the top-up lifecycle, which does not change. Additions only; nothing is
renamed and no field changes meaning.

## `ConstaBeneficiary` — widened (D1)

```ts
export type ConstaBeneficiary =
  | { bank: string; clabe: string; name?: string }
  | { bank: string; cardNumber: string; name?: string }   // 16 digits
  | { bank: string; phoneNumber: string; name?: string }; // 10 digits
```

Exactly the shapes `beneficiarySchema` already validates
(`consta/request.ts`) and the adapter already passes through unchanged. The
same-institution guard (validation.spec.md D17) applies to all three: a
transfer-door request whose `senderBank` equals `beneficiary.bank` is refused
before any credit, as today.

## `ConstaRequest` receipt variant — a list is allowed (D9)

```ts
| {
    receipt: { proofKey: string };
    /* exactly one of the two */
    beneficiary?: ConstaBeneficiary;
    potentialBeneficiaries?: ConstaBeneficiary[]; // ≥ 2
    providerOcr?: true; // unchanged: the legacy minute-two cross only
  }
```

Behaviour with `potentialBeneficiaries`:

1. The engine **reads the file** exactly as with one beneficiary (the
   `readable` test gains "or `potentialBeneficiaries`").
2. It runs the stop (below) against the list.
3. It **narrows** by the reading's destination (`matchDestination`, D11): one
   match → the provider call carries `beneficiary` (that one); no single match
   → the provider call carries `potentialBeneficiaries` (the list).
4. The verdict reports what was sent in `beneficiaryUsed`.

The transfer variant still takes exactly one `beneficiary`.

## `ConstaVerdict` — one field added

```ts
/* receipt-triage D9: the identifier the provider call named. Null when
   the call carried the candidate list; absent on the transfer door, whose
   caller already chose. The lifecycle stores it on the payment (D12). */
beneficiaryUsed?: ConstaBeneficiary | null;
/* receipt-triage D14: the sending bank the engine established for a
   Spin reading from the origin account's prefix — "SPIN BY OXXO" or
   "STP" — or null when it could not. Absent for any other bank. The
   lifecycle accepts machine data with a Spin bank only when this is
   non-null. */
spinInstitution?: "SPIN BY OXXO" | "STP" | null;
```

## `ConstaReading` (`extract`) — the stop and the new fields

`extract(input)` gains an optional list:

```ts
extract(input: {
  proofKey: string;
  /* receipt-triage D6: the business's receiving identifiers, so the stop
     can judge the destination. Omitted → the destination is never a
     mismatch (the top-up path, and any caller that does not know). */
  receivingAccounts?: ConstaBeneficiary[];
}): Promise<ConstaReading>;
```

and the reading gains:

```ts
destination: { kind: "clabe" | "card" | "phone" | "account" | null; digits: string | null };
operation: "spei" | "same_institution" | "cash" | null;
/* receipt-triage D6: the one rule, reported. Null when the capture may
   buy a paid call. */
stop: null | {
  reason: "key_missing" | "not_spei" | "wrong_destination";
  /* every field Banxico needs that the capture does not show */
  fields: ("trackingKey" | "amount" | "date" | "senderBank")[];
};
```

`extract` never throws on a stop: it reports it, and records the reading with
the stop's outcome (`key_missing`, `not_spei`, `wrong_destination`).

## New engine failures (receipt door only)

| Code | Thrown when | `retryable` | Billed |
| --- | --- | --- | --- |
| `RECEIPT_INCOMPLETE` | `stop.reason === "key_missing"` — revived; declared since proof-extraction D4, thrown by no door since two-eyes D3 | `false` | no |
| `RECEIPT_NOT_SPEI` | `stop.reason === "not_spei"` | `false` | no |
| `RECEIPT_WRONG_DESTINATION` | `stop.reason === "wrong_destination"` | `false` | no |

Each carries `extra.reading` (the payload a human can be shown), as
`RECEIPT_UNREADABLE` does. The lifecycle's catch is unchanged: every engine
failure is `retryLater(code)` (consta-api-merge D6); `retryable: false` is
still carried and not acted on (`consta/failure.ts`).

## The stop — `stopBeforeCredit(extracted, receivingAccounts)`

Pure; `consta/extraction/stop.ts`. Order and definitions in
[data-model.md](../data-model.md#stop-verdict-no-storage-beyond-the-outcome).
"Clear" (D7): `legibility === "full"` on a picture, or a text reading of a
PDF; a picture with `legibility` null, `partial` or `none` is never stopped
by this function (`none` keeps its own two-eyes refusal).

## Destination matching — `matchDestination(destination, accounts)`

Pure; `consta/extraction/destination.ts`. Returns `{ match: account } |
"none" | "unknown"`.

- Visible digits: `destination.digits` with everything but digits removed.
  Fewer than 3 → `"unknown"`.
- Forms of each account: a CLABE's 18 digits **and** its 11-digit account
  segment (positions 7–17); a card's 16; a phone's 10.
- The visible digits must **end** a form to match it. Exactly one account
  matched → `{ match }`; more than one → `"unknown"`; none → `"none"`.
- `destination.kind` narrows which forms are tried when it is known (`card`
  tries cards only, `account` tries CLABE account segments only); null tries
  all.

## Spin institution — `spinInstitution(reading)`

Pure. For a reading whose resolved sender bank is `SPIN BY OXXO`:
`bankForClabe(originAccount)` when the origin shows at least its first three
digits and they are `728` or `646`; otherwise `null`. For any other bank —
`STP` included, which carries many fintechs besides Spin's older accounts —
the field is absent and nothing changes (SC-010).
