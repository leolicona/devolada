# Quickstart: Cobros On-Demand Search

**Feature**: `010-cobros-on-demand-search` | **Date**: 2026-09-22

How to see this feature work, and how to prove it. Shapes live in
[contracts/cobros-api.md](./contracts/cobros-api.md) and
[data-model.md](./data-model.md); decisions in [research.md](./research.md).

## Prerequisites

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local   # no migration is added; this
                                               # only brings a fresh D1 up
```

Two terminals:

```sh
pnpm --filter @devolada/api dev     # 8787
pnpm --filter @devolada/admin dev   # 5174
```

Seed the demo ISP and sign in as `demo@devolada.app` / `devolada123`:

```sh
curl -X POST localhost:8787/dev/seed
```

`/dev/*` answers 404 unless `ENVIRONMENT=dev`.

**With no `WISPHUB_API_KEY` in `apps/api/.dev.vars`** the seed connects no
provider, and Cobros shows its "Conecta WispHub" door — which is scenario 5
of US4 and worth seeing first. To exercise the rest, put a key in
`.dev.vars` and point it at the installation the key belongs to.

> `wrangler dev` on a local workerd **cannot reach `api.wisphub.net`** —
> every fetch fails with an opaque internal error, while the same key works
> from a deployed Worker (measured 2026-08-14, archive
> `integrations/wisphub.md`). So the manual walk below runs against the
> deployed dev API. The automated layers below do not: they intercept
> WispHub at its real origin with `fetchMock` and never leave the runtime.

## The walk

### US1 — the debtor the page cannot show today

The one that matters. Pick a customer, register a payment **smaller** than
their invoice, then look for them.

1. Cobros → find any debtor → note their `usuario` and what they owe.
2. In WispHub's own panel, register a partial payment against that invoice —
   say 40 against 100.
3. Back in Cobros, reload. **They are gone from the list**: WispHub closed
   the invoice as *Pagada* and moved the 60 to their `saldo`.
4. Type three letters of their name in the search box.

**Expected**: they appear, `debt: "owed"`, with the remaining 60 — and the
row's `receipts` is empty, because no invoice accounts for it.

That row is the feature. Everything else is the shape around it.

### US1 — the other two debt answers

- Search a customer who owes nothing → the row shows *Sin adeudo*, not an
  absence. Hiding them reads as "this customer does not exist", which is
  what `bug: customer-lookup-misses` was.
- Search on a tenant whose pending list could not be read to its end → the
  row shows *No pudimos confirmar* and **no amount**.

Also worth typing: two characters (the page says three are needed), `MARÍA`
and `maria` (same results), and a run of phone digits.

### US2 — the blocks

1. Open Cobros with the network panel showing.
2. **One** request for the first block. Nothing else.
3. Scroll toward the bottom → the next block is asked for.
4. Stop scrolling → nothing more is read.
5. Scroll to the end → the list stops and says how many pending receipts the
   ISP has.

**Expected**: no "La lista puede estar incompleta" warning anywhere. It is
gone (FR-016), because nothing is read whole.

### US2 — the tabs are the provider's answer

Choose **Vencidas**, then scroll two blocks down. Every row in both blocks
is overdue — the tab is a different walk, not a filter over what loaded
(FR-014). Switching tabs starts from that tab's own first block.

A receipt with no due date sits in **Todas** and in neither tab. That is not
a bug: there is no date to file it by (D7).

### US3 — the memory

Search, then: navigate to Pagos and back; press the browser's back button;
reload; paste the address in another tab. The text and its results come back
each time, with no second visible wait inside two minutes.

### US4 — the provider away

Stop the provider (or point `.dev.vars` at an unreachable host):

- Blocks already on screen **stay**, under *Sin conexión a WispHub*. No
  error block.
- A **search** says it needs WispHub. It does **not** answer an empty list —
  that would read as "nobody owes", the one lie this screen must not tell
  (D9).
- A key WispHub *refuses* is different: Integraciones, no Reintentar.

## The automated layers

Each answers only what it can (constitution IV).

```sh
# API — workerd, real local D1, WispHub intercepted at its real origin
pnpm --filter @devolada/api test -- test/cobros-search.test.ts

# Component — happy-dom, MSW with schema-validated fixtures, axe
pnpm --filter @devolada/admin test -- cobros

# Browser — the scroll, real contrast in both themes, target sizes,
# no horizontal scroll at 360/768/1280
pnpm e2e -- cobros
```

Before pushing, what CI runs, in its order:

```sh
node scripts/spec-lint.mjs
node scripts/gen-banks.mjs --check
node scripts/contrast-lint.mjs
node scripts/pending-lint.mjs
pnpm -r --if-present typecheck
pnpm -r --if-present test
```

## What to check by hand before calling it done

- **No link is created by looking.** Note the business's link count, run a
  session of searching and scrolling without pressing anything, check it
  again. Equal (SC-008, `009 FR-008`).
- **The money paths are untouched.** A payment validated through the payer's
  page still reaches WispHub and still reconnects: this feature reads
  `debtFor` and `readPendingInvoices`, it does not stand between them and
  the charge guard, the SPEI amount, the re-validation or the reconnection
  queue.
- **The freshness label follows the source.** On a tenant served by the
  sweep's snapshot the label is there with the pass's own time; on a live
  tenant there is no label, because a block read when it renders has no age
  (D12).
