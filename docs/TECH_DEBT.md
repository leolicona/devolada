# TECH_DEBT

Conscious technical debt: things deliberately postponed during a spec. Each entry states what was postponed, why that was reasonable, and what makes it payable.

## TD-016 — D13 may falsely reject SPIN tracking keys (the hyphen is unmeasured)
- Status: open · Origin: consta/email-provisional-match.spec.md spike (2026-08-27)
- A real SPIN by OXXO transfer arrived carrying the clave `SPIN-20260824010834IVJWHVYH` — hyphen included — as relayed by Banco Azteca's own notification email. validation.spec.md D13 enforces `^[A-Za-z0-9]{6,30}$`, so a SPIN payer who types the clave exactly as their bank shows it would be refused at the edge with `VALIDATION_ERROR` — the false-reject class D12/D13 exist to prevent, at OXXO scale. Whether Banxico registers the hyphen as part of the clave is unmeasured (n=1 sighting, no CEP lookup yet).
- Why it was reasonable: found by the email spike, outside that spec's scope; no SPIN payer has reached Devolada yet; the fix belongs to validation.spec.md, which is being edited from its own worktrees (CICD rule 3), and it needs one measurement before any code moves.
- Payable when/by: two free lookups at banxico.org.mx/cep with the measured transfer's data, clave with and without the hyphen (the owner holds it). If the hyphen is part of the registered clave → widen D13's charset in validation.spec.md, its own PR, with a scenario citing US-V07; if Banxico stores it without → normalize hyphens out at every claiming edge (Devolada's forms, the email parser) and leave D13 as is.
- **Probed 2026-08-27, inconclusive — and the question widened.** Three live calls with the real transfer's full data (date 2026-08-24, $3,000, SPIN BY OXXO → AZTECA, the owner's CLABE): (1) hyphenated clave through Consta → refused at the edge, `VALIDATION_ERROR`, free — the premise demonstrated live; (2) un-hyphenated through Consta → real apiCEP, `invalid` + `not_found`, `provider_ms` **1591**; (3) hyphenated direct to apiCEP → same faceless `invalid`, validation 1.85 s. Both provider calls sat in the 1.3–1.9 s early-fail band D11 measured for wrong-input cases, against 5.9–7.0 s for real lookups — so apiCEP likely never searched Banxico for either form, and **how apiCEP handles SPIN as sender is now a suspect alongside the hyphen**. Banxico's own CEP site was unreachable from the dev network (443 timeout, the same block measured 2026-08-19), so the settling lookup — the browser form with both clave variants — remains with the owner.

## TD-015 — The customer's return trip survives one device only
- Status: open · Origin: returning-customer-access.spec.md (D10), 2026-08-17
- Phase 1 remembers the payment link in that device's `localStorage`, so the customer who keeps the same phone and never clears it comes back for free. Everyone else — new phone, cleared browser, a link opened in WhatsApp's in-app browser whose storage was evicted — still has to ask the ISP to send the link again. Phase 2 (a passkey bound to the payment link, D4–D8) is specified and rejected-alternatives are recorded, but not built.
- Why it was reasonable: passkeys are an auth subsystem for an action taken twelve times a year, and the failure it fixes has never been measured here. Phase 1 is a few lines in one route and covers the common case, which is also what produces the evidence: if nobody ever loses access, phase 2 was never worth its complexity.
- Payable when: support requests to re-send links become routine, **or** the WABA work opens this surface anyway (SPEC.md, owner decision 2026-08-17) — whichever comes first. Build it as specified: credentials against `payment_links`, its own `pago.*` rpID, discoverable credentials, and the in-app-browser guard verified on a real Android phone.

## TD-013 — The re-validation schedule is a global constant, not learned per bank
- Status: open · Origin: direct-payment.spec.md (D7), owner decision 2026-08-17
- D7's schedule (+2, +8, +20, +45 min, +2 h, +6 h) comes from published evidence (Banxico's ~30-minute CEP rule; apiCEP's "seconds normally, hours sometimes"), not from our own traffic, and it is the same for every receiving bank. The `direct_payments` log already records everything needed to do better: `created_at`, `confirmed_at`, `validation_attempts` and the receiving bank.
- Why it was reasonable: with zero real payments there is no distribution to learn from; shipping the evidence-based constant first is what produces the data.
- Paid by: once enough confirmed direct payments accumulate, derive the per-bank latency distribution from the log and tune the schedule (possibly per receiving bank) — plus revisit the early cadence when apiCEP answers whether pending re-checks consume credits.

## TD-014 — Captured customer phones have no ISP-facing view or delete
- Status: **open** · Origin: charges/customer-phone.spec.md D5 (2026-08-17)
- We store customer phones the shopkeeper captures (`customer_contacts`), but the ISP has no screen to see, correct or delete them; a wrong number is only fixed by typing a new one at the next charge, and a deletion request is handled by hand.
- Why it was reasonable: the admin has no customer view at all yet — building one screen for one field would invent a surface the IA does not have.
- Payable when: the admin gets a customer view (natural spot), or the first real deletion request arrives — whichever comes first.

## TD-012 — `INVALID_TOKEN` blames the link for failures the link did not cause
- Status: **paid** (2026-08-15, `feat/better-auth`) · Origin: found while diagnosing the TD-001 rollback
- The old `redeemIspToken` collapsed a bad signing key, an IdP outage, an unknown identity and a genuinely expired token into one `INVALID_TOKEN`, rendered as *"Este enlace ya no sirve. Solicita uno nuevo."* — advice that could never work when the real fault was the key.
- Paid twice over by the migration: **the links themselves are gone** (better-auth.spec.md D4 — codes typed into the app), and the new invitation redemption logs the distinct cause server-side (`accept-invitation rejected: <cause>`) while the client still gets one generic code. Scenario 8 of that spec keeps it tested.

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
- Status: **paid** (2026-08-16, `feat/keyboard-slice`) · Origin: polish/accessibility.spec.md, found by the design review's status pass (2026-08-14)
- Phase 5 covered the markup (axe), the palette (contrast-lint), the real colour and the touch targets — but **no layer walks the tab order**. The brief asks for full keyboard navigation and visible focus in the dashboard, and `TASKS.md` claimed the accessibility pass covered it. It did not.
- Why it was reasonable: each polish slice took the half a tool could measure; the tab order needs a browser and a written expectation of the order, which is design work, not just a check.
- Paid by `tests/e2e/keyboard.spec.ts` (accessibility.spec.md D6): the charge path and the admin's confirm flow walked by Tab against a written order, with a visible indicator **measured as a change** against each element's resting styles (outline, ring or border — a static card shadow cannot pass). The suite proved it can go red: killing the focus styles fails it on the first stop. Findings along the way: both apps already ringed every stop; the search input signals focus by border swap, which the detector now honours.

## TD-009 — The reconnection creates a new invoice even when one is pending
- Status: **paid** (2026-08-14, `feat/reconnection-queue`) · Origin: E2E check of charges/charge-record.spec.md
- The adapter now asks for pending invoices (`estado=1`, explicit 45-day window) and matches `cliente.usuario` in our code, because **the list endpoint has no customer filter** — verified against the live API before writing it. It creates one only when there is none, and the id is stored on the charge so a retry pays the same invoice even if the list lies about an empty month. Covered by `test/reconnection-queue.test.ts` scenario 1, which registers no create-invoice interceptor: creating one fails the test.
- 2026-08-16: the window grew to 180 days with bounded pagination, and the charge path no longer reaches `createInvoice` at all — the guard resolves the invoice first (`charges/debt-truth.spec.md` D3, D5). The "create only when there is none" fallback survives for the queue's legacy path and the truncation edge.

## TD-008 — Invoice id parsed from a message string
- Status: open · Origin: charges/charge-record.spec.md (D5)
- WispHub's create-invoice response has no id field; we parse "la factura N" from the message. It works, but any wording change breaks it.
- Paid by: asking WispHub support for a stable id in the response, or switching to a list lookup after creation.

## TD-001 — JWTs without signature verification in dev
- Status: **paid by elimination** (2026-08-15, `feat/better-auth`) · Origin: auth/sessions.spec.md
- The debt: `apps/api` could not verify a session without an HS256 key that lived in another system (agnostic-auth's per-app `jwtSecret` in KV), unannounced when it changed. An attempt to pay it that same day with the wrong value broke every session for a day — login 200, next request 401 — and the rollback left dev accepting unsigned tokens again. The full story is in PR #30's branch (`docs/td-001-reopen`), which this entry supersedes.
- The payment: the migration to Better Auth (better-auth.spec.md) deletes `src/auth/jwt.ts` and the shared-key model with it. Sessions are rows in our own D1, signed with **our** `BETTER_AUTH_SECRET`; there is no second system to disagree with. `sessions.test.ts` covers the behaviour that used to be unverifiable: a tampered cookie gets 401.
- What replaced the old requirement: `BETTER_AUTH_SECRET` in `.dev.vars` and in **both** GitHub environments — the deploy step now *fails* (dev and prod alike) when it is missing, because shipping sessions signed with a public fallback value is the same class of hole. The lesson that survives this entry: a secret is proven by behaviour (sign in, then `/auth/me`), never by `wrangler secret list`.

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

## TD-014 — The provider cache is per isolate, not per colo
- Status: open · Origin: polish/provider-latency.spec.md (D3)
- The 30-second pending-invoice cache and the 10-minute payment-method cache live in module state, so their hit rate is whatever one isolate happens to serve. A colo-wide cache (the Cache API, keyed by ISP) would be shared by every request landing in the same city — strictly better for an ISP whose stores all sit in one region, which is the pilot's shape exactly.
- Not paid now on purpose: the isolate cache is a few lines with no new failure surface, and the win being chased is a 30-second window. Buying a second cache layer before measuring the first one's hit rate is guessing.
- Paid by: measuring the hit rate on dev with the pilot ISP (log the miss count per ISP for a day). If misses dominate, move both caches behind `caches.default` with the same keys and the same freshness rule — display reads the cache, guards never do.

## TD-015 — A simulated validation verdict for demos
- Status: open · Origin: the 2026-08-20 demo · **must be deleted after it**
- `apps/api/src/direct-payments/demo.ts` returns a synthetic `valid` Consta verdict for payment links named in `DEMO_LINK_TOKENS`, when `ENVIRONMENT === "dev"`. Everything downstream stays real: the fresh WispHub read, the charge, the folio, the reconnection. Only the Banxico lookup is simulated.
- Why it exists: a CEP has no measured upper bound on publication (`docs/integrations/apicep.md`, 2026-08-19 — two transfers with the money already delivered, 30 samples through T+62 min, no CEP). A transfer made live in front of an audience does not reach a green screen even with a healthy Banxico, so this is not an outage fallback.
- What it deliberately is **not**: a failure that becomes a success. The rejected design was "if the validation fails, mark it confirmed", which would fire on every real customer whose CEP is merely late — the exact case D17 exists to protect. The trigger is configuration decided in advance, never a provider that said no. A test asserts a contradicted CEP is still `invalid` on this path.
- Paid by: deleting `demo.ts`, its `DEMO_LINK_TOKENS` var in both wrangler blocks, the branch in `runValidation` and the TD-015 test block — in the PR that follows the demo. Nothing else depends on it.
