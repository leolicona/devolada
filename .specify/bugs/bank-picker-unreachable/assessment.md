# Bug Assessment: the bank picker cannot be scrolled, so most banks are unreachable

- **Slug**: bank-picker-unreachable
- **Created**: 2026-09-18
- **Source**: pasted text (product creator, in session)
- **Verdict**: valid
- **Severity**: critical

## Report (verbatim or summarized)

> "when I try to enter the CLABE the dropdown does not let me go down or scroll to
> find the bank, is it feasible a search engine in the same input... that I complete
> according to the coincidence?"

Two things in one message: a defect (the list cannot be scrolled) and a request
(let the same field search the list and complete on the match).

## Symptom

On *Configuración → Pago directo*, opening **Banco** paints a list that is taller
than the window and cannot be scrolled: the banks below the fold are unreachable
by mouse wheel, by trackpad and by dragging, and the page behind it does not
scroll either. Expected: every one of the 97 names in the vocabulary is
reachable, and reachable quickly.

## Reproduction

1. Sign in as the owner of a business and open `/settings/direct-payment`.
2. Type a CLABE whose 3-digit prefix is not in `PREFIX_TO_BANK` (only 34 of the
   97 banks are mapped) — e.g. `0021…` is mapped, `1590…` is not — so the bank
   is not pre-selected and has to be picked by hand.
3. Click **Banco**.
4. The list opens at full height (97 items ≈ 3,400px). Try to reach a name near
   the end of the alphabet (SANTANDER, SCOTIABANK, STP).
5. Nothing scrolls. The only names that can be chosen are the ones that happen
   to fall inside the window.

The same defect is in two more places that render the same picker from the same
vocabulary: *Saldo y recargas → Recargar → Banco desde el que transferiste*, and
the platform operator's bank setting.

## Suspected Code Paths

- `apps/admin/src/components/ui/select.tsx:39` — `SelectContent` sets
  `overflow-hidden` on the Radix content and gives it **no maximum height**. The
  popup therefore grows to the full height of its items. Radix's Viewport is
  `overflow: hidden auto` and `flex: 1`, so it can only scroll inside a parent
  whose height is bounded; here nothing bounds it, so there is no scroll
  container at all. shadcn's own recipe carries
  `max-h-(--radix-select-content-available-height)` plus the two scroll buttons;
  this copy dropped both.
- Radix Select locks body scroll while it is open, which is why the page behind
  the list does not move either — the user is left with no way down at all.
- `apps/admin/src/features/settings/SettingsScreen.tsx:152` — the ISP's bank.
- `apps/admin/src/features/credit/CreditCard.tsx:119` — the top-up's bank.
- `apps/admin/src/features/operator/OperatorScreen.tsx:77` — the platform's bank.
- `apps/api/src/direct-payments/clabe.ts:8` — `PREFIX_TO_BANK` maps 34 prefixes
  out of 97 banks, so the "pick it yourself" path is the common one, not the
  exception. This is what makes a broken picker a blocked configuration.
- Not affected: `apps/pago` renders a native `<select>` on purpose
  (direct-payment D16) and gets the OS picker, with its own scrolling and
  type-ahead. The payer's page has never had this defect.

## Root Cause Hypothesis

**Confidence: high.** The shared `SelectContent` never bounds the popup's
height, so Radix's scrollable viewport has no bounded parent to scroll inside
and the popup simply overflows the window, while Radix's own scroll lock stops
the page from moving. Every long list in the admin has the defect; the bank list
is where it bites, because it is the only list with 97 entries and because the
CLABE prefix map covers barely a third of them, so picking by hand is the normal
path. The consequence is not cosmetic: a business that cannot set its bank
cannot turn the SPEI channel on, and one that picks the wrong nearby name gets
`invalid` from apiCEP on every payment, silently (banks.ts, measured
2026-08-19).

## Proposed Remediation

**Preferred**: two changes, one for the defect and one for the request.

1. Bound the popup in `SelectContent`: `max-h-[var(--radix-select-content-available-height)]`
   with `overflow-y-auto` on the viewport, so any long Select in the admin
   scrolls within the space the popup actually has. This is the defect's fix and
   it covers the timezone picker and any future list for free.

2. Give the bank its own control: a **combobox** — the field *is* the search box.
   The name is typed into the same input, the list filters on the match
   (case- and accent-insensitive, names that start with what was typed first),
   arrows move, Enter chooses. 97 names is past where scanning a list works at
   all; the creator asked for exactly this and it is the right control for a
   vocabulary this size. It replaces the Select in the three admin places that
   pick a bank, so the control does not behave differently in three screens.

   The combobox commits **only** a name from the vocabulary: on blur, Escape or
   Tab the field returns to the committed choice. A half-typed query must never
   be left looking like a selection — `beneficiary.bank` travels on every
   validation the business ever runs, and a name apiCEP does not know reads
   exactly like a transfer that never happened (banks.ts, direct-payment D16).

**Alternatives**:
- Cap the popup height and stop there. Fixes the defect, leaves 97 items to be
  scanned by eye — the creator's request goes unanswered.
- Put a search box *inside* the Select popup. Radix Select's own type-ahead
  competes for the keystrokes and the workaround is fragile; it also is not
  "the same input", which is what was asked for.
- Give the payer's page the combobox too. Rejected: the native picker is the OS
  picker on a phone, with type-ahead and momentum scrolling already configured
  by its owner (direct-payment D16), and it adds nothing to a public page whose
  load time sits on a payment's critical path.

**Files likely to change**:
- `apps/admin/src/components/ui/combobox.tsx` (new)
- `apps/admin/src/components/ui/select.tsx`
- `apps/admin/src/components/ui/popover.tsx` (export the anchor)
- `apps/admin/src/features/settings/SettingsScreen.tsx`
- `apps/admin/src/features/credit/CreditCard.tsx`
- `apps/admin/src/features/operator/OperatorScreen.tsx`
- `apps/admin/test/bank-picker.test.tsx` (new)
- `apps/admin/test/identity-round.test.tsx`, `apps/admin/test/credit.test.tsx`
- `tests/passkey/identity-journey.spec.ts`, `tests/e2e/` (the browser layer owns
  the height the popup actually gets)

**Tests to add or update**:
- Every bank in the vocabulary is reachable: type a fragment, the matching names
  are the options offered.
- The match is accent- and case-insensitive, and names that *start* with the
  query come first.
- A query that matches nothing says so and commits nothing.
- Blur, Escape and Tab restore the committed name — a typed fragment is never
  left in the field as if it had been chosen.
- The CLABE prefix still seeds the field (D5/BUG-007 must not regress), and a
  hand pick still wins over the prefix.
- Browser layer: the popup is bounded by the window and its list scrolls —
  happy-dom reports no layout, so only Playwright can answer this one
  (constitution IV).

## Risks & Considerations

- The Radix Select trigger already answers to `role="combobox"`; the new control
  puts that role on a real `<input>`, so the tests that read the picker's chosen
  name move from `toHaveTextContent` to `toHaveValue`. The e2e and passkey specs
  that assert the picked bank move with them.
- The vocabulary is generated (`scripts/gen-banks.mjs`, constitution III): the
  picker reads `BANKS`, it does not restate it. `gen-banks --check` must stay
  green.
- `axe` runs on every rendered admin screen: the combobox has to carry the ARIA
  pattern (`aria-expanded`, `aria-controls` only while open, `aria-activedescendant`,
  `role="option"`), or the a11y suite fails.
- No API, schema or migration is touched. The saved value is the same string
  from the same vocabulary.

## Open Questions

- None blocking. `PREFIX_TO_BANK` covering 34 of 97 banks is the reason the
  hand-pick path is common; widening it is a separate change, and the combobox
  makes the hand pick cheap either way.
