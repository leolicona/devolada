---
slug: retired-consta-key-column
status: open
kind: deliberate
severity: low
effort: minutes
opened: 2026-09-16
---

# Technical Debt: `businesses.consta_api_key` is declared and never read

## What was traded

`consta-api-merge` folded the SPEI validation engine into the API
(D1) and attributes every validation by `business_id` (D3). The
per-business Consta key that `payments-and-classes D7` minted at birth
has no reader and no writer left — and the column stays in the table,
declared in the schema with a retirement comment (D11, research R10).

It stays because the per-PR preview applies migrations to the live dev
database while the deployed dev Worker keeps serving, and Drizzle
selects every declared column by name: a `DROP COLUMN` applied by a PR
would break the running dev API's `SELECT … consta_api_key …` for the
life of that PR. Additive is a rule with a reason, and the reason is the
preview.

The cost while unpaid: a dead column every `SELECT` on `businesses`
carries, and a comment in `schema.ts` that has to explain itself to
every reader who wonders what a Consta key is.

## Where it lives

- `apps/api/src/db/schema.ts` — `businesses.constaApiKey`, declared with
  the D11 retirement comment; nothing reads or writes it
  (`git grep constaApiKey apps/` returns the declaration alone).

## What paying it looks like

One migration: remove the declaration from `schema.ts`, run
`pnpm --filter @devolada/api db:generate`, and read the result — it must
be a single `ALTER TABLE businesses DROP COLUMN consta_api_key` (SQLite
rebuilds the table behind it; drizzle-kit emits the statement). It may
land only **after this feature's dev and prod deploys have both run**,
so that no deployed version of the API still selects the column.

Confirmed paid when both hold on the tree:

```
grep -n "consta_api_key\|constaApiKey" apps/api/src/db/schema.ts   # no output
ls apps/api/migrations | grep -i "consta_key"                       # the drop migration exists
```

**Trigger**: the first migration after the prod deploy that carries
`0028_consta_api_merge.sql`. Until then the column costs bytes and a
comment, nothing else.

## Notes

- Logged by `consta-api-merge` tasks T046 (plan D11). The engine's own
  record (`validations`, `extractions`) never depended on the column;
  the trust chains key on `(business_id, customer_ref)` from the first
  row written after the merge.
- The history shows column drops (0005, 0018), all from before previews
  shared the dev database — the rule tightened when the preview arrived,
  not when this column did.
