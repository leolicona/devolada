# Contract: the validation engine facade


**Feature**: receipt-triage · **Files**: `apps/api/src/consta/index.ts`
(types), `consta/validate.ts`, `consta/extract.ts`, `consta/failure.ts`,
`consta/extraction/{reader,gate,compare,ask,destination}.ts`,
`consta/provider/apicep.ts` (one comment)

The engine is a component of `apps/api`, not a surface (constitution III):
this contract is between the engine and its callers in the same Worker — the
payment lifecycle (`direct-payments/validation.ts`), the `/read` route, and the
top-up lifecycle (`credit/topups.ts`), which changes only as the spec's Edge
Cases say. Additions only; nothing is renamed and no field changes meaning.

## `ConstaBeneficiary` — widened (D9, D22)

```ts
export type ConstaBeneficiary =
  | { bank: string; clabe: string; name?: string }        // 18 digits
  | { bank: string; cardNumber: string; name?: string }   // 16 digits
  | { bank: string; phoneNumber: string; name?: string }; // 10 digits
```

Exactly the shapes `beneficiarySchema` already validates (`consta/request.ts`)
and the adapter already passes through. The same-institution guard
(validation.spec.md D17) applies to all three, as today.

## `ConstaRequest`

**Transfer variant — a key, not a clave (D1, D11):**

```ts
transfer: {
  date: string;
  amountCents: number;
  senderBank: string;
  trackingKey?: string;      // receipt-triage D1: exactly one of the two —
  referenceNumber?: string;  // the reference only when there is no clave
  beneficiary: ConstaBeneficiary;
};
```

The request guard already enforces "at least one" and refuses a request with
neither as `REQUEST_REJECTED` before any credit.

**Receipt variant — one account, and the accounts to tie against (D22,
re-planned 2026-09-24):**

```ts
receipt: { proofKey: string };
beneficiary: ConstaBeneficiary;               // the cuenta de cobro snapshot
/* receipt-triage D30: the payment's registered accounts at submission,
   current and retired — what the destination is tied against. Never sent
   to the provider. Omitted by a top-up (its one CLABE is `beneficiary`). */
receivingAccounts?: (ConstaBeneficiary & { retired?: true })[];
providerOcr?: true;                           // unchanged: the legacy cross only
/* receipt-triage D27 (FR-027): a payment born before this feature — the
   engine reads as today but skips the ask and the destination tie, so the
   row finishes under the flow it started in */
legacy?: true;
```

The engine (1) reads the file as today; (2) runs the ask against
`receivingAccounts` (or `[beneficiary]` when omitted); (3) ties the reading's
destination (`tieDestination`): tied to one account → the provider call
names **that** account, retired ones included (FR-020a); unknown → it names
`beneficiary`; (4) reports what it named in `beneficiaryUsed`, with
`retired: true` when it was a retired account. The product no longer sends
`potentialBeneficiaries`: the engine keeps accepting it for other callers
(its guard and adapter are unchanged), and D23's list door is retired.

## `ConstaVerdict` — additions

```ts
/* receipt-triage D22/D30: the account the provider call named on the
   receipt door, `retired` when it was one the ISP removed; absent on the
   transfer door, whose caller chose. The lifecycle stores it on the
   payment (D25) and holds a `retired` confirmation for the ISP (D31). */
beneficiaryUsed?: (ConstaBeneficiary & { retired?: true }) | null;
/* receipt-triage D22 (amended 2026-09-24): on `valid`, `cep` also carries
   Banxico's own word on the receiving account — documented by the
   provider, dropped by the adapter until now. Whole or masked is
   unmeasured, so the lifecycle ties it with `tieDestination`. */
cep?: { …; beneficiaryAccount: string | null; beneficiaryAccountType: string | null } | null;
/* receipt-triage D13: the accepted data carries both keys */
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

## `ConstaReading` (`extract`) — the reference, the destination and the ask

```ts
extract(input: {
  proofKey: string;
  /* receipt-triage D15: the ISP's accounts, so the ask can judge the
     destination. Omitted → the destination is never a mismatch and never
     asked for. The receipt door always has them in its request — a
     top-up's is the platform's CLABE, so a top-up receipt sent to another
     account is stopped too (spec Edge Cases). */
  receivingAccounts?: (ConstaBeneficiary & { retired?: true })[];
}): Promise<ConstaReading>;
```

The reading gains:

```ts
referenceNumber: string | null;   // only when the gate says ok
destination: { kind: "clabe" | "card" | "phone" | "account" | null; digits: string | null };
gate: { …, referenceNumber: "ok" | "malformed" | "generic" | "missing" };
/* receipt-triage D15: the one rule, reported. Null when the capture may
   go on to the paid call. */
ask:
  | null
  | { reason: "no_key"; fields: ("key" | "amount" | "date" | "senderBank")[]; shared?: true }
  | { reason: "wrong_destination" };
/* receipt-triage D24/D30: the account the destination tied to, when it
   did — used by the pay handler to snapshot `beneficiary`; never sent to
   the page (re-planned 2026-09-24) */
tiedAccount: (ConstaBeneficiary & { retired?: true }) | null;
```

`extract` never throws on an ask: it reports it, and records the reading with
outcome `key_missing` or `wrong_destination`.

## The receipt door enforces the ask

Before the provider call, after reading (or reusing the draft's reading,
two-eyes D14): when `askBeforeCredit(extracted, accounts)` is not null, the
engine records the reading and throws

| Code | When | `retryable` | Billed | `extra` |
| --- | --- | --- | --- | --- |
| `RECEIPT_INCOMPLETE` — revived; declared since proof-extraction D4, thrown by no door since two-eyes D3 | `no_key` | `false` | no | `reading`, and `missingFields` = the ask's fields |
| `RECEIPT_WRONG_DESTINATION` — new | `wrong_destination` | `false` | no | `reading` |

The lifecycle's catch is unchanged: every engine failure is `retryLater(code)`
(consta-api-merge D6).

Definitions of the ask and of `tieDestination`:
[data-model.md](../data-model.md#the-ask-no-storage-beyond-the-outcome).

## The comparison (`compareReadings`, pure) — D13

- The **key** of a comparison is the clave when either reading found one; the
  reference otherwise.
- Key = reference: equal (as text) → `agreed`; different → `disputed` with
  `referenceNumber`; one side missing → `blind` on that side. The shape rules
  are never consulted for a reference; a disputed reference is asked of the
  payer.
- Key = clave: exactly today's rules. The reference, when read, rides along
  in `accepted` from whichever side read it (ours first), and never travels
  while the clave does (D1).
- **The fallback (clarified 2026-09-24).** Key = clave, the claves disagree,
  the shape rules settle nothing, the clave is the only field in doubt, and
  both readings hold the same reference with gate `ok` → `readingCheck:
  "disputed"`, `disputedFields: []`, `accepted: { trackingKey: null,
  referenceNumber, … }`. Anything short of that — one side's reference, two
  different ones, the amount also in doubt — is today's dispute. When the
  reference's search then finds nothing, the lifecycle asks for the clave
  or the reference (data-model.md, State and transitions).

## The provider's "more than one" answer — D17

Unchanged in the engine: a 422 on the transfer door throws
`REQUEST_REJECTED` with `retryable: false` and `hint: "provide_tracking_key"`.
What changes is the caller: the lifecycle reads the hint, asks for the clave,
and stops calling (data-model.md, State and transitions). The comment in
`provider/apicep.ts` that says Devolada "cannot hit" this answer is rewritten:
it can now.
