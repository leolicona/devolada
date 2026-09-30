# Contract: internal — phone, reference, adapter, matcher, lifecycle

**Feature**: payment-without-receipt · **Decisions**: D1–D6, D9–D17, D19
· Internal to `apps/api`; nothing here crosses a wire.

## `nationalPhone(raw)` — `apps/api/src/phone.ts` (D2)

```ts
/* Ten digits after removing a leading 52 or 521; anything else is no
   phone. toWhatsAppPhone (receipt/index.ts) becomes `52` + this. */
export function nationalPhone(raw: string | null | undefined): string | null;
```

## Adapter capability `customersWithPhone` (D4)

Declared in `integrations/capabilities.ts` beside `receivables` and
`customerDebt`; offered by WispHub's adapter; the core asks
`capabilitiesOf(integration).customersWithPhone`.

```ts
/* Every customer of this business whose phone normalises to `phone`,
   with its name. The adapter pages to the end; the core groups by name,
   and stores neither the phone nor the names. */
customersWithPhone(phone: string): Promise<{ usuario: string; firstName: string; lastName: string }[]>;
```

WispHub: `telefono__contains=<last seven>` on the customers list, paged at
50, each result's `telefono` through `nationalPhone`, kept only when equal.
A refused key or an outage throws `IntegrationError`; the caller makes no
reference (D5).

## `ensurePayerReference` — `apps/api/src/direct-payments/payer-reference.ts` (D1, D3–D6)

```ts
export async function ensurePayerReference(
  db, env, business, integration,
  customer: { source: "panel" | "api"; key: string; phone: string | null },
): Promise<PayerReference | null>;   // null: feature off, or the count could not be made
```

1. The customer already holds a reference → it.
2. `nationalPhone(phone)` null, or its last seven fail D3 → a new
   assigned number (at random, no pattern).
3. Read `customersWithPhone(phone)` and group by `personName(first, last)`
   (lower case, no accents, spaces collapsed). This customer's person is
   its name's group.
4. A customer of that group already holds a reference → join it.
5. The digits exist in the business:
   - as another person's `phone` reference (another name got them first,
     or another phone ends the same) → an assigned number;
   - as another person's `assigned` number → D26: the row passes to this
     person (`origin = phone`), its previous holders move to a new
     assigned row, `previous_reference_id` and `transition_ends_at`
     (+60 days) are set.
6. New digits → a `phone` reference for this person: the first to receive
   them keeps them, whatever other names the phone carries.

`assignNumber(db, business)` draws until an insert under the unique
`(business_id, digits)` succeeds (D6). Only this function and the D26 pass
write `payer_reference_customers`: the panel has no action that changes a
reference (clarified 2026-09-30).

## The backfill sweep (D5)

`backfillPayerReferences(env, db, now)` joins the chain in `src/index.ts`
after `sweepDirectPayments`: for each business with `pay_by_reference = 1`,
up to twenty links without a holder row, oldest first. Speaks only when it
assigned something.

## Matcher (D10, D11, D17) — `consta/bundle/match.ts`, still pure

```ts
export type ReceiptSide = {
  /* …existing fields… */
  /* D11: whole accounts learned for the service; compared before the tail */
  knownAccounts?: string[];
  /* D26: during a transition, the previous holder's learned accounts —
     never chosen for the new owner */
  excludedAccounts?: string[];
};
export type MatchMode = "receipt" | "own" | "typed";

export function matchCandidates(receipt, candidates, used, policy = MATCH_POLICY, mode: MatchMode = "receipt"): MatchResult;
export function fitClaveTail(tail: string, candidates: string[]): string | null;
```

- `own`: integrity → used → (during a D26 transition) every candidate
  from `excludedAccounts` — the previous holder's learned accounts —
  dropped → the candidates from `knownAccounts` first → earliest
  `creditedAt`. `by: "learned_account" | "earliest"`. During a transition,
  a chosen candidate from an account not in `knownAccounts` is held and
  asks `sender_tail` (FR-041). Undecided only as `all_used`.
- `typed`: integrity → used → `knownAccounts` → tail (the typed four) →
  window (never used: typed rows carry no time). `by: "learned_account" |
  "sender_tail"`. Undecided otherwise, as today.
- `receipt`: exactly today's order and answers.
- `fitClaveTail`: `fitClave`'s reading (O as 0, I as 1) on each
  candidate's last four characters; one fit or none.

## Records for every `valid` (D13)

`consta/validate.ts` calls `storeSingleRecord` for every `valid` of a
business, clave searches included (spec 013 D5 widened). The platform's
own top-ups still write nothing.

## Quota (D19) — `consta/provider/apicep.ts`

Where telemetry reads `X-RateLimit-Remaining` (`apicep.ts:119-124`), the
adapter also upserts `provider_quota ('apicep', remaining, now)`. A failed
upsert is a lost observation, never a failed validation.

## Lifecycle (D8, D9, D14–D17) — `direct-payments/validation.ts`

- Rows with `reference_source` skip every shared-reference stop (D9).
- `ladder_round` rises by one on an attempt that got an answer; round 3
  searches the neighbouring days (D14); after round 4 the next slots are
  the 2-hour one and the last one; after round 6 the row expires.
- `typed`: the matcher gets `knownAccounts` for the chosen bank and the
  typed tail; no fit without a tail leaves the row validating with its
  candidates kept and `ask` derived as `sender_tail`; a correction with the
  four digits is fitted against them without a call.
- `claveTail` on a row that supersedes an undecided one → `fitClaveTail`
  against the kept candidates; one fit confirms from the record, as spec
  013 D11 does for a whole clave.
- On confirmation: `confirmation.days` gains every day searched; the
  confirming account is learned by the D12 query, with no mark.
- A correction inherits `ladder_round` and `correction_count` from the row
  it supersedes, then searches at once.
