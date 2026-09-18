---
slug: legacy-minute-two-cross
status: open
kind: deliberate
severity: low
effort: hours
opened: 2026-09-18
---

# Technical Debt: the minute-two cross, kept alive for rows born before the cut-over

## What was traded

Until two-eyes-receipt, the two readings of a receipt met at *minute two*: the
payer's page sent what the machine read as typed transfer data, the first paid
call went to the provider's transfer door, and only on a `not_found` did the
second attempt send the image to the provider's OCR so the two could be
compared. D3/D5 turned that around — the first call now goes to the image door
with the engine's reading beside it, and the comparison happens at minute zero.

A payment already in flight at the moment of the deploy cannot be re-flowed:
its row was born the old way, its first call is spent, and re-classifying it
would either spend a credit twice or leave it uncompared. FR-020 says the two
flows must never mix on one row and nothing may be reprocessed. So the old
branch stays, for exactly those rows, identified by a shape rather than a
column (research R10):

```
proof_mode = 'transfer' AND proof_key IS NOT NULL
  AND supersedes_id IS NULL AND reading_check IS NULL
```

No row born after the cut-over can have it: a machine reading is born `receipt`
(D13), a typed correction is born with a `supersedes_id`, and the manual door
has no `proof_key`. The alternative — a `flow` column — would have outlived its
only reader by design, and cost a migration to say what the row already says.

## What it costs while unpaid

A second door-selection rule to read around, in the file where the money
decisions live. Someone changing `validation.ts` has to notice that `crossCheck`
exists, that it is *not* the path new payments take, and that its
`classifyReading` is a different comparison from the engine's `compareReadings`
— same three words, different code, different moment. Two functions that do
almost the same thing is exactly the drift the constitution asks to be written
down rather than tolerated silently.

It costs no money and no correctness: the branch is unreachable for new rows,
and its tests pin it.

## Where it lives

- `apps/api/src/direct-payments/validation.ts` — the `crossCheck` const, the
  `providerOcr: true` request it builds, and the `crossCheck ? classifyReading(…)`
  arm of the classification.
- `apps/api/src/direct-payments/validation.ts` — `classifyReading` itself, whose
  only caller is that arm.
- `apps/api/src/consta/index.ts` — the `providerOcr?: true` request flag, and the
  engine paths that honour it (`validate.ts`'s `readable`, and the
  `RECEIPT_UNREADABLE` throw the provider-first path no longer takes, D12).
- `apps/api/test/direct-payment.test.ts` — `describe("US-D14: the classifier at
  minute two")`, including the two two-eyes-receipt scenarios that pin the
  cut-over shape itself.
- `apps/api/test/consta/validate.test.ts` — "US-V06, scenario 13: the legacy
  cross still gets the named missing fields".

## What paying it looks like

The exit condition is arithmetic, not judgement: **no `validating` row with the
legacy shape exists on dev or on prod.** Those rows die within the schedule's
own horizon — six hours plus the 12-hour late slot — so this is payable a day
after the deploy, and the entry exists so that day is not forgotten.

```sql
-- must return 0 on both databases
SELECT COUNT(*) FROM payments
WHERE status = 'validating' AND proof_mode = 'transfer'
  AND proof_key IS NOT NULL AND supersedes_id IS NULL AND reading_check IS NULL;
```

`node scripts/reading-check-report.mjs --env dev` prints the same count under
"Legacy crosses still running".

Then remove, in one change: the `crossCheck` const and its request arm,
`classifyReading` and its tests, the `providerOcr` flag and the engine branches
that read it, and the `US-D14` describe — keeping the two scenarios that prove a
new-shaped row never takes the old path, which become redundant only when the
path is gone. `RECEIPT_INCOMPLETE` in `failure.ts` goes with it: no door throws
it since D3, and its last reason to stay declared is that the legacy path's
callers still switch on the code.

Confirmed paid when all three hold on the tree:

```
grep -rn "crossCheck\|classifyReading" apps/api/src   # no output
grep -rn "providerOcr" apps/api/src                   # no output
grep -rn "RECEIPT_INCOMPLETE" apps/api/src            # no output
```
