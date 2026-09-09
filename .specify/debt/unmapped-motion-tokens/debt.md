---
slug: unmapped-motion-tokens
status: open
kind: inadvertent
severity: medium
effort: hours
opened: 2026-09-09
---

# Technical Debt: the motion scale governs nothing

## What was traded

`tokens.css` declares a full motion scale — four durations and three easing
curves, with the intent written beside them (`--duration-slow: 400ms /* charge
result reveal */`, `/* No bounce: trust doesn't bounce */`). `index.css` maps
colour, type, radii, shadow and container namespaces into `@theme inline` but
**never maps motion**, so no Tailwind utility can reach those variables. Every
component that needed a transition reached for Tailwind's built-in
`duration-150` instead. Nothing in the tree or its history records this as a
decision — no comment, no commit message — so it reads as an omission that
each new component then copied.

The two values agree today by luck: Tailwind's `duration-150` happens to equal
`--duration-fast: 150ms`. Nothing keeps them agreeing.

## Where it lives

- `packages/ui/src/styles/tokens.css:138-146` — the seven motion tokens
  themselves: `--duration-instant|fast|normal|slow`, `--easing-default|in|out`.
  Declared, commented, and consumed by nothing.
- `packages/ui/src/styles/index.css:99` — the `@theme inline` block ends at the
  typography mapping (`--text-amount: var(--font-size-amount);`). This is the
  line the motion mapping is missing after; every other token family is mapped
  above it.
- `packages/ui/src/components/button.tsx:14` — the shared Button's base recipe,
  `transition-colors duration-150`. The atom both surfaces render, so it is the
  literal with the widest reach.
- `apps/admin/src/components/ui/button.tsx:10` — admin's duplicate Button
  carries its own copy of the same literal (see `.specify/design/foundations.md`
  G3: this file is itself scheduled for deletion).
- `apps/admin/src/components/ui/switch.tsx:11,24` — two literals in one file,
  one on colour and one on transform.
- `apps/admin/src/components/ui/tabs.tsx:27`,
  `apps/admin/src/components/ui/calendar.tsx:37` — primitives.
- `apps/admin/src/features/cobros/CobrosScreen.tsx:119,139`,
  `apps/admin/src/features/feed/FeedScreen.tsx:242,265` — the collapsible
  trigger + chevron pair, written twice across two screens.
- `apps/pago/src/features/pago/PaymentPage.tsx:781,784,1229,1232` — the same
  collapsible pair, again twice, on the payer's page.
- `packages/ui/src/playground/Showcase.tsx:111` — the playground copies it too,
  so the showcase teaches the literal to whoever reads it next.

15 occurrences in 9 files; `duration-150` is the only duration literal in the
tree (no `ease-[...]` or arbitrary transition values were found).

## Interest

- **A change to the motion scale silently does nothing.** Editing
  `--duration-fast` in `tokens.css` changes no rendered transition. The file the
  constitution calls "the law" (Principle VI) is not the law for motion, and
  nothing reports the discrepancy — `contrast-lint` only reads colour.
- **As of constitution v1.1.0 the tree violates its own Principle VI in 15
  places**: "Duration and easing come from tokens — a literal duration in a
  component is drift." Every design review and every `/speckit-analyze` run will
  re-raise it until it is paid.
- **The copy rate is the real bill**: the same `transition-colors duration-150`
  pair has already been written four times for one collapsible pattern across
  three screens. Each new component adds one, because there is no utility to
  reach for instead.
- Not urgent in money terms: nothing renders wrong today, and the values agree.

## Paying it

Map the motion tokens into `@theme inline` in
`packages/ui/src/styles/index.css`, after the typography block at line 99 —
first verifying which theme namespace Tailwind v4.1 exposes for durations and
easing, and falling back to consuming the variables at the call site if there
is none. Then replace the 15 literals with the token-backed utility, deleting
rather than rewriting the two in `apps/admin/src/components/ui/button.tsx` and
`packages/ui/src/components/button.tsx` if the Button unification
(`.specify/design/foundations.md` D6) lands first.

Confirmed paid when both hold on the tree:

```
grep -rn "duration-[0-9]" apps packages --include="*.tsx" | grep -v node_modules   # no output
grep -n "var(--duration-" packages/ui/src/styles/index.css                        # the mapping exists
```

**Trigger**: the `design-foundations` feature. Its new feedback vocabulary
(`foundations.md` D10–D12: the waiting breath and the 400ms outcome cross-fade)
is the first code that *needs* these tokens as utilities. Shipping that
vocabulary on top of the literals means writing the mapping anyway and leaving
15 orphans behind — so this is paid before or during that feature, not after.
It also turns urgent the moment anyone changes a value in the motion scale and
expects it to take effect.

## Notes

- Discovered by `/speckit-design-foundations` run 2 (2026-09-09), recorded as
  gap **G4** in `.specify/design/foundations.md`, with decision **D15**: map the
  tokens now, migrate the literals as debt — this entry.
- Carried in the constitution's Sync Impact Report as `TODO(MOTION-DEBT)`
  (v1.1.0).
- Related but separate: **G3**, `Button` and `Input` defined twice. Two of the
  15 anchors sit in those duplicates, so paying G3 first removes one of them for
  free. Not a dependency in either direction.
- This is the second dead-token finding in the same file family; `tokens.css`
  has no mechanism that reports a token nobody reads. Worth remembering if a
  third appears.
