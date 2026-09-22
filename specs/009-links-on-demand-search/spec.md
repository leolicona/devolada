# Feature Specification: Links On-Demand Search

**Feature Branch**: `009-links-on-demand-search`

**Created**: 2026-09-20

**Status**: Draft — clarified 2026-09-21 (six decisions; the provider's
customer-list contract read the same day)

**Input**: User description: "Links: on-demand customer search. The Links page today reads the whole WispHub customer roster on open (capped at 1,000 rows of a 6,513-customer ISP, measured 2026-09-18/20, shown with a "list may be incomplete" warning) and searches locally over those rows, so 5,509 customers can never receive their payment link. Replace the roster with on-demand search: the page opens with a search box and nothing else; from the third character, after a short debounce, it asks Devolada, which searches its own links first (name, usuario, customer reference, label — covers API-channel links) and then WispHub with the same text against nombre, apellido, usuario and telefono at once (WispHub's `__contains` filters, measured 2026-09-20 to be case- and accent-insensitive; the customer object carries only `nombre`, which in this ISP holds the full name), merged without duplicates; results are capped and, when there are more, the page says how many matched and asks for a more specific search. The search text lives in the URL (`?q=`) so it survives navigating to another page and back, the back button and a reload; results for the same text are reused for two minutes. A WispHub customer who has no link yet shows the same Copiar / WhatsApp buttons; the link is created on first use (copy or WhatsApp), never merely on being shown, so browsing results leaves no stray links. WispHub unavailable: the search still answers with Devolada's own links and shows a quiet "Sin conexión a WispHub" note instead of failing. Roles and CLABE gating unchanged: viewer sees results with no buttons; without a CLABE the buttons wait. Out of scope: delivery states (pendiente/enviado/abierto), counters, migration of existing links, mass delivery, webhooks — all later pieces. Cobros keeps creating links for debtors as today."

## Context

The Links page is the ISP's distribution channel: it is where a customer's
permanent payment link is found and sent. No link delivered, no transfer to
validate — the product's core value depends on this page finding the right
person.

Today the page opens by reading the ISP's **whole** customer base from
WispHub and then searching those rows in the browser. On the connected ISP
that is 6,513 customers (measured 2026-09-20; 6,509 two days earlier), which
WispHub serves 100 at a time: 66 calls, 30–40 s at the measured 0.4–0.6 s
each. No request can pay that, so the read was capped at ten pages and
5,513 customers could not be found at all. (The Input above says 5,509 — the
same gap against the 6,509 of 2026-09-18.)

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

The **Input** above is the description this feature started from, kept
verbatim. Two of its sentences no longer hold and are superseded by the
decisions below: the page does not open "with a search box and nothing else",
and "Cobros keeps creating links for debtors as today" was wrong twice — Cobros
never created links, and User Story 4 now makes it do so.

Stories are numbered in the order they were written, not by priority. In
priority order they are **US1 (P1), US4 (P1), US2 (P2), US3 (P3)** — which is
the order [tasks.md](./tasks.md) builds them in.

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
- Q: Where does the number come from when Cobros sends a link? → A: From the
  same fresh read that creates the link. The act already asks WispHub for the
  customer by usuario, and that answer carries the phone — so WhatsApp opens
  that customer's chat rather than the contact picker Cobros shows today. This
  is what makes collecting a list of debtors worth doing one press at a time.
- Q: Which links may the cleanup delete? → A: Every panel link created
  before this feature ships that no payment and no clave attempt ever
  referenced. Chosen with the cost known and accepted: Devolada never
  recorded a sending, so a link an operator sent and the customer has not
  paid yet is deleted with the rest, and that customer's copy stops
  working.
- Q: After the cleanup, should Cobros create a link when the operator
  presses Copiar or WhatsApp? → A: Yes — the same rule Links now has,
  applied to the page where the ISP decides who to chase. It enters this
  feature as User Story 4, because without it FR-023 leaves the
  collections screen unable to send anything.

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

### User Story 4 - Cobros can send, not only show (Priority: P1)

An operator opens Cobros to see who owes money this week. They find the
debtor, press WhatsApp, and **that customer's chat opens** with the message and
their link ready — whether or not they had a link a second earlier. The link is
born from the act, exactly as it is on Links, and so is the number.

Collecting is batch work: an operator goes down a list of debtors, one after
another. Every contact they have to find by hand is a few seconds and a chance
to send the wrong person someone else's link.

**Why this priority**: this ships with the cleanup or the cleanup must not
ship. FR-023 deletes almost every stored panel link, and Cobros shows
buttons only where a link exists. Without this story, the page that tells
the ISP who owes money can send none of them their link — a regression on
the collections path, not a missing nicety.

**Independent Test**: delete every stored link for a business, open Cobros on a
debtor whose WispHub record has a phone, press WhatsApp — that customer's chat
opens with a working link, no picker appears, and the same link is the one Links
shows for that customer afterwards.

**Acceptance Scenarios**:

1. **Given** a debtor with no link, **When** the operator presses Copiar or
   WhatsApp on their Cobros row, **Then** the link is created at that
   moment and the action proceeds with it.
2. **Given** a debtor who already has a link, **When** the operator acts on
   their Cobros row, **Then** that same link is used — never a second one.
3. **Given** a link created from Cobros, **When** the same customer is
   found later on Links, **Then** Links shows that same link.
4. **Given** debtors on screen, **When** the operator only reads the list,
   **Then** no link is created for any of them.
5. **Given** a debtor whose WispHub record carries a readable phone, **When**
   the operator presses WhatsApp, **Then** that customer's own chat opens with
   the message ready — no contact to search for, no picker.
6. **Given** a debtor whose WispHub record has no phone, or one that cannot be
   read, **When** the operator presses WhatsApp, **Then** WhatsApp's contact
   picker opens with the message ready, as today — never a stranger's chat.
7. **Given** a viewer, or a business with no CLABE configured, **When**
   they open Cobros, **Then** the buttons are withheld exactly as they are
   on Links.

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
- A customer with no phone in WispHub, or whose number cannot be read, keeps
  the WhatsApp button: it opens WhatsApp's own contact picker with the message
  ready, never a stranger's chat. This is the exception now, not the rule —
  every customer whose record carries a readable number gets their own chat
  (FR-028).
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
- The cleanup (FR-023) meets a link a payment or a clave attempt ever
  referenced: it is kept, whatever its age and whoever created it.
- The cleanup meets an API link: it is never touched, whatever its age.
- A customer whose link the cleanup deleted had already been sent it: their
  copy stops working, and the next act on them creates a link at a new
  address. Nothing reissues the old one.
- The cleanup runs a second time (a re-deploy, a re-run): it deletes
  nothing, because it only ever covers links that existed before the
  feature shipped.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Links page MUST open with the search box and the first
  block of the ISP's customers, read live from WispHub. It MUST NOT read
  the whole customer base, on open or ever.
- **FR-002**: The page MUST search only when the trimmed text has at least
  three characters, and only after the operator pauses typing briefly
  (300 ms); below three characters it MUST say so and
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
- **FR-027**: The page MUST NOT show how old its rows are: a block is read
  when it renders, so there is no shared age to report and no manual refresh to
  offer. It MUST re-read its first block when the operator returns to the tab,
  no more than once every 30 seconds. The only staleness it admits is the
  provider being away, which the note of FR-014 already carries. This retires
  the read-age indicator `presence-freshness` put on this page.
- **FR-025**: Cobros MUST create the debtor's link on the first use of
  Copiar or WhatsApp, on the same terms as Links (FR-008, FR-009): never
  on being shown, and identified by the invoice row's usuario, so the link
  is the one every other surface already knows.
- **FR-028**: WhatsApp MUST open the customer's own chat, using the phone read
  from WispHub at the moment of the act — on Cobros as on Links. The contact
  picker is reserved for a record with no phone or an unreadable one. No
  surface MAY send an operator to the picker for a customer whose number could
  have been read.
- **FR-026**: Cobros MUST show Copiar and WhatsApp on a debtor who has no
  link, instead of hiding them, and MUST keep withholding them from a
  viewer and from a business with no CLABE, exactly as Links does.

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
- **SC-010**: Collecting a list of debtors needs no manual contact search: for
  every debtor whose WispHub record carries a readable phone, pressing WhatsApp
  in Cobros opens that customer's chat directly, 100% of the time.
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
- **Cobros is in scope, for two rules** (US4, FR-025, FR-026, FR-028): it
  creates the link on the act, as Links does, and the act's fresh read of the
  customer also gives it the number, so WhatsApp opens that customer's chat
  instead of a picker. Everything else about Cobros is untouched — what it
  lists, how it reads debt, how it orders rows.
  It is in scope because FR-023 makes it so: hiding the buttons on a debtor
  with no link was an edge case while the roster made one per customer, and
  after the cleanup it would be nearly every row.
- The roster read is no longer needed by the panel; whether it is retired
  is a plan decision. The paged list of links stays — it becomes the page's
  opening (FR-001, FR-020).
- Delivery states (pendiente / enviado / abierto), counters, mass
  delivery, CSV export and WispHub webhooks are later pieces, in that
  order. The copied / sent mark of FR-022 is a cache, not their
  forerunner: the states piece is what gives delivery a stored life.
- **`presence-freshness` loses one promise here, on purpose** (FR-027): the
  Links page stops reporting its read's age, because every block is live when
  it renders. The re-read on return to the tab and the absence of an
  "Actualizar" button both stay. Nothing about the invoice reads, Cobros or the
  payer's page changes.
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
