# UI Refactor

Improve the interface **within Devolada's law**, never against it. Read
`.specify/memory/constitution.md` (Principle VI) and `docs/legacy/FRONTEND.md`
first; they outrank any generic UI advice.

- Every value comes from `packages/ui/src/styles/tokens.css`. Zero hardcoded
  colours, spacings, radii or sizes — `scripts/contrast-lint.mjs` fails the build on one.
- `StatusBadge` is the only representation of a domain status. A missing status is
  added to the atom, never re-drawn per screen.
- Status is never communicated by colour alone: always icon + text.
- Search order for any piece of UI: domain atom in `@devolada/ui` → shadcn primitive
  (use the `shadcn` skill) → new component.

$ARGUMENTS
