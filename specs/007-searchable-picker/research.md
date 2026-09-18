# Research: searchable-picker

**Date**: 2026-09-18 | **Plan**: [plan.md](./plan.md)

The Technical Context carried no NEEDS CLARIFICATION. What follows are the
decisions the design rests on, numbered so the code can cite them
(`searchable-picker D<n>`, constitution I).

---

## D1 — The control is a combobox: the field itself is the search box

**Decision**: An editable field with a filtered listbox below it. Typing into the
field is the search.

**Rationale**: 97 names is past where a list is read. The creator asked for the
search to live "in the same input", and that is also the shape that answers the
real question: an ISP knows their bank's name, so the shortest path is typing it.
Measured against the vocabulary and D2's ranking: every bank reaches the visible
rows within **4 characters**, and 76 of the 97 within one.

**Alternatives considered**:
- *A search box inside the existing dropdown's popup.* The dropdown's own
  type-ahead competes for the keystrokes, and it is not "the same input".
- *Native `datalist`.* No control over matching or ranking, and its presentation
  is the browser's, outside the product's tokens.
- *Leave the list and only make it scroll.* That is the bug
  (`bug: bank-picker-unreachable`), and fixing it leaves 97 names to be scanned.

---

## D2 — Matching is substring, accent- and case-insensitive, with names that start with the query first

**Decision**: Normalise both sides (decompose, drop combining marks, lowercase)
and keep every name that contains the query. Order them: names that *start* with
the query, then names that merely contain it, each group in reading order.

**Rationale**: Mexican keyboards produce accents that the vocabulary does not
carry ("méxico" must find BBVA MEXICO). Contains-matching finds a bank whose
distinguishing word is not its first ("mexico" finds both MEXICO names).
Starts-with-first stops the common case from being buried: typing "ban" should
open on BANAMEX, not on the first name that happens to contain those letters.

**Alternatives considered**:
- *Prefix-only matching.* Cheaper, but loses every bank whose memorable word is
  not first.
- *Fuzzy matching.* Tolerates typos, at the cost of offering names nobody typed —
  dangerous for a field where the wrong nearby name fails payments silently.

---

## D3 — Only a name from the vocabulary commits; every exit restores the chosen one

**Decision**: Cancelling, moving focus away, and moving to the next field all put
the last chosen name back in the field. A typed fragment is never left sitting
there, and is never savable.

**Rationale**: This is the safety rule, not a nicety. The chosen name travels as
the beneficiary's bank on every validation the business ever runs, and the
provider answers `invalid` — never an error — for a name it does not know, which
reads exactly like a transfer that never happened (`banks.ts`, measured
2026-08-19; `direct-payment D16`). A field that can be left holding "banor"
looks, to the person who typed it, exactly like a field holding BANORTE.

**Alternatives considered**:
- *Commit the highlighted name when the field is left.* Standard in some
  comboboxes, and wrong here: it turns "I changed my mind and tabbed away" into a
  saved bank nobody chose.
- *Allow free text.* The failure it invites is the one this vocabulary exists to
  prevent (`BUG-007`).

---

## D4 — Sitting on the chosen name is not a search

**Decision**: When the field's text still equals the name last chosen, the list
offers the whole vocabulary rather than filtering down to that one name.

**Rationale**: Opening a picker to change your mind should show the choices, not
the choice you already made. Filtering on the committed name would open a
one-item list and make the next bank feel unreachable — the very feeling this
feature removes.

---

## D5 — The popup is anchored to the field and rendered outside it

**Decision**: Position the list against the field as an anchor, in a layer at the
document root, with collision handling; the field stays a field and keeps focus.

**Rationale**: The top-up form sits inside scrolling containers, and a list
rendered as a sibling would be clipped by them. Anchoring also gives the popup
the space it actually has, which is what `bug: bank-picker-unreachable` was
about: a list that does not know the window's edge runs past it.

**Alternatives considered**:
- *An absolutely positioned element inside the form.* Simpler, and clipped.

---

## D6 — The popup wrapper is presentational; the list inside carries the meaning

**Decision**: The layer that holds the list is announced as nothing. The list is
a listbox, its rows are options, and the field points at them.

**Rationale**: The popover layer defaults to being announced as a dialog. A
dialog wrapping a list is what a screen reader would read out instead of the
options, and an unnamed one is an accessibility defect in its own right — `axe`
reports it, and `axe` runs on every panel screen.

---

## D7 — The control lives in the panel, not in the shared package

**Decision**: `apps/admin/src/components/ui/combobox.tsx`, built from the shared
`Input` atom.

**Rationale**: Constitution VI reserves `packages/ui` for an atom *both* surfaces
render. Only the panel renders this one, and by D8 the payer's page must not.
Publishing it as shared would offer a picker that one of the two surfaces is
forbidden to use. Building it *from* the shared `Input` keeps the text-field
recipe defined once, which is the other half of the same principle.

---

## D8 — The payer's public page keeps the picker it has

**Decision**: `apps/pago` is untouched.

**Rationale**: On a phone the native control is the operating system's own
picker, with type-ahead and momentum scrolling the payer has already configured,
including whatever assistive behaviour they use. It costs the page nothing, and
that page's load time sits on the critical path of a payment (`direct-payment
D16`). The defect was never there.

---

## D9 — The list opens on a click, on typing and on the arrow keys, never on focus

**Decision**: Focus alone does not open the list.

**Rationale**: Tabbing through a form would otherwise leave a list hanging open
behind the next field, and on a form with four fields that is three lists too
many.

---

## D10 — Clearing a chosen bank is out of scope

**Decision**: Once a name is chosen, the field offers no way back to none.

**Rationale**: The control this replaces could not clear one either, so nothing
is lost. Whether a business should be able to un-set its bank — and what the SPEI
channel should then say — is a product question with its own consequences, and
inventing an answer inside a picker is the wrong place to decide it.
