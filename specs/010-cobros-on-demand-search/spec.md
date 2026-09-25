# Feature Specification: Cobros On-Demand Search

**Feature Branch**: `010-cobros-on-demand-search`

**Created**: 2026-09-22

**Status**: Draft — two decisions taken in session 2026-09-22 (both halves of
the 009 strategy; its own feature rather than an amendment to a shipped one)

**Input**: User description: "Cobros: on-demand debtor search and paged blocks. The Cobros page today reads the whole tenant's pending-invoice list in one response — live for a small ISP, or the every-minute sweep's stored snapshot for a large one — and then groups, filters, searches and pages those rows in the browser. On the connected ISP (6,513 customers, measured 2026-09-20) that is every pending invoice in one payload on every refresh, and the search box only ever reaches what already travelled. Bring Cobros the strategy 009 gave Links: the page asks for what it shows. Two halves. (1) Blocks: the pending-invoice list is delivered one block at a time, one provider read each, the first no larger than what fills the viewport and the next asked for only when the operator scrolls toward it — WispHub's `/facturas/` pages by `limit` and `offset` and answers a total count. The page never walks the list to its end on its own, and the "la lista puede estar incompleta" warning goes away because nothing is read whole. (2) Search: from the third character, after a short debounce, the search box stops filtering the rows on screen and asks Devolada, which asks WispHub. The provider constraint that shapes this: `OPTIONS /facturas/` (measured 2026-09-01) documents `estado`, `tipo_fecha`, `desde`, `hasta`, `forma_pago`, `zona` and `cajero` — there is NO customer filter on the invoice list, re-verified live 2026-08-16. So a debtor search cannot be asked of `/facturas/`. It is asked of `/clientes/` exactly as Links asks it — the same text against `nombre`, `apellido`, `usuario` and `telefono` at once with `__contains`, case- and accent-insensitive, merged without duplicates, capped, with "more than N matched, be more specific" when there are more — and the debt of each matched customer is then resolved. This makes Cobros able to find a debtor it cannot show today: a customer who short-paid closes their invoice as "Pagada" while the remainder moves to `saldo` (measured: total_cobrado 40 against a 100 invoice leaves saldo "60.00" with estado_facturas "Pagadas"), so they owe money and appear nowhere on the collections screen, because every row comes from the pending-invoice list. The same holds for a customer whose only pending invoice is older than the 180-day window the list reads. The search text lives in the URL (?q=) so it survives navigating away and back, the back button and a reload; results for the same text are reused for two minutes. Costs accepted, named here so the spec states them rather than discovering them: grouping invoices by customer becomes per-block, so one debtor's invoices can split across two rows when a block boundary falls between them; the Vencidas / Por vencer tabs and the totals cover the blocks that have loaded, not the whole tenant; and the provider promises no ordering on the invoice list, so a debtor can appear twice or be skipped between blocks — the page promises a debtor can be FOUND, by search, never that the list reads the same twice. When WispHub cannot be reached the page keeps what it has under the quiet "Sin conexión a WispHub" note it already shows, never an error block, and a refused key stays a setup problem that sends the operator to Integraciones. Roles and CLABE gating unchanged. Out of scope: how debt is computed (debt-truth's rule — pending invoices plus saldo — is untouched), the Copiar and WhatsApp buttons and the link they create (009 US4 already did that), the sweep's `pending` pass itself and every money path that reads it, delivery states, and WispHub webhooks."

## Context

Cobros is where the ISP decides who to chase. It answers one question —
*who owes me* — and the operator works down it, pressing WhatsApp on each
debtor in turn. 009 gave that screen the ability to *send*; this one gives
it the ability to *find*.

Today the page asks Devolada for the tenant's whole pending-invoice list in
one response, then groups, filters, searches and pages those rows in the
browser. For an ISP the live read can finish — five pages of a hundred — that
is up to 500 invoices in one payload. For a larger one the rows come from
the every-minute sweep's stored pass, which for the connected ISP (6,513
customers, measured 2026-09-20) is every pending invoice the tenant has, in
one payload, on every refresh.

That is the same shape Links had before 009: a whole base read to answer one
question. It carries the same two costs, and one more that is particular to
Cobros.

**The search box only reaches what already travelled.** It filters rows in
the browser, so it can only find a debtor who is already in the payload.

**Cobros cannot show a debtor whose debt lives only in `saldo`.** Every row
on the screen comes from the pending-invoice list. When a customer pays less
than their invoice, WispHub closes that invoice as *Pagada* and moves the
remainder to the customer's running account — measured on the demo tenant:
`total_cobrado: 40.00` against a 100.00 invoice answers *"Se aplico un saldo
pendiente de pago de 60.00 al cliente"*, and the customer then reads
`saldo: "60.00"` with `estado_facturas: "Pagadas"`. They owe sixty pesos.
They are on no list Cobros draws. The same is true of a customer whose only
pending invoice is older than the 180-day window the list reads.

This is not an edge case in a product built around partial payments: a short
payment and a return visit is the ordinary aftermath of a payer who did not
have the whole amount today. The collections screen goes quiet about exactly
the customers who were half-way to paying.

This feature is the second of the three pieces agreed for the distribution
and collection channels (Links search → **Cobros** → WispHub webhooks).

## Clarifications

### Session 2026-09-22

- Q: Which half of the Links strategy should Cobros get — the provider-side
  search, the paged blocks, or both? → A: **Both.** The search is what makes
  any debtor reachable; the blocks are what stop the page reading a whole
  tenant to show a screenful. The costs of the blocks (grouping, tabs,
  ordering) are accepted and named in this spec rather than discovered
  during implementation.
- Q: Should this extend 009 or be its own feature? → A: **Its own.** 009 is
  shipped, and it says in writing that everything about Cobros except its two
  link rules is untouched. Amending a finished spec to describe work it
  deliberately excluded would make its record untrue.
- Q: The invoice list cannot be filtered by customer. Where does a debtor
  search go? → A: To the **customer** list, exactly as Links asks it — the
  same text against `nombre`, `apellido`, `usuario` and `telefono` at once —
  and the debt of each matched customer is resolved from there. This is what
  lets the search find the `saldo`-only debtor the invoice list cannot name.
- Q: What does a search show for a matched customer who owes nothing? → A:
  The customer, marked as owing nothing — never hidden. Hiding them is
  indistinguishable from "this customer does not exist", which is the
  failure `bug: customer-lookup-misses` was. When the answer cannot be
  proven (`debt-truth` D4/D14), the row says so rather than printing a zero.
- Q: What happens to the Vencidas / Por vencer tabs once the list arrives in
  blocks? → A: They are asked of the provider, which filters the invoice
  list by due date, so a tab stays true across every block instead of
  describing only the rows that have loaded. A tab that silently covered
  the loaded blocks would be a worse screen than no tab at all.

## User Scenarios & Testing *(mandatory)*

Stories are numbered in the order they were written. In priority order they
are **US1 (P1), US2 (P1), US3 (P2), US4 (P3)**.

### User Story 1 - Any debtor can be found (Priority: P1)

An operator is chasing a specific customer — one who called saying they paid,
one the ISP suspended last week, one whose name a colleague passed on. They
open Cobros, type part of the name, usuario or phone, and see that customer
with what they owe, whether or not that customer is on the list below.

This works for a customer who owes through a pending invoice, for one who
short-paid and carries the remainder in their running account, and for one
whose unpaid invoice is older than the window the list reads. It works for
the 6,513th customer exactly as for the first.

**Why this priority**: this is the feature. An operator who cannot find the
debtor they are looking for goes to WispHub's own panel instead, and the
collections screen stops being where collecting happens.

**Independent Test**: on a connected ISP, search for a customer who
short-paid — whose invoice reads *Pagada* and whose running account is
positive — and confirm they appear with the amount they still owe, when no
list on the screen contains them.

**Acceptance Scenarios**:

1. **Given** a customer with a pending invoice, **When** the operator types
   three or more characters of their name, **Then** that customer appears
   with their usuario and the total they owe.
2. **Given** a customer who short-paid — invoice closed, remainder in the
   running account — **When** the operator searches for them, **Then** they
   appear with the remainder as the amount owed.
3. **Given** a customer whose only pending invoice is older than the window
   the browse list reads, **When** the operator searches for them, **Then**
   they appear with that invoice's amount owed.
4. **Given** a search typed with or without accents or capitals, **When** it
   runs, **Then** the same customers are found either way.
5. **Given** a search by phone digits, **When** it runs, **Then** customers
   whose phone contains those digits appear.
6. **Given** a search that matches many customers, **When** the results
   arrive, **Then** the page shows the first ones, says how many matched and
   asks for a more specific search.
7. **Given** a matched customer who owes nothing, **When** the results show,
   **Then** they appear marked as owing nothing — never omitted.
8. **Given** a matched customer whose debt cannot be confirmed, **When** the
   results show, **Then** the row says so and shows no amount.
9. **Given** fewer than three characters typed, **When** the operator pauses,
   **Then** nothing is searched and the page says at least three characters
   are needed.
10. **Given** the operator types quickly, **When** results arrive, **Then**
    only the results for the text as it is now are shown.
11. **Given** a viewer, or a business with no CLABE, **When** they search,
    **Then** they see the same results with the buttons withheld exactly as
    they are withheld on the list today.
12. **Given** a search result for a customer with no link, **When** the
    operator presses Copiar or WhatsApp, **Then** the link is created at
    that moment and the action proceeds with it — the same rule the browse
    row already follows.
13. **Given** results on screen, **When** the operator only reads them,
    **Then** no link is created for any of them.

---

### User Story 2 - The page asks for what it shows (Priority: P1)

An operator opens Cobros. The first screenful of debtors is there. As they
scroll, the next block arrives. Nothing warns that the list may be
incomplete, because nothing was read whole — and no ISP pays for its whole
invoice list to travel so that one screen can be drawn.

**Why this priority**: it is half of what was asked, and it is what makes the
page's cost independent of the ISP's size. It also retires the "la lista
puede estar incompleta" warning, which has been the screen's standing
admission that it could not do its job.

**Independent Test**: open Cobros on the largest connected ISP and confirm
the first block renders without waiting on the whole list, that scrolling
brings more, that the page never walks to the end on its own, and that the
incompleteness warning is gone.

**Acceptance Scenarios**:

1. **Given** a connected ISP of any size, **When** the operator opens Cobros,
   **Then** the first block of debtors renders and no more is read.
2. **Given** the first block on screen, **When** the operator scrolls toward
   the bottom, **Then** the next block is asked for and appended.
3. **Given** the operator does not scroll, **When** they stay on the page,
   **Then** no further block is read.
4. **Given** blocks on screen, **When** the operator looks at the page,
   **Then** no "la lista puede estar incompleta" warning appears anywhere.
5. **Given** the operator scrolls past the last block, **When** the empty
   answer arrives, **Then** the list stops and says how many pending
   receipts the ISP has.
6. **Given** the Vencidas or Por vencer tab is chosen, **When** blocks load,
   **Then** every block answers that tab — the tab is not a filter over the
   rows that happen to be loaded.
7. **Given** an ISP with no pending invoice at all, **When** the page opens,
   **Then** it says nobody owes today, with no warning and no error.
8. **Given** the provider answers the same customer in two blocks, **When**
   both are on screen, **Then** that customer is rendered once.
9. **Given** an invoice whose due date is yesterday in the business's
   timezone but today in the browser's, **When** the blocks render, **Then**
   it counts as overdue by the business's timezone.

---

### User Story 3 - The search survives leaving the page (Priority: P2)

An operator searches for a debtor, goes to Pagos to check whether their
transfer landed, and comes back. The search text and its results are still
there. The same holds for the back button and for a reload, and a search's
address can be sent to a colleague.

**Why this priority**: collecting is interrupted work — every debtor chased
is a trip to another screen and back. A search that has to be retyped each
time is the difference between a worklist and a toy.

**Independent Test**: search, navigate away and back, press back, reload —
each time the same text is in the box and the same results are on screen,
with no second visible wait when the search is recent.

**Acceptance Scenarios**:

1. **Given** a search with results, **When** the operator goes to another
   page of the panel and returns, **Then** the box holds the same text and
   the same results are on screen.
2. **Given** a search with results, **When** the operator reloads, **Then**
   the same text and results come back.
3. **Given** a search, **When** its address is opened by a colleague with
   access to the same business, **Then** it opens on that search.
4. **Given** a search repeated within two minutes, **When** the operator
   returns to it, **Then** the previous results show at once; after two
   minutes the page asks again.
5. **Given** the operator clears the box, **When** they leave and return,
   **Then** the page opens on the browse list, ready to search.

---

### User Story 4 - Cobros keeps working when WispHub does not (Priority: P3)

WispHub is slow or away. The rows already on screen stay, under the quiet
note the page already shows. A search says plainly that it needs WispHub
rather than answering an empty list that would read as "nobody owes".

**Why this priority**: the screen must never be a void, and it must never
lie in the direction of "nothing to collect". A refused key is a different
matter and keeps its own door.

**Independent Test**: with WispHub unreachable, confirm loaded blocks stay
under the note, a new search says it needs WispHub and shows no error block,
and a refused key sends the operator to Integraciones instead.

**Acceptance Scenarios**:

1. **Given** blocks on screen and WispHub away, **When** a background read
   fails, **Then** the rows stay under "Sin conexión a WispHub" and no error
   block appears.
2. **Given** WispHub away, **When** the operator searches, **Then** the page
   says the search needs WispHub, shows no rows and shows no error block —
   never an empty result that reads as "nobody owes".
3. **Given** WispHub away, **When** the operator asks for the next block,
   **Then** the page says so quietly and keeps what it has.
4. **Given** a key WispHub refuses, **When** the page reads or searches,
   **Then** the operator is sent to Integraciones, exactly as today, with no
   Reintentar.
5. **Given** a business with no WispHub connected, **When** it opens Cobros,
   **Then** it is told to connect WispHub, exactly as today.
6. **Given** WispHub answering again, **When** the operator repeats the
   search or returns to the tab, **Then** the note disappears and fresh rows
   replace what was held.

---

### Edge Cases

- **A debtor's invoices fall across a block boundary.** They appear as two
  rows, each summing the invoices in its own block. The page promises that a
  debtor can be *found* — by search, where their whole debt is resolved —
  never that the browse list groups a customer's invoices whole.
- **The provider promises no ordering on the invoice list.** A debtor can
  appear in two blocks or be skipped between them while the tenant's
  invoices change under the walk. A skipped debtor is still reachable by
  search; a repeated one is shown once.
- **A searched customer has no usuario.** They cannot be identified or acted
  on, and do not appear — the same rule the browse list already applies.
- **Two customers share a name.** They are told apart by usuario and phone
  on the row, as today.
- **A block arrives after the operator has started a search.** It is
  discarded; the screen shows the search.
- **An answer for an earlier search arrives after a later one.** Only the
  results for the text in the box are shown.
- **Leading and trailing spaces are ignored**; a text of only spaces is not a
  search and the page browses.
- **A search matches a customer who owes nothing.** They show, marked as
  owing nothing (US1 scenario 7) — hiding them would read as "not found".
- **A search matches a customer whose debt cannot be proven.** The row says
  it cannot be confirmed and shows no amount, rather than printing a zero
  that the operator would act on.
- **An invoice row carries no due date.** It cannot belong to a due-date
  bucket — there is no date to put it in one — so it appears under Todas and
  in neither Vencidas nor Por vencer. It is a debt like any other: it is
  never dropped from Todas, and it is always reachable by search. The page
  states which question a tab answers rather than implying the three add up.
- **The operator switches tab mid-scroll.** The loaded blocks are dropped and
  the new tab starts from its own first block — a tab is a different
  question, not a filter over the last one's rows.
- **A payment registered in Devolada clears a debtor while blocks are on
  screen.** The page re-reads as it already does when it learns a payment
  reached WispHub; the cleared debtor leaves on the next read.
- **The ISP has more pending invoices than any block walk would reach.** That
  is no longer a truncation to warn about: the operator sees the blocks they
  asked for and searches for anyone else.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Cobros page MUST open with its search box and the first
  block of the ISP's pending receipts, and MUST become usable without
  waiting on anything beyond that block.
- **FR-001a**: The whole pending-invoice list MUST NOT travel to the page,
  on open or ever. The page receives the blocks it asked for and the results
  of the searches it ran, and nothing else. *(What Devolada reads on the
  server to answer a search is bounded by FR-007a; what the browser is sent
  is bounded here.)*
- **FR-002**: The list MUST be delivered in blocks, one provider read each:
  the first no larger than what fills the browser's viewport, the next asked
  for only when the operator scrolls toward it. The page MUST never walk the
  list to its end on its own.
- **FR-003**: The page MUST search only when the trimmed text has at least
  three characters, and only after the operator pauses typing briefly
  (300 ms); below three characters it MUST say so and search nothing.
- **FR-004**: A search MUST ask the provider's **customer** list, with the
  text matched by *contains* against the customer's name, surname, usuario
  and phone at once. It MUST NOT be answered by filtering rows already on
  the screen.
- **FR-005**: Matching MUST ignore case and accents on both sides, so that
  "maria", "María" and "MARIA" find the same customers.
- **FR-006**: Results MUST be merged so that a customer appears once.
- **FR-007**: A search result MUST show what the customer owes as
  `debt-truth` defines it — the pending invoices plus the running account —
  so that a customer who owes only through their running account, or only
  through an invoice outside the browse window, is found with the right
  amount.
- **FR-007a**: Resolving what a matched customer owes MUST reuse the
  tenant's pending list through the door the product already reads it by —
  bounded, shared and cached as it is today — and MUST NOT open a new
  unbounded read. A search therefore costs the ISP no more than opening the
  page costs it today.
- **FR-008**: A matched customer who owes nothing MUST appear, marked as
  owing nothing. A matched customer whose debt cannot be proven MUST appear
  saying so, with no amount. Neither MAY be omitted from results.
- **FR-009**: The number of results shown MUST be capped; when more
  customers matched than are shown, the page MUST say how many matched and
  ask for a more specific search.
- **FR-010**: Each row MUST show the customer's usuario and name as the
  provider answers them now, and what they owe — never a stored copy.
- **FR-011**: When the operator changes the text while a search is in
  flight, only the results matching the current text MAY be shown; a block
  that arrives after a search began MUST be discarded.
- **FR-012**: The search text MUST survive navigating to another page and
  back, the browser's back button and a reload, and a search MUST have an
  address that opens on that search.
- **FR-013**: Results for the same text MUST be reused for two minutes
  without asking again; after that a repeat of the search asks again.
- **FR-014**: The Vencidas and Por vencer filters MUST be answered by the
  provider, so that every block of a chosen filter belongs to it. They MUST
  NOT be applied as a filter over the blocks that happen to have loaded. A
  receipt with no due date belongs to neither, and the page MUST NOT imply
  that the two tabs together account for everything Todas holds.
- **FR-015**: Changing the filter MUST start a new walk from its own first
  block; blocks read under the previous filter MUST NOT be carried over.
- **FR-016**: The page MUST NOT show the "la lista puede estar incompleta"
  warning any more: nothing is read whole, so nothing can be cut short. It
  MUST instead say how many pending receipts the ISP has, which the provider
  answers with every block.
- **FR-017**: Within a block, invoices MUST be grouped by customer and
  summed, as the page groups them today. The page MUST NOT claim that a
  customer's invoices are grouped across blocks.
- **FR-018**: A customer MUST NOT be rendered twice within the blocks on
  screen, even when the provider answers the same row in two blocks.
- **FR-019**: When the provider cannot be reached, the blocks already on
  screen MUST stay, under the quiet "Sin conexión a WispHub" note, and no
  error block MAY be shown.
- **FR-020**: When the provider cannot be reached, a search MUST say that it
  needs WispHub and MUST NOT answer an empty result that would read as
  "nobody owes".
- **FR-021**: A key the provider refuses MUST remain a setup problem that
  sends the operator to Integraciones with no Reintentar, and a business
  with no integration MUST keep the door it has today.
- **FR-022**: The right to operate payments and a configured CLABE MUST
  continue to gate the row's actions exactly as they do today, on a search
  result as on a browse row.
- **FR-023**: The Copiar and WhatsApp actions MUST behave on a search result
  exactly as they behave on a browse row today: the link is created on the
  first use of either, identified by the row's usuario, and never merely
  because the customer was shown.
- **FR-024**: The page MUST keep re-reading its first block when the
  operator returns to the tab and when Devolada learns that a payment
  reached the provider, as it does today. It MUST NOT re-read every loaded
  block on a return.
- **FR-025**: "Today" for an overdue decision MUST continue to be read in the
  business's timezone, never the browser's.

### Key Entities

- **Pending receipt**: one unpaid invoice of the ISP — its provider id, the
  customer it belongs to, the amount, the issue date and the due date. The
  browse list is made of these. Devolada stores none of them.
- **Debtor row**: what the operator sees — a customer, and what they owe. In
  the browse list it is the invoices of one customer within the blocks that
  have loaded. In a search it is the customer's whole debt as `debt-truth`
  defines it.
- **Debt**: the pending invoices plus the running account, as `debt-truth`
  already defines it. Unchanged by this feature; a credit in the running
  account still lowers what is charged and never shows as money owed to the
  customer.
- **Search**: a text of at least three characters, the customers it matched,
  how many matched, what each of them owes, whether the provider answered,
  and when it ran.
- **Block**: one provider read of the pending-invoice list — the rows, where
  the next block starts, and the provider's own count of the whole filtered
  list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Any customer of a connected ISP who owes money can be found on
  Cobros with the amount they owe in under 15 seconds from opening the page
  — including one whose debt exists only in their running account, and one
  whose unpaid invoice is older than the browse window.
- **SC-002**: Cobros is ready to search within one second of opening, for an
  ISP of any size.
- **SC-003**: 95% of searches show their results within three seconds of the
  operator's pause.
- **SC-004**: Opening Cobros costs one provider read, whatever the size of
  the ISP; the number of reads grows only with the blocks the operator asks
  for.
- **SC-005**: Every return to the page — from another page, by the back
  button, by reload — shows the last search's text and results, 100% of the
  time.
- **SC-006**: The "la lista puede estar incompleta" warning is never shown
  on Cobros again.
- **SC-007**: With the provider unreachable, 100% of searches say so and
  none answers an empty list; the blocks already on screen are never
  replaced by an error block.
- **SC-008**: Browsing and searching create no payment link: the count of
  the business's links is the same before and after a session in which
  nothing was copied or sent.
- **SC-009**: A chosen Vencidas or Por vencer filter holds across every
  block: no row outside the filter appears in any block of that walk.

## Assumptions

- **The provider's invoice list cannot be filtered by customer.** Measured
  twice: `OPTIONS /facturas/` (2026-09-01) documents `estado`, `tipo_fecha`,
  `desde`, `hasta`, `forma_pago`, `zona` and `cajero` and nothing that names
  a customer; the adapter re-verified it live on 2026-08-16. This is the
  single fact that shapes the feature: the search cannot be asked of the
  invoice list and is asked of the customer list instead.
- **The provider's invoice list pages by `limit` and `offset` and answers a
  total count**, as its customer list does — the same mechanism 009 already
  uses for the Links browse. If a measured check at plan time finds
  otherwise, the blocks half of this feature is blocked and the search half
  still stands on its own; they are separate stories for that reason.
- **The provider's customer search matches by contains and ignores case and
  accents** (measured 2026-09-20 on the connected ISP). Unchanged from 009.
- **The due-date filters are `tipo_fecha` with `desde` / `hasta`**, which the
  provider documents. Two known hazards, to be settled in the plan and not
  by the screen: both dates default to the current month, so a filter that
  forgets its window silently drops older arrears; and a row with no due
  date belongs to no due-date window. If either cannot be made safe, the
  fallback is one list with no tabs (FR-014 becomes "the page shows no
  filter it cannot answer truthfully") rather than a tab that describes only
  the loaded rows.
- **How debt is computed does not change.** `debt-truth`'s rule — pending
  invoices plus the running account, a credit netted and never surfaced —
  and its rule for when a zero can be believed are used as they are. This
  feature changes which customers the screen can ask about, not what the
  answer means.
- **The sweep's `pending` pass is untouched**, and so is every money path
  that reads it: the charge guard, the SPEI amount, the re-validation and
  the reconnection queue. Whether the browse blocks read the provider
  directly or serve the snapshot for a large tenant is a plan decision; the
  money paths' source is not this feature's to change.
- **Cobros' link actions are 009's and stay as they are** (FR-025, FR-026,
  FR-028 of that feature): created on the act, identified by usuario, with
  the number read fresh so WhatsApp opens the customer's own chat.
- **The per-block grouping cost is accepted**, named in the Edge Cases and
  in FR-017. The operator who needs a customer's whole debt searches for
  them, which answers it exactly.
- **The ordering cost is accepted**: the provider offers no ordering
  parameter on the invoice list, so the page promises a debtor can be found,
  never that the list reads the same twice — the same promise 009 makes for
  the Links browse.
- **Delivery states, counters, mass delivery, CSV export and WispHub
  webhooks remain later pieces.** The next one agreed is webhooks.
- Roles, the CLABE gate and the business timezone behave exactly as they do
  today; this feature adds no permission and removes none.
