---
status: current
stories: [US-S01, US-S02, US-S04, US-S05, US-S06, US-S07]
domain: auth
updated: 2026-09-02
debt: [TD-003]
---

# Spec: Better Auth migration — email codes as the master key, passkeys

> **2026-08-31, retirement PR**: D3 (phone as username) and D8 (store invitations) retired with the store network (`devolada-red`) — the `username()` plugin is removed. Everything ISP-side (email OTP, passkeys, custom domains) stays in force.

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
  `api./punto./app.devoladapago.com`, `rpID = devoladapago.com`. Dev:
  `api./punto./app.dev.devoladapago.com`, `rpID = dev.devoladapago.com`
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
- **D11 — The rate limiter is explicit, counts in D1, and is on unless
  told otherwise (identity round, 2026-09-02).** The contract below used
  to say the built-in limiter "stays on"; nothing configured it, and the
  default it inherited was two lies on Workers: enabled only under
  `NODE_ENV=production` (which no deploy sets) and counters in the
  isolate's memory (reborn every few minutes, never shared). Now
  `rateLimit.enabled` is `AUTH_RATE_LIMIT !== "off"`, storage is the
  `rateLimit` table (migration 0026, pruned by Better Auth), and the
  address is read from `cf-connecting-ip` first — the default header list
  is `x-forwarded-for` alone, and a request with no resolvable address
  shares one bucket with every other visitor. Rules: Better Auth's own
  (sign-in 3 per 10 s, code requests 3 per 60 s) plus ours for the doors
  that had none — `email-otp/verify-email` and `email-otp/reset-password`
  5 per 60 s (the six digits already die after 3 wrong tries per code),
  `organization/accept-invitation` 10 per 60 s. `AUTH_RATE_LIMIT=off`
  exists for the API test suite only (hundreds of sign-ins from one
  address); no wrangler environment defines it. **Known gap**: our own
  `POST /auth/business/signup` is a Hono route, outside the limiter — it
  calls Better Auth server-side, which skips the check (open item 6).
- **D13 — Verification gates one act: inviting (owner, 2026-09-02).**
  *Superseded the same day by D16: the gate moved to the session.*
  Rule 2's old gate left with the stores and the banner kept promising
  "para operar". Now the only door that reads `emailVerified` is
  `POST /businesses/members` (and the resend), answering 403
  `EMAIL_NOT_VERIFIED`: inviting is the one act that uses your identity
  toward someone else. The banner says so ("Confirma tu correo para
  invitar a tu equipo"), lives in the shell only — it left the wizard,
  where it sat as an indented box under "Tu negocio está listo" — and
  Usuarios shows a notice instead of the invite form while unverified.
  The signup route sends the código itself (`sendVerificationOTP`)
  instead of the plugin's sign-up hook, so a user born through an
  invitation (D14) gets none. **Rejected**: gating the CLABE (the owner
  entering their own account is not an attack on anyone); no gate at
  all (then the code is theatre and the field should go).
- **D14 — The invitation page decides for the invitee (owner,
  2026-09-02).** "Entra o crea tu cuenta" asked the invitee a question
  only the system could answer. Now `/invitaciones/:id` reads
  `GET /businesses/invitations/:id/preview` — session-less, the random id
  is the key — and shows ONE form with the invited address fixed: no
  account for it → name + new password →
  `POST /businesses/invitations/:id/accept-new` creates the user **born
  verified** (the link arrived in that inbox), accepts, activates the
  business and signs in; an account exists → the password alone signs in,
  accepts and activates; signed in with the invited address → accepts on
  sight; signed in with another → says so and offers to switch. Expired
  and gone invitations are named for what they are. The email is never
  typed — typing another only ever produced "otro correo". This is what
  the store-era invitation did (retired D8) before the organization plugin
  made it two doors.
- **D15 — Our own routes have a tope (owner, 2026-09-02).** D11's known
  gap closed: Better Auth's limiter never sees a Hono route, so
  `auth/rate-limit.ts` reuses the `rateLimit` table with a `hono:` key
  prefix — same off switch (`AUTH_RATE_LIMIT`), same headers.
  `business/signup` 5 per 60 s, `invitations/:id/preview` 30 per 60 s,
  `invitations/:id/accept-new` 5 per 60 s.
- **D16 — Verification gates the session (owner, 2026-09-02; supersedes
  D13).** The account the person is creating will hold a CLABE and be
  recovered through its email: a mistyped address made a business nobody
  could reach and nobody could recover. So the código is the door, not a
  banner: `POST /auth/business/signup` births the user **without a
  session**; Better Auth's `requireEmailVerification` makes `sign-in/email`
  answer 403 `EMAIL_NOT_VERIFIED` until the flag is up; and
  `email-otp/verify-email` — `autoSignInAfterVerification`, pinned
  against 1.6.29's dist — creates the session itself. The middleware is
  the belt: a session whose user is unverified (a row from before the
  gate, or seeded by hand) is revoked with the same code. Three
  consequences, all built: (1) an **unverified account is not a taken
  email** — a fresh signup with the same address replaces it, password
  and pending código included, so a typo never locks its owner out; a
  verified account stays taken for good. (2) Login with the right
  password and an unproven address sends a fresh código and lands on the
  code screen; the code screen offers "Reenviar" and "Usar otro correo".
  (3) D13's machinery leaves: the shell banner, the Usuarios notice and
  the invite-side check are gone — nobody unverified holds a session, so
  every door is the same door. The invitee of D14 is untouched: born
  verified, signed in by the accept route right after the flag.
  **Rejected**: keeping D13's partial gate (it needed three pieces of UI
  to say what one screen says, and still let a wrong address hold a
  CLABE); a hard wall when the código email fails (the screen offers the
  resend — the provider's outage is a wait, not a lockout).
- **D17 — A new password closes every door the old one opened (owner,
  2026-09-02).** `revokeSessionsOnPasswordReset: true`: the reset-by-código
  deletes the user's sessions, so a stolen or forgotten session does not
  outlive the reset by up to 30 days. The person who reset is signed in
  again by the recovery page itself (scenario 7). **Rejected**: Better
  Auth's default (keep them) — recovery is the moment the person says the
  old credential is compromised.
- **D18 — Passkeys are listed and removable, and the copy tells the
  synced truth (owner, 2026-09-02).** The Configuración card lists every
  credential of the user (`passkey/list-user-passkeys`: name or "Llave de
  acceso", the enrolment date, "sincronizada con tu llavero" when
  `backedUp`) with a "Quitar" each (`passkey/delete-passkey`), and says
  "Ningún dispositivo…" when empty; enrolling refreshes the list, so the
  card knows what it has. The copy adds: "Si tu llavero de iCloud o de
  Google sincroniza tus llaves, también servirá en tus otros
  dispositivos" — "este dispositivo" alone was a half-truth for synced
  passkeys. List and delete go through plain fetches (`lib/api.ts`), the
  Better Auth client stays for the WebAuthn ceremonies only. **Rejected**:
  renaming (`update-passkey`) — nothing asked for it yet; the enrolment
  offer is still never forced (D7).
- **D12 — Login and signup remember where you were going.** The shell's
  guard sends a session-less visit to `/login?next=<path>`; the
  invitation page sends its two doors (`Entrar`, `Crear cuenta`) to
  `next=/invitaciones/:id`. `next` is validated by the route: a same-app
  path or nothing — never a host, or the login page is an open redirect
  one query string away. After login or signup the person lands on
  `next`, else on `/` (login) or the wizard (signup). This closed two
  findings at once: the operator bounced from `/links` who landed on the
  feed, and the invitee without an account who was told "después vuelve
  a abrir el link" and could create a business of their own instead of
  accepting. The bounce is imperative and fires once: `<Navigate>`
  re-navigates on every render, and a search object that never settles
  looped the shell into a heap-out-of-memory in the suite.

## Contract

Ours (envelope, Zod at the edge):

| Route | Input | Success | Failures |
|-------|-------|---------|----------|
| `POST /auth/business/signup` | `{name: ≥2, email, password: ≥8}` | 201 `{type:"user", id, name, emailVerified:false}`, **no session** (D16: `verify-email` opens it); code email best-effort. Births the user only — the business is born in the wizard (business-and-memberships D5). An unverified account with the same email is replaced | 409 `EMAIL_TAKEN` (verified accounts only) · 400 · 429 (D15) |
| `GET /auth/me` | session | business actor envelope (business-and-memberships D4) | 401 / 403 `EMAIL_NOT_VERIFIED` (D16, session revoked) · `ACCOUNT_SUSPENDED` · `NO_BUSINESS` · `NO_ACTIVE_BUSINESS` · `MEMBERSHIP_REVOKED` |
| `GET /businesses/invitations/:id/preview` | none (D14) | `{status: pending\|expired\|gone, businessName, role, email, hasAccount}` | 429 (D15) |
| `POST /businesses/invitations/:id/accept-new` | none (D14) | `{name: ≥2, password: ≥8}` → 201 actor + session; the user is born verified | 404 `INVITATION_NOT_FOUND` · 409 `EMAIL_TAKEN` · 400 · 429 |
| `GET /support` | none | `{whatsapp, email}` from `platform_settings` (operator-panel D1) — the suspended screen's channel | — |

`POST /auth/isp/signup` and `POST /auth/store/accept-invitation` are gone:
the first renamed with the pivot (2026-08-31), the second left with the
store network. Member invitations ride the organization plugin
(business-and-memberships D8).

Better Auth's (exempt from the envelope, via its client — endpoint names
pinned against `better-auth@1.6.29`'s dist, not its guide): `sign-in/email`,
`email-otp/send-verification-otp` + `email-otp/verify-email` (registration
proof — and the session's birth, D16; `sign-in/email` answers 403
`EMAIL_NOT_VERIFIED` before it), `email-otp/request-password-reset` + `email-otp/reset-password`
(recovery), `passkey/*` (enrol + sign-in), `sign-out`, `get-session`,
`organization/*` (list, set-active, accept-invitation — business spec).
The rate limiter in front of all of them is D11's.

## Business rules

1. One Better Auth user per actor; `userId` unique in `isps` and `stores`.
2. Typing the correct code flips Better Auth's own `emailVerified` and
   opens the session; without the flag there is no session at all —
   sign-in refuses, the middleware revokes (D16). A user born through an
   invitation is verified at birth (D14).
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
  unchanged in shape; `/recover` asks for the email, then code + new
  password on one screen. Passkey enrolment offer after login. *(The
  "Confirma tu correo" banner of the first cut left with D16.)*
- **Admin, `/verify-email` (D16)**: the código screen — title "Confirma tu
  correo", the address named ("Escribe el código de 6 dígitos que
  enviamos a …", from `?email=`; typed when the URL has none), a six-digit
  input, "Confirmar" (waits for six digits), "Reenviar código" that
  confirms ("Código reenviado"), "Usar otro correo" (→ `/signup`: the
  unverified account is replaced) and "Volver a iniciar sesión". Signup
  lands here; login with an unverified address lands here after sending a
  fresh código; the código lands on the wizard (no business yet) or on
  `next`. A wrong código: "El código no es válido o ya venció. Reenvíalo e
  intenta otra vez."
- **Admin, session round (2026-09-02)**: Configuración ends with a
  **Sesión** card for every role at every width — the email and "Cerrar
  sesión" (BUG-016; the desktop sidebar keeps its button); the passkey
  card lists and removes credentials (D18).
- **Admin, identity round (2026-09-02)**: `/login` and `/signup` honour
  `next` (D12). Signup names each problem under its field before the
  request leaves (name ≥ 2, email shape, password ≥ 8 — the API's own
  Zod rules), with `aria-invalid` and a hint under the password; the
  server's 400 is no longer the first word about a short password.
  `/recover` **restores access**: the new password signs the person in
  and lands on the feed — the login page is not visited again; its
  "Reenviar código" confirms ("Código reenviado"), as the banner's does.
  `/invitaciones/:id` names the one failure the person can fix — signed
  in with another email than the invited one
  (`YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION`) — with the email they
  used and a button to switch accounts that comes back to the invitation;
  every other failure keeps the generic "no es válida o ya venció".
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

1. ISP signup → 201 and **no session**; the code arrives through our hook;
   sign-in before it → 403 `EMAIL_NOT_VERIFIED`; typing it flips
   `emailVerified` and opens the session; the wizard follows (US-S04, D16)
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
10. A fourth sign-in from one address within ten seconds → 429 with
    `X-Retry-After`, and the count is a row in `rateLimit`; the sixth
    `verify-email` in a minute → 429 (D11)
11. A session-less visit to `/links` → `/login?next=/links`; login lands
    on `/links`. `?next=https://evil.example` is dropped and login lands
    on the feed (D12)
12. Signed in with another email than the invited one, the invitation
    page says so and offers to switch (D14)
13. *(rewritten with D16)* An unverified user's cookie opens nothing: the
    first request answers 403 `EMAIL_NOT_VERIFIED` and revokes the row,
    the next answers 401. The signup still stores a código.
14. The invitation page: preview names business, role and email; a new
    user is born verified without a código and lands inside as the
    invited role; an address with an account gets the password form; an
    expired invitation answers `expired` and refuses `accept-new` (D14)
15. The sixth signup from one address in a minute → 429 (D15)
16. A mistyped, unverified address signs up again → 201, one user row,
    the new password and a fresh código (the old one dead); a verified
    address → 409 `EMAIL_TAKEN`. Login with the right password and an
    unverified address → a fresh código goes out and the code screen takes
    over; a wrong código is named and the button waits for six digits (D16)
17. A session row two days old, on its next request → 200, the row's
    `expiresAt` moves 30 days out **and** the response re-issues the
    cookie with `Max-Age=2592000`; a row under a day → no cookie (BUG-015,
    D5's promise made true)
18. Reset the password by código → the session that was alive before it
    answers 401 (D17)
19. The passkey card lists two credentials (one synced), "Quitar" deletes
    one and the list refreshes; with none it says so and still offers to
    enrol (D18). Configuración's Sesión card signs a viewer out and lands
    on login (BUG-016)

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
- [x] Custom domains live (`api./punto./app.devoladapago.com`, dev under
      `.dev.`), `CROSS_SITE_COOKIES` deleted — verified 2026-08-15 against
      deployed dev: the session cookie is `SameSite=Lax` and the browser
      login that looped under `workers.dev` (third-party cookie blocking)
      works. `punto.` instead of `tienda.` is the owner's naming: it is
      what the end customer sees.
- [x] Passkey end-to-end green with Playwright's virtual authenticator
      (scenario 9) — `tests/passkey/passkey.spec.ts` against a real
      wrangler + D1 (`pnpm e2e:passkey`, wired into deploy-dev): enrol,
      sign out, sign in with one touch. Buttons in both logins, enrolment
      offered in admin Settings and the tienda Caja, hidden wherever
      `PublicKeyCredential` does not exist.
- [x] TECH_DEBT updated: TD-001 and TD-012 paid by elimination; the
      `feat/store-email` draft discarded in favour of D3 (PR #31)
- [x] `integrations/agnostic-auth.md` closed with a pointer here (kept as
      history of why we left)
- [x] Identity round, spec PR (2026-09-02): D13–D15 built and tested
      (`apps/api/test/identity-round.test.ts`, scenarios 13–15;
      `apps/admin/test/memberships.test.tsx` for the invitation page,
      `identity-round.test.tsx` for the gate); the six open items below
      resolved into decisions here and in business-and-memberships
      (D5, D8, D11, D12) and operator-panel (D1: the support channel)
- [x] Identity round (2026-09-02): D11 armed and counting in D1
      (`apps/api/test/rate-limit.test.ts`, scenario 10); D12 in the shell,
      the invitation page and both access pages (`apps/admin/test/shell.test.tsx`,
      `memberships.test.tsx`, scenarios 11–12); recovery restores access
      (scenario 7 as written); signup validates in place; the contract
      table above says what the code exposes (it listed `/auth/isp/signup`
      and a store route for a month after both died)

- [x] D16 (2026-09-02, the same day's second look): the gate moved from
      inviting to the session — `requireEmailVerification` +
      `autoSignInAfterVerification`, the middleware belt, the replacing
      signup, `/verify-email` (`apps/api/test/isp-signup.test.ts`
      scenarios 1, 8, 16; `sessions.test.ts` and `identity-round.test.ts`
      scenario 13; `apps/admin/test/shell.test.tsx` for the code screen);
      D13's banner, notice and invite-side check removed; the journey e2e
      walks the código first

- [x] Session round (2026-09-02): BUG-015 (the cookie slides:
      `sessions.test.ts` scenario 17), D17 (`sessions.test.ts` scenario
      18), D18 and BUG-016 (`apps/admin/test/session-round.test.tsx`
      scenario 19; `tests/passkey/passkey.spec.ts` sees the listed
      credential and signs out from the Sesión card)

## Open items — resolved 2026-09-02

The six questions the identity round left for the owner, and where each
answer lives now: (1) what verification gates → D13, superseded by D16 the
same day (the session); (2) invitation TTL
and lifecycle → business-and-memberships D8 (48 h, the owner rejected 7
days: the invitee is staff with a resend at hand); (3) role change →
business D12; (4) who lists the team → business D11; (5) the suspended
screen's channel → operator-panel D1 (`support_whatsapp`,
`support_email`, read through `GET /support`); (6) the signup route and
the limiter → D15. A seventh, raised by the owner in the same review:
registration is not onboarding → business D5.
