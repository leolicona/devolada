# Data Model: confirmation-hierarchy

**Date**: 2026-09-30 · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

This feature adds one column and one index to what spec 012 adds
([012 data-model](../012-payment-without-receipt/data-model.md)). Both join
012's migration, `0041_payment_without_receipt.sql`, because the two
features are built together (D1); if 012's migration has landed first,
they take the next free number. Nothing is dropped, renamed or rebuilt.

*Amended 2026-10-01 (tasks T002):* 012's migration had landed on `main`
(#261), so both live in their own additive migration,
`apps/api/migrations/0042_confirmation_hierarchy.sql`.

## `payments` — one column (D6, D7, D8)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `tie_break` | text | yes | The outcome of the tie-break answer this row carried: `none` (it fitted no candidate), `one` (it picked one), `several` (it left more than one). NULL on every row that carried no answer |

Columns that already exist, or that 012 adds, carry the answer itself:

- `sender_tail` — the four digits the payer typed (exists; 012 D11 reuses
  it for typed digits).
- `clave_tail` — the four characters the payer typed (012 D17).
- `supersedes_id` — the waiting row the answer supersedes (exists).
- `match_trail` — the candidates, copied from the waiting row onto a row
  whose answer fitted nothing (D6); on a confirmation, `by` names what
  decided it: `learned_account`, `sender_tail`, `clave_tail`, or `clave`
  (012 D23).
- `confirmation` (012 D23) gains `tieBreakMisses`: the answers of the
  chain that fitted nothing, counted when the payment confirms (FR-019).

No new `status` word and no new `last_error` word: a row waiting on a
tie-break is spec 013's undecided row (`validating`, `CEP_UNDECIDED`).

## `cep_records` — one index (D4)

`index("cep_records_business_account_idx").on(businessId, senderAccount)`
— the exclusivity lookup reads the payments an account has paid, by
account. The table and its rules are spec 013's; every `valid` writes a
row since 012 D13.

## Derived, never stored

**Persons an account has paid** (D4) — for one business and one sending
account: the confirmed or partial payments whose `tracking_key` has a
`cep_records` row from that account → their links → the customers
(`source` + usuario or customerRef) → each customer's `payer_references`
row, or none.

**Exclusive account** (D4, FR-015) — an account whose paid customers all
hold this person's reference. A customer with no reference is another
person, unless it is the customer being confirmed. Read at the moment of
the tie; a payment it decided before stays as it is.

**The matcher's two lists** (D4, D10), per tie and over the candidates'
accounts only:

| List | Holds |
| --- | --- |
| `knownAccounts` | accounts learned for this service (012 D12) that are exclusive to this person |
| `othersAccounts` | accounts that have paid another person of the business |

An account learned for this service that also paid another person is in
`othersAccounts` only.

**Misses on a link** (D8) — rows of the link with `tie_break = 'none'` and
`created_at` in the last 24 hours, over the existing `payments_link_idx`.
Three or more close the tie-break on that link until the oldest leaves the
window.

**The ask** (D9) — replaces 012's table (012 data-model, "The ask"). On a
`validating` row with a `reference_source`, read top to bottom, the first
that holds wins:

| Condition | `ask` | `tieBreak.ways` |
| --- | --- | --- |
| `CEP_UNDECIDED`, waiting on a tie-break, the link has three misses in 24 h | `clave` | — |
| `CEP_UNDECIDED`, waiting on a tie-break, the last answer's digits picked one candidate from an account in `othersAccounts` | `tie_break` | `["clave_tail"]` |
| `CEP_UNDECIDED`, waiting on a tie-break, the last answer gave one way and left several | `tie_break` | the way not yet given |
| `CEP_UNDECIDED`, waiting on a tie-break, both ways given and several left | `clave` | — |
| `CEP_UNDECIDED`, waiting on a tie-break, otherwise | `tie_break` | `["sender_tail", "clave_tail"]` |
| `TRANSFER_NOT_FOUND`, `ladder_round ≥ 4` | `clave` | — |
| `TRANSFER_NOT_FOUND`, `ladder_round = 3` | `check_data` | — |
| otherwise | null | — |

"Waiting on a tie-break" is a typed row, or an own row during a
transition (012 D26), whose candidates are kept and not yet decided.
`tieBreak.missed` is true when the row's own `tie_break` is `none`.

## State of a typed confirmation

```text
typed ──► search (round 1) ─┬─ none found ──────────────► 012's ladder
                            └─ one or several found ─┬─ one from an exclusive learned account ─► confirmed
                                                     └─ otherwise ─► validating, CEP_UNDECIDED: ask tie_break
answer (supersedes; no call) ─┬─ fits one ──────────────► confirmed (by sender_tail | clave_tail)
                              ├─ digits → another person's account ─► ask tie_break [clave_tail]
                              ├─ fits several ──────────► ask the other way, then the whole clave
                              └─ fits none ─► tie_break = none; candidates carried; ask again
                                                └─ third miss on the link in 24 h ─► ask clave
whole clave ──► spec 013: fitted to the kept candidates, else searched
receipt ──► today's receipt path, on the same chain
```

## Validation rules (from the requirements)

- A tie-break answer carries `senderTail` (four digits), `claveTail` (four
  letters or digits) or both, and supersedes a row waiting on a tie-break;
  anything else is refused (D11).
- An answer never reaches the provider (FR-012).
- With both ways given, only a candidate both fit is a fit (D6).
- No account digits, no clave characters and no candidate list reach any
  payer-facing schema (FR-018); `tieBreak` carries field names and a
  boolean only.
