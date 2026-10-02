# Contract: access to the panel

`passwordless-access` D1–D9, D11–D14, D16. User Stories 1–5. Ships with
PR 1.

The panel talks to two kinds of endpoints:

- **Better Auth's own** under `/auth/*`. They are exempt from the envelope
  by rule (constitution III, better-auth D6). The admin calls them through
  `baPost`/`baGet` (`apps/admin/src/lib/api.ts`), and the WebAuthn
  ceremonies through the Better Auth client (`lib/auth-client.ts`). Names
  and shapes are pinned against `better-auth@1.6.29`'s dist.
- **Ours**, wearing the envelope `{success, data}` /
  `{success: false, error: {code}}` with `UPPER_SNAKE` codes. Schemas live
  in `apps/api/src/routes/<area>/schema.ts` and are exported from
  `@devolada/api`.

---

## Better Auth endpoints the panel uses

### `POST /auth/email-otp/send-verification-otp`

```json
{ "email": "ana@negocio.mx", "type": "sign-in" }
```

- **200** `{ "success": true }` for **every** well-formed address, account
  or not (D1). A código goes out in both cases.
- **400** `INVALID_EMAIL` for a malformed address (the screen checks the
  shape first, so this is a belt).
- **429** with `X-Retry-After`: 3 per 60 s per address (D3).

### `POST /auth/sign-in/email-otp`

```json
{ "email": "ana@negocio.mx", "otp": "482913", "name": "Ana López" }
```

`name` is sent only from the registration screen. It is used only when the
account does not exist yet (D1).

- **200** `{ "token": "…", "user": { "id", "email", "name", "emailVerified": true, … } }`
  and the session cookie. When no account existed, one is born verified.
- **400** `INVALID_OTP` (wrong, or no live código), `OTP_EXPIRED` (older than
  ten minutes); **403** `TOO_MANY_ATTEMPTS` (the third wrong try killed it).
  The screens show one message for the three: "El código no es válido o ya
  venció. Reenvíalo e intenta otra vez." (better-auth's UI contract).
- **429**: 5 per 60 s per address (D3).

### `POST /auth/update-user`

```json
{ "name": "Ana López" }
```

Only from `/welcome`, when the user's name is `""` (D1, D6). **200**
`{ "status": true }`. A body with `username` or `displayUsername` is refused
`USERNAME_NOT_ALLOWED`, as today (cash-at-stores D3).

### Passkeys

Through the client's `passkey.addPasskey()` and `signIn.passkey()`:

| Endpoint | Needs | Notes |
| --- | --- | --- |
| `GET /auth/passkey/generate-register-options` | a **fresh** session (< 1 day) | **403** `SESSION_NOT_FRESH` otherwise (D8); `excludeCredentials` lists the user's keys (D7) |
| `POST /auth/passkey/verify-registration` | a fresh session | saves the `passkey` row |
| `GET /auth/passkey/generate-authenticate-options` | nothing | without a session, no `allowCredentials`: the device's picker chooses the account |
| `POST /auth/passkey/verify-authentication` | the challenge cookie | opens a session |
| `GET /auth/passkey/list-user-passkeys` | a session | the keys card's list (better-auth D18) |
| `POST /auth/passkey/delete-passkey` | a session, own key | "Quitar" |

### `POST /auth/revoke-other-sessions`

No body. A valid session, with no freshness rule (D11). **200**
`{ "status": true }`. Every other session of the user is deleted. Their
next request meets 401 from our middleware.

### Unchanged

`POST /auth/sign-out`, `GET /auth/get-session`, `/auth/organization/*`.

### Disabled: 404 over HTTP (D4)

| Path | From |
| --- | --- |
| `/auth/sign-in/email`, `/auth/sign-up/email` | PR 1 |
| `/auth/is-username-available` | already (cash-at-stores D3) |
| `/auth/sign-in/username`, `/auth/email-otp/request-password-reset`, `/auth/email-otp/reset-password`, `/auth/forget-password/email-otp`, `/auth/email-otp/verify-email`, `/auth/email-otp/check-verification-otp` | PR 2 (the store app's doors until then) |

`emailAndPassword.enabled` turns false in PR 2.

---

## Our routes

### Removed: `POST /auth/business/signup`

The registration is `send-verification-otp` + `sign-in/email-otp` (D1). The
route, its zod input and its rate rule (better-auth D15) leave in PR 1.

### Changed: `POST /businesses/invitations/:invitationId/accept-new`

Session-less; the random id is the key (better-auth D14). Rate-limited 5
per 60 s per address (unchanged).

```json
{ "name": "Ana López" }
```

`AcceptInvitationNewRequest` (`@devolada/api/businesses-schema`) loses
`password`. `name` is trimmed, 2–80 characters.

The server (D9):
1. checks the invitation (pending, unexpired);
2. refuses an address that already has an account;
3. deletes any live sign-in código for the address;
4. mints one (`createVerificationOTP`) and consumes it (`signInEmailOTP`
   with the name);
5. accepts the invitation and activates its business;
6. forwards the session cookies.

- **201** the business actor (as today), with the session cookie.
- **404** `INVITATION_NOT_FOUND` (gone, accepted or expired);
  **409** `EMAIL_TAKEN` (the address has an account: the page's
  `hasAccount` branch is the right door); **400** `VALIDATION`; **429**.

### Unchanged

- `GET /businesses/invitations/:invitationId/preview` →
  `{status, businessName, role, email, hasAccount}`.
- `GET /auth/me`.
- `GET /businesses/invitations/mine`.

### Dev only: `POST /dev/code` (D14)

Answers 404 outside `ENVIRONMENT=dev`, like everything under `/dev`.

```json
{ "email": "ana-x1@journey.invalid", "type": "sign-in" }
```

- **200** `{ "success": true, "data": { "code": "482913" } }`. It mints a
  fresh código with `createVerificationOTP`, replacing the live one.
- **403** `TEST_ADDRESS_ONLY` unless the address ends in `.invalid`
  (RFC 6761: no real mailbox can live there) or is one of the seed's demo
  addresses (`DEMO` in `routes/dev.ts`, whose password is public today). An
  empty address is refused too. The rule and the refusal are
  `bug: dev-code-readable`'s (PR #273).

`GET /dev/last-code` is removed (D14, D15). `GET /dev/last-invitation`
stays, under the same rule.

---

## UI contract: the panel

Copy is es-MX. Sizes follow constitution VI:
- 48 px standard controls on access pages;
- the activation's decisive button at 64 px;
- body 16 px, no horizontal scroll from 360 px.

Every waiting label sits inside `<Pending>`. All three atoms (`CodeInput`,
`PasskeyOffer`, `KeysCard`) come from `@devolada/ui` (D12). The design
canvas «Acceso sin contraseña» draws every screen below, in both themes,
from 360 px and at 1280 px.

On every screen, a 429 on a código request or try says "Demasiados
intentos. Espera un momento e intenta de nuevo." (FR-027).

### `/login`

**Step 1, "Iniciar sesión":**
- Description: "Cobra por transferencia con validación automática."
- No line about passwords: the screen reads as if it had always been this
  way (spec Clarifications, Q4).
- "Entrar con huella o rostro", the primary button, shown only where
  `passkeysSupported()` (D7).
- Where the key shows, the separator "o con un código" follows it, and
  "Enviar código" is a secondary button; without the key, it is the primary.
- "Correo" and "Enviar código". The button stays disabled until the address
  has a valid shape.
- Link: "Crear cuenta" (keeps `next`).
- Key failure: "No pudimos usar tu huella o rostro. Entra con un código."
  (FR-012)

**Step 2, "Escribe tu código":**
- Description: "Te enviamos un código de 6 dígitos a {email}. Vence en 10
  minutos."
- `CodeInput`, then "Entrar", which stays disabled until there are six
  digits.
- "Reenviar código", which confirms with "Código reenviado".
- "Usar otro correo" goes back to step 1, with the address kept for editing.

**After a código**:
- a key sign-in goes to `next` or `/`;
- a código goes to `/welcome?next=…`.

### `/signup`

**Step 1, "Crear cuenta":**
- Description: "Cobra por transferencia con validación automática." (FR-030:
  it names no business type).
- "Tu nombre" and "Correo", with problems named under each field before the
  request leaves (name ≥ 2, address shape: the identity round's rule).
- "Continuar".
- Link: "Ya tengo cuenta".

**Step 2**: as `/login`'s, with "Crear cuenta" as the decisive button. The
name rides `sign-in/email-otp`.

No message ever says an address is taken (FR-005).

### `/welcome?next=`

A session is required; without one, it goes to `/login?next=…`. The screen
decides before it paints:

1. **The user has no name.** "¿Cómo te llamas?", with "Tu nombre" and
   "Continuar" (`update-user`). Then it goes on to 2.
2. **The device can verify the person** (D7): `PasskeyOffer`:
   - title: "Entra la próxima vez con tu huella o rostro";
   - the four lines of FR-008:
     - "La próxima vez entras con tu huella o tu rostro, sin escribir nada."
     - "Devolada nunca ve tu huella ni tu rostro: se quedan en tu
       dispositivo."
     - "Si tu llavero de iCloud o de Google sincroniza tus llaves, también
       servirá en tus otros dispositivos."
     - "Si otras personas desbloquean este dispositivo, también podrán
       entrar. En un equipo compartido, elige «Ahora no»."
   - "Activar huella o rostro" (decisive, 64 px). It opens the device's
     window inside its click (D7).
   - "Ahora no" (FR-006).
   - On a cancel or failure: "No se pudo activar. Intenta de nuevo o elige
     «Ahora no»." (FR-009). On `InvalidStateError`: "Este dispositivo ya
     tiene tu huella o rostro." and it goes on.
   - On success: "Listo." for a beat, then it goes on.
3. Otherwise, or after 2, it goes to `next` (validated, better-auth D12) or
   `/`.

### `/invitaciones/:invitationId`

The states the page has today stay. The changes:

| State | Shows |
| --- | --- |
| No session, the address has an account | "Te invitaron a {negocio}", "Como {rol}.", "Correo: {email}" as text; "Entrar con huella o rostro" (where supported), then "o con un código"; "Enviarme un código" → `CodeInput` + "Entrar"; no password; no "Olvidé mi contraseña" |
| No session, no account | "Tu nombre" + "Crear cuenta y entrar" → `accept-new` → `/welcome?next=/` |
| Signed in with the invited address | accepts on sight (unchanged) |
| Signed in with another address, including after a key of another account | "Entraste como {email}, y esta invitación fue enviada a otro correo." + "Entrar con el correo invitado" (unchanged, FR-018) |
| Expired, gone | unchanged |

### `/settings/security` (Cuenta → Seguridad)

`KeysCard`:
- **Title**: "Entrar con huella o rostro". Its copy drops "Tu contraseña
  sigue funcionando" (FR-030).
- **The list**: name or "Llave de acceso", "Activada el {fecha}",
  "sincronizada con tu llavero"; "Quitar" on each. When empty: "Ningún
  dispositivo tiene acceso con huella o rostro todavía." (better-auth D18).
- **"Activar en este dispositivo"**, where the device can verify the person.
  On `SESSION_NOT_FRESH` it asks first: "Confirma que eres tú: te enviamos un
  código a {email}.", with `CodeInput`, "Confirmar" and "Cancelar", which
  closes the step-up. Then it runs the ceremony (D8). On success: "Listo.
  Este dispositivo ya puede entrar con huella o rostro.", and the new key
  joins the list. On a cancel or failure: "No se pudo activar. Intenta de
  nuevo.", with no password to fall back on (FR-030).
- **"Cerrar sesión en los demás dispositivos"**, a secondary button. After
  it: "Listo. Solo este dispositivo sigue con tu sesión abierta." (D11).

Cuenta's identity card now says: "Para cambiar tu nombre, escríbenos. Pronto
podrás hacerlo desde aquí." (FR-030). Its rail row "Entrar con huella o
rostro" reads "Tus llaves y sesiones" instead of "Tus passkeys": the
product's words for what the card holds.

### Redirects

- `/verify-email` → `/login`, keeping `next`. An address in an old link is
  dropped: it never travels in a URL (D6).
- `/recover` → `/login`, keeping `next`, the same way.
