# Specification Quality Checklist: Landing Page

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-19
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**16 of 16 — ready for `/speckit-plan`.**

### Iteration 1 — 2026-09-19

Three `[NEEDS CLARIFICATION]` markers, all scope-sized, none a detail:

- **FR-004 — the one action.** Production-launch kept sign-up open on the
  stated ground that the address was unpublished. A landing page publishes
  the product; whether it also publishes the open door is the creator's
  call, and it moves the admission-policy feature from "next" to "first" if
  it does.
- **FR-009 — the price.** Whether the numbers appear on the page decides
  what a request means: a "yes at this price" or a "tell me more".
- **FR-002 — the reader.** ISPs on the supported billing system, or every
  business that collects by SPEI with ISPs as the featured case. The
  constitution's purpose allows both; the page can only speak to one well.

Everything else passed on the first pass. The creator's framework request
from the feature input is recorded under *Assumptions* as a matter for
`/speckit-plan` (fixed stack table, Complexity Tracking) — it is not a
requirement here, so the spec stays free of implementation detail while the
directive is not lost.

### Iteration 2 — 2026-09-19

All three answered by the creator and recorded under **Clarifications**:

- **The action: both, in that order** (Q1 → C). The main action stays a
  request the creator answers; a subordinate link opens the product's own
  sign-up. The consequence is written down rather than implied: the open
  door becomes public, and the creator accepts the exposure production-launch
  had bounded by keeping the address private — one welcome allowance per
  stranger, sign-up limited per address. FR-004 now names two actions and
  forbids a third; FR-023 and FR-025 count and tag both doors; US1 gains a
  scenario for the visitor who leaves by the link; an edge case names the
  stranger who signs up. Admission policy stays *Deferred*, with the sign the
  creator should watch for — strangers outnumbering businesses in the page's
  own numbers. A second deferred item records that the product's sign-up
  does not yet keep the tag the page hands it.
- **The price: the model, not the numbers** (Q2 → B). FR-009 now names the
  model in words and says the figures come with the answer to a request.
  FR-014 flips from "keep the numbers in step" to "show no figure the
  operator can change", so a price change needs no page change; the pricing
  model joins the claims list (FR-013). The edge case about the operator
  changing the price is rewritten to match. "What it costs" became "how it
  is charged" in US1 and SC-001.
- **The reader: any business that collects by SPEI, ISP featured** (Q3 →
  B). Re-reading the product before writing it in: a business without the
  supported billing system makes no link from the panel — its own software
  asks through the API — and the panel says so itself. FR-002 and FR-007
  therefore say what *each* reader gets and forbid implying more; US1 gains
  a scenario for the non-ISP reader; FR-015's fifth question becomes "which
  system runs your billing", so the creator can tell a request served end to
  end from one served through the API (SC-003 splits them). SC-001's five
  readers now include at least three from ISPs.

Also tightened on this pass: the funnel step "reached the main action" is
now defined once as "began the request (touched its first answer)" and used
the same way in US2, FR-023 and the Step count entity, so it can be counted
without identifying anyone.

Requirements 32 → 32 (three rewritten, six touched), stories 3 → 3 (US1
gains two scenarios), success criteria 11 → 11, edge cases 11 → 13.

### Iteration 3 — 2026-09-19 (post-`/speckit-analyze`)

The cross-artifact analysis found one CRITICAL, one HIGH, seven MEDIUM and
six LOW findings. Still 16 of 16; the spec grew no requirement and lost
none — five wordings changed.

- **C1 (critical)** — the fixed stack table names React + Vite and Vitest 3;
  the landing is Astro 7 on Vitest 4.1. Handled the way governance
  prescribes: justified in the plan's Complexity Tracking, and the
  amendment text is now ready to paste under research D19 (a stack row, a
  one-phrase change to Principle VI, a note on the Tests row). **Open until
  the creator runs `/speckit-constitution`** — T049.
- **A1 (high)** — SC-002 named no device or network class. It now names the
  measurement (Chrome DevTools "Slow 4G" + 4× CPU throttling, or
  Lighthouse's mobile preset); the plan and the pre-flight repeat it.
- **G1** — SC-010 had no test. T032 asserts an empty cookie jar and storage
  after a session with no request; T033 asserts a counts row holds nothing
  but day, channel, step and count.
- **G2** — the "same person asks twice" edge case had no mark in the
  operator list. T038 shows "repetida" as icon + text on a shared contact;
  T034's fixture carries a pair.
- **G3** — "scripts do not run" had no browser assertion. T032 gains a
  context with JavaScript off: every section, every claim, the form's
  `method` and `action`.
- **G4** — the sending state and its reduced-motion floor had no assertion.
  T032 holds a route and asserts the breath after the shared threshold, and
  opacity-only under reduced motion.
- **G5** — SC-001 (five readers) had no home. The pre-flight and T050 now
  schedule the reading test and record what was said.
- **I1** — FR-024 promised "any period"; the tab offers three. FR-024 now
  says "a chosen period — the last 7, 30 or 90 days".
- **I2** — FR-001 allowed one confirmation address; the plan emits two
  outcome pages and a not-found page. FR-001 now says so.
- **A2, I3, I4, D1** — FR-023 defines "began" as the first focus inside the
  form; the Step-count entity defines a visit as a page load and names
  sign-up departures; FR-009 points at FR-014 instead of restating it.
- **U1, U2** — the site URL is read from `PUBLIC_SITE_URL` in the config
  rather than a CLI flag (T002, T044, T046); T005 notes the fallback if the
  Workers pool binds `ASSETS` itself.

Requirements 32 → 32, tasks 51 → 51 (six grew), success criteria 11 → 11.

### Iteration 4 — 2026-09-20 (design session)

The creator took the page to a design canvas
(https://claude.ai/artifact/WSMGzw9TsBvYj3RUyad6Sk, v8) and decided five
things there that the spec did not say. All five are recorded under
**Clarifications, Session 2026-09-20** and folded into the requirements;
the plan, research, data model, contracts, quickstart and tasks were brought
in step in the same commit. Still 16 of 16; 32 requirements, 3 stories, 11
success criteria; the spec gained one section.

- **One action** (reverses Q1 of 2026-09-19). The page asks for the
  WhatsApp and nothing else; sign-up is step 3 of the activation workflow
  the spec now carries (§The workflow the page starts), sent by the creator
  in the conversation. FR-004 rewritten; the `signup` step left FR-023 and
  FR-025; US1 scenario 9, US2 and US3 lose the second door; the header's
  sign-in link is the one link to the product. Research D22.
- **Three fields, the WhatsApp required** (FR-015): name and billing system
  only in the closing form; no email, business name, size band or note. The
  row records which form sent it. Research D23; data model and API
  contract rewritten.
- **Dark by default**, no toggle (FR-026; FR-028 and SC-006 now read "the
  palette it renders"). Research D15 amended.
- **Register**: close and Mexican in the body, formal where money,
  verification and the law are named; the headline fixed; SPEI named in
  the eyebrow, the subhead and the proof tile (FR-012).
- **No vendor on the page** (FR-002, FR-007): the connection is to "tu
  sistema de facturación"; which one is settled in the conversation.
- Also from the canvas: three doubts as a list (FR-008), the customer's
  screen at its two moments (FR-006), and the claims list following the
  page's words (research D11).

Two things the spec now depends on that are not code: the two WhatsApp
message templates (on the canvas's *Flujo* board) and the 60-second
recording of the customer's side — both in the pre-flight (T050).
