# Feature Specification: design-foundations

**Feature Branch**: `claude/new-session-1cpf5p`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "Consolidate the visual system every screen of Devolada already builds on, close the three places where screens improvise, and give waiting a language."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The payer can see the page is still working (Priority: P1)

A customer transfers money, uploads the receipt, and waits for the transfer to
be validated. The wait can be two minutes or six hours. Today the page tells
them so in words and then holds perfectly still, which is indistinguishable
from a page that has died. This story gives waiting a visible language: while
something is pending the screen breathes — a calm, slow change that says work
is in progress — and when the outcome finally arrives, confirmed or refused, it
fades in unhurried instead of appearing between two blinks.

**Why this priority**: it is the only story a customer ever experiences, and it
lands on the screen where they are most anxious and least able to ask anyone.
Everything else in this feature is a benefit to the people building the product.

**Independent Test**: put a person in front of the payment page with a pending
validation, cover the text, and ask whether the page is still working. Then let
the outcome arrive and ask whether they noticed it. Neither question needs any
other part of this feature to be built.

**Acceptance Scenarios**:

1. **Given** a transfer is pending validation, **When** the customer looks at
   the page with the wording covered, **Then** they can tell that the page is
   still working.
2. **Given** a transfer has been pending for six hours, **When** the customer
   compares the page with how it looked at minute two, **Then** the movement is
   identical — the waiting signal never grows more insistent as time passes.
3. **Given** a validation resolves, **When** the outcome appears, **Then** it
   arrives gradually rather than snapping into place, and it does not bounce,
   pop or celebrate — whether the answer is confirmation or refusal.
4. **Given** a customer who has asked their device for reduced motion,
   **When** a validation is pending, **Then** nothing on the page slides,
   grows, shrinks or rotates, **And** the page still does not read as frozen.
5. **Given** a customer using a screen reader, **When** a validation is
   pending, **Then** the state is available as words, not only as movement.

---

### User Story 2 - Overlapping surfaces behave as one system (Priority: P2)

Dialogs, sheets, confirmations, dropdowns and pop-overs each decide today how
far in front they sit and how much they dim the page behind them. Three
different dimming treatments already exist for the same job. This story gives
the product a single named stacking order that every overlapping surface takes
its position from, and one dimming treatment they all share.

**Why this priority**: it is invisible when correct and embarrassing when
wrong — a confirmation that opens behind the sheet that summoned it, or three
shades of grey across three dialogs in the same session. It is also the
cheapest of the three to verify.

**Independent Test**: open every overlapping surface in both light and dark,
and confirm that each sits where the order says and that the page behind is
dimmed identically every time.

**Acceptance Scenarios**:

1. **Given** any two overlapping surfaces open together, **When** they are
   compared, **Then** the one in front is the one the named order places in
   front — never the one that happened to be written last.
2. **Given** a dialog, a sheet and a confirmation, **When** each is opened in
   turn in the same theme, **Then** the page behind is dimmed identically in
   all three.
3. **Given** the dark theme, **When** each of those surfaces is opened,
   **Then** the dimming is the one designed for dark, not the light one reused.
4. **Given** a new overlapping surface is added later, **When** it is placed,
   **Then** it takes an existing named position or a new named one is added —
   it never invents an unnamed one.

---

### User Story 3 - One button, one field, three sizes (Priority: P3)

The button and the text field are each defined twice today — once for the
customer's payment page and once for the back office — with different names for
the same variants and different heights for the same job. A change to either
has to be made twice, and the two have already drifted. This story reduces each
to one definition offered in three declared sizes: compact for the dense back
office, standard for touch, and decisive for the charge path.

**Why this priority**: it costs the customer nothing today and the developer
every time. It is real, it is bounded, and it can wait behind the two stories
that change what someone sees.

**Independent Test**: delete the duplicate definition and confirm that every
screen in the back office renders unchanged.

**Acceptance Scenarios**:

1. **Given** a button anywhere in either surface, **When** its definition is
   traced, **Then** it comes from the single shared definition.
2. **Given** the three declared sizes, **When** a screen needs a button,
   **Then** it picks one of the three — it does not specify its own height.
3. **Given** the back office at its compact size, **When** a person points at a
   control with a mouse or a finger, **Then** the target still meets the
   accessibility floor the product commits to.
4. **Given** the charge path, **When** the decisive action is shown, **Then**
   it keeps the size it has today, unreduced by the consolidation.

---

### Edge Cases

- **A wait that ends immediately.** A process that resolves faster than a
  person can perceive must not flash the pending signal on and off — the flash
  reads as an error, not as speed.
- **An outcome that arrives while an overlapping surface is open.** The
  resolution must be visible without fighting the surface in front of it.
- **Good news before the final answer.** The service can be restored while the
  transfer is still being confirmed. The page is then simultaneously resolved
  (for the service) and pending (for the confirmation), and both readings must
  stay legible.
- **A retry after a refusal.** Returning to pending from a resolved state uses
  the same waiting language as the first wait, with no residue of the refusal.
- **Reduced motion in the dark theme.** The permitted low-amplitude change must
  remain perceptible against a dark background without becoming a flicker.
- **A tab left in the background for hours.** Returning to the page shows the
  current state, not an animation replaying the wait that was missed.
- **A surface opened while another is already dimming the page.** The page is
  dimmed once, not twice as dark.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST define a named stacking order for overlapping
  surfaces, and every overlapping surface MUST take its position from it.
- **FR-002**: No screen or surface may declare its own stacking position
  outside that order; adding a new position means naming it.
- **FR-003**: Every modal surface — dialog, sheet, confirmation — MUST dim the
  page behind it with one shared treatment, defined separately for light and
  dark.
- **FR-004**: The button MUST have exactly one definition, shared by both
  surfaces, offered in three declared sizes: compact, standard and decisive.
- **FR-005**: The text field MUST have exactly one definition, shared by both
  surfaces.
- **FR-006**: The shared value set MUST make its motion values reachable to the
  screens that consume it, so that changing a motion value changes what renders.
- **FR-007**: The product MUST define a named vocabulary of feedback states —
  waiting, resolving, entering, leaving and retrying — available to both
  surfaces and to any future screen. **This feature implements `waiting` and
  `resolving`**; the remaining three are named here so the vocabulary is closed,
  and are built by `002-feedback-vocabulary-rollout`.
- **FR-008**: While a process is pending, the screen MUST carry a calm,
  continuous signal that work is in progress, recognisable as pending without
  reading any wording.
- **FR-009**: The pending signal MUST NOT rotate or spin on the customer's
  payment page.
- **FR-010**: The pending signal MUST hold one intensity for the whole wait; it
  MUST NOT intensify, accelerate or otherwise escalate as the wait lengthens.
- **FR-011**: The pending signal MUST NOT be the only carrier of the state: the
  same state MUST remain available as words to anyone who cannot perceive the
  motion.
- **FR-012**: An outcome — confirmation or refusal alike — MUST become visible
  gradually rather than instantly, and MUST NOT bounce, overshoot or celebrate.
- **FR-013**: When reduced motion is requested, nothing MUST translate, scale
  or rotate; a low-amplitude change of visibility remains permitted so that a
  working screen never reads as frozen.
- **FR-014**: A pending signal MUST NOT appear for a process that resolves
  faster than the flash threshold defined in Assumptions.
- **FR-015**: Every text and background pair MUST continue to meet the
  product's accessibility contrast floor in both themes.
- **FR-016**: Every screen MUST continue to render at the three reference
  widths with no horizontal scrolling.
- **FR-017**: The feedback vocabulary MUST NOT read the elapsed time or the
  attempt count of any process; a pending state is pending, whatever its age.
- **FR-020**: No screen in either surface may carry a literal duration value.
  The fifteen that exist today MUST be replaced by the shared motion values as
  part of this feature.
- **FR-018**: The shared button definition MUST include the two variants only
  the back office renders today — a destructive action and an inline
  text-link action — so that no surface is left keeping a definition of its own.
- **FR-019**: The change permitted under reduced motion MUST be perceptible as
  continuing activity and yet subtle enough that a person who asked for less
  motion is not drawn to look at it. How far it travels and how slowly are
  chosen by comparing candidates on screen in both themes, not assumed in
  advance.

### Key Entities

- **Stacking position**: a named place in the front-to-back order (for example:
  page content, floating menus, pinned headers, dimmed backdrop, modal
  surfaces, transient notices). Every overlapping surface holds exactly one.
- **Feedback state**: one of waiting, resolving, entering, leaving, retrying.
  Each has a defined appearance and a defined behaviour under reduced motion.
- **Control size**: one of compact, standard, decisive. Each names the context
  it serves rather than a measurement a screen may reinvent.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Shown a pending screen for five seconds with all wording
  obscured, a person can say the page is still working.
- **SC-002**: The pending signal at minute two and at hour six is
  indistinguishable when the two are compared side by side.
- **SC-003**: The outcome takes about four-tenths of a second to become fully
  visible — long enough to be seen arriving, short enough not to delay the
  reading — and a reviewer watching it frame by frame sees no bounce,
  overshoot or size change.
- **SC-004**: With reduced motion requested, no element changes position, size
  or angle anywhere in the product, and a pending screen is still identifiable
  as pending.
- **SC-005**: Every overlapping surface in the product takes its position from
  the named order; a count of surfaces declaring their own position is zero.
- **SC-006**: Screenshots of a dialog, a sheet and a confirmation in the same
  theme show the same dimming; the same holds in the other theme.
- **SC-007**: Each of the button and the text field has exactly one definition
  in the product; removing the former duplicate changes no screen's appearance.
- **SC-008**: A change to any single motion value in the shared set visibly
  changes what renders, in both surfaces.
- **SC-012**: A count of literal duration values written into screens is zero,
  across both surfaces.
- **SC-009**: A pending state is announced in words to assistive technology on
  every screen **on the payer's surface** that can be pending. The back office's
  pending screens are `002-feedback-vocabulary-rollout`'s to cover.
- **SC-010**: Every text and background pair passes the accessibility contrast
  floor in both themes — the standing measurement stays green.
- **SC-011**: Every screen renders at the three reference widths with no
  horizontal scrolling.

## Assumptions

- **The wording of the staged waiting copy is untouched.** The product already
  escalates its honesty in words as a wait lengthens; this feature adds a
  visual layer beneath that and changes none of it.
- **The existing spoken announcement stays.** The payment page already
  announces its pending state to assistive technology; FR-011 is satisfied by
  preserving that, not by inventing a second one.
- **Flash threshold**: a pending signal appears only once a process has been
  running for roughly a fifth of a second, and once shown it stays visible long
  enough to be read rather than vanishing the instant the answer lands. Chosen
  as a common interface default because the description did not specify one.
- **The registered duration debt is paid inside this feature.** Fifteen
  hand-written duration values already in the product are registered as
  technical debt (`unmapped-motion-tokens`). This feature both makes the motion
  values reachable (FR-006) and replaces those fifteen (FR-020), because it
  already has to touch the place where they live and because the product
  otherwise keeps contradicting its own rule in fifteen places. The debt entry
  stays open until its own checks confirm the replacement.
- **The reduced-motion rule is amended, not obeyed as it stands.** The product
  currently flattens every animation when reduced motion is requested. FR-013
  requires carving out a permitted low-amplitude exception; the blanket rule
  otherwise stays.
- **Back-office-only surfaces keep their homes.** Dialogs, sheets, pop-overs,
  tabs and the rest that only the back office renders stay where they live;
  only their stacking and dimming come from the shared system.
- **The aesthetic direction and the palette are fixed.** No colour, typeface or
  spacing value changes in this feature.
- **Both themes and all three reference widths are already verified** by the
  product's standing checks; this feature must keep them green, not establish
  them.

## Out of Scope

- Page layouts and feature-specific components.
- Any change to the aesthetic direction, the palette, the typefaces or the
  spacing scale.
- A density scale for the back office's tables.
- The wording of the staged waiting copy, and the schedule on which it escalates.
- Marketing pages and illustration.
- The internal construction of surfaces only the back office renders — their
  stacking and dimming are in scope, their anatomy is not.
- Implementing the `entering`, `leaving` and `retrying` states, and applying the
  vocabulary to the back office's pending screens. Both belong to
  `002-feedback-vocabulary-rollout` — raised as gaps G2 and G3 by
  `/speckit-analyze` and resolved by splitting rather than by widening this
  feature.
