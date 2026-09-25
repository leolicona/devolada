# Research: Cobros in Links

**Feature**: [spec.md](./spec.md) · **Date**: 2026-09-25

Decisions are numbered `D<n>` and cited from code as `cobros-in-links D<n>`
(constitution I). Two sources bound everything here:

- **The code on `main` today**: `apps/api/src/routes/direct-payments/`
  (the customers door, its opaque cursor, the link act),
  `apps/api/src/routes/payment-requests/` (today's whole-list Cobros read),
  `apps/api/src/wisphub/{client,debt,snapshot}.ts`,
  `apps/admin/src/features/{links,cobros}/`.
- **What the provider answers**, as the spec's Context records it:
  - the invoice list's parameters (2026-09-01);
  - that it has no customer filter (2026-08-16, 2026-09-23);
  - one billing cycle measured on the demo tenant (2026-09-23).

`specs/010-cobros-on-demand-search` (unmerged branch) solved half of
this problem for a Cobros that kept its own section. Where a decision
below takes one of its decisions, it says so. Where this feature departs
from 010, it is because 010 served blocks from the sweep's copy, and the
creator ruled that out.

---

## D1 — The Por cobrar list is `GET /payment-requests`, answered in blocks

The resource is unchanged: the ISP's open invoices. What changes is how
it is served. It moves from one whole list to blocks. The path stays
(010 D1's argument): the admin, the MSW handlers and the Playwright stubs
already know it, and two names for one resource is drift. The admin
*route* `/payment-requests` goes away (D12). The API path is a
different namespace and keeps its name.

The contract breaks on purpose. `complete` and `readAt` go:
- `complete` meant "the whole list was cut short", and nothing is read
  whole any more;
- `readAt` fed "Consultado hace X", and a block is read when it renders
  (`links-on-demand-search` FR-027).

Only the admin consumes this door, so no caller outside the repo breaks.

**Alternatives considered**: a new door under `/direct-payments`. Rejected.
It would leave `/payment-requests` answering a whole list that nothing
reads, or a second name for the same rows.

## D2 — The cursor is the provider's own next page, carried as numbers, never as a path

The invoice list is measured to answer `next`. It is **not** measured to
page by `offset`, although the customer list does (010 D2). So the walk
follows `next`. But the cursor never carries the path itself. A cursor is
text the browser hands back, and a path the server fetched with the ISP's
key would let a client aim that key at any provider endpoint.

So the server parses the provider's `next` and keeps only the numbers of
an allow-list: `offset` and `limit`, or `page` if that is the shape M1
finds. It encodes them together with the window fixed at the walk's
first block (`desde`, `hasta`, D3), as opaque base64url
(`links-on-demand-search` D2's form, prefix `inv:`). On the next request
it **rebuilds** the path from the fixed filter and those numbers.
Unreadable text is a `VALIDATION_ERROR`, as today.

The window rides in the cursor. A walk that crosses midnight must not
start a new window halfway through, or it would skip or repeat a day of
invoices between two blocks.

**Alternatives considered**:
- Store the provider's `next` verbatim, as the sweep does. Safe there,
  where the server wrote it and the server reads it back; not safe in a
  browser round trip.
- Assume `offset`. Rejected until M1 measures it. The parser takes
  whichever of `offset` or `page` the provider's `next` carries.

## D3 — Live only: no sweep copy, no display cache

Each block is one `pendingInvoicesPage` call on a fresh `WispHub`
instance. The door never calls:
- `readPendingInvoices`, which would serve the sweep's copy to a large
  tenant (SC-006);
- the 30-second display cache in `cache.ts`, because a block is read when
  it renders, like a Links block (FR-011).

The window is today's rule, `debt-truth` D3: 180 days back by issue date,
up to one day ahead. The provider's default window is the current month,
so FR-004 makes the window explicit on every block.

What stays exactly as it is:
- the sweep's `pending` pass;
- `readPendingInvoices`;
- the payer page's `{ display: true }` read (direct-payments handler).

They feed the money paths, and this feature does not touch them (spec
Assumptions).

**Alternatives considered**: 010 D3, which cut a large tenant's blocks
from the snapshot. The creator ruled it out ("sin sweep").

## D4 — Block size is the Links rule

The client asks for what fills its viewport, and the server clamps that to
10–50: `CUSTOMERS_LIMIT_MIN`/`MAX` and `useCustomers`' `blockSize()`.
Reuse these, don't copy them. The provider allows up to 100 per page on
this list, so one block is always one call.

## D5 — What an invoice row carries, and how it is read

`pendingInvoicesPage` today maps four fields. It gains three more, all
already in the same row (no extra call):

| Field | From | Why |
| --- | --- | --- |
| `periodCents` | `sub_total` | the period part |
| `carriedCents` | the invoice's `saldo` | the *saldo anterior* (FR-006; measured 299.00 inside 798.00) |
| `period` | line text matching `Periodo del … al …` | FR-006; `null` when no line says it |

The list also reads the envelope's `count`, defensively (010 D8). When the
count is absent, FR-007 says nothing.

The provider sends money in two ways: `total` as a JSON number, `saldo`
on the customer record as a string. The invoice row's `saldo` and
`sub_total` are not yet measured for type (M3). One adapter helper
accepts either shape and always converts through the string parser
(`decimalToCents`, via `amountToCents` for numbers). Money law II: never
`× 100`.

A row whose extra fields cannot be parsed keeps its `total`, and the
unreadable part is `null`. A row is never dropped because of a field the
screen only uses as detail.

`PendingInvoice` is shared with the money paths. The new fields are
**optional additions**: `debtOf` keeps reading `totalCents` alone, and
nothing on the money path changes behaviour.

## D6 — Grouping is the client's, in order of arrival, never sorted

The door returns invoices. The screen groups them by `usuario`, across
every loaded block, in the order each customer first appears
(`groupCobros` without its sort).
- A later block's invoice for a customer already on screen joins that
  row: its total and count grow.
- Overdue is judged by the business's timezone (`todayIn`, as today).

Grouping on the server would group one block at a time, so a customer
split across two blocks would still show twice. Grouping on the client
over the loaded pages fixes that for free.

**Alternatives considered**: sort by oldest due date. It would need the
whole list (spec Assumptions).

## D7 — The provider being away is an answer on this door too

This mirrors `links-on-demand-search` D10, with one difference: Devolada
holds no copy of anyone's debt, so there are no rows to fall back on (010
D9).

| Situation | Answer |
| --- | --- |
| WispHub times out or fails | `200 { results: [], nextCursor: null, total: null, wisphub: "unavailable" }` |
| WispHub refuses the key | `503 WISPHUB_AUTH_FAILED`, as today |
| No integration | `409 NOT_CONFIGURED`, as today |

The client tells *nobody owes* (`ok` with no rows) apart from *could not
read* (`unavailable`):
- first block unavailable: the empty state with Reintentar, never "Nadie
  tiene facturas abiertas";
- a later block unavailable: the rows on screen stay under the quiet note
  "Sin conexión a WispHub" (FR-012).

## D8 — The Por cobrar search is the customers door, panel rows only

A search in the Por cobrar view asks `GET /direct-payments/customers?q=`
exactly as the customer view does: four filters, blocks, and the count
floor (`links-on-demand-search` D4, D5).

The door gains one optional parameter, `channel=panel`. When it is set,
the door skips API links. It skips them on the server, not in the
browser, so that the "más de N" floor and the final count stay honest
(FR-010).

When WispHub is away, the fallback is the panel links matching by
usuario, as today. Every one of those rows then answers "could not
confirm" from D9.

**Alternatives considered**: filtering `channel === "api"` in the browser.
Rejected: the count would include rows that are never shown.

## D9 — What a search result owes: one door, two provider reads, one operation

`GET /direct-payments/customers/debt?usuario=` reads:

1. **the customer record**, by exact `usuario=` (`getCustomer`, the read
   the link act already uses). It gives the fresh `saldo`, the billing
   label and the `id_servicio`;
2. **that customer's open invoices**, from WispHub's one-call balance
   door, `/clientes/{id_servicio}/saldo/` (D10).

It then composes them with the existing rule: `debtFor` over the invoices
as a `live`, `complete` list, and `nothingOwedIsProven` for a zero. No new
debt arithmetic.

**Why both halves come from this door and not from the search row**:
this is a change from the spec as first written. FR-017 said the carried
balance would come from the record the search already returned, which is
one extra read per result. The measured billing cycle is why it was
changed. The billing run moves the carried balance into a new invoice and
zeroes the record *at the same instant*. A balance read at search time
plus invoices read seconds later, across that instant, adds 299.00 to an
invoice that already holds it: 1,097.00 shown for 798.00 owed. Reading
both halves in one operation, half a second apart, is what keeps the
no-double-count guarantee.

The cost: **two WispHub calls per result shown, not one.** The spec
(FR-017, Clarifications) is amended to say so, and the report to the
creator names it.

The two calls run in sequence, because the balance door needs the fresh
`id_servicio`. A search row's `wisphubId` is a cache that may be recycled
(`direct-payment` D5).

| Answer | Shape |
| --- | --- |
| Debt above zero | `{ state: "owes", totalCents, invoiceCents, carriedBalanceCents, invoices[] }` |
| Zero, proven | `{ state: "none", … }` |
| Either read failed, or the customer is gone | `{ state: "unconfirmed" }`, a 200 |
| Refused key | `503 WISPHUB_AUTH_FAILED` |

FR-018 is exactly those three states.

**Alternatives considered**:
- Resolve the debts inside the search request. Rejected: one slow
  customer would hold the whole block (spec edge case), and the operation
  budget would be spent on up to 50 customers at once.
- Send the search row's balance from the browser. Rejected: the rule for
  money would then depend on a value a browser echoes back, and the race
  above stays.

## D10 — The one-call balance door enters the adapter, for open invoices only

`WispHub.openInvoicesOf(idServicio)` reads `/clientes/{id}/saldo/` and
returns its `facturas[]` mapped as `PendingInvoice` (id, dates, `total`).
It deliberately does **not** return the door's own `saldo`. That figure
counts open invoices only, and FR-015 forbids it as an answer on its own.
It also ignores `url_pago`, which was measured without a host
(`http:///saldo/…`).

This door has no date window, so an invoice older than 180 days counts
(FR-017, the spec's edge case).

**What is measured and what is not.**
- **Measured on the demo** (2026-09-23): 0 with no open invoice; 798.00
  with that invoice listed once the billing run issued it.
- **Measured on the pilot**: only the zero case (the 600.00-against-0
  row).
- **Not measured**: a pilot customer with an open invoice, and a customer
  with two. Measurement M2 (quickstart) runs before the adapter is
  written.

If M2 disagrees with the invoice list, this decision is reopened with the
creator before anything ships. Until then an unreadable answer is
`unconfirmed`, never a zero.

## D11 — The browser asks for a result's debt row by row, four at a time

- **One query per result row**, keyed by `usuario`, fired for the rows of
  the blocks that have loaded. Blocks are sized to the viewport (D4), so
  the loaded rows are the rows on screen or one scroll away. That is how
  SC-009 (N results, at most N debt reads) holds.
- **A cap of four at a time.** A block of up to 50 results is at most 100
  provider calls. The cap keeps a large block from reaching the ISP's
  WispHub as one burst. WispHub's rate limits are unknown, and the cap is
  the conservative guess.
- **Results are reused for two minutes**, the search results' own figure
  (`links-on-demand-search` FR-012).
- **While a row waits**, it shows the customer at once with
  "Consultando adeudo" inside a `<Pending>` (`pending-lint`).
- **A refused key on any row** switches the page to the setup message that
  links to Integraciones, exactly as the customer view does
  (`bug: links-refused-key`).

## D12 — The view lives in the address; the old address redirects

- **The address.** `/links` gains `view=receivables` beside `q`
  (`linksSearch`, the route's `validateSearch`). Absent means the customer
  view, which is also the default (FR-001).
- **The old address.** The admin route `/payment-requests` becomes a
  redirect to `/links?view=receivables` (FR-014), and it keeps any `q` it
  was given.
- **The menu** loses its Cobros entry.
- **Why English words:** the value is an identifier, following the
  router's own rule that routes are English.
- **Local memory is keyed by view.** `seen.ts` (the per-tab memory of a
  search) and the query keys include the view. The same text in the two
  views asks two different questions.

## D13 — The chip appears only for a business with WispHub

- The customers door already answers `wisphub: "not_configured"`. When it
  does, the page does not render the chip (FR-013).
- An address that arrives with `view=receivables` for such a business gets
  a `409 NOT_CONFIGURED` from the receivables door. The page then falls
  back to the customer view instead of showing an error.

## D14 — The chip is the admin's existing `Tabs` primitive

- **What it looks like.** A two-option segmented control, *Todos* and
  *Por cobrar*, using the shadcn `Tabs` already copied into
  `apps/admin/src/components/ui/tabs.tsx`. Today's Cobros screen already
  uses it, so no new primitive.
- **Size.** Compact, 40px (desktop admin). It sits beside the search box
  and wraps under it at 360px, with no horizontal scroll (browser layer).
- **Which views it holds.** Only the two views. The due-date filters are
  out of scope (spec Assumptions).

## D15 — Two new statuses for a result's debt, in `StatusBadge`

`packages/ui`'s `StatusBadge` is the only way a status is drawn. It gains:
- `debtNone`: *Sin adeudo*, success tone, check icon;
- `debtUnconfirmed`: *Sin confirmar*, warning tone, question icon.

An amount owed is not a status. It renders with the `Amount` atom
(tabular numerals). The list row's *Venció* / *Vence* keeps today's icon
and text, which is a date and not a status.

## D16 — What goes

- `apps/admin/src/features/cobros/CobrosScreen.tsx`. Its row, grouping and
  date helpers move into `features/links/`, and the rest is deleted.
- **The Cobros section's presence rules** (`presence-freshness`): the
  heartbeat, the refresh when a payment reaches WispHub, and "Consultado
  hace X". The view follows the Links rule instead: re-read the first
  block on return to the tab, at most every 30 seconds (FR-011). This
  retires those promises for this screen and says so, the way
  `links-on-demand-search` FR-027 did for Links.
- **The whole-list read** of `/payment-requests`, and its warning "La lista
  puede estar incompleta".

**Nothing about the sweep goes.** `SWEEP_PAGES`, the `pending` pass and
`readPendingInvoices` stay, because the money paths read them.

## D17 — Tests, by layer (constitution IV)

| Layer | What it proves |
| --- | --- |
| API (workerd + D1, `fetchMock` at the WispHub origin) | the block walk and its cursor, including a crafted cursor refused; the window carried across blocks; the three answers of D7; the debt door's three states with the measured cycle (299 carried then 798 open, never 1,097); `channel=panel`; SC-006, with a seeded snapshot whose rows differ from the live answer, and the door returns the live ones |
| Component (MSW) | the chip and its address; grouping across two blocks; the empty-vs-unavailable distinction; a row's debt states and "Consultando adeudo"; the redirect; the chip absent without WispHub |
| Browser (Playwright + axe) | the chip at 360/768/1280 with no horizontal scroll, touch targets, and contrast of the two new badges in both themes |

Each file cites `cobros-in-links US<n>`.
