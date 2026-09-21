# Feature Specification: Links On-Demand Search

**Feature Branch**: `009-links-on-demand-search`

**Created**: 2026-09-20

**Status**: Draft

**Input**: User description: "Links: on-demand customer search. The Links page today reads the whole WispHub customer roster on open (capped at 1,000 rows of a 6,513-customer ISP, measured 2026-09-18/20, shown with a "list may be incomplete" warning) and searches locally over those rows, so 5,509 customers can never receive their payment link. Replace the roster with on-demand search: the page opens with a search box and nothing else; from the third character, after a short debounce, it asks Devolada, which searches its own links first (name, usuario, customer reference, label — covers API-channel links) and then WispHub with the same text against nombre, apellido, usuario and telefono at once (WispHub's `__contains` filters, measured 2026-09-20 to be case- and accent-insensitive; the customer object carries only `nombre`, which in this ISP holds the full name), merged without duplicates; results are capped and, when there are more, the page says how many matched and asks for a more specific search. The search text lives in the URL (`?q=`) so it survives navigating to another page and back, the back button and a reload; results for the same text are reused for two minutes. A WispHub customer who has no link yet shows the same Copiar / WhatsApp buttons; the link is created on first use (copy or WhatsApp), never merely on being shown, so browsing results leaves no stray links. WispHub unavailable: the search still answers with Devolada's own links and shows a quiet "Sin conexión a WispHub" note instead of failing. Roles and CLABE gating unchanged: viewer sees results with no buttons; without a CLABE the buttons wait. Out of scope: delivery states (pendiente/enviado/abierto), counters, migration of existing links, mass delivery, webhooks — all later pieces. Cobros keeps creating links for debtors as today."

## Context

The Links page is the ISP's distribution channel: it is where a customer's
permanent payment link is found and sent. No link delivered, no transfer to
validate — the product's core value depends on this page finding the right
person.

Today the page opens by reading the ISP's **whole** customer base from
WispHub and then searching those rows in the browser. On the connected ISP
that is 6,513 customers (measured 2026-09-18 and again 2026-09-20), which
WispHub serves 100 at a time: 66 calls, 30–40 s at the measured 0.4–0.6 s
each. No request can pay that, so the read was capped at ten pages and
5,509 customers could not be found at all.

That cap was lifted on 2026-09-19 (bug: links-roster-cap, #220) by moving
the walk to the every-minute sweep: ten pages a tick, stored, swapped in
when a pass finishes. The page now shows the whole tenant — but it pays
for that in three ways. The list is a snapshot minutes old, not what
WispHub says now. A pass over a 66-page tenant costs the provider sixty-odd
calls every few minutes whether or not anyone opens the page. And the
roster creates a link for every customer it stores, so the ISP holds
roughly 6,513 links, nearly all of them never sent.

The page reads a whole base to answer one question: *where is this
customer?* That is the waste this feature removes.

The page was built this way because WispHub's search was believed to match
only exact values. That premise was wrong: measured 2026-09-20 on the
connected ISP, WispHub's customer search matches by *contains*, ignoring
case and accents (`mar` and `MAR` both find 904 customers; `maria` and
`maría` both find 508), and answers in well under a second. The search can
simply be asked, one question at a time, for exactly the customer the ISP
is looking for.

This feature replaces the whole-base read with a page that asks for
exactly what it shows: the first screenful on open, one more as the
operator scrolls, and the customer they name when they search. It is the
first of three pieces agreed for the distribution and collection channels
(Links search → Cobros → WispHub webhooks). It deliberately leaves the
delivery states (pendiente / enviado / abierto) to the next Links piece,
so that this one stays small enough to land in days.

## Clarifications

### Session 2026-09-21

- Q: What does a payment link remember about the customer? → A: Only the
  customer's identity — `customer_usuario` on a panel link, `customer_ref`
  on an API link — beside Devolada's own operational fields. Name, phone
  and service state are never stored; to operate, they are always read
  fresh.
- Q: What fills the opening list, and where do its rows come from? → A:
  WispHub's customer list, read live and paged on demand. The page asks for
  the first block that fills the browser's viewport and asks for the next
  as the operator scrolls. The search asks the provider directly.
- Q: When WispHub cannot be reached, what can the operator still search
  for? → A: A short-lived cache of the customers seen in the last minutes
  answers a search by name; beyond that window the link itself answers by
  usuario (panel) and by reference or label (API). A live answer always
  outranks the cache.
- Q: What remembers that a link was copied or sent? → A: The cache, as a
  visual mark on the row for the operator who acted. No delivery state is
  stored — that is the next piece.
- Q: What happens to the links the roster already created, one per
  customer? → A: The `roster` pass is retired, and no background work
  creates a link again.
- Q: Which links may the cleanup delete? → A: Every panel link created
  before this feature ships that no payment and no clave attempt ever
  referenced. Chosen with the cost known and accepted: Devolada never
  recorded a sending, so a link an operator sent and the customer has not
  paid yet is deleted with the rest, and that customer's copy stops
  working.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Any customer can be found and sent their link (Priority: P1)

An operator at the ISP needs to send a payment link to a specific customer —
one who just signed up, one who called asking for it, one who is on the
suspended list. They open Links, type part of the customer's name, usuario
or phone number, see the customer within a moment, and press WhatsApp or
Copiar. The customer's link exists from that moment whether or not anyone
had ever listed them before.

This works for the 6,513th customer exactly as it works for the first. The
page reads one screenful on arrival and nothing more until the operator
asks — by scrolling, or by typing.

**Why this priority**: this is the whole feature. An ISP that cannot find
most of its customers cannot distribute the link, and a link nobody
receives produces no payment to validate. With this story alone the page
already does its job for every customer.

**Independent Test**: connect an ISP whose customer base is larger than any
list the page used to read, search for a customer who was never listed,
send their link, and confirm a link now exists for exactly that customer —
and for nobody else who appeared in the results.

**Acceptance Scenarios**:

1. **Given** a connected ISP with more customers than the old list could
   hold, **When** the operator types three or more characters of a
   customer's name who was never listed, **Then** that customer appears in
   the results with their name, usuario and phone.
2. **Given** results on screen, **When** the operator presses WhatsApp or
   Copiar on a customer who has no link yet, **Then** the link is created at
   that moment and the action proceeds with it — WhatsApp opens with the
   message ready, or the URL is on the clipboard.
3. **Given** results on screen, **When** the operator looks at them and
   does nothing, **Then** no link is created for any of them.
4. **Given** a customer who already has a link, **When** they appear in a
   search, **Then** the row carries that same link — the existing link is
   never replaced by a new one.
5. **Given** fewer than three characters typed, **When** the operator
   pauses, **Then** nothing is searched and the page says at least three
   characters are needed.
6. **Given** a search that matches many customers (for example "mar",
   904 matches), **When** the results arrive, **Then** the page shows the
   first ones, says how many matched, and asks for more characters.
7. **Given** a search typed with or without accents or capitals, **When**
   it runs, **Then** the same customers are found either way.
8. **Given** a search by phone digits, **When** it runs, **Then** customers
   whose phone contains those digits appear.
9. **Given** the operator types quickly, **When** the results arrive,
   **Then** only the results for the text as it is now are shown — never an
   earlier search's results over a later one.
10. **Given** a viewer (a role without the right to operate payments),
    **When** they search, **Then** they see the same results with no
    Copiar or WhatsApp buttons.
11. **Given** an ISP that has not configured its CLABE, **When** results
    show, **Then** the buttons wait exactly as they do today — a link nobody
    can pay is not shared.

---

### User Story 2 - The search survives leaving the page (Priority: P2)

An operator searches for a customer, then goes to Pagos to check something,
then comes back. The search text and its results are still there. The same
holds for the browser's back button and for a reload: the page comes back
to the same search, and a search's address can be pasted to a colleague.

**Why this priority**: the old page forgot everything on navigation, and
that was one of the three named complaints of the pilot round. A search
that has to be retyped every time makes the operator distrust the page.

**Independent Test**: search for a customer, navigate to another page of the
panel and back, press the browser's back button, reload — each time the
same text is in the box and the same results are on screen, without a
second visible wait when the search is recent.

**Acceptance Scenarios**:

1. **Given** a search with results, **When** the operator goes to another
   page of the panel and returns to Links, **Then** the box holds the same
   text and the same results are on screen.
2. **Given** a search with results, **When** the operator reloads the page,
   **Then** the same text and results come back.
3. **Given** a search, **When** its address is opened in another tab by a
   colleague with access to the same business, **Then** it opens on that
   search.
4. **Given** a search repeated within two minutes, **When** the operator
   returns to it, **Then** the previous results show at once without a new
   wait; after two minutes the page asks again.
5. **Given** the operator clears the box, **When** they leave and return,
   **Then** the page opens empty, ready to search.

---

### User Story 3 - Search keeps working when WispHub does not (Priority: P3)

WispHub is slow or down. The operator searches anyway. The links Devolada
already holds still answer — including links created through the
collections API, which have no WispHub customer at all — and the page says
quietly that WispHub could not be reached, instead of failing.

What a search can match narrows while WispHub is away, and the page says so
rather than pretending. A customer seen in the last minutes is still found
by name, from the cache. Beyond that window the link knows only the
customer's identity, so a panel customer is found by usuario and an API
link by its reference or label.

A business that never connected WispHub gets the same behaviour: its search
covers its API links, and the empty state says where its links come from.

**Why this priority**: the page must never be a void. A quiet note keeps the
operator working with what Devolada knows; an error block sends them away.

**Independent Test**: with WispHub unreachable, search by usuario for a
customer whose link Devolada holds, by name for one seen minutes earlier,
and by reference for an API link — all three appear under a quiet note;
search for a customer Devolada does not hold — the empty result carries the
same note, and no error block is shown.

**Acceptance Scenarios**:

1. **Given** WispHub unreachable, **When** the operator searches by usuario
   for a customer whose link Devolada already holds, **Then** that customer
   appears, with the note "Sin conexión a WispHub" and no error block.
2. **Given** WispHub unreachable and a customer seen minutes earlier,
   **When** the operator searches for them by name, **Then** they appear
   from the cache, under the same note.
3. **Given** WispHub unreachable and a customer not seen recently, **When**
   the operator searches for them by name, **Then** the result is empty
   under the same note, the page says a name search needs WispHub, and it
   never shows an error block.
4. **Given** a search text that matches a link created through the
   collections API (by its reference or label), **When** it runs, **Then**
   that link appears with its channel shown as "API", its reference, its
   asked amount and its state, exactly as the old list showed it.
5. **Given** a business without WispHub, **When** it searches, **Then** its
   API links answer and nothing mentions WispHub as a failure; **When** it
   has none, **Then** the empty state says links come from the API or from
   connecting WispHub in Integraciones.
6. **Given** WispHub answering again, **When** the operator repeats the
   search, **Then** the note disappears, WispHub's customers join the
   results, and what the cache held is replaced by the fresh answer.

---

### Edge Cases

- A customer present both among Devolada's links and in WispHub's answer
  appears once, carrying the existing link.
- A WispHub customer without a usuario cannot have a link (the usuario is
  the link's identity); such a customer does not appear in results.
- Two customers with the same name are told apart by usuario and phone on
  the row, as today.
- WispHub returns a customer whose numeric id changed since the link was
  created: the link keeps its usuario and refreshes the id, as today.
- Leading and trailing spaces in the search text are ignored; a text of
  only spaces is an empty search.
- The clipboard refuses the copy: the button says "No se copió", as today.
- WispHub takes longer than the operation budget: that search is treated
  as WispHub unreachable (US3), and the next search asks again.
- Test links created through the collections API never appear.
- A customer with no phone in WispHub keeps the WhatsApp button, which
  opens WhatsApp's own contact picker with the message ready, as Cobros
  does today.
- The operator types a fourth character while a three-character search is
  in flight: the in-flight answer is discarded if it no longer matches the
  text in the box.
- The provider offers no way to order the customer list, so a base that
  changes while the operator scrolls can show a customer twice or skip one
  between blocks. The page promises that a customer can be *found*, never
  that the list reads the same twice; a customer missed between blocks is
  still reachable by search.
- The operator scrolls faster than the blocks arrive: only the blocks asked
  for are shown, in the order they were asked for, and a block that arrives
  after the operator has searched is discarded.
- A block comes back empty because the operator scrolled past the end: the
  list stops, saying how many customers the ISP has.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Links page MUST open with the search box and the first
  block of the ISP's customers, read live from WispHub. It MUST NOT read
  the whole customer base, on open or ever.
- **FR-002**: The page MUST search only when the trimmed text has at least
  three characters, and only after the operator pauses typing briefly
  (about a third of a second); below three characters it MUST say so and
  search nothing.
- **FR-003**: A search MUST ask WispHub live, with the text matched by
  *contains* against the customer's name, surname, usuario and phone at
  once, and MUST ask Devolada's own rows for the API links the provider
  cannot know about (by reference and label) and for what the recently seen
  cache holds (FR-021).
- **FR-004**: Matching MUST ignore case and accents on both sides, so that
  "maria", "María" and "MARIA" find the same customers whether the match
  comes from Devolada's links or from WispHub.
- **FR-005**: Results MUST be merged so that a customer appears once, and a
  customer who already has a link MUST carry that link, never a new one.
- **FR-006**: The number of results shown MUST be capped; when more
  customers matched than are shown, the page MUST say how many matched and
  ask for a more specific search.
- **FR-007**: Each panel row MUST show the customer's usuario, name and
  phone as WispHub answers them now — never a stored copy; each API result
  MUST show its label or reference, its asked amount and its state, with its
  channel shown as icon + text — as the old list did.
- **FR-008**: A row whose customer has no link yet MUST show the same
  Copiar and WhatsApp buttons as one who has; the link MUST be created on
  the first use of either button and MUST NOT be created merely because the
  customer was shown, listed or read. No background work MAY create a link:
  an operator's act is the only thing that brings one into existence.
- **FR-009**: The link created on first use MUST be the customer's
  permanent link, identified by usuario, so that a later search, a Cobros
  row or a payment finds the same link.
- **FR-010**: A payment link MUST associate only the customer's identity —
  `customer_usuario` on a panel link, `customer_ref` on an API link — beside
  Devolada's own operational fields (when it was created, its own state). It
  MUST NOT store the customer's name, phone or service state: to operate,
  those are always read fresh from WispHub.
- **FR-011**: The search text MUST survive navigating to another page and
  back, the browser's back button and a reload, and a search MUST have an
  address that opens on that search.
- **FR-012**: Results for the same text MUST be reused for two minutes
  without asking again; after that a repeat of the search asks again.
- **FR-013**: When the operator changes the text while a search is in
  flight, only the results matching the current text MAY be shown.
- **FR-014**: When WispHub cannot be reached or does not answer within the
  operation budget, the search MUST still answer with Devolada's own links
  and MUST show the quiet note "Sin conexión a WispHub"; it MUST NOT show
  an error block.
- **FR-015**: A business without WispHub MUST be able to search its API
  links, and its empty state MUST say that links come from the API or from
  connecting WispHub.
- **FR-016**: Sharing (Copiar, WhatsApp) MUST stay behind the right to
  operate payments and behind a configured CLABE, exactly as today; a
  viewer sees results and nothing to press.
- **FR-017**: Test links MUST never appear in results.
- **FR-018**: The page MUST NOT show the "la lista puede estar incompleta"
  warning any more: nothing is read whole, so nothing can be cut short. It
  MAY instead say how many customers the ISP has, which the provider
  answers with every block.
- **FR-019**: WhatsApp MUST open with the same message and the same phone
  handling as today (Mexico's country code in front, the contact picker
  when the number cannot be read or is absent).
- **FR-020**: The list MUST be delivered in blocks, one provider read each:
  the first block MUST be no larger than what fills the browser's viewport,
  and the next MUST be asked for only when the operator scrolls toward it.
  The page MUST never walk the list to its end on its own.
- **FR-021**: The page MUST keep a short-lived cache of the customers it has
  seen — their name and phone as WispHub last answered — so that a search by
  name and a row's name survive a moment without WispHub. A live answer MUST
  always outrank the cache: the cache is read only when WispHub does not
  answer, it is replaced by every fresh answer, and it MUST NOT be a stored
  field of the link.
- **FR-022**: When the operator copies or sends a link, that row MUST be
  marked visually as copied or sent. The mark lives in the cache for the
  operator who acted; no delivery state is stored, and nothing in the mark
  is promised to another operator or to a later session.
- **FR-023**: Once, when this feature ships, every panel link created
  before it that no payment and no clave attempt ever referenced MUST be
  deleted. API links are untouched. The deletion MUST run once over links
  that already existed — never as ongoing work, which would delete the
  links FR-008 has just created. The business MUST be told how many were
  deleted.
- **FR-024**: A customer whose link was deleted MUST get a new one the
  first time an operator acts on them, at a new address. Nothing MAY try
  to preserve or reissue the old one: a copy the customer already holds
  stops working, and the page does not pretend otherwise.

### Key Entities

- **Payment link**: the customer's permanent address to pay. A panel link
  belongs to one WispHub customer, identified by usuario, with WispHub's
  numeric id kept as a refreshable cache. An API link belongs to the
  business's own system and carries a reference, an optional label, an
  optional asked amount and a state (open, paid, expired). The link
  associates the customer's identity and nothing else about them.
- **Recently seen customer**: what WispHub last answered about a customer —
  name and phone — held for a short window so the page can show a name and
  answer a search without asking again, plus whether this operator has
  copied or sent that link. It is a cache, never a record: it expires, it
  is replaced by any fresh answer, and nothing depends on it being there.
- **Customer (WispHub)**: the ISP's record of a subscriber — usuario, numeric
  id, name (this ISP writes the full name in one field), phone, service
  state. Devolada never copies the base; it asks for the ones searched.
- **Search**: a text of at least three characters, the two sources it was
  asked of (Devolada's links, WispHub), the merged results, how many
  matched, whether WispHub answered, and when it ran.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Any customer of a connected ISP — including one beyond the
  first 1,000 and one added today — can be found and sent their link in
  under 15 seconds from opening the page.
- **SC-002**: The Links page is ready to search within one second of
  opening, for an ISP of any size, with no wait on the provider.
- **SC-003**: 95% of searches show their results within three seconds of
  the operator's pause.
- **SC-004**: Searching without acting creates zero links: the count of
  the business's links is the same before and after a session of searches
  in which nothing was copied or sent.
- **SC-005**: Every return to the page — from another page, by the back
  button, by reload — shows the last search's text and results, 100% of
  the time.
- **SC-006**: With WispHub unreachable, 100% of searches still answer with
  Devolada's own links and the page shows no error block.
- **SC-007**: The "list may be incomplete" warning is never shown again.
- **SC-008**: After the cleanup, the count of the business's panel links
  equals the number of customers an operator has actually acted on — zero
  for a business whose operators have not used the page since it shipped.
- **SC-009**: No background work of any kind creates a payment link: over a
  day in which no operator copies or sends, the business's link count does
  not change.

## Assumptions

- WispHub's customer search matches by contains and ignores case and
  accents (measured 2026-09-20 on the connected ISP). If another ISP's
  installation behaves differently, the adapter absorbs it; the page's
  promise (FR-004) does not change.
- The usuario is the link's identity and WispHub's numeric id is a cache
  that may be recycled (direct-payment D5) — unchanged.
- Links created before this feature keep working unchanged: no link gains
  or loses a field, so there is nothing to migrate.
- **Cobros reads stored links only and hides the buttons on a debtor who
  has none.** That was an edge case while the roster created a link per
  customer. After FR-023 it becomes the normal case: almost every debtor
  will have no link, so almost every Cobros row will show no buttons until
  someone finds that customer on Links and acts. Whether Cobros gains its
  own "create on act" is an open decision; leaving it as it is means Cobros
  can send nothing for a while.
- The roster read is no longer needed by the panel; whether it is retired
  is a plan decision. The paged list of links stays — it becomes the page's
  opening (FR-001, FR-020).
- Delivery states (pendiente / enviado / abierto), counters, mass
  delivery, CSV export and WispHub webhooks are later pieces, in that
  order. The copied / sent mark of FR-022 is a cache, not their
  forerunner: the states piece is what gives delivery a stored life.
- The operation budget for a provider read stays what it is today; a
  search does not get a longer one. One block and one search are each a
  single round trip inside it, so neither needs the budget widened.
- The provider's customer list is measured (docs read 2026-09-21, behaviour
  measured 2026-09-20 on the connected ISP): it pages by `limit` and
  `offset` with no ordering parameter, answers a total count, and filters
  each field either exactly or by `__contains` — `nombre`, `apellido`,
  `usuario`, `telefono` among them, case- and accent-insensitive. It offers
  **no** filter that takes several identities at once, so a block of rows
  can never be resolved in one call: this is why the page shows what the
  provider's own list gives it rather than enriching rows one by one.
  Service state is a filter (`estado`: 1 active, 2 suspended, 3 cancelled,
  4 free) the page does not use yet.
- The sweep's `roster` pass is retired with this feature. Its only two
  readers are the Links page's own doors, and nothing else asks for a
  tenant roster; the `pending` pass that feeds the invoice reads and Cobros
  is untouched. Retiring it ends both the links born per stored page
  (FR-008) and the sixty-odd provider calls a large tenant paid every few
  minutes whether or not anyone opened the page.
- **Devolada holds no evidence that a link was ever sent.** Nothing records
  a copy, a send or a payer's visit, and FR-022 keeps the mark in the
  browser. The only durable evidence a link was used is a payment against
  it. So a cleanup of "unused" links cannot mean "never sent" — a link an
  operator WhatsApped last week and a link the sweep created and nobody
  touched look identical in the data, and deleting the first breaks a
  payment address a customer already holds. What the cleanup may safely
  delete is decided below.
