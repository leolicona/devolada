# Quickstart: Passwordless Access

How to prove the feature works, in four parts:
1. the measurements the design waits on;
2. the automated checks;
3. a walk through the panel (PR 1);
4. a walk through the store app (PR 2).

Shapes live in [data-model.md](./data-model.md) and
[contracts/](./contracts/); this page does not repeat them.

## 0. Measure first (before any code that depends on it)

Each measurement confirms a fact research read in Better Auth 1.6.29's dist.
Run it as a throwaway case in the API suite (workerd, real D1, deleted after),
and write the result in research.md under its decision, with the date.

| # | How | What to record | Decides |
| --- | --- | --- | --- |
| M1 | `send-verification-otp {type: "sign-in"}` for an address with no user, then `sign-in/email-otp {email, otp, name: "Ana López"}` with the código the sender logged | the user row: `email_verified`, `name`; a session cookie in the answer | D1 |
| M2 | Sign in. Move the session's `created_at` 25 hours back in D1. `GET /auth/passkey/generate-register-options`. Repeat at 23 hours | 403 `SESSION_NOT_FRESH` at 25 h, 200 at 23 h | D8 (and the bug it names in today's card) |
| M3 | Add `/sign-in/email` to `disabledPaths`. `POST /auth/sign-in/email` over HTTP, then `auth.api.signInEmail` from the server | 404 over HTTP; the server call still reaches it | D4 |
| M4 | With `storeOTP: "hashed"`, `expiresIn: 600`: read the stored `value`; type the right código once (200), then again (refused); on a new código, type three wrong ones, then the right one | a value with no six digits; the second use refused; `TOO_MANY_ATTEMPTS` after three | D2 |
| M5 | Three sessions of one user. `POST /auth/revoke-other-sessions` from one. A request from each | 200 from the caller, 401 from the other two | D11 |
| M6 | `checkVerificationOTP {type: "sign-in"}` for an address with a user and for one without, with a right and a wrong código. Then `sign-in/email-otp` with the same right código | right + user → 200 and still usable; right + no user → `USER_NOT_FOUND`; wrong → `INVALID_OTP` with tries + 1 | D10 |

**If M1 fails** (no user created, or no name), D1 falls back to one route of
ours that creates the user through the plugin's adapter and then signs in.
Tell the creator before building on it: it changes no screen.

**If M2 shows the card works after a day**, D8's step-up is not needed. Drop
it from the tasks.

**If M6 consumes the código**, D10 uses `signInEmailOTP` for the taken case
and revokes the session it opened. Same answer, one more write.

## 1. Automated checks (the CI order)

```sh
node scripts/spec-lint.mjs                 # every new test cites passwordless-access US<n>
node scripts/gen-banks.mjs --check
node scripts/contrast-lint.mjs
node scripts/pending-lint.mjs              # "Esperando a tu dispositivo", "Enviando el código"… inside <Pending>
pnpm -r --if-present typecheck
pnpm --filter @devolada/api test
pnpm --filter @devolada/admin test
pnpm --filter @devolada/red test           # PR 2
pnpm --filter @devolada/ui test            # the three atoms (D12)
pnpm e2e                                   # new screens: contrast in both themes, 360/768/1280, touch targets
pnpm e2e:passkey                           # the rewritten journeys (D14)
```

The API suite must show, at least:

| Case | Story |
| --- | --- |
| A registration: código → account born verified with its name → session; no `account` row exists for it | US1 |
| A registration with a taken address answers like a new one, and its código opens the existing account; the typed name is ignored | US1 (FR-005) |
| A sign-in código for an unknown address creates an account with an empty name | US2 (FR-013) |
| A código after ten minutes is refused; after three wrong tries, the right one too; a new request kills the old one | US1 (FR-003) |
| The stored código's value holds no six digits | US1 (FR-025) |
| `/auth/sign-in/email` and `/auth/sign-up/email` answer 404 | US2 (FR-010) |
| The sixth `sign-in/email-otp` from one address in a minute answers 429 | US2 (FR-027) |
| `eraseLegacyCredentials`: deletes `credential` rows (PR 1: not a store's) and unverified panel users without a store or a membership; logs only when it deleted something; a second run deletes nothing | US2 (FR-029) |
| `accept-new {name}`: born verified, no password, inside the business, cookie set; a stray live código for the address does not break it | US4 (FR-019) |
| Registering a key on a session older than a day answers `SESSION_NOT_FRESH`; after a código, it succeeds | US5 (FR-021) |
| `revoke-other-sessions` leaves only the caller | US5 (FR-022) |
| The código email has the digits in subject and body and no link | US1 (FR-024) |
| `/dev/code` mints for `@journey.invalid` and for `demo@devolada.app`, and refuses any other address; 404 outside dev | US1 (D14) |
| PR 2: the store invitation, by email and código; `EMAIL_TAKEN` only after a right código; the invitation stays `sent` | US6 (FR-031, FR-032) |
| PR 2: the phone door sends to the store's email (`sentCode`); a stranger's phone gets the same answer and no código; a wrong phone + any código is `INVALID_OTP` | US6 (FR-033) |
| PR 2: `/auth/sign-in/username` answers 404; no route of the store area creates a user | US6 (FR-034) |

## 2. Walk through the panel (PR 1)

Locally, with the API up (`pnpm --filter @devolada/api dev`) and no
`RESEND_API_KEY`: each código prints in the API's console as
`[código:sign-in] … → ……`.

1. **Register** (US1). Go to `/signup` and type a name and a new address,
   then "Continuar". Type the console's código. On a laptop with Touch ID or
   Windows Hello, `/welcome` offers "Activar huella o rostro"; confirm it.
   You land in the wizard. In Cuenta → Seguridad, one key is listed.
2. **Sign in with the key** (US2). Sign out. On `/login`, press "Entrar con
   huella o rostro". You are in, having typed nothing.
3. **Sign in with a código** (US2). Sign out, then use a browser profile with
   no key. Ask for a código, type it, and `/welcome` offers the activation.
   "Ahora no" lands you inside.
4. **No passkey support** (US3). In a browser without WebAuthn (or with
   `PublicKeyCredential` deleted in the console before load), register and
   sign in. No screen mentions the fingerprint or face.
5. **The invitation** (US4). From the owner's Usuarios, invite an address:
   - **with an account and a key**: open the console's invitation link in a
     clean session and use "Entrar con huella o rostro". You land inside the
     business, with the invited role;
   - **without an account**: type the name, activate, and you are inside. No
     código, no password.
6. **Keys and sessions** (US5). Keep two browsers signed in. From one, use
   "Cerrar sesión en los demás dispositivos": the other's next click lands on
   `/login`. Then make the session a day old (M2's trick) and use "Activar en
   este dispositivo": it asks for a código first.
7. **The old doors.** `/recover` and `/verify-email` land on `/login`.
   `POST /auth/sign-in/email` answers 404.

On `dev` after merging, walk 1–6 again with the real email, and check the
API's log: the password sweep spoke once (`credential erase: {…}`) and then
went quiet.

## 3. Walk through the store app (PR 2)

**First**, the operator has told the pilot's shopkeepers (spec Dependencies).

1. **The invitation** (US6). From `/operador` → Tiendas, create a store and
   open its invitation. Type an email, type the código, activate, and you are
   at the counter. The store reads *activa* in Tiendas only now.
2. **A taken address** (US6). On a second invitation, type the operator's own
   address. The código is asked first; only then: "Ese correo ya tiene una
   cuenta en Devolada. Usa otro para tu tienda."
3. **The key at the counter** (US6). Sign out, then use "Entrar con huella o
   rostro".
4. **The phone door** (US6). Sign out. Type the store's phone, and the
   código arrives at the store's email. Type a phone no store has: the
   screen reads the same, and no código is sent.
5. **A lost phone** (US6). In Caja, the list shows the keys. "Quitar" the
   old phone's key, then "Cerrar sesión en los demás dispositivos".
6. **The old doors.** `/recuperar` lands on `/entrar`.
   `POST /auth/sign-in/username` answers 404. The sweep's next run erases
   the shopkeepers' passwords (`credential erase: {…}`).
