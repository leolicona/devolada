# Quickstart & Validation: The Payer's Doorway

**Date**: 2026-09-18 | **Contract**: [contracts/link-summary.md](./contracts/link-summary.md)

How to run this feature locally and prove each story works. Scenario numbers
match the spec's acceptance scenarios.

The doorway is the bare origin of the payer's page — `localhost:5175/` with no
`/p/<token>` after it. Everything below is about getting links onto a device and
then opening that address.

## Setup

```sh
pnpm install
pnpm --filter @devolada/api db:migrate:local
pnpm --filter @devolada/api dev      # 8787
pnpm --filter @devolada/pago dev     # 5175 — the payer's page and its doorway
```

No provider credential is needed for most of this: API links carry their own
amount and touch no provider (research R1). `.dev.vars` keys and what "unset"
means are in CLAUDE.md.

Seed a business and keep its API key:

```sh
API=http://localhost:8787
DK=$(curl -sX POST $API/dev/seed | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["api"]["key"])')
```

Make two links for two different people:

```sh
curl -sX POST $API/v1/payment-links -H "Authorization: Bearer $DK" \
  -H 'Content-Type: application/json' \
  -d '{"customerRef":"CLI-4471","askCents":49900,"label":"Ana Ruiz"}'

curl -sX POST $API/v1/payment-links -H "Authorization: Bearer $DK" \
  -H 'Content-Type: application/json' \
  -d '{"customerRef":"CLI-9002","askCents":0,"label":"Luis Mora"}'   # refused: FR-012
```

Use a positive amount for the second one. Open each returned `url` once in the
browser — **opening a link is what puts it on the device** (FR-015). Then go to
`localhost:5175/`.

## US1 — The doorway shows what is owed

**Scenario 1** — two rows, each naming its business, its person and its amount.

**Scenario 2** — the row must not disagree with the page. Read a row's amount,
tap it, and compare with "total a transferir". They are the same number, because
both come from one resolver (D3). Prove the projection directly too:

```sh
curl -s $API/direct-payments/links/<token>/summary | python3 -m json.tool
```

Expect `businessName`, `name`, `status`, `totalCents` — and **no** `speiClabe`,
`speiBank`, `reference` or `cobros`. Their absence is the contract (FR-010), so
check for it explicitly rather than glancing at what is there.

**Scenario 3** — a row with nothing to pay. Re-price a link to a paid state by
closing it, or use a panel link for a customer with no debt if a provider is
configured. The row says so in words and carries no amount.

**Scenario 4** — two links naming the same person at two businesses. Sign a
second business up in the panel (`localhost:5174`, with
`curl -s "$API/dev/otp?email=<address>"` for the code), give it a CLABE, issue
its own credential, and make a link with the same `label`. Both rows appear and
are told apart by the business name.

**Scenario 5** — ordering. With one link owing and one settled, the owed row is
read first (FR-006, D6).

**Scenarios 6 and 7** — the unchanged paths. Clear the device
(`localStorage.clear()` in the console), open one link, then go to the bare
origin: it lands straight on that payment, no list. Clear again and open the
bare origin with nothing saved: the invitation to ask the business, with no
field, search or lookup anywhere on the screen.

## US2 — The list stays true

**Scenarios 1 and 2** — a single-amount link that is paid or expired:

```sh
curl -sX POST $API/v1/payment-links -H "Authorization: Bearer $DK" \
  -H 'Content-Type: application/json' \
  -d '{"customerRef":"CLI-7781","askCents":120000,"mode":"one_time","expiresAt":'"$(( ($(date +%s) - 60) * 1000 ))"'}'
```

That one is born expired — a legitimate way to close a door
(`automated-collections-api`). Open it once so the device holds it, then open
the bare origin: the row is gone, and the payer removed nothing (FR-013).

**Scenario 3** — a deleted link. Remove the row from the database, reload the
doorway: the entry is dropped on the 404 (FR-011, FR-013).

**Scenario 4** — "este no es mi servicio" removes a row, and it stays removed
across a reload.

**Scenario 5** — no stale amount. With the doorway open, re-price a link:

```sh
curl -sX PATCH $API/v1/payment-links/<id> -H "Authorization: Bearer $DK" \
  -H 'Content-Type: application/json' -d '{"askCents":52000}'
```

Reload the doorway: the new amount, never the one the device saw last time
(FR-016). Then confirm the stored shape itself:

```js
JSON.parse(localStorage.getItem("devolada-pago-links"))
```

Expect `token`, `name` and `business` — and **no amount and no status** on any
entry (data-model §1).

## US3 — The doorway never becomes a dead end

**Scenario 1** — the whole point of this story. With links saved, stop the API
(`Ctrl-C` on the 8787 process) and reload the doorway. Every row still appears
with its name, every row still opens, and nothing reads as an error page.

**Scenario 2** — partial failure. With two businesses set up (US1 scenario 4),
break only one: suspend it, or point only that business's provider at a dead
address. One row shows its amount, the other says its state is unknown, and
neither blocks the other (FR-018).

**Scenario 3** — a slow business must not delay a fast one. Throttle one
response in the browser's network tools and confirm the other row lands first
(FR-019, D1).

**Scenario 4** — a row still reading breathes; nothing on this screen spins or
bounces (constitution VI). With reduced motion on, translation and scale are
gone and the opacity breath remains.

**Scenario 5** — a damaged device:

```js
localStorage.setItem("devolada-pago-links", "{not json")
```

Reload: the doorway behaves as a device holding nothing and never fails
(FR-022).

## The automated layers

Each answers only what it can (constitution IV). Every file cites
`payer-doorway US<n>`.

```sh
pnpm --filter @devolada/api test -- test/direct-payments-summary.test.ts
pnpm --filter @devolada/pago test
pnpm e2e                       # built previews, stubbed API — contrast, targets, 360/768/1280
pnpm -r --if-present typecheck
node scripts/pending-lint.mjs  # every in-progress label sits inside a <Pending>
```

The browser layer is the only one that can answer SC-004's timings and SC-009's
layout; the component layer answers ordering, removal and partial failure; the
API layer answers the contract, including the fields the summary must **not**
carry.

## What to record

SC-004 is a target, not a promise (research R2): note the measured time to the
first row and to the last, for five links, when the browser layer runs. If it
misses, the lever is research R1's first alternative — not a redesign.
