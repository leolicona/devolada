---
status: in-development
stories: [US-S01, US-S02, US-S04, US-S05, US-S06, US-S07]
domain: auth
updated: 2026-08-15
debt: [TD-003]
---

# Spec: Better Auth migration — sessions, email as master key, passkeys

Replaces Agnostic Auth with [Better Auth](https://better-auth.com) running
inside `apps/api`: sessions in our own D1, email OTP for the ISP, phone +
password for the store, passkeys on top of both, and **email as the master
key for registration and recovery of both roles** (owner decision,
2026-08-15). This spec absorbs the `feat/store-email` branch: its intent
(stores get an email) survives; its column does not (D3).

Gate: the spike passed all 5 criteria on 2026-08-15 (see **Spike** below).
Had it failed, this spec would not exist.

## Why migrate

- TD-001 in one line: our API cannot verify a session without a signing key
  that lives in another system's KV, unannounced when it changes. On
  2026-08-15 that broke every dev session for a day.
- The IdP's magic links point at the wrong domain (old spec D1), its error
  contract differs from its own guide, and it cannot verify tokens it issues
  for apps with a per-app secret. We maintain workarounds for all three.
- Better Auth keeps sessions in our D1: suspension-revokes-immediately stays
  a plain DB check, with one deployed system fewer.

## Decisions

- **D1 — Clean replacement, no credential migration.** Prod has never
  deployed and dev/local data is reseeded demo data, so no passwords need
  migrating. Agnostic Auth is not shut down — other projects use it —
  Devolada just stops calling it. Discarded: a dual-stack compatibility
  window (cost with zero real users to protect).
- **D2 — Identity per actor.** ISP: **email + one-time code, no password at
  all** — the code is the login, so "verify your email" stops being a
  separate flow (first sign-in *is* the verification). Store: **phone +
  password** for daily use — a shopkeeper mid-queue cannot fetch a code from
  an inbox — with email captured at registration as the master recovery key.
  Passkeys (D6) sit on top of both. Discarded: email login for stores
  (breaks US-S01's counter reality); OTP-per-login for stores (unusable at
  a point of sale).
- **D3 — One email, one place.** The Better Auth `user` row holds the email;
  `isps` and `stores` link to it via a unique nullable `userId` (null until
  signup/acceptance completes). `stores` does **not** get its own email
  column — that was `feat/store-email`'s draft, superseded here because two
  copies of an email always end up disagreeing. `passwordHash`/`passwordSalt`
  leave both tables (Better Auth's `account` table owns credentials).
  Stores' Better Auth user also carries a synthetic-free **real** email now
  (owner decision); the phone lives in the `username` field for login.
- **D4 — The middleware keeps our guarantees.** Better Auth resolves the
  session (its own cookie, 30-day sliding — US-S01's "weeks", US-S02's
  no-visible-expiry); `findActor` then loads the actor by `userId` and checks
  `status` **on every request**, so suspension still revokes mid-session
  (US-S03). `gm_access`/`gm_refresh` and `src/auth/jwt.ts` die. A suspended
  store can complete a sign-in but its first API call answers 403
  `ACCOUNT_SUSPENDED` and clears the session — same screen as today, one
  request later.
- **D5 — One `/auth` namespace, two response shapes.** Our thin routes
  (signup, invitation acceptance, `/auth/me`) keep the envelope and are
  registered first; everything else under `/auth/*` falls through to the
  Better Auth handler, whose endpoints (`sign-in/*`, `email-otp/*`,
  `passkey/*`, `sign-out`, `get-session`) are consumed through the Better
  Auth client and are **exempt from the envelope** — documented here so the
  exemption is a rule, not an accident.
- **D6 — Passkeys need our domain.** `rpID = devoladapago.com` (localhost in
  local dev), which requires the apps to move to
  `api./tienda./admin.devoladapago.com` custom domains. Everything becomes
  same-site: `CROSS_SITE_COOKIES` and its `SameSite=None` machinery are
  deleted. Enrollment is offered after login in both apps, never forced.
  Caveat stated in the UI: a passkey identifies **this device** — on a
  shared store phone that means the device, not the person.
- **D7 — Invitations become fully ours.** The invitation token is a random
  id in our `invitations` table (no IdP `initiate`). Acceptance collects
  **email + password**, creates the Better Auth user server-side, links
  `stores.userId`, activates the store and signs it in — one screen, one
  step, as before. The ISP re-send stays as the fallback recovery path.
- **D8 — Resend stays the sender.** Better Auth's hooks call the existing
  `src/email/sender.ts` (TD-011's live domain); an OTP template joins the
  link templates, copy in plain es-MX. Without `RESEND_API_KEY` the code is
  logged to the console, as today.
- **D9 — Schema comes from the generator.** `@better-auth/cli generate`
  produces the drizzle tables (`user`, `session`, `account`, `verification`,
  `passkey`), cross-checked against the spike's hand-written schema. One
  migration; dev D1 is reseeded, nothing is migrated.

## Contract

Ours (envelope, Zod at the edge):

| Route | Input | Success | Failures |
|-------|-------|---------|----------|
| `POST /auth/isp/signup` | `{name: ≥2, email}` | 201 `{type:"isp", …}`; OTP sent | 409 `EMAIL_TAKEN` · 400 |
| `POST /auth/store/accept-invitation` | `{token, email, password: ≥8}` | 200 actor + session | 400 `INVALID_TOKEN` · 409 `EMAIL_TAKEN` · 400 |
| `GET /auth/me` | session | actor envelope | 401 / 403 as today |

Better Auth's (exempt from the envelope, via its client): `email-otp/send-verification-otp`,
`sign-in/email-otp` (ISP), `sign-in/username` (store: phone as username),
`passkey/*` (enrol + sign-in), `sign-out`, `get-session`.

## Business rules

1. One Better Auth user per actor; `userId` unique in `isps` and `stores`.
2. The ISP's first successful OTP sign-in marks the email verified — the
   old D3 gate ("unverified cannot register stores") holds with Better
   Auth's own `emailVerified`.
3. Store daily login is phone + password (US-S01 unchanged); email is for
   registration and recovery only (owner decision).
4. Status is checked in the DB on every authenticated request (US-S03).
5. Error causes are logged distinctly server-side even when the client gets
   one generic code — TD-012's lesson, applied from day one.

## UI Contract

- **Admin**: `/login` and `/signup` become two-step (email → code); no
  password fields anywhere. Passkey enrolment offer after login; passkey
  sign-in button on `/login`. `/verify` and `/reset` pages die.
- **Tienda**: login unchanged (phone + password). `/invitation/$token` adds
  an email field with plain es-MX copy on why it is asked ("para recuperar
  tu acceso"). Passkey enrolment offer after login.
- Copy never mentions "Better Auth"; errors stay generic (D5 of the old
  spec still applies).

## Scenarios

1. ISP signup → 201, OTP arrives via hook, code signs in, `emailVerified`
   true, `isps.userId` linked (US-S04)
2. Taken email on signup → 409 `EMAIL_TAKEN`
3. Store accepts invitation with email + password → active, linked, signed
   in (US-S05); reused/unknown token → 400 `INVALID_TOKEN`
4. Store daily login phone + password → session (US-S01); wrong password →
   401 with no existence leak
5. Suspension mid-session → next request 403 `ACCOUNT_SUSPENDED`, cookies
   cleared (US-S03)
6. Session survives across requests and days without visible expiry
   (US-S02, sliding window)
7. Email recovery: ISP requests a code and regains access; store recovers
   via email where before only the ISP re-send existed (US-S06)
8. Passkey: enrolment stores a credential; sign-in with it creates a
   session (US-S07; Playwright virtual authenticator)

## Definition of Done

- [ ] API migrated: Better Auth mounted, middleware on D4, old IdP client /
      `jwt.ts` / cookie pair deleted; scenarios 1–7 automated in
      `apps/api/test/`
- [ ] `sessions.spec.md`, `isp-signup.spec.md`, `store-invitation.spec.md`
      updated to point here (they keep their history; this spec owns the
      contract now)
- [ ] Admin two-step access pages built and tested (component layer)
- [ ] Tienda invitation email field + recovery page built and tested
- [ ] Custom domains live (`api./tienda./admin.devoladapago.com`),
      `CROSS_SITE_COOKIES` deleted
- [ ] Passkey end-to-end green with Playwright's virtual authenticator
      (scenario 8)
- [ ] TECH_DEBT updated: TD-001 and TD-012 paid by elimination; the
      `feat/store-email` draft discarded in favour of D3
- [ ] `integrations/agnostic-auth.md` closed with a pointer here (kept as
      history of why we left)

## Spike (gate, run 2026-08-15 — all green)

`better-auth@1.6.29` + `@better-auth/passkey@1.6.29` on workerd + real D1
via `vitest-pool-workers` (our existing test infra), 4 tests, 312ms:
session row + working cookie · email OTP through our hook · phone-as-username
+ password · passkey challenge with correct `rpID`. Findings that shape this
spec: the passkey plugin is its own package (guides showing
`better-auth/plugins/passkey` are stale); **no `nodejs_compat` needed**; an
official `phone-number` plugin (SMS OTP) exists for when TD-003 is paid.
