# Data Model: cep-bundle-match

**Date**: 2026-09-27 · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

One additive migration, `0040_cep_bundle_match.sql`: two new tables, four
columns on `payments`, one on `extractions`, nothing dropped, renamed or
rebuilt. Every existing row reads NULL on the new columns and keeps today's
meaning. (If `0040` is taken between planning and implementation, the next
free number is used and this line is amended.)

## `cep_bundles` — a several answer (D1, D5, D16)

One row per provider answer that held a bundle. Written by the engine, in
the attempt that received it — only for a business; the platform's own
top-ups write neither table (D5).

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `id` | text | no | uuid |
| `business_id` | text | no | → `businesses.id`. Every read filters on it (constitution V) |
| `payment_ref` | text | no | The payment whose search received it (same meaning as `validations.payment_ref`) |
| `validation_id` | text | yes | → `validations.id`: the paid call that returned it |
| `source` | text | no | `apicep` today; `banxico_batch` and `upload` are spec 012's (FR-012) |
| `reference_number`, `transfer_date`, `sender_bank`, `amount_cents`, `beneficiary` | text / int | yes | The search keys it answered — what makes it reusable for the same keys (R14) |
| `status` | text | no | `pending` → `read` \| `unreadable` \| `too_large` (D16) |
| `download_attempts` | integer | no | Default 0; `unreadable` at 3 |
| `url` | text | yes | The provider's link, **only while `pending`**; cleared when read or given up. Never in any response schema (FR-010) |
| `claves` | text (JSON) | yes | The claves the entries' names carry, in entry order — the bundle's membership |
| `unreadable` | text (JSON) | yes | `[{ entry, reason }]` for entries that could not be read (FR-002) |
| `sha256` | text | yes | Of the file as downloaded |
| `r2_key` | text | yes | `bundles/<business_id>/<id>.zip` in `PROOFS` |
| `byte_size` | integer | yes | As downloaded |
| `created_at`, `read_at` | integer (ms) | no / yes | |

Index: `(business_id, payment_ref)`.

## `cep_records` — a transfer our searches returned (D4, D5, D13, D14)

One row per transfer, per business, that a search **without a clave**
returned — from a bundle or a single `valid`. Written by the engine; the
row is a fact read from Banxico's document and never changes after.

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `id` | text | no | uuid |
| `business_id` | text | no | → `businesses.id` |
| `clave` | text | no | The clave de rastreo: the entry name's, equal to the printed one (D3), or `cepDetails.trackingKey` |
| `bundle_id` | text | yes | → `cep_bundles.id`, the bundle it was first read from; NULL for a single `valid` |
| `operation_date` | text | no | `YYYY-MM-DD` (cadena position 2) |
| `credit_date` | text | no | `YYYY-MM-DD` (position 3) — the printed day |
| `credit_time` | text | no | `HH:MM:SS` (position 4) — Mexico City time |
| `credited_at` | integer (ms) | no | `credit_date` + `credit_time` in `America/Mexico_City` (D4) |
| `sender_bank` | text | no | As printed (position 6) |
| `sender_account_type` | text | no | `40`, `3`, `10`… (position 8) |
| `sender_account` | text | no | Whole (position 9). Under the business only; the panel shows its tail; never a payer (FR-010) |
| `receiver_spei_code` | text | no | Position 5 |
| `receiver_account_type`, `receiver_account` | text | no | Positions 13, 14 |
| `amount_cents` | integer | no | Position 18 by string parsing (constitution II) |
| `certificate_number` | text | no | Last position |
| `seal` | text | no | Base64, as printed or as `digitalSignature` |
| `seal_status` | text | no | `not_verified` — the only value today (D2) |
| `created_at` | integer (ms) | no | |

Unique: `(business_id, clave)` — the second sighting of a transfer, in
another bundle, adds nothing but the clave to that bundle's `claves`.
Index: `(business_id, credit_date, amount_cents)`.

Not stored, by construction: names, RFC/CURP, concept (D4).

**Derived, never stored** (R6):

- *used* — a live payment of the business holds the clave: `payments
  (business_id, tracking_key)` with `status NOT IN ('invalid', 'expired',
  'superseded')`, the predicate of the existing unique index.
- *unmatched* (US4) — a record no live payment holds.

## `payments` — the receipt side and the decision (D6, D8, D10, D15)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `transfer_time` | text | yes | The receipt's time as read, `HH:MM` or `HH:MM:SS` — the receipt side of D6. From the reading of every attempt that carries one — the first receipt-door attempt at the latest, whatever the outcome — never overwritten; NULL on typed rows |
| `sender_tail` | text | yes | The sender account's visible digits as read (3+ digits) — the receipt side of D7. NULL when the receipt shows none |
| `match_trail` | text (JSON) | yes | How a clave-less search was decided — see below. NULL for every row that never matched |
| `match_distance_s` | integer | yes | `d` of the chosen candidate in whole seconds (D6), whenever the receipt shows a time — even when the tail alone decided; NULL otherwise. What recalibrates the window |

`match_trail`:

```json
{
  "source": "several | single",
  "bundleId": "…",
  "decided": "chosen | undecided",
  "by": "tail | time | both | none | clave",
  "reason": "all_used | no_signal | too_close | none_fit | unreadable | too_large",
  "receipt": { "time": "07:10:58", "tail": "8301" },
  "candidates": [
    { "cepId": "…", "clave": "…", "creditTime": "07:11:20", "tail": "8301",
      "fate": "chosen | dropped | kept",
      "why": "used | tail | window | too_close | amount | account | unreadable" }
  ]
}
```

- `reason` only when `decided = "undecided"`; `by` only when `chosen` —
  `clave` when a typed clave fitted a kept candidate (D11).
- `tail` in a candidate is four digits of its sender account — what the
  panel may show (FR-010): the four the receipt's tail matched when it
  fitted the account number inside a CLABE (research R8), otherwise the
  account's last four (amended 2026-09-27, `consta/bundle/match.ts::shownTail`).
- Written by the lifecycle in the same update that confirms the row or
  marks it undecided (FR-013).

**State** (D10) — no new `status` value:

```text
validating ──several / single without clave──▶ matcher
   matcher ── one left ──▶ (promoted valid) ──▶ existing valid branch
                                                (confirmed | partial | unapplied | invalid …)
   (a chosen clave another payment took meanwhile → joins `used`, the matcher runs again — D18)
   matcher ── none / several ──▶ validating
                                  last_error = CEP_UNDECIDED
                                  disputed_fields = ["trackingKey"]
                                  next_validation_at = NULL   (no call, no expiry)
   bundle pending ──▶ validating, last_error = CEP_BUNDLE_PENDING,
                      next slot = download retry, no provider call
                      ── 3 failures ──▶ CEP_UNDECIDED (reason unreadable)
CEP_UNDECIDED ──payer sends a clave──▶ new row supersedes it (two-eyes D18)
                                  ──▶ D11 fit ──▶ promoted valid, no call
                                  ──▶ no fit  ──▶ ordinary clave search
```

**Derived for the public read** (D17): while `last_error = 'CEP_UNDECIDED'`,
the `/v1` payment carries `awaiting = "payer_tracking_key"` and
`awaitingReason` from `match_trail.reason` (`all_used`; `ambiguous` ←
`no_signal`, `too_close`; `no_match` ← `none_fit`; `unreadable` ←
`unreadable`, `too_large`). No column.

`last_error` gains two words: `CEP_UNDECIDED` (the bundle, or a single match,
did not decide — the payer is asked for the clave) and `CEP_BUNDLE_PENDING`
(the bundle has not been read yet — the next slot downloads, never calls).

## `extractions` — the reader's two answers (D15)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `sender_tail` | text | yes | The sender's visible account digits, as the reader returned them |

`transfer_time` (existing) now holds `HH:MM` or `HH:MM:SS`.

## `validations` — one more reason (D1)

`reason` gains `several` (TS enum only; SQLite text, no migration). On the
transfer door, `tracking_key` records the CEP's clave when the request had
none (D13).

## The matcher's types (D8)

```ts
type ReceiptSide = {
  time: string | null;        // "HH:MM" | "HH:MM:SS", Mexico City
  day: string | null;         // YYYY-MM-DD, the printed day
  tail: string | null;        // digits, ≥ 3
  amountCents: number;        // the search's amount
  accounts: RegisteredAccount[]; // the payment's snapshot (receipt-triage D30)
};
type Candidate = CepRecord;   // a row of cep_records, parsed
type MatchPolicy = { beforeS: 60; afterS: 180; marginS: 30 };
type MatchResult =
  | { decided: "chosen"; chosen: Candidate; by: "tail" | "time" | "both" | "none"; distanceS: number | null; trail: TrailCandidate[] }
  // "clave" is written to match_trail.by by the lifecycle for a D11 fit, never by the matcher
  | { decided: "undecided"; reason: UndecidedReason; trail: TrailCandidate[] };
```

`used` is a `Set<string>` of claves the caller read from `payments`.
