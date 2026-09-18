# Research: The Payer's Doorway

**Feature**: `specs/008-payer-doorway` | **Date**: 2026-09-18

Everything below was read out of the code on the branch at `326c951`. Where a
number is a guess rather than a reading, it says so and names what would measure
it.

## R1 — What one row costs to resolve

The page already resolves exactly one link: `getLinkStatus`
(`apps/api/src/routes/direct-payments/handler.ts:203`). Reading it gives the
per-row cost, by channel:

| Channel | Reads |
| --- | --- |
| API link | one D1 read of the link, one of the business. No provider at all — the ask is on the row (`automated-collections-api D6`). |
| Panel link | the same two D1 reads, plus `wisphub.getCustomer(usuario)` — **uncached** — plus `pendingInvoicesForDisplay`, which is cached per business for 30 s in the colo's Cache API (`apps/api/src/wisphub/cache.ts:30`). |

So a doorway holding `N` links across `M` businesses costs at most `N` uncached
customer reads and `M` pending-list reads, of which the pending-list reads are
usually cache hits — that entry is shared with the ISP's own panel and with
every other payer of the same ISP landing in the same data centre.

**Decision**: accept the per-row cost as it is, and bound the number of rows
resolved at once (D8) rather than optimising a path that has not been measured.

**Rationale**: the cost per row is exactly what the payer already pays by
opening that link. The doorway does not make any single read more expensive; it
makes several happen at once. The honest lever is *how many*, not *how much*.

**Alternatives considered**:

- *Cache `getCustomer` per customer for display, like the invoice list.* It
  would make a reload nearly free and would help a payer with several links at
  one ISP. Rejected **for now**: it changes a path the payment page shares, for
  a benefit nobody has measured. Revisit if R2's measurement misses SC-004.
- *Read the whole tenant roster once instead of N customers.*
  `rosterForDisplay` already does this for the panel. Rejected outright — see
  D4; it is the wrong shape on a payer path, whatever it saves.

## R2 — Whether SC-004's timings hold

SC-004 asks for the first row within 1 s and every reachable balance within 3 s
for five links. Nothing in the repository measures a payer-side provider read
today, so this is **unmeasured**.

What is known: the panel's Cobros screen does one cached tenant read and is
considered acceptable; the payment page does one uncached `getCustomer` per
open and nobody has filed it as slow. Five parallel reads of that shape,
multiplexed over one connection, are very unlikely to be slower than the
slowest single one.

**Decision**: treat SC-004 as a target to verify, not a promise to design
around. The browser layer measures it during implementation. If it misses, R1's
first alternative is the lever, and the copy never promised a number anyway.

**Rationale**: the design already degrades correctly if a read is slow (D1, D10)
— rows arrive independently and a slow one never blocks a fast one. A missed
timing is therefore a tuning problem, not a redesign.

## R3 — One request per link, or one request for all of them

**Decision**: one request per link, issued in parallel (D1), against a new lean
per-link route (D2).

**Rationale**: the spec asks for two things a single batch response cannot give
at once. FR-019 wants rows to appear as they resolve; FR-018 wants one
unreadable row not to spoil the others. A batch answer has to arrive whole, so
it would either wait for the slowest business or stream — and streaming would
break the one-envelope rule (constitution III) for a payer-facing route, whose
client ships with the code list precisely because it gets one object.

Issuing one request per link gives both properties for free, and gives a third:
the answer for a link is produced by the same resolver the page uses, so it
cannot disagree with the page (SC-002) by construction rather than by care.

**Alternatives considered**:

- *`POST /direct-payments/doorway` with a list of tokens.* One round trip, a
  server-side bound, and a smaller total payload. Rejected on FR-018/FR-019 as
  above. It also invents a request body listing several businesses' links, which
  is the one shape that would make the tenant-isolation reading (constitution V)
  hard to defend at a glance.
- *Call the existing `GET /direct-payments/links/:token` N times.* Correct, and
  needs no new route at all. Rejected on D2's grounds: that answer carries the
  CLABE, the bank, the beneficiary and the invoice list. A list screen that
  cannot build a transfer should not be handed the means to (FR-007, FR-010).

## R4 — What the row shows as "the amount"

The page's `totalCents` is the debt plus the business's service fee — the number
under "total a transferir". `invoiceCents` and `carriedBalanceCents` are its
parts.

**Decision**: the row shows `totalCents` (D7).

**Rationale**: SC-002 says the row must not disagree with the page behind it. A
row showing the debt alone would show a smaller number than the page it leads
to, which is the one disagreement a payer would actually notice and distrust.

## R5 — What the device may keep

`apps/pago/src/links.ts` keeps `{ token, name }` per link, where `name` is
`customerName ?? ispName` — the payer's own name on a panel link. Two links at
two businesses can therefore read identically today, which FR-002 forbids.

**Decision**: the stored entry gains the business name and keeps no amount and
no state (D5). The reader must accept an entry that lacks the business name,
because real devices already hold the old shape.

**Rationale**: FR-016 forbids presenting a remembered amount as current, and
FR-017 requires the rows to appear with names when nothing can be read. Names
are the only thing that satisfies both: durable enough to survive an outage,
never mistakable for a live figure.

**Alternatives considered**: *keep the last amount and show it greyed.*
Rejected — a stale money figure on a screen about money is the kind of thing a
payer acts on. "No pudimos leerlo" is worse-looking and safer.

## R6 — The order rows appear in

`rememberLink` appends the re-opened link to the end of the list, so the
device's natural order is least-recently-opened first — backwards for a chooser
that exists to shorten a return trip.

**Decision**: group by state, owed first, then unknown, then nothing to pay,
then unavailable; within a group, most recently opened first (D6).

**Rationale**: FR-006 asks that what is owed be read first. The within-group
rule falls out of fixing the append order, and costs nothing to store.

## R7 — When the doorway re-reads

The panel already has a pattern for this: `presence-freshness` — re-read on
return to the tab with a 30-second floor, no heartbeat, a failed background read
keeps the rows with a quiet note (`apps/admin/src/lib/presence.ts`,
`focusReadOptions`).

**Decision**: the doorway uses the same rule (D9).

**Rationale**: a payer who leaves for their bank app and comes back is exactly
the case that pattern was written for, and the payment page already lives
through that round trip (`apps/pago/src/step.ts`). Adding a timer instead would
put a provider read on a loop for a screen nobody is looking at.

## R8 — Nothing new is needed around it

Read and confirmed, so the plan does not carry work that does not exist:

- **CORS**: the pago origin is already on the allow-list and the route is a
  public GET (`apps/api/src/index.ts:33`). No change.
- **Schema export**: `@devolada/api/direct-payments-schema` already exists in
  `apps/api/package.json`, so the new contract ships through it. No new export.
- **Rate limiting**: the public link routes budget *payments* per link
  (`HOURLY_ATTEMPT_BUDGET`), not reads. The doorway adds no new amplification —
  each request resolves exactly one link, the same as opening its page. The
  bound in D8 is about the payer's own screen, not about abuse.
- **The saved-link store and the step store** already exist and already survive
  a refused or damaged `localStorage` by reading as empty. FR-022 is satisfied
  by the shape that is there; the tests have to prove it for the new screen.

## Decisions

The numbers code cites as `payer-doorway D<n>`. Each one's argument is in the
section named beside it.

| # | Decision | From |
| --- | --- | --- |
| **D1** | The doorway resolves **one link per request, in parallel** — never one batch. Progressive rendering and independent failure come free; a batch would have to choose between one envelope and rows that arrive as they resolve. | R3 |
| **D2** | A **lean summary route**, not the page's read. A list screen that cannot build a transfer is not handed the CLABE, the bank, the beneficiary or the invoice breakdown. | R3 |
| **D3** | **One resolver, two projections.** The summary and the page compute "what is owed" in the same place; the summary projects down. Two code paths would drift, and SC-002 forbids the row disagreeing with the page. | R3 |
| **D4** | **Never the tenant roster on a payer path.** Resolving one payer's link must not pull a whole business's customer list into a colo cache on a payer's request. `rosterForDisplay` stays the panel's. | R1 |
| **D5** | The device stores **the two names and nothing else** — no amount, no state. A remembered figure must never be presented as current, and names are what let a row exist when nothing can be read. | R5 |
| **D6** | **Newest first**, grouped by state with what is owed at the top. The current append order runs least-recently-opened first, which is backwards for a screen whose job is a short return trip. | R6 |
| **D7** | The row shows the **total the payer would transfer** — debt plus service fee — because that is the number the page asks for, and a row that showed less would disagree with the page it leads to. | R4 |
| **D8** | **Ten rows resolve automatically.** Beyond that, rows list and open normally and resolve when the payer asks. The bound is about the payer's screen, not about abuse. | R1, R8 |
| **D9** | **Re-read on return to the tab, with a 30-second floor.** The pattern the panel already uses; no heartbeat, because nobody is watching this screen while they are in their bank app. | R7 |
| **D10** | **`unknown` is a device state, never a returned one.** No route answers "unknown"; the device turns a failed read into it, and the row stays openable. That is what keeps a failure from having to be modelled as a success. | R3, R8 |
