# Contract: the engine's receipt door

**Feature**: two-eyes-receipt · **Module**: `apps/api/src/consta/`

The engine keeps its in-process facade (`consta(env, db, owner)` →
`{ validate, extract }`, consta-api-merge D2). What changes is what the
receipt door does with a file and what its verdict and its reading carry.
Base contract: `specs/004-consta-api-merge/contracts/engine.md`.

## `engine.validate(request)` — the receipt door

### Request (unchanged shape)

```ts
{ receipt: { proofKey: string }; beneficiary; providerOcr?: true; customerRef?; paymentRef? }
```

`providerOcr` keeps its meaning (skip the edge reading; the provider's eyes
only) and is used by the product only for the legacy minute-two cross (D16).
A request without it takes the flow below.

### Flow (D2, D3, D5–D8, D11, D12, D14, D15)

1. Load the file from the bucket by its key; refuse over the ceiling or an
   unrecognised type (`PROOF_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`), as today.
2. Obtain our reading: reuse a reading of the same file for the same owner
   younger than 15 minutes (D14); else read — a picture through the vision
   prompt, a PDF through text conversion then the text prompt (D1), an
   empty reading when the binding is absent, the conversion yields nothing
   or the model output cannot be parsed (D15, FR-005).
3. Refuse before spending, and only then: `isReceipt === false` or
   `legibility === "none"` → throw `ConstaError("RECEIPT_UNREADABLE",
   retryable: false, { reading })` and write the extraction row with outcome
   `not_a_receipt` or `illegible`. Nothing else refuses (FR-004, FR-005).
4. Send the file to the provider's image door with the signed link, our
   reading kept aside. One credit.
5. On the verdict:
   - `valid`, `pending`, `contradicted` → return as today, plus `ourReading`.
   - `not_found` → classify (contracts below), write the extraction row with
     both readings and the classification, return the verdict with the
     classification.
   - the provider's own OCR failure (`status: "error"`, `missingFields`) →
     the billed row is written as today; the verdict is `invalid` /
     `not_found` with `readingCheck: "blind"`, `blindSide: "provider"`
     (D12). No `RECEIPT_UNREADABLE` is thrown on this path.
6. Every other failure (`PROVIDER_*`, `REQUEST_REJECTED`) is unchanged.

### Verdict additions

```ts
type ConstaVerdict = {
  // … everything in the base contract …
  source?: "reader" | "provider-ocr";        // "provider-ocr" on every provider-first call
  reading?: ProviderReading | null;          // the provider's, as today
  ourReading?: {                             // new: what the engine read, gated
    trackingKey: string | null;              // null unless the gate said ok
    senderBank: Bank | null;
    amountCents: number | null;
    date: string | null;
    legibility: "full" | "partial" | "none" | null;
  } | null;
  readingCheck?: "agreed" | "disputed" | "blind";
  disputedFields?: ("trackingKey" | "amount")[];
  blindSide?: "provider" | "reader" | "both";
  accepted?: {                               // what the next attempts carry through the transfer door
    trackingKey: string;
    senderBank: Bank;
    amountCents: number;
    date: string | null;                     // null → the caller asks the payer for the date
  } | null;
  acceptedFrom?: "agreed" | "reader" | "provider";
};
```

`readingCheck`, `disputedFields`, `blindSide`, `accepted`, `acceptedFrom`
are present exactly when the first call answered `not_found` (or the
provider was blind) on a provider-first call; absent on `valid`, `pending`,
`contradicted`, on the transfer door, and on a legacy `providerOcr` cross
(whose caller classifies as today).

### Classification (D5–D8; research R3)

| Ours (gate ok) | Theirs | Compare clave + amount (cents, exact; clave case-insensitive) | `readingCheck` | `accepted` / `acceptedFrom` |
| --- | --- | --- | --- | --- |
| both fields | clave present | equal | `agreed` | agreed data / `agreed` |
| both fields | clave present | differ; ours fits the shape, theirs not | `disputed` | ours / `reader` |
| both fields | clave present | differ; theirs fits, ours not | `disputed` | theirs / `provider` |
| both fields | clave present | differ; otherwise | `disputed` + `disputedFields` | null |
| both fields | no clave | — | `blind`, `blindSide: provider` | ours / `reader` |
| a field missing | no clave | — | `blind`, `blindSide: both` | null |
| no clave | clave present | — | `blind`, `blindSide: reader` | theirs / `provider` unless the shape says `mismatch` → null |

"Fits" is `checkShape(rules, bank, clave) === "ok"`; `unknown` (no rule,
unresolvable bank) is "no rule". A bank-name or date difference never
disputes. The date in `accepted` is ours, else theirs, else null.

### Guarantees

- Exactly one provider credit per `validate` call, as today.
- At most one model call per file per 15 minutes per owner (D14), and one
  free conversion per PDF.
- Absent `AI`: the file still goes to the provider; `ourReading` is null;
  a `not_found` classifies as `blind`, `blindSide: reader` (FR-005,
  constitution VIII).
- A refusal (step 3) spends nothing and writes one extraction row.

## `engine.extract({ proofKey })` — the reading door

Unchanged in shape; `ConstaReading` gains one field:

```ts
type ConstaReading = {
  // … as today …
  source: "reader" | "provider-ocr";   // a PDF with text is "reader" now (D1)
  legibility: "full" | "partial" | "none" | null;
};
```

A PDF with text returns a draft like a picture's. A PDF without text
returns `source: "provider-ocr"`, every field null, `legibility: null` —
the caller (the page) treats it exactly as it treats a reader that is down
(FR-002). The reading door never reuses (research R8) and never throws for
a hole; it throws `READER_UNAVAILABLE` only when nothing could be read at
all, as today.

## Failure codes

| Code | Retryable | When |
| --- | --- | --- |
| `RECEIPT_UNREADABLE` | no | step 3 only: not a receipt, or not legible at all; and on a legacy `providerOcr` cross when the provider could not read (unchanged) |
| `RECEIPT_INCOMPLETE` | — | **no longer thrown** by the receipt door (a hole goes to the provider). The code stays declared for callers that still switch on it |
| others | | unchanged |
