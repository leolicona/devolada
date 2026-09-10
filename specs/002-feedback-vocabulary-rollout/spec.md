# Feature Specification: feedback-vocabulary-rollout

**Feature Branch**: `claude/002-feedback-vocabulary-rollout`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "resolver G2 y G3" — the two coverage gaps `/speckit-analyze` found in `001-design-foundations`: three of the five named feedback states have no implementation, and the pending announcement reaches only one of the product's two surfaces.

**Amended 2026-09-10**: "include finding I2 in feature 002 — align `StatusBadge` with the new size vocabulary." I2 is the inconsistency the same analysis found in the shared components: `001-design-foundations` gave every control one way to ask for a size, and the status badge kept its own. Added here as User Story 4.

## Clarifications

### Session 2026-09-10

- Q: Which waits in the back office must show the pending treatment — only a
  screen loading its data, or also every action the operator starts and waits
  for? → A: Both. A screen's first load, plus every action the operator starts
  and then waits for (save, delete, invite, retry). A refresh the operator did
  not start stays silent. (FR-001, SC-001, SC-011)
- Q: Should the placeholder shape keep its own pulse, or breathe like everything
  else that waits? → A: It breathes. One waiting movement exists in the product,
  built from tokens, and the placeholder inherits the reduced-motion exception
  that keeps waiting alive — closing a live defect where it freezes today.
  (FR-003, FR-004, FR-014, SC-012)
- Q: When the operator clicks "Reintentar", should the icon keep spinning, or
  should the retry wait the way every other action does? → A: It waits the same
  way. The turning icon is removed rather than hidden from one surface, leaving
  one waiting movement in the product with no exception to remember. The word
  "Cargando…" is untouched. (FR-008, SC-013)
- Q: How many times should a screen reader hear about a wait on a screen that is
  pending in more than one place at once? → A: Once each, split by who started
  it. A screen's load is announced by the screen, naming what is loading; an
  action the operator started is announced at the control they used. A pending
  region nested inside one that already announces stays silent — the pattern
  `001-design-foundations` proved on the payer's page. (FR-002, SC-002)

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

### User Story 4 - One name for a size, everywhere (Priority: P4)

`001-design-foundations` gave the product a single way to ask for a size: a
screen names the context it serves — the dense back office, a thumb, the one
committing action — and never states a height. The button speaks it and the text
field speaks it. The status badge, which is the product's only representation of
an outcome, still asks for `sm` or `md`.

**Why this priority**: nothing is broken today, so it waits behind the three
stories that fix something. It belongs in this feature all the same. This
feature's subject is the back office speaking one feedback language, and a
status is feedback — a badge that names its size differently from the button
beside it is the same drift, one component further along.

**Independent Test**: read every place in the product that asks for a size and
confirm each one names a context. Needs nothing from the other three stories.

**Acceptance Scenarios**:

1. **Given** any screen that shows a status, **When** it asks for a size,
   **Then** it names a context from the shared vocabulary.
2. **Given** the shared components read together, **When** their sizes are
   listed, **Then** no component declares a size name of its own.
3. **Given** a screen showing a status before this story and after it,
   **When** the two are compared, **Then** they are identical: the names
   changed and nothing anyone sees did.
4. **Given** a size name the vocabulary does not contain, **When** a screen
   tries to use it, **Then** the attempt is rejected before that screen can
   ship.

---

### Edge Cases

- **A screen that is pending in two places at once.** A list loading while a
  setting saves must not read as one large indeterminate page, and must not
  speak twice: the load belongs to the screen, the save belongs to its button.
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
- **The same status shown on both surfaces.** A badge takes its size from the
  surface it sits on, never from the status it reports.
- **A background refresh while the operator is reading.** The screen stays
  still. A wait nobody started never becomes a signal, however long it runs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every wait the operator is having MUST carry the shared pending
  treatment defined by `001-design-foundations` — a screen loading its data for
  the first time, and every action the operator starts and then waits for: a
  save, a delete, an invitation, a retry. A refresh the operator did not start —
  a refetch when the tab regains focus, a background poll — MUST NOT show one.
  A signal belongs to a wait somebody is having.
- **FR-002**: Every pending state in the back office MUST be stated in words to
  assistive technology, and stated once. A screen's load is announced by the
  screen, naming what is loading; an action the operator started is announced at
  the control they used. A pending region nested inside one that already
  announces MUST stay silent.
- **FR-003**: A region whose content has a known shape MUST show that shape while
  pending; a region without one MUST show the shared pending treatment. The two
  MUST NOT be applied to the same region at once. Either way the movement is the
  same one: a placeholder shape breathes at the shared rhythm rather than
  carrying a rhythm of its own.
- **FR-004**: Neither a screen nor a component may invent its own pending
  treatment. Exactly one waiting movement exists in the product, and its
  duration and easing come from tokens.
- **FR-005**: Arriving and departing MUST each have exactly one definition,
  shared by every surface in both surfaces of the product.
- **FR-006**: Arriving and departing MUST change visibility only. Nothing may
  translate, scale or rotate, in either theme, with or without reduced motion.
- **FR-007**: A surface carrying an arrival or departure treatment that has no
  effect MUST either be given a working one or have it removed. An inert
  decoration MUST NOT survive this feature.
- **FR-008**: Retrying MUST render exactly as waiting does, with no residue of
  the failure that preceded it and no movement of its own. Nothing rotates: the
  turning icon on the retry control is removed outright, not merely kept off the
  payer's surface. The wording it sits beside does not change.
- **FR-009**: This feature MUST NOT introduce a new stacking position, a new
  colour, a new duration or any literal value; it consumes what
  `001-design-foundations` established.
- **FR-010**: The pending treatment MUST NOT read elapsed time or attempt count
  anywhere it is applied, exactly as on the payer's surface.
- **FR-011**: Every shared component that offers a size MUST name it from the
  control-size vocabulary `001-design-foundations` defined. No component may
  declare a size name of its own.
- **FR-012**: A component takes the vocabulary's names, not its heights. A
  status is read, never aimed at, so it carries no touch-target obligation and
  keeps the dimensions it has today. Adopting the vocabulary MUST NOT change
  what anyone sees.
- **FR-013**: A component MUST offer only the sizes it actually serves. A member
  of the vocabulary that has no context in that component is left out, not
  filled in for symmetry.
- **FR-014**: Under reduced motion every pending treatment MUST keep moving. A
  pending region that freezes is a defect, not a concession — a frozen waiting
  screen reads as a dead one. This closes a live gap rather than describing the
  status quo: the placeholder shape freezes today.

### Key Entities

- **Feedback state**: the same closed vocabulary `001-design-foundations`
  defined — `waiting`, `resolving`, `entering`, `leaving`, `retrying`. That
  feature implements the first two. **This feature implements the remaining
  three and applies all five to the back office.** No sixth state is added.
- **Control size**: the named contexts `001-design-foundations` defined —
  `compact` for the dense back office, `standard` for touch, `decisive` for the
  charge path's committing action. A screen names one; it never states a height.
  This feature adds no fourth. It finishes applying the three.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The count of operator-initiated waits in the back office that show
  no pending treatment is zero — a screen's first load and a started action
  count alike.
- **SC-002**: The count of pending states not stated in words is zero across
  both surfaces, and so is the count of waits announced more than once.
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
- **SC-009**: The count of size names used anywhere in the product that are not
  members of the shared vocabulary is zero, across both surfaces.
- **SC-010**: Every screen that shows a status renders identically before and
  after this feature, compared image against image.
- **SC-011**: The count of pending treatments that appear during a refresh the
  operator did not start is zero.
- **SC-012**: With reduced motion requested, the count of pending regions that
  stop moving is zero.
- **SC-013**: The count of elements that rotate, spin or bounce is zero, across
  both surfaces.

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
- **The placeholder shape gets calmer.** Adopting the shared rhythm makes its
  dip shallower than today's and a little slower. That is accepted: one waiting
  movement across the product is worth more than the extra contrast, and the
  shape itself already says "pending" before any movement does.
- **Aligning the badge means renaming, not resizing.** The vocabulary names
  contexts, and the badge already serves the right two — the dense back office
  and the payer's touch surface. Only its words were wrong. Giving it the
  vocabulary's heights as well would grow every badge sitting in a table row,
  a visual change nothing here asks for.
- **The rename reaches the payer's call sites and changes nothing there.** Six
  places on the payer's page pass the old name today. They must pass the new one
  or two vocabularies stay alive, which is the drift itself. This is the single
  part of the feature that edits a file outside the back office, and it edits a
  word rather than a pixel.

## Out of Scope

- Anything `001-design-foundations` already covers: the value layer, the stacking
  order, the dimming treatment, the shared button and text field, and the payer's
  waiting and outcome treatments.
- Any change to the aesthetic direction, the palette or the spacing scale.
- A product-wide notification or announcement system.
- New pending states, or any sixth member of the feedback vocabulary.
- Loading performance itself: this feature changes how waiting looks, never how
  long it lasts.
- Any change to what a status badge looks like, which statuses exist, or how
  they are worded in Spanish.
- A fourth control size, or extending an existing one to a component that has no
  context for it.
