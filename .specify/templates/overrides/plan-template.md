# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!-- Pre-filled: the stack is constant across features. Change a line only when this
     feature genuinely departs from it, and say why in Complexity Tracking. -->

**Language/Version**: TypeScript 5.7 · Node 22 · pnpm 10.29.3 (workspaces)

**Primary Dependencies**: Hono 4.7 · Drizzle 0.40 · Zod 3.24 · Better Auth 1.6 ·
React 19 · TanStack Router 1.95 + Query 5.62 · Vite 6 · Tailwind v4 · shadcn (copied in, never a dependency)

**Storage**: Cloudflare D1. R2 (`PROOFS`) for transfer evidence. Workers AI for receipt
extraction. **Not available without a spec that adds them**: KV, Queues, Durable Objects,
Vectorize, Hyperdrive.

**Testing**: Vitest 3.2 · `@cloudflare/vitest-pool-workers` (real workerd + local D1, no
database mocks) · React Testing Library + happy-dom · MSW 2.7 validated against the Zod
schemas · Playwright + axe for e2e, contrast and geometry

**Target Platform**: Cloudflare Workers. Surfaces on `*.devoladapago.com` — `admin.`
(desktop-first), `pago.` (mobile-first, 360px floor), `api.`, `consta.`

**Project Type**: pnpm monorepo — `apps/{api,consta,admin,pago}` + `packages/ui`

**Performance Goals**: a stalled provider never blocks a response — the app answers or
says it could not reach the provider (deadlines on every provider call)

**Constraints**: D1 binds at most 100 parameters per statement (BUG-021 — chunk anything
that grows with the tenant). Migrations are additive; a table rebuild is proven on seeded
data first. Money is integer cents everywhere.

**Scale/Scope**: pilot scale — one ISP, tens of customers per tenant. Multi-workspace
since phase 2, so nothing may assume a single business.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Mark each principle this feature touches, and state how it is satisfied. A principle it
does not touch is marked N/A. A violation goes to Complexity Tracking with the simpler
alternative that was rejected — an unrecorded violation is a defect
(`.specify/memory/constitution.md`).

| # | Principle | Status | How |
|---|---|---|---|
| I | Money is exact, its history immutable | ☐ | |
| II | The oracle never loses a payment, never holds it | ☐ | |
| III | One tenant model, one billing model | ☐ | |
| IV | A boundary is crossed through its contract | ☐ | |
| V | One word per concept | ☐ | |
| VI | The interface obeys the tokens | ☐ | |
| VII | Every test names the story it covers | ☐ | |

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
