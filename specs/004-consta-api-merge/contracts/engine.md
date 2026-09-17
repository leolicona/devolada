# Contract: the engine

**Feature**: consta-api-merge · **Module**: `apps/api/src/consta/`

The engine has no HTTP surface after this feature. Its contract is the
in-process facade below, consumed by three callers inside `apps/api` and by
the engine's own tests. Every type named here already exists in
`apps/api/src/consta/client.ts`; what changes is how a caller obtains an
engine and what a receipt request carries.

## Obtaining an engine

```ts
import { consta, type Owner } from "../consta";

type Owner = { businessId: string } | { platform: true };

const engine = consta(env, db, owner);
```

| Argument | Meaning |
| --- | --- |
| `env` | The API's `Bindings`. The engine reads `APICEP_TOKEN`, `APICEP_BASE_URL`, `APICEP_DEADLINE_MS`, `AI`, `EXTRACTION_MODEL`, `PROOFS`, `API_BASE_URL`, `BETTER_AUTH_SECRET` (the last two only to sign a proof link for the provider) |
| `db` | The API's Drizzle database. The engine writes `validations` and `extractions` and reads them for the trust block, the shape rules and the retry suggestion |
| `owner` | Who every row this engine writes belongs to (data-model *Owner*). No key, no token |

**Guarantees**

- No network call except to the provider, and — when the provider must read
  a file — the provider's fetch of the signed proof link the engine built.
- Absent `APICEP_TOKEN`: `validate` throws `PROVIDER_NOT_CONFIGURED`
  (retryable) without touching anything. Callers gate on `speiAvailable`
  first, so a payer never reaches this; the sweep can, for a payment already
  in flight, and it rides the schedule.
- Absent `AI`: an image degrades to the provider's OCR route (proof-extraction
  D5). Never a failure.

## `engine.validate(request) → Promise<ConstaVerdict>`

### Request

```ts
type ConstaRequest = (
  | { transfer: { date; amountCents; senderBank; trackingKey; beneficiary } }
  | { receipt: { proofKey: string }; beneficiary; providerOcr?: true }
) & { customerRef?: string; paymentRef?: string };
```

| Field | Change |
| --- | --- |
| `transfer.*` | unchanged — amount in cents, date `YYYY-MM-DD`, bank from the vocabulary, clave 6–30 alphanumerics |
| `receipt.proofKey` | **replaces `receiptUrl`.** A key in `PROOFS` (a direct payment's `proof_key` or a top-up's). The engine reads the bytes itself (research R6) |
| `providerOcr` | unchanged — keep the image on the provider's door (proof-extraction D11) |
| `customerRef` | **meaning changed** — the link's own customer identity: its `customer_usuario` for a panel link, its `customer_ref` for an API link (`003`); sent by the payment path on every call; omitted by top-ups |
| `paymentRef` | unchanged — `payments.id` |

The request guard (`consta/request.ts`, Consta D12/D13/D17) runs first. A
request it refuses throws `REQUEST_REJECTED` with `issues`; nothing is
written and nothing is spent.

### Verdict

`ConstaVerdict` is unchanged, field for field:

```ts
{
  validationId: string;                 // validations.id — local now
  source?: "reader" | "provider-ocr";   // which door read the file (D2)
  extractionId?: string;                // extractions.id, when a file was read
  shape?: "ok" | "mismatch" | "unknown";
  status: "valid" | "pending" | "invalid";
  reason?: "contradicted" | "not_found";
  hint?: "verify_inputs";
  retryAfter?: string;                  // learned-retry, ISO 8601, or absent
  cepStatus?: string;                   // only with reason "contradicted" (D18)
  alreadyValidated: boolean;
  cep?: { trackingKey; amountCents; date; senderBank; senderName; receiverBank; beneficiaryName };
  reading?: { trackingKey; amountCents; date; senderBank; referenceNumber } | null;
  downloads?: { cepXml?; cepPdf? };
  trust?: ConstaTrust;                  // on pending / not_found, when customerRef travelled
}
```

**Guarantees** (the rules are the engine's, moved verbatim; the list is what
the API's tests hold it to):

- `invalid` always carries a `reason`. There is no wire on which it can be
  missing.
- `not_found` never comes with `cepStatus`; `contradicted` comes with it when
  Banxico said one (D18).
- `trust` rides exactly `pending` and `not_found`, and only when
  `customerRef` was sent; never `valid`, never `contradicted` (trust-layer
  D5). The payment in flight is excluded from its own evidence (D3).
- `retryAfter` rides the same two verdicts, and is absent in cold start
  (learned-retry D5).
- Every `validate` that got an answer from the provider wrote exactly one
  `validations` row under `owner`, verdict or billed failure alike (D15).

### Failure

```ts
class ConstaError extends Error {
  code:
    | "PROVIDER_NOT_CONFIGURED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_RATE_LIMITED"
    | "PROVIDER_AUTH_FAILED" | "REQUEST_REJECTED" | "RECEIPT_UNREADABLE"
    | "RECEIPT_INCOMPLETE"
    | "READER_UNAVAILABLE" | "READER_UNREADABLE"
    | "PROOF_NOT_FOUND" | "PROOF_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE";
  retryable: boolean;
  retryAfter: string | null;
  hint: string | null;
  missingFields: string[] | null;
  issues: { path: string; message: string }[] | null;
  reading: Record<string, unknown> | null;
}
```

The class keeps its name so the three callers' `e instanceof ConstaError`
keeps compiling. `retryable` is carried and **not yet acted on**: every
caller does `retryLater(e.code)` as today (research R5). `PROOF_NOT_FOUND` is
new — the key named no object in the bucket — and is not retryable.

> Corrected at implementation (T053). The list above said eleven codes;
> the engine has twelve: `RECEIPT_INCOMPLETE` is the engine's own gate
> refusal (proof-extraction D4 — a reading that passed the reader but not
> the gate), which the service answered as a 422 and the plan's count
> missed. It is not retryable and rides the schedule like every other
> failure (FR-011). The optional fields are `null`, never absent, on the
> class; and `reading` carries what the reader saw on the two receipt
> refusals, where the service put it in the envelope. The class lives in
> `consta/failure.ts` and is re-exported from `consta/index.ts`, so the
> two functions that throw it need not import the facade that imports
> them; the public surface is the one this contract names.

## `engine.extract({ proofKey }) → Promise<ConstaReading>`

Spends a reader call and never a provider credit (proof-extraction D6).
`ConstaReading` is unchanged:

```ts
{
  extractionId: string;
  source: "reader" | "provider-ocr";
  isReceipt: boolean | null;
  trackingKey; senderBank; amountCents; date; receiptStatus;   // each nullable
  gate: { trackingKey: "ok"|"malformed"|"missing"; senderBank: "ok"|"unknown"|"missing";
          amount: "ok"|"malformed"|"missing"; shape: "ok"|"mismatch"|"unknown" };
  suggestedBank?: string;
}
```

Writes exactly one `extractions` row under `owner`, whatever the outcome
(D9). Throws `ConstaError` with a `READER_*`, `PROOF_*` or
`UNSUPPORTED_MEDIA_TYPE` code.

## What the three callers do with it

| Caller | Owner | Call | What changes in the file |
| --- | --- | --- | --- |
| `direct-payments/validation.ts` | `{ businessId: business.id }` | `validate` on the transfer door, the receipt door (`receipt: { proofKey }`), and the cross (`providerOcr: true`) | The `refs` block becomes `{ customerRef: <the link's customer identity>, paymentRef: payment.id }` unconditionally — `link.customerUsuario` today, `link.customerRef` for an API link once `003` adds it; `signedProofUrl` calls leave; the `CONSTA_*` env gate becomes `APICEP_TOKEN`; `constaKey` disappears |
| `credit/topups.ts` | `{ platform: true }` | `validate` on either door | Same, without refs |
| `routes/direct-payments/handler.ts` (`readProof`) | `{ businessId: business.id }` | `extract({ proofKey: proofId })` | The 503's code becomes `READER_UNAVAILABLE` |

`speiAvailable(env, business, integration)` keeps its signature and its
meaning — "the channel exists only when the ISP configured its own account
and the engine can reach the provider in this environment" — reading
`env.APICEP_TOKEN` in place of the pair.

## The HTTP surface after this feature

| Route | Status |
| --- | --- |
| Consta `POST /validate`, `POST /extract`, `GET /banks`, `POST`/`DELETE /admin/keys`, `GET /health` | **Gone** with the Worker (spec Q1) |
| API `POST /direct-payments/links/:token/pay`, `…/proof`, `…/read`, `GET /direct-payments/:id/status` | Unchanged contracts (`direct-payments/schema.ts` is not edited). `…/read` answers `503 { code: "READER_UNAVAILABLE" }` where it answered `CONSTA_UNAVAILABLE`; the page never reads the code |
| API `GET /direct-payments/proofs/:linkId/:file` | Unchanged — the provider fetches through it (direct-payment D12) |
| API `POST /businesses` | Unchanged contract; stops minting a key on birth |

No `retryable` property is emitted by any API route. The engine's
`retryable` lives on the in-process failure only.
