# Fix Visual hierarchy

Apply the UI Refactor rules focused on visual hierarchy. Read
`.specify/memory/constitution.md` (Principle VI) and `docs/legacy/FRONTEND.md`
first — they outrank generic advice.

The admin has at most five nav sections. No in-page anchor indexes — a page that wants a table of contents gets split into rail rows instead.

Every value still comes from `packages/ui/src/styles/tokens.css`; zero hardcoded
values, and status is never colour alone.

$ARGUMENTS
