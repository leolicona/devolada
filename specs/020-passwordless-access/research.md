# Research: Passwordless Access

**Feature**: `020-passwordless-access` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

Every fact about the auth library below was read on 2026-10-02 in the
published dist of the versions `apps/api` pins: `better-auth@1.6.29` and
`@better-auth/passkey@1.6.29` (`npm pack`, then the files named). Where
reading is not enough, the fact goes to the quickstart's measurements
(M1–M6) before code depends on it.

Decisions are cited in code as `passwordless-access D<n>`.

---

## D1 — One door for registration and sign-in: the email-OTP plugin's sign-in

Registration and sign-in both use two Better Auth endpoints that are
already installed and already open:

- `POST /auth/email-otp/send-verification-otp {email, type: "sign-in"}`
  sends a código.
- `POST /auth/sign-in/email-otp {email, otp, name?}` checks it and opens the
  session.

What the dist does (`plugins/email-otp/routes.mjs`):

- **A código goes out for any address.** With `type: "sign-in"` and
  `disableSignUp` unset, it is sent whether or not a user exists (line 102:
  `shouldSendOTP = type === "sign-in" && !opts.disableSignUp`). The answer
  is always `{success: true}`. That is FR-005 and FR-013's "same answer for
  every address", for free.
- **The account is born at the código.** `signInEmailOTP` (line 385)
  consumes the código. If no user exists, it creates one with
  `emailVerified: true` and `name: name || ""`, opens a session and sets the
  cookie. That is FR-004: before the código, nothing exists.
- **An existing account just signs in.** `name` is ignored for an existing
  user ("Only used if the user is registering for the first time"). That is
  FR-005: registering with a taken address opens it.
- **A legacy unverified account is cleaned.** If the user exists but was
  never verified, `revokeUnprovenAccountAccess` deletes its `credential`
  account (a password someone else may have set) and its sessions, then
  marks it verified (`db/revoke-unproven-account-access.mjs`).

So the panel's registration is: name and email → `send-verification-otp` →
the código → `sign-in/email-otp` with the name. The panel's sign-in is the
same, without a name. Our `POST /auth/business/signup` (better-auth D15,
D16) retires, and so does the panel's use of `email-otp/verify-email`.

**The name, when the account came through the sign-in door.** Such an
account is born with `name: ""`. The name is asked before anything else
(FR-013), on `/welcome` (D6), with `POST /auth/update-user {name}`. The order
is load-bearing: the passkey plugin's registration options name the WebAuthn
user `user.name || user.id` (`@better-auth/passkey` `index.mjs`, around line
165), so a key made before the name would show the device's account picker a
random id.

**Alternatives considered**:
- Keep `POST /auth/business/signup` and give it a código instead of a
  password. Rejected: the plugin already creates the account at the right
  moment, with the right flag; a route of ours would only re-implement it.
- `disableSignUp: true`, with our own route to create accounts. Rejected:
  it makes the sign-in door refuse unknown addresses, which tells a stranger
  the address has no account (FR-013).
- The plugin's `verify-email` for registration (today's door, better-auth
  D16). Rejected: it needs a user that already exists, unverified, which is
  the half-account FR-004 removes.

---

## D2 — The código's terms are written down: ten minutes, three tries, a hash

The `emailOTP` options gain three explicit values:

| Option | Today | Now | Why |
| --- | --- | --- | --- |
| `expiresIn` | unset → `300` (index.mjs line 14) | `600` | the creator's ten minutes (spec Assumptions) |
| `allowedAttempts` | unset → `3` | `3` | written down; better-auth D11 already counted on it |
| `storeOTP` | unset → `"plain"` (index.mjs line 16) | `"hashed"` | constitution V: a credential the product only ever compares is a SHA-256 hash |

- **The hash is SHA-256.** `defaultKeyHasher` is SHA-256, base64url
  (`plugins/email-otp/utils.mjs`). It is compared in constant time
  (`otp-token.mjs`).
- **Three tries kill a código.** A wrong try puts the row back with its count
  plus one (`atomicVerifyOTP`, routes.mjs line 760). At three, even the right
  código answers `TOO_MANY_ATTEMPTS`.
- **A new request must end the old código, and the plugin does not.**
  `resendStrategy` stays `"rotate"`; with a hash it could not be `"reuse"`
  anyway (types.d.mts: "Falls back to rotate when OTP is hashed"). But
  rotating only adds a row:
  - `resolveOTP` creates the new row without deleting the old one
    (routes.mjs line 30).
  - The check consumes the newest row for the address
    (`consumeVerificationValue`, `db/internal-adapter.mjs` line 675, sorted
    by `createdAt` descending).

  So an older código fails while a newer one is live, but works again for
  the rest of its ten minutes once the newer one is used. FR-003 says a new
  request ends the previous código. Fix: a `hooks.before` on
  `/email-otp/send-verification-otp` deletes that address's rows of that
  kind before the plugin writes the new one. It goes in the same
  `hooks.before` that refuses a `username` (cash-at-stores D3).
- **The deploy's edge.** A código sent before the deploy is stored plain and
  will not match its hash after it. Codes live five minutes today, so the
  edge is five minutes wide: the person asks for a new one. Nothing migrates.

This is a guarantee that lived in a default and was nobody's (the lesson of
business-and-memberships D8 and better-auth D11).

**Alternatives considered**:
- `storeOTP: "encrypted"`. Rejected: a código is only ever compared, never
  read back. Encryption keeps it readable by anyone holding the secret.

---

## D3 — Rate limits: the plugin's rules, one custom rule, and our own routes

Read in `api/rate-limiter/index.mjs` (`resolveRateLimitConfig`, line 276).
The order is: the default special rule, then a plugin's rule, then
`customRules`, each one overriding the last:

- `/sign-in/*` has a special rule of 3 per 10 s (line 372).
- The email-OTP plugin sets 3 per 60 s on `send-verification-otp`,
  `check-verification-otp`, `verify-email` and `sign-in/email-otp`
  (index.mjs line 75).

Decision:

- **`/sign-in/email-otp` gets a custom rule of 5 per 60 s**, the same as
  `/email-otp/verify-email` today (better-auth D11). The plugin's 3 per 60 s
  would stop a person who mistyped twice and then pasted the código. Three
  wrong tries already kill each código (D2).
- **`send-verification-otp` keeps 3 per 60 s.** It is what stops a script from
  filling an inbox.
- **Our own routes get `rateLimitRoute`** (better-auth D15). A Better Auth call
  made from our server skips its limiter (better-auth D11's known gap):
  - `POST /store/sign-in/code`: 3 per 60 s;
  - `POST /store/sign-in`: 5 per 60 s;
  - `POST /store/invitations/:token/code`: 3 per 60 s;
  - `POST /store/invitations/:token/accept` keeps 5 per 60 s.

The custom rules for `email-otp/verify-email` and `email-otp/reset-password`
leave with the paths they guard (D4).

---

## D4 — Closing the password doors, in two steps

Better Auth answers 404 to a path listed in `disabledPaths`. It checks this
in its router (`api/index.mjs` line 164), so the server's own `auth.api.*`
calls are not affected. That matters: D9 and D10 call
`checkVerificationOTP` and `createVerificationOTP` from our routes, while
the outside world cannot.

The store app keeps its password until User Story 6 ships (spec FR-029). Its
doors are `/sign-in/username` and `/email-otp/reset-password`, and both need
`emailAndPassword.enabled`. So the doors close in two steps, one per PR (D16):

**PR 1 (the panel):**
- `disabledPaths` gains `/sign-in/email` and `/sign-up/email`. These are the
  panel's only password doors. `emailAndPassword` stays enabled for the store.
- A panel user could still call `email-otp/reset-password` and set a
  password. No door would accept it: `/sign-in/email` is gone, and
  `/sign-in/username` needs a username, which only the store acceptance
  writes (cash-at-stores D3). D5's sweep erases it within a minute anyway.

**PR 2 (the store app):**
- `emailAndPassword.enabled: false`. With it go `requireEmailVerification`
  and `revokeSessionsOnPasswordReset` (better-auth D16, D17). The middleware's
  own check stays: a session whose user is unverified is revoked
  (better-auth D16's belt).
- `disabledPaths` gains `/sign-in/username`, `/email-otp/request-password-reset`,
  `/email-otp/reset-password`, `/forget-password/email-otp`,
  `/email-otp/verify-email` and `/email-otp/check-verification-otp`.
- The `username` plugin stays installed. It owns the `user.username` column
  where the store's phone lives (cash-at-stores D3), which D10 reads. The
  `hooks.before` refusal of `username` in a body stays as it is. Its one
  allowed path, `/sign-in/username`, is disabled, so no request may write a
  username: only the acceptance route does, directly.
- Email change stays off. The plugin's `request-email-change` and
  `change-email` refuse unless `changeEmail.enabled` (routes.mjs line 637),
  and it stays unset (spec: out of scope).

**Alternatives considered**:
- One step, both apps in one PR. Possible, and it removes the in-between
  state. Rejected as the default: the panel needs no notice to the pilot's
  shopkeepers (spec Dependencies), so it need not wait for one. The tasks may
  still merge the two if the notice is given first.
- Removing the `username` plugin. Rejected: `auth-schema.ts` comes from the
  generator (better-auth D10), and the column is still the store's phone.

---

## D5 — Erasing the passwords that exist: a sweep, not a migration

FR-029 erases every password, and the spec's edge case removes legacy
accounts whose email was never proven. Both are deletions of rows:

- `account` rows with `provider_id = 'credential'`;
- `user` rows with `email_verified = 0` that **no row names**, with their
  sessions, accounts and keys.

A migration cannot do it. Migrations are additive, because the per-PR
preview applies them to the dev database while the old Worker still serves
it (constitution, Technology Stack). A migration that deletes passwords would
lock dev out of the old Worker's password door for the length of the PR.

So it is a sweep on the every-minute cron (`src/index.ts`, `scheduled`):
`eraseLegacyCredentials(env)`, one `waitUntil`, logging only when it deleted
something (constitution: sweeps speak only when they did something).

- **Until PR 2**, it skips the users a store names, so the store's password
  keeps working.
- **From PR 2**, it erases them all.
- **After the first run** it finds nothing, at the cost of two small reads
  a minute.
- **Two deletions, each on its own** (analysis U1, 2026-10-02). The
  passwords go in one statement, and the legacy users in another after it.
  Inside one batch, a single row that still names a user would fail the whole
  batch every minute, and FR-029 would never finish.
- **"No row names" is a list, read on 2026-10-02.** None of the user columns
  in `schema.ts` holds the user: `payments.store_user_id`,
  `platform_settings.author_user_id`, `top_ups.submitted_by_user_id`,
  `credit_entries.granted_to_user_id`, `credit_entries.author_user_id`,
  `bench_receipts.uploaded_by`, `bench_readings.marked_by`,
  `stores.user_id`, `stores.created_by_user_id`,
  `store_invitations.created_by_user_id`,
  `store_handovers.declared_by_user_id`,
  `store_handovers.resolved_by_user_id` and `store_ledger.author_user_id`.
  None of them cascades. No `member` row holds the user either: that one
  cascades, but a membership means the account is in use. The `session`,
  `account` and `passkey` rows do not cascade, so they go first, in the
  users' batch. A column added later that names a user joins the list.
- **It is also a guarantee.** A password brought back by a restored export,
  or written by a door nobody remembered, is gone within a minute. That is
  SC-003's "zero", enforced rather than hoped for.

An unverified account cannot be anywhere else. Nobody unverified holds a
session (better-auth D16), so no such account created a business. After this
feature, every account is born verified (D1, D9, D10), so the sweep only ever
meets legacy rows. The store's unverified users (accepted, código never
typed) are kept: they get in by phone (D10).

**Alternatives considered**:
- A one-off command in the deploy workflow. Rejected: it runs once, so a later
  restore would bring the passwords back, and it is a step that dev and prod
  must both remember.
- Leaving the rows, since no door reads them. Rejected: FR-029 says erased.
  A table of password hashes is a liability even when unused: people reuse
  passwords elsewhere.

---

## D6 — The panel's screens: two-step doors, and one `/welcome` after them

- **`/login`** has two steps on one screen:
  1. "Entrar con huella o rostro" first, wherever the browser supports
     passkeys (`passkeysSupported`, today's check), then the email and
     "Enviar código". No line announces that passwords are gone (spec
     Clarifications, Q4).
  2. The código, with "Reenviar código" and "Usar otro correo".
  The address stays in the component, never in the URL.
- **`/signup`** has the same two steps, with the name and email in step 1.
  The name stays in memory until `sign-in/email-otp` carries it (D1).
- **`/welcome?next=`** is new. Every door that opens a session by código, or
  by an invitee's birth (D9), lands here. It does at most two things, in
  order:
  1. if the user has no name, it asks for it (D1);
  2. if the device can verify the person (D7), it offers the activation (D8).
  Then it goes to `next`, or `/`. When neither applies, it navigates before
  painting, so nobody sees a flash of it.
- **The shell's guard** sends a session whose user has no name to
  `/welcome?next=<path>`. That covers a person who closed the tab before
  naming themselves.
- **`/verify-email` and `/recover`** become redirects to `/login`, keeping
  `next` (better-auth D12's validated `next`) and dropping the address an
  old link may carry: an address never travels in a URL (analysis I5).
  Nothing links to them any more. A redirect is three lines and spares a
  bookmark the not-found page.
- **The invitation page** keeps its states (D9).
- **Cuenta → Seguridad** renders the shared keys card (D12) with the step-up
  (D8) and "Cerrar sesión en los demás dispositivos" (D11).

Routes are English identifiers, as the panel's are (payments-and-classes
D6); `/invitaciones/:id` and `/puntos-de-pago` stay the named exceptions.

**Alternatives considered**:
- Keep `/verify-email` as a route of its own, with the address and name in
  the URL. Rejected: a name and an address in the URL end up in history and
  logs, and the two-step screen needs neither.
- Merge registration and sign-in into one screen. Rejected: the spec keeps
  the two screens the creator described. They converge after the código
  (D1), which is what removes the leak.

---

## D7 — "Can verify the person itself": the platform check, and a click

Two checks, for two different offers (spec FR-016):

- **The browser supports passkeys**: `window.PublicKeyCredential`, today's
  `passkeysSupported()`. It decides the "Entrar con huella o rostro"
  button: the browser can reach a phone nearby, or a key in a synced
  keychain, even when the computer has no sensor.
- **The device can verify the person**:
  `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`,
  asked once per page load. It decides the activation step. It is true when
  a built-in authenticator can check the person: Touch ID or Face ID, Windows
  Hello, an Android phone's fingerprint or screen lock, a Mac's keychain. It
  is false on a desktop with none, where the browser would otherwise open a
  window asking for a phone or a security key in the middle of a
  registration (spec Assumptions).

The ceremony needs a click:

- **The click.** The activation's decisive button calls the ceremony inside
  its own click handler. Safari refuses a WebAuthn call without a user
  gesture, so "the system window opens at once" means: the step appears at
  once, and its one big button opens the window (spec FR-006).
- **Already enrolled.** The plugin sends `excludeCredentials` with the
  user's keys (passkey `index.mjs` line 168). On a device that already holds
  one, the browser refuses with `InvalidStateError`. That counts as done: "Este
  dispositivo ya tiene tu huella o rostro."
- **Cancelled.** `NotAllowedError` (cancelled, timed out) is the one-line
  message, with "Intentar de nuevo" and "Ahora no" (FR-009).

**Alternatives considered**:
- `window.PublicKeyCredential` alone, the creator's suggestion. Refined, not
  dropped: it still decides the sign-in button.
- `PublicKeyCredential.getClientCapabilities()`. Rejected for now: it is
  newer than the browsers the pilot meets, and the platform check answers the
  one question asked.

---

## D8 — A key needs a session younger than a day: the step-up

The passkey plugin registers a key only through `freshSessionMiddleware`
(passkey `index.mjs` lines 58 and 308). A session is fresh while
`now − session.createdAt < freshAge` (`api/routes/session.mjs` line 358), and
`freshAge` defaults to one day (`context/create-context.mjs` line 148). We do
not set it.

- **Every activation this feature offers right after a door is fresh.** The
  session was born seconds before, whether by código, by key or by an
  invitee's birth.
- **Seguridad's and Caja's "Activar en este dispositivo" are not.** A day
  after signing in, the ceremony answers `SESSION_NOT_FRESH`, and today's
  card shows "No se pudo activar". That is a bug in production now, read in
  the dist and not yet measured (M2). Nobody has hit it in tests, because
  every passkey case enrols right after signing up.

Decision: keep `freshAge`. A key outlives every session, so adding one asks
for a recent proof. On `SESSION_NOT_FRESH`, the card asks for a código first,
then runs the ceremony on the fresh session the código opened:

- **Panel**: the card knows the person's email. It calls
  `send-verification-otp` and then `sign-in/email-otp`, and Better Auth sets
  the new session's cookie.
- **Store app**: the store's `/auth/me` gains `email` (the shopkeeper's own
  address; showing it to their own session reveals nothing), and the card
  does the same.

The session the código replaced stays until it expires or is closed. FR-022
ends it on request.

**Alternatives considered**:
- `session.freshAge: 0`. Rejected: then anyone holding a stolen cookie can add
  their own key, and keep a way in after "Cerrar sesión en los demás
  dispositivos".
- Show "Activar" only while the session is fresh. Rejected: it hides a promise
  the spec makes (FR-006: "always in Cuenta → Seguridad").

---

## D9 — The member invitation page

The preview (`GET /businesses/invitations/:id/preview`, better-auth D14) is
unchanged: status, business, role, email and `hasAccount`.

- **With an account, no session.** Two doors:
  - "Entrar con huella o rostro" (`signIn.passkey()`). Its session then meets
    the page's existing logic: the invited address accepts on sight, another
    address gets the "otro correo" state with its switch (FR-018).
  - "Enviarme un código": `send-verification-otp` to `inv.email` (shown as
    text, never typed), then `sign-in/email-otp`, then the same acceptance.
  - Both end in `acceptInvitation` and `setActiveBusiness`, as today, then
    `/welcome?next=/`, so the activation is offered after a código.
- **Without an account.** `POST /businesses/invitations/:id/accept-new`
  takes `{name}` and no password. The invitation proves the inbox (D14), so
  the server:
  1. deletes any live sign-in código for that address (the plugin consumes
     one row per identifier, and a stray row would make the next step fail —
     the same care as better-auth D16's code);
  2. mints a código with `auth.api.createVerificationOTP` (server-only,
     routes.mjs line 121);
  3. consumes it at once with `auth.api.signInEmailOTP({email, otp, name},
     returnHeaders)`. The user is born verified and holds a session;
  4. accepts and activates with those cookies, as today;
  5. forwards the cookies.
  The page then goes to `/welcome?next=/`, where the name is already set.
- **"Olvidé mi contraseña" leaves.** The bug fix `invitee-lands-own-business`
  keeps its point: the código is asked here, so the invitee never leaves.

**Alternatives considered**:
- Create the user and the session through `internalAdapter` and set the
  cookie by hand. Rejected: signing Better Auth's cookie ourselves couples us
  to its cookie format. Minting a código and consuming it goes through the
  plugin's own door.

---

## D10 — The store app: the email at the invitation, the phone at the sign-in

**The invitation** becomes two calls to the `store` area:

1. `POST /store/invitations/:token/code {email}` checks the token (D4 of
   cash-at-stores). It sends a sign-in código to the email and answers
   `{sentTo}`, the address the person typed, whatever the address holds.
2. `POST /store/invitations/:token/accept {email, otp}`:
   - The token opens an invitation, as before.
   - **An address that is taken** (a user exists, or it is in
     `PLATFORM_OPERATOR_EMAILS`) is checked with
     `auth.api.checkVerificationOTP({email, type: "sign-in", otp})`:
     - a wrong código is `INVALID_OTP`, as for anyone;
     - a right one, or the plugin's `USER_NOT_FOUND` for an operator address
       without an account (it validates the código first: routes.mjs
       line 260), is `EMAIL_TAKEN` (409), named only now (FR-032).
     The código row is then deleted. The invitation stays `sent`.
   - **A new address** goes through
     `auth.api.signInEmailOTP({email, otp, name: store.shopkeeperName},
     returnHeaders)`. The user is born verified, with a session.
   - Then comes today's batch (T089): the store is linked first, then the
     username and the invitation are written only if the link is this
     user's. If it fails, the user is removed and the invitation stays
     `sent` (D5's rollback).
   - **A race guard.** The address could gain a user between the check and
     the sign-in. If the user that comes back already has a membership or a
     store, the new session is deleted, nothing is linked, and the answer is
     `EMAIL_TAKEN`.
   - The cookies are forwarded. The store becomes `active` at the código, not
     at the email (FR-031).

**The sign-in by phone** is two calls:

- `POST /store/sign-in/code {phone}`: `nationalPhone` normalises it, then the
  store user is found by `user.username`. If there is one, a sign-in código
  goes to its email. The answer is `{sent: true}` either way (FR-033,
  cash-at-stores D3).
- `POST /store/sign-in {phone, otp}`: the phone is looked up again, then
  `auth.api.signInEmailOTP({email, otp}, returnHeaders)`. A phone that names
  no store answers `INVALID_OTP`, exactly like a wrong código. These routes
  never create a user (FR-034), because they only reach `signInEmailOTP`
  with an address a store row already names.

**The rest of the store app:**
- **The activation** is a step inside the screen that opened the session
  (the invitation, the sign-in), not a route. The app has one destination,
  `/`.
- **Caja** renders the shared keys card (D12), with the step-up (D8) and the
  close-others action (D11).
- **`/recuperar`** redirects to `/entrar`.
- **Keys stay named "Tienda"** (`addPasskey({name: "Tienda"})`, today's
  call). That is also the account name the store phone's picker shows.

**Alternatives considered**:
- The email at the sign-in, like the panel. Rejected in the spec's
  Assumptions: the network knows the shopkeeper by the phone.
- One `/store/sign-in` call that sends and checks. Rejected: two steps keep
  each answer the same for every phone.

---

## D11 — "Cerrar sesión en los demás dispositivos": Better Auth's own endpoint

`POST /auth/revoke-other-sessions` (`api/routes/session.mjs` line 477):

- **It asks only for a valid session**, through `sensitiveSessionMiddleware`.
  There is no freshness rule: a person who lost their phone should not need a
  fresh session to shut it out.
- **It deletes every other live session of the user** and keeps the current
  one.

The session cookie cache is off (better-auth D5), so the API's middleware
reads the session row on every request. The other devices find themselves
signed out at their next request (FR-022, SC-009). One button, in both cards,
with a one-line confirmation of what it did.

---

## D12 — Shared atoms in `@devolada/ui`

The keys card and the activation step are rendered by both apps, and so is
the código field. Constitution VI makes `packages/ui` their one definition:

- **`CodeInput`**: six digits, `inputMode="numeric"`,
  `autoComplete="one-time-code"`, 48 px, digits only, in the mono face the
  product keeps for folios and keys (`font-mono`, `tracking-widest`), so the
  digits read one by one. It replaces the hand-made fields on today's code
  screens. The design canvas draws it on every código step.
- **`PasskeyOffer`**: the activation step's body:
  - the title;
  - FR-008's four lines;
  - the decisive 64 px "Activar huella o rostro";
  - "Ahora no";
  - the one-line failure.
  The device word ("este dispositivo", "este teléfono", "esta computadora")
  is a prop.
- **`KeysCard`**: the key list (name or "Llave de acceso", date, "sincronizada
  con tu llavero"), "Quitar", "Activar en este dispositivo", the step-up's
  código field with "Confirmar" and "Cancelar", and "Cerrar sesión en los
  demás dispositivos".

All three are presentational. The apps keep the Better Auth client (one per
app, `lib/auth-client.ts`) and their fetches, and pass state and callbacks
in. Waiting labels sit inside `<Pending>` (`pending-lint`). The two
`PasskeyCard.tsx` files become thin containers.

**Alternatives considered**:
- Keep one card per app. Rejected: after this feature they do the same
  thing, and two copies of one recipe is the drift constitution VI forbids.

---

## D13 — Words

- **The código email** has one template for registration and sign-in. The
  server must not say which one it is (FR-005):
  - subject: "`<código>` es tu código para entrar — Devolada";
  - body: the six digits, then "Vence en 10 minutos." and "Si no fuiste tú,
    ignora este mensaje.";
  - **no link** (FR-024, constitution VI).
  The templates for email verification and password recovery leave with
  their doors (PR 2).
- **Screens** use the access pages' existing vocabulary: *código*, *huella o
  rostro*, "Reenviar código", "Usar otro correo". New lines:
  - "Ahora no";
  - "Cerrar sesión en los demás dispositivos";
  - "Confirma que eres tú: te enviamos un código a …" (step-up);
  - "Este dispositivo ya tiene tu huella o rostro."
  Never "OTP", "token", "enlace" or "passkey" in copy, and no line that
  announces the passwords' departure: the screens read as if the flow had
  always been this way (spec Clarifications, Q4).
- **The registration screen names no business type** (constitution IX): its
  description changes from "Tu ISP, cobrando por transferencia…" to the
  login's "Cobra por transferencia con validación automática." (FR-030).

---

## D14 — Tests, and how a test gets a código

Today every test that needs a código reads it from the `verification` table:

- `lastCodeFor` (`apps/api/test/helpers.ts`) and two inline copies of it in
  the API suite;
- `GET /dev/last-code` in the passkey layer.

Both pull six digits out of `value`. With `storeOTP: "hashed"` (D2) there are
no digits to read, so each layer gets a código its own way:

- **API (workerd, real D1)**, two helpers replace `lastCodeFor`:
  - **`sentCode(email)`**: the código the sender actually produced. The suite
    pins `RESEND_API_KEY: ""` (`vitest.config.ts`), so `sendAuthCode` writes
    `[código:sign-in] <email> → <digits>` to the log (the contract in
    `codigo-email.md`). A spy on `console.log`, installed by the helpers'
    `beforeEach`, keeps the last one per address. Flow tests use it: the
    registration, the sign-in, the store invitation, and the phone door,
    which must prove the código reached the store's email.
  - **`mintCode(email)`**: `makeAuth(env).api.createVerificationOTP({email,
    type: "sign-in"})`, the plugin's own server-only door (D9 uses it too).
    Tests whose subject is not the email use it.
  - No database is mocked either way. A test that a código is *stored* checks
    one `sign-in-otp-<email>` row whose value holds no six digits (D2).
- **Users without passwords**: `seedAuthUser` and `seedPlainUser` call
  `signUpEmail` with a password today, and 60 of the 67 API test files
  reach them. They become users born verified with no `account` row, written
  through Better Auth's adapter:
  - `seedAuthUser`, the panel's, in PR 1;
  - `seedPlainUser`, the store side's, in PR 2, because until then the store
    suite still proves the phone-and-password door it keeps.
  `PASSWORD` leaves `helpers.ts` with PR 2. Most tests authenticate with
  `seedSession`'s signed cookie, which needs no password and does not
  change.
- **Component (happy-dom, MSW)**: Better Auth's endpoints get MSW handlers in
  their own shape (envelope-exempt, `baPost`): `send-verification-otp`,
  `sign-in/email-otp`, `update-user`, `revoke-other-sessions`, and the new
  store routes. The password handlers (`sign-in/email`, `business/signup`,
  the reset pair, `sign-in/username`) leave. The platform check (D7) is
  stubbed per test and reset `beforeEach`.
- **Browser layer** (`tests/e2e`, stubbed API):
  - The new screens join the contrast, touch-target and responsive suites:
    `/login`'s two steps, `/signup`'s two steps, `/welcome`, the invitation
    states, red's `/entrar`, the invitation's three steps, and Caja's card.
  - The two suites that wait for "Olvidé mi contraseña" on red's `/entrar`
    wait for the new copy.
  - The design-review captures (`tests/design/review-identity.spec.ts`,
    `review-identidad-2.spec.ts`) follow the same screens.
- **Passkey layer** (`tests/passkey`, a real wrangler API with Chromium's
  virtual authenticator):
  - **`GET /dev/last-code` retires.**
  - **`POST /dev/code {email, type}`** mints a código with
    `createVerificationOTP` and returns it, but only for two kinds of
    address (`testAddress()`, which `bug: dev-code-readable` put in
    `routes/dev.ts` first). It refuses the rest, the empty address included,
    with 403 `TEST_ADDRESS_ONLY`:
    - one under the reserved `.invalid` top-level domain (RFC 6761: it
      never delivers mail, so no real person can own one). The journeys
      already use `@journey.invalid`;
    - one of the seed's own demo addresses (`DEMO` in `routes/dev.ts`),
      whose password `devolada123` is public in CLAUDE.md today. Minting
      for them opens nothing that is closed now.
  - The journeys are rewritten:
    - `identity-journey`: registration, then the activation, then the
      invitee by name and key;
    - `passkey`: the demo account by código, then the key;
    - `red`: the operator by código; the store invitation by email, código
      and key; then the phone door.
  - A virtual authenticator with `hasUserVerification` and `isUserVerified`
    answers the platform check (D7) as a device that can verify the person.

Every test file cites `passwordless-access US<n>` (constitution VII).

---

## D15 — A finding: the dev API hands out any account's código today

`apps/api/wrangler.jsonc` sets `ENVIRONMENT: "dev"` for the deployed dev
Worker as well as locally (lines 34 and 86). So `/dev/*` answers on
`api.dev.devoladapago.com`, not only on a laptop. `GET /dev/last-code`
returns the last six digits stored for any address that contains the query
(`routes/dev.ts` line 78). The email-OTP plugin's `sign-in/email-otp` is
open. Together, anyone could sign into any account on the dev environment:
ask for a sign-in código for the address, read it there, type it.

Production is not affected (`ENVIRONMENT: "prod"`, and `/dev/*` answers 404).
Dev holds demo data, but also the operator's account on dev.

This feature closes it two ways: códigos are hashed (D2), and `/dev/code`
only mints for `.invalid` addresses and the seed's demo addresses (D14). If
it should close before this feature ships, the narrow fix is the lite path:
restrict `/dev/last-code` to the same addresses today.

**Closed early, 2026-10-02.** The creator asked for the narrow fix, and it
ships ahead of PR 1 as PR #273 (`.specify/bugs/dev-code-readable/`). Two
things it found are this feature's to keep:
- `/dev/last-invitation` was a second door: an invitation id alone creates
  the invitee's account (D9), so it takes the same rule;
- the address is matched whole, never as a substring: a query that ends in
  `.invalid` can sit inside a real address (`ana.invalid@gmail.com`).

---

## D16 — Delivery: two pull requests

Merging to `main` deploys dev. Each PR must leave dev whole.

**PR 1, the panel** (User Stories 1–5):
- **API**:
  - D1, D2 and D3's custom rule;
  - D4's first step;
  - D5 without the store users;
  - D9's `accept-new`;
  - D11;
  - D14's `/dev/code`;
  - the dev seed without a password (its users born through
    `createVerificationOTP` and `signInEmailOTP`).
- **Admin**: D6, D7, D8, D9 and D11's button.
- **`@devolada/ui`**: D12.
- **The código email**: D13.
- **Tests at every layer**.
- **Constitution amendment 1** (plan, Complexity Tracking), applied by
  `/speckit-constitution` before the PR merges.

**PR 2, the store app** (User Story 6):
- **API**:
  - D4's second step;
  - D5 with every user;
  - D10's four store routes;
  - `email` on the store's `/auth/me`;
  - the email verification and recovery templates retired.
- **Red**: D7, D10, and the shared card with D11's button (D12).
- **Tests**.
- **Constitution amendment 2**.
- **Before merging**: the operator tells the pilot's shopkeepers (spec
  Dependencies).

**The dev seed (PR 1).** `/dev/seed` keeps its demo address
(`demo@devolada.app`). It births its users through `createVerificationOTP`
and `signInEmailOTP`, with no password; the seed's answer drops
`admin.password`. A developer gets in with a código:
- locally, from the API's console, where it prints without `RESEND_API_KEY`;
- or, on either environment, from `POST /dev/code` (D14).

**CLAUDE.md follows each PR.** The "Local seed" line drops `devolada123`,
and gives the código's two sources above.

**The test suites that change**, from the inventory taken 2026-10-02:
- **API**: the helpers (`seedAuthUser`, `seedPlainUser`, `lastCodeFor`,
  `PASSWORD`) and `isp-signup`, `sessions`, `rate-limit`, `identity-round`,
  `invitee-lands-own-business`, `dev-seed`, `dev-code-readable` (PR #273's
  regression test), `cash-at-stores-access` (its código reads and `username`
  refusals in PR 1, analysis I1; the rest in PR 2) and
  `cash-at-stores-operator` (PR 2).
- **Admin**: `msw.ts`, `shell`, `access`, `memberships` (the invitation
  page), `invitee-lands-own-business` and `session-round`.
- **Red**: `msw.ts` and `access` (PR 2).
- **Playwright**: the three passkey journeys (`red` twice: its operator and
  its código read in PR 1, the rest in PR 2), the design-review captures,
  and (PR 2) the two e2e suites that wait for red's old copy.

The older specs' quickstarts keep their demo password: they record the
state their feature shipped in.

---

## Measurements before building

They are listed in [quickstart.md](./quickstart.md) §0. Each one confirms a
fact this research read in the dist and that code will depend on:

- **M1**: a sign-in código for an unknown address creates a verified user
  with the name sent.
- **M2**: a session older than a day cannot register a key; one under a day
  can.
- **M3**: a `disabledPaths` entry answers 404 over HTTP, while `auth.api`
  still reaches it.
- **M4**: a hashed código passes once, dies after three wrong tries, and
  dies when a newer one is requested, even after the newer one is used.
- **M5**: `revoke-other-sessions` leaves only the caller's session.
- **M6**: `checkVerificationOTP` validates without consuming, and answers
  `USER_NOT_FOUND` only after a right código.
