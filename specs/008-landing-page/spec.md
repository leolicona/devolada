# Feature Specification: Landing Page

**Feature Branch**: `008-landing-page`

**Created**: 2026-09-19

**Status**: Draft — clarified 2026-09-19 and 2026-09-20 (design session); plan and tasks in step

**Design**: [canvas v8](https://claude.ai/artifact/WSMGzw9TsBvYj3RUyad6Sk) — teléfono, escritorio, páginas de salida, estados y el flujo de activación (2026-09-20)

**Input**: User description: "lest create A single page Landing Page to validate devoladapago business and attract your first customers. Same tech stack, astro as FE framework."

## Context

Devolada is in production. One ISP is connected and collecting. Sign-up is
open — anyone with an email can create a business — and that was judged
acceptable at launch for one stated reason: **the address is not public**
(production-launch, Clarifications). Nobody arrives who was not invited.

That is also the problem. The product has no front door. `devoladapago.com`
answers nothing today; `app.` is the panel, `link.` is the customer's payment
page, `api.` is for programs. A business owner who hears of Devolada from the
creator, a partner or a WhatsApp group has nowhere to look, nothing to read at
their own pace, and nothing to forward to the partner who holds the purse.
Every prospect today is a conversation the creator has to be present for.

"Validate the business" means one question, answered with a number rather
than a feeling: **do businesses beyond the pilot — ISPs first — want this
enough to ask for it?** A single page is the cheapest instrument that can
answer it. It states the promise once, shows how it works from both sides of
the payment, says how it is charged, and asks for exactly one thing: the
reader's WhatsApp, so the creator can answer in person. Then it counts who
asked and where they came from.

The page makes claims about a product that has a written record of what it
does. Two positions from that record bound every sentence on it: **the money
never touches Devolada** — the customer transfers to the business's own
CLABE — and **Devolada never replaces the business's own system**; it tells
that system what happened. The page must say the first plainly and must
never imply otherwise about the second.

This feature is the page, the request it collects, and the numbers that let
the creator read the result. It publishes the product; the sign-up door is
not on the page but sits one click behind the sign-in link, and the exposure
that carries is accepted in *Clarifications*.
It does not decide who may be admitted as a business — production-launch
named that as the next feature and this spec leaves it there (*Deferred*).

## Clarifications

### Session 2026-09-19

- **Q: What is the one action the page asks for — a request the creator
  answers, the open sign-up, or both?** **A: Both, in that order.** The main
  action is a request for access; a quieter link offers to create an account
  to whoever would rather start alone. What this decides: the open sign-up
  door becomes public. Production-launch accepted open sign-up on the ground
  that the address was unpublished; that ground is gone from the day this
  page publishes, and the creator accepts here, in writing, the exposure it
  bounded — a stranger's worst case is one welcome allowance, the provider
  calls behind twenty verifications, and sign-up is limited per address.
  Admission policy stays the next feature, not a prerequisite of this one.
  The two doors are counted apart (FR-023), and the sign-up link carries the
  channel tag so the product can one day record where an account came from
  (*Deferred*). **Superseded 2026-09-20** — the design session below settles
  on one action; the exposure accepted here stands.

- **Q: Does the price appear on the page?** **A: The model, not the
  numbers.** The page says how Devolada charges — prepaid, per verified
  payment, no monthly fee, no contract, the first payments free — and the
  figures are said in the conversation a request opens. What this decides: a
  request means "tell me more", not "yes at this price", and the creator pays
  for that with one conversation per request. Two reasons to accept it: the
  product already allows a negotiated fee per business, so a printed figure
  would be "desde" at best; and the figures are operator settings that may
  still move while the page is learning. A consequence for the page: it
  shows no figure the product holds, so a price change needs no page change
  (FR-014).

- **Q: Who does the page speak to — ISPs on the supported billing system, or
  any business that collects by SPEI?** **A: Any business that collects by
  SPEI, with the ISP as the featured case.** This is the constitution's own
  purpose since v1.2.0. What this decides, and what it must not hide: a
  business on the supported billing system gets the whole loop — links from
  its customer roster, verification, the action in its system; any other
  business gets the loop through its own software — its system asks for the
  link and is told the verdict — because that is the only way a link is made
  today without the supported system. The page says both plainly (FR-002,
  FR-007) and never implies a panel-made link for a business without the
  supported system, because there is none. The request asks which system
  runs the business's billing, so the creator can tell a request the product
  serves end to end from one it serves through its API (FR-015).

### Session 2026-09-20 (design session, canvas v8)

- **Q: One action or two?** The creator asked whether asking for a WhatsApp
  and inviting sign-up on the same page was right. **A: One action — the
  WhatsApp.** Sign-up moves inside the conversation, as step 3 of the
  activation workflow (below), sent by the creator when the prospect is a
  fit. Why: an account without a CLABE, a connected system and a first link
  is an empty room — for a business whose system is not supported, empty by
  construction — and at this stage the conversation is the product's best
  feature and the only source of validation data. One number to watch:
  WhatsApps over visits. This reverses the first session's Q1: the page
  carries no sign-up link; the header carries a sign-in link for customers
  who already have an account. The exposure accepted on 2026-09-19 stands —
  sign-up is one click behind sign-in — and admission policy remains the
  next feature. "Crear cuenta" returns to the page when three things are
  true (*Deferred*).
- **Q: What does the request ask?** **A: The WhatsApp, and little else.**
  The first screen asks for the WhatsApp number alone; the closing form asks
  the WhatsApp, the person's name and which system runs their billing. No
  email, no business name, no size band, no note: the creator learns those
  in the chat. The WhatsApp is the contact because it is where the reader
  already is.
- **Q: Which theme?** **A: Dark by default**, the product's own dark
  palette, no toggle. On warm charcoal the teal action and the green "pago
  registrado" moment carry the page; the light palette stays one tweak away
  in the design and is not offered on the page.
- **Q: How does the page speak?** **A: Cercano y mexicano** — "tú", moderate
  slang where it lands (*talacha*, *sin rollo*, *a la mera hora*), and a
  formal register wherever money, verification or the law are named: SPEI,
  Banxico, CLABE, the privacy notice. The headline is fixed — *Cobrar por
  transferencia, sin la talacha.* SPEI is named in the eyebrow, the subhead
  and the proof tile; the brand's own slang, *de volada*, appears once.
- **Q: Does the page name the billing system?** **A: No.** It says the
  connection is to *tu sistema de facturación* and that which one is settled
  in the conversation; the supported system appears only as an answer in the
  form. The page should not read as one vendor's add-on, and the conversation
  is where each system gets its honest answer (workflow step 3).
- Also settled on the canvas: half the words (367 on the phone page); three
  doubts as a list instead of six, the rest answered by the benefits and the
  customer's screen; and the customer's screen shown at its two moments —
  verifying, with the waiting breath, and registered — as the page's one
  strong colour.

## The workflow the page starts

The page is step 1 of five. Steps 2–4 are the creator's, by WhatsApp; step 5
is the product's. The canvas carries the two message templates.

| # | Step | Who | What happens | Measured by |
| --- | --- | --- | --- | --- |
| 1 | The page | the page | One promise, one field: the WhatsApp. The closing form adds the name and the billing system. | visits → requests |
| 2 | The first message | the creator, same business day | Thanks, three questions — customers, system, CLABE — and a 60-second recording of the customer's side. | answered within a business day; fit, by system (read from the conversations, not the panel) |
| 3 | The door | the creator | Supported system: the sign-up link and four steps (create the account → confirm the email → the CLABE → connect the system). Own software: the connection guide, together. No system: a waiting list. | accounts created from a conversation |
| 4 | The first payment, together | the creator and the product | One link to one real customer with the chat open: transfer, verification, reactivation. | first verified payment within 7 days |
| 5 | The real yes | the product | The welcome allowance runs out; the first top-up is the yes to the price quoted in step 2. | first top-up |

Steps 1 and 2 are this feature; 3 to 5 already live in the product and the
operator's panel. What is new outside this tree: the two templates and the
recording (quickstart, *Pre-flight*).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A business owner understands Devolada and asks for it (Priority: P1)

An ISP owner opens the page on their phone, from a message a colleague
forwarded. Within the first screen they know three things: this collects
their customers' payments by SPEI through a permanent link per customer, it
verifies each transfer against the bank's own record before anyone trusts
it, and it acts in the billing system they already use. They scroll: how it
works for them, how it works for their customer, how it is charged, what
happens in the cases they are already worried about, and who is behind it.
They type their WhatsApp into the first screen — or, further down, their
WhatsApp, their name and the system they bill with — and are told when they
will hear back.

The owner of a school, a gym or a software company reads the same page and
finds nothing that names a vendor: the connection to their billing system is
a question the conversation answers. Nothing on the page promises an action
in a system that is not connected.

**Why this priority**: it is the feature. Without it nothing else on the
page has a reader. On its own it delivers the whole value: a prospect can
find, understand and ask — without the creator in the room.

**Independent Test**: publish the page; hand the address to someone who runs
an ISP and has never seen Devolada; watch them read it on a phone and take
the main action; confirm the request reaches the creator with what was
typed. The page passes when they can say back what it does, for whom, and
how it is charged, without prompting.

**Acceptance Scenarios**:

1. **Given** a visitor on a 360px-wide phone, **When** the page opens,
   **Then** the first screen states what Devolada does, whom it is for, and
   shows the main action — readable without zooming, with no horizontal
   scroll anywhere on the page.
2. **Given** a visitor reading on, **When** they reach how it works, **Then**
   they see the business's steps and the customer's steps separately, and
   the customer's steps use the words the customer's payment page uses ("Haz
   tu transferencia", "Envía tu comprobante", "Tu pago fue registrado").
3. **Given** a reader on the supported billing system, **When** they read
   what Devolada does in it, **Then** the action is named by what it does
   there — reactivates the service, marks the invoice paid — and the system
   is named, so they recognise themselves.
4. **Given** a reader whose business is not on the supported billing system,
   **When** they look for their case, **Then** the page says their own
   software asks for the link and is told the verdict, and says nothing that
   implies more than that.
5. **Given** a visitor with a doubt the page anticipates (a short payment, a
   false or reused receipt, how long verification takes, whether they must
   change banks, what happens when their system does not answer), **When**
   they read the answer, **Then** it describes what the product does today —
   verifiable against the product, with no promise the product cannot keep.
6. **Given** a visitor reading how it is charged, **When** they look for a
   figure, **Then** they find the model — prepaid, per verified payment, no
   monthly fee, no contract, the first payments free — and no figure, and
   are told the figures come with the answer to their request.
7. **Given** a visitor who takes the main action, **When** they send the
   request with the required answers, **Then** the page confirms it in
   words, says when the creator will answer, and the request reaches the
   creator with every field as typed.
8. **Given** a visitor who sends with a required answer missing or
   malformed, **When** they send, **Then** the page says which answer, next
   to it, and keeps everything else they typed.
9. **Given** a visitor who already has an account, **When** they take the
   header's sign-in link, **Then** they land on the product's sign-in — and
   nothing else on the page leads to sign-up.
10. **Given** a visitor reading inside the browser of a messaging app,
    **When** they read and send, **Then** nothing is different: same
    content, same action, same confirmation.
11. **Given** the request was sent, **When** the confirmation shows, **Then**
    the page asks for nothing further — no account, no code, no second form.

---

### User Story 2 - The creator reads the answer (Priority: P2)

Thirty days after publishing, the creator opens one view and answers "is
there demand?" with numbers: how many people visited, how many began the
request, how many asked, which channels brought them, and which of the
requests are businesses the product serves end to end today. Nothing about a visitor is recorded that would identify
them; only the requests — which people typed themselves — carry a name.

**Why this priority**: this is what "validate" means. Without it the page is
a brochure; with it the page is an experiment with a readable result. It is
second only because it needs the first to have anything to count.

**Independent Test**: publish; drive a known number of visits from two
tagged channels; begin the request and send requests known numbers of
times; confirm the creator's view shows those exact counts, by channel, and
every request with its answers.

**Acceptance Scenarios**:

1. **Given** the page has been live for a period, **When** the creator opens
   the measurement view, **Then** they see for that period: visits, visitors
   who began the request, requests sent, and the share each is of the visits
   — without asking a developer.
2. **Given** visitors arrived through two differently tagged addresses,
   **When** the creator reads the view, **Then** each channel's visits and
   requests are shown apart.
3. **Given** requests have arrived, **When** the creator opens the list,
   **Then** each shows its answers as typed, which system runs its billing,
   the channel it came from and when it arrived — newest first — and the
   list can be taken out as a file.
4. **Given** a visitor who never sent a request, **When** the creator
   looks at everything the page recorded, **Then** nothing identifies that
   person: no name, no address, no device.
5. **Given** the creator's notification could not be delivered when a
   request arrived, **When** the creator opens the list, **Then** the
   request is there anyway, and the failed notification is visible.

---

### User Story 3 - The page travels well (Priority: P3)

The creator pastes the address into a WhatsApp group of ISP owners. The
message shows a title, one line and an image before anyone taps. Someone
searches the name later and finds it. A tagged address sent to one group and
a differently tagged one sent to another tell the creator, a week later,
which group asked.

**Why this priority**: the page's readers will be reached one message at a
time, in messaging apps; a link that unfurls into nothing is a link nobody
opens. Third because a page that reads well and counts well already
validates; this makes the distribution cheaper and the numbers attributable.

**Independent Test**: send the address to a phone in a messaging app and
check the preview; open a tagged address, send a request, and find the tag
on the request the creator sees; search the product's name and find the page.

**Acceptance Scenarios**:

1. **Given** the address is pasted into a messaging app, **When** the preview
   renders, **Then** it shows the page's title, a one-line description in
   es-MX, and an image on which the product's name is legible at thumbnail
   size.
2. **Given** a visitor opened the page through a tagged address, **When**
   they send a request, **Then** the request carries that tag and the page's
   counts attribute the visit to it.
3. **Given** a search engine has read the page, **When** someone searches the
   product's name, **Then** the page is found with the same title and
   description the preview shows.
4. **Given** a customer of a business lands here looking for where to pay,
   **When** they read the first screen, **Then** one short line tells them
   this page is for businesses and their payment is made from the link they
   were sent — and the page never offers a way to pay here.

---

### Edge Cases

- **The creator's notification fails when a request arrives.** The request
  is kept and listed regardless; the failure is visible to the creator. No
  request is ever lost to a mail problem.
- **The same person asks twice.** Both are kept; the list shows they share a
  contact. There is no "you already asked" wall — a person who mistyped their
  number must be able to ask again.
- **Automated submissions.** The form resists bots without making a person
  solve a puzzle: a limit per address, and a hidden trap no person fills. A
  flood never hides real requests from the creator.
- **A stranger reaches sign-up through the sign-in link.** Accepted, and
  bounded as on 2026-09-19: one welcome allowance, sign-up limited per
  address. Telling a stranger from a business is the admission-policy
  feature's job, not this page's.
- **A business whose system is not connected asks.** The page promised
  nothing about their system; the request says which one they use, so the
  creator's first reply is honest: the connection guide, or the waiting
  list.
- **Scripts do not run, or run late.** Every word on the page reads without
  them, and the request can still be sent.
- **The product's own services are unavailable.** The page still reads in
  full. Only the request cannot be sent; the page says so and shows the
  contact address to write to instead.
- **The operator changes the price or the free allowance.** Nothing on the
  page changes, because the page shows no figure. The only pricing claim it
  makes — prepaid, per verified payment, no monthly fee, the first payments
  free — is on the claims list and is reviewed like every other.
- **A capability the page names is later changed or removed.** The claims
  are a reviewed list, each tied to the product behaviour behind it, checked
  before every publication. A claim with nothing behind it does not publish.
- **A customer arrives looking for where to pay.** One line sends them back
  to their link; the page never shows a CLABE or takes a payment.
- **The visitor prefers a light theme, or reduced motion.** The page is dark
  by decision and stays dark; reduced motion is honoured as the product
  honours it — nothing on the page moves in a way that carries meaning.
- **A visitor arrives with a channel tag the creator never made.** The tag
  is kept as typed and counted as its own channel, never dropped.
- **The phone is 360px wide.** Nothing overflows, nothing scrolls sideways,
  every tap target is at least 48px and the main action is 64px.

## Requirements *(mandatory)*

### Functional Requirements

**One page, two readers, one action first**

- **FR-001**: The page MUST be reachable at the product's root address, over
  a secure connection, with the `www` form leading to the same page. It is
  one page: every section is on it. The only other addresses it needs are
  the privacy notice, the request's outcome pages (received; not sent) and
  a not-found page.
- **FR-002**: The page MUST speak to any business in Mexico that collects
  recurring payments by SPEI — ISPs first — without naming a billing-system
  vendor. It MUST say that Devolada connects to the reader's billing system
  and tells it when a payment is verified, and that which system they use is
  settled in the conversation. It MUST NOT promise the automatic action to a
  system that is not connected, nor imply that a business makes links by
  hand from the panel.
- **FR-003**: The first screen MUST state, without scrolling on a 360px
  phone: what Devolada does (collects by SPEI through a permanent link per
  customer, verifies each transfer against the bank's own record, tells the
  business's system what happened), whom it is for, and the one action: a
  field for the WhatsApp and its button.
- **FR-004**: The page MUST offer exactly one action: the reader's WhatsApp
  number and a button, worded the same wherever it appears, present in the
  first screen and again at the end — there with the name and the billing
  system. The page MUST NOT link to the product's sign-up. The header
  carries a sign-in link for customers who already have an account, and no
  other call to act.
- **FR-005**: The page MUST state the two brakes in plain words: the money
  goes to the business's own account and never passes through Devolada; the
  business's own system stays the record, and Devolada tells it what
  happened.
- **FR-006**: The page MUST show how it works from both sides — the
  business's steps and the customer's steps — and MUST show the customer's
  screen at its two moments, verifying (with the waiting breath) and
  registered. The customer's side MUST use the words the customer's payment
  page uses.
- **FR-007**: The page MUST name the action by what it does in the reader's
  system — reactivate the service — never by an internal word and never by
  a vendor's name. The supported system appears on the page only as an
  answer in the form's billing-system question.
- **FR-008**: The page MUST answer, somewhere on it, the doubts a reader
  brings: a short payment, a false or reused receipt, how long verification
  takes, whether they must change banks, what happens when their system does
  not answer, and what the customer sees meanwhile — at most three of them
  as a list of questions, the rest inside the benefits and the customer's
  screen. Each answer describes the product as built.
- **FR-009**: The page MUST say how Devolada charges — prepaid, per verified
  payment, no monthly fee, no contract, the first payments free — and MUST
  say that the figures come with the answer to a request — the figures
  themselves stay off the page (FR-014). That description MUST be how the
  product charges; it is a claim under FR-013.
- **FR-010**: The page MUST show a way to reach a person — an address at the
  product's own domain, answered by the creator — visible without taking
  the action.
- **FR-011**: The page MUST tell a customer who arrived looking for where to
  pay that this page is for businesses and their payment is made from the
  link they were sent. The page MUST NOT show a CLABE, take a payment, or
  offer to.
- **FR-012**: The page's words are es-MX in a close, Mexican register —
  "tú", moderate slang where it lands — and a formal one wherever money,
  verification or the law are named: SPEI, Banxico, CLABE, the privacy
  notice. It says "cobrar" for what the business does and "pago" for what
  the customer does; it never uses "cobro" for the customer's act. The
  headline is *Cobrar por transferencia, sin la talacha.*; SPEI is named in
  the eyebrow, the subhead and the proof tile.

**Every claim is true**

- **FR-013**: Every claim on the page MUST describe the product as built on
  the day it publishes; a capability not yet built MUST NOT be claimed. The
  claims are kept as a reviewed list, each tied to the product behaviour or
  decision that makes it true, and the list is checked before each
  publication.
- **FR-014**: The page MUST show no figure the product holds and the
  operator can change — no price, no free-allowance count, no minimum
  top-up. Should one ever be added, it MUST be the product's own current
  value, verified on every release, so the page can never drift from what
  the product charges.

**The request**

- **FR-015**: The request MUST ask for no more than: the person's WhatsApp
  number (required), and — only in the closing form, both optional — their
  name and which system runs their billing: the supported one, their own
  software, another one, or none yet. Nothing else: no email, no business
  name, no size, no note. The first screen asks for the WhatsApp alone.
- **FR-016**: On sending, the page MUST confirm in words that the request was
  received and when the creator will answer — by WhatsApp, within one
  business day — and
  MUST ask for nothing further: no account, no code, no second form.
- **FR-017**: Every request MUST be kept and shown to the creator in one
  place, newest first, with every answer as typed, when it arrived and the
  channel tag it carried; the list MUST be exportable as a file. Requests
  belong to the platform, not to any business, and are visible to the
  platform operator only.
- **FR-018**: The creator MUST be notified of each request. A failed
  notification MUST NOT lose the request, and the failure MUST be visible to
  the creator.
- **FR-019**: The request MUST resist automated submission without asking a
  person to solve a puzzle: no more than five requests per hour from one
  address, and a hidden field a person never fills. A request refused for
  either reason is told so plainly and offered the contact address.
- **FR-020**: The page MUST check the answers before sending and, on any
  error, MUST name the answer at fault next to it and keep everything else
  typed.
- **FR-021**: When the request cannot be sent because the product's services
  are unavailable, the page MUST say so and show the contact address. The
  page's content MUST read in full regardless.
- **FR-022**: A privacy notice MUST be reachable from the form and from the
  foot of the page, saying what is collected, why, who holds it, and how to
  ask for it to be corrected or deleted — what Mexican data-protection law
  asks of anyone who collects a person's data.

**Reading the result**

- **FR-023**: The page MUST count visits, visitors who began the request
  (the first focus inside either form), and requests sent — by day and by
  channel — without cookies, without recording anything that identifies a
  visitor, and therefore without a consent banner.
- **FR-024**: The creator MUST be able to read those counts, and the share
  each is of the visits, for a chosen period — the last 7, 30 or 90 days —
  in one place, without a developer.
- **FR-025**: A channel tag in the page's address MUST be kept for the visit
  and recorded on any request sent from it. An address without a tag counts
  as "direct"; a tag the creator never made is kept as typed.

**Looks and works like the product**

- **FR-026**: The page MUST carry the product's visual identity — the same
  tokens, type, colour, spacing and button sizes — and MUST introduce no
  palette, type or size of its own. It renders the product's dark palette by
  default, without a toggle. Fonts are self-hosted.
- **FR-027**: The page MUST load nothing from any origin other than its own
  and the counting it declares, and nothing at all that identifies the
  visitor.
- **FR-028**: The page MUST meet WCAG 2.2 AA on the palette it renders: 4.5:1 body
  text, 3:1 controls and focus; keyboard-complete with a visible focus;
  reduced motion honoured; every image described in words; the form's
  errors announced.
- **FR-029**: The page MUST work from a 360px floor, designed at 375: body
  text 16px, no horizontal scroll at 360, 768 or 1280, tap targets 48px, the
  main action 64px.
- **FR-030**: Every word on the page MUST read before any script runs, and
  nothing essential MUST wait on one.
- **FR-031**: When the address is shared in a messaging app or a social
  network, the preview MUST show the title, a one-line es-MX description and
  an image on which the product's name is legible at thumbnail size. Search
  engines MUST be able to read the page with the same title and description.
- **FR-032**: The page MUST publish and roll back the way the product does —
  the same release path, the same gates for contrast, accessibility and
  layout — and a change to it is a change like any other.

### Key Entities

- **Access request**: what a prospect typed — the WhatsApp number and, when
  the closing form was used, their name and which system runs their billing
  — plus what the page knew: which of the two forms it came from — `hero`
  (the first screen) or `full` (the closing form) — the channel tag, when it
  arrived, and whether the creator's notification went out. Kept whole, never edited, exportable. Owned by the platform.
- **Step count**: how many visits (a visit is a page load — not a person,
  not a device), begun requests and sent requests there were on a day,
  through a channel. Holds no person.
- **Claim**: one sentence the page makes about the product, paired with the
  behaviour or decision that makes it true. The claims form a list reviewed
  before every publication; the pricing model is one of them.
- **Channel tag**: a short label carried in the page's address that names
  where the visitor came from. The creator makes one when sharing; the page
  keeps it as typed and passes it on with the visitor.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Five people who run or work at a business that collects by
  SPEI — at least three of them at an ISP — and have never seen Devolada can
  each say, after reading the page once on a phone, what it does, for whom,
  and how it is charged — 5 of 5, unprompted.
- **SC-002**: On a mid-range phone over a cellular connection — measured
  in Chrome DevTools with the "Slow 4G" network preset and 4× CPU
  throttling, or Lighthouse's mobile preset — the first screen is readable
  within 2 seconds and the whole page within 5; the first visit costs the
  visitor less than half a megabyte of data.
- **SC-003**: Thirty days after publication the creator can state, from one
  view in under five minutes: requests received, requests by billing system
  (the supported one, own software, another, none yet, unanswered), and the
  share of visitors who asked.
- **SC-004**: 100% of sent requests reach the creator's list, including every
  request sent while notification is unavailable — zero lost, proved by
  sending with notification off.
- **SC-005**: Visits and requests are attributed to their channel with full
  agreement between what was sent and what is shown — proved with two tagged
  addresses.
- **SC-006**: Automated accessibility checks pass on the palette the page renders at 360,
  768 and 1280 with zero violations; zero horizontal scroll; every tap target
  at least 48px and the main action 64px; the whole page reachable by
  keyboard with a visible focus.
- **SC-007**: Shared to a phone in a messaging app, the address shows title,
  description and image — checked on a real device on both major phone
  platforms.
- **SC-008**: Zero claims on the page without a product behaviour behind
  them: the claims list is reviewed before the first publication and on
  every change, and each review is recorded.
- **SC-009**: With the product's services stopped, the page still reads in
  full and the form fails with the contact address shown — checked before
  publication.
- **SC-010**: Nothing the page stores identifies a visitor who did not ask —
  checked by inspecting everything recorded after a session with no request.
- **SC-011**: In the first thirty days, every change to the page's claims is
  an addition, never a retraction: zero corrections because a claim was
  wrong.

## Assumptions

- The product's root address is unused today and becomes the page's home,
  with `www` leading there. The panel, the payment page and the programs'
  address keep their own names.
- The page is es-MX only. The reader is a decision-maker at a business; the
  customer never lands here on purpose — their door is the link they were
  sent — and FR-011 catches the ones who do.
- ISPs are the first readers because they are the only ones the product
  serves end to end today, with the action in their system. The page does
  not say so; the conversation does, system by system (workflow step 3).
- No testimonial or customer name at launch: the pilot ISP's identity is not
  public unless they agree. The page is laid out so one can be added without
  redesign.
- The page wears the product's identity and renders its dark palette; the
  light palette stays in the design as a tweak. No palette or type of its
  own.
- The creator answers each request personally within one business day, and
  that is where the figures are said. The page promises what the creator can
  keep; if that changes, the promise on the page changes with it.
- The platform's current figures — $5.00 MXN per verified payment after 20
  free, both operator settings — never appear on the page (FR-014). The
  creator quotes them in the conversation, where a negotiated fee is also
  possible.
- Counting is aggregate and cookieless, so there is no consent banner and
  nothing personal is kept about a visitor who does not ask.
- Working number for "there is demand": ten requests from businesses the
  product serves end to end within thirty days means keep going; fewer means
  change the message before changing the product. The creator may set
  another number; it is a reading aid, not a requirement.
- The WhatsApp is the channel: the reader gives theirs; the creator's own
  number is not published. The human contact by email stays in the footer.
- The creator can keep what the page promises — a WhatsApp reply within one
  business day, and activation together up to the first verified payment
  (workflow steps 2–4) — and the 60-second recording of the customer's side
  exists before publication (quickstart, *Pre-flight*).
- Requests are kept wherever the product keeps its own records, under the
  platform's ownership, and shown in the place the platform operator already
  works.
- The creator named the rendering framework for this page in the feature
  input. That choice belongs to `/speckit-plan`, which must weigh it against
  the constitution's fixed stack table and justify the departure in
  Complexity Tracking; the spec does not decide it.

## Deferred

- **Admission policy** — who may create a business, and whether identity is
  checked before one can collect. Named "the next feature" by
  production-launch. This page does not link to sign-up; the door sits one
  click behind sign-in, with the bounded cost accepted on 2026-09-19. The
  policy is still the next feature, and the day the panel shows strangers
  outnumbering businesses is the day it becomes urgent.
- **"Crear cuenta" on the page.** It returns when three things are true:
  ten conversations followed the same steps (so the onboarding can be
  written down), the panel serves that segment without the creator, and the
  admission policy exists. When it does, recording the channel tag at
  account creation comes with it — a change to the product's sign-up, which
  this feature does not touch.
- **Testimonials, names and a case study** from the pilot ISP, once they
  agree.
- **An English version.**

## Out of Scope

- More than one page: no blog, documentation, separate pricing page or help
  centre.
- A content-management tool. The page is edited like code and ships like
  code.
- Chat widgets, pop-ups, cookie banners (there is nothing to consent to),
  newsletters.
- Paid advertising and any search strategy beyond the page being readable
  by search engines.
- Testing two messages against each other. The first experiment is one
  message; a second message is a change.
- Any change to the product's sign-up, onboarding or panel — the header's
  sign-in link lands on the product as it is.
- Sending WhatsApp messages from the product. The creator answers by hand;
  an automated reply through the WhatsApp Business API is a later, paid
  decision.
- Managing the relationship after the request — status, follow-ups,
  reminders. The list and its export are enough; the creator's own tools
  carry the rest.
- Taking payments, a demo of the customer's page with a real CLABE, or a
  sandbox for prospects.
