# Implementation Plan: automated-collections-api

**Branch**: `claude/devoladapago-wisphub-integration-cqz6xp` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-automated-collections-api/spec.md`

## Summary

Give the collection loop to the business's own software: it creates a payment
link through an API, is told by signed webhook the moment Banxico validates the
transfer, can ask about any payment at any time, and can pull its received
transfers to reconcile.

The approach rests on one finding from Phase 0. **A business cannot collect by
SPEI today without a WispHub key** — not because the money needs it, but because
`speiAvailable()` demands it and the panel's links read their amount from WispHub
(`validation.ts:77`, `:530`, measured 2026-09-12). Split that gate and the ISP
assumption is gone from the money path; what is left is one table that requires
a WispHub customer on every link row.

So the work is: widen `payment_links` to carry a caller's reference and an amount
instead, branch `runValidation` after the CEP is reconciled rather than
duplicating it, and add a webhook queue shaped exactly like the reconnection
queue that already works. The payer's page is not touched at all — an API link
produces the same `LinkStatusResponse` it already renders.

Full reasoning and alternatives: [research.md](./research.md) (D1–D16).

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM, `verbatimModuleSyntax`; Node 22; pnpm 10 workspace

**Primary Dependencies**: Hono 4 + `@hono/zod-validator`, Drizzle ORM, zod; React 19 + TanStack Router/Query for the two panel screens

**Storage**: D1 (SQLite) via Drizzle. Two columns relax `NOT NULL`, which forces SQLite's table rebuild — see Complexity Tracking

**Testing**: Vitest 3 with `@cloudflare/vitest-pool-workers` against real local D1 for the API; happy-dom + Testing Library + MSW for the panel screens; Playwright + axe for the one new payer state

**Target Platform**: Cloudflare Workers, `compatibility_date` 2025-05-01

**Project Type**: web service (public API added to the existing product API) + two panel screens

**Performance Goals**: a webhook delivered within 30 s of the verdict for 99 % of payments (SC-002); first delivery attempted inline at the verdict, retries on the existing every-minute cron

**Constraints**: no new Worker trigger (constitution); no new stack element; integer cents end to end; the payer's verdict never waits on a webhook (FR-017)

**Scale/Scope**: ~8 new endpoints, 5 new tables, 3 changed tables, 2 panel screens, 1 new payer state. Pilot scale — tens of businesses, thousands of links

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design.*

| Principle | Gate | Verdict |
| --- | --- | --- |
| **I. Spec-driven, every decision cited** | Spec committed before code; every non-obvious rule cites `automated-collections-api D<n>` | **PASS** — D1–D16 in research.md, each with rationale and rejected alternatives |
| **II. Money law** | Integer cents end to end; no float; business timezone owns "today" | **PASS** — `askCents`, `askedCents`, `receivedCents`; `from`/`to` resolved in the business's timezone (FR-021); no provider decimals enter this feature |
| **III. One contract, pure routers** | `routes/<area>/{index,handler,schema}.ts`; schema exported and reused; one envelope | **PASS with one extension** — `routes/v1/<area>/…`, exported as `./v1-schema`. The envelope carries `retryable`, as Consta's does; logged below |
| **IV. Tests on the real runtime** | workerd + real D1, no database mocks; providers intercepted at their real origin | **PASS** — webhook destinations intercepted with `fetchMock`; `assertNoPendingInterceptors` is how "nothing reached WispHub" (FR-029) is proven |
| **V. Tenant isolation, authorization by area** | Every query filters by the actor's business | **PASS with one extension** — a second actor kind (a credential, not a membership). It resolves to exactly one business and carries no role; logged below |
| **VI. Visual foundations** | Tokens only, status never colour alone, 40/48/64 sizes, `<Pending>` on every wait | **PASS** — two panel screens from `@devolada/ui` atoms; delivery health uses `StatusBadge`; the one new payer state is static copy in es-MX |
| **VII. Every test cites its story** | `automated-collections-api US<n>` in every new test file | **PASS** — US1–US4 map to the four test groups |
| **VIII. Absent config degrades, never breaks** | Every binding says what "unset" means | **PASS, with a restatement** — "no WispHub key" stops meaning "cannot collect" and starts meaning "no panel links". Principle VIII is unchanged; what changed is which feature the key belongs to (D5) |

**Blocking constitutional conflict**: the constitution's opening sentence —
*"Devolada lets a Mexican ISP (the business, or Negocio) collect its customers'
payments by SPEI … and act on it in the ISP's own system"* — no longer describes
the product after the spec's Q2. Per Governance (*"when a principle blocks a
feature, the feature's plan says so and proposes the amendment; it does not route
around it"*), this plan proposes:

> Devolada lets a Mexican business collect its customers' payments by SPEI and
> validate the transfer through Consta. Acting on the verdict in the business's
> own system is one thing that can follow — through an integration Devolada
> drives, or through a webhook the business's own software acts on.

Run `/speckit-constitution` with that wording before `/speckit-implement`; it is
a MINOR amendment (guidance widened, no principle removed or redefined).

## Project Structure

### Documentation (this feature)

```text
specs/003-automated-collections-api/
├── plan.md              # this file
├── spec.md
├── research.md          # D1–D16
├── data-model.md
├── quickstart.md
├── contracts/
│   └── public-api.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
apps/api/src/
├── routes/v1/                      # NEW — the public API (D1)
│   ├── index.ts                     # mounts the areas, no logic
│   ├── middleware.ts                # requireApiCredential, rate limit, idempotency
│   ├── payment-links/{index,handler,schema}.ts
│   ├── payments/{index,handler,schema}.ts       # verify + transfers
│   ├── webhook/{index,handler,schema}.ts
│   └── test-mode/{index,handler,schema}.ts      # D12
├── api-clients/                    # NEW
│   ├── credentials.ts               # dk_ keys, SHA-256 (D11)
│   └── store.ts
├── webhooks/                       # NEW
│   ├── events.ts                    # payload rendered once (D9)
│   ├── sign.ts                      # HMAC-SHA256, both secrets in rotation (D10)
│   └── queue.ts                     # the sweep (D8)
├── direct-payments/
│   ├── validation.ts                # CHANGED — channel/ask gates (D5), the seam (D7)
│   └── links.ts                     # NEW — link state, open/paid/expired
├── routes/direct-payments/handler.ts  # CHANGED — panel vs api ask (D5, D6)
├── db/schema.ts                     # CHANGED — see data-model.md
└── index.ts                         # CHANGED — mount /v1, exclude from CORS, add the sweep

apps/admin/src/features/integrations/
├── ApiScreen.tsx                   # NEW — credentials (FR-001, FR-003, FR-004)
└── WebhookScreen.tsx               # NEW — address, rotation, delivery health (FR-018)

apps/pago/                          # UNCHANGED except one new state's copy (D6)

apps/api/test/
├── collections-api-links.test.ts   # US1
├── collections-api-webhook.test.ts # US2
├── collections-api-verify.test.ts  # US3
├── collections-api-transfers.test.ts # US4
└── collections-api-test-mode.test.ts # FR-034, FR-035
```

**Structure Decision**: the public API is a new route area inside `apps/api`,
not a fourth Worker — it reads and writes the same D1 that holds
`payment_links`, `payments` and `businesses` (research D1). It is the only area
under a version prefix, because it is the only one whose consumers cannot be
redeployed with it.

## Implementation order

Each phase leaves the product working, and the first three are the spec's
priorities in order.

1. **Foundation** — the schema change, the credential, the middleware, the gate
   split (D3, D5, D11, D13, D14). Nothing user-visible; everything below needs
   it. Ends with: a business with no WispHub key can have a link row.
2. **US1, links** — create, re-price, close, expire; the panel's API screen; the
   payer's page serving an API link and its closed state (D6). Ends with: money
   can be collected through the API, visible in the panel.
3. **US2, webhooks** — the validation seam (D7), the event payload (D9), signing
   and rotation (D10), the queue and its sweep (D8), the health screen. Ends
   with: the loop closes without a human.
4. **US3, verify** — payment and customer lookups.
5. **US4, transfers** — the paged, cursor-stable history.
6. **Test mode** — the test credential, the advance endpoint, and the isolation
   proof (D12).

Phase 1 carries the only migration. Phases 2–6 are additive.

## Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| **Test records leaking into real totals** (FR-035) | A test payment counted as revenue, or charged a validation fee, is worse than no test mode | The fee has exactly one gate (`debitValidationFee`, `credit/index.ts:87`, already idempotent per payment). Panel reads are enumerable — 22 `from(payments)` queries across 8 files, most of them internal sweeps. One shared predicate, plus a test asserting a test payment is invisible to the panel and to the real credential |
| **The `NOT NULL` relaxation** | Not a purely additive migration; a rebuild on a table the payer's page reads | One table, pilot scale, additive in every other respect. Production archives a D1 export before migrating. Verify the partial unique indexes survive the rebuild — drizzle-kit recreates them, and a test asserts both |
| **The validation seam drifting** | `runValidation` is the most measured code in the repo; a second copy would rot | Branch inside it, after the CEP (D7). No second validation function. The API branch constructs no WispHub client at all, so FR-029 holds structurally |
| **A slow webhook destination holding a payment** | FR-017 is absolute: the payer must see success | The first attempt runs in `waitUntil`, never in the verdict's own path; the queue owns everything after |
| **Two collection channels disagreeing about one customer** | An ISP with both a WispHub link and an API link for the same person could double-collect | Out of scope by construction: the partial unique indexes keep the namespaces separate, and D16 keeps "unapplied" honest. Worth naming to the developer as a product question for later |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `retryable` added to the envelope on `/v1` | FR-025: an outside caller must distinguish "retry this" from "fix your request". A code list alone cannot say which is which, and every caller would hard-code its own guess | Codes only — rejected because each consumer would then invent its own retry policy from our error names, which is the drift the one-contract rule exists to stop. The constitution already grants this to Consta for the same reason; the amendment should say "server-to-server surfaces", not "Consta" |
| Migration is not purely additive: two columns relax `NOT NULL` | An API link has no WispHub customer, and those columns are `NOT NULL` today (`payment_links`) | Writing a sentinel into a `NOT NULL` column — rejected because `customer_usuario` is surfaced to the payer as `reference`, so the sentinel would reach a customer's screen, and because a value meaning "not applicable" while claiming to be an identifier is the exact lie the comment discipline exists to prevent. A second table — rejected in D2: it forks the token space, the payer path and the payment foreign key |
| A second kind of actor: a credential, not a membership | The caller is software, not a person. It has no role and never passes through `requireArea` | Minting a service user with a membership — rejected because it would put a fake person in the organization, appear in the members list, and make the role matrix answer questions about an actor that has no screens. Isolation is unchanged: a credential resolves to exactly one business and every query filters by it |
| The constitution's opening sentence must change | The spec's Q2 widens the product past what it says | Routing around it — forbidden by Governance, and it would leave the repo's law disagreeing with its code, which the constitution calls not an option |

## Open, carried forward

- **Admissions and identity checks** — deliberately left open by the developer on
  2026-09-12. This plan adds no policy; it only honours the existing
  `businesses.status` gate on every `/v1` write, the same gate the payer's page
  already enforces (D15). Choosing a policy later costs a screen and an endpoint,
  not a migration.
- **FR-022's wording** — research D16 narrows "a transfer that arrived but
  matched no link" to "a validated transfer that was not applied", because
  Devolada has no bank feed and learns of a transfer only when a payer submits
  its proof. The spec should be amended to match rather than promise
  reconciliation against the business's bank account. Raised, not edited
  silently.
