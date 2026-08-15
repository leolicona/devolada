# TECH_DEBT

Conscious technical debt: things deliberately postponed during a spec. Each entry states what was postponed, why that was reasonable, and what makes it payable.

## TD-012 — `INVALID_TOKEN` blames the link for failures the link did not cause
- Status: open · Origin: found on 2026-08-15 while diagnosing the TD-001 rollback
- `redeemIspToken` (`routes/auth.ts`) wraps the whole redemption in one `try`, so a bad signing key, an IdP outage, an unknown identity and a genuinely expired token all collapse into the same `INVALID_TOKEN`. The admin renders it as *"Este enlace ya no sirve. Solicita uno nuevo."* and the store as the invitation equivalent.
- Why it bites: during the wrong-secret outage that copy was simply false, and it was **actively misleading** — it tells the user the one recovery action that cannot work, so they request new links forever. It also hid the real fault from us for a while, because the message sounded like a normal expiry.
- Why it was reasonable: collapsing causes at the edge is the right instinct for an auth endpoint — never tell an attacker which half failed.
- Paid by: keep the response code as-is (no new information to the client), but log the distinct cause server-side, and separate "this token is expired or used" from "we could not verify it at all" in the logs. Consider a different user-facing string for the second case, since "ask for a new link" is wrong advice there.

## TD-011 — Email only reaches us: sandbox sender, and no key in any deployed worker
- Status: **paid** (2026-08-15) · Origin: auth/isp-signup.spec.md, found while activating the key
- Two gaps, one consequence. **(a)** `EMAIL_FROM` is unset, so the sender is Resend's sandbox `onboarding@resend.dev`, which accepts the account owner's own address and answers **422** for every other — both measured against the live API. **(b)** No deploy step sets `RESEND_API_KEY` as a worker secret, so dev and prod fall through to `console.log` and send nothing at all.
- Why it bites quietly: signup catches the failure by design (spec D2) and returns 201 either way. A real ISP would create an account, never receive the verification email, and see nothing but the "Confirma tu correo" banner — whose **Reenviar correo** button fails the same silent way.
- Why it was reasonable: the sandbox is exactly the right way to prove the integration without owning a domain, and it did prove it. The resilience that hides the failure is a deliberate decision worth keeping.
- Half (a) has a decision as of 2026-08-15: `devoladapago.com` exists and its DNS is already on Cloudflare, but adding it to the current Resend account returns `403 You have reached the domain limit of your plan` — the free plan holds one domain and `turistearya.com` has it. Devolada gets **its own free Resend account** rather than a paid upgrade or evicting the other project: no cost, its own domain slot, and neither project's key can compromise the other. Runbook in `integrations/resend.md`.
- **(a) closed**: `devoladapago.com` is verified on Devolada's own Resend account (us-east-1, sending enabled), its DKIM/SPF/MX records live in the Cloudflare zone, and `EMAIL_FROM` is `Devolada <no-reply@devoladapago.com>` in all three `vars` blocks. Signup for a third-party recipient now returns without error — the same call that answered 422 under the sandbox.
- **(b) closed** for `dev`, verified not assumed: the `deploy-dev` run for the PR #28 merge logged `✨ Success! Uploaded secret RESEND_API_KEY`, and `wrangler secret list --env dev` returns it. The green tick on that step was not the evidence — a skip is green too. `production` has no `RESEND_API_KEY` yet; that step skips there, and the prod worker keeps logging links until it does. Not blocking — prod has never deployed.
- Half (b) has its mechanism as of 2026-08-15: both deploy workflows set the secret in the step after `wrangler deploy`, skipped while the environment has none (CICD D5). Setting it by hand from a laptop does **not** work — `wrangler secret put` refuses while the newest version is undeployed, and D2's per-PR `versions upload` almost always leaves one behind. That is the error to expect if anyone tries.
- Consider with it: whether `resend-verification` should tell the admin it failed, rather than reporting success it cannot confirm.

## TD-010 — Keyboard order and visible focus are untested
- Status: open · Origin: polish/accessibility.spec.md, found by the design review's status pass (2026-08-14)
- Phase 5 covered the markup (axe), the palette (contrast-lint), the real colour and the touch targets — but **no layer walks the tab order**. The brief asks for full keyboard navigation and visible focus in the dashboard, and `TASKS.md` claimed the accessibility pass covered it. It did not.
- Why it was reasonable: each polish slice took the half a tool could measure; the tab order needs a browser and a written expectation of the order, which is design work, not just a check.
- Paid by: a keyboard slice over both apps — tab through the charge path and the admin's confirm flow in `tests/e2e/`, asserting the order and a visible `:focus-visible` ring on every stop. **Before the pilot**: a shopkeeper does not use a keyboard, but the ISP admin does.

## TD-009 — The reconnection creates a new invoice even when one is pending
- Status: **paid** (2026-08-14, `feat/reconnection-queue`) · Origin: E2E check of charges/charge-record.spec.md
- The adapter now asks for pending invoices (`estado=1`, explicit 45-day window) and matches `cliente.usuario` in our code, because **the list endpoint has no customer filter** — verified against the live API before writing it. It creates one only when there is none, and the id is stored on the charge so a retry pays the same invoice even if the list lies about an empty month. Covered by `test/reconnection-queue.test.ts` scenario 1, which registers no create-invoice interceptor: creating one fails the test.

## TD-008 — Invoice id parsed from a message string
- Status: open · Origin: charges/charge-record.spec.md (D5)
- WispHub's create-invoice response has no id field; we parse "la factura N" from the message. It works, but any wording change breaks it.
- Paid by: asking WispHub support for a stable id in the response, or switching to a list lookup after creation.

## TD-001 — JWTs without signature verification in dev
- Status: **open everywhere** — briefly "paid" on 2026-08-15 with a wrong value, rolled back the same day · Origin: auth/sessions.spec.md
- `apps/api` decodes JWTs without verifying the signature when `AUTH_JWT_SECRET` is missing (with a console warning). Reasonable for local dev; **blocking for production**.
- The hazard: with no secret, `devolada-api-dev.leolicona-dev.workers.dev` — reachable by anyone — takes the unverified branch of `src/auth/jwt.ts`, which parses the token and rejects it only on `exp`. The middleware still looks the actor up in the DB and checks status, so this impersonates an existing active store or ISP rather than inventing one. Demo data today; the pilot's data is what changes the stakes.
- **The failed payment of 2026-08-15, which is the useful part of this entry.** A secret was added to `.dev.vars` and to the `dev` GitHub environment, the deploy step uploaded it, and `wrangler secret list --env dev` returned the name. All of that was true and none of it meant the flow worked: **the value was not the key the IdP signs with**, so every session broke. Login returned 200 and the very next authenticated request returned 401, in local *and* on deployed dev. Rolled back by deleting the secret from the Worker and from the GitHub environment (leaving it in the environment would have re-broken dev on the next merge, since the deploy step re-uploads it every time).
- **Why the value was wrong** — `agnostic-auth/auth-service/src/utils/jwt.ts:14`: `const signingSecret = appConfig?.jwtSecret ?? env.JWT_SECRET`. The IdP signs with the **per-app** secret, i.e. the `jwtSecret` on the `devolada` entry of the `APP_REGISTRY` KV namespace (`487de95a1bad4503b76af10e9604cb80`), and falls back to the global `JWT_SECRET` only when the app has none. "agnostic-auth's HS256 secret" — how this entry used to describe the fix — is ambiguous between the two, and the wrong one silently fails.
- **The lesson worth keeping**: `wrangler secret list` proves a *name* exists, never that the value works. The green tick on the deploy step proves the upload, not the key. The only check that means anything here is behavioural — log in, then call an authenticated route and expect 200.
- Related, in the IdP and not in this repo: `verifyToken` (`jwt.ts:28`) verifies with `env.JWT_SECRET` only, never the per-app secret, so agnostic-auth cannot verify the tokens it issues for any app that has its own `jwtSecret`.
- Note: `CICD.md` said these secrets "live in GitHub Environments" long before anything set them. The mechanism exists as of CICD D5; the value does not.
- Paid by: the `jwtSecret` of the `devolada` entry in `APP_REGISTRY` (or the global `JWT_SECRET` if that entry has none), set in `.dev.vars` and in the `dev` and `production` GitHub environments — and then **verified by logging in and calling `/auth/me`**, not by listing secret names. Prod refuses to deploy without it, so the first `v*` tag fails on this step until it is set — by design, not by accident.

## TD-002 — Duplicated design tokens
- Status: open · Origin: tokens phase
- `.design/devolada/DESIGN_TOKENS.css` (document) and `packages/ui/src/styles/tokens.css` (live) are synced by hand. The live file wins.
- Paid by: a sync script, or declaring the `.design` copy a historical snapshot and no longer maintaining it.
- 2026-08-14: `contrast-lint.mjs` reads the **live** file only, so the mirror can no longer cause a false pass. The mirror was re-synced by hand with the three values this pass changed (`--color-status-success`, `--color-status-warning`, new `--color-border-input`).

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
