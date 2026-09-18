# Bug Fix: the bank picker cannot be scrolled, so most banks are unreachable

- **Slug**: bank-picker-unreachable
- **Fixed**: 2026-09-18
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The shared `SelectContent` never bounded the popup's height, so a long list grew
past the window with nothing to scroll inside — measured at **3,134px above the
top of the viewport**, with Radix's scroll lock holding the page still behind
it. The popup is bounded now, and the bank — 97 names, the one list long enough
for this to block a configuration — got the control the creator asked for: a
combobox whose field is its own search box.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/admin/src/components/ui/combobox.tsx` | added | The searchable picker. ARIA 1.2 combobox with a listbox popup; commits only a name from the vocabulary it was given |
| `apps/admin/src/components/ui/select.tsx` | modified | The defect itself: the popup takes `--radix-select-content-available-height` and the viewport scrolls. Every long Select in the admin is covered |
| `apps/admin/src/components/ui/popover.tsx` | modified | Exports `PopoverAnchor` — the combobox's field stays a field and keeps the keyboard, so it anchors rather than triggers |
| `apps/admin/src/lib/banks.ts` | added | `BANK_OPTIONS`: the generated vocabulary sorted once for the three screens that offer it, instead of three copies of the same sort |
| `apps/admin/src/features/settings/SettingsScreen.tsx` | modified | The ISP's own bank is a combobox |
| `apps/admin/src/features/credit/CreditCard.tsx` | modified | The top-up's bank, same control |
| `apps/admin/src/features/operator/OperatorScreen.tsx` | modified | The platform's bank, same control |
| `packages/ui/src/components/input.tsx` | modified | `InputProps` extends `ComponentProps<"input">` so a `ref` travels with the rest; a second copy of the field recipe to get one would be drift (constitution VI) |
| `apps/admin/test/bank-picker.test.tsx` | added test | 9 component tests, cited `bug: bank-picker-unreachable` |
| `tests/e2e/bank-picker.spec.ts` | added test | 3 browser tests — the geometry happy-dom cannot measure |
| `tests/e2e/stubs.ts` | modified | A `/settings` stub whose CLABE prefix is deliberately unmapped, so the bank has to be picked by hand |
| `apps/admin/test/identity-round.test.tsx` | modified test | The seeded name is the field's value now, not text beside it |
| `tests/passkey/identity-journey.spec.ts` | modified test | Same, in the passkey journey |

## Diff Highlights

The defect, in one class list:

```diff
-  "z-dropdown min-w-[var(--radix-select-trigger-width)] overflow-hidden …"
+  "z-dropdown max-h-[var(--radix-select-content-available-height)] min-w-… overflow-hidden …"
-  <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
+  <SelectPrimitive.Viewport className="max-h-72 overflow-y-auto">{children}</SelectPrimitive.Viewport>
```

The rule that keeps the combobox honest — a field that only ever shows a name
the provider knows:

```ts
/* Closing always restores the committed name. */
function close() {
  setOpen(false);
  setQuery(value);
}
```

## Tests Added or Updated

- `apps/admin/test/bank-picker.test.tsx` — the whole vocabulary is offered; typing
  narrows to the match; the match ignores case and accents (`méxico` → BBVA
  MEXICO, CITI MEXICO); names that *start* with the query come first; no match
  says so and commits nothing; a keyboard choice is what gets saved; Escape and
  leaving the field both restore the committed name; `axe` passes on the open
  list and the highlighted option is named by `aria-activedescendant`.
- `tests/e2e/bank-picker.spec.ts` — the popup is inside the window; it really
  scrolls and VOLKSWAGEN (last in the sorted vocabulary) is reachable; typing
  reaches SCOTIABANK with no scrolling at all.

## Local Verification

- `node scripts/spec-lint.mjs` → ✔ 64 test files checked
- `node scripts/gen-banks.mjs --check` → ✔ 97 banks, the constant in step
- `node scripts/contrast-lint.mjs` → ✔ 34 pairs in both themes at AA
- `node scripts/pending-lint.mjs` → ✔ 26 labels, every one inside a pending region
- `pnpm -r --if-present typecheck` → ✔ four workspaces
- `pnpm -r --if-present test` → ✔ 727 tests (api 436, admin 190, pago 51, ui 50)
- `pnpm exec playwright test` → ✔ 64 browser tests
- `pnpm -r --if-present build` → ✔

## Deviations from Assessment

- The assessment left the e2e layer as "tests to add"; the browser spec needed a
  `/settings` stub that `stubAdminApi` did not have, so `tests/e2e/stubs.ts`
  grew one. It is a fixture, not a behaviour change.
- The `axe` run in the component test is scoped to the popup rather than
  `document.body`, which is this repo's usual scope. Radix portals the popup to
  the document root, where axe's `region` rule reports **every** overlay in the
  app for sitting outside the page's landmarks — the date range popover would
  report the same. The field's own ARIA is asserted directly in the same test,
  so nothing is waved through.
- Radix gives its popover content `role="dialog"`. The combobox overrides it to
  `presentation`: `axe` caught the unnamed dialog, and a dialog wrapping a
  listbox is what a screen reader would announce instead of the options.

## Follow-ups

- The picker cannot *clear* a bank once one is committed — neither could the
  Select it replaces, so this is parity, not a regression. If clearing is ever
  wanted it is a product decision (what an ISP with no bank means), not a
  component change.
- `PREFIX_TO_BANK` maps 34 of the 97 banks (`apps/api/src/direct-payments/clabe.ts`).
  Widening it would pre-select the bank for more ISPs and make the hand pick
  rarer still. Separate change, separate decision.
- The payer's page keeps its native `<select>` (direct-payment D16) — the OS
  picker on a phone, with type-ahead and momentum scrolling the payer already
  has configured. It never had this defect.
