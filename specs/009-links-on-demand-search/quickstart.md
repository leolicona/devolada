# Quickstart: Links On-Demand Search

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Contract**: [contracts/links-api.md](./contracts/links-api.md)

How to run this feature locally and prove each story. Implementation belongs in
`tasks.md`; this is the validation guide.

## Prerequisites

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local     # includes link_prunes
```

`apps/api/.dev.vars`:

| Key | For this feature |
| --- | --- |
| `WISPHUB_API_KEY` | unset → the list and the search answer `wisphub: "not_configured"` with API links only. That is US3's second half, so leave it unset for one pass and set it for the rest. |
| `BETTER_AUTH_SECRET` | required, as always |
| `APICEP_TOKEN` | not needed — no validation runs here |

## Run it

```sh
pnpm --filter @devolada/api dev      # 8787
pnpm --filter @devolada/admin dev    # 5174
curl -X POST localhost:8787/dev/seed # demo@devolada.app / devolada123
```

Sign in, open **Links**. The page should show a search box and one screenful of
customers — no "la lista puede estar incompleta" warning, no "consultado hace X
min" (FR-027: a block is live when it renders, so there is no age to report),
and nothing waiting on a whole-base read. Leaving the tab and returning should
re-read the first block, at most once every 30 seconds.

## Proving each story

### US1 — any customer can be found and sent their link

```sh
# browse: one block, a cursor, the provider's total
curl -s 'localhost:8787/direct-payments/customers?limit=20' -b cookies.txt | jq '.data | {n: (.results|length), nextCursor, total, wisphub}'

# search: three characters, four filters, one answer
curl -s 'localhost:8787/direct-payments/customers?q=mar' -b cookies.txt | jq '.data | {n: (.results|length), matched, nextCursor}'

# two characters: refused, and the page never sends it
curl -s 'localhost:8787/direct-payments/customers?q=ma' -b cookies.txt | jq '.error.code'   # VALIDATION_ERROR
```

In the panel: search a customer who has no link. **The buttons are there.**
Press Copiar — the link is created at that moment and the URL is on the
clipboard. Press it on another customer and confirm the link differs.

**The one that matters most (SC-004)**: note the link count, scroll through
several blocks and run three searches **without pressing anything**, then check
the count again. It must not have moved.

```sh
pnpm --filter @devolada/api test -- test/links-customers.test.ts
pnpm --filter @devolada/api test -- test/links-create-on-act.test.ts
```

### US2 — the search survives leaving the page

In the panel, with a search on screen:

1. go to **Pagos** and back — the text and the results are still there;
2. press the browser's back button — same;
3. reload — same, without a second visible wait (inside two minutes);
4. copy the address into a second tab of the same business — it opens on that
   search;
5. clear the box, leave, return — the page opens empty.

The text lives in `?q=`; the results live in `sessionStorage` for two minutes
(D11). Clearing site data and reloading must show a fresh search, not a blank
page.

### US3 — search keeps working when WispHub does not

```sh
# no key at all
# (unset WISPHUB_API_KEY, restart the API)
curl -s 'localhost:8787/direct-payments/customers?q=ref-1' -b cookies.txt | jq '.data.wisphub'   # "not_configured"

# key present, provider down — point it at a dead port
# APICEP_BASE_URL is not this one; use the WispHub host var for your installation
curl -s 'localhost:8787/direct-payments/customers?q=mar' -b cookies.txt | jq '.data | {wisphub, n: (.results|length)}'
```

Both answer `200` with the envelope. **A 503 here is a bug** (FR-014, D10). In
the panel the note reads *"Sin conexión a WispHub"* and there is no error block.

A customer seen minutes earlier is still found by name, from the cache; one not
seen recently is not, and the page says a name search needs WispHub.

```sh
pnpm --filter @devolada/api test -- test/links-offline.test.ts
```

### US4 — Cobros can send, not only show

Delete every stored link for the demo business, then open **Cobros**. Every
debtor row still shows Copiar and WhatsApp. Press WhatsApp on one: the window
opens, the link is created, and **that customer's own chat** is ready with the
message — no contact picker, because the act's fresh read carried their number
(FR-028). Seed a debtor with no phone in WispHub and press WhatsApp on them: the
picker opens instead. That is the exception, and it should be the only one.

Then find the same customer on Links — it is the **same** link.

The WhatsApp window is the trap: it must open on the click, before the link
exists (D9). If a pop-up blocker eats it, the fix is in `useLinkAction`, not in
the blocker.

### The prune (FR-023)

Locally, set `PRUNE_CUTOVER_MS` ahead of your seeded links so the pass has
something to delete, then let the cron tick (or trigger it) and read the row:

```sh
pnpm --filter @devolada/api test -- test/links-prune.test.ts
```

What the test must prove, and what to check by hand:

- a panel link with a payment against it is **kept**, whatever its age;
- a panel link with a clave attempt against it is **kept**;
- an API link is **never** touched;
- a link created after the cutover is **never** touched;
- a second run deletes nothing and writes no second row;
- the business is told the count once, and dismissing it sticks:

```sh
curl -s localhost:8787/direct-payments/prune-notice -b cookies.txt | jq '.data'
curl -s -X POST localhost:8787/direct-payments/prune-notice/dismiss -b cookies.txt | jq '.data'
curl -s localhost:8787/direct-payments/prune-notice -b cookies.txt | jq '.data'   # null
```

A viewer must be refused the dismiss — the record of deleted links is not
theirs to silence.

## Full gates

```sh
pnpm -r --if-present typecheck
pnpm -r --if-present test
node scripts/spec-lint.mjs
node scripts/contrast-lint.mjs
node scripts/pending-lint.mjs
pnpm e2e                       # scroll, 360/768/1280, both themes, axe
```

## The walk, as taken (2026-09-22)

Walked end to end against a local `wrangler dev --local` with the demo
seed, on the implementation branches. What it proved, live:

| Check | Result |
| --- | --- |
| `?limit=20` browse | `200`, the envelope, `wisphub: "not_configured"` — a business with no key is answered, never refused (FR-015) |
| `?q=ma` | `VALIDATION_ERROR` — two characters never reach the provider (FR-002) |
| `?q=mar` | `200`, the same shape |
| **SC-004** | six searches and four browses moved the link count by **zero** |
| **SC-009** | nine cron ticks created **zero** links |
| The prune | ran once, wrote one row (`deleted_count: 0`, since `PRUNE_CUTOVER_MS` is still 0), and nine ticks later there is still exactly one row — idempotent by construction (D13). **Corrected 2026-09-22 (T058)**: writing that row was the bug, not the proof. It spends the business's one and only pass on a cutover that deletes nothing, so the release would find nothing left to prune. The pass now writes nothing while the cutover is unset, and the rows this walk left on dev have to go — see *Pre-flight* |
| `GET /direct-payments/prune-notice` | `null` — a count of zero is not news (FR-023) |
| `POST /direct-payments/links` with no key | `WISPHUB_NOT_CONFIGURED` — the act needs a fresh read and says so (D8) |
| `GET /direct-payments/links/roster` | **404** — the roster is gone (D12) |

**What this walk could not reach**, and what therefore still needs a
person with the real tenant in front of them:

- Anything that needs WispHub to answer. The environment this ran in
  denies `wisphub.net` by policy, and the demo seed connects no
  provider, so every read answered `not_configured`. The browse with
  real rows, the four-filter search, the act creating a link from a live
  customer, the WhatsApp window opening on the customer's own chat
  (FR-028) and US3's *provider present but silent* half are all unproven
  outside the test suites, which mock the provider at its own origin.
- The three panel walks — US2's five ways of leaving the page, US4's
  Cobros round trip, and the prune notice being dismissed on screen.
- The SC-001/002/003 numbers against the REAL provider. The browser
  layer measured them against a 500 ms stub
  (`tests/e2e/links.spec.ts`): 0.25 s ready, 1.34 s to results, 2.41 s
  to find-and-send, against targets of 1 s, 3 s and 15 s.

## Pre-flight — the items only a person can do

1. **Set `PRUNE_CUTOVER_MS` to the real ship timestamp** at the release step,
   not before (D13). A cutover in the future deletes links the feature has just
   created; a cutover long past leaves the roster's links in place.
2. **Clear any `link_prunes` row written before the cutover was set.** The row's
   existence is the only thing that stops the pass, so a row left from the unset
   window means that business is never pruned. The guard in `prunePanelLinks`
   (T058) stops new ones being written, but dev already carries rows from before
   it — every one of them `deleted_count: 0`. Delete them before the release, and
   check none survive:

   ```sh
   # from apps/api, against dev's deployed D1 — read first, then delete
   pnpm exec wrangler d1 execute devolada-db-dev --env dev --remote \
     --command "SELECT business_id, deleted_count FROM link_prunes"
   pnpm exec wrangler d1 execute devolada-db-dev --env dev --remote \
     --command "DELETE FROM link_prunes WHERE deleted_count = 0"
   ```

   A row with a non-zero count is a real prune that really happened: leave it.
   Prod has never run the pass with the old code, so it should return no rows at
   all — if it does, the same rule applies.
3. **Ship US4 with the prune.** FR-023 empties what Cobros reads; without
   FR-025/FR-026 the collections screen can send nothing (plan, *Dependencies
   and sequencing*).
4. **Tell the connected ISP before the prune runs.** Roughly 6,513 links go, and
   any link an operator sent that has not been paid stops working. The spec
   records this as chosen (FR-024, D13) — the operator should still hear it from
   a person, not from a notice.
5. **Watch the provider's call volume after the deploy.** The roster's sweep was
   spending sixty-odd calls every few minutes per large tenant; that should fall
   to roughly one call per screenful an operator actually looks at.
