# Bug Assessment: the admin's dropdown popup is unbounded, so a long list is unreachable

- **Slug**: bank-picker-unreachable
- **Created**: 2026-09-18
- **Source**: pasted text (product creator, in session). No URL supplied, so the
  URL Trust Policy did not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: critical

> **Scope note (2026-09-18).** This assessment replaces a first, wider pass
> which folded two things together: this defect and a new searchable control
> for the bank field. The creator asked for them split. What stays here is the
> defect — a dropdown that cannot be scrolled. The searchable picker is a
> feature and is specified at `specs/007-searchable-picker/`.

## Report (verbatim or summarized)

> "when I try to enter the CLABE the dropdown does not let me go down or scroll
> to find the bank"

## Symptom

Opening a dropdown in the ISP panel paints a list taller than the window with no
scroll container of its own, and the page behind it is held still, so every item
below the fold is unreachable — by wheel, by trackpad and by dragging. Expected:
a dropdown never grows past the window, and a list that does not fit scrolls
inside it.

It was reported on **Banco** in *Configuración → Pago directo*, which is where it
bites: that list holds the 97 names of the provider vocabulary, and it is the
only list in the panel long enough to overflow a normal window. But the defect
belongs to the shared dropdown, not to the bank — every long list in the panel
has it, present and future.

## Reproduction

1. Sign in as the owner of a business and open `/settings/direct-payment`.
2. Type a CLABE whose first three digits are not among the 34 mapped in
   `PREFIX_TO_BANK`, so the bank is not pre-selected and must be picked by hand.
3. Open **Banco**.
4. Try to reach a name near the end of the alphabet (SANTANDER, SCOTIABANK, STP).
5. Nothing scrolls — neither the list nor the page behind it.

Measured in Chromium at 1280×720 on the code as it stood: the popup's own box
opened at **y = −3,134px** (3,134 pixels above the top of the window) and
reported `scrollHeight === clientHeight` — there was no scroll container at all.

## Suspected Code Paths

- `apps/admin/src/components/ui/select.tsx:39` — `SelectContent`. It sets
  `overflow-hidden` on the Radix content and gives it **no maximum height**, so
  the popup grows to the full height of its items. Radix's Viewport is
  `overflow: hidden auto` inside `flex: 1`: it can only scroll within a parent
  whose height is bounded, and nothing here bounds it. shadcn's own recipe
  carries `max-h-(--radix-select-content-available-height)`; this copy dropped it.
- Radix Select locks body scroll while open, which is why the page behind the
  list does not move either — hence "no way down at all" rather than "awkward".
- `apps/admin/src/features/settings/SettingsScreen.tsx` — where it was reported.
- `apps/api/src/direct-payments/clabe.ts:8` — `PREFIX_TO_BANK` maps 34 prefixes
  against 97 banks, so picking by hand is the common path, not the exception.
  This is what turns a scrolling defect into a blocked configuration.
- Not affected: `apps/pago` renders a native `<select>` on purpose
  (direct-payment D16) and gets the OS picker, which scrolls itself. The payer's
  page never had this defect.

## Root Cause Hypothesis

**Confidence: high, and measured.** The shared `SelectContent` never bounds the
popup's height, so Radix's scrollable viewport has no bounded parent to scroll
inside and the popup simply overflows the window, while Radix's own scroll lock
holds the page still. Any list taller than the window is affected; the bank list
is the one that is, and a business that cannot choose its bank cannot open the
SPEI channel at all.

## Proposed Remediation

**Preferred**: bound the popup in `apps/admin/src/components/ui/select.tsx`.
Give the content `max-h-[var(--radix-select-content-available-height)]` — the
space Radix has already computed after collision handling — and let the viewport
scroll inside it. One change, at the one place every dropdown in the panel comes
from, so the class of defect is closed rather than one instance of it.

**Alternatives**:
- Cap the height with a fixed number instead of the available-height variable.
  Simpler to read, but wrong near the bottom of a short window: the popup would
  still be allowed to run past the edge.
- Fix it at each call site. Three or four copies of the same rule, and the next
  dropdown added would not have it.

**Files likely to change**:
- `apps/admin/src/components/ui/select.tsx`
- `tests/e2e/` — a new or extended browser spec

**Tests to add or update**:
- Browser layer: an open dropdown's popup has a real maximum height — one that
  resolves to a finite length no taller than the window — and it stays inside
  the window. happy-dom applies no stylesheet and reports no layout, so this is
  the only layer that can answer it (constitution IV).
- The guard must assert the *rule*, not one long list: after the searchable
  picker lands (`specs/007-searchable-picker/`), the bank list leaves the
  dropdown and no screen in the panel renders a list long enough to overflow.
  A test written against a specific long list would quietly stop proving
  anything; a test that reads the popup's computed maximum height keeps proving
  it on any dropdown.

## Risks & Considerations

- `--radix-select-content-available-height` is only published when the content
  is positioned as a popper with collision handling on. `SelectContent` already
  passes `position="popper"` and does not disable collisions.
- Bounding the popup changes how every dropdown in the panel paints. The browser
  layer's motion suite already exercises the Select opening and closing, so a
  regression in the arriving/departing vocabulary would surface there.
- No API, schema, contract or migration is touched.

## Open Questions

- None blocking. `PREFIX_TO_BANK` covering 34 of 97 banks is why the hand pick
  is common; widening it is a separate change and a separate decision.
