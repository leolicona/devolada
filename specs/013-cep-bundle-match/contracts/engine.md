# Contract: the engine — several matches, bundles, records, the matcher

**Feature**: cep-bundle-match · **Files**: `apps/api/src/consta/provider/
{apicep,types}.ts`, `consta/index.ts` (types), `consta/validate.ts`,
`consta/bundle/{zip,cep-pdf,cadena,match,store}.ts` (new),
`consta/extraction/reader.ts`

The engine is a component of `apps/api`, not a surface (constitution III):
this contract is between the engine and its callers in the same Worker — the
payment lifecycle (`direct-payments/validation.ts`), the `/read` route, and
the top-up lifecycle (`credit/topups.ts`, which a several answer reaches as
it reaches any caller: it keeps today's clave rule and treats `several` as
it treats `not_found`). On a platform-owned call (`{ platform: true }`) the
engine downloads no bundle and writes no record: both tables belong to a
business. Additions only; no field changes meaning.

## Provider adapter (D1, D4)

`ApiCepResponse` reads `validation.banxicoConfirmed?: boolean | null` and,
in `cepDetails`, `processingTime`, `cdaChain`, `senderAccountType`,
`senderAccount`, `certificateNumber`.

```ts
export type InvalidReason = "contradicted" | "not_found" | "several";

// ProviderVerdict.cep gains (all nullable; read from cepDetails):
creditTime: string | null;        // processingTime, "HH:MM:SS"
chain: string | null;             // cdaChain — parsed by parseCadena (D4)
senderAccountType: string | null;
senderAccount: string | null;
certificateNumber: string | null;
```

`mapVerdict`, before the `not_found` branch:

```ts
if (body.status === "invalid" && body.validation?.banxicoConfirmed === true
    && !body.validation?.cepDetails && !body.validation?.cepStatus
    && body.downloads?.cepPdf)
  return { status: "invalid", reason: "several" };
```

`downloads` keeps travelling on the verdict as today; the engine is its
only reader, and no response schema carries it (FR-010).

## `ConstaVerdict` additions

```ts
/* cep-bundle-match D1/D5: set when the provider answered several. */
bundle?: {
  id: string;
  status: "read" | "pending" | "unreadable" | "too_large";
  candidates: CepRecord[];   // every readable record of the bundle, new or already held
  unreadable: { entry: string; reason: string }[];
};
/* D5/D9: the record of a single valid's CEP, when the search was clave-less */
record?: CepRecord;
```

`CepRecord` is a row of `cep_records` in camelCase (data-model.md), with no
name and no RFC.

## `validate()` on a several answer (D1, D3, D5, D16)

In the same call, after the billing row is written with `reason:
"several"`:

1. Download `downloads.cepPdf` — only when `APICEP_STORAGE_ORIGIN` is set
   and the link's origin equals it (else `unreadable`, no fetch); no auth
   header, 10 s deadline, 4 MB cap.
2. Sniff: `PK\x03\x04` → ZIP; `%PDF-` → one CEP; anything else →
   `unreadable`.
3. List the entries; for each name matching
   `^CEP-\d{8}-([A-Z0-9]{6,30})\.pdf$` (apiCEP) or
   `^\[\d{4}-\d{2}-\d{2}\]([A-Z0-9]{6,30})\.pdf$` (Banxico, spec 012), take
   the clave; skip inflating a clave the business already holds as a
   record.
4. Read each new entry (`cep-pdf.ts`), parse its cadena (`cadena.ts`),
   check the printed clave equals the name's; insert `cep_records`
   (ignore on conflict `(business_id, clave)`).
5. Put the file in `PROOFS` at `bundles/<business_id>/<bundle_id>.zip`;
   write `cep_bundles` with `status = "read"`, `claves`, `sha256`, and
   `url = NULL`.
6. Return `status: "invalid", reason: "several", bundle`.

A failed download writes the bundle `pending` with the URL and
`download_attempts = 1`, and returns `bundle.status = "pending"` with no
candidates. Over the cap: `too_large`, URL cleared, nothing stored in R2.

## `readPendingBundle(bundleId)` — the retry (D16)

```ts
readPendingBundle(owner: { businessId: string }, bundleId: string):
  Promise<NonNullable<ConstaVerdict["bundle"]>>
```

Steps 1–5 again, **no provider call and no `validations` row**. The third
failure sets `unreadable` and clears the URL.

## `validate()` on a single `valid` without a clave (D5, D9, D13)

When the search was clave-less (D9: the transfer door asked by reference, or
neither reading on the receipt door carried a clave the gate passed) and
the answer is `valid`: parse `cep.chain`, insert the
record (ignore on conflict), and return it as `record`. On the transfer
door the billing row's `tracking_key` is the CEP's clave when the request
had none (D13).

## The matcher (D6, D7, D8) — `consta/bundle/match.ts`, pure

```ts
export const MATCH_POLICY = { beforeS: 60, afterS: 180, marginS: 30 } as const;

export function matchCandidates(
  receipt: ReceiptSide,
  candidates: CepRecord[],
  used: ReadonlySet<string>,
  policy = MATCH_POLICY,
): MatchResult;
```

Order, each step recording `why` on what it drops:

1. **integrity** — `amountCents ≠ receipt.amountCents` → `amount`; a
   `receiverAccount` that ties to none of `receipt.accounts` (the
   `tieCepAccount` rule of receipt-triage D22) → `account`.
2. **used** — `used.has(clave)` → `used`.
3. **tail** — only when `receipt.tail` has ≥ 3 digits; D7's rule by
   account type → `tail`.
4. **window** — only when `receipt.time` is set; outside `[−beforeS,
   +afterS]` → `window`; among those inside, the nearest by `|d|`, unless
   the two nearest were credited within `marginS` → both `too_close`.

Result: one left → `chosen` (`by` names which of tail and time dropped
something; `none` when neither was needed); zero → `undecided` with
`all_used` when step 2 dropped every candidate, else `none_fit`; several →
`undecided` with `too_close` when step 4 said so, else `no_signal`.

## The clave fit (D11) — `consta/bundle/match.ts`, pure

```ts
export function fitClave(typed: string, candidates: string[]): string | null;
```

Normalises both sides (uppercase, O→0, I→1), accepts an exact match or the
typed clave equal to a candidate with one character removed; returns the
candidate only when exactly one fits.

## The reader (D15)

- `FIELDS` gains `"cuentaOrigen": "<the visible digits of the account the
  money was sent FROM, without asterisks, or null>"`; `RULES` gains the
  sender-side labels and "never the destination's digits".
- `hora`: `"HH:MM:SS"` when the receipt prints seconds, else `"HH:MM"`.
- `Reading.time` is `HH:MM` or `HH:MM:SS`; `Reading.senderTail: string |
  null` (≥ 3 digits, else null).
- `QUESTIONS_VERSION` moves to `"3"`; the pinned prompt hash moves with it.
- `ourReading` rides every outcome of a provider-first call (`valid`,
  `several`, `not_found`, `pending`): the lifecycle builds the receipt side
  from it on the first receipt-door attempt (D8, analyze I1).
- `ConstaReading` (the verdict's `ourReading`, and `/read`'s answer) gains
  `time: string | null` and `senderTail: string | null`.

## The shared-reference stop (D12)

`hooks.referenceTaken` on the receipt door is asked only when the reading
has neither `time` nor `senderTail`.
