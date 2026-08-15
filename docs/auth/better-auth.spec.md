---
status: in-development
stories: [US-S01, US-S02, US-S04, US-S05, US-S06, US-S07]
domain: auth
updated: 2026-08-15
debt: [TD-003]
---

# Spec: Better Auth migration — email codes as the master key, passkeys

Replaces Agnostic Auth with [Better Auth](https://better-auth.com) running
inside `apps/api`: sessions in our own D1, passwords for daily login (email
for the ISP, phone for the store), passkeys on top of both, and **email as
the master key for registration and recovery of both roles, proven with a
one-time code (OTP), never a link** (owner decision, 2026-08-15). This spec
absorbs the `feat/store-email` branch: its intent — stores get an email —
survives; its column does not (D3).

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
- **D2 — Identity per actor; email is the master key of both.** Daily login
  keeps passwords: ISP with **email + password** (owner decision 2026-08-15:
  the password stays — a code round-trip per login buys nothing over a
  password the admin already knows), store with **phone + password**
  (US-S01's counter reality: a shopkeeper mid-queue cannot fetch a code).
  **Registration and recovery run through an email code for both roles**
  (owner decision 2026-08-15): signing up or recovering access means proving
  you hold the email, by typing the code it received. Passkeys (D6) sit on
  top of both. Discarded: passwordless OTP-only daily login; email login for
  stores.
- **D3 — One email, one place.** The Better Auth `user` row holds the email;
  `isps` and `stores` link to it via a unique nullable `userId` (null until
  signup/acceptance completes). `stores` does **not** get its own email
  column — that was `feat/store-email`'s draft, superseded here because two
  copies of an email always end up disagreeing. `passwordHash`/`passwordSalt`
  leave both tables (Better Auth's `account` table owns credentials). The
  store's user carries the shopkeeper's **real** email; the phone lives in
  the `username` field for login.
- **D4 — Codes, not links.** Every email-ownership proof is a short numeric
  code typed into the app, never a clickable link. Three reasons, all paid
  for in blood: **(a)** a link signs in the device that opens the email — a
  shopkeeper whose inbox lives on their personal phone would sign in *there*,
  not on the store phone where the app runs; a code is read anywhere and
  typed where the session belongs. **(b)** Links rot — TTL, one-time tokens
  consumed by mail-scanner prefetch, and the wrong-domain workaround we
  maintained for the IdP's `magicLink`. The entire *"Este enlace ya no
  sirve"* class of failure (TD-012's trigger) dies with the links. **(c)**
  The user never leaves the screen that asked, so context survives.
  Discarded: magic links (the previous draft of this spec).
- **D5 — The middleware keeps our guarantees.** Better Auth resolves the
  session (its own cookie, **30-day sliding in both apps** — owner decision
  2026-08-15; US-S01's "weeks", US-S02's no-visible-expiry). Its cookie
  session cache stays **off**: `findActor` loads the actor by `userId` and
  checks `status` **on every request** — that DB hit is US-S03, so caching
  around it would buy nothing and delay suspensions (US-S03). `gm_access`/`gm_refresh` and `src/auth/jwt.ts` die. A suspended
  store can complete a sign-in but its first API call answers 403
  `ACCOUNT_SUSPENDED` and clears the session — same screen as today, one
  request later.
- **D6 — One `/auth` namespace, two response shapes.** Our thin routes
  (signup, invitation acceptance, `/auth/me`) keep the envelope and are
  registered first; everything else under `/auth/*` falls through to the
  Better Auth handler, whose endpoints are consumed through the Better Auth
  client and are **exempt from the envelope** — documented here so the
  exemption is a rule, not an accident.
- **D7 — Passkeys need our domain, and dev gets its own rpID.** Prod:
  `api./tienda./admin.devoladapago.com`, `rpID = devoladapago.com`. Dev:
  `api./tienda./admin.dev.devoladapago.com`, `rpID = dev.devoladapago.com`
  (owner decision 2026-08-15) — sharing one rpID would make the browser
  offer dev-enrolled passkeys on the prod login. Local dev: `localhost`.
  Everything becomes same-site: `CROSS_SITE_COOKIES` and its
  `SameSite=None` machinery are deleted with the domain move. Enrollment is
  offered after login in both apps, never forced. Caveat stated in the UI:
  a passkey identifies **this device** — on a shared store phone that means
  the device, not the person.
- **D8 — Invitations become fully ours, never block on email, and live 7
  days.** The invitation token is a random id in our `invitations` table
  (no IdP `initiate`), **single-use, valid 7 days**. This fixes a measured
  product bug: today's tokens come from the IdP with `tokenTtlSeconds: 900`
  — an invitation traveling by WhatsApp to a shopkeeper who opens it "later"
  is dead in 15 minutes, and nobody had noticed. Acceptance collects **email + password**, creates the Better
  Auth user server-side, links `stores.userId`, activates the store and
  signs it in — the store is operational even if the code email fails
  (inherited law: onboarding never depends on the email provider). The code
  verification happens right after, skippable; until the email is verified
  it cannot recover access, and the ISP re-send remains the fallback.
- **D9 — Resend stays the sender; the templates become codes.** Better
  Auth's OTP hook calls the existing `src/email/sender.ts` (TD-011's live
  domain) with a new `code` template — subject and body carry the six
  digits in plain es-MX. The `verify`/`recover` link templates die with the
  links. Without `RESEND_API_KEY` the code is logged to the console, as the
  links are today.
- **D10 — Schema comes from the generator.** `@better-auth/cli generate`
  produces the drizzle tables (`user`, `session`, `account`, `verification`,
  `passkey`), cross-checked against the spike's hand-written schema. One
  migration; dev D1 is reseeded, nothing is migrated.

## Contract

Ours (envelope, Zod at the edge):

| Route | Input | Success | Failures |
|-------|-------|---------|----------|
| `POST /auth/isp/signup` | `{name: ≥2, email, password: ≥8}` | 201 `{type:"isp", …}` + session; code email best-effort | 409 `EMAIL_TAKEN` · 400 |
| `POST /auth/store/accept-invitation` | `{token, email, password: ≥8}` | 200 actor + session; code email best-effort (D8) | 400 `INVALID_TOKEN` · 409 `EMAIL_TAKEN` · 400 |
| `GET /auth/me` | session | actor envelope | 401 / 403 as today |

Better Auth's (exempt from the envelope, via its client — endpoint names
pinned against `better-auth@1.6.29`'s dist, not its guide): `sign-in/email`
(ISP), `sign-in/username` (store: phone as username),
`email-otp/send-verification-otp` + `email-otp/verify-email` (registration
proof, both roles), `email-otp/request-password-reset` +
`email-otp/reset-password` (recovery, both roles), `passkey/*` (enrol +
sign-in), `sign-out`, `get-session`. Better Auth's built-in rate limiter
stays **on**: it guards `send-verification-otp` against mail-bombing and
the 6-digit code against brute force.

## Business rules

1. One Better Auth user per actor; `userId` unique in `isps` and `stores`.
2. Typing the correct code flips Better Auth's own `emailVerified`; an
   unverified ISP signs in but cannot register stores — the old gate holds,
   now reading the Better Auth user. An unverified store operates normally
   but cannot self-recover (D8).
3. Store daily login is phone + password (US-S01 unchanged); the email is
   for registration proof and recovery only.
4. Status is checked in the DB on every authenticated request (US-S03).
5. Recovery answers the same 200 whether the email exists or not; the code
   only goes out when it does (no existence leak).
6. Error causes are logged distinctly server-side even when the client gets
   one generic code — TD-012's lesson, applied from day one.

## Delivery

Two PRs, because merging to `main` deploys dev: **PR 1** carries API + admin
+ tienda together (a half-migrated API with old frontends leaves dev broken
between merges). **PR 2** carries the custom domains + the passkey UI
(scenario 9): nothing breaks while they are missing, and passkey ceremonies
cannot pass on `workers.dev` origins anyway. `BETTER_AUTH_SECRET` is a new
worker secret in `.dev.vars` and both GitHub environments, synced by the
existing CI step and — TD-001's lesson — verified behaviourally (sign in,
then `/auth/me`), never by listing names.

## UI Contract

- **Admin**: `/login` (email + password + passkey button), `/signup`
  unchanged in shape; the "Confirma tu correo" banner gains a **code input**
  instead of pointing at an emailed link. `/recover` asks for the email,
  then code + new password on one screen. Passkey enrolment offer after
  login.
- **Tienda**: login unchanged (phone + password + passkey button).
  `/invitation/$token` adds an email field with plain es-MX copy on why it
  is asked ("para recuperar tu acceso si olvidas tu contraseña"), then an
  optional code step (D8). `/recuperar` mirrors the admin's code + new
  password screen. Passkey enrolment offer after login.
- **Admin, store detail**: shows the store's recovery email, full and
  read-only (owner decision 2026-08-15 — the ISP is the shopkeeper's first
  line of support and should see where recovery codes go; discarded:
  hiding it as personal data — the owner weighed support over privacy).
- Codes are called **código** in copy — never "token", "OTP" or "enlace".
  Copy never mentions "Better Auth"; errors stay generic.

## Scenarios

1. ISP signup → 201 + session; the code arrives through our hook; typing it
   flips `emailVerified`; `isps.userId` linked (US-S04)
2. Taken email on signup → 409 `EMAIL_TAKEN`
3. Store accepts invitation with email + password → active, linked, signed
   in **even when the code email fails** (D8); the code verifies after
   (US-S05); reused/unknown token → 400 `INVALID_TOKEN`
4. Store daily login phone + password → session (US-S01); wrong password →
   401 with no existence leak
5. Suspension mid-session → next request 403 `ACCOUNT_SUSPENDED`, cookies
   cleared (US-S03)
6. Session survives across requests and days without visible expiry
   (US-S02, sliding window)
7. Recovery: email → code → new password restores access for the ISP **and**
   for the store, where before only the ISP re-send existed (US-S06);
   unknown email → identical 200
8. Wrong or expired code → one generic error to the client, the distinct
   cause in the server log (TD-012's lesson)
9. Passkey: enrolment stores a credential; sign-in with it creates a
   session (US-S07; Playwright virtual authenticator)

## Definition of Done

- [x] API migrated: Better Auth mounted, middleware on D5, old IdP client /
      `jwt.ts` / cookie pair deleted; scenarios 1–8 automated in
      `apps/api/test/` (82/82 in workerd, 2026-08-15)
- [x] `sessions.spec.md`, `isp-signup.spec.md`, `store-invitation.spec.md`
      updated to point here (they keep their history; this spec owns the
      contract now)
- [x] Admin pages: código input in the banner, código-based `/recover`,
      store detail shows the recovery email — built and tested (28/28).
      The passkey button ships with PR 2 (it cannot work on `workers.dev`
      origins, so offering it earlier would be a lie).
- [x] Tienda pages: invitation email field + optional código step,
      `/recuperar`, "¿Olvidaste tu contraseña?" — built and tested (46/46).
      Passkey button: PR 2, same reason.
- [ ] Custom domains live (`api./tienda./admin.devoladapago.com`),
      `CROSS_SITE_COOKIES` deleted
- [ ] Passkey end-to-end green with Playwright's virtual authenticator
      (scenario 9)
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
`better-auth/plugins/passkey` are stale); an official `phone-number`
plugin (SMS OTP) exists for when TD-003 is paid. One spike finding did
**not** survive contact with wrangler: "no `nodejs_compat` needed" was
true only under vitest-pool-workers, which resolves node builtins itself
— wrangler's bundling needs the flag (`No such module "node:crypto"`
otherwise), so `wrangler.jsonc` carries it.
