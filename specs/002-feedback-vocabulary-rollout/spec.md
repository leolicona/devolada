# Feature Specification: feedback-vocabulary-rollout

**Feature Branch**: `claude/new-session-1cpf5p`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "resolver G2 y G3" — the two coverage gaps `/speckit-analyze` found in `001-design-foundations`: three of the five named feedback states have no implementation, and the pending announcement reaches only one of the product's two surfaces.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The operator can tell when the back office is working (Priority: P1)

Someone running the ISP opens a list of charges, saves a setting, or waits for an
integration to answer. Today some of those waits show a placeholder shape, some
show nothing at all, and none of them are reliably announced to a screen reader.
The payer's page got a language for waiting; this story gives the same language
to the people who use the product all day.

**Why this priority**: it covers the surface where waiting happens most often. An
operator meets a pending state dozens of times a day, against the payer's once.

**Independent Test**: visit every back-office screen that can be pending, with
the wording covered; each one is recognisably pending. Then repeat with a screen
reader and hear each one announced. Needs nothing from the other two stories.

**Acceptance Scenarios**:

1. **Given** any back-office screen loading its data, **When** the operator looks
   at it with the wording covered, **Then** it is recognisably pending.
2. **Given** the same screen, **When** it is read by assistive technology,
   **Then** the pending state is stated in words.
3. **Given** a screen whose content has a known shape, **When** it loads,
   **Then** it shows that shape rather than a generic signal — the two treatments
   do not both appear on the same region.
4. **Given** any pending screen, **When** it is compared with the payer's pending
   page, **Then** the two use the same language rather than two dialects.

---

### User Story 2 - Surfaces arrive and leave the same way (Priority: P2)

Dialogs, sheets, pop-overs and menus appear and disappear all day. Today each
decides for itself, and at least one carries an arrival treatment that silently
does nothing at all. This story defines arriving and departing once, for every
surface, as a change in visibility and never a movement.

**Why this priority**: it is the half of the named vocabulary that was promised
and never built. It is visible on every screen, but no one is blocked by it.

**Independent Test**: open and close every overlapping surface and confirm each
arrives and departs identically; open the same one twice and confirm the two
arrivals are indistinguishable.

**Acceptance Scenarios**:

1. **Given** any surface that appears over the page, **When** it opens,
   **Then** it fades in with the shared treatment.
2. **Given** the same surface, **When** it closes, **Then** it fades out with the
   shared treatment rather than vanishing instantly.
3. **Given** a surface whose arrival treatment currently does nothing,
   **When** this story is complete, **Then** either it arrives visibly or it
   carries no arrival treatment at all — a decoration that does nothing is
   removed, not left in place.
4. **Given** reduced motion is requested, **When** any surface arrives or
   departs, **Then** it changes only in visibility: nothing slides, grows or
   turns.

---

### User Story 3 - A retry looks like a first attempt (Priority: P3)

When something fails and the person tries again, the second wait should look
exactly like the first. No leftover red, no different signal, no memory of the
failure in the motion.

**Why this priority**: the smallest of the three and the least often seen, but it
is where a half-built vocabulary shows: a retry that looks different from a first
attempt tells the person the system is unsure.

**Independent Test**: fail an operation, retry it, and compare the second pending
state against the first. They are indistinguishable.

**Acceptance Scenarios**:

1. **Given** a failed operation, **When** the person retries, **Then** the
   pending state is identical to the first attempt's.
2. **Given** a retry in progress, **When** the screen is inspected, **Then** no
   trace of the previous failure remains in the pending region.
3. **Given** a retry that fails again, **When** the outcome arrives, **Then** it
   arrives the same way any outcome does.

---

### Edge Cases

- **A screen that is pending in two places at once.** A list loading while a
  setting saves must not read as one large indeterminate page.
- **A surface that closes while its content is still pending.** The departure
  must not be blocked waiting for an answer nobody will see.
- **A pending state that resolves during the arrival of its own surface.** The
  two treatments overlap; neither may cancel the other.
- **A retry triggered while the first attempt is still pending.** Only one
  pending state exists at a time for one operation.
- **A back-office screen with no known content shape.** It still needs a pending
  treatment; the absence of a placeholder shape is not the absence of feedback.
- **Reduced motion with a surface that both arrives and is pending.** Two
  visibility changes at once must stay legible rather than compounding into a
  flicker.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every back-office screen that can be pending MUST carry the shared
  pending treatment defined by `001-design-foundations`.
- **FR-002**: Every pending state in the back office MUST be stated in words to
  assistive technology.
- **FR-003**: A region whose content has a known shape MUST show that shape while
  pending; a region without one MUST show the shared pending treatment. The two
  MUST NOT be applied to the same region at once.
- **FR-004**: No screen may invent its own pending treatment.
- **FR-005**: Arriving and departing MUST each have exactly one definition,
  shared by every surface in both surfaces of the product.
- **FR-006**: Arriving and departing MUST change visibility only. Nothing may
  translate, scale or rotate, in either theme, with or without reduced motion.
- **FR-007**: A surface carrying an arrival or departure treatment that has no
  effect MUST either be given a working one or have it removed. An inert
  decoration MUST NOT survive this feature.
- **FR-008**: Retrying MUST render exactly as waiting does, with no residue of
  the failure that preceded it.
- **FR-009**: This feature MUST NOT introduce a new stacking position, a new
  colour, a new duration or any literal value; it consumes what
  `001-design-foundations` established.
- **FR-010**: The pending treatment MUST NOT read elapsed time or attempt count
  anywhere it is applied, exactly as on the payer's surface.

### Key Entities

- **Feedback state**: the same closed vocabulary `001-design-foundations`
  defined — `waiting`, `resolving`, `entering`, `leaving`, `retrying`. That
  feature implements the first two. **This feature implements the remaining
  three and applies all five to the back office.** No sixth state is added.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The count of back-office screens that can be pending but show no
  pending treatment is zero.
- **SC-002**: The count of pending states not stated in words is zero, across
  both surfaces.
- **SC-003**: Shown any pending back-office screen for five seconds with the
  wording covered, a person can say it is still working.
- **SC-004**: Opening the same surface twice produces two arrivals a reviewer
  cannot tell apart, and the same holds for departures.
- **SC-005**: The count of surfaces carrying an arrival or departure treatment
  that produces no visible change is zero.
- **SC-006**: With reduced motion requested, no element changes position, size or
  angle during any arrival or departure.
- **SC-007**: A retry's pending state and a first attempt's are indistinguishable
  when compared side by side.
- **SC-008**: The count of literal colour, size, spacing, stacking and duration
  values introduced by this feature is zero.

## Assumptions

- **`001-design-foundations` ships first.** This feature consumes its value layer
  and its pending and outcome treatments. Starting before it lands would mean
  building the same atoms twice.
- **A known content shape wins.** Where a placeholder shape already exists it is
  the pending treatment for that region, and the shared signal is for regions
  that have no shape to promise. This resolves FR-003 without a new decision.
- **Departure is animated for surfaces that overlay the page** — dialogs, sheets,
  pop-overs, menus — because they are large enough that vanishing reads as a
  glitch. Inline elements are removed without a departure treatment; animating
  every unmount in the product is a cost this feature does not take on.
- **The back office reuses the payer's announcement pattern**, screen by screen,
  rather than gaining a global mechanism. A single product-wide announcer is a
  larger change and is not required by anything here.
- **The staged waiting copy is untouched**, as in `001-design-foundations`. This
  feature adds no wording and changes none.

## Out of Scope

- Anything `001-design-foundations` already covers: the value layer, the stacking
  order, the dimming treatment, the shared button and text field, and the payer's
  waiting and outcome treatments.
- Any change to the aesthetic direction, the palette or the spacing scale.
- A product-wide notification or announcement system.
- New pending states, or any sixth member of the feedback vocabulary.
- Loading performance itself: this feature changes how waiting looks, never how
  long it lasts.
