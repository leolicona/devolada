---
slug: badge-class-merge
status: open
kind: inadvertent
severity: low
effort: minutes
opened: 2026-09-10
---

# Technical Debt: a caller's className cannot override StatusBadge

## What was traded

Every other component in `packages/ui` composes its classes through `cn`, which
runs `twMerge`: when a caller passes a class that conflicts with the recipe, the
caller's wins, deterministically. `StatusBadge` builds its class string by
template concatenation instead:

```tsx
className={`inline-flex items-center rounded-full border font-medium ${tones[tone]} ${s.badge} ${className}`}
```

Both classes survive into the DOM, so which one applies is decided by the order
Tailwind happens to emit them in the stylesheet — not by the call site. A screen
that passes `px-2` to tighten a badge in a cramped row gets `px-3 px-2` and,
today, `px-3` wins. Nothing about that is stated anywhere, and nothing fails.

Nobody is currently passing a conflicting class, which is why this is low
severity and why it has survived. The cost is that the first person who tries
sees their class in the DOM, in the element inspector, doing nothing.

## Where it lives

- `packages/ui/src/components/status-badge.tsx` — the `className` template in
  `StatusBadge`'s return, and the `className = ""` default that goes with it.
  One component, one line.

## What paying it looks like

Import `cn` from `../lib/cn`, wrap the same strings, and drop the `= ""`
default — the shape every other atom in the package already has. The visual
result is identical for every current call site, because none of them passes a
conflicting class; the review captures are the check.

Confirmed paid when both hold on the tree:

```
grep -n "cn(" packages/ui/src/components/status-badge.tsx        # the merge exists
grep -n 'className={`' packages/ui/src/components/status-badge.tsx  # no output
```

**Trigger**: the next feature that needs a badge to sit differently in one
place. Until then it costs nothing but a surprise.

## Notes

- Found while reading for `feedback-vocabulary-rollout` research R8, which
  renamed this component's sizes. Deliberately not folded into that feature:
  User Story 4 is about the size vocabulary, and a class-composition fix is a
  different change that would have widened the diff without being asked for.
- Related in spirit to `unmapped-motion-tokens`: both are cases where the
  codebase looks like it has a rule (tokens are law; `cn` merges) and one file
  quietly does not participate. Neither had anything that would report it.
