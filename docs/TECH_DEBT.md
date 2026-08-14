# TECH_DEBT

Conscious technical debt: things deliberately postponed during a spec. Each entry states what was postponed, why that was reasonable, and what makes it payable.

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
- The template and trigger are built provider-agnostic (Meta WhatsApp Business API vs Twilio). Until decided, invitations use a copyable link as fallback.
- Paid by: choosing a provider, creating `integrations/<provider>.md` and implementing real sending.

## TD-007 — No CORS for the deployed store PWA
- Status: open · Origin: store-pwa/shell.spec.md (D2)
- In dev, Vite proxies `/auth` to the API so cookies are same-origin. The deployed PWA will be cross-origin and needs a CORS + credentials allowlist on `apps/api`.
- Paid by: adding `hono/cors` with an origin allowlist when the PWA deploy step lands in `deploy-dev.yml`.

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
