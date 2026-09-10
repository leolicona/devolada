---
slug: no-literal-gate
status: open
kind: deliberate
severity: medium
effort: hours
opened: 2026-09-10
---

# Technical Debt: nothing in CI reports a literal inside a component

## What was traded

The constitution's Principle VI says it plainly: "No raw colour, size or spacing
values in components", "a literal duration in a component is drift". Two of the
six CI gates measure tokens — `contrast-lint.mjs` reads `tokens.css` in both
themes, `gen-banks.mjs --check` compares generated constants — and **neither
looks at a component**. `tokens.css` can be perfect while every screen writes
`h-10` and `duration-150` beside it.

That is not hypothetical. It is how `unmapped-motion-tokens` happened: fifteen
hand-written `duration-150` literals accumulated across `apps/` and
`packages/`, one component copying the last, with nothing to report them. That
debt was paid; the absence that allowed it was not.

`feedback-vocabulary-rollout` states the rule as **SC-008** ("the count of
literal colour, size, spacing, stacking and duration values introduced by this
feature is zero") and had no instrument for it. The feature's own T050 exists
solely to delete an `h-10 px-4 text-sm` from `ListError` — a height literal that
sat in a shared atom through a whole feature about size vocabulary, and that no
gate saw.

## Where it lives

- `.github/workflows/ci.yml` — the gate list. The missing sixth check.
- `scripts/contrast-lint.mjs`, `scripts/gen-banks.mjs` — the two existing
  token gates, and the shape a third would take.
- `packages/ui/src/components/list-error.tsx` — where the most recent instance
  was found, by reading rather than by tooling.

## What paying it looks like

A `scripts/literal-lint.mjs` that scans `apps/**/*.tsx` and `packages/**/*.tsx`
for the classes of literal the constitution names — arbitrary-value brackets
(`h-[40px]`, `z-[60]`, `text-[#1a1a1a]`), raw hex and `rgb()`/`hsl()` in a
component, and Tailwind's own numeric duration and z-index scales — and fails on
anything not in an explicit, commented allowlist. Joined to CI beside
`contrast-lint`.

It needs its own spec: the allowlist is a product decision (`w-[calc(100%-2rem)]`
is legitimate, `h-[40px]` is not), and a lint that cries wolf gets skipped,
which is worse than no lint.

Confirmed paid when:

```
node scripts/literal-lint.mjs      # exists, and exits non-zero on a planted h-[40px]
grep -n literal-lint .github/workflows/ci.yml
```

**Trigger**: the next feature that states a "no literals" success criterion, or
the next time a literal is found by reading. Both have now happened twice.

## Notes

- Raised as finding **C1** (HIGH) by `/speckit-analyze` on
  `002-feedback-vocabulary-rollout`, 2026-09-10: SC-008 had zero task coverage
  and no instrument.
- SC-008 was verified for that feature by sweeping its own diff, which is a
  one-off and does not survive the next feature. That is exactly the gap this
  entry names.
