# Fix Layout and spacing

Apply the UI Refactor rules focused on layout and spacing. Read
`.specify/memory/constitution.md` (Principle VI) and `docs/legacy/FRONTEND.md`
first — they outrank generic advice.

Spacing comes from the token scale. `apps/pago` is mobile-first with a 360px floor and touch targets ≥48px; the admin is desktop-first but must work on a phone.

Every value still comes from `packages/ui/src/styles/tokens.css`; zero hardcoded
values, and status is never colour alone.

$ARGUMENTS
