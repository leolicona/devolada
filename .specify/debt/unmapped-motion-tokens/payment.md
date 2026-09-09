# Debt Payment: the motion scale governs nothing

- **Slug**: unmapped-motion-tokens
- **Checked**: 2026-09-09
- **Verdict**: verified
- **Paid by**: `specs/001-design-foundations` — commits `c9b0c57` (the `@theme
  inline` mapping), `cd5c2df` (the Button merge, which deleted two literals with
  the duplicate file), `07d054e` (the remaining thirteen deletions)

## Anchors

- `packages/ui/src/styles/tokens.css:138-146` — **gone as a condition.** The
  seven tokens are still declared (now at 150–164, joined by `--duration-breath`
  and `--opacity-breath`); what the anchor recorded was that they were "consumed
  by nothing", and they are now consumed.
- `packages/ui/src/styles/index.css:99` — **gone.** The `@theme inline` block no
  longer ends at the typography mapping. `--transition-duration-*`, `--ease-*`
  and `--animate-*` follow it at 115–129.
- `packages/ui/src/components/button.tsx:14` — gone. The merged recipe carries
  `transition-colors` with no literal.
- `apps/admin/src/components/ui/button.tsx:10` — gone; the file itself was
  deleted by the Button unification (G3/D6), as the entry anticipated.
- `apps/admin/src/components/ui/switch.tsx:11,24` — gone (both).
- `apps/admin/src/components/ui/tabs.tsx:27` — gone.
- `apps/admin/src/components/ui/calendar.tsx:37` — gone.
- `apps/admin/src/features/cobros/CobrosScreen.tsx:119,139` — gone (both).
- `apps/admin/src/features/feed/FeedScreen.tsx:242,265` — gone (both).
- `apps/pago/src/features/pago/PaymentPage.tsx:781,784,1229,1232` — gone (all
  four).
- `packages/ui/src/playground/Showcase.tsx:111` — gone.

15 of 15. None moved.

## Exit condition

> Confirmed paid when both hold on the tree:
>
> ```
> grep -rn "duration-[0-9]" apps packages --include="*.tsx" | grep -v node_modules   # no output
> grep -n "var(--duration-" packages/ui/src/styles/index.css                        # the mapping exists
> ```

Both were run verbatim, as written, on the working tree at `07d054e`. Both hold.
Both failed when the entry was opened.

## Evidence

```
$ grep -rn "duration-[0-9]" apps packages --include="*.tsx" | grep -v node_modules
(no output)

$ grep -n "var(--duration-" packages/ui/src/styles/index.css
115:  --transition-duration-instant: var(--duration-instant);
116:  --transition-duration-fast: var(--duration-fast);
117:  --transition-duration-normal: var(--duration-normal);
118:  --transition-duration-slow: var(--duration-slow);
128:  --animate-breath: breath var(--duration-breath) var(--easing-default) infinite;
129:  --animate-reveal: reveal var(--duration-slow) var(--easing-default) both;
135:  --default-transition-duration: var(--duration-fast);
210:      animation-duration: var(--duration-breath) !important;
222:      animation-duration: var(--duration-slow) !important;
```

Beyond what the entry asked for — it named greps, not a test — the interest it
described is now covered by an assertion that runs on every `pnpm e2e`:

`tests/e2e/motion.spec.ts`, "editing a duration token changes what the screen
does". It reads the outcome cross-fade's computed `animation-duration` (`0.4s`),
sets `--duration-slow` to `2000ms` at runtime, and reads `2s`. That is the
entry's first line of Interest — "a change to the motion scale silently does
nothing" — turned into a test that fails if it ever becomes true again.

The deletions were verified to be visually inert rather than assumed: the built
stylesheet compiles `.transition-colors` **and** `.transition-transform` to
`var(--tw-duration, var(--duration-fast))`, so a literal `duration-150` was
redundant on both the colour and the transform transitions the anchors carried.

Standing gates on the same tree: `spec-lint` 49 files, `contrast-lint` 34 pairs
in both themes, 237 unit tests, 22 e2e — all green.

## What remains

Nothing for this entry.

One thing it flagged for the future stands unaddressed, and is not this debt's
to pay: `tokens.css` still has no mechanism that reports a token nobody reads.
This was the second such finding in that file family. A third would be the
argument for building one.
