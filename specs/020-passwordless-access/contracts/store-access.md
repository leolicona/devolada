# Contract: access to the store app

`passwordless-access` D3, D4, D7, D8, D10–D13. User Story 6. Ships with
PR 2. Until then, the store app keeps cash-at-stores' contract (phone and
password).

The schemas live in `apps/api/src/routes/store/schema.ts`, exported as
`@devolada/api/store-schema`. They are imported by `apps/red`, its MSW
handlers and the Playwright stubs.

Every answer wears the one envelope, with `UPPER_SNAKE` codes. A rejected
body is `VALIDATION_ERROR`, the store area's word since cash-at-stores
(written `VALIDATION` here until 2026-10-02, when the implementation kept
the area's word). These routes
are browser-facing: no `message`, no `retryable` (constitution III). The
códigos' error codes are the plugin's own, carried through the envelope:
`INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS` — except on
`POST /store/sign-in`, which folds them into `INVALID_OTP` (below).

None of these routes ever creates an account except the invitation's
acceptance (FR-034).

---

## The invitation (session-less)

### `GET /store/invitations/:token`: unchanged

```json
{ "success": true, "data": { "state": "open", "storeName": "Abarrotes Lupita", "phoneTail": "5678" } }
```

### `POST /store/invitations/:token/code`: new

Rate-limited 3 per 60 s per address (D3).

```json
{ "email": "lupita@correo.mx" }
```

- **200** `{ "success": true, "data": { "sentTo": "lupita@correo.mx" } }`.
  A sign-in código goes to that address **whatever it holds**. A taken
  address is named only after its código (FR-032).
- **400** `INVALID_INVITATION`: unknown, accepted, replaced, expired, or a
  suspended store (cash-at-stores D4, unchanged). **400** `VALIDATION_ERROR`: a
  malformed address. **429**.

### `POST /store/invitations/:token/accept`: changed body

Rate-limited 5 per 60 s per address (unchanged).

```json
{ "email": "lupita@correo.mx", "otp": "482913" }
```

`AcceptStoreInvitationRequest` loses `password` and gains `otp`, which is
six digits.

- **201** `{ "success": true, "data": { "storeName": "Abarrotes Lupita" } }`
  with the session cookie. The account is born verified and named
  `shopkeeperName`. The phone becomes its username. The store becomes
  `active` and the invitation `accepted`, in one batch (D10,
  cash-at-stores T089).
- **400** `INVALID_OTP`, `OTP_EXPIRED`; **403** `TOO_MANY_ATTEMPTS`.
- **409** `EMAIL_TAKEN`: the address has an account, or is a platform
  operator's, **and the código was right** (FR-032). The invitation stays
  `sent`.
- **400** `INVALID_INVITATION`: as above, or a race lost to another
  acceptance (T089).
- **429**.

---

## The sign-in (session-less)

### `POST /store/sign-in/code`: new

Rate-limited 3 per 60 s per address (D3).

```json
{ "phone": "55 1234 5678" }
```

`nationalPhone` normalises the number to ten digits.

- **200** `{ "success": true, "data": { "sent": true } }` for **every**
  well-formed phone, and as fast: the código is written and sent after the
  answer (`waitUntil`), so timing cannot tell the phones apart either. A
  código goes to the store account's email only when a store names that
  phone (FR-033, cash-at-stores D3).
- **400** `VALIDATION_ERROR`: not ten national digits. **429**.

### `POST /store/sign-in`: new

Rate-limited 5 per 60 s per address (D3).

```json
{ "phone": "5512345678", "otp": "482913" }
```

- **200** `{ "success": true, "data": { "storeName": "Abarrotes Lupita" } }`
  with the session cookie.
- **400** `INVALID_OTP` for every refusal of the código — a wrong one, an
  expired one, one past its three tries — and for a phone that names no
  store, so the answer cannot tell them apart (FR-033). `OTP_EXPIRED` and
  `TOO_MANY_ATTEMPTS` exist only for an address that holds a código, so
  this route never carries them (adversarial review, 2026-10-02). The
  store app reads all three alike anyway. **As fast, too**: a phone no
  store names still runs the plugin's código check, against an address
  nobody could predict (so it can never create an account), and every
  refusal answers no sooner than a fixed floor after the request began, so
  timing cannot tell the phones apart either.
- **403** `STORE_SUSPENDED`: a suspended store, as `requireStore` answers
  today. No session is kept.
- **429**.

---

## `GET /auth/me`, the store branch: one field added

```json
{ "success": true, "data": { "type": "store", "storeId": "…", "name": "Abarrotes Lupita", "businessName": "WifiPlus", "email": "lupita@correo.mx" } }
```

`email` is the store account's own address, used by Caja's step-up (D8). The
business branch is unchanged.

## Better Auth endpoints the store app uses

- `signIn.passkey()` and `passkey.addPasskey({ name: "Tienda" })`, as today.
- `list-user-passkeys` and `delete-passkey` (new in Caja, FR-036).
- `revoke-other-sessions` (FR-036, D11).
- The step-up: `send-verification-otp` + `sign-in/email-otp` with `email`
  from `/auth/me` (D8).

`/auth/sign-in/username` and the recovery endpoints are disabled in this PR
(panel-access, "Disabled").

---

## UI contract: the store app

The phone layout is designed at 375 px, the computer layout from 1024 px
(cash-at-stores D32). Sizes:
- 48 px standard;
- the decisive action at 64 px.

All three atoms (`CodeInput`, `PasskeyOffer`, `KeysCard`) come from
`@devolada/ui` (D12). Copy is es-MX. The design canvas «Acceso sin
contraseña» draws these screens too.

On every screen, a 429 on a código request or try says "Demasiados
intentos. Espera un momento e intenta de nuevo." (FR-027), in place of
today's "Demasiados intentos. Espera un momento.".

### `/invitacion/:token`

**Step 1, "Bienvenido a Devolada, {tienda}":**
- "Entrarás con tu huella o rostro, o con un código que te enviamos a tu
  correo." Without passkey support: "Entrarás con un código que te enviamos
  a tu correo." — no screen names the fingerprint or face on a device that
  cannot use them (FR-015; adversarial review, 2026-10-02).
- "Tu correo" and "Continuar".
- Bad invitations read the same as today: "Esta invitación ya no funciona".

**Step 2, "Escribe el código":**
- "Te enviamos un código a {email}. Vence en 10 minutos."
- `CodeInput` and "Entrar".
- "Reenviar código", which confirms with "Código reenviado", as the panel's.
- "Usar otro correo".
- `EMAIL_TAKEN`: "Ese correo ya tiene una cuenta en Devolada. Usa otro para
  tu tienda." It goes back to step 1.

**Step 3**, where the device can verify the person (D7): `PasskeyOffer`.
- Device word: "este teléfono", or "esta computadora" from 1024 px.
- Decisive: "Activar huella o rostro". Also "Ahora no".
- Then `/`.

### `/entrar`

**Step 1, "Entrar":**
- No line about passwords (spec Clarifications, Q4).
- "Entrar con huella o rostro" (where supported), the primary button, then
  the separator "o con un código". Without the key, "Enviar código" is the
  primary.
- "Tu teléfono" and "Enviar código".
- Key failure: "No se pudo usar tu huella o rostro. Entra con un código."

**Step 2:**
- "Si ese teléfono es de una tienda, te enviamos un código al correo de la
  tienda. Vence en 10 minutos." This says the same for every phone: naming
  the address would tell a stranger whose phone it is.
- `CodeInput` and "Entrar".
- "Reenviar código", which confirms with "Código reenviado".
- "Usar otro teléfono".

**Step 3**: as the invitation's step 3. Then `/`.

### `/caja`: the keys card

`KeysCard`, as the panel's (panel-access, Seguridad), with these
differences:
- the device word ("este teléfono", "esta computadora"), in "Activar en
  {device word}" and its done line;
- the step-up line "Confirma que eres tú: te enviamos un código a {email}.",
  with "Confirmar" and "Cancelar";
- the list (new here, FR-036), "Quitar", and "Cerrar sesión en los demás
  dispositivos";
- 48 px controls at full width, where the panel's are 40 px.

The copy drops "Tu contraseña sigue funcionando" (FR-035).

### Redirects and removals

- `/recuperar` → `/entrar`.
- "¿Olvidaste tu contraseña?" and the old `VerifyStep` (cash-at-stores D5's
  `EMAIL_NOT_VERIFIED` path) leave. A legacy unverified shopkeeper gets in
  through `/entrar`'s código, which verifies the address (D1).
