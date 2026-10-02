# Feature Specification: Passwordless Access

**Feature Branch**: `claude/spec-020-passwordless-access`

**Created**: 2026-10-02

**Status**: Draft — written from the creator's story of 2026-10-02 and
clarified the same day in two rounds: the email carries the código alone
(Q1); the password leaves the panel for everyone and leaves the store app
too (Q2, User Story 6); the fingerprint or face is offered at once and can
be skipped (Q3). No clarification is open. Numbered 020 because 015, 016
and 019 are taken by open spec PRs (#258, #259, #272).

**Input**: User description, in the creator's words (2026-10-02):

> Historia de Usuario: Registro e Inicio de Sesión Passwordless (Opción A)
> Título: Registro seguro mediante Verificación de Correo y Enrolamiento de
> Passkey (FIDO2)
> Como nuevo usuario de la plataforma Devolada, quiero registrar mi cuenta
> verificando mi correo mediante un código OTP y magic link activando la
> autenticación biométrica de mi dispositivo, para acceder a mi cuenta de
> forma rápida, segura y sin necesidad de crear o recordar una contraseña.
>
> Criterios de Aceptación
>
> 1. Verificación Inicial del Correo (OTP) o magic link
>    - Dado que un usuario ingresa su correo electrónico en la pantalla de
>      registro, Cuando presiona el botón "Continuar", Entonces el sistema
>      debe generar un código OTP de 6 dígitos de corta duración (ej. 10
>      minutos) y enviarlo a su bandeja de entrada, mostrando la pantalla de
>      validación.
>    - Dado que el usuario ingresa el código OTP recibido correctamente,
>      Cuando el sistema lo valida, Entonces marca el correo como verificado
>      (email_verified: true) y desencadena inmediatamente la activación de
>      Passkey.
> 2. Enrolamiento de Passkey (FIDO2)
>    - Dado que el correo ha sido verificado y el dispositivo del usuario
>      soporta el estándar FIDO2 / WebAuthn, Cuando el sistema invoca la API
>      nativa del navegador/SO, Entonces se despliega la interfaz del sistema
>      operativo solicitando la validación biométrica (Face ID, huella
>      digital) o PIN del dispositivo.
>    - Cuando el usuario confirma su identidad biométrica, Entonces el
>      dispositivo genera el par de llaves, almacena la llave privada en el
>      chip de seguridad local (Secure Enclave / TPM) y envía la llave
>      pública junto con el credential_id al backend para completar la
>      creación de la cuenta.
> 3. Soporte para Dispositivos sin FIDO2 (Fallback)
>    - Dado que un usuario intenta registrarse o iniciar sesión desde un
>      navegador o dispositivo que no soporta FIDO2 (detectado mediante
>      window.PublicKeyCredential), Cuando ingresa y valida el código OTP de
>      su correo, Entonces el sistema le permite ingresar a su cuenta
>      directamente omitiendo el paso de enrolamiento de Passkey,
>      permitiéndole operar de manera segura mediante OTP.
>
> Agregar inicio de sesión con huella/rostro (Passkey) en la página de
> invitación.

## Context

### How a person gets in today

As built on `main` at `d1d5fd9`. The rules come from the archive's
`auth/better-auth.spec.md` (cited here as `better-auth D<n>`) and from
`business-and-memberships`:

- **Registration** asks for a name, an email and a password. A six-digit
  código goes to the email. Typing it confirms the address and opens the
  session (better-auth D16). The business wizard follows
  (business-and-memberships D5).
- **Daily sign-in** is email and password. better-auth D2 kept the
  password on purpose: "a code round-trip per login buys nothing over a
  password the admin already knows". A person who enabled *huella o rostro*
  in Cuenta → Seguridad can press "Entrar con huella o rostro" instead
  (US-S07). The enrolment is offered there, never forced (better-auth D7),
  and every key is listed and removable (better-auth D18).
- **Recovery** is a código and a new password. The new password closes every
  other session (better-auth D17).
- **The invitation page** (`/invitaciones/:id`) fixes the address to the
  invited one (better-auth D14). Without an account, the invitee types a name
  and a new password, and the account is born verified, because the
  invitation reached that inbox. With an account, the invitee types the
  password. It is the one access screen with no "Entrar con huella o rostro".
- **Emails carry codes, never links** (constitution VI, from better-auth D4).
  D4 names three reasons, each one paid for: a link signs in the device that
  opens the email, not the one where the person started; mail scanners open
  links before the person does and burn single-use ones ("Este enlace ya no
  sirve"); and the person leaves the screen that asked.
- **The store app** (`apps/red`) signs the shopkeeper in with their phone and
  a password, and offers *huella o rostro* in Caja (cash-at-stores D3,
  FR-010). better-auth D2 rejected a code at the counter: a shopkeeper with a
  queue in front of them cannot go and fetch an email.

Two facts, measured 2026-10-02 against Better Auth 1.6.29, the version the
API pins:

- **Nobody chose how long a código lives.** It lives the library's default,
  five minutes.
- **Nobody chose how a código is stored.** It is stored as typed, in plain
  text. Constitution V says a credential the product only ever compares is
  stored as a hash.

### What changes

The creator's request: the password leaves. A person proves their email once
with a código. From then on their own device is the key: its fingerprint,
its face, or its screen lock. A device that cannot do that still works, with
the código alone. The invitation page gets the same "Entrar con huella o
rostro". The password leaves the store app as well (User Story 6): the
shopkeeper enters with the fingerprint or face, or with a código sent to
their email.

What it is worth:

- **To the business's people**: nothing to invent, nothing to forget,
  nothing to write on a note. On their own phone or computer, signing in is
  one touch.
- **To the business**: a fake Devolada page can steal a password, but it
  cannot use a passkey, because a passkey works only on Devolada's own
  address. The panel holds the business's CLABE and its team. This is the
  door to both.
- **To Devolada**: no passwords to protect and no "olvidé mi contraseña".
  Getting back in is always the same: a código to the email.

### What a passkey is, and is not

The screens make these promises, so the spec makes them first:

- A passkey (the FIDO2 / WebAuthn standard of the creator's story) is a key
  the person's device creates for Devolada's address only. The device
  unlocks it with the person's fingerprint, face or screen lock (the PIN,
  pattern or password of the device).
- **Devolada never receives the fingerprint, the face or the device's
  PIN.** It never holds the private half of the key either. It stores the
  public half and an identifier: enough to check a signature, useless to
  anyone who copies them.
- When the person's keychain syncs (iCloud, Google), the key follows them to
  their other devices (better-auth D18). So no screen promises that the key
  "never leaves this device".
- **The email stays the master key**, the half of better-auth D2 that
  survives. Losing every device never locks a person out: a código to their
  email always opens the account. Whoever controls the inbox controls the
  account, as with today's recovery.

### What this asks of the constitution

- **Technology Stack, Auth row**: "email + password with OTP verification"
  and "`username` plugin for the shopkeeper's phone sign-in" stop
  describing either app. No one signs in with a password, and the phone no
  longer signs in: it only names the store account a código is sent for
  (FR-033). The plan proposes the amendment.
- **Principle VI**, "auth emails carry codes, never links", stands. The
  creator's story asked for "OTP y magic link"; asked about the conflict,
  the creator chose the código alone (Clarifications, Q1).
- **Principle V** does not change, but this feature must meet it. The
  código becomes the only key of an account without a passkey, so it is
  stored as a hash (FR-025).

Everything else stays: tenant isolation, authorization by area, sessions in
our own database, the 30-day sliding session, and the suspension check on
every request.

### What this replaces

This spec specifies again (constitution I), and replaces, in the panel:

- **better-auth D2**, the daily password, for everyone: the passwords that
  exist today stop working and are erased (FR-029).
- **better-auth D7**, "enrolment offered after login". The activation is
  offered right after the código: at registration, at every sign-in by
  código and on the invitation page (FR-006). D7's "never forced" stands:
  the person can always say "Ahora no" (Clarifications, Q3).
- **better-auth D14**, "the only question left is a password". The
  invitation page asks for no password. With an account: the key or a
  código. Without one: the name, then the key.
- **The password half of better-auth D16.** The door stays: the código opens
  the session. But no account exists before its email is proven, so there
  is no unverified account left to replace, and no "right password,
  unproven address" path.
- **better-auth D17.** There is no password to reset. Its guarantee — the
  person can end every session they did not open — moves to an action of
  its own in Seguridad (FR-022).
- **The recovery page** (`/recover`) and every "Olvidé mi contraseña" link,
  on the sign-in page and on the invitation page. The intent of the fix
  `invitee-lands-own-business` (an invitee who needs help comes back to the
  invitation) holds without the detour: the código is asked on the
  invitation page itself.
- **"Ya existe una cuenta con ese correo"** at registration. The old rule
  "signup necessarily reveals existence" no longer holds: a código goes out
  either way (FR-005).
- **Copy that promises a password**: the passkey card's "Tu contraseña sigue
  funcionando" and Cuenta's "Para cambiar tu nombre o tu contraseña,
  escríbenos" (FR-030).

And in the store app (User Story 6):

- **cash-at-stores FR-009 and D5**, the invitation's "email and password,
  then a code". It becomes the email, then the código, then the offer of
  the fingerprint or face.
- **cash-at-stores FR-010 and D3**, phone and password, and the store half
  of better-auth D2 ("a shopkeeper mid-queue cannot fetch a code"). D3
  recorded "an email-only sign-in for shopkeepers" as rejected because the
  creator chose phone and password; the creator reversed that on
  2026-10-02 and accepted the wait at the counter (Clarifications, Q2). The
  phone stays the shopkeeper's name, but it signs nothing in: it says which
  store account the código goes to (FR-033).
- **cash-at-stores FR-011**, recovery by código and a new password. There is
  nothing to recover: the código is the way in. Its "never a link" stays.
- **The store app's recovery screen** and its "¿Olvidaste tu contraseña?",
  and the copy that promises a password: the Caja card's "Tu contraseña
  sigue funcionando" and the sign-in's "Entra con tu teléfono y contraseña"
  (FR-035).
- **cash-at-stores D26's Caja card "without its list"**. With no password
  to reset, the card is how a lost phone is shut out: it lists the keys and
  ends the other sessions (FR-036).

Not replaced: the business wizard; the member invitation email and its link
(it carries the invitation, not a proof of an address someone typed); the
session's terms; suspension; the platform operator's access, which uses the
same doors; and the `/v1` API keys.

## Clarifications

### Session 2026-10-02

- Q1. Q: The story asks for "código OTP y magic link", but constitution VI says
  auth emails carry codes, never links (better-auth D4). Does the email
  carry a link? → A: No — "Solo OTP, como hasta ahora." The email carries
  the six digits alone, and Principle VI stands. Rejected: the código plus a
  button that confirms from any device (a person who typed someone else's
  address gets in the moment the owner, or their mail scanner, presses it,
  and the account holds the business's CLABE); a classic magic link (the
  session and the key land on the device that opened the email, and mail
  scanners burn single-use links).
- Q3. Q: On a device that can use the fingerprint or face, may the person skip
  the activation? → A: Yes (option A). It is offered at once, with "Ahora
  no". It comes back at the next sign-in by código and is always in Cuenta →
  Seguridad. Rejected: a key required on such a device (a cancelled window or
  a failing sensor blocks the person, and a shared computer would be made to
  keep a key that anyone with its PIN can use; it adds no security, because
  accounts without a key exist anyway on devices without support); one
  forced attempt before "Ahora no" appears (it hides the way out).
- Q2. Q: What happens to the passwords that exist today? The creator's first
  answer restated the invitation page's "inicio de sesión con huella/rostro",
  which User Story 4 already holds, so the question was asked again in
  concrete terms: "Ana already signs in to the panel with her password. When
  this ships, how does she get in?" → A: With her fingerprint or face, or a
  código; her password stops working (option A). It is erased, and the
  invitation page offers her the key or the código. Rejected: Ana keeps her
  password and only new accounts are born without one (two kinds of
  account, two forms and "Olvidé mi contraseña" to keep, and the one thing
  a fake page can steal stays).
- Q2, second half. Q: Does the store app change? → A: Yes, the password
  leaves it too ("Sin contraseña también"): the shopkeeper enters with the
  fingerprint or face, or with a código sent to their email. The cost was
  named and accepted: when the fingerprint fails at the counter, the
  shopkeeper waits for an email with customers in front of them. Rejected:
  no change (phone and password stay); keeping the password and offering the
  key from the invitation onwards.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register with a código, then the fingerprint or face (Priority: P1)

A person who wants to collect with Devolada opens "Crear cuenta". They type
their name and email and press "Continuar". A six-digit código arrives in
their inbox, and they type it on the screen they never left. At once, their
phone or computer offers to protect the account with their fingerprint, face
or screen lock. One confirmation in the device's own window, and they are in
the business wizard. They never chose a password.

**Why this priority**: it is the door for every new business, and the
creator's story starts here.

**Independent Test**: in a browser with a virtual authenticator, register a
new address: name and email, the código from the log, the device's
confirmation. Land in the wizard. Check that Cuenta → Seguridad lists one key
and that the account holds no password. Sign out, then sign in with the key
alone.

**Acceptance Scenarios**:

1. **Given** the registration screen, **When** the person types a name and a
   valid email and presses "Continuar", **Then** a six-digit código goes to
   that email, and the screen asks for it and names the address.
2. **Given** a código sent less than ten minutes ago, **When** the person
   types it, **Then** the email is confirmed, the account is born and the
   session opens, in one step.
3. **Given** scenario 2 on a device that can verify the person itself,
   **When** the session opens, **Then** the activation step follows at once.
4. **Given** the activation step, **When** the person confirms in the
   device's window, **Then** the key is saved to their account, and they land
   in the business wizard or on the page they were going to (better-auth
   D12).
5. **Given** the activation step, **When** the person cancels the device's
   window or it fails, **Then** the screen says so in one line and lets them
   try again or choose "Ahora no".
6. **Given** the activation step, **When** the person chooses "Ahora no",
   **Then** they land in the business wizard with no key, and the activation
   is offered again at their next sign-in by código.
7. **Given** a wrong código, **When** it is typed, **Then** the screen says
   the código is not valid or has expired and offers to resend it. After
   three wrong tries that código is dead, and only a new one works.
8. **Given** a código older than ten minutes, **When** it is typed, **Then**
   it is refused the same way.
9. **Given** the código screen, **When** the person presses "Reenviar
   código", **Then** a new código goes out, the earlier one stops working,
   and the screen confirms "Código reenviado".
10. **Given** a finished registration, **Then** no password exists for that
    account, anywhere.

---

### User Story 2 - Sign in without a password (Priority: P1)

A returning person opens the panel. If their device holds their key, they
press "Entrar con huella o rostro", touch the sensor, and they are in.
Otherwise they type their email, get a código, type it, and they are in. The
panel then offers to activate the fingerprint or face on this device, so the
next time is one touch.

**Why this priority**: an account created in User Story 1 is worth nothing if
its owner cannot get back in.

**Independent Test**: with an account that holds a key, sign in with the key,
typing nothing. With an account without one, sign in with a código, and see
the activation offered on a device that can verify the person.

**Acceptance Scenarios**:

1. **Given** an account with a key on this device, **When** the person
   presses "Entrar con huella o rostro" and confirms on the device, **Then**
   they are in, on the page they were going to, without typing anything.
2. **Given** the sign-in screen, **When** the person types their email and
   asks for a código, **Then** a six-digit código goes to that email, and
   typing it signs them in.
3. **Given** a sign-in by código on a device that can verify the person
   itself, **When** the session opens, **Then** the activation step of User
   Story 1 is offered.
4. **Given** "Entrar con huella o rostro" was pressed, **When** the key fails
   or the person closes the device's window, **Then** the screen says in one
   line that it did not work and offers the código. It shows no technical
   error.
5. **Given** a person signed in, **Then** they stay signed in on that device
   for 30 days, renewed each time they use it (better-auth D5). A person
   without a key types a código only on a device where they hold no session.
6. **Given** a key activated before this feature (US-S07), **Then** it keeps
   working.
7. **Given** a person who used to sign in with a password, **When** they open
   the sign-in screen, **Then** one line tells them passwords are no longer
   used, next to the key and the código (FR-029); their old password opens
   nothing.

---

### User Story 3 - A device without fingerprint or face (Priority: P1)

A person registers from an old computer, or from a browser that does not
support passkeys. After the código they are simply in: no activation step,
no error, no button that does nothing. On that device they sign in with a
código. When they later sign in by código on a phone that can use the
fingerprint or face, the panel offers it there.

**Why this priority**: without it, these people are locked out. The código
alone must be a whole way in.

**Independent Test**: in a browser without passkey support, register and
sign in with códigos only. No screen mentions the fingerprint or the face.

**Acceptance Scenarios**:

1. **Given** a device without passkey support, **When** the person registers
   and types the código, **Then** they land in the wizard, with no activation
   step and no mention of the fingerprint or face.
2. **Given** such a device, **When** the person opens the sign-in screen,
   **Then** it offers the código only; "Entrar con huella o rostro" is not
   shown.
3. **Given** an account that holds a key, **When** its owner signs in from a
   device without passkey support, **Then** the código works all the same.
4. **Given** a browser that supports passkeys, on a computer that cannot
   verify the person itself (no fingerprint reader, no face camera and no
   screen lock the browser can use), **Then** the sign-in screen still shows
   "Entrar con huella o rostro", because the person's phone can answer it,
   but the activation step is never opened on that computer by itself
   (FR-016).

---

### User Story 4 - Join a business from an invitation with the fingerprint or face (Priority: P2)

An owner invites a colleague, and the colleague opens the invitation:

- **They have an account and a key on this device.** They press "Entrar con
  huella o rostro", touch the sensor, and they are inside the business with
  their role. Nothing is typed.
- **They have an account but no key here.** They ask for a código, which goes
  to the invited address. They type it and they are inside, and the
  activation is offered.
- **They have no account.** They type their name, confirm the device's
  window, and they are inside. No código is needed: the invitation already
  proved the inbox (better-auth D14).

**Why this priority**: the invitation is how a business's team grows. Today
it is the one access screen without the fingerprint or face. After User
Story 2 it would be the last screen asking for a password.

**Independent Test**: invite an address whose account holds a key. Open the
invitation without a session, sign in with the key, and land in the business
with the invited role. Then invite an address without an account: the name,
the device's confirmation, inside — no código and no password.

**Acceptance Scenarios**:

1. **Given** an invitation for an address whose account holds a key on this
   device, **When** the invitee presses "Entrar con huella o rostro" and
   confirms, **Then** the invitation is accepted, its business becomes the
   active one, and they land inside.
2. **Given** that page, **When** the key used belongs to another account than
   the invited address, **Then** the page says the invitation was sent to
   another email and offers to switch, as it does today. Nothing is
   accepted.
3. **Given** an invitation for an address with an account, **When** the
   invitee asks for a código, **Then** it goes to the invited address, shown
   as text and never typed (better-auth D14). Typing it accepts the
   invitation and lands them inside.
4. **Given** an invitation for an address without an account, **When** the
   invitee types their name and continues, **Then** the account is born
   verified, the activation step follows on a device that can verify the
   person, and they land inside the business with the invited role.
5. **Given** a device without passkey support, **Then** the page offers the
   código (with an account) or the name alone (without one), and never
   mentions the fingerprint or face.
6. **Given** an expired or gone invitation, or a session that already holds
   the invited address or another one, **Then** the page behaves as it does
   today.

---

### User Story 5 - Keep control of keys and sessions (Priority: P2)

A person loses their phone. From their computer they sign in, open Cuenta →
Seguridad, remove the phone's key, and end the session the phone still has
open. Today a password reset ended it (better-auth D17). Without a password,
this is the way.

**Why this priority**: removing the password must not remove the one way to
end a session that someone else holds.

**Independent Test**: open two sessions of one account in two browsers. From
one, choose "Cerrar sesión en los demás dispositivos": the other one finds
itself signed out at its next action, and the first stays in. Remove a key:
it no longer signs in, and the código still does.

**Acceptance Scenarios**:

1. **Given** Cuenta → Seguridad, **Then** it lists every key of the account
   with "Quitar" on each, and offers to activate one on this device
   (better-auth D18, unchanged).
2. **Given** a removed key, **When** someone signs in with it, **Then** it is
   refused, and the código still works.
3. **Given** several open sessions, **When** the person chooses "Cerrar
   sesión en los demás dispositivos", **Then** every other session of the
   account ends at its next request, and the current one stays.
4. **Given** the last key removed, **Then** the account still gets in with a
   código.

---

### User Story 6 - The shopkeeper gets in without a password (Priority: P2)

A shopkeeper opens their store's invitation from WhatsApp. They type their
email, a código arrives, they type it, and they are in the store app. Their
phone then offers the fingerprint or face, and from the next day on they
open the app with one touch. On the day the fingerprint fails at the
counter, they type their phone number, a código reaches their email, and
they are back in.

**Why this priority**: the creator chose one way in for all of Devolada
(Clarifications, Q2). It ships apart from the panel: until it does, the
store app keeps the phone and the password.

**Independent Test**: accept a store invitation with an email and its
código, activate the key, sign out, and sign in with the key alone. Sign out
again, type the store's phone, and sign in with the código that reaches the
email. Check that the store's account holds no password, and that a business
member's account is still refused by the store app.

**Acceptance Scenarios**:

1. **Given** a valid store invitation, **When** the shopkeeper types their
   email and continues, **Then** a código goes to that email. Typing it
   creates the store's account, signs them in, and offers the activation
   step, with "Ahora no" (FR-006).
2. **Given** an email that already belongs to an account, a business
   member's or a platform operator's, **When** its código is typed, **Then**
   the invitation says that email cannot be used for a store and asks for
   another one; the invitation stays open. Before the código, nothing
   reveals it.
3. **Given** a shopkeeper whose phone holds their key, **When** they press
   "Entrar con huella o rostro" and confirm, **Then** they are in, typing
   nothing.
4. **Given** the store app's sign-in, **When** the shopkeeper types their
   phone and asks for a código, **Then** the código goes to the email of the
   store account that phone names, and typing it signs them in. The screen
   answers the same way for any phone (cash-at-stores D3: whether a phone is
   a store's is nobody's to probe).
5. **Given** an invitation that was used, replaced or is older than seven
   days, **Then** it says it no longer works, as today.
6. **Given** a business member's account, **When** it reaches the store app
   through any door, **Then** it is refused, as today (cash-at-stores
   FR-013).
7. **Given** a shopkeeper signed in, **Then** they stay signed in on that
   phone for 30 days, renewed by use (cash-at-stores FR-010).
8. **Given** a store account that has a password today, **Then** from this
   story's release the password stops working; the shopkeeper enters with
   the key activated in Caja, or with a código (FR-029).
9. **Given** a shopkeeper who lost their phone, **When** they sign in on a
   new one and open Caja, **Then** they can remove the old phone's key and
   choose "Cerrar sesión en los demás dispositivos"; the old phone's session
   ends at its next request (FR-036).

---

### Edge Cases

- **Registering with an address that already has an account.** The código
  goes out as for a new address. Typing it signs the person into the
  existing account; the name they typed is ignored. No screen says the
  address is taken (FR-005).
- **Signing in with an address that has no account.** The screen answers as
  for any address: a código goes out. Typing it continues as a registration:
  the name is asked first, then the activation step (FR-013). Both doors
  lead to the same place, so no answer reveals whether an address has an
  account.
- **A mistyped address.** The código never arrives, and "Usar otro correo"
  goes back to fix it. Nothing was created for the wrong address: an account
  is born only when its email is proven (FR-004).
- **The email is slow, or the provider is down.** "Reenviar código" is the
  retry. In an environment without the email provider, the código is written
  to the log (constitution VIII). The screen always says the código is on its
  way and offers the resend; it never waits in silence. (The panel names the
  address the person typed; the store app says "your store's email", because
  naming it would tell a stranger whose phone it is.)
- **Two códigos requested.** Only the newest works (FR-003).
- **The código typed on another device.** It works there: the session opens
  where the código is typed (better-auth D4: "a code is read anywhere and
  typed where the session belongs").
- **Too many requests.** Asking for códigos, or trying them, too often from
  one network address is slowed down as today (better-auth D11, D15), with a
  plain message to wait a moment (FR-027).
- **The tab is closed during the activation step.** The account and the
  session already exist. The next visit goes on as for an account without a
  key, and the activation comes back at the next sign-in by código
  (FR-006).
- **A shared computer.** A key protected by a shared screen lock lets in
  anyone who knows that lock. The activation step says so in one line
  (FR-008), and "Ahora no" keeps the shared computer without a key
  (FR-006).
- **Keys of several accounts on one device.** The device's own window lets
  the person choose the account.
- **A key from the dev environment** is never offered on production: each
  environment has its own (better-auth D7).
- **A suspended account** signs in and is stopped at its first request, as
  today.
- **A store's account on the panel** is refused with its own screen, as
  today (cash-at-stores D2), whatever the door it came through.
- **An account that has a password today** loses it at its app's release
  and enters with its key or a código (FR-029). The sign-in screen says so
  in one line, so nobody goes looking for the password field.
- **A panel account whose email was never proven** (a registration that
  stopped before its código, from before the release) never held a session
  or a business. After the release it is not an account: registering with
  that address starts over (FR-004).
- **A shopkeeper who accepted the invitation before the release and never
  typed the código.** Asking for a código by phone reaches the email they
  gave; typing it proves it and lets them in.
- **The inbox and every key are lost.** The person is locked out; today a
  remembered password would still open the account. The way back: a member
  gets a new invitation from their business, to a new address; an owner or
  a shopkeeper goes to Devolada's support. Changing one's email stays out
  of scope (Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

**Registration**

- **FR-001**: The registration screen MUST ask for the person's name and
  email, and nothing else. No password is asked, created or stored, then or
  later.
- **FR-002**: "Continuar" MUST send a six-digit código to the email and open
  the código screen. That screen names the address the código went to, and
  offers "Reenviar código" and "Usar otro correo".
- **FR-003**: A código, in either app, MUST be valid for ten minutes, for
  one use, and only for the address it was sent to. A new request ends the
  previous código. Three wrong tries end it.
- **FR-004**: Typing the right código MUST confirm the email and open the
  session, in one step. An account is born only when its email is proven
  this way, or by an invitation (FR-019): a mistyped address leaves nothing
  behind.
- **FR-005**: Registering with an address that already has an account MUST
  behave exactly as for a new address until the código is typed, and then
  open the existing account. No screen, message or answer may reveal whether
  an address has an account.

**Activation of the fingerprint or face**

- **FR-006**: When a session opens by código (at registration, at sign-in,
  on the invitation page, and in the store app), and when an invitee's
  account is born (FR-019), a device that can verify the person itself MUST
  be offered the activation step at once. Its decisive action opens the
  device's own window; the person never has to go looking for it. The step
  MUST also offer "Ahora no", which goes on with the código alone. A person
  who skipped it is offered it again at their next sign-in by código, and
  it is always in Cuenta → Seguridad (FR-021), or in the store app's Caja
  (FR-035).
- **FR-007**: Confirming in the device's window MUST save the key to the
  account and continue: to the business wizard, to the invitation's
  business, or to the page the person was going to (better-auth D12).
- **FR-008**: The activation step MUST say, in plain es-MX, four things: next
  time the person enters with their fingerprint or face; Devolada never sees
  the fingerprint or the face; a synced keychain makes the key serve on
  their other devices (better-auth D18); and anyone who can unlock a shared
  device can enter with it.
- **FR-009**: A cancelled or failed activation MUST be named in one line and
  offer to try again or "Ahora no". It never shows a technical error.

**Sign-in**

- **FR-010**: The panel's sign-in screen MUST offer "Entrar con huella o
  rostro" wherever the browser supports passkeys, and MUST always offer to
  enter with a código sent to the email. It MUST have no password field.
- **FR-011**: A sign-in with a key MUST need nothing typed: the device's
  window, one confirmation, and the person is in, on the page they were
  going to.
- **FR-012**: A failed or cancelled sign-in with a key MUST say so in one
  line and offer the código. It never shows a technical error.
- **FR-013**: Asking for a código on the panel's sign-in screen MUST answer
  the same way for every well-formed address. For an address without an
  account, typing the código continues as a registration: the name is asked
  before anything else, then FR-006.
- **FR-014**: Sessions in both apps MUST keep today's terms: 30 days, renewed
  by use (better-auth D5, cash-at-stores FR-010), with the suspension check
  on every request.

**Devices without passkey support**

- **FR-015**: On a device without passkey support, registration, sign-in and
  the invitation MUST be complete with the código alone, in either app: no
  activation step, no passkey button, no mention of the fingerprint or face,
  and no error.
- **FR-016**: The activation step MUST be offered only where the device can
  verify the person itself. The sign-in button MUST show wherever the
  browser supports passkeys, even on a device that cannot verify the person,
  because a phone nearby can answer it.

**The invitation page**

- **FR-017**: Without a session, for an address with an account, the
  invitation page MUST offer "Entrar con huella o rostro" (where supported)
  and a código sent to the invited address. The address is shown as text,
  never typed (better-auth D14). Either way, success accepts the invitation,
  makes its business the active one, and lands the person inside.
- **FR-018**: A key that belongs to another account MUST lead to today's
  "invitation sent to another email" state, with its switch, and accept
  nothing.
- **FR-019**: For an address without an account, the page MUST ask only for
  the name. The account is born verified by the invitation, with no código
  (better-auth D14); then FR-006; then the person lands inside the business
  with the invited role.
- **FR-020**: The invitation page MUST ask for no password, in any state. Its
  expired, gone, same-address and other-address states keep today's
  behavior.

**Keys and sessions**

- **FR-021**: Cuenta → Seguridad MUST keep listing every key of the account,
  with "Quitar" on each, and offering to activate one on this device
  (better-auth D18).
- **FR-022**: Seguridad MUST offer "Cerrar sesión en los demás dispositivos".
  It ends every other session of the account, each of which finds itself
  signed out at its next request; the current session stays. This keeps
  better-auth D17's guarantee without a password.
- **FR-023**: A removed key MUST stop signing in at once. Removing the last
  key leaves the código as the way in.

**Códigos and email**

- **FR-024**: The código email MUST carry the six digits in its subject and
  in its body, in es-MX, and call them "código" — never "OTP", "token" or
  "enlace". It MUST carry no link that signs in or confirms anything
  (constitution VI, better-auth D4).
- **FR-025**: A live código MUST be stored only as a hash, never in a form
  anyone can read back (constitution V). Today it is stored as typed.
- **FR-026**: Without the email provider, the código MUST be written to the
  log instead of sent (constitution VIII).
- **FR-027**: Requests for códigos and tries at typing them MUST stay
  rate-limited per network address, on every door that sends or checks one,
  the new doors included (better-auth D11, D15).

**Privacy**

- **FR-028**: For each key, Devolada MUST store only its public half, its
  identifier, a name, its activation date and whether it is synced. Never
  biometric data, and never the private half.

**Existing accounts and copy**

- **FR-029**: Accounts that have a password today MUST lose it: from the
  release of each app's doors without a password, the password stops
  working and is erased. The person enters with their key (one activated
  before keeps working) or a código. No app loses its passwords before its
  own doors without a password work. Each sign-in screen says so in one
  line, for example: "Ya no usamos contraseñas: entra con tu huella o
  rostro, o con un código."
- **FR-030**: The panel's copy MUST stop promising a password: the passkey
  card ("Tu contraseña sigue funcionando…") and Cuenta's identity card
  ("Para cambiar tu nombre o tu contraseña…"). The rebuilt registration
  screen names no business type (constitution IX): today's "Tu ISP,
  cobrando por transferencia sin trabajo manual" leaves with the password.

**The store app**

- **FR-031**: The store invitation MUST ask only for the shopkeeper's email.
  A código goes to it. Typing it creates the store's account, signs it in
  and offers the activation step (FR-006). The invitation is used up only
  then: a shopkeeper who leaves before the código can come back to the same
  invitation while it lasts.
- **FR-032**: An email that already belongs to an account, or to a platform
  operator, MUST be refused only after its código is typed. The invitation
  then says so, asks for another email, and stays open. (cash-at-stores D5
  refused it before any código, with `EMAIL_TAKEN`.)
- **FR-033**: The store app's sign-in MUST offer "Entrar con huella o rostro"
  wherever the browser supports passkeys, and a código: the shopkeeper types
  their phone, and the código goes to the email of the store account that
  phone names. Every phone gets the same answer; a phone that names no store
  gets no código, and nothing on the screen says so (cash-at-stores D3). It
  MUST have no password field.
- **FR-034**: The store app MUST never create an account. A store's account
  is born only from the operator's invitation (cash-at-stores FR-009).
- **FR-035**: The store app MUST lose its recovery screen, its "¿Olvidaste tu
  contraseña?" and every password field. The activation is offered right
  after the invitation's código and after each sign-in by código (FR-006),
  and stays in Caja (cash-at-stores D26). Its copy stops promising a
  password: the Caja card's "Tu contraseña sigue funcionando" and the
  sign-in's "Entra con tu teléfono y contraseña".
- **FR-036**: Caja's card MUST list the store account's keys, with "Quitar"
  on each, and offer "Cerrar sesión en los demás dispositivos" (FR-022,
  FR-023). Today a shopkeeper who lost their phone shuts it out by resetting
  the password (better-auth D17 holds for store accounts too); without a
  password, this is the way. The card drops the "one shopkeeper, one phone"
  shortcut of cash-at-stores D26, which showed no list.

### Key Entities *(include if feature involves data)*

- **Person (account)**: a name and a proven email. No password. Holds
  sessions and keys, and belongs to businesses through memberships
  (unchanged).
- **Store account**: the shopkeeper's account, which a store names
  (cash-at-stores D2). A proven email, where its códigos go, and the store's
  phone, which names it at the store app's sign-in. No password. Born only
  from the operator's invitation.
- **Key (passkey)**: belongs to one person. Holds the public half, an
  identifier, a name ("Llave de acceso" when none), the activation date, and
  whether it is synced. Only the person's device creates one; the person
  removes it from Seguridad, or from Caja in the store app.
- **Código**: six digits for one address. Lives ten minutes, serves once,
  and dies after three wrong tries or when a newer one is requested. Stored
  only as a hash.
- **Session**: unchanged (30 days, renewed by use). The person can end all
  of their sessions but the current one.
- **Invitation**: unchanged (48 hours, the address fixed). It now also opens
  with a key or a código.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new person goes from "Crear cuenta" to the business wizard in
  under two minutes, when the código email arrives within 30 seconds.
- **SC-002**: A returning person, in the panel or at the store, whose device
  holds their key signs in within 10 seconds, typing nothing.
- **SC-003**: No account holds a password: zero in the panel from its
  release, and zero in the store app from User Story 6's release.
- **SC-004**: On devices without passkey support, 100% of registrations and
  sign-ins finish with the código alone, with no error screen.
- **SC-005**: In the first four weeks, at least 7 in 10 new accounts
  registered on a device that can verify the person activate a key during
  registration.
- **SC-006**: Zero screens or answers reveal whether an address has an
  account, across registration, sign-in and the código screen, or whether a
  phone is a store's, at the store app's sign-in. Only a person who typed an
  address's código may learn what that address holds.
- **SC-007**: An invitee whose device holds their key joins the business with
  one touch, typing nothing.
- **SC-008**: No account is ever locked out by a lost device: 100% of
  accounts can get in with a código sent to their email.
- **SC-009**: After "Cerrar sesión en los demás dispositivos", 100% of the
  other sessions are refused at their next request.
- **SC-010**: No live código is readable from the database: zero stored as
  typed.
- **SC-011**: A shopkeeper whose fingerprint fails at the counter is back in
  by código in under two minutes, when the email arrives within 30 seconds.

## Assumptions

- **Both apps are the scope** (Q2). In the panel: registration, sign-in, the
  invitation page and Cuenta → Seguridad. In the store app: the invitation,
  the sign-in and Caja's card.
- **The phone stays the shopkeeper's name in the store app.** When the
  fingerprint fails, the shopkeeper types their phone, not their email, and
  the código goes to the email on file. The network knows the shopkeeper by
  that phone: the operator creates the store with it and sends the
  invitation to it. Ten digits on a number pad are quicker at the counter
  than an email, and the shopkeeper need not remember which email they
  gave.
- **The name stays at registration.** The creator's story names only the
  email, but the name is still needed: the invitation email says who
  invites, and Usuarios lists people by name. It sits on the same screen as
  the email.
- **Ten minutes** is the creator's example, taken as the value. Today's five
  minutes is a default nobody chose; "a guarantee that lives in a default is
  not ours" (business-and-memberships D8, said of the invitation's 48
  hours).
- **Three wrong tries per código** is the library's default, written down
  here as ours. better-auth D11 already counted on it.
- **"A device that can verify the person itself"** refines the creator's
  detection by `window.PublicKeyCredential`. That check says the browser
  knows the standard. It does not say the device has a fingerprint reader, a
  face camera or a screen lock the browser can use. Opening the activation on
  such a computer shows a window asking for a phone or a security key — a
  dead end in the middle of a registration. The plan picks the check.
- **The member invitation email keeps its link** to the invitation page. The
  link carries the invitation; it is not a proof of an address someone typed.
  The creator's "solo código" (Q1) is about the email that carries a código.
- **Sessions do not change** (30 days, renewed by use). That is what makes an
  account without a key livable: a código is typed only on a device with no
  session.
- **Out of scope**: changing one's email; renaming keys (better-auth D18
  rejected it); códigos by SMS or WhatsApp; signing in with Google or Apple;
  security keys as a designed option (the device's window may still offer
  them, and they work); a "remember this device" for códigos.
- **Losing the inbox and every key is a cost this feature accepts.** Today a
  person who lost their inbox could still sign in with a remembered
  password; after this feature, the inbox or a key is the only way in. The
  way back is a new invitation (a member) or Devolada's support (an owner or
  a shopkeeper). If it happens often, changing one's email becomes a feature
  of its own.
- **Production holds accounts with passwords**: invitations were accepted on
  production on 2026-10-01 (bug `invitee-lands-own-business`), and the
  store pilot's shopkeepers sign in with one. Those passwords stop working
  at each app's release (FR-029). Nobody is locked out by it: every panel
  account holding a session proved its email (better-auth D16), and so did
  every shopkeeper who ever got in (cash-at-stores D5).

## Dependencies

- **A constitution amendment**: the Technology Stack's Auth row. The plan
  proposes it before any code. Principle VI is not touched (Q1).
- **The passkey layer** (`tests/passkey`: a real API and Chromium's virtual
  authenticator) proves the new journeys in both apps (constitution IV). Its
  current journeys, which register with a password and enrol later (in
  Cuenta, or in the store app's Caja), are rewritten.
- **Everything that signs in with a password today**: the dev seed's demo
  account, the API and component suites, the browser layer's stubs, the
  store app's screens. The plan lists them.
- **The store pilot's shopkeepers are told first.** Before User Story 6
  ships, the operator tells them that their password stops working and how
  they will get in. This happens outside the software.
- **Each environment keeps its own keys**, as configured today (better-auth
  D7): a key made on dev never opens production.
