# Quickstart: validating design-foundations

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

How to prove this feature works, in the order a reviewer should check it. Each
block names what it answers and what "correct" looks like. Details of values and
component APIs live in [contracts/](./contracts/) — they are not repeated here.

## Prerequisites

```bash
pnpm install
```

Chromium is already provisioned for Playwright in this environment; do not run
`playwright install`.

## 1. The payer's wait (User Story 1)

```bash
pnpm --filter @devolada/pago dev
```

With a validation pending:

- Cover the wording. The page still reads as working → **SC-001**.
- Leave it pending and compare against a screenshot taken minutes earlier. The
  signal is identical → **SC-002**, FR-010.
- **Settle the breath here** (FR-019, research R3, task T047). The shipped pair
  is candidate A — `1 → 0.70` over `2.4s`. Look at it in both themes at a
  phone-sized viewport, once with reduced motion on and once off, and judge it
  against the waiting copy beside it rather than against the other candidates.
  Too insistent or too faint → change `--opacity-breath` and
  `--duration-breath` in `tokens.css` and record the new pair in
  `contracts/design-tokens.md` §3. **This remains a merge gate**: the pair
  ships confirmed by eye, on this screen, or it does not ship.
- Let the outcome land. It arrives over roughly four tenths of a second, with no
  bounce, no scale → **SC-003**, FR-012.
- Trigger a refusal. The motion is the same as for a confirmation → FR-012.

Then in the browser's rendering settings, force `prefers-reduced-motion: reduce`
and repeat:

- Nothing translates, scales or rotates anywhere → **SC-004**, FR-013.
- The pending screen still does not read as frozen → FR-013.

## 2. Overlapping surfaces (User Story 2)

```bash
pnpm exec playwright test --config playwright.review.config.ts
```

Review the captures for dialog, sheet and confirmation in both themes:

- The dimming is identical across all three, per theme → **SC-006**, FR-003.
- A confirmation opened from a sheet lands in front of it → FR-001.
- No surface declares its own stacking value:

```bash
grep -rn "z-\[\|z-[0-9]" apps packages --include="*.tsx" | grep -v node_modules
```

**Correct**: no output → **SC-005**, FR-002.

## 3. One button, one field (User Story 3)

```bash
pnpm --filter @devolada/admin typecheck
pnpm --filter @devolada/admin test
```

- `apps/admin/src/components/ui/button.tsx` and `input.tsx` no longer exist, and
  nothing imports them → **SC-007**, FR-004, FR-005.
- Back office screens render unchanged against the review captures taken before
  the merge.
- The charge path's decisive action is unchanged in size → User Story 3,
  scenario 4.

## 4. The debt is paid (FR-020, SC-012)

The two checks from `.specify/debt/unmapped-motion-tokens/debt.md`:

```bash
grep -rn "duration-[0-9]" apps packages --include="*.tsx" | grep -v node_modules
grep -n "var(--duration-" packages/ui/src/styles/index.css
```

**Correct**: the first prints nothing, the second prints the mapping. Then close
the entry with `/speckit-debt-pay unmapped-motion-tokens` — it re-runs these
against the tree rather than taking anyone's word.

Also confirm the values now govern → **SC-008**: change `--duration-slow` in
`tokens.css` to something absurd (2000ms), reload, watch the outcome crawl,
change it back.

## 5. Standing gates (must stay green)

```bash
node scripts/spec-lint.mjs        # every new test cites its story (constitution VII)
node scripts/contrast-lint.mjs    # 34 pairs, both themes  → SC-010
pnpm e2e                          # includes contrast, keyboard, responsive → SC-011
```

`pnpm e2e` gains `tests/e2e/motion.spec.ts`: reduced motion honoured, the breath
present while pending, and no transform on any animated element. It belongs in
the browser layer because happy-dom cannot answer any of those (constitution IV).

## What is not validated here

Nothing in this feature touches money, routes, tenancy or sessions. If a change
under review does, it is out of scope and belongs in its own spec.
