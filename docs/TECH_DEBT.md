# TECH_DEBT

Conscious technical debt: things deliberately postponed during a spec. Each entry states what was postponed, why that was reasonable, and what makes it payable.

## TD-009 — The reconnection creates a new invoice even when one is pending
- Status: **paid** (2026-08-14, `feat/reconnection-queue`) · Origin: E2E check of charges/charge-record.spec.md
- The adapter now asks for pending invoices (`estado=1`, explicit 45-day window) and matches `cliente.usuario` in our code, because **the list endpoint has no customer filter** — verified against the live API before writing it. It creates one only when there is none, and the id is stored on the charge so a retry pays the same invoice even if the list lies about an empty month. Covered by `test/reconnection-queue.test.ts` scenario 1, which registers no create-invoice interceptor: creating one fails the test.

## TD-008 — Invoice id parsed from a message string
- Status: open · Origin: charges/charge-record.spec.md (D5)
- WispHub's create-invoice response has no id field; we parse "la factura N" from the message. It works, but any wording change breaks it.
- Paid by: asking WispHub support for a stable id in the response, or switching to a list lookup after creation.

## TD-001 — JWTs without signature verification in dev
- Status: open · Origin: auth/sessions.spec.md
- `apps/api` decodes JWTs without verifying the signature when `AUTH_JWT_SECRET` is missing (with a console warning). Reasonable for local dev; **blocking for production**.
- Paid by: configuring agnostic-auth's HS256 secret as a worker secret and in `.dev.vars`.

## TD-002 — Duplicated design tokens
- Status: open · Origin: tokens phase
- `.design/devolada/DESIGN_TOKENS.css` (document) and `packages/ui/src/styles/tokens.css` (live) are synced by hand. The live file wins.
- Paid by: a sync script, or declaring the `.design` copy a historical snapshot and no longer maintaining it.

## TD-003 — Messaging provider undecided
- Status: open · Origin: brief (WhatsApp/SMS receipts, invitations)
- The template and trigger are built provider-agnostic (Meta WhatsApp Business API vs Twilio). Until decided, invitations use a copyable link as fallback and customer receipts open a `wa.me` link the shopkeeper sends from their own WhatsApp (`charges/receipt.spec.md` D1).
- Owner's decision (2026-08-14): **Meta WhatsApp Business API, as its own later feature** — verification, a verified number and template approval are weeks the pilot cannot wait for. Manual `wa.me` links carry both flows until then.
- Paid by: creating `integrations/meta-whatsapp.md` with the verified contract and implementing real sending, with the links kept as the fallback.

## TD-007 — No CORS for the deployed store PWA
- Status: **paid** (2026-08-14, `chore/pwa-deploy`)
- The API now has a CORS allow-list with credentials (`ALLOWED_ORIGINS`, suffix patterns admit per-PR preview URLs) and cookies switch to `SameSite=None; Secure` on cross-site deployments (`CROSS_SITE_COOKIES`). The PWA deploys as an assets-only worker in `deploy-dev.yml`/`deploy-prod.yml`, and CI uploads a per-PR preview version — the URL the client opens.

## TD-004 — Golden rule without enforcement
- Status: **paid** (2026-08-13) · Origin: methodology adoption
- `scripts/spec-lint.mjs` runs in all three workflows: fails if a `*.spec.md` is missing from SPEC.md's index; warns on tests without a US-ID (becomes an error once TD-005 is paid).

## TD-005 — Sessions verified with curl only
- Status: **paid** (2026-08-13, `feat/isp-signup`)
- API test layer landed (`apps/api`: vitest + `@cloudflare/vitest-pool-workers@0.8`, app running in workerd with real D1, IdP mocked per the real contract). The 8 session scenarios are retro-covered in `test/sessions.test.ts` (10 tests) and isp-signup was born automated (`test/isp-signup.test.ts`, 8 tests).
- Note: the component/MSW/Playwright layers land with the first frontend app (there is no UI surface to test yet) — tracked in `TESTING.md`.

## TD-006 — CI/CD pipeline with activation pendings
- Status: **paid** (2026-08-13)
- Closed with: public repo `leolicona/devolada` · `ci/deploy-dev/deploy-prod` workflows · spec-lint in all three · required reviewer active on `production` · remote D1 databases with real IDs · `CLOUDFLARE_API_TOKEN` in both environments · first dev deploy green with migrations applied by the pipeline · `DEV_API_URL`/`PROD_API_URL`/`PREVIEW_ENABLED=true` configured · smoke `/health` verified at `https://devolada-api-dev.leolicona-dev.workers.dev`.
- Note: prod has no first deploy yet (correct: it ships with the first `v*` tag and your approval).
