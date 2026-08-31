---
status: in-development
stories: [US-P02, US-P04]
domain: polish
updated: 2026-08-14
debt: [TD-002]
---

# Spec: Dark mode and contrast, measured

> **2026-08-31, retirement PR**: the tienda screens left with `devolada-red`; tokens, contrast-lint and the browser contrast pass continue on admin and pago.

The brief made three promises about colour: minimum AA, AAA as the target on amounts and statuses, and a dark palette that is recalibrated rather than inverted. Nothing had ever checked them. This spec turns those promises into a script that runs in CI, and fixes what the first run found.

## Decisions

- **D1 — The palette is verified from `tokens.css`, not from screenshots.** `scripts/contrast-lint.mjs` parses the live file, resolves both themes, and computes WCAG ratios for the pairs the UI actually renders. A screenshot review catches what someone thought to look at; this catches the pair nobody remembered. The design mirror stays out of it — the live file is the law (TD-002).
- **D2 — Translucent badges are composited before measuring.** Dark status backgrounds are `rgb(… / 0.13)`; measuring that against nothing would report a ratio no eye will ever see. They are laid over the surface behind them first.
- **D3 — Two AA misses were fixed by darkening the ink, not by lightening the badge.** Light success (`#15803d` → `#147b3b`) and warning (`#a16207` → `#9b5e07`) sat at 4.47:1 and 4.46:1 — under the line by a rounding error, but under it. The ink moves because the soft background is what makes a badge readable as a badge; darkening it would have cost the "soft" in the design.
- **D4 — Form fields get their own border token.** Inputs used `--color-border-primary` at 1.29:1 while their fill differs from the page by 1.06:1: a field with no perceivable boundary, which WCAG 1.4.11 asks to be 3:1. New `--color-border-input` (`#8a8880` light, `#7b746a` dark) clears 3:1 on page, card and well. **Cards keep their whisper-quiet edge** — decoration is exempt, controls are not, and the "subtle borders over shadows" philosophy survives intact.
- **D5 — AAA is reported, never enforced.** Six pairs sit between AA and AAA (status badges, success amounts). The brief calls AAA a *target* on those, and reaching it would mean colours dark enough to read as brown-green rather than green. The script warns and the number stays visible; making it an error would quietly rewrite the brand.
- **D6 — The two dark blocks are compared to each other.** `tokens.css` declares dark twice — once for `[data-theme="dark"]`, once for `prefers-color-scheme` — and two copies of one truth drift. The script fails if any token differs between them.
- **D7 — A colour written into a component is a failure, not a warning.** The same script scans both apps and `packages/ui` for hex/rgb/hsl/oklch literals. Today there are none; the check exists so that stays true, because a hardcoded colour is precisely what breaks dark mode one line at a time.

## Contract

`node scripts/contrast-lint.mjs` — exit 1 on: any pair below AA, a token that differs between the two dark blocks, a status ink identical in both themes (that would mean nobody recalibrated dark), or a colour literal outside `tokens.css`. Warnings for AAA-target misses do not fail the build. Runs in CI's quality job beside `spec-lint`.

## UI Contract

- No visual redesign. Two status inks move by a shade; input borders become visible enough to find.
- Dark mode remains system-driven (`prefers-color-scheme`) with `[data-theme]` as the override.

## Scenarios

1. Every rendered pair reaches AA in both themes (US-P04, D1)
2. A status ink that drops below AA fails the build (D1, D3)
3. A token that differs between the two dark blocks fails the build (D6)
4. A hardcoded colour in a component fails the build (D7)

## Definition of Done

- [x] `scripts/contrast-lint.mjs` passes on the current palette (34 pairs, both themes)
- [x] Wired into CI's quality job (and both deploy workflows)
- [x] The two AA misses and the input border fixed in `tokens.css`
- [x] Each failure path verified by breaking it on purpose: an ink below AA, a token that differs between the dark blocks, a hardcoded colour
- [x] axe on rendered screens — `polish/accessibility.spec.md` (markup, per PR)
      and `tests/e2e/contrast.spec.ts` (real colour, both themes)
- [x] Keyboard order and visible focus — taken once, for both apps, by the
      keyboard slice (`tests/e2e/keyboard.spec.ts`, accessibility.spec.md D6,
      pays TD-010).
