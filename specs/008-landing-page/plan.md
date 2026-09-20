# Implementation Plan: Landing Page

**Branch**: `008-landing-page` | **Date**: 2026-09-19, amended 2026-09-20 (design session: research D22, D23) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-landing-page/spec.md`

## Summary

Give the product a front door at its root address: one es-MX page, dark,
that says what Devolada does for a business that collects by SPEI — ISPs
first, no vendor named — shows both sides of a payment, says how it is
charged without a figure, and asks for exactly one thing: the reader's
WhatsApp, so the creator can answer in person and walk them to their first
verified payment (the workflow the spec carries). Then count who came, who
began and who asked, by channel, so the creator can answer "is there
demand?" with a number in thirty days.

The approach: a static Astro site served by an assets Worker with a short
script in front of it (research D1, D3), wearing the product's stylesheet
and rendering its shared atoms at build time so nothing framework-shaped
reaches the browser (D2). The request and the three counters live in the API's own
database as platform-owned rows (D5); the API answers the page's script
with the envelope and a plain form post with a redirect to an outcome page
(D6). The operator reads both — the numbers and the requests — in a third
tab of the screen they already use, and takes the list out as a file (D17).
Every sentence that claims something about the product comes from a typed
list with a basis, reviewed before publication (D11).

## Technical Context

**Language/Version**: TypeScript 5.9 strict, ESM; Node 22 (Astro 7 needs
≥ 22.12 — CI's `node-version: 22` resolves above it); pnpm 10 workspace.

**Primary Dependencies**: **new package** `apps/landing` — `astro@^7.3`
(static output, no adapter; Vite 8 inside it), `@astrojs/react@^6` with
`react` / `react-dom` 19 **at build time only** (the shared atoms rendered to
HTML, never hydrated, D2), `@astrojs/check`, `@tailwindcss/vite@^4.3` +
`tailwindcss@^4.3`, `@devolada/ui` (stylesheet, tokens, the atoms,
`buttonVariants`, `@devolada/ui/motion`), `@devolada/api`
(`./landing-schema` at build). **API** — Hono 4, `@hono/zod-validator`, zod
3, Drizzle: one new area. **Admin** — one new tab on the existing stack. No
new dependency in the API, the admin or `packages/ui` (D13).

**Storage**: Cloudflare D1, two additive tables — `access_requests`,
`landing_counts` — with no `business_id`: platform rows, like
`platform_settings` (D5, data-model.md). One migration, no backfill.

**Testing**: API — `@cloudflare/vitest-pool-workers` in workerd on a real
local D1, Resend intercepted at `https://api.resend.com` with `fetchMock`,
the limiter re-armed the way `rate-limit.test.ts` does. Landing Worker —
workerd too (`vitest@^4.1` + pool `^0.22`, the pair that shares Astro's
Vite 8, D13), `ASSETS` stubbed as a service binding answering a fixture
page. Admin tab — happy-dom + Testing Library + MSW with schema-validated
fixtures. Page — Playwright + axe on `astro preview` (D18). No Astro
Container API.

**Target Platform**: Cloudflare Workers — `devolada-landing` with static
assets, `run_worker_first: true`, custom domains `devoladapago.com` +
`www.devoladapago.com` (prod) and `dev.devoladapago.com` (dev), previews on
`*.workers.dev` (D14).

**Project Type**: pnpm workspace — Workers API + two React SPAs + one shared
UI package, **plus one static site with a Worker in front**.

**Performance Goals**: SC-002 — first screen readable within 2 s on a
mid-range phone over cellular (Chrome DevTools "Slow 4G" + 4× CPU
throttling, or Lighthouse's mobile preset), the page within 5 s, first
visit under 500 KB. Expected first visit: HTML ≈ 15 KB, stylesheet ≈ 20 KB, script
≈ 4 KB, the display font's latin subset ≈ 100 KB (Archivo Variable,
self-hosted), no raster image on the page — roughly 150 KB, measured by the
browser layer.

**Constraints**: constitution VI in full at the 360px floor; WCAG 2.2 AA in
the dark palette it renders (D15); es-MX product copy; no origin but the page's own and the API's
(D12); the one envelope with only a `code` on a browser-facing route (D6,
D7); no new Worker trigger — notification is one attempt, no sweep (D10);
the API's `ALLOWED_ORIGINS` and a new `LANDING_BASE_URL` are `vars`, never
literals.

**Scale/Scope**: one page in five routes (`/`, `/gracias`, `/no-enviada`,
`/privacidad`, `/404`), ~10 Astro components, one Worker script of ~60
lines, two tables, four API routes (two public, two operator), one admin
tab, one `packages/ui` export; four workflow files, `playwright.config.ts`
and `CLAUDE.md` touched; ~6 test files.

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1 design.*

| Principle | Gate | Verdict |
| --- | --- | --- |
| **I. Spec-Driven, Every Decision Cited** | spec → plan → tasks → implement under `specs/008-*`; every non-obvious rule cites `landing-page D<n>` | **Pass.** Spec committed (`394a4fd`); this plan and research.md carry D1–D21. Rules in code cite them; measured facts carry their date. |
| **II. Money Law** | integer cents, string-parsed decimals, business timezone owns "today" | **Pass, barely engaged.** The page shows no figure (FR-014, D7). The only "today" here is the platform's counters: the calendar day in `America/Mexico_City`, the platform's own timezone (D8). Timestamps stay milliseconds. |
| **III. One Contract, Pure Routers** | `routes/<area>/{index,handler,schema}.ts`, one envelope, `UPPER_SNAKE` codes, schema exported and shared; browser-facing routes carry only a `code` | **Pass.** New area `routes/landing/`; `index.ts` is wiring (two routers, `zValidator`, the limiter); logic in `handler.ts`; `@devolada/api/landing-schema` exported and consumed by the page at build, the admin, MSW and Playwright. JSON callers get the envelope with a bare `code`. A plain form post is answered with a 303 to an outcome page (D6) — a navigation, not a program's envelope; the constants the page stamps into the form come from the schema module (D7). |
| **IV. Tests Run on the Real Runtime** | workerd + real D1, no DB mocks, providers intercepted at their origin, config pins them; component layer on happy-dom + MSW; browser layer answers layout | **Pass.** API tests in workerd against migrated D1; Resend intercepted at `https://api.resend.com` (the pinned empty key in `vitest.config.ts` stays — the notice test sets a key and intercepts). The Worker script runs in workerd because `HTMLRewriter` lives nowhere else (D18). The admin tab on happy-dom + MSW with fixtures validated by the schema. The page on Playwright + axe on the palette it renders at 360/768/1280, with measured targets and focus (D18). The Container API is experimental and is not a gate. |
| **V. Tenant Isolation and Authorization by Area** | `business_id` on business rows, every query filtered, authorization by area and action, operator by `PLATFORM_OPERATOR_EMAILS` | **Pass.** The two tables are platform rows and carry no `business_id` on purpose, exactly as `platform_settings` does; no business query reads them. Operator reads sit behind `requireSession + requirePlatformOperator`. The public doors write a request or a counter and read nothing. No credential is stored. |
| **VI. Visual Foundations** | tokens only, declared sizes, icon + text, `packages/ui` the one definition, motion from tokens, self-hosted fonts, both palettes, 360 floor | **Pass, with a wording gap named.** The page imports the shared stylesheet as-is and renders the shared atoms at build through `@astrojs/react`, never hydrated, with `buttonVariants` on the header's sign-in link (D2); sizes 48 / 64 from the atoms and the recipe; outcomes are icon + words; the waiting state breathes with `animate-breath` on the shared thresholds (`@devolada/ui/motion`, D16); fonts self-hosted through the stylesheet; the dark palette by decision, verified on the palette rendered (D15); no raw value in any `.astro` file. The bullet says "both surfaces" and there are now three — D19 proposes the wording. |
| **VII. Every Test Cites Its Story** | every test file cites `<feature-slug> US<n>` | **Pass.** `landing-page US1` (request door, page, claims), `US2` (counts, operator reads and tab), `US3` (Worker redirect and injection, sharing, weight). Tasks carry the label. |
| **VIII. Absent Configuration Degrades, Never Breaks** | every binding documented, absent config degrades loudly, never throws at the edge | **Pass.** `LANDING_BASE_URL` unset → a form post is answered with the envelope instead of a redirect, and `env.ts` says so (D6). `RESEND_API_KEY` unset → the notice is logged (D10). `PLATFORM_OPERATOR_EMAILS` unset → the row says `NO_OPERATOR_EMAILS` and the list shows it. The landing's `API_ORIGIN` has a birth value in `wrangler.jsonc` and one per environment; the CSP never lacks it. The page reads in full when the API is down (FR-021; verified by the browser layer). |

**One departure, justified rather than hidden** — see *Complexity Tracking*:
the fixed stack table names React + Vite for frontends; the landing is Astro.
D19 proposes the amendment; the plan does not route around the table.

**Re-checked after Phase 1 (2026-09-19)**: the design added no gate the
table above does not answer. Two things the design made concrete are worth
naming: the request door's second answer (a 303 for a plain form post, D6)
is a navigation and not a second envelope, so III holds; and the version
split the landing's tests need also touches the stack table's *Tests* row,
so D19's amendment names that row too.

## Project Structure

### Documentation (this feature)

```text
specs/008-landing-page/
├── spec.md                      # what and why (committed, 394a4fd)
├── plan.md                      # this file
├── research.md                  # Phase 0 — D1..D21
├── data-model.md                # Phase 1 — the two tables, the claims list, the tag rule
├── quickstart.md                # Phase 1 — how to run it, prove each story, and publish
├── contracts/
│   ├── landing-api.md           # Phase 1 — the zod contracts and the two answers of the request door
│   └── landing-page.md          # Phase 1 — the page's DOM contract and the Worker's behaviours
├── checklists/
│   └── requirements.md          # 16/16
└── tasks.md                     # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
apps/landing/                                   # NEW — the page and its Worker
├── package.json                                # @devolada/landing: dev 5176, build, preview, typecheck, test
├── astro.config.ts                             # output static, build.format "file", inlineStylesheets "never", react() integration, @tailwindcss/vite, ssr.noExternal
├── tsconfig.json                               # extends astro/tsconfigs/strict
├── tsconfig.worker.json                        # the Worker's own, with workers-types
├── wrangler.jsonc                              # main worker/index.ts, assets ./dist + ASSETS binding + run_worker_first, 404-page, custom domains, API_ORIGIN per env
├── vitest.config.ts                            # pool-workers, ASSETS stubbed as a service binding (D18)
├── public/
│   ├── favicon.svg                             # the admin's mark (D21)
│   ├── og.svg · og.png                         # 1200×630, exported by hand (D21)
│   └── robots.txt
├── src/
│   ├── styles/global.css                       # @import "@devolada/ui/styles.css";
│   ├── content/claims.ts                       # the reviewed claims list: { id, text, basis } (D11)
│   ├── content/legal.ts                        # the responsible party's name and address for the notice (D20)
│   ├── layouts/Base.astro                      # <html lang="es-MX" data-theme="dark">, title, description, canonical, Open Graph, theme colour
│   ├── components/                             # every component renders @devolada/ui atoms at build — Field, Input, Alert, Button, StatusBadge — with no client:* directive; the sign-in link takes buttonVariants() (D2)
│   │   ├── Header.astro                        # the mark and the sign-in link for existing customers (FR-004)
│   │   ├── Hero.astro                          # FR-003 first screen: eyebrow naming SPEI, headline, subhead, the hero form · FR-011 the customer's line
│   │   ├── Proof.astro                         # the three tiles: SPEI verificado contra Banxico · directo a tu CLABE · primeros pagos gratis
│   │   ├── CustomerScreen.astro                # FR-006 the customer's screen at its two moments — verifying (breath), registered
│   │   ├── Benefits.astro                      # FR-005 / FR-008 the four things the reader stops doing, the two brakes inside them
│   │   ├── HowItWorks.astro                    # FR-006 both sides, the payer page's words
│   │   ├── System.astro                        # FR-002 / FR-007 "se conecta con tu sistema de facturación", no vendor named
│   │   ├── Doubts.astro                        # FR-008 the three questions
│   │   ├── Pricing.astro                       # FR-009 the model, no figure
│   │   ├── RequestForm.astro                   # FR-015..FR-021 — both forms (hero: one field; full: three), constraints stamped from the schema (D7), hidden channel + form + honeypot, the script
│   │   └── Footer.astro                        # FR-010 contact · FR-022 privacy link
│   └── pages/
│       ├── index.astro
│       ├── gracias.astro                       # received (D6)
│       ├── no-enviada.astro                    # refused / limited / unavailable, with the contact address (D6)
│       ├── privacidad.astro                    # FR-022 (D20)
│       └── 404.astro
├── worker/
│   └── index.ts                                # www → apex, ?ch= injection, headers + CSP, ASSETS passthrough (D3, D4, D12)
└── test/
    ├── worker.test.ts                          # landing-page US3
    └── content.test.ts                         # landing-page US1 — every claim has a basis; the legal identity is no placeholder (D11, D20)

apps/api/
├── migrations/00NN_landing_page.sql            # access_requests + landing_counts (additive)
├── src/db/schema.ts                            # + accessRequests, landingCounts, with their D-citations
├── src/env.ts                                  # + LANDING_BASE_URL (unset → envelope instead of redirect, D6)
├── src/email/sender.ts                         # + sendAccessRequestNotice (D10)
├── src/routes/landing/
│   ├── index.ts                                # landingPublicRoute (/requests, /events) · landingOperatorRoute (/requests, /counts)
│   ├── handler.ts                              # store + notify, count, list, counts
│   └── schema.ts                               # the contracts + the constants the page stamps (D7)
├── src/routes/platform/index.ts                # mounts landingOperatorRoute at /landing
├── src/index.ts                                # app.route("/landing", landingPublicRoute)
├── package.json                                # + "./landing-schema"
├── wrangler.jsonc                              # ALLOWED_ORIGINS + landing origins; LANDING_BASE_URL per env (D14)
└── test/landing.test.ts                        # landing-page US1, US2

apps/admin/
├── src/features/operator/OperatorScreen.tsx    # + tab "Landing"
├── src/features/operator/LandingTab.tsx        # NEW — counts by channel, requests, CSV in the browser (D17)
└── test/operator-landing.test.tsx              # landing-page US2

packages/ui/
├── src/lib/motion.ts                           # NEW — FLASH_THRESHOLD_MS, MINIMUM_VISIBLE_MS (moved from pending.tsx, D16)
├── src/components/pending.tsx                  # imports them
└── package.json                                # + "./motion"

playwright.config.ts                            # + LANDING on 4176 (build, then astro preview)
tests/e2e/landing.spec.ts                       # landing-page US1, US3 — first screen, the dark palette, targets, keyboard, widths, claims, both forms, weight
.github/workflows/ci.yml                        # preview: build landing (dev API baked in) + upload devolada-landing-dev
.github/workflows/deploy-dev.yml                # build + deploy landing; smoke probes DEV_LANDING_URL
.github/workflows/deploy-prod.yml               # build + deploy landing; "What landed" adds it; smoke probes PROD_LANDING_URL
.github/workflows/rollback-prod.yml             # worker choice gains `landing`
CLAUDE.md                                       # commands (5176), architecture line, the fourth Worker
```

**Structure Decision**: one new app, no new package. The page and the
script in front of it are one deployable and live together in
`apps/landing`; everything that stores, counts or notifies lives where the
product already does those things — the API's `routes/landing/` area — and
everything the operator reads lives on the screen they already open. The
one shared change is a two-constant export from `packages/ui`, so the
landing and `Pending` read a single definition of the waiting thresholds.
The atoms themselves are consumed unchanged: React is a build-time
dependency of the landing and never reaches the browser (D2).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **The frontend stack row names React 19 + Vite 6; `apps/landing` is Astro 7.** | The page is content: it must read before any script, cost the visitor almost nothing and keep reading when the product is down (FR-021, FR-030, SC-002, SC-009). A static build gives those as its output rather than as discipline, and the creator asked for Astro by name. | Building it as a third React SPA ships a client runtime for one form and makes every one of those properties something a reviewer checks. The departure is contained to one app, the visual law is untouched (the page consumes the same stylesheet and recipes, D2), and D19 proposes the stack-table row and the one-word change to Principle VI so the constitution describes the product as built. |
| **Two Vitest majors in the workspace**: the landing tests on 4.1 with pool 0.22; the other packages on 3.2.7 — and the stack table's *Tests* row says "Vitest 3". | Astro 7 mandates Vite 8; Vitest 3 declares no support for it (D13). The landing's own tests are two files — the Worker and the content list. | Pinning the landing to 3.2.7 + pool 0.8.71 works but installs a second Vite inside the package and tests against an older miniflare than the wrangler the deploy uses. `pnpm -r test` runs each package's own script, so the split costs nothing at the gate. D19's amendment names it in the *Tests* row; revisited when the other packages move. |

## Dependencies and sequencing

- **From the creator, before publication** (quickstart, *Pre-flight*): the
  legal name and address for the privacy notice (D20) — the build refuses
  the placeholders; the operator address list is already `PLATFORM_OPERATOR_EMAILS`.
- **Repository variables**: `DEV_LANDING_URL`, `PROD_LANDING_URL` for the
  smoke probes; the existing `DEV_API_URL` / `PROD_API_URL` feed
  `PUBLIC_API_URL` at build (D14). Set before the first merge, or the probe
  warns and skips like the others do.
- **First deploy bootstraps the hosts**: `custom_domain: true` creates the
  DNS records on the first `deploy-dev`; the preview upload on the first PR
  warns instead of failing (`preview-upload.sh` already tolerates a Worker
  that does not exist yet).
- **Migration number**: `.specify/bugs/links-roster-cap` carries a migration
  numbered 0033 on its own branch. This feature takes the next number on
  `main` at implementation time; drizzle-kit assigns it.
- **The constitution amendment (D19)** lands in the same release, by the
  creator through `/speckit-constitution`; `/speckit-analyze` will read the
  stack table as CRITICAL until it does.
- **Not touched, on purpose**: the product's sign-up and sign-in (the page
  only links to sign-in), the cron (no notification retry, D10),
  `tokens.css` (no new value — contrast-lint stays green by construction).
- **Outside this tree, before publication** (spec §The workflow the page
  starts; quickstart *Pre-flight*): the two WhatsApp message templates
  (drafted on the canvas's Flujo board) and the 60-second recording of the
  customer's side.
