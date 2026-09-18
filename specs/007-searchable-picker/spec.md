# Feature Specification: searchable-picker

**Feature Branch**: `claude/clabe-dropdown-search-ouw4cc`

**Created**: 2026-09-18

**Status**: Draft — decisions taken by the product creator in session

**Input**: User description: "A searchable picker for the bank field in the ISP panel. A vocabulary of 97 bank names is searched, not scanned: the field itself is the search box. Typing filters the list by match, ignoring case and accents, with names that start with what was typed offered first. Arrows move, Enter chooses. The field only ever commits a name from the provider vocabulary — blur, Escape and Tab restore the committed name, because a half-typed fragment left in the field reads like a choice that was made, and the provider answers `invalid` rather than an error for a name it does not know, which loses payments silently. It serves the three admin screens that choose a bank: the ISP's own account, a top-up's sender, and the platform's own. The payer's public page keeps its native picker (direct-payment D16)."

## Summary

Choosing a bank in the ISP panel means finding one name among 97. A list that
long is not read — it is searched. This feature makes the bank field its own
search box: the ISP types, the list narrows to what matches, and the name is
chosen with the pointer or with the keyboard alone.

The field is also a safety device. The chosen name travels with every payment
the business ever asks Devolada to validate, and the provider answers `invalid`
— never an error — for a name it does not recognise, which reads exactly like a
transfer that never happened (`apps/api/src/direct-payments/banks.ts`, measured
2026-08-19). So the field accepts nothing but a name from the vocabulary, and
every way out of it restores the name that was last chosen.

**Relationship to `bug: bank-picker-unreachable`.** That bug is the panel's
dropdown growing past the window with nothing to scroll, which made the bank
list unreachable and is fixed separately. This feature is the different
question the same list raised: 97 names should not have to be scanned at all.
The two were built together in one pass and are separated here so each has the
home the constitution gives it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The ISP finds their bank by typing (Priority: P1)

An ISP owner is setting up where their customers' money arrives. They enter
their account number, and the bank is not filled in for them — only a third of
Mexico's institution prefixes are recognised. They type the first letters of
their bank's name and the list narrows to it.

**Why this priority**: This is the feature. Without it the ISP is reading 97
names looking for one, and it is the step that stands between a new business
and collecting its first payment.

**Independent Test**: Open the panel's direct-payment screen, type a fragment
into the bank field, and confirm the offered names are the ones that match.
Delivers the whole value on its own.

**Acceptance Scenarios**:

1. **Given** the bank field is empty, **When** the ISP opens it, **Then** the
   whole vocabulary is offered.
2. **Given** the bank field is open, **When** the ISP types "scotia", **Then**
   SCOTIABANK is the only name offered.
3. **Given** the bank field is open, **When** the ISP types "ban", **Then** the
   names that *begin* with those letters are offered before names that merely
   contain them.
4. **Given** the bank field is open, **When** the ISP types "méxico" with the
   accent their keyboard produces, **Then** the names written without one are
   still found.
5. **Given** names are offered, **When** the ISP moves through them with the
   arrow keys and presses Enter, **Then** the highlighted name is chosen,
   without the pointer being used at all.

---

### User Story 2 - The field never holds a name nobody chose (Priority: P2)

The ISP starts typing a bank name, changes their mind, and clicks away — or
presses Escape, or tabs on to the next field. The field shows the bank they
actually chose, not the fragment they abandoned.

**Why this priority**: It cannot be tested until typing exists, but it is what
makes the feature safe rather than merely convenient. A fragment left sitting
in the field reads as a choice, and a bank name the provider does not know does
not lose one payment — it loses all of them, silently.

**Independent Test**: With a bank already chosen, type a fragment and leave the
field by each of the three exits. The chosen name is back each time.

**Acceptance Scenarios**:

1. **Given** a bank is chosen and the ISP has typed a fragment over it, **When**
   they press Escape, **Then** the chosen name is restored.
2. **Given** the same, **When** they click elsewhere on the screen, **Then** the
   chosen name is restored and the list closes.
3. **Given** the same, **When** they move to the next field with the keyboard,
   **Then** the chosen name is restored.
4. **Given** the ISP types something no bank matches, **Then** the field says so
   and the saved bank is unchanged.
5. **Given** the ISP has typed a fragment that matches nothing, **When** they try
   to save, **Then** nothing outside the vocabulary can be saved.

---

### User Story 3 - One bank field, wherever a bank is chosen (Priority: P3)

A bank is named in three places in the panel: the business's own account, the
sender of a balance top-up, and — for the platform operator — the platform's own
account. All three behave the same way.

**Why this priority**: The value is consistency, not capability. Each screen
works on its own once Story 1 lands; this is what stops the panel from teaching
three different habits for one act.

**Independent Test**: Choose a bank on each of the three screens using the same
keys, and confirm the behaviour does not change between them.

**Acceptance Scenarios**:

1. **Given** the ISP has learned the field on the direct-payment screen, **When**
   they name the sending bank of a top-up, **Then** the same typing, the same
   keys and the same rules apply.
2. **Given** a platform operator setting the platform's own account, **When**
   they choose a bank, **Then** the field behaves as it does for a business.

---

### Edge Cases

- **Nothing matches what was typed.** The field says so plainly and changes
  nothing. It never offers to save what was typed.
- **The account number fills the bank in.** When the first three digits identify
  a bank, the field shows it. A name the ISP then picks by hand wins over the
  number from that point on — re-typing the account number must not overwrite a
  deliberate choice.
- **A saved bank that is no longer in the vocabulary.** The panel already warns
  that transfers are off until it is picked again; this field must let them pick
  it again, and must not treat the stale name as a valid starting point.
- **A person who cannot use a pointer.** The whole act — open, search, move,
  choose, cancel — is reachable from the keyboard, and what is open and what is
  highlighted is announced.
- **The narrow end of the panel.** The field and its list stay usable down to the
  product's floor width, with no sideways scrolling.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The bank field MUST accept typed text and narrow the names it
  offers to those matching what was typed.
- **FR-002**: Matching MUST ignore letter case and accents, in both directions —
  an accented query finds an unaccented name and the reverse.
- **FR-003**: Names that *begin* with what was typed MUST be offered before names
  that merely contain it.
- **FR-004**: The names offered MUST come from the one generated bank vocabulary.
  The field MUST NOT offer, accept or save any other value, however it was typed.
- **FR-005**: A name MUST be choosable with the pointer and, equivalently, with
  the keyboard alone: open the list, move through the names, choose the
  highlighted one, cancel.
- **FR-006**: When nothing matches what was typed, the field MUST say so and MUST
  leave the saved name unchanged.
- **FR-007**: Every way of leaving the field — cancelling, moving focus away,
  moving to the next field — MUST restore the name last chosen. A partially
  typed name MUST never remain in the field as though it had been chosen.
- **FR-008**: When the account number's first three digits identify a bank, the
  field MUST show that bank; once the ISP has chosen a name by hand, that choice
  MUST win over the number thereafter.
- **FR-009**: All three places in the panel that name a bank MUST use this one
  field: the business's own account, a top-up's sender, and the platform's own
  account.
- **FR-010**: The field MUST be announced to assistive technology: that it is a
  field with a list, whether the list is open, and which name is highlighted.
- **FR-011**: The public payment page MUST keep the picker it has. This feature
  changes nothing a payer sees.
- **FR-012**: The field MUST consume the product's shared visual foundations and
  introduce no colour, size, spacing or motion value of its own.

### Key Entities

- **Bank vocabulary**: the 97 names the payment provider recognises, generated
  from one documented source and identical everywhere it is used. This feature
  reads it; it never restates, extends or reorders it in place.
- **Chosen bank**: the one name saved for a business, which travels with every
  validation that business asks for. Its only permitted values are names from
  the vocabulary, or none.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every one of the 97 banks can be brought into the visible part of
  the list by typing at most **4 characters**; 76 of the 97 appear after a
  single character. (Measured 2026-09-18 against the vocabulary and the ranking
  rule in FR-003; the worst case is BANK OF CHINA at 4.)
- **SC-002**: 100% of the vocabulary is selectable. No name is unreachable, at
  any window size.
- **SC-003**: No sequence of typing and leaving the field can save a value
  outside the vocabulary. Each of the three ways out restores the chosen name.
- **SC-004**: The whole act can be completed without a pointer.
- **SC-005**: A person who has learned the field on one of the three screens
  needs no new behaviour on the other two.

## Assumptions

- The bank vocabulary stays generated from its single documented source. This
  feature reads it and sorts a copy for reading order; it adds no name.
- The panel is used on a desktop with a pointer and a keyboard, and must still
  hold at the product's floor width. The payer's phone experience is untouched.
- **Clearing a bank once one is chosen is out of scope.** The control this
  replaces could not clear one either, so this is parity, not a loss. Whether an
  ISP should be able to un-set their bank is a product question of its own.
- The panel's existing warning for a saved bank that has left the vocabulary
  stays as it is; this feature only makes picking a new one easy.

## Out of Scope

- The payer's public payment page. Its picker is the phone's own, which already
  searches and scrolls, and the page's load time sits on a payment's critical
  path (direct-payment D16).
- Widening the map from account-number prefix to bank. It would make the field
  needed less often, which is a good thing and a separate change.
- Every other list in the panel — roles, timezone, workspace, provider actions.
  They are short enough to read.
- Clearing a chosen bank.

## Dependencies

- The generated bank vocabulary and the rule that it is never hand-transcribed.
- The account-number prefix map, whose coverage decides how often the field is
  needed at all.
