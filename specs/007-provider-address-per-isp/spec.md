# Feature Specification: Provider Address per ISP

**Feature Branch**: `007-provider-address-per-isp`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "Yes, create the spec for the address by ISP"

## Context

Devolada reads an ISP's customers, their debt and their service state from the
ISP's own management system, and writes the payment back to it so the customer
is reconnected. That system is not one system. The provider runs several
separate **installations**, each with its own customers, its own staff and its
own credentials. An ISP's key works on the installation that hosts them and is
rejected everywhere else.

Devolada today knows exactly **one** address, chosen for the whole platform
when it is deployed. Three consequences, all observed:

1. An ISP hosted on a different installation **cannot connect at all** — not by
   a setting, not by a support call, only by a deploy.
2. Serving one ISP costs every other. Pointing at one installation cuts off the
   businesses on the rest, including Devolada's own demo tenant.
3. When the address is wrong, the panel says the **key** is wrong. The ISP goes
   and checks a credential that is perfectly fine, and trusts Devolada less
   afterwards.

Three installations already matter to Devolada at once (measured 2026-09-18,
three separate servers): the one the platform defaults to, the one the pilot
ISP is hosted on, and the provider's own test installation where a throwaway
company can be created with no real billing behind it. There is one slot to
name them in.

This feature moves the address from the platform to the business, next to the
credential it belongs with.

## Clarifications

### Session 2026-09-18

- **Q: May an ISP on an installation Devolada does not list connect anyway?**
  **A: No.** The list is closed. An installation Devolada has not vetted is
  neither selectable nor reachable, and adding one is a reviewed change made by
  Devolada. A credential is never sent somewhere nobody looked at first, and a
  typo can never become a credential leak. The cost is accepted: an ISP on a
  new installation waits on Devolada, so the screen must tell them so plainly
  and show them how to ask (FR-005, FR-006).
- **Q: What happens to stored customer references when a connected business
  changes installation?** **A: Accept the change and invalidate them.** The
  references are re-read from the new installation and every payment link that
  used one goes **dormant** — alive, still at its own permanent address, but
  unable to act until it is matched to a customer of the new installation and
  that match is confirmed. Refusing the change was the smaller build; it was
  rejected because an ISP who mis-picks on day one should not have to dismantle
  their setup to correct it (FR-011 through FR-016, User Story 4).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An ISP connects on their own installation (Priority: P1)

An ISP signs up, opens the integration screen, and finds two things to
answer instead of one: **where their system lives**, and **their key**. They
pick their installation from the list Devolada offers — worded the way they
recognise it, the address they sign in at, not a technical endpoint — paste
their key, and save. Devolada tests the key against that installation and
reports what it found. Their customer roster loads.

Nobody deploys anything. Nobody is asked what a base URI is.

**Why this priority**: this is the whole feature. Without it an ISP outside
the default installation is unservable, and the pilot is blocked. With it
alone, the product is viable: one ISP, correctly connected, collecting.

**Independent Test**: create a business, choose a non-default installation,
save a key valid there, and confirm the roster loads and a payment reaches
the right customer — with no configuration change outside the panel.

**Acceptance Scenarios**:

1. **Given** a business with no connection, **When** its owner picks their
   installation and saves a key valid on it, **Then** the connection reports
   success and the customer roster loads from that installation.
2. **Given** a business with no connection, **When** its owner saves a key
   without choosing an installation, **Then** Devolada uses the default
   installation, and the screen says plainly which one was assumed.
3. **Given** a business already connected before this feature existed,
   **When** nothing is changed, **Then** it keeps working exactly as before
   and its owner is never asked to re-enter anything.
4. **Given** a connected business, **When** its owner reopens the screen,
   **Then** the installation in use is shown as clearly as the key's last
   four characters are.
5. **Given** an ISP whose installation is not on Devolada's list, **When**
   they look for it, **Then** the screen says Devolada does not reach it yet
   and shows how to ask for it — it does not offer a box to type it into.

---

### User Story 2 - A failed connection says which thing is wrong (Priority: P2)

Three different failures currently arrive as one message blaming the key. An
ISP who cannot tell them apart cannot fix any of them.

- The installation could not be reached at all.
- The installation answered and **rejected the key** — usually the key
  belongs to a different installation.
- The installation accepted the key but the key's staff user **lacks a
  permission** Devolada needs.

Each gets its own words, and each names the installation that was tried, so
the ISP can see at a glance that Devolada knocked on the wrong door.

**Why this priority**: it converts a support call into a self-service fix. It
is second because an ISP who picks correctly the first time never sees it —
but the pilot did see it, for days, and read it as "Devolada is broken".

**Independent Test**: seed each of the three failures against a test business
and confirm the screen names a different cause for each, and shows the
installation it tried, without revealing the key.

**Acceptance Scenarios**:

1. **Given** an installation that does not answer, **When** the owner saves a
   key, **Then** the screen says Devolada could not reach that installation,
   names it, and says the key was not judged.
2. **Given** a key valid on a different installation, **When** the owner saves
   it, **Then** the screen says that installation rejected the key and
   suggests the installation may be the wrong one — it does not tell the
   owner their key is wrong.
3. **Given** a key whose staff user cannot register payments, **When** the
   owner saves it, **Then** the screen says the connection works but names the
   missing permission, and the connection is not reported as healthy.
4. **Given** any failure, **When** the message is shown, **Then** it never
   contains the key.

---

### User Story 3 - Several ISPs on different installations, at the same time (Priority: P3)

Two ISPs on two installations both collect, and neither can tell the other
exists. Devolada's own demo tenant keeps working beside them, on a third.
Onboarding the next ISP costs the previous one nothing.

**Why this priority**: it is the property that makes the product sellable
beyond one customer, but it is proved by the same mechanism as US1 — this
story is where that mechanism is held to the isolation rule the rest of the
system already keeps.

**Independent Test**: connect two businesses to two different installations,
run a payment through each, and confirm each action landed on its own
installation and neither business's data appears in the other's screens.

**Acceptance Scenarios**:

1. **Given** two businesses connected to different installations, **When** a
   payment is confirmed for each, **Then** each payment is registered on its
   own business's installation and on no other.
2. **Given** two businesses connected to different installations, **When** one
   installation is unreachable, **Then** only that business's actions queue;
   the other business collects and reconnects normally.
3. **Given** a business is connected, **When** a different business changes
   its installation, **Then** the first business sees no change of any kind.

---

### User Story 4 - An ISP who picked wrong recovers without losing their links (Priority: P4)

An ISP connected to the wrong installation, or genuinely moved to another one.
They change it in the panel. Devolada re-reads the roster from the new
installation, and every payment link they had built goes **dormant**: still
alive, still at the same address their customers already have, but unable to
act until Devolada knows who each one now points at.

Devolada proposes a match for each dormant link, by the identifier the ISP
knows the customer by. Someone with the right reviews the proposals — many at
once, not one at a time — and confirms. Each confirmed link wakes at the
address it always had. A payer who saved that link never learns anything
happened.

**Why this priority**: it is the difference between "correcting a mistake" and
"starting over". Without it, an ISP can still change installation safely —
their old links simply stay dormant and they build new ones. With it, a
permanent link stays genuinely permanent across the change, which is the
promise the product is sold on.

**Independent Test**: connect a business, build links, change its installation
to one holding the same customers, and confirm every link goes dormant, every
match is proposed, and every confirmed link wakes at its original address.

**Acceptance Scenarios**:

1. **Given** a connected business with payment links, **When** its owner
   changes the installation, **Then** the roster is re-read from the new
   installation and every link that used a customer reference goes dormant.
2. **Given** dormant links, **When** the owner opens the re-matching screen,
   **Then** Devolada proposes a customer of the new installation for each one
   and the owner can confirm many at once.
3. **Given** a dormant link whose match is confirmed, **When** it wakes,
   **Then** its address is unchanged and a payer who saved it earlier reaches
   the same page.
4. **Given** a dormant link, **When** a payer opens it, **Then** the page says
   in plain es-MX that the link is being updated and asks them to wait — never
   an error, never a dead end, never a form that would send money to the
   wrong customer.
5. **Given** a dormant link whose match is **not** confirmed, **When** any
   provider-side action would run for it, **Then** nothing is sent to the
   provider and the action waits with a visible status.

---

### Edge Cases

- **The identifiers stop meaning anything.** A customer reference Devolada
  stored belongs to one installation. Changing installation makes every stored
  reference point at a stranger, so a confirmed payment could be registered
  against the wrong customer's account. Money law says this must be
  impossible, not unlikely — hence dormancy, and hence FR-013.
- **Money arrives while a link is dormant.** The payer transfers by SPEI to
  the ISP's own account whatever Devolada's page says. The money is real and
  must be received, validated and recorded; only the provider-side action
  waits.
- **An ISP picks the wrong installation but a valid-looking key.** Nothing
  connects; the error must send them to the installation, not the key.
- **An installation Devolada does not list.** The ISP is told plainly, and
  given a way to ask, rather than left with a failing connection or a text box.
- **A dormant link has no match in the new installation.** The customer does
  not exist there. The link must stay dormant and say so, not guess.
- **Two customers in the new installation look like the same match.** Devolada
  must not choose; it asks.
- **An installation is unreachable while payments are arriving.** Payments must
  still be received and validated; only the provider-side action waits.
- **A business with a key but no installation recorded** — every business that
  exists today.
- **An ISP reads the address off their browser bar** and it is not the address
  their key answers on. The two are related but not identical, and the ISP
  should never have to know the difference.
- **The provider's test installation** is chosen by a real business by mistake,
  connecting live collections to a system with no real customers.

## Requirements *(mandatory)*

### Functional Requirements

**The address belongs to the business**

- **FR-001**: Each business MUST carry its own provider installation,
  recorded alongside its provider credential and governed by the same right
  that already governs that credential.
- **FR-002**: A business with no installation recorded MUST behave exactly as
  it does today, using the platform's default installation. No existing
  business may require any action from its owner for this feature to ship.
- **FR-003**: Every read from and write to the provider on a business's behalf
  MUST be addressed to that business's own installation. No provider exchange
  may be addressed to an installation belonging to another business or to the
  platform.
- **FR-004**: The installation in use MUST be visible on the integration
  screen whenever a connection exists, with the same prominence as the
  credential's identifying tail.

**The list is closed**

- **FR-005**: An ISP MUST choose their installation from a list Devolada
  maintains, described in terms they recognise — where they sign in — rather
  than as a technical endpoint. There is no free-text address: an installation
  that is not on the list is neither selectable nor reachable, and Devolada
  MUST NOT send a provider credential to any destination outside it.
- **FR-006**: An ISP whose installation is not on the list MUST be told so
  plainly and shown how to request it, rather than being left with a failing
  connection or an empty choice. Adding an installation to the list is a
  reviewed change made by Devolada, and the list MUST be verified
  automatically so it cannot drift unnoticed.
- **FR-007**: The platform MUST retain a way to name a default installation
  for businesses that record none, so the product has a sane answer before
  anyone chooses.

**Telling the truth about failure**

- **FR-008**: The connection test MUST run against the installation being
  saved, never against a different one.
- **FR-009**: A failed connection MUST report which of three causes applies —
  unreachable installation, credential rejected, or missing permission — and
  MUST name the installation that was tried.
- **FR-010**: A connection MUST NOT be reported as healthy unless the
  credential can perform every action Devolada will later take on the ISP's
  behalf. Reading customers alone is not a healthy connection.

**Changing installation without paying a stranger**

- **FR-011**: Changing a connected business's installation MUST be allowed,
  and MUST invalidate every customer reference that business stored, then
  re-read its roster from the new installation.
- **FR-012**: Every payment link that used an invalidated reference MUST
  become dormant rather than broken: it keeps its own address, and it MUST NOT
  cause any provider-side action until its match is confirmed.
- **FR-013**: No provider-side action may execute against a customer reference
  read from an installation other than the one its business is currently
  connected to. This holds whether or not the re-matching flow exists.
- **FR-014**: A payer who opens a dormant link MUST see plain es-MX saying the
  link is being updated and asking them to wait — never an error page, never a
  payment form that would send money toward the wrong customer.
- **FR-015**: A payment that arrives against a dormant link MUST still be
  received, validated and recorded. Its provider-side action MUST wait with a
  visible status until the link is matched, and MUST NOT be lost or silently
  dropped.
- **FR-016**: Devolada MUST propose a match for each dormant link against the
  customers of the new installation, and a link MUST NOT wake until someone
  holding the same right that governs the connection confirms the match.
  Confirmation MUST be possible for many links in one action. A link with no
  confident match, or more than one, MUST stay dormant and say so rather than
  being guessed.
- **FR-017**: A link that wakes MUST keep the address it has always had, so a
  payer who saved it earlier reaches the same page.

**Degrading and keeping quiet**

- **FR-018**: An unreachable or misconfigured installation MUST degrade the
  provider-side action only. Payments MUST still be received, validated and
  recorded, and the resulting action MUST wait with a visible status.
- **FR-019**: No message shown to a user, and no record Devolada keeps of a
  failure, may contain a provider credential.

### Key Entities

- **Installation**: one of the provider's separate deployments. Has a name an
  ISP recognises (where they sign in), an address Devolada reaches it at, and
  a note of whether it is a real or a test installation. Devolada maintains the
  set as reviewed data; ISPs choose from it and cannot add to it.
- **Business connection**: what a business has told Devolada about its
  provider — the credential, the behaviour switches that already exist, and
  now the installation. One per business.
- **Customer reference**: the identifier Devolada stores to act on a specific
  customer of a specific ISP. Meaningful only within the installation it was
  read from, which is what makes changing installation a money question and
  not a tidiness one.
- **Link dormancy**: the state a payment link holds between an installation
  change and the confirmation of its new match. A dormant link exists, keeps
  its address, shows the payer an honest waiting message, and causes nothing to
  happen at the provider.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An ISP hosted on any installation Devolada lists can go from
  "signed up" to "roster loaded" without anyone changing configuration or
  releasing software — zero deploys between the ask and the working connection.
- **SC-002**: Onboarding a business on a new installation leaves every
  already-connected business untouched: zero failed provider actions and zero
  changed screens attributable to the onboarding.
- **SC-003**: For each of the three connection failures, the screen names a
  distinct cause and the installation tried — 3 of 3, with no message blaming
  the credential when the credential is valid.
- **SC-004**: An ISP who picks the wrong installation can correct it
  themselves, from the panel, in under 2 minutes and without contacting
  support.
- **SC-005**: Zero provider credentials are sent to any destination Devolada
  does not maintain, across all businesses, for the life of the feature.
- **SC-006**: Every business connected before this feature keeps collecting
  with no owner action and no interruption — 100% carried over untouched.
- **SC-007**: No confirmed payment is ever registered against a customer of an
  installation other than the one its business is currently connected to —
  zero occurrences, verified by reconciling actions to installations.
- **SC-008**: While an installation is unreachable, 100% of payments to that
  business are still received and validated, and 100% of their provider-side
  actions are recoverable once it answers.
- **SC-009**: After an installation change, 100% of payment links keep their
  original address, and an ISP can review and confirm the matches for a
  thousand-customer roster in a single session rather than link by link.
- **SC-010**: Zero payments arriving against a dormant link are lost: 100% are
  recorded and validated, and their actions run once the match is confirmed.

## Assumptions

- The provider's installations are operated by the same vendor and speak the
  same interface; only the data and the credentials differ. An ISP's key is
  valid on exactly one of them.
- Most ISPs are hosted on the installation Devolada already defaults to, which
  is why an unrecorded installation falls back to it rather than blocking.
- The right to set the installation, and to confirm a re-match, is the right
  that already governs the provider credential — owner and admin, not every
  member. No new role.
- An ISP knows where they sign in, and can recognise it in a list. They do not
  know, and must not be asked for, the address their key answers on: the two
  differ, and Devolada holds that mapping.
- The list of installations is maintained the way the product already
  maintains catalogues of external identifiers: as reviewed data, verified
  automatically so it cannot drift unnoticed.
- The provider's own test installation is one of the listed entries, marked as
  a test, so Devolada can exercise the integration without any real billing
  behind it.
- The platform-wide setting that names today's address stays as the *default*
  for businesses that record none — it stops being an override.
- Which provider permissions Devolada needs is already known from the existing
  integration; this feature checks them, it does not discover them.
- Changing installation is rare — a correction or a genuine migration, not a
  routine act. The re-matching flow is built for correctness and for reviewing
  many at once, not for speed of repetition.

## Out of Scope

- Discovering an ISP's installation automatically from their sign-in address.
  The ISP chooses.
- Moving an ISP's customers, invoices or history from one installation to
  another. Devolada re-matches its own links to customers that already exist
  in the new installation (FR-016); moving the data there is the provider's
  business.
- Supporting a second provider. This feature is about one provider that
  happens to run many installations, not about a second vendor.
- Encrypting the stored credential at rest. Real and worth deciding, but a
  separate question with a separate blast radius.
- A self-service way for an ISP to add an installation to the list. Settled in
  Clarifications: adding one is a reviewed change.
