# Build Tasks: Devolada

Generated from: .design/devolada/DESIGN_BRIEF.md (+ INFORMATION_ARCHITECTURE.md, DESIGN_TOKENS.css)
Date: 2026-08-13

Order: risk first (WispHub spike), then visual foundation to validate the aesthetic direction, then vertical slices per surface. Every task includes structure + styling + interaction and is verifiable on its own.

## Risk first

- [ ] **WispHub spike**: with a real API Key, test customer search (by ID/phone/name), payment registration, and verify the service reactivates on the MikroTik; document endpoints, latencies and limitations in `.design/devolada/WISPHUB_SPIKE.md`. If reactivation is not automatic via API, the finding redefines the product — hence it goes before everything. _No UI; blocks the whole backend._

## Foundation

- [x] **Live tokens in packages/ui**: minimal monorepo serving a sample page rendering the tokens (type scale, tabular-nums amounts, buttons, badges, light/dark) with Tailwind v4 + self-hosted Archivo/JetBrains Mono. The warm functionalist Rams philosophy is established here: this page is the verdict on the visual direction before building screens. _Reuses: DESIGN_TOKENS.css._
- [x] **Shared atoms: StatusBadge + AmountBreakdown**: the two source-of-truth components in `packages/ui`. Badge: ink + background + border + icon + text for reconnected/queued/failed/pending/confirmed/disputed. Breakdown: monthly fee + service fee + total, tabular `$1,234.00` format. Verifiable on the sample page. _New components; consumed by both apps._
- [x] **API base with sessions**: `apps/api` (Hono + Drizzle + Zod on Workers) with the initial schema (isps, stores, charges, ledger_entries, cash_drops, invitations) and `gm_access`/`gm_refresh` cookie middleware against Agnostic Auth (service binding): per-request DB status check, transparent refresh, revoke on logout. Verifiable with curl: store login (phone+password via `/auth/verify-password`) and a session that survives access-token expiry. _Depends on: WispHub spike (only for the charge schema design)._
- [ ] **ISP signup and access**: `/signup` with email + password (`/auth/hash`), email verification via `/auth/initiate` + Resend + `/auth/verify`, and `/recover` with the same pattern. Includes the magic-token redemption component the store invitation will reuse. Starts with `docs/auth/isp-signup.spec.md` and **lands the testing infrastructure** (the `docs/TESTING.md` matrix: vitest-pool-workers, Testing Library, MSW, Playwright+axe) — its scenarios are born automated and the 8 session scenarios get retro-covered (TD-005). _New; visual base of the shared access form._

## Store PWA (critical path)

- [ ] **PWA shell**: layout with 3 bottom tabs (Cobrar · Caja · Movimientos, 64px), phone + password login, installable manifest, long session. Mobile-first with a 360px floor, content centered at `--max-width-content` on large screens. _Reuses: access form, tokens._
- [ ] **Charge — search**: home with the input focused on open, search by ID/phone/name (API proxy to WispHub), results with minimum identity (name, zone, service status). States: empty, searching, no results, WispHub down (queue notice). _Depends on: API base._
- [ ] **Charge — confirm & charge**: `/charge/$customerId` with the amount at `--font-size-amount`, breakdown, identity card and a 64px "Cobrar $X" button anchored at the bottom. States: nothing due (no button), blocking balance cap (disabled button + explanation). _Reuses: AmountBreakdown._
- [ ] **Charge result with live status**: `/charges/$chargeId` — records the charge + ledger entries (charge and commission), shows the reconnecting → reconnected (green) / queued (amber) transition with polling, folio in mono, "Nuevo cobro" button. A charge is never rejected because of WispHub failures. _Reuses: StatusBadge. Depends on: reconnection queue (stubbable)._
- [ ] **Cash box**: current balance as protagonist (`--font-size-3xl`), accumulated commission, last drop status, balance-cap notices (approaching/exceeded), store name and logout. Every number breaks down on tap (principle: the ledger is the truth). _Reuses: StatusBadge, AmountBreakdown._
- [ ] **Record cash drop + Ledger**: `/cashbox/drop` with suggested amount = balance (editable downward) creating a pending entry; `/ledger` with the ledger grouped by day (infinite scroll) and per-entry detail. _Reuses: ledger entry list shared with admin._
- [ ] **PWA special states**: full-screen suspended account (with the ISP's contact; can appear mid-shift), `/invitation/$token` to set the password (magic-token redemption), and offline notice. _Reuses: magic-token redemption._

## Admin Dashboard

- [ ] **Admin shell**: 4-section sidebar (Cobros · Tiendas · Entregas · Configuración) with account at the foot, bottom-menu collapse on mobile, email + password login. Desktop-first. _Reuses: access form, tokens._
- [ ] **Live charge feed**: home with real-time transactions (reconnection status visible, failed ones surfaced on top), today's totals, filters by store/status/dates via query params, expandable detail `/charges/$chargeId` with a reconnection timeline. _Reuses: StatusBadge, AmountBreakdown. Reference: Stripe Dashboard._
- [ ] **Stores**: table with per-store balance and cap alert, creation with WhatsApp/SMS invitation (copyable link as fallback while there's no messaging provider), `/stores/$storeId` detail with full ledger, commission/cap editing, suspend and re-send invitation. _Reuses: ledger entry list._
- [ ] **Cash drops**: pending confirmations on top with confirm/dispute (with note) actions, paginated history, count badge in the sidebar. Confirming from a phone in two taps. _Reuses: StatusBadge._
- [ ] **Settings**: WispHub API Key with live validation (test connection), service fee, store/platform commission split. First login demands the API Key before operating. _Its own section with future multi-tenancy in mind._

## Supporting backend

- [ ] **Reconnection queue**: retries with backoff against WispHub (Cloudflare Queues), charge status transitions (queued → reconnected / failed) observed by the PWA and the feed, idempotency per charge. _Depends on: WispHub spike._
- [ ] **WhatsApp/SMS receipt**: template with folio, breakdown and reconnection status; sent on charge and updated on reconnection. Provider decision pending (Meta WhatsApp Business API vs Twilio) — template and trigger built provider-agnostic. _Reuses: AmountBreakdown._

## Interactions, Responsive & Polish

- [ ] **List states in both apps**: empty (first time, no charges/stores), loading (skeletons), error with retry, for feed, ledger, stores and cash drops. Covers: empty, loading, error.
- [ ] **Dark mode pass**: review both apps against the dark tokens (warm charcoal); no hardcoded color outside tokens. Covers: light, dark, system preference + manual toggle.
- [ ] **Responsive pass**: PWA at a real 360px and centered on desktop; admin with tables → cards and sidebar → bottom menu on mobile. Breakpoints: 375/768/1024/1280.
- [ ] **Accessibility pass**: AA contrast (AAA on amounts and statuses), color never alone (icon + text), touch targets ≥48px, keyboard + visible focus in admin, `aria-live` on the feed and reconnection transitions, plain es-MX.

## Review

- [ ] **Design review**: run /design-review against the brief with the apps running (light/dark screenshots, 360/768/1280).
