# Bug Assessment: the Links roster stops at the first 1,000 customers, so the rest have no payment link

- **Slug**: links-roster-cap
- **Created**: 2026-09-19
- **Source**: pasted text (product creator, in session: "for links" — the
  roster "is only reading the first 1000 results"). No URL supplied, so the
  URL Trust Policy did not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: high

> **Scope note.** The creator's product direction of 2026-09-19 folds the
> cap fix into one feature spec with the integration boundary and a Links
> redesign (delivery queue, server-side search). This assessment is the
> narrower thing the creator asked for on the bug path: **every customer of
> the ISP in the roster, with a link**. The redesign stays with the spec; the
> stored roster this fix produces is the customer directory that redesign
> will search.

## Report (verbatim or summarized)

> "did you apply for links, because links is only reading the first 1000
> results?"

Sibling of `pending-invoice-cap` (fixed in PR #219, merged to `main` as
`a14aada`): the same pilot-scale read cap, on the customer list instead of the
invoice list.

## Symptom

`/links` in the ISP panel lists at most 1,000 customers and shows *"La lista
puede estar incompleta: WispHub devolvió más clientes de los que podemos leer
de una vez."* On the connected ISP — 6,509 customers on `api.wisphub.io`,
measured 2026-09-18 — the roster answered exactly `{complete: false, panel:
1000}`: **5,509 customers (85%) have no payment link**, no row to search, no
WhatsApp button, and nothing to send them. Which 1,000 are visible is
WispHub's list order, not the ISP's choice, so from the panel the missing ones
look random.

Expected: the roster holds every customer of the tenant, each with their
permanent link (direct-payment D5, admin-links-view D5: "every WispHub
customer has one without anybody creating them by hand"), whatever the
tenant's size.

The banner is truthful, and no money is misread — the payer's page, the
submission and the verdict work for any customer *who has a link*. The loss is
that most of this ISP's customers cannot be given one.

## Reproduction

Deterministic with the test suite's mocked provider (`fetchMock` at
`WISPHUB_ORIGIN`), the shape `direct-payments-links.test.ts` US-D07 already
uses:

1. Seed a business with a WispHub key.
2. Mock `/clientes/?limit=100` to answer eleven pages of 100 customers, each
   page's `next` pointing at `offset=(k+1)*100`, the eleventh with
   `next: null`.
3. `GET /direct-payments/links/roster` as the business →
   `data.complete: false`, `data.results.length === 1000`; `payment_links`
   holds 1,000 rows. Expected: 1,100 rows, `complete: true`.

Live: the connected ISP's `/links` (measured 2026-09-18: 1,000 panel rows,
`complete: false`, WispHub `count: 6509`).

## Suspected Code Paths

- `apps/api/src/wisphub/client.ts:237-249` — `listCustomersFull()`: ten pages
  of `/clientes/?limit=100`, `complete: path === null`. The comment on its
  sibling says it: "10 pages of 100 covers the pilot scale with room".
- `apps/api/src/wisphub/client.ts:255-265` — `listCustomers()`: the same
  ten-page walk for `GET /direct-payments/links` (`listLinks`,
  `handler.ts:1033-1049`), and it carries **no `complete` flag at all** — a
  silent truncation. The admin does not call this door today
  (`LinksScreen` reads `/links/roster` only); the API test suite does.
- `apps/api/src/wisphub/cache.ts:165-176` — `rosterForDisplay()`: the
  30-second display cache over `listCustomersFull()`, keyed by tenant and
  installation. Stores the truncated answer as-is.
- `apps/api/src/routes/direct-payments/handler.ts:1098-1180` — `linksRoster()`:
  reads the roster, `ensureLinks` creates the missing links for what it got,
  returns `complete: roster.complete`. Correct for what it is given; it is
  given 1,000.
- `apps/api/src/routes/direct-payments/handler.ts:64-135` — `ensureLinks()`:
  reads tokens and inserts missing links in chunks under D1's parameter cap
  (BUG-021). At 6,509 customers the first listing writes ~590 insert
  statements in one request; later listings only read.
- `apps/admin/src/features/links/LinksScreen.tsx:33,37-46,160-171,261-266` —
  local paging of 50 with "Mostrar más", the *"consultado hace N min"*
  freshness line, the client-side contains-search, and the banner. Renders
  everything the API sends; nothing to fix here.
- `apps/api/src/wisphub/pending-snapshot.ts` (on `main` since `a14aada`) —
  the background read built for the invoice cap: sweep row per tenant,
  pages stored per pass, demand-driven wake, rest for tenants that fit, a
  swap only on a finished pass. Built to take a second kind of pass; today it
  knows only the invoice list.

Existing tests pin the cap's *presence* nowhere: `direct-payments-links.test.ts`
mocks one page and asserts `complete: true` (lines 46–69, 261–262); no test
answers a `next` on the tenth page.

## Root Cause Hypothesis

Confidence: **high** — read from the code and measured on the ISP.

WispHub's customer list is paged at 100 and a request cannot walk a large
tenant: at the measured 0.4–0.6 s per call, 6,509 customers are 66 pages and
30–40 s, three times one operation's budget (provider-latency D1) and past
the 30-second display cache. So the walk was capped at ten pages "for the
pilot scale", the truncation handed to the screen as a flag, and the cap is
now the steady state of a real ISP. Exactly the invoice cap's story, one list
over: raising the number cannot fix it, because the read does not fit a
request at any number this ISP can reach.

## Proposed Remediation

**Preferred**: give the roster the same background read the invoices have —
one sweep, two kinds of pass. Generalise the snapshot tables and the sweep
from "pending invoices" to "a WispHub list of the tenant", keyed by
`(business, kind)` with `kind ∈ {pending, roster}`: the roster pass walks
`/clientes/?limit=100` through a new `customersPage(path)` on the adapter
(the resumable unit `listCustomersFull` then reuses), stores each page's
mapped `WispHubCustomer[]`, and swaps in when finished. `readRoster(db,
businessId, wisphub, now)` mirrors `readPendingInvoices`: a tenant whose
finished pass is longer than the live budget (`ROSTER_LIVE_PAGES = 10`) serves
the snapshot with `complete: true` and `readAt` = the pass's end; a tenant
that fits keeps the live read and its 30-second cache, unchanged; a cut-off
live read wakes the roster sweep, so the fix engages itself on the ISP that
needs it and costs a small ISP nothing. `linksRoster` reads through that door
and changes nothing else; the banner disappears on its own when `complete`
turns true, and *"consultado hace N min"* already tells the ISP how old the
list is.

Create the links where the list is read: the roster sweep calls `ensureLinks`
for each page it stores (100 customers → a handful of chunked statements per
tick), so the first listing of a 6,509-customer tenant is a read, not ~590
inserts inside one request. `ensureLinks` moves from the route handler to
`direct-payments/links.ts`, where the sweep can import it without reaching
into a route. Route `listLinks` (`GET /direct-payments/links`) through the
same `readRoster`, so its silent truncation ends with the same change.

The snapshot tables hold nothing durable — a pass rebuilds in minutes — so
migration 0033 can drop and recreate them under the general shape
(`wisphub_sweeps`, `wisphub_pages`) rather than alter in place. `main`
already carries 0032 (merged), so this is a new migration, not an edit.

**Alternatives**:
- *Two parallel table pairs and a copied sweep* for the roster. No
  migration of the invoice tables, but two copies of the tick, the claim,
  the rest and the swap — the drift the constitution's "one recipe" rule
  exists to prevent. Rejected.
- *Raise the cap to 66 pages.* 30–40 s on the Links tab, and every
  return to the tab after the 30-second cache pays it again; the next ISP
  is bigger. Rejected for the reason the invoice fix rejected it.
- *Store the roster only, no sweep* (read once, on demand, in the request,
  for as long as it takes). The first open of Links would hang half a
  minute and any provider stall inside it loses the whole read; the
  invoice sweep already solved this shape. Rejected.

**Files likely to change**:
- `apps/api/src/db/schema.ts` + `apps/api/migrations/0033_*.sql` — `kind` on
  the sweep row and the pages; tables renamed to the general shape
- `apps/api/src/wisphub/pending-snapshot.ts` → generalised (a `kind` with
  its first path, page fetcher and live budget; `readRoster`,
  `wakeRosterSweep`; one `sweepWispHubLists`), or a sibling module sharing
  the tick
- `apps/api/src/wisphub/client.ts` — `customersPage(path)`;
  `listCustomersFull` on top of it; `ROSTER_LIVE_PAGES`; `listCustomers`
  folded into the same read or removed
- `apps/api/src/wisphub/cache.ts` — `rosterForDisplay` stays the live display
  path behind `readRoster`, comment amended
- `apps/api/src/direct-payments/links.ts` — `ensureLinks` moves here
- `apps/api/src/routes/direct-payments/handler.ts` — `linksRoster` and
  `listLinks` read through `readRoster`; `ensureLinks` imported
- `apps/api/src/index.ts` — the one sweep call covers both kinds (or a second
  call in the same lane)
- `apps/api/test/links-roster-cap.test.ts` (new); `test/pending-invoice-cap.test.ts`
  and `test/direct-payments-links.test.ts` only if the table rename touches
  their imports

**Tests to add or update** (every one cites `bug: links-roster-cap`):
- Eleven pages with a `next` on the tenth: the roster answers `complete:
  false` with 1,000 rows and wakes the roster sweep (a row of kind `roster`,
  `rest_until` null); no invoice sweep row is born from it.
- The sweep reads all eleven pages (two ticks at `SWEEP_PAGES`), finishes,
  and the roster answers `complete: true` with 1,100 rows, every one with a
  token; `readAt` is the pass's end; the second read creates nothing.
- Links are created by the sweep as pages land: after the first tick,
  `payment_links` holds the customers of the pages stored so far.
- A tenant that fits (one page) stays live and cached: the `/clientes/`
  mock is consumed on the read, no sweep row.
- Both kinds on one tenant: an invoice pass and a roster pass keep separate
  cursors and swap independently; a moved installation resets both.
- `GET /direct-payments/links` (the paged door) lists the whole tenant, not
  the first 1,000.

## Risks & Considerations

- **Freshness**: a customer added in WispHub appears in Links after the next
  finished pass (~7–14 minutes at 66 pages, 10 per minute); a deleted one
  lingers as long. `readAt` says so on the screen. The invoice fix already
  accepted this trade for money; the roster is display and link creation,
  which tolerate it better.
- **Payload**: the roster travels whole to the browser (design of the
  pilot-UX round: "the list travels once and the browser searches it").
  6,509 rows are roughly 1.3 MB of JSON per open of the Links tab. It works
  — local paging of 50 and the contains-search cope — and it is the reason
  the creator's spec moves search server-side over the stored directory.
  Not this fix's problem to solve, but the number to know.
- **Two sweeps per tenant per minute** on WispHub for a large ISP: ~10 pages
  of invoices and ~10 of customers, ~20 calls/minute, continuous. Rate
  limits are unknown; the invoice fix already runs the first ten. If WispHub
  pushes back, the roster kind can rest between passes (it is less
  time-sensitive than the debt list) — a constant, not a redesign.
- **Migration on live tables**: 0033 drops and recreates the two snapshot
  tables; the invoice snapshot on the deployed dev/prod is lost for the
  minutes a new pass takes, during which the payer's page answers *"no
  pudimos consultar tu cuenta"* for customers beyond page five — the same
  first-pass window the invoice fix's deploy had. Time the release
  accordingly (not during the ISP's billing morning).
- **Link creation in the cron**: `ensureLinks` today runs under an ISP
  session; in the sweep it runs unattended. It writes only missing rows and
  is idempotent (BUG-020), so the risk is volume, and chunking (BUG-021)
  bounds it. The D1-cap guard `main` added in `test/setup.ts` (#218) will
  catch a chunk over the limit in the suite.
- **`listCustomers` order**: which customers WispHub lists first is unknown;
  irrelevant once the whole list is stored.
- **Branch base**: this worktree's branch sits on `7c30a8e`, before `main`
  merged #219 (`a14aada`) and #217/#218. The fix should start from `main`.

## Open Questions

- [NEEDS CLARIFICATION: WispHub's rate limits for a tenant key — two
  background reads per minute is the new steady state for a large ISP; one
  answer from WispHub or one week of the sweep's `last_error` column settles
  it.]
- Product: whether the roster pass may rest between passes on a large tenant
  (say, one pass every 30 minutes) to halve the background traffic, at the
  cost of a new customer waiting up to half an hour for their link.
  Recommendation: continuous, like the invoices, until WispHub says otherwise
  — a constant either way.
- Sequencing with the creator's feature spec (delivery queue, server-side
  search over the stored directory): this fix lands the directory; the spec
  should read from it rather than plan its own. Confirm the spec's plan
  starts from `wisphub_pages` of kind `roster` (or a table derived from it)
  before it is written.
