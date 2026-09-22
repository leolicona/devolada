# Research: Links On-Demand Search

**Feature**: [spec.md](./spec.md) · **Date**: 2026-09-21

The spec's clarification session settled the product decisions. This file
settles the technical ones behind them, each numbered so code can cite it
(`links-on-demand-search D7`).

Two measured sources bound everything here:

- **The provider's customer list** — documentation read 2026-09-21, behaviour
  measured 2026-09-20 on the connected ISP. It pages by `limit`/`offset`,
  answers a total `count`, filters each field either exactly or by
  `__contains` (case- and accent-insensitive), offers **no** filter that takes
  several identities at once, and offers **no** ordering parameter. One call
  costs 0.4–0.6 s.
- **The code as it stands** — `apps/api/src/wisphub/{client,cache,snapshot}.ts`,
  `apps/api/src/routes/direct-payments/`, `apps/api/src/direct-payments/links.ts`,
  `apps/admin/src/features/{links,cobros}/`.

---

## D1 — One door for browsing and searching: `GET /direct-payments/customers`

Two doors serve the Links page today: `/direct-payments/links` (paged, stored
links) and `/direct-payments/links/roster` (the whole tenant). Both end.

They are replaced by one door whose resource is **the ISP's customers, with
their link if one exists**. Browsing and searching return the same row shape
and differ only in how the rows were found, so one door with an optional `q`
beats two doors the client would have to swap between mid-interaction.

`q` absent → browse, paged by cursor. `q` present (trimmed, ≥ 3 characters) →
search, one block, no cursor (D5). Below three characters the door answers
`VALIDATION_ERROR`; the page never sends it (FR-002).

The resource is renamed because it *is* a different resource: the old name
said "links", and the page no longer lists links. A link is now a property a
customer may or may not have.

**Alternatives rejected.** Keeping `/links` with new semantics — the name would
lie, and every reader of the code would have to learn that "links" means
"customers". Two doors (`/customers` and `/customers/search`) — the client
would hold two queries with two cache keys for one box.

## D2 — The cursor is opaque and carries the phase: Devolada's own links first, the provider's list second

A business may hold API links, which have no WispHub customer at all, and a
business without WispHub holds nothing else (FR-015). So a browse walks two
sources, and the cursor says which one it is in: `api:<created_at>:<id>` then
`wh:<offset>`, base64url, opaque to the client.

Phase 1 is a keyset walk of `payment_links` where `source = 'api'` — stable,
because Devolada owns the order. Phase 2 is `/clientes/?limit=&offset=`. The
phases never interleave: an API link is not a WispHub customer, and mixing
them mid-block would make the cursor meaningless.

Opaque because the offset is the provider's business, not the client's: a
client that could name an offset could walk the whole base a block at a time,
which is the cost this feature exists to remove.

## D3 — The block size comes from the viewport, bounded by the server

FR-020 says the first block is no larger than what fills the browser's
viewport. Only the browser knows that, so the client sends `limit`; the server
clamps it to `10 ≤ limit ≤ 50`.

The floor keeps a tall screen from paying four round trips to fill itself. The
ceiling keeps one request to one provider call at one block: 50 rows is well
inside the `limit=300` the provider honours, and one call at 0.4–0.6 s is what
SC-002 and SC-003 can afford.

## D4 — A search asks four filters at once and merges; no parameter is guessed

`nombre__contains`, `apellido__contains`, `usuario__contains` and
`telefono__contains`, in parallel, each `limit`-capped, merged and deduped by
usuario. One round trip for the operator, four requests on the wire.

All four run for every search, including a search that is plainly digits or
plainly letters. The saved call is not worth the bug: `queryParamFor` guessed
one parameter from the text's shape and sent a usuario to the `telefono`
filter, which is `bug: customer-lookup-misses`. Guessing is what this replaces.

`getCustomer(usuario)` keeps its exact `usuario=` lookup — identity is not a
search, and the exact filter is what the provider documents for it.

## D5 — "How many matched" is a floor, not a total

The true size of the union of four filters cannot be known without fetching
all four whole. Each answer carries its own `count`; the page reports
`matched` as the largest of them and says so in words — *"más de N
coincidencias"* — rather than claiming a total it did not compute.

A search returns one block and `nextCursor: null`. The page shows the count
and asks for more characters (FR-006). A cursor the search UI would never use
is dead weight in the contract.

## D6 — The list has no order to promise, so the page does not promise one

The provider offers no ordering parameter. A base that changes while the
operator scrolls can repeat a customer between blocks or skip one.

The server does not pretend to fix this. The client dedupes the accumulated
list by identity (usuario for a panel row, reference for an API row), so a
repeat never renders twice; a customer missed between blocks is still reachable
by search, which is the promise the spec makes (Edge Cases).

## D7 — A row without a link carries no URL; `url` and `waLink` become nullable

The roster's row shape had `url` and `waLink` on every row because the roster
had just created a link for every row. Under FR-008 most rows have no link, so
both fields become nullable and the row carries `hasLink`.

A null `url` does not hide the buttons — that was the old behaviour and it is
what FR-026 ends. The buttons are shown; pressing one creates the link (D8).

## D8 — `POST /direct-payments/links` is the act, and Cobros uses the same door

One door creates a panel link: `{ usuario }` in, `{ token, url, waLink }` out.
Idempotent — an existing link for that usuario is returned, never replaced
(FR-005, FR-009). `requireArea("payments", "operate")` and the CLABE gate sit
in front of it (FR-016).

`ensureLinks` (bulk, for the roster) becomes `ensureLink` (one customer). No
caller creates links in bulk any more, which is FR-008 and SC-009 expressed in
the type.

A panel link needs the WispHub numeric id, which a Cobros invoice row does not
carry. The handler reads the customer by exact usuario (one provider call) to
get it — the same fresh read the feature asks for everywhere else. A customer
the provider cannot find is a `CUSTOMER_NOT_FOUND`, not a link.

## D9 — The WhatsApp window opens before the link exists

A browser blocks `window.open` called after an `await`: the click is no longer
the cause. Since the link is created on the act, every WhatsApp press has an
await between the click and the URL.

So the handler opens the window synchronously on the click, to `about:blank`,
and sets its `location` when the POST resolves; on failure it closes the window
and the row shows the error. This is the one place where the "create on act"
rule meets a browser rule, and it will be a silent bug in every browser if it
is not written down.

## D10 — The provider being down is an answer, not a failure

`GET /direct-payments/customers` never answers 503 for a provider outage
(FR-014). It answers `success: true` with `wisphub: "unavailable"` and whatever
it has — the business's API links, and nothing else. `"not_configured"` is the
same shape for a business that never connected WispHub (FR-015, constitution
VIII).

`WISPHUB_AUTH_FAILED` keeps its own code and its own treatment: a rejected key
is a setup problem the ISP must fix, not an outage to ride out.

## D11 — The cache lives in the browser: the URL carries the search, `sessionStorage` carries the results and the marks

Three client-side stores, no server state:

- **The URL** (`?q=`) carries the search text, so navigating away and back, the
  back button, a reload and a pasted address all land on the same search
  (FR-011). TanStack Router owns it.
- **`sessionStorage`** persists the search results for two minutes, keyed by
  the normalised text (FR-012), so a reload comes back without a second visible
  wait (US2 scenarios 2 and 4). A TanStack Query cache alone dies on reload.
- **`sessionStorage`** also holds the recently-seen names (FR-021) and the
  copied/sent marks (FR-022). Both are per-operator, per-session and promised
  to nobody else, which is exactly what `sessionStorage` means.

A live answer always overwrites the cache; the cache is read only when the
provider did not answer.

## D12 — The roster is retired: two doors, one sweep kind, one bulk writer, one dead stub

What goes:

- `GET /direct-payments/links/roster` (`linksRoster`) and its response schema.
- `GET /direct-payments/links` (`listLinks`) — already unused by the panel, and
  it calls `readRoster` + `ensureLinks` on every read.
- `WispHub.listCustomersFull`, `customersPath`, `rosterForDisplay`,
  `readRoster`, and the `roster` entry in the sweep's `KINDS`.
- `ensureLinks` (bulk), replaced by `ensureLink` (D8).
- The stale Playwright stub at `tests/design/review-links.spec.ts`, which still
  routes `/direct-payments/links/search` — an endpoint removed by the pilot-UX
  round.

What stays: `WispHub.customersPage` (the prune reads nothing, but the walk unit
is what `snapshot.ts` resumes from and the `pending` kind still uses the same
machinery), the whole `pending` pass that feeds invoice reads and Cobros, and
the `sweep_kind` enum with both values — narrowing the enum would be a
non-additive migration for no gain, and `KINDS` is what decides what runs.

**Twelve existing test files read the roster**, and the constitution forbids
skipping, disabling or quarantining any of them to get green. They migrate to
the new door *before* the door is removed, in three tiers:

1. **Shared, first**: `apps/admin/test/msw.ts:95` — the `linksRoster` handler the
   whole admin suite renders against.
2. **Real assertions to rewrite**: `apps/admin/test/links.test.tsx` and
   `cobros.test.tsx`; `identity-round.test.tsx:110` (the CLABE gate);
   `presence-freshness.test.tsx` (the 30-second read floor and the re-read on
   focus, neither of which survives a paged live read);
   `apps/api/test/direct-payments-links.test.ts` (including the
   `bug: links-refused-key` 503 case, which must survive verbatim);
   `apps/api/test/presence-freshness.test.ts:109` (a block carries no shared
   `readAt`); `apps/api/test/collections-api-test-mode.test.ts:175`, which is
   where FR-017's proof lives today — it moves to the new door rather than
   disappearing with the roster; `apps/api/test/payment-requests.test.ts:100`,
   whose premise "the roster had already given a link" is false after US4;
   `tests/e2e/keyboard.spec.ts`, whose tab order rests on the roster being alive
   on arrival.
3. **Mechanical swaps**: `apps/admin/test/memberships.test.tsx:223`,
   `shell.test.tsx:167`, a stale comment in `feedback.test.tsx:72`,
   `tests/e2e/stubs.ts`, `tests/design/review-foundations.spec.ts` and
   `review-feedback.spec.ts`.

## D13 — The prune is a one-shot cron pass with a cutover baked in code, and it tells the business once

FR-023 deletes every panel link created before this feature shipped that no
payment and no clave attempt ever referenced. Three constraints shape it:

1. **It cannot ride a migration.** Migrations are applied while the previous
   Worker is still serving (constitution: additive, preview applies early), and
   that Worker still runs the roster. It would recreate what the migration
   deleted, within the minute.
2. **It must never delete a link FR-008 has just created.** So the boundary is
   not "when the prune ran" but a constant: `PRUNE_CUTOVER_MS`, the feature's
   ship timestamp, written in code with its citation. Links created after it are
   out of scope by construction, which also makes a second run a no-op (Edge
   Cases).
3. **The business must be told.** A platform-operator endpoint would tell the
   operator, not the ISP.

So: a new `link_prunes` table, one row per business, written once —
`business_id`, `ran_at`, `deleted_count`. The every-minute cron (constitution:
one trigger, new periodic work joins it) prunes businesses with no row, and
speaks only when it did something. The Links page reads the row once and shows
a single notice naming the count; dismissing it is remembered per operator.

The same pass deletes the orphaned `wisphub_sweeps` / `wisphub_pages` rows of
kind `roster`, which nothing reads after D12.

**What this costs, recorded because the spec chose it knowingly:** Devolada has
no record that a link was ever sent — no copy, no send, no payer visit. A link
an operator sent last week and one the sweep created and nobody touched are
identical in the data. The prune deletes both, and the first customer's copy
stops working. FR-024 is the consequence: they get a new link at a new address
the next time an operator acts, and nothing reissues the old one.

## D16 — The number rides the act, and Cobros stops carrying a wa.me link without one

Cobros builds its `wa.me` link from the invoice row, which carries no phone, so
today every send opens WhatsApp's contact picker and the operator finds the
person by hand. On a list of debtors that is a few seconds and one
wrong-chat risk per row — the whole cost of collecting in batch.

`POST /direct-payments/links` (D8) already reads the customer from WispHub by
exact usuario, because a panel link needs the numeric id. **That same answer
carries the phone.** So the number is free: no extra provider call, no stored
copy, and fresh by construction — which is the rule this feature is built on.
The door's `waLink` therefore opens the customer's own chat, and Cobros uses it.

`cobroRow.linkUrl` and `waLink` are **dropped**. Keeping them would leave a
field that produces the worse behaviour: a link with no number, for a debtor who
already has one, sending the operator back to the picker. With them gone, both
buttons on both surfaces take exactly one path — the act — and the batch lookup
of stored links (`chunks` under D1's parameter cap, `bug: cobros-links-lookup-params`)
goes with them.

**What it costs.** Every press is one provider read, where a debtor who already
had a link used to cost none. At the measured 0.4–0.6 s that is well under the
time it replaces, and the window opens on the click and fills when the answer
lands (D9), so the operator waits inside WhatsApp rather than in front of a
button. The alternative — a phone-less link for some rows and a real one for
others — is a page whose behaviour the operator cannot predict.

**Settled by the product creator on 2026-09-22**, against keeping `linkUrl` for
Copiar alone: it would save a read on the rows that already have a link, at the
price of two buttons on one row obeying different rules — and of keeping the
batch lookup, and its parameter chunking, alive for that one saving.

`toWhatsAppPhone` is unchanged and still owns the rules: Mexico's 52 in front,
and a refusal for a number it cannot read (`receipt spec D2, D3`) — which is
what keeps `wa.me/55…`, Brazil, from ever being dialled. A refusal falls back to
the picker, which is now the exception rather than the rule.

## D15 — The page stops reporting its own age, because it no longer has one

`presence-freshness` (D4, D7, US-P07, BUG-018) gave the Links page three
things: *"consultado hace X min"*, a re-read on return to the tab above a
30-second floor, and no *"Actualizar"* button. They existed because the page
served a cache — 30 seconds at first, then a snapshot minutes old. The operator
had to be told how old the list was.

A block is read when it renders, so there is no shared age to report and
nothing to refresh by hand. The three parts resolve differently:

- **The age indicator goes.** A row was live when it appeared. Printing a
  timestamp on a live read invents a doubt the page does not have.
- **The re-read on return stays**, as the first block only, keeping the
  30-second floor so a screen left open overnight does not show yesterday's
  first page and returning does not hammer the provider.
- **No "Actualizar" button**, unchanged — scrolling and searching are the
  refresh.

The one staleness the page ever admits is the provider being away: the cache
serves names it read minutes ago, and *"Sin conexión a WispHub"* says so
(FR-014, FR-021). That note is the whole of the honesty the old indicator used
to carry.

This retires a promise three earlier decisions made. It is recorded here rather
than discovered at implementation time (constitution I: the gap is not
tolerated silently). **Settled by the product creator on 2026-09-22**, against
the alternative of a per-row age: a timestamp on every row would print a doubt
that only exists while the provider is away.

## D14 — Cobros gets one rule and nothing else

`cobroRow.linkUrl` and `waLink` stop meaning "hide the buttons". The screen
shows Copiar and WhatsApp on every row it is allowed to (FR-026) and calls
`POST /direct-payments/links` on the act (FR-025, D8, D9).

Nothing else about Cobros changes: what it lists, how it reads debt, how it
orders rows, its freshness note, its 5-page window.

**Partly superseded by D16.** This decision first kept the two fields nullable
and kept the batch lookup of stored links, because it saved a call for a debtor
who already had one. D16 drops both fields and the lookup with them: a stored
`waLink` carries no phone, which is precisely what the act now provides. What
survives here is the rule itself — the buttons always show, and the act is what
creates the link.
