# Fix Colour and palette

Apply the UI Refactor rules focused on colour and palette. Read
`.specify/memory/constitution.md` (Principle VI) and `docs/legacy/FRONTEND.md`
first — they outrank generic advice.

Contrast must meet AA; AAA is the target on amounts and statuses. Dark is its own calibrated palette, never an inversion. Run `node scripts/contrast-lint.mjs` and make it pass.

Every value still comes from `packages/ui/src/styles/tokens.css`; zero hardcoded
values, and status is never colour alone.

$ARGUMENTS
