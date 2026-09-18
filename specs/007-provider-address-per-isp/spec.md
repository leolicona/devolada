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

### Edge Cases

- **The identifiers stop meaning anything.** A customer reference Devolada
  stored — the identifier it uses to register a payment and reconnect the
  service — belongs to one installation. If a connected business moves to
  another installation, every stored reference silently points at a stranger,
  and the next confirmed payment could be registered against the wrong
  customer's account. Money law says this must be impossible, not unlikely.
- **An ISP picks the wrong installation but a valid-looking key.** Nothing
  connects; the error must send them to the installation, not the key.
- **An installation Devolada does not list.** The ISP signs in somewhere
  Devolada has never heard of — a white-label domain, a new server.
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
- **FR-004**: An ISP MUST be able to choose their installation from a list
  Devolada maintains, described in terms they recognise — where they sign in —
  rather than as a technical endpoint.
- **FR-005**: Devolada MUST NOT send a provider credential to any destination
  outside the list it maintains. An installation that is not on the list is
  not reachable from the panel.
  [NEEDS CLARIFICATION: may an ISP on an installation Devolada does not list
  self-serve, or is adding an installation always a reviewed change?]
- **FR-006**: The connection test MUST run against the installation being
  saved, never against a different one.
- **FR-007**: A failed connection MUST report which of three causes applies —
  unreachable installation, credential rejected, or missing permission — and
  MUST name the installation that was tried.
- **FR-008**: A connection MUST NOT be reported as healthy unless the
  credential can perform every action Devolada will later take on the ISP's
  behalf. Reading customers alone is not a healthy connection.
- **FR-009**: The installation in use MUST be visible on the integration
  screen whenever a connection exists, with the same prominence as the
  credential's identifying tail.
- **FR-010**: Changing a connected business's installation MUST NOT leave any
  stored customer reference pointing at an installation it did not come from.
  [NEEDS CLARIFICATION: on a change, should Devolada refuse while links or
  queued actions exist, or accept the change and invalidate the affected
  references for re-mapping?]
- **FR-011**: An unreachable or misconfigured installation MUST degrade the
  provider-side action only. Payments MUST still be received, validated and
  recorded, and the resulting action MUST wait with a visible status rather
  than being lost or silently dropped.
- **FR-012**: No message shown to a user, and no record Devolada keeps of a
  failure, may contain a provider credential.
- **FR-013**: The platform MUST retain a way to name a default installation
  for businesses that record none, so the product has a sane answer before
  anyone chooses.

### Key Entities

- **Installation**: one of the provider's separate deployments. Has a name an
  ISP recognises (where they sign in), an address Devolada reaches it at, and
  a note of whether it is a real or a test installation. Devolada maintains
  the set; ISPs choose from it.
- **Business connection**: what a business has told Devolada about its
  provider — the credential, the behaviour switches that already exist, and
  now the installation. One per business.
- **Customer reference**: the identifier Devolada stores to act on a specific
  customer of a specific ISP. Meaningful only within the installation it was
  read from, which is what makes FR-010 a money question and not a tidiness
  one.

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
  installation other than the one its business is connected to — zero
  occurrences, verified by reconciling actions to installations.
- **SC-008**: While an installation is unreachable, 100% of payments to that
  business are still received and validated, and 100% of their provider-side
  actions are recoverable once it answers.

## Assumptions

- The provider's installations are operated by the same vendor and speak the
  same interface; only the data and the credentials differ. An ISP's key is
  valid on exactly one of them.
- Most ISPs are hosted on the installation Devolada already defaults to, which
  is why an unrecorded installation falls back to it rather than blocking.
- The right to set the installation is the right that already governs the
  provider credential — owner and admin, not every member. No new role.
- An ISP knows where they sign in, and can recognise it in a list. They do not
  know, and must not be asked for, the address their key answers on: the two
  differ, and Devolada holds that mapping.
- The list of installations is maintained the way the product already
  maintains catalogues of external identifiers: as reviewed data, verified
  automatically so it cannot drift unnoticed, not as free text typed by
  whoever happens to be on the screen.
- The provider's own test installation is one of the listed entries, marked as
  a test, so Devolada can exercise the integration without any real billing
  behind it.
- The platform-wide setting that names today's address stays as the *default*
  for businesses that record none — it stops being an override.
- Which of the seven provider permissions Devolada needs is already known from
  the existing integration; this feature checks them, it does not discover
  them.

## Out of Scope

- Discovering an ISP's installation automatically from their sign-in address.
  The ISP chooses.
- Migrating a business's customers from one installation to another. FR-010
  governs the identifiers; moving the data is the provider's business.
- Supporting a second provider. This feature is about one provider that
  happens to run many installations, not about a second vendor.
- Encrypting the stored credential at rest. Real and worth deciding, but a
  separate question with a separate blast radius.
