# Implementation Plan: The Payer's Doorway

**Branch**: `claude/paid-links-evaluation-6mmzzq` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-payer-doorway/spec.md`

## Summary

The payer's page already keeps every link a device was handed, and already
shows a chooser when there is more than one. The chooser shows names. This
feature makes it show **what is owed**.

The shape that makes it cheap: the doorway resolves **one link per request, in
parallel** (D1), against a **lean projection** of the answer the payment page
already receives (D2), produced by the **same resolver** (D3). Rows therefore
arrive as they resolve, a failed row never spoils the others, and a row can
never disagree with the page behind it — all three by construction rather than
by care.

No table, no column, no migration. The only durable change is on the payer's
own device, where the saved entry gains the business's name and keeps no amount
and no state (D5).

## Technical Context

**Language/Version**: TypeScript 5 on Node 22 tooling; React 19 for the payer's
page, Cloudflare Workers (`compatibility_date` 2025-05-01) for the API.

**Primary Dependencies**: Hono 4 + `@hono/zod-validator` and Drizzle on the API
side; TanStack Query, Tailwind 4 and `@devolada/ui` atoms on the page. Nothing
new is added — the feature is one route and one screen.

**Storage**: D1 for the links, read-only here. The colo Cache API already holds
the 30-second per-business pending-invoice entry the resolver uses
(`apps/api/src/wisphub/cache.ts`). `localStorage` on the payer's device holds
the saved list; its shape is in [data-model.md](./data-model.md) §1.

**Testing**: `@cloudflare/vitest-pool-workers` against a real local D1 with the
provider intercepted at its real origin (API); happy-dom + Testing Library +
MSW with `onUnhandledRequest: "error"` and `axe` (the doorway screen);
Playwright + axe for contrast in both themes, touch size, focus and
360/768/1280 (browser). No passkey layer is engaged.

**Target Platform**: Cloudflare Workers; mobile browsers from a 360px floor,
designed at 375.

**Project Type**: web — one API and two SPAs. This feature touches `apps/api`
and `apps/pago` only. `apps/admin` is untouched.

**Performance Goals**: SC-004 — first row readable within 1 s, every reachable
balance within 3 s for five links. **Unmeasured** (research R2): a target the
browser layer verifies, not a promise the design rests on. Per-row cost is in
research R1: an API link is two D1 reads and no provider; a panel link adds one
uncached customer read plus a usually-cached pending list.

**Constraints**: session-less — no account, no cookie, no identification
anywhere on this path. WCAG 2.2 AA with a measured focus indicator. No
horizontal scroll at 360px. Nothing on the payer's screen spins or bounces.
Integer cents end to end.

**Scale/Scope**: a payer normally holds one to three links; ten resolve
automatically (D8); twenty is the stress case the bound exists for. One new
route, one rewritten screen, one widened device-storage shape.

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1 design.*

| Principle | Gate | Verdict |
| --- | --- | --- |
| **I. Spec-Driven, Every Decision Cited** | spec → plan → tasks → implement under `specs/008-*`; every non-obvious rule cites `payer-doorway D<n>` | **Pass.** Spec committed; D1–D10 are declared in [research.md](./research.md) and each is argued in a numbered section there. |
| **II. Money Law** | integer cents, string-parsed provider decimals, business timezone owns "today" | **Pass.** `totalCents` is the page's own integer (D7); the summary performs no arithmetic on it, which is the safest possible engagement with this principle. No new conversion exists to get wrong. |
| **III. One Contract, Pure Routers** | one envelope, `UPPER_SNAKE` codes, `index.ts` pure, schema exported and shared | **Pass.** One route added to the existing `direct-payments` area: wiring in `index.ts`, logic in `handler.ts`, shape in `schema.ts` and out through the existing `@devolada/api/direct-payments-schema` — no new package export (research R8). Browser-facing, so no `message` and no `retryable` (III's second bullet). |
| **IV. Tests Run on the Real Runtime** | workerd + real D1, no DB mocks, providers intercepted at their real origin, config pins the origin | **Pass.** The summary route is tested in workerd against real D1 with WispHub intercepted at its pinned origin. The component layer proves ordering, removal and partial failure; only the browser layer is allowed to answer contrast, target size and SC-004's timings. |
| **V. Tenant Isolation and Authorization by Area** | `business_id` on every row, every query filtered, area+action authorization, auditable with grep | **Pass, and the reading is written down.** The doorway is several single-link reads, each authorised by the link the device already holds; the answer for one carries only what that link's own page carries (FR-010). D4 is the enforceable edge: no payer path may call `rosterForDisplay`, because resolving one payer's link must never pull a whole tenant's customer list. No role-matrix change — this path has no actor. |
| **VI. Visual Foundations** | semantic tokens only, declared sizes, status never colour alone, shared atoms first, waiting breathes | **Pass, with work.** Every row's state is `StatusBadge` — icon and text, never colour alone. A row still reading breathes; nothing spins (FR-020). Rows hold at 360px with no horizontal scroll, targets at 48px. Any new atom belongs in `packages/ui`, not in `apps/pago`. |
| **VII. Every Test Cites Its Story** | every test file cites `<feature-slug> US<n>` | **Pass.** New files cite `payer-doorway US1/US2/US3`; tasks carry their `[US<n>]` label. |
| **VIII. Absent Configuration Degrades, Never Breaks** | every binding documents "unset", absent config degrades loudly, never throws at the edge | **Pass, not widened.** No binding is added. A business with no credential or no account already answers `unavailable`, and the row says so in words (FR-005). An unreachable provider becomes `unknown` on the device (D10) and the row still opens — degrading loudly is the whole of US3. |

**No violations.** Complexity Tracking is empty, and the one place this feature
could have earned an entry — a batch endpoint reading several businesses' links
in one request — was rejected in research R3 for exactly that reason.

## Project Structure

### Documentation (this feature)

```text
specs/008-payer-doorway/
├── spec.md                       # what and why
├── plan.md                       # this file
├── research.md                   # Phase 0 — R1..R8, decisions D1..D10
├── data-model.md                 # Phase 1 — the device's shape, the row, the states
├── contracts/
│   └── link-summary.md           # Phase 1 — the one new route
├── quickstart.md                 # Phase 1 — how to prove each story locally
├── checklists/
│   └── requirements.md           # spec quality, 14/14
└── tasks.md                      # Phase 2 — /speckit-tasks, not created here
```

### Source Code (repository root)

```text
apps/api/src/
├── routes/direct-payments/
│   ├── index.ts                  # + GET /links/:token/summary — wiring only
│   ├── handler.ts                # the shared resolver extracted from getLinkStatus (D3);
│   │                             #   getLinkStatus and the summary become its two projections
│   └── schema.ts                 # + linkSummaryResponse, out through the existing export
└── (no schema.ts, no migration, no binding, no cron)

apps/api/test/
└── direct-payments-summary.test.ts   # payer-doorway US1 — the contract, including
                                      #   the fields the summary must NOT carry

apps/pago/src/
├── links.ts                      # SavedLink gains `business`; old entries tolerated;
│                                 #   newest-first order (D5, D6)
├── api.ts                        # unchanged
├── features/pago/
│   ├── RootScreen.tsx            # the doorway: live rows, ordering, removal, degradation
│   └── PaymentPage.tsx           # one line — remember the business name beside the payer's
└── (a small focus-freshness helper, D9 — see below)

apps/pago/test/
├── doorway.test.tsx              # payer-doorway US1, US2, US3
└── returning-access.test.tsx     # existing — must keep passing unchanged

tests/e2e/
└── doorway.spec.ts               # payer-doorway US1/US3 — contrast both themes,
                                  #   touch size, focus, 360/768/1280, SC-004 timings
```

**Structure Decision**: the existing layout, unchanged. This feature adds one
route to an existing area and rewrites one existing screen. The only judgement
call is `focusReadOptions` (D9): it lives in `apps/admin/src/lib/presence.ts`
and `apps/pago` cannot import from `apps/admin`. It is six lines of query
options — copy them into `apps/pago` with a comment citing the admin's original
rather than extracting a shared package for a pair of literals. `packages/ui` is
design tokens and atoms; query behaviour does not belong in it.

**Atoms, and one trap.** `packages/ui` already exports what this screen needs:
`StatusBadge` for every row's state (icon and text, never colour alone),
`Pending` for a row still reading — which `pending-lint.mjs` requires around any
in-progress label — and `Alert` and `Card`, which `RootScreen` already uses.

`ListError` is the obvious reach and the wrong one. It exists because a failed
request used to fall through to an empty state and tell someone they had no
movements when in truth nothing could be read. The doorway has no such
ambiguity: its rows come from the device, and only the amounts come from the
server. Replacing the list with a retry notice would hide the links the payer
came for — the exact opposite of FR-017. The failure belongs **per row**, as a
state on the badge, and the list stays.

## Dependencies and sequencing

The three stories are independent to *test* but not to *build*: US2 and US3 are
properties of the screen US1 creates. The build order is therefore the API
first, then the screen, then the two behaviours that harden it.

1. **The contract** — `linkSummaryResponse`, the extracted resolver (D3), the
   route, and its API tests including the absent-fields assertion (FR-010).
   Nothing in the page changes yet.
2. **The device's shape** — `SavedLink` gains `business`, tolerates the old
   entries, and orders newest-first (D5, D6). `PaymentPage` remembers the
   business name. `returning-access.test.tsx` must still pass untouched.
3. **US1, the screen** — rows with business, person, amount and state; ordering;
   the one-link and zero-link paths kept exactly as they are today (FR-012).
4. **US2, staying true** — dropping `closed` and 404 rows, keeping every other
   failure, and proving no amount is ever read from storage (FR-016).
5. **US3, never a dead end** — independent resolution, partial failure, the
   bound at ten (D8), the breathing row, and the damaged-storage path.
6. **The browser layer** — contrast, targets, focus, no horizontal scroll, and
   the SC-004 measurement that research R2 says to record rather than assume.

Step 1 is the only one that can land alone and be useful to no one; steps 3
onward each make the screen better on their own. If the work has to stop early,
stopping after step 3 leaves a doorway that shows what is owed and degrades
poorly — which is still better than a list of names.
