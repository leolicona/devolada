---

description: "Task list for 008 — Landing Page"
---

# Tasks: Landing Page

**Input**: Design documents from `/specs/008-landing-page/` — amended 2026-09-20 with the design session (spec Clarifications; research D22, D23): one action, three fields, dark by default, no vendor named

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/landing-api.md](./contracts/landing-api.md), [contracts/landing-page.md](./contracts/landing-page.md), [quickstart.md](./quickstart.md)

**Tests**: included, and not optional here. Constitution IV requires each
layer to answer only what it can — the API and the Worker in workerd, the
admin tab on happy-dom + MSW, the page in a real browser — and VII requires
every test file to cite its story. Every test task below carries
`landing-page US<n>`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished work)
- **[Story]**: US1 / US2 / US3, mapping to spec.md
- Every task names the file it touches

---

## Phase 1: Setup

**Purpose**: the new package, its build and its Worker config, and the one
shared export the page needs from `packages/ui`.

- [ ] T001 Create `apps/landing/package.json` — name `@devolada/landing`, `"type": "module"`, scripts `dev` (`astro dev`), `build` (`astro build`), `preview` (`astro preview`), `typecheck` (`astro check && tsc --noEmit -p tsconfig.worker.json`), `test` (`vitest run`); dependencies `astro@^7.3`, `@astrojs/react@^6`, `react@^19`, `react-dom@^19`, `@devolada/ui: workspace:*`; devDependencies `@astrojs/check@^0.9`, `@tailwindcss/vite@^4.3`, `tailwindcss@^4.3`, `typescript@^5.9`, `@types/react@^19`, `@types/react-dom@^19`, `vitest@^4.1`, `@cloudflare/vitest-pool-workers@^0.22`, `@cloudflare/workers-types`, `@devolada/api: workspace:*` (research D2, D13). Run `pnpm install` from the root and confirm `node --version` ≥ 22.12 — Astro 7 refuses below it.
- [ ] T002 Create `apps/landing/astro.config.ts` — `site: process.env.PUBLIC_SITE_URL ?? "https://devoladapago.com"` (CI sets `PUBLIC_SITE_URL` per environment, so no CLI flag is relied on), `output: "static"`, `trailingSlash: "never"`, `build: { format: "file", inlineStylesheets: "never" }`, `integrations: [react()]`, `vite: { plugins: [tailwindcss()], ssr: { noExternal: ["@devolada/ui", "@devolada/api"] } }`, `server: { port: 5176 }` (research D1, D2, D12). Add `apps/landing/src/env.d.ts` typing `PUBLIC_API_URL` on `ImportMetaEnv`, and `apps/landing/src/lib/urls.ts` exporting `API_URL` (`import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787"`) and `LOGIN_URL` derived from the site host (`https://app.<host>/login`, local fallback `http://localhost:5174/login`) per [contracts/landing-page.md](./contracts/landing-page.md). Cite `landing-page D14`.
- [ ] T003 [P] Create `apps/landing/tsconfig.json` extending `astro/tsconfigs/strict` (include `src`), and `apps/landing/tsconfig.worker.json` with `@cloudflare/workers-types` for `worker/` and `test/`.
- [ ] T004 [P] Create `apps/landing/wrangler.jsonc` — `name: devolada-landing`, `main: "worker/index.ts"`, `compatibility_date: "2025-05-01"`, `assets: { directory: "./dist", binding: "ASSETS", not_found_handling: "404-page", run_worker_first: true }`, top-level `vars.API_ORIGIN: "http://localhost:8787"`, `env.dev` (`devolada-landing-dev`, route `dev.devoladapago.com` custom domain, `API_ORIGIN: https://api.dev.devoladapago.com`) and `env.prod` (`devolada-landing`, routes `devoladapago.com` **and** `www.devoladapago.com`, `API_ORIGIN: https://api.devoladapago.com`). Comment each block with `landing-page D3 / D12 / D14` and say what `API_ORIGIN` feeds (the CSP).
- [ ] T005 [P] Create `apps/landing/vitest.config.ts` with `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config` — `wrangler: { configPath: "./wrangler.jsonc" }` and `miniflare.serviceBindings.ASSETS` answering a fixture page from `apps/landing/test/fixtures/index.html` (two forms, each with a hidden `channel` input, plus one non-HTML path) so the Worker is tested in workerd without a build (research D18). If the pool configures an `ASSETS` binding of its own from the config's `assets` block and the two collide, declare `main: "worker/index.ts"` inline in the vitest config and omit `wrangler.configPath`.
- [ ] T006 [P] Create `apps/landing/src/styles/global.css` with the single line `@import "@devolada/ui/styles.css";` (research D2); `apps/landing/public/robots.txt` allowing everything; `apps/landing/public/favicon.svg` copied from `apps/admin/public/icon.svg`; `apps/landing/public/og.svg` (1200×630, the wordmark legible at thumbnail size) and its exported `og.png` (research D21).
- [ ] T007 [P] Move `FLASH_THRESHOLD_MS` and `MINIMUM_VISIBLE_MS` out of `packages/ui/src/components/pending.tsx` into a new `packages/ui/src/lib/motion.ts` (exported, with the two comments that explain them), import them back into `pending.tsx`, and add `"./motion": "./src/lib/motion.ts"` to `exports` in `packages/ui/package.json`. Cite `landing-page D16`. `pnpm --filter @devolada/ui test` stays green.

**Checkpoint**: `pnpm --filter @devolada/landing build` produces `dist/` from an empty `src/pages/index.astro`; `pnpm -r --if-present typecheck` passes.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the contract, the two tables, the bindings, and the page's
skeleton — every story renders into these.

**⚠️ No user story work begins until this phase is complete.**

- [ ] T008 Create the contract in `apps/api/src/routes/landing/schema.ts` per [contracts/landing-api.md](./contracts/landing-api.md) — `BILLING_SYSTEMS`, `FORMS`, `FIELD_LIMITS`, `WHATSAPP_PATTERN`, `CHANNEL_PATTERN`, `accessRequestBody` (the WhatsApp required, name and system optional, `form` stamped, refined so a `hero` request carries neither name nor system), `accessRequestReceived`, `landingEventBody` (`visit` | `began`), `accessRequestRow` (with `repeated`), `accessRequestList`, `landingCountRow`, `landingCounts`, plus the derived types. Pure zod: no import from `src/db`, `src/auth`, Hono or Drizzle. Export it as `"./landing-schema": "./src/routes/landing/schema.ts"` in `apps/api/package.json`. Cite `landing-page D4 / D7 / D23`.
- [ ] T009 Add `accessRequests` and `landingCounts` to `apps/api/src/db/schema.ts` per [data-model.md](./data-model.md) — `whatsapp` (not null), `name` and `billing_system` (null; the closing form's answers), `form` (`hero` | `full`), `channel`, the notice columns; the `access_requests_created_idx` index; `landing_counts` with the unique `landing_counts_day_channel_step_idx` and the three steps — with comments citing `landing-page D5` (platform rows, no `business_id`, like `platform_settings`), `D8` (the day is Mexico City's; a visit is a page load), `D9` (the honeypot is never a column), `D10` (`notified_at` / `notify_error`) and `D23` (three fields, which form).
- [ ] T010 Generate the migration with `pnpm --filter @devolada/api db:generate` and confirm `apps/api/migrations/` gained one additive file — two `CREATE TABLE`, two indexes, nothing else — numbered after whatever `main` holds at the time (`.specify/bugs/links-roster-cap` carries a 0033 on its own branch; plan.md, *Dependencies*). Apply locally with `db:migrate:local`.
- [ ] T011 [P] Add `LANDING_BASE_URL?: string` to `Bindings` in `apps/api/src/env.ts` with the sentence constitution VIII requires — unset means a plain form post is answered with the envelope instead of a redirect (research D6). In `apps/api/wrangler.jsonc` add `LANDING_BASE_URL` per environment (`https://dev.devoladapago.com`, `https://devoladapago.com`) and extend `ALLOWED_ORIGINS` with the landing origins — dev: `https://dev.devoladapago.com` and `*-devolada-landing-dev.devoladapago-14b.workers.dev`; prod: `https://devoladapago.com,https://www.devoladapago.com` (research D14). In `apps/api/vitest.config.ts` pin `LANDING_BASE_URL: "https://landing-test.devolada.internal"` beside the other pins, with a comment saying a test that wants the unset behaviour strips it the way `rate-limit.test.ts` strips `AUTH_RATE_LIMIT`.
- [ ] T012 [P] Create `apps/landing/src/content/claims.ts` — a frozen `CLAIMS` array of `{ id, text, basis }` and a `claim(id)` accessor (research D11, amended 2026-09-20). Entries, in es-MX exactly as the canvas (v12) says them, with the bases D11 lists: `money-never-touches`, `system-stays-record`, `spei-verified`, `auto-reactivation`, `no-fake-receipts`, `partial-visible`, `verification-time`, `any-bank`, `system-down`, `pricing-model` (**no figure**), `reply-sla`, `activation-together`. Every `basis` non-empty; no claim names a vendor.
- [ ] T013 [P] Create `apps/landing/src/content/legal.ts` — `RESPONSABLE = "{{RESPONSABLE}}"`, `DOMICILIO = "{{DOMICILIO}}"` (the creator replaces them; research D20) and `CONTACT_EMAIL = "hola@devoladapago.com"` with a comment that it MUST equal the platform's `support_email` setting (the value `GET /support` answers) — the pre-flight checks it.
- [ ] T014 [P] Create `apps/landing/src/layouts/Base.astro` — `<html lang="es-MX" data-theme="dark">` (research D15: dark for everyone, no toggle), `<head>` with `<title>`, `<meta name="description">`, `<link rel="canonical">` built from `Astro.site`, Open Graph (`og:title`, `og:description`, `og:image` → `/og.png`, `og:locale` `es_MX`), `twitter:card summary_large_image`, one `<meta name="theme-color">` reading the dark surface token's value, the favicon, and the global stylesheet import; a `<main>` slot and a footer slot; no `<script>` in `<head>`. Props: `title`, `description`.

**Checkpoint**: `@devolada/api/landing-schema` imports from the admin and from an `.astro` file; the local D1 has both tables; the page builds with the layout and no sections.

---

## Phase 3: User Story 1 — An ISP owner understands Devolada and asks for it (Priority: P1) 🎯 MVP

**Goal**: the page reads on a phone, dark, names SPEI and no vendor, says how it is charged (no figure), and takes the reader's WhatsApp — from the one-field hero form or the three-field closing form — so it reaches the creator as typed, with or without scripts.

**Independent Test**: publish (or `astro preview`), hand the address to someone who runs an ISP and has never seen Devolada, watch them read it at 360 px and send a request; the request is in `access_requests` and the notice reached (or was logged for) the operator, with every field as typed.

### Tests for User Story 1 (the contract from Phase 2 is what they import)

- [ ] T015 [P] [US1] API test in `apps/api/test/landing.test.ts` citing `landing-page US1` — a JSON request from the hero form is stored with the WhatsApp as typed, `form = "hero"`, `name` and `billing_system` null and `channel = "direct"` when none is sent; a closing-form request stores the name and the system (FR-015, FR-017); a missing or malformed WhatsApp answers `VALIDATION_ERROR` with no row; a filled honeypot answers `REQUEST_REFUSED` with no row (FR-019); the sixth request in an hour from one address answers 429 with the env stripped of `AUTH_RATE_LIMIT` as `rate-limit.test.ts` does (FR-019); a form-urlencoded post answers `303` to `${LANDING_BASE_URL}/gracias`, a refused one to `/no-enviada?motivo=REQUEST_REFUSED`, and with `LANDING_BASE_URL` stripped from the env the same post answers the envelope (research D6); the notice — with `RESEND_API_KEY` set for the test and `https://api.resend.com` intercepted with `fetchMock` as `prepaid-credit.test.ts` does — writes `notified_at`; a provider 500 writes `notify_error = "RESEND_500"`; no key writes `NO_RESEND_KEY` and logs; storing a request counts `sent` for its channel and Mexico City day in `landing_counts` (FR-018, research D8, D10).
- [ ] T016 [P] [US1] Content test in `apps/landing/test/content.test.ts` citing `landing-page US1` — every entry in `claims.ts` has a unique `id` and a non-empty `basis`; `legal.ts` carries no `{{` placeholder (research D11, D20). This is the test that refuses to publish an unreviewed claim or an unnamed responsible party.

### Implementation for User Story 1 — the door

- [ ] T017 [US1] Write `postAccessRequest` in `apps/api/src/routes/landing/handler.ts` — read the body by `Content-Type` (JSON or form-urlencoded), parse with `accessRequestBody`, refuse a non-empty `website` with `REQUEST_REFUSED`, normalise `channel` with `CHANNEL_PATTERN` → `direct`, insert the row with its `form`, increment `landing_counts(sent)` with one `ON CONFLICT DO UPDATE` for `dayInMexicoCity(now)`, hand `sendAccessRequestNotice` to `c.executionCtx.waitUntil`, and answer per [contracts/landing-api.md](./contracts/landing-api.md): the envelope for JSON, a 303 to `${LANDING_BASE_URL}/gracias` or `/no-enviada?motivo=<code>` for a form post, the envelope again when the binding is unset. Put `dayInMexicoCity` and `channelOrDirect` in the same file; cite `landing-page D4 / D6 / D8 / D9 / D23`.
- [ ] T018 [US1] Add `sendAccessRequestNotice(env, request)` to `apps/api/src/email/sender.ts` — to every address in `PLATFORM_OPERATOR_EMAILS`, subject `Nuevo WhatsApp — <whatsapp>`, body with every field as typed, the form and the channel; returns `{ notifiedAt }` or `{ error: "NO_RESEND_KEY" | "NO_OPERATOR_EMAILS" | "RESEND_<status>" }`, logging the notice when there is no key exactly as the OTP path does; the caller writes the outcome on the row (research D10, constitution VIII).
- [ ] T019 [US1] Create `apps/api/src/routes/landing/index.ts` — a pure router: `landingPublicRoute` with `POST /requests` behind `rateLimitRoute("landing-request", { window: 3600, max: 5 })` and a small content-type-aware validator (`zValidator("json", …)` when the request is JSON, `zValidator("form", …)` otherwise) answering `VALIDATION_ERROR` in the envelope like `direct-payments/index.ts` does; export an empty `landingOperatorRoute` for US2 to fill. Mount it in `apps/api/src/index.ts` as `app.route("/landing", landingPublicRoute)` — inside CORS, unlike `/v1`.

### Implementation for User Story 1 — the page

- [ ] T020 [US1] Create `apps/landing/src/components/Hero.astro` — the first screen (FR-003, FR-012): the eyebrow *Cobros por SPEI para ISPs en México*, the headline *Cobrar por transferencia, sin la talacha.* with the second half in the link colour, the subhead naming SPEI, Banxico and the CLABE, then `<RequestForm variant="hero" />` (T026) with no panel around it — the button is the form's one accent (D25) — `claim("reply-sla")` under it with `data-claim`, and, under a hairline, the one-line note for a customer looking for where to pay (FR-011). Fits a 360×740 viewport with the form's button inside it; body text 16 px; "cobrar" for the business, "pago" for the customer.
- [ ] T021 [P] [US1] Create `apps/landing/src/components/System.astro` — the accent panel *Se conecta con tu sistema de facturación* (FR-002, FR-007): Devolada tells the reader's system when a payment is verified and it reactivates the service; which system they use is settled in the conversation; no vendor named. Renders `claim("system-stays-record")` and `claim("spei-verified")` with `data-claim` attributes. And `apps/landing/src/components/Proof.astro` — the three tiles *SPEI verificado contra Banxico*, *Directo a tu CLABE*, *Primeros pagos gratis*, icon + words, each carrying `data-claim-echo` for the claim it shortens (`spei-verified`, `money-never-touches`, `pricing-model`) — echoes, never the claims' text, which `System.astro`, `Benefits.astro` and `Pricing.astro` render once by id (`/speckit-analyze` I1).
- [ ] T022 [P] [US1] Create `apps/landing/src/components/Benefits.astro` — *Lo que te quitas de encima*, four cards of one line each, the two brakes inside them (FR-005, FR-008): `auto-reactivation`, `no-fake-receipts`, `partial-visible`, `money-never-touches`; each an icon, a title and its claim with `data-claim`.
- [ ] T023 [P] [US1] Create `apps/landing/src/components/HowItWorks.astro` — the business's three steps and the customer's three (FR-006); the customer's steps use the payer page's words verbatim: "Haz tu transferencia", "Envía tu comprobante", "Tu pago fue registrado". And `apps/landing/src/components/PaymentFlow.astro` — *Lo que pasa cuando te pagan*, one payment as three numbered moments on a rail (FR-006, D25), an `<ol>`: **1 Tu cliente paga** / *Transfiere por SPEI a tu CLABE.* with the customer's payment screen (the mark, *Pago de internet*, the amount in tabular numerals, the CLABE ending); **2 Se verifica la transferencia** / *Devolada la confirma con Banxico.* with that screen's two moments — the *Verificando tu pago…* `Alert` breathing with `animate-breath`, an arrow, the green *Tu pago fue registrado.* `Alert` — icon + words; **3 El internet vuelve solo** / *Tu sistema reconecta al cliente. Tú no mueves un dedo.* with the business's system: *Tu sistema de facturación*, a customer row and `<StatusBadge status="reconnected" />` (*Reconectado*). No vendor named, no timestamps; every atom rendered at build.
- [ ] T024 [P] [US1] Create `apps/landing/src/components/Doubts.astro` — *Lo que seguro te preguntas*, the three questions (FR-008): `verification-time`, `any-bank`, `system-down`, each answer a claim with `data-claim`.
- [ ] T025 [P] [US1] Create `apps/landing/src/components/Pricing.astro` — the model only (FR-009, FR-014): `claim("pricing-model")` and *Las cifras, por WhatsApp.* No number anywhere in the file; the content test's basis check is the reviewer's cue.
- [ ] T026 [US1] Create `apps/landing/src/components/RequestForm.astro` with a `variant` prop — `hero` (the WhatsApp alone) and `full` (WhatsApp, name, `billingSystem`), both `<form data-form={variant} method="post" action={`${API_URL}/landing/requests`} enctype="application/x-www-form-urlencoded">` (the full one also `id="solicitar"`), rendering the shared `Field` + `Input` (and a native `<select>` inside `Field`) and the shared `Button` (`size="decisive"`, `type="submit"`, *Quiero probarlo*) from `@devolada/ui` **without any `client:*` directive** (research D2); constraints stamped from the schema constants — `required` and `type="tel"` + `pattern` from `WHATSAPP_PATTERN` on the WhatsApp, `maxlength` from `FIELD_LIMITS` on the name, the `<option>`s from `BILLING_SYSTEMS` with es-MX labels (research D7, D23); hidden `<input name="form" value={variant}>`, `<input name="channel" value="">` and the honeypot `<input name="website">` hidden visually and accessibly (`tabindex="-1"`, `autocomplete="off"`, `aria-hidden="true"`); the `[data-field]` / `[data-error]` hooks; a `[data-sending]` region; one shared `Alert` per outcome under `[data-outcome]` (`aria-live="polite"`), hidden until the script shows one; on the full variant `claim("activation-together")` as the intro line with `data-claim`, and the short privacy notice beside the button with a link to `/privacidad` (FR-022). Every name per [contracts/landing-page.md](./contracts/landing-page.md).
- [ ] T027 [US1] Create `apps/landing/src/scripts/form.ts`, imported by a `<script>` in `RequestForm.astro` and wired to every `form[data-form]` on the page — on submit: `preventDefault`, `checkValidity()`, render an es-MX message from each invalid field's `ValidityState` into its `[data-error]` (the WhatsApp: *Escribe tu WhatsApp con lada, como 55 1234 5678.*) and keep everything typed (FR-020); else POST JSON to `${API_URL}/landing/requests`, apply the sending state (`animate-breath` + `aria-busy` after `FLASH_THRESHOLD_MS`, held `MINIMUM_VISIBLE_MS`, from `@devolada/ui/motion` — research D16) with the copy *Enviando…*, then show the outcome from the envelope's `code` (`REQUEST_REFUSED`, `TOO_MANY_REQUESTS`, `VALIDATION_ERROR`) or the received outcome — *¡Listo! Te escribimos por WhatsApp en menos de un día hábil.* (FR-016) — or *No pudimos enviar tu WhatsApp* with `CONTACT_EMAIL` when the fetch fails (FR-021). No tag handling, no theme switch. Cite `landing-page D7 / D16`.
- [ ] T028 [P] [US1] Create `apps/landing/src/components/Header.astro` — the mark, the wordmark and the sign-in link `<a data-login href={LOGIN_URL}>Entrar</a>` with `buttonVariants({ variant: "link" })`, at least 48 px tall, the only link to the product on the page (FR-004) — and `apps/landing/src/components/Footer.astro` — the human contact as `mailto:${CONTACT_EMAIL}` visible without taking the action (FR-010), the `/privacidad` link (FR-022), *Hecho en México*, each link at least 48 px tall (padding, not font size — FR-029), and nothing that looks like a second call to act.
- [ ] T029 [P] [US1] Create the pages — `apps/landing/src/pages/index.astro` assembling Header → Hero → Proof → PaymentFlow → Benefits → HowItWorks → System → Doubts → Pricing → `<RequestForm variant="full" />` under *Arranca hoy* → Footer in the `Base` layout; `apps/landing/src/pages/gracias.astro` (*¡Listo! Te escribimos por WhatsApp.* — *En menos de un día hábil* — and the panel *Mientras tanto, ten a la mano: tu CLABE, el nombre de tu sistema de facturación, cuántos clientes tienes*; asks for nothing further, FR-016; no link to sign-up); `apps/landing/src/pages/no-enviada.astro` (the email fallback with `CONTACT_EMAIL`, a way back, and a tiny inline `<script>` that reads `?motivo=` to narrow the sentence when scripts run; research D6); `apps/landing/src/pages/404.astro`.
- [ ] T030 [P] [US1] Create `apps/landing/src/pages/privacidad.astro` — the full notice per research D20 from `legal.ts`: responsible party and address, the data collected (the WhatsApp number and, when given, the name and the billing system), the purpose (writing back to answer the request; no secondary purpose), no transfers, how to exercise access, correction, cancellation and opposition and how to revoke consent (via `CONTACT_EMAIL`), how changes are announced. es-MX, body 16 px, no form.
- [ ] T031 [US1] Add the landing to `playwright.config.ts` — `LANDING_PORT = 4176`, `export const LANDING`, a third `webServer` entry `pnpm --filter @devolada/landing build && pnpm --filter @devolada/landing preview --port 4176 --host` with the same `reuseExistingServer` and timeout as the other two, and a comment saying why `astro preview` and not wrangler (research D18). Add `stubLandingApi(page)` to `tests/e2e/stubs.ts` answering `**/landing/requests` and `**/landing/events` with schema-validated fixtures from `@devolada/api/landing-schema`.
- [ ] T032 [US1] Browser test in `tests/e2e/landing.spec.ts` citing `landing-page US1` — the root carries `data-theme="dark"` and no `/signup` href exists anywhere on the page while `header a[data-login]` points at the `app.` host's `/login` (FR-004, D15); at 360×740 the hero form's button ends inside the viewport and the page reads without zoom (FR-003); zero sideways scroll at 360 / 768 / 1280 (FR-029) using `expectNoHorizontalScroll` from `responsive.spec.ts`; every `a, button, input, select` ≥ 48 px and both submit buttons 64 px; axe with no violation on the dark palette (FR-028); tab order reaches both forms and the sign-in link with a visible focus; the three payer-page strings present; every `text` in `claims.ts` present on the page (import the list; SC-008); the hero form: a missing or malformed WhatsApp names the field next to it; the closing form: name and system optional; received / `REQUEST_REFUSED` / `TOO_MANY_REQUESTS` / a failed route each render their outcome, the last with `CONTACT_EMAIL` (FR-021); the total transferred bytes of a first visit under 500 KB by summing `page.on("response")` (SC-002); **with scripts off** (a context with `javaScriptEnabled: false`) every section, every claim and both `form[data-form][method="post"][action]` are present (FR-030, the "scripts do not run" edge case); **after a session with no request** `document.cookie` is empty and `localStorage.length` is 0 (SC-010); **while a held route waits** (`holdApiRoute` from `stubs.ts`) `[data-sending]` gains `animate-breath` and `aria-busy="true"` after the shared threshold and keeps them for the shared minimum, and under `reducedMotion: "reduce"` the region still changes opacity only (research D16, the reduced-motion edge case).

**Checkpoint**: a prospect can read the page on a phone and send a request that reaches the creator. MVP is deliverable here — without US2 the creator reads requests from the notice and the database, not from the panel.

---

## Phase 4: User Story 2 — The creator reads the answer (Priority: P2)

**Goal**: three steps counted by day and channel with nothing that identifies a visitor, and one operator tab that shows the counts, the shares, the requests with their notice state and the repeated-number mark, and exports the list.

**Independent Test**: drive known counts of visits, begun requests and sent requests from two tagged addresses and both forms; the operator tab shows those exact numbers by channel and every request with its answers and its form; the CSV holds the same rows.

### Tests for User Story 2

- [ ] T033 [US2] API test in `apps/api/test/landing.test.ts` citing `landing-page US2` (same file as T015 — sequenced, not parallel) — `POST /landing/events` increments one `landing_counts` row per `(day, channel, step)` and a second event increments it again; `step = "sent"` from the page answers `VALIDATION_ERROR` (the API alone counts it); a channel outside `CHANNEL_PATTERN` counts as `direct`; the 61st event in an hour answers 429 with the limiter armed; `GET /platform/landing/requests` answers newest first with a working `cursor`, marks `repeated` on every row whose WhatsApp another row carries, and answers 401 without a session and 403 for a member who is not a platform operator; `GET /platform/landing/counts` defaults to the last 30 Mexico City days and honours `from` / `to` (FR-023, FR-024, FR-025); a counted event leaves a `landing_counts` row holding nothing but `day`, `channel`, `step` and `count` — no address, no agent (SC-010).
- [ ] T034 [P] [US2] Component test in `apps/admin/test/operator-landing.test.tsx` citing `landing-page US2` — add `handlers.landingRequests` and `handlers.landingCounts` builders to `apps/admin/test/msw.ts` whose fixtures parse with `accessRequestList` / `landingCounts` from `@devolada/api/landing-schema`; render the operator as `operator-bank.test.tsx` does; the Landing tab shows a row per channel with the three steps and each share of visits, "visitas = cargas de página" in words, the requests newest first with the WhatsApp, the name, the es-MX system label, which form, the channel, the arrival time and the notice state as icon + text (`StatusBadge`); two fixture rows sharing a WhatsApp show the "repetida" mark and a third with its own number does not (the "same person asks twice" edge case); "Exportar CSV" produces a file whose rows match the fixture; `axe` runs on the tab.

### Implementation for User Story 2

- [ ] T035 [US2] Add `postLandingEvent`, `listAccessRequests` and `getLandingCounts` to `apps/api/src/routes/landing/handler.ts` — the event upsert with `dayInMexicoCity` and `channelOrDirect` from T017; the list newest first on `(created_at, id)` with an opaque cursor, `limit ≤ 200`, and `repeated` computed as "another row carries this WhatsApp" (D23); the counts for an inclusive day range defaulting to the last 30 Mexico City days. Cite `landing-page D8 / D23`.
- [ ] T036 [US2] Wire them in `apps/api/src/routes/landing/index.ts` — `POST /events` on `landingPublicRoute` behind `rateLimitRoute("landing-event", { window: 3600, max: 60 })` with `zValidator("form", landingEventBody)`; `GET /requests` and `GET /counts` on `landingOperatorRoute`; mount the operator router in `apps/api/src/routes/platform/index.ts` as `platformRoute.route("/landing", landingOperatorRoute)` so it sits behind the file's existing `requireSession, requirePlatformOperator`.
- [ ] T037 [US2] Create `apps/landing/src/scripts/beacon.ts` and wire it — imported by a `<script>` in `Base.astro` for `visit` (after load, `requestIdleCallback` when available) and by `RequestForm.astro` for `began` (the first `focusin` inside either form, once per page load); each a `fetch(`${API_URL}/landing/events`, { method: "POST", mode: "no-cors", keepalive: true, headers: { "content-type": "application/x-www-form-urlencoded" }, body })` with the channel read from the first `input[name="channel"]`; nothing stored in the browser, no cookie (FR-023, research D8). Cite `landing-page D8`.
- [ ] T038 [US2] Create `apps/admin/src/features/operator/LandingTab.tsx` — `useQuery` on `/platform/landing/counts` and `/platform/landing/requests` through `api()` from `@/lib/api`; a period picker (7 / 30 / 90 days) using the shared `Button` group; the counts table by channel with `visit`, `began`, `sent` and each step's share of visits as tabular numerals, plus the sentence that a visit is a page load; a one-line summary above the requests table counting them by billing system (*por sistema: WispHub · propio · otro · ninguno · sin respuesta* — SC-003); the requests table newest first with the WhatsApp, the name, the es-MX label for `BILLING_SYSTEMS` keyed by the schema constants, which form (*inicio* for `hero`, *completo* for `full`), `notify_error` / `notified_at` as a `StatusBadge`, a "repetida" mark (icon + text, never colour alone) on any row whose WhatsApp another row already carries — the list keeps both and shows they share a number — and "Exportar CSV" building the file in the browser from the loaded list (research D17). Tokens only, compact 40 px controls, readable at 768.
- [ ] T039 [US2] Add the third tab to `apps/admin/src/features/operator/OperatorScreen.tsx` — `<TabsTrigger value="landing">Landing</TabsTrigger>` and its `TabsContent` rendering `LandingTab`, after "Negocios".

**Checkpoint**: thirty days of numbers and every request, in one tab, exportable — SC-003 answerable in under five minutes.

---

## Phase 5: User Story 3 — The page travels well (Priority: P3)

**Goal**: a shared address unfurls into title, line and image; a tagged address carries its tag into the request whether or not scripts run; `www` lands on the page.

**Independent Test**: in workerd, `www` redirects with path and query intact and a tagged request rewrites both hidden inputs; in the built page the sharing tags are present and the image exists; on a phone the preview renders.

### Tests for User Story 3

- [ ] T040 [P] [US3] Worker test in `apps/landing/test/worker.test.ts` citing `landing-page US3` — using the `ASSETS` stub from T005: `https://www.devoladapago.com/?ch=x` answers 301 to `https://devoladapago.com/?ch=x`; `/?ch=Grupo-ISP` returns the fixture with **both** `input[name="channel"]` carrying `value="Grupo-ISP"`; `/?ch=<script>` leaves them untouched; a non-HTML asset passes through byte-for-byte; every response carries `Content-Security-Policy` with the bound `API_ORIGIN` in `connect-src` and `form-action`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS only on `https` (research D3, D4, D12).

### Implementation for User Story 3

- [ ] T041 [US3] Write `apps/landing/worker/index.ts` — `export default { fetch }`: the `www.` redirect (301, same URL without the prefix); `env.ASSETS.fetch(request)`; when the response is HTML and `?ch=` matches `CHANNEL_PATTERN` (imported from `@devolada/api/landing-schema`), an `HTMLRewriter` that sets `value` on every `input[name="channel"]`; the headers from [contracts/landing-page.md](./contracts/landing-page.md) with `env.API_ORIGIN`. About fifty lines; every rule cites `landing-page D3 / D4 / D12`.
- [ ] T042 [US3] Complete the sharing metadata in `apps/landing/src/layouts/Base.astro` — the es-MX title and one-line description as props from `index.astro`, `og:image` absolute from `Astro.site`, `og:image:width` / `height` 1200×630, and confirm `public/og.png` from T006 is the file it points at (FR-031).
- [ ] T043 [US3] Browser test additions in `tests/e2e/landing.spec.ts` citing `landing-page US3` (same file as T032 — sequenced) — `<head>` carries `canonical`, `description`, `og:title`, `og:description`, `og:image` and the image URL answers 200 with a 1200×630 PNG; both `input[name="channel"]` are present and empty in the built page (the Worker fills them — proved in T040).

**Checkpoint**: the address unfurls, the tag travels without scripts, `www` works. All three stories independently functional.

---

## Phase 6: Polish, release plumbing, and the things only the creator can do

**Purpose**: put the fourth Worker on every path the other three take, name it in the repo's own docs, and settle what a build cannot.

- [ ] T044 In `.github/workflows/ci.yml`, `preview` job: after the payment-page preview, add "Build landing (dev API baked in)" (`working-directory: apps/landing`, `PUBLIC_API_URL="${{ vars.DEV_API_URL }}" PUBLIC_SITE_URL=https://dev.devoladapago.com pnpm build`) and "Landing preview" (`working-directory: apps/api`, `../../scripts/preview-upload.sh devolada-landing-dev --config ../landing/wrangler.jsonc --env dev`, same env block). The `quality` job needs nothing: `pnpm -r` already reaches the new package.
- [ ] T045 [P] In `.github/workflows/deploy-dev.yml`: after the payment page, "Build landing (dev API baked in)" and "Deploy dev landing" (`pnpm --filter @devolada/api exec wrangler deploy --config ../landing/wrangler.jsonc --env dev`); extend the smoke step to probe `${{ vars.DEV_LANDING_URL }}/` with the same retry loop, warning-and-skipping when the variable is unset like the others.
- [ ] T046 [P] In `.github/workflows/deploy-prod.yml`: the same two steps with `PROD_API_URL` and `PUBLIC_SITE_URL=https://devoladapago.com`, logging to `$RUNNER_TEMP/deploy-landing.log`; `for w in api admin pago landing` in "What landed"; `probe landing "${{ vars.PROD_LANDING_URL }}" "/"` in the smoke test.
- [ ] T047 [P] In `.github/workflows/rollback-prod.yml`: `options: [api, admin, pago, landing]` and `landing) CONFIG="--config ../landing/wrangler.jsonc" ;;` in the `case`; the header comment's list of Workers gains the fourth.
- [ ] T048 [P] Update `CLAUDE.md` — the commands block gains `pnpm --filter @devolada/landing dev  # public landing page (5176)`, the architecture tree gains `apps/landing` (static page + a Worker in front: `www` redirect, channel tag, headers; requests and counts live in the API), and the CI paragraph names four Workers.
- [ ] T049 [P] The creator runs `/speckit-constitution` with the ready-to-paste amendment text under research D19 (drafted 2026-09-19 after `/speckit-analyze` finding C1) — the *Landing* row in the stack table, "both surfaces" → "more than one surface" in Principle VI, the note on the *Tests* row. This task closes when `.specify/memory/constitution.md` carries the new version; nothing in this feature's tree changes for it.
- [ ] T050 Pre-flight, per [quickstart.md](./quickstart.md) — the claims list reviewed against the product by a person, date recorded in the PR; `{{RESPONSABLE}}` / `{{DOMICILIO}}` replaced by the creator (T016 fails until then); `CONTACT_EMAIL` equals the platform's `support_email` (`curl $DEV_API_URL/support`); repository variables `DEV_LANDING_URL` and `PROD_LANDING_URL` set; the `ALLOWED_ORIGINS` and `LANDING_BASE_URL` values from T011 confirmed in both environments; **the two WhatsApp message templates and the 60-second recording** of the customer's side exist (spec §The workflow the page starts; the templates are on the canvas's *Flujo* board); **the reading test** — five people who collect by SPEI and have never seen Devolada, at least three from ISPs, each reading once on a phone and saying back what it does, for whom and how it is charged, with what they said recorded (SC-001); **the timing** — first screen within 2 s and the page within 5 s in Chrome DevTools with "Slow 4G" and 4× CPU throttling, numbers recorded (SC-002). Record each check in the PR description.
- [ ] T051 Run the full gate listed in `specs/008-landing-page/quickstart.md` — `scripts/spec-lint.mjs`, `scripts/gen-banks.mjs --check`, `scripts/contrast-lint.mjs`, `scripts/pending-lint.mjs`, workspace typecheck (now including `astro check`), workspace tests (now including the landing's two files), `pnpm -r build`, `pnpm e2e`. Record the counts in the PR the way 007's T043 did.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T007)**: T001 first (the package exists); T002–T007 then run together — seven different files. T007 is the only task outside `apps/landing`.
- **Foundational (T008–T014)**: blocks all three stories. T008 (the contract) → T009 → T010 (the migration follows the schema); T011–T014 are independent of each other and of T009–T010, but T014 needs T006's stylesheet.
- **US1 (T015–T032)**: after Foundational. Tests first (T015, T016), then the door (T017 → T018 → T019), then the page (T020–T030), then the browser layer (T031 → T032). Delivers the MVP.
- **US2 (T033–T039)**: after Foundational; independent of US1's page tasks, but T033 shares `landing.test.ts` with T015 and T035/T036 extend T017/T019's files — land US1's task of each pair first. T037 touches `Base.astro` and `RequestForm.astro`, so it follows T014 and T026.
- **US3 (T040–T043)**: after Setup (T005) for the Worker; T042 follows T014; T043 shares `landing.spec.ts` with T032 and follows it.
- **Polish (T044–T051)**: T044–T049 after the code exists; T050 needs the creator; T051 last.

### Within each story

The contract landed in Phase 2 because both US1 and US2 import it and the
page stamps its constants at build. Then the tests, written to fail. Then
the handler, the router, the components, the script. The browser layer last,
because it needs the built page.

### Parallel Opportunities

- **T002–T007**: six files in Phase 1 after T001.
- **T011, T012, T013, T014**: four files in Phase 2 once T008 exists.
- **T021–T025**: five section tasks, seven files — the widest window in US1. T020 and T026–T027 are not `[P]` because Hero, the two forms and their script are what the others meet in `index.astro`.
- **T028, T029, T030**: three files after the form exists.
- **T034 beside T033**; **T045–T049**: five files in Phase 6.
- **`[P]` is checked, not assumed**: no two `[P]` tasks name the same file. The pairs that do share a file — `landing.test.ts` (T015 / T033), `landing.spec.ts` (T032 / T043), `handler.ts` and `index.ts` (T017, T019 / T035, T036) — are sequenced and marked without `[P]`.

---

## Parallel Example: User Story 1, the sections

```bash
# After T020 (Hero) sets the page's voice, these five run together — different files:
Task: "Create apps/landing/src/components/System.astro + Proof.astro"          # T021
Task: "Create apps/landing/src/components/Benefits.astro"                      # T022
Task: "Create apps/landing/src/components/HowItWorks.astro + PaymentFlow.astro"    # T023
Task: "Create apps/landing/src/components/Doubts.astro"                        # T024
Task: "Create apps/landing/src/components/Pricing.astro"                       # T025
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 — the package builds; the motion constants are shared.
2. Phase 2 — the contract, the tables, the bindings, the layout, the claims.
3. Phase 3 — the door, the page, the browser layer.
4. **Stop and validate**: someone who runs an ISP reads the page on a phone and sends a request; it is in the database with every field, and the operator has the notice (or the log line).
5. This is shippable: the creator reads requests from the notice until US2 lands.

### Incremental delivery

1. Setup + Foundational → nothing visible, everything resting on it.
2. + US1 → the page is live and takes requests (**MVP**).
3. + US2 → the numbers and the list in the operator tab.
4. + US3 → the tag survives without scripts, `www` works, the address unfurls.
5. + Polish → the fourth Worker on every workflow, the amendment, the pre-flight.

### Sequencing constraints outside this feature

- **The constitution amendment (D19)** is the creator's act; `/speckit-analyze` reads the stack table as CRITICAL until it lands. Best done before the PR is opened, so the analysis runs clean.
- **`.specify/bugs/links-roster-cap`** carries a migration numbered 0033 on its branch; T010 takes whatever number `main` gives at the time and the two never collide in the same tree.
- **The first `deploy-dev`** creates the DNS records for `dev.devoladapago.com` (measured 2026-09-19: none exists); the first PR's preview upload warns instead of failing, as `preview-upload.sh` already tolerates.
