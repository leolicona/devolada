---

description: "Task list for Passwordless Access"
---

# Tasks: Passwordless Access

> **Drift check (T002), 2026-10-02**, against research D16's inventory:
> - PR #273 (`bug: dev-code-readable`) is already merged into `main`, and
>   this branch starts from it: `testAddress()` and
>   `apps/api/test/dev-code-readable.test.ts` are in the tree. The "merge
>   `main` before T008 and T031" step is satisfied.
> - Every caller of the password doors, every reader of `lastCodeFor`,
>   `PASSWORD` and `/dev/last-code`, and every consumer of the three schemas
>   is one the inventory names. No new one appeared.
> - The measurements (T001) change no task. M4 changes the *reason* for
>   T005's `hooks.before`: two códigos asked for in the same second tie on
>   `created_at`, and the plugin may check the older one (research D2).
>
> **PR 1 gate (T055), 2026-10-02**, quickstart §1 in CI order: spec-lint,
> gen-banks, contrast-lint and pending-lint pass; every workspace
> typechecks; API 73 files / 1238 tests, admin 33 / 414, red 4 / 69,
> `@devolada/ui` 10 / 105, pago 5 / 173, landing 2 / 10; `pnpm e2e` 334
> passed; `pnpm e2e:passkey` 3 passed, twice in a row. Three decisions the
> tasks did not spell out, each cited where it lives:
> - the sweep leaves an account younger than ten minutes alone
>   (`credentials-sweep.ts`, D5): until PR 2 the store acceptance births its
>   shopkeeper unverified, with a password, a moment before it links the
>   store;
> - Seguridad's card shows on every device; only "Activar" needs one that
>   can verify the person (`PasskeyCard.tsx`, D7, FR-021, FR-022);
> - the passkey layer runs one journey at a time and with the limiter off
>   (`playwright.passkey.config.ts`, D3, D14): the journeys share the demo,
>   whose código `/dev/code` replaces, and ask several códigos a minute
>   from one address.

**Input**: Design documents from `specs/020-passwordless-access/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/panel-access.md](./contracts/panel-access.md),
[contracts/store-access.md](./contracts/store-access.md),
[contracts/codigo-email.md](./contracts/codigo-email.md),
[quickstart.md](./quickstart.md). Constitution v1.10.0: amendment 1 is
applied (T003); amendment 2 comes with PR 2 (T056).

**Tests are required, not optional.**
- Constitution IV fixes which layer may answer which question.
- Constitution VII requires every test file to cite its story, here as
  `passwordless-access US<n>`. A task's `[US<n>]` label is what the test it
  lands with inherits. A rewritten file that cites an archive story keeps
  that citation and adds the new one.

**Organization**: by user story, in the spec's priority order:
**US1, US2, US3 (P1), then US4, US5, US6 (P2)**.

**Two pull requests** (research D16):
- **PR 1, Phases 1–8: the panel (US1–US5).** The five panel stories ship
  together. Closing the panel's password door (US2) takes away the
  invitation page's password path (US4), and the password reset that used to
  end other sessions (US5).
- **PR 2, Phases 9–10: the store app (US6)**, after the operator has told the
  pilot's shopkeepers (spec Dependencies).

**Four things come before any story**:
1. the measurements (T001). M1, M2 and M6 can change tasks;
2. the drift check (T002);
3. the constitution amendment (T003, applied in v1.10.0);
4. the foundation (Phase 2): the código's terms, the email, the test
   helpers, the dev routes, the shared atoms.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel. It touches a different file and depends on
  no incomplete task.
- **[Story]**: which user story the task serves.
- Every task names its files. Every non-obvious rule it writes cites
  `passwordless-access D<n>` in a comment, and says when a reason was
  measured.

## Path Conventions

Paths are as `plan.md` fixes them:
- `apps/api/src/…` and `apps/api/test/…`
- `apps/admin/src/…` and `apps/admin/test/…`
- `apps/red/src/…` and `apps/red/test/…`
- `packages/ui/src/…` and `packages/ui/test/…`
- `tests/e2e/…`, `tests/passkey/…` and `tests/design/…`

---

## Phase 1: Setup

**Purpose**: confirm what the design read in the library, check the tree,
and put the amendment in motion. No behaviour changes in this phase.

- [X] T001 Run quickstart §0's measurements M1–M6 as a throwaway case in `apps/api/test/` (deleted afterwards). Record each result, with its date, under its decision in `specs/020-passwordless-access/research.md`:
  - **M1 → D1**: a sign-in código for an unknown address creates a verified user with the name sent.
  - **M2 → D8**: a session 25 hours old cannot register a key; one 23 hours old can.
  - **M3 → D4**: a `disabledPaths` entry answers 404 over HTTP, while `auth.api` still reaches it.
  - **M4 → D2**: three things about a hashed código:
    - it passes once;
    - it dies after three wrong tries;
    - it dies when a newer one is requested, even after the newer one is used.
  - **M5 → D11**: `revoke-other-sessions` leaves only the caller.
  - **M6 → D10**: `checkVerificationOTP` validates without consuming, and answers `USER_NOT_FOUND` only after a right código.

  Act on the results before going on:
  - **If M1 fails**, stop and take quickstart §0's fallback to the creator before T016.
  - **If M2 shows a day-old session can register a key**, drop the step-up from T049 and T073 and its cases from T048 and T061.
  - **If M6 consumes the código**, T065 uses quickstart §0's alternative.
- [X] T002 Check the consumers this feature changes against the tree, and note any drift at the top of `specs/020-passwordless-access/tasks.md` before editing. Compare with research D16's inventory (taken 2026-10-02):
  - every caller of `/auth/sign-in/email`, `/auth/sign-up/email`, `/auth/business/signup`, `/auth/sign-in/username`, `/auth/email-otp/verify-email`, `/auth/email-otp/request-password-reset`, `/auth/email-otp/reset-password`, `signUpEmail` and `signInEmail`, in `apps/` and `tests/`;
  - every reader of `lastCodeFor`, `PASSWORD` and `/dev/last-code`;
  - every consumer of `AcceptInvitationNewRequest`, `AcceptStoreInvitationRequest` and `StoreMeResponse` (the schemas, `apps/admin/test/msw.ts`, `apps/red/test/msw.ts`, `tests/e2e/stubs.ts`);
  - **known drift**: PR #273 (`bug: dev-code-readable`) restricts `/dev/last-code` and `/dev/last-invitation` to test addresses and adds `apps/api/test/dev-code-readable.test.ts`. Merge `main` into this branch before T008 and T031.
- [X] T003 [P] Constitution amendment 1 in `.specify/memory/constitution.md`, the plan's Complexity Tracking row 1. Applied on 2026-10-02 as v1.10.0 (`/speckit-constitution`, commit 18b36ae), ahead of PR 1's merge gate (T055).
- [X] T004 [P] The lite path for research D15, under `.specify/bugs/dev-code-readable/`. The creator asked for it on 2026-10-02, and it ships ahead of PR 1 as PR #273:
  - **The fix**: `GET /dev/last-code` and `GET /dev/last-invitation` in `apps/api/src/routes/dev.ts` answer only for a test address (`.invalid`, or the seed's demo address) and refuse the rest, the empty query included, with 403 `TEST_ADDRESS_ONLY`. The código lookup matches the address whole. The assessment found the invitation route: its id alone creates the invitee's account.
  - **The regression test** is `apps/api/test/dev-code-readable.test.ts`, citing `bug: dev-code-readable`. T008 and T031 carry the rule and the test forward.

---

## Phase 2: Foundational (PR 1)

**Purpose**: what every panel story stands on. Nothing a person sees changes
yet, except the código email's wording.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

- [X] T005 The código's terms in `apps/api/src/auth/better.ts` (research D2, D3):
  - **`emailOTP({ expiresIn: 600, allowedAttempts: 3, storeOTP: "hashed", … })`**. Each value carries a comment citing `passwordless-access D2`: the defaults nobody chose (300 s, plain text, read in 1.6.29's dist on 2026-10-02), and constitution V for the hash.
  - **In `hooks.before`**, beside the `username` refusal: on `/email-otp/send-verification-otp`, delete the `verification` rows whose identifier is `` `${type}-otp-${email.toLowerCase()}` `` before the plugin writes the new one. The comment says why: the plugin keeps old rows, and consumes the newest, so an old código comes back to life after the new one is used (D2).
  - **In the same `hooks.before`** (analysis A3): when a body to `/sign-in/email-otp` or `/update-user` carries `name`, it must be 2–80 characters once trimmed, or the request answers 400 `INVALID_NAME`. The screens check it first; this is the server's half of data-model.md's rule.
  - **`rateLimit.customRules["/sign-in/email-otp"] = { window: 60, max: 5 }`** (D3). Rewrite the limiter's comment: the plugin sets 3 per 60 s on its four paths, and `customRules` override it.
- [X] T006 [P] The código email in `apps/api/src/email/sender.ts`, per `contracts/codigo-email.md` (D13):
  - The `sign-in` template:
    - subject: `` `${otp} es tu código para entrar — Devolada` ``;
    - body: "Escribe este código en Devolada para entrar:", the digits large and spaced, "Vence en 10 minutos.", "Si no fuiste tú, ignora este mensaje.".
  - **No `<a>` and no URL** in the template.
  - The header comment keeps "Codes, never links" and cites `passwordless-access D13` beside better-auth D4.
  - The other two templates stay until T067.
- [X] T007 API test helpers in `apps/api/test/helpers.ts` and `apps/api/test/setup.ts` (research D14):
  - **`sentCode(email)`**: the last código the sender logged for that address.
    - `setup.ts` installs a `console.log` spy in its `beforeEach`. The spy keeps every `` `[código:${kind}] ${to} → ${otp}` `` line in a map keyed by address, and the map is reset in the same `beforeEach` (constitution IV: a test starts from empty).
    - `sentCode` reads the map, and throws a named error when the address has none.
  - **`mintCode(email, type = "sign-in")`**: deletes the address's live rows of that kind, then returns `auth().api.createVerificationOTP({ body: { email, type } })`.
  - **`seedAuthUser` births the user without a password**: `(await auth().$context).internalAdapter.createUser({ name, email, emailVerified: true })`, with no `account` row. `seedBusiness` and `seedMember` keep their shape.
  - **`PASSWORD` and `seedPlainUser` stay until T057.** The store suite still proves the password door it keeps until PR 2.
  - **Expect failures.** The suites that sign in with a password fail until their story tasks rewrite them: T022 (`isp-signup` and one `cash-at-stores-access` case), T029, T030, T031, T040 and T041. The store side's cases that read a código, or sign the operator in with a password, are T077's, still in this phase.
- [X] T008 [P] Dev routes in `apps/api/src/routes/dev.ts` (research D14, D16), per `contracts/panel-access.md` § "Dev only":
  - **`POST /dev/code {email, type}`**:
    - it answers only for a test address, through `testAddress()` from `bug: dev-code-readable` (PR #273): an address ending in `.invalid`, or equal to one of `DEMO`'s addresses. Anything else gets 403 `TEST_ADDRESS_ONLY`, the refusal `/dev/last-invitation` already gives;
    - it deletes the live rows, mints with `createVerificationOTP`, and answers `{ code }`;
    - a comment cites D14, D15 and `bug: dev-code-readable` (why not any address: the deployed dev Worker runs with `ENVIRONMENT=dev`).
  - **Remove `GET /dev/last-code`.** `/dev/last-invitation` stays, under the same rule.
  - **The seed without a password**:
    - `seedUser` births through `createVerificationOTP` and `signInEmailOTP({ body: { email, otp, name } })`;
    - an adopted orphan user is marked verified as today, and holds no password;
    - the seed's answer drops `admin.password`, and `DEMO.password` leaves.
- [X] T009 [P] `canVerifyPerson()` in `apps/admin/src/lib/auth-client.ts`, beside `passkeysSupported()` (research D7):
  - a promise memoized for the page's life, of `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`;
  - `false` when the class or the method is missing, or the call throws;
  - the comment cites D7: why the activation needs more than `window.PublicKeyCredential`.
- [X] T010 [P] Access helpers in `apps/admin/src/features/auth/session.ts` (research D1, D11):
  - `sendCode(email)` → `baPost("/auth/email-otp/send-verification-otp", { email, type: "sign-in" })`;
  - `signInWithCode(email, otp, name?)` → `baPostJson("/auth/sign-in/email-otp", { email, otp, …(name ? { name } : {}) })`, returning `{ user }`;
  - `updateName(name)` → `baPost("/auth/update-user", { name })`;
  - `revokeOtherSessions()` → `baPost("/auth/revoke-other-sessions")`.

  The password helpers stay until T036 and T046 remove them.
- [X] T011 [P] `CodeInput` in `packages/ui/src/components/code-input.tsx`, with `packages/ui/test/code-input.test.tsx` (research D12):
  - a labelled input with `inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength={6}`;
  - digits only (a paste of "482 913" becomes "482913");
  - standard 48 px from the input's `size` variants;
  - the digits in the mono face the product keeps for folios and keys (`font-mono`), with `tracking-widest`, so the six digits read one by one (the design canvas);
  - tokens only.

  The test covers the filtering, the label and axe.
- [X] T012 [P] `PasskeyOffer` in `packages/ui/src/components/passkey-offer.tsx`, with `packages/ui/test/passkey-offer.test.tsx` (research D7, D12), per `contracts/panel-access.md` § `/welcome` step 2:
  - **Props**: `deviceWord`, `state` (`idle` | `busy` | `done` | `failed` | `alreadyEnrolled`), `onActivate`, `onSkip`.
  - **It renders**:
    - the title "Entra la próxima vez con tu huella o rostro";
    - FR-008's four lines, with the device word;
    - "Activar huella o rostro" at the decisive 64 px size, with the `Fingerprint` icon, the waiting label "Esperando a tu dispositivo." inside `<Pending>`;
    - "Ahora no";
    - the failure line "No se pudo activar. Intenta de nuevo o elige «Ahora no»." for `failed`;
    - "Este dispositivo ya tiene tu huella o rostro." for `alreadyEnrolled`;
    - "Listo." for `done`.
  - The test covers each state, that `onActivate` runs in the click handler, and axe.
- [X] T013 [P] `KeysCard` in `packages/ui/src/components/keys-card.tsx`, with `packages/ui/test/keys-card.test.tsx` (research D11, D12), per `contracts/panel-access.md` § Seguridad:
  - **Props**: `keys` (name, createdAt, backedUp), `loading`, `deviceWord`, `canActivate`, `onRemove(id)`, `onActivate`, `stepUp` (`null`, or `{ email, onSubmit(code), error }`), `onSignOutOthers`, and the result states.
  - **It renders**:
    - the list: name or "Llave de acceso", "Activada el {fecha}", "sincronizada con tu llavero", and a "Quitar" with an accessible name per key;
    - the empty line;
    - "Activar en {deviceWord}" ("Activar en este dispositivo" in the panel) only when `canActivate`, and its failure line "No se pudo activar. Intenta de nuevo.";
    - the step-up's line "Confirma que eres tú: te enviamos un código a {email}." with `CodeInput`, "Confirmar", and "Cancelar", which closes the step-up;
    - "Cerrar sesión en los demás dispositivos" and its done line "Listo. Solo este dispositivo sigue con tu sesión abierta.".
  - **It never mentions a password.**
  - The test covers the list, the empty state, the step-up, both actions, and axe.
- [X] T014 Export `CodeInput`, `PasskeyOffer` and `KeysCard` from `packages/ui/src/index.ts`, and show each in `packages/ui/src/playground/Showcase.tsx` in both themes (depends on T011–T013).
- [X] T015 MSW handlers in `apps/admin/test/msw.ts` for Better Auth's access endpoints, in Better Auth's own shapes (envelope-exempt, as `baPost` expects):
  - `POST /auth/email-otp/send-verification-otp` → `{ success: true }`;
  - `POST /auth/sign-in/email-otp` → `{ token, user }`, plus an `INVALID_OTP` variant;
  - `POST /auth/update-user` → `{ status: true }`;
  - `POST /auth/revoke-other-sessions` → `{ status: true }`.

  The password handlers stay until T053.
- [X] T077 Keep the store side green through PR 1 (analysis I1), in `apps/api/test/cash-at-stores-access.test.ts` and `tests/passkey/red.spec.ts`. PR 1 closes three things the store-side tests lean on, and the passkey layer gates the deploy to dev:
  - **T005 hashes the códigos**, so `lastCodeFor` reads nothing. The three store cases that read one (lines 237, 256 and 315 on 2026-10-02) take it from `sentCode`. `lastCodeFor` itself leaves `helpers.ts` with T029, which rewrites its last reader, instead of in T057;
  - **T021 closes `/auth/sign-up/email`.** The `username` refusals sent there (lines 61–73) move to `/sign-in/email-otp` and `/update-user`, which stay open. T016 asserts the 404;
  - **T034 closes `/auth/sign-in/email`, and T008 seeds the demo without a password and retires `/dev/last-code`.** In `red.spec.ts`, the operator gets in with `POST /dev/code` and `sign-in/email-otp` (lines 37–38), and the shopkeeper's verification código comes from `POST /dev/code {type: "email-verification"}` (line 58).

  The store app does not change in PR 1. The two test files keep their citations and add `passwordless-access US2`. Depends on T005, T007 and T008.

**Checkpoint**: the foundation is ready. The código email reads the new way;
nothing else a person sees has changed, and the store side's tests are green
again (T077).

---

## Phase 3: User Story 1 - Register with a código, then the fingerprint or face (Priority: P1) 🎯 MVP

**Goal**: "Crear cuenta" asks a name and an email, a código opens the
account, and a device that can verify the person activates its key at once.
No password exists for the account.

**Independent Test**: in a browser with a virtual authenticator, register a
new address: name and email, the código, the device's confirmation. Land in
the wizard. Seguridad lists one key and the account holds no password. Sign
out, then sign in with the key alone.

### Tests for User Story 1

- [X] T016 [P] [US1] API tests in `apps/api/test/passwordless-registration.test.ts`, citing `passwordless-access US1`, against `contracts/panel-access.md`. Cover:
  - **the registration**:
    - `send-verification-otp {type: "sign-in"}` answers 200;
    - `sentCode`, then `sign-in/email-otp {email, otp, name}` answers 200 with a session cookie (`sessionOf`);
    - the user is `email_verified = 1` with the name, and has **no `account` row**;
  - **nothing before the código**: after the request alone, no `user` row exists for the address (FR-004);
  - **a taken address** answers the same 200. Its código opens the existing account, and the name stays as it was (FR-005);
  - **the terms (FR-003)**:
    - a código whose `expires_at` is moved into the past answers `OTP_EXPIRED`;
    - after three wrong tries, the right one answers `TOO_MANY_ATTEMPTS`;
    - código A, then B: A is refused while B is live, and still refused after B is used (T005's hook);
  - **the stored value** has the shape `<base64url>:<tries>` and does not contain the código (FR-025);
  - **retired doors**: `POST /auth/sign-up/email` and `POST /auth/business/signup` answer 404.
- [X] T017 [P] [US1] The email in `apps/api/test/passwordless-email.test.ts`, citing `passwordless-access US1`. Call `sendAuthCode` with a test `RESEND_API_KEY`, intercepting `https://api.resend.com` with `fetchMock`:
  - the subject and the HTML carry the six digits;
  - the HTML says "Vence en 10 minutos.";
  - the HTML has **no `href` and no `http`** (FR-024).

  Without a key, the log line is exactly `[código:sign-in] <email> → <digits>`: the contract `sentCode` reads.
- [X] T018 [P] [US1] Component tests in `apps/admin/test/registration.test.tsx`, citing `passwordless-access US1`, with MSW and axe, against `contracts/panel-access.md` § `/signup`:
  - **step 1**: "Tu nombre" and "Correo", each problem named under its field before any request. "Continuar" posts `send-verification-otp` with `{ email, type: "sign-in" }`;
  - **step 2**:
    - it names the address and says "Vence en 10 minutos.";
    - "Crear cuenta" waits for six digits, then posts `sign-in/email-otp` with `{ email, otp, name }`;
    - `INVALID_OTP` shows "El código no es válido o ya venció. Reenvíalo e intenta otra vez.";
    - "Reenviar código" turns into "Código reenviado";
    - "Usar otro correo" returns to step 1 with the address kept;
  - **too many tries** (FR-027): a 429 on either step shows "Demasiados intentos. Espera un momento e intenta de nuevo.";
  - **what never appears**: no password field anywhere, no "Ya existe una cuenta", and a description that names no business type (FR-030);
  - **success** navigates to `/welcome?next=…`, keeping a validated `next`.
- [X] T019 [P] [US1] Component tests in `apps/admin/test/welcome.test.tsx`, citing `passwordless-access US1`, with MSW and axe. Mock `@/lib/auth-client` (`canVerifyPerson`, `authClient.passkey.addPasskey`). Cover:
  - **a nameless user**: "¿Cómo te llamas?" posts `update-user { name }`, then the offer when `canVerifyPerson()` is true;
  - **when `canVerifyPerson()` is false**, it navigates to `next` without painting the offer;
  - **the offer**:
    - its four lines;
    - "Ahora no" goes to `next`;
    - a successful ceremony shows "Listo." and goes on;
    - `NotAllowedError` shows the failure line with both buttons;
    - `InvalidStateError` shows "Este dispositivo ya tiene tu huella o rostro." and goes on;
  - **no session** sends to `/login?next=…`. An absolute `next` is dropped (better-auth D12);
  - **the nameless guard** (T026): the shell and the wizard send a session whose user has no name to `/welcome?next=<path>`, once.
- [X] T020 [US1] The owner's half of `tests/passkey/identity-journey.spec.ts`, citing `passwordless-access US1`, against the real API:
  - give the context a virtual authenticator: `internal` transport, `hasResidentKey`, `hasUserVerification`, `isUserVerified`;
  - at `/signup`, register `owner-<stamp>@journey.invalid` and read its código with `POST /dev/code`;
  - type it, then on `/welcome` press "Activar huella o rostro";
  - the wizard follows, then the CLABE and the invitation, as today.

  The invitee's half is T044.

### Implementation for User Story 1

- [X] T021 [P] [US1] `disabledPaths` gains `/sign-up/email` in `apps/api/src/auth/better.ts` (research D4, PR 1), with a comment citing D4: no password can be created over HTTP.
- [X] T022 [P] [US1] Remove `POST /auth/business/signup` from `apps/api/src/routes/auth.ts` (research D1): the route, `signupInput`, `removeUser` and their better-auth D15/D16 comments.
  - **Delete `apps/api/test/isp-signup.test.ts`.** Its cases live in T016; the password cases leave with the password.
  - **Adapt the one case in `apps/api/test/cash-at-stores-access.test.ts`** that registers a shopkeeper's address through that route. It becomes: the panel's registration of that address opens the store's account by código, and `/auth/me` answers the store branch, which the panel refuses (cash-at-stores D2).
- [X] T023 [US1] `SignupPage` in two steps in `apps/admin/src/features/auth/pages.tsx` (research D6), per `contracts/panel-access.md` § `/signup`:
  - **step 1**:
    - name and email, with the identity round's field problems;
    - "Continuar", wrapped in `<Pending label="Enviando el código.">`;
  - **step 2**: `CodeInput` (from `@devolada/ui`), "Crear cuenta", "Reenviar código" and "Usar otro correo";
  - **a 429** on either step shows "Demasiados intentos. Espera un momento e intenta de nuevo." (FR-027);
  - **the name** stays in component state until `signInWithCode(email, otp, name)`;
  - **success**: `queryClient.clear()`, then navigate to `/welcome` with the validated `next`.

  Remove the password field and its rule. The description is the login's "Cobra por transferencia con validación automática." (FR-030).
- [X] T024 [US1] `WelcomePage` in `apps/admin/src/features/auth/pages.tsx` (research D6, D7), per `contracts/panel-access.md` § `/welcome`:
  - **a session is required** (`useUser`); without one, go to `/login?next=…`;
  - **it decides before painting**:
    - if the name is empty, it asks for it (`updateName`), then goes on;
    - if `await canVerifyPerson()`, it shows `PasskeyOffer`;
    - otherwise it navigates;
  - **the ceremony** runs inside the click (`authClient.passkey.addPasskey()`). `InvalidStateError` maps to `alreadyEnrolled` and `NotAllowedError` to `failed`;
  - **it navigates** to the validated `next`, or `/`.

  Comments cite D6, D7 and the order D1 makes load-bearing: a key made before the name shows the account picker a random id.
- [X] T025 [US1] Routes in `apps/admin/src/router.tsx` (research D6):
  - `/welcome` with `nextSearch`;
  - `/verify-email` becomes a `<Navigate to="/login" search={{ next }} />`: the validated `next` travels, the address does not (D6: never in a URL);
  - remove `VerifyEmailPage` from `apps/admin/src/features/auth/pages.tsx`.
- [X] T026 [US1] The nameless guard (research D6), in `apps/admin/src/features/shell/Shell.tsx` and `apps/admin/src/features/onboarding/NewBusinessScreen.tsx`. A session whose user's name is empty is sent to `/welcome?next=<path>`:
  - **imperatively and once**, as the shell's login bounce is (better-auth D12's lesson: `<Navigate>` re-navigates on every render);
  - **in both places**, because a person born through the sign-in door has no business yet, so the wizard is where they land.

**Checkpoint**: a new person registers without a password and activates a
key. T016–T020 pass.

---

## Phase 4: User Story 2 - Sign in without a password (Priority: P1)

**Goal**: "Entrar con huella o rostro" with one touch, or a código by email.
The password door is closed, and the passwords that exist are erased.

**Independent Test**: with an account that holds a key, sign in with the key,
typing nothing. With one that holds none, sign in by código and see the
activation offered. `POST /auth/sign-in/email` answers 404. The sweep has
erased every panel password.

### Tests for User Story 2

- [X] T027 [P] [US2] API tests in `apps/api/test/passwordless-sign-in.test.ts`, citing `passwordless-access US2`:
  - **an existing account**: a sign-in código opens a session;
  - **an unknown address**: the request answers the same 200, and the código creates a user with `name = ""` (FR-013);
  - **`POST /auth/sign-in/email`** answers 404;
  - **a legacy account**, seeded unverified with a `credential` row and a session, signs in by código. It ends verified, and its `credential` row and its old session are gone (D1, `revokeUnprovenAccountAccess`).
- [X] T028 [P] [US2] API tests in `apps/api/test/passwordless-sweep.test.ts`, citing `passwordless-access US2`, for `eraseLegacyCredentials` (FR-029, research D5):
  - **deleted**: a panel user's `credential` row;
  - **kept**: a store user's `credential` row (PR 1);
  - **deleted with their sessions and accounts**: unverified users with no store and no membership;
  - **kept**: an unverified store user, an unverified user holding a membership, and an unverified user a row of ours names (a `top_ups.submitted_by_user_id`). The same run still erases a panel user's `credential` row (analysis U1);
  - **the report**: it counts both kinds; `console.log` is called only when something was deleted, and a second run deletes nothing.
- [X] T029 [P] [US2] Rewrite `apps/api/test/sessions.test.ts` to sign in by código (`mintCode` + `sign-in/email-otp`) wherever it signed in with a password, and add the citation `passwordless-access US2`:
  - **keep**: the unverified cookie revoked, the sliding cookie (BUG-015), the tampered cookie, suspension, sign-out;
  - **remove**: wrong password 401, unknown email 401, and "a reset revokes live sessions". The last one is replaced by T047's `revoke-other-sessions` case;
  - **then remove `lastCodeFor`** from `apps/api/test/helpers.ts`: this file was its last reader (T022 deletes `isp-signup`, T077 moves the store cases to `sentCode`).
- [X] T030 [P] [US2] Rewrite `apps/api/test/rate-limit.test.ts`, citing `passwordless-access US2`, with the limiter armed (`armed()`):
  - the fourth `send-verification-otp` within 60 s answers 429 with `X-Retry-After`, and its row key ends `|/email-otp/send-verification-otp`;
  - the sixth `sign-in/email-otp` within 60 s answers 429 (D3);
  - `AUTH_RATE_LIMIT=off` disarms both.

  Every `/auth/sign-in/email` case leaves.
- [X] T031 [P] [US2] Rewrite `apps/api/test/dev-seed.test.ts`, citing `passwordless-access US2`:
  - **the seed**: `/dev/seed` creates the demo users verified, with no `account` row, and its answer carries no password;
  - **the demo signs in** with `POST /dev/code` and `sign-in/email-otp`;
  - **`/dev/code`**:
    - it refuses `ana@negocio.mx`, and a blank address, with 403 `TEST_ADDRESS_ONLY`;
    - it mints for `x@journey.invalid` and for `demo@devolada.app`, and that código works once;
  - **retired**: `GET /dev/last-code` answers 404;
  - **outside `ENVIRONMENT=dev`**, `/dev/code` answers 404;
  - **`apps/api/test/dev-code-readable.test.ts`** (PR #273): its `/dev/last-code` cases move to `/dev/code`, and its `/dev/last-invitation` case stays. It keeps `bug: dev-code-readable` and adds `passwordless-access US2`.

  The orphan-keeps-its-password case becomes: an adopted orphan is verified and holds no password.
- [X] T032 [P] [US2] Component tests in `apps/admin/test/sign-in.test.tsx`, citing `passwordless-access US2`, with MSW and axe, against `contracts/panel-access.md` § `/login`:
  - **step 1**:
    - no line about passwords: nothing on the screen matches `/contraseña/i` (spec Clarifications, Q4);
    - "Entrar con huella o rostro" only where `PublicKeyCredential` exists;
    - a failed key shows "No pudimos usar tu huella o rostro. Entra con un código.";
    - "Crear cuenta" keeps `next`;
  - **step 2**: as signup's, with "Entrar". A código goes to `/welcome?next=…`, a key to `next`;
  - **too many tries** (FR-027): a 429 shows "Demasiados intentos. Espera un momento e intenta de nuevo.";
  - **redirects**: `/recover` and `/verify-email` land on `/login` with `next`, and no address in the URL (D6).

  In `apps/admin/test/shell.test.tsx`, remove the cases moved here and to T018–T019: the password login, the signup, `/verify-email`, the unverified login, `/recover`. Keep the guard with `next`, the dropped absolute `next`, and the suspended screen's way out. In `apps/admin/test/access.test.tsx`, the login copy check follows the new copy.
- [X] T033 [US2] Rewrite `tests/passkey/passkey.spec.ts`, citing `passwordless-access US2`:
  - run `/dev/seed`, then at `/login` press "Enviar código" for the demo address;
  - get the código from `POST /dev/code` and type it;
  - activate on `/welcome` with the virtual authenticator;
  - Cuenta → Seguridad lists the key;
  - sign out from the Sesión card, then sign in with "Entrar con huella o rostro" alone;
  - **a removed key stops at once** (FR-023, analysis G2): "Quitar" it in Seguridad and sign out. "Entrar con huella o rostro" then fails with "No pudimos usar tu huella o rostro. Entra con un código.", and the código still opens the account.

### Implementation for User Story 2

- [X] T034 [P] [US2] `disabledPaths` gains `/sign-in/email` in `apps/api/src/auth/better.ts` (research D4, PR 1). `emailAndPassword` stays enabled, and the comment says why: the store app's `/sign-in/username` and recovery until PR 2.
- [X] T035 [P] [US2] `eraseLegacyCredentials(env, now = new Date())` in a new `apps/api/src/auth/credentials-sweep.ts` (research D5):
  - **two deletions, each on its own** (analysis U1), so a user the sweep cannot delete never stops the erase of passwords:
    1. `credential` rows of users that no `stores.user_id` names (PR 1's filter, with a comment saying T064 removes it);
    2. unverified users that **no row names**: no store, no `member` row, and none of the user columns research D5 lists. Their `session`, `account` and `passkey` rows go first, in one D1 batch with the users;
  - **the report**: `{ credentials, users }`.

  In `apps/api/src/index.ts`, `scheduled` gains its own `ctx.waitUntil` lane that logs `credential erase:` only when either count is above zero. Comments cite D5: a sweep and not a migration, and the guarantee it keeps.
- [X] T036 [P] [US2] `LoginPage` in two steps in `apps/admin/src/features/auth/pages.tsx` (research D6), per `contracts/panel-access.md` § `/login`:
  - **step 1**:
    - "Entrar con huella o rostro" first, `passkeysSupported()` only (`authClient.signIn.passkey()`, then `next`);
    - the separator "o con un código" where the key shows, then email and "Enviar código";
  - **step 2**: `CodeInput`, "Entrar", the resend and "Usar otro correo". Success goes to `/welcome?next=…`;
  - **a 429** on either step shows "Demasiados intentos. Espera un momento e intenta de nuevo." (FR-027);
  - **removals**:
    - `RecoverPage`, and the `EMAIL_NOT_VERIFIED` branch;
    - in `apps/admin/src/router.tsx`, `/recover` becomes a redirect to `/login` keeping `next` (D6: the address never travels in a URL);
    - from `apps/admin/src/features/auth/session.ts`: `signup`, `sendVerificationCode`, `verifyEmailCode`, `requestPasswordReset`, `resetPasswordWithCode`.
  - **`login` stays until T046**: the invitation page calls it until then.

**Checkpoint**: nobody in the panel types a password; every panel password
is gone after the sweep's first run. T016–T033 pass.

---

## Phase 5: User Story 3 - A device without fingerprint or face (Priority: P1)

**Goal**: on a device without passkey support, the código alone is a whole
way in. No offer, no button, no mention of the fingerprint or face.

**Independent Test**: in a browser without passkey support, register and sign
in with códigos only. On a computer that knows passkeys but cannot verify the
person, the sign-in button shows and the activation never opens by itself.

### Tests for User Story 3

- [X] T037 [P] [US3] Component tests in `apps/admin/test/no-passkey.test.tsx`, citing `passwordless-access US3`, with MSW and axe:
  - **`window.PublicKeyCredential` deleted**:
    - registration goes from the código straight to the wizard, with no offer;
    - `/login` has no key button;
    - no text on these screens matches `/huella|rostro/i` (FR-015);
  - **`PublicKeyCredential` present, `canVerifyPerson()` false**: `/login` shows the key button, and `/welcome` skips the offer (FR-016).
- [X] T038 [US3] Add a case to `apps/api/test/passwordless-sign-in.test.ts`, after T027, citing `passwordless-access US3`: an account with a `passkey` row signs in by código all the same (FR-015, scenario 3).

### Implementation for User Story 3

No new code. The fallback is the absence of US1's and US2's offers:
- `canVerifyPerson()` gates the activation (T024);
- `passkeysSupported()` gates the button (T036).

T037 and T038 prove it, and the browser layer's no-passkey states (T051)
measure it.

**Checkpoint**: a device without passkey support gets in with códigos, and
nothing on screen promises otherwise.

---

## Phase 6: User Story 4 - Join a business from an invitation with the fingerprint or face (Priority: P2)

**Goal**: the invitation page asks for no password:
- **an account and a key on this device** join with one touch;
- **an account without a key** joins by código;
- **a new person** gives a name and a key.

**Independent Test**: invite an address whose account holds a key, open the
invitation without a session, sign in with the key, and land in the business
with the invited role. Invite an address without an account: the name, the
device's confirmation, inside. No código, no password.

### Tests for User Story 4

- [X] T039 [P] [US4] API tests in `apps/api/test/passwordless-invitation.test.ts`, citing `passwordless-access US4`, against `contracts/panel-access.md` § `accept-new`:
  - **`accept-new { name }`** answers 201 with the actor:
    - the user is born verified, with the name and no `account` row;
    - a `member` row carries the invited role;
    - the active organization is set, and the session cookie is in the answer;
  - **a stray código**: a live sign-in código already stored for the address does not break it (D9, step 1);
  - **refusals**: an address with an account is 409 `EMAIL_TAKEN`; expired and gone are 404 `INVITATION_NOT_FOUND`;
  - **a body carrying `password`**: it is ignored, and no `account` row is written.
- [X] T040 [P] [US4] Rewrite `apps/api/test/identity-round.test.ts`, adding the citation `passwordless-access US4`:
  - **accept-new** sends `{ name }`;
  - **"the sixth signup in a minute"** leaves; its limit is T030's;
  - **"signup writes one código"** becomes "a registration request writes one `sign-in-otp-<email>` row, hashed";
  - **unchanged**: "no código left for an invitee born through accept-new".
- [X] T041 [P] [US4] Rewrite `apps/api/test/invitee-lands-own-business.test.ts`, adding the citation `passwordless-access US4`:
  - the signup becomes `send-verification-otp` + `sign-in/email-otp` with `sentCode`;
  - the inline read of the `verification` table leaves.
- [X] T042 [P] [US4] Rewrite the invitation-page cases of `apps/admin/test/memberships.test.tsx`, adding the citation `passwordless-access US4`, against `contracts/panel-access.md` § `/invitaciones/:invitationId`:
  - **no session, an account**:
    - "Correo: {email}" as text;
    - "Entrar con huella o rostro" where supported;
    - "Enviarme un código" opens `CodeInput`, then accepts and goes to `/welcome?next=/`;
    - no password field and no "Olvidé mi contraseña";
  - **a key of another account** shows the "otro correo" state with its switch;
  - **no account**: "Tu nombre" leads to `accept-new` with a body of `{ name }` only, then `/welcome?next=/`;
  - **without passkey support**: the código, or the name, only (FR-015);
  - **too many tries** (FR-027): a 429 on "Enviarme un código" or "Entrar" shows "Demasiados intentos. Espera un momento e intenta de nuevo.";
  - **expired and gone** are unchanged.
- [X] T043 [P] [US4] Rewrite `apps/admin/test/invitee-lands-own-business.test.tsx`, keeping `bug: invitee-lands-own-business` and adding `passwordless-access US4`:
  - "recovery from the invitation page comes back to it" becomes "the código on the invitation page keeps the invitee there: it accepts and lands in the invited business";
  - the login page has no recovery link;
  - the invitations named in the shell, the wizard and the chooser are unchanged.
- [X] T044 [US4] The invitee's half of `tests/passkey/identity-journey.spec.ts`, after T020, citing `passwordless-access US4`:
  - **the new invitee**:
    - `/dev/last-invitation` gives the link for `ana-<stamp>@journey.invalid`;
    - in a fresh context with its own virtual authenticator: "Tu nombre", "Crear cuenta y entrar", then the activation on `/welcome`;
    - inside the business with the role;
    - then, as today, the owner changes the role and removes the member, and the member's next request is a revoked membership;
  - **a second invitation**, to an account that holds a key, is accepted with "Entrar con huella o rostro" on the page.

### Implementation for User Story 4

- [X] T045 [US4] The passwordless `accept-new` in `apps/api/src/routes/businesses/schema.ts` and `handler.ts` (research D9):
  - **The schema**, in `apps/api/src/routes/businesses/schema.ts`: `acceptInvitationNewRequest = z.object({ name: z.string().trim().min(2).max(80) })`.
  - **The handler**, in `apps/api/src/routes/businesses/handler.ts`. `acceptInvitationAsNewUser` follows D9's steps:
    1. check the invitation;
    2. refuse an address that has an account;
    3. delete the `sign-in-otp-<email>` rows;
    4. `createVerificationOTP`, then `signInEmailOTP({ body: { email, otp, name }, returnHeaders: true })`;
    5. `acceptInvitation` and `setActiveOrganization` with those cookies;
    6. forward the cookies.
  - **Removed**: the `signUpEmail` and `signInEmail` calls, and the manual `emailVerified` update.
  - **Comments** cite D9: the invitation proves the inbox, and minting goes through the plugin's own door.
- [X] T046 [US4] `apps/admin/src/features/invitations/AcceptInvitationScreen.tsx` (research D9), per `contracts/panel-access.md` § `/invitaciones/:invitationId`:
  - **"Entrar con huella o rostro"** calls `authClient.signIn.passkey()`, then invalidates `["user"]`. The page's same-address and other-address logic takes it from there;
  - **"Enviarme un código"** is `sendCode(inv.email)`, then `CodeInput`, then `signInWithCode(inv.email, otp)`, then `acceptInvitation` and `setActiveBusiness`, then `/welcome?next=/`;
  - **the separator** "o con un código" sits between the key and "Enviarme un código", where the key shows;
  - **no account**: the name, then `acceptInvitationAsNewUser(invitationId, { name })`, then `/welcome?next=/`;
  - **a 429** shows "Demasiados intentos. Espera un momento e intenta de nuevo." (FR-027);
  - **removed**: the password fields, the recovery link and the `login` import.

  In `apps/admin/src/features/auth/session.ts`, remove `login`. `acceptInvitationAsNewUser`'s body follows the new schema type.

**Checkpoint**: the invitation page has no password in any state. T039–T044
pass.

---

## Phase 7: User Story 5 - Keep control of keys and sessions (Priority: P2)

**Goal**: Seguridad lists and removes keys, adds one even on an old session
(after a código), and ends every other session. That is better-auth D17's
guarantee, without a password.

**Independent Test**: with two sessions in two browsers, "Cerrar sesión en
los demás dispositivos" from one signs the other out at its next action.
Remove a key: the código still works.

### Tests for User Story 5

- [X] T047 [P] [US5] API tests in `apps/api/test/passwordless-keys-sessions.test.ts`, citing `passwordless-access US5`:
  - **closing other sessions**: with three sessions, `POST /auth/revoke-other-sessions` from one answers 200. The other two then get 401 on `/auth/me`, and the caller gets 200 (FR-022, M5);
  - **freshness**: `GET /auth/passkey/generate-register-options` on a session whose `created_at` is 25 hours old answers 403 `SESSION_NOT_FRESH`. After a sign-in código (a new session) it answers 200 (D8, M2);
  - **removing a key**: `delete-passkey` removes the row, `list-user-passkeys` no longer lists it, and the account still signs in by código (FR-023).
- [X] T048 [P] [US5] Rewrite the passkey-card cases of `apps/admin/test/session-round.test.tsx` and the identity card's check in `apps/admin/test/account-hub.test.tsx`, citing `passwordless-access US5`:
  - **the card**: `KeysCard`'s list, "Quitar", and the empty state;
  - **the step-up**: "Activar en este dispositivo" meets `SESSION_NOT_FRESH` and runs the step-up. "Confirma que eres tú: te enviamos un código a {email}.", then `CodeInput`, then `signInWithCode`, then the ceremony runs again. "Cancelar" closes it and brings back "Activar en este dispositivo"; a 429 shows the wait line (FR-027);
  - **closing other sessions**: "Cerrar sesión en los demás dispositivos" posts `revoke-other-sessions` and shows its done line;
  - **copy**: no "Tu contraseña sigue funcionando"; the identity card reads "Para cambiar tu nombre, escríbenos. Pronto podrás hacerlo desde aquí." (FR-030); and Cuenta's rail row "Entrar con huella o rostro" reads "Tus llaves y sesiones".

### Implementation for User Story 5

- [X] T049 [US5] `apps/admin/src/features/auth/PasskeyCard.tsx` becomes a container for `KeysCard` (research D8, D11, D12):
  - the list and removal through `baGet`/`baPost`, as today (better-auth D18);
  - **activating**:
    - `canVerifyPerson()` decides `canActivate`;
    - the ceremony is `authClient.passkey.addPasskey()`;
    - on `SESSION_NOT_FRESH`, it shows the step-up: `sendCode(user.email)`, then `signInWithCode`, then the ceremony again. A 429 shows "Demasiados intentos. Espera un momento e intenta de nuevo." (FR-027);
  - **closing other sessions**: `revokeOtherSessions()`.

  The card's copy follows `contracts/panel-access.md` § Seguridad. Comments cite D8 (why a key asks for a recent proof) and D11.
- [X] T050 [P] [US5] Copy in `apps/admin/src/features/account/AccountHub.tsx`:
  - the identity card: "Para cambiar tu nombre, escríbenos. Pronto podrás hacerlo desde aquí." (FR-030);
  - the rail row "Entrar con huella o rostro": its detail "Tus passkeys" becomes "Tus llaves y sesiones", the product's words for what the card holds (the design canvas).

**Checkpoint**: PR 1's five stories are complete. T016–T050 pass.

---

## Phase 8: Polish & Cross-Cutting for PR 1

**Purpose**: what spans the panel's stories, and what PR 1 needs before it
merges.

- [X] T051 [P] The browser layer for the panel, in `tests/e2e/stubs.ts`, `tests/e2e/contrast.spec.ts` and `tests/e2e/responsive.spec.ts` (constitution IV):
  - **Stubs**: `tests/e2e/stubs.ts` stubs Better Auth's access endpoints (`send-verification-otp`, `sign-in/email-otp`, `get-session`, `passkey/list-user-passkeys`) and the invitation preview. Fixtures go through our schemas where the route is ours.
  - **Suites**: `tests/e2e/contrast.spec.ts` and `tests/e2e/responsive.spec.ts` add, in both themes, at 360/768/1280, with touch targets measured:
    - `/login` and `/signup`, both steps;
    - `/welcome`, both steps;
    - the invitation page's states;
    - Seguridad's card;
    - `/login` and `/signup` without passkey support (an init script deletes `PublicKeyCredential`, US3).
- [X] T052 [P] The design captures in `tests/design/review-identity.spec.ts` and `tests/design/review-identidad-2.spec.ts` follow the panel's new screens: the password screens and the `sign-in/email` 401 stub leave.
- [X] T053 [P] Remove the password handlers from `apps/admin/test/msw.ts` (`login`, `signup`, `verifyEmail`, the email-verification `sendCode`, `requestReset`, `resetPassword`) once no test imports them (after T018, T032, T042, T043).
- [X] T054 [P] `CLAUDE.md`: the "Local seed" line drops `devolada123`. The demo signs in with a código, which prints in the API's console without `RESEND_API_KEY` or comes from `POST /dev/code` (research D16).
- [X] T055 The gate before PR 1 merges, following `specs/020-passwordless-access/quickstart.md`:
  1. amendment 1 is applied (T003);
  2. run quickstart §1 in order (`spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint`, typecheck, the four test suites, `pnpm e2e`, `pnpm e2e:passkey`);
  3. walk quickstart §2 locally;
  4. fix what fails, and open PR 1.

  None of it may be skipped or quarantined to get green.

---

## Phase 9: User Story 6 - The shopkeeper gets in without a password (Priority: P2) — PR 2

**Goal**: the store invitation is an email and a código. The store app's
sign-in is the key, or the phone, which sends a código to the store's email.
Caja shuts a lost phone out. No account in Devolada holds a password.

**Independent Test**: accept a store invitation with an email and its
código, activate the key, sign out, and sign in with the key alone. Sign out
again, type the store's phone, and sign in with the código that reaches the
email. The store's account holds no password, and a business member is still
refused by the store app.

- [X] T056 [US6] The gates before PR 2's code, the second one in `.specify/memory/constitution.md`:
  - **the notice**: the creator confirms the operator has told the pilot's shopkeepers that their password stops working and how they will get in (spec Dependencies);
  - **amendment 2**: the creator runs, or asks for, `/speckit-constitution` with the plan's Complexity Tracking row 2.
- [ ] T057 [US6] The PR 2 test helpers in `apps/api/test/store-helpers.ts` and `apps/api/test/helpers.ts` (research D14):
  - in `apps/api/test/store-helpers.ts`, `seedPlainUser` births the user without a password, as T007 did for `seedAuthUser`;
  - remove `PASSWORD` from `apps/api/test/helpers.ts` (`lastCodeFor` left with T029).

  The suites still using them fail until T059 and T060 rewrite them.

### Tests for User Story 6

- [ ] T058 [P] [US6] API tests in `apps/api/test/passwordless-store.test.ts`, citing `passwordless-access US6`, against `contracts/store-access.md`:
  - **the invitation's código**: `POST /store/invitations/:token/code` answers `{ sentTo }` for every address, and `sentCode` holds the código;
  - **accept, a new address**:
    - the user is born verified, named `shopkeeperName`, with `username` = the store's phone and no `account` row;
    - the store is `active` and the invitation `accepted`;
    - the cookie is set;
  - **accept, a taken address** (a user's, or an operator's without an account):
    - `EMAIL_TAKEN` comes only after a right código;
    - a wrong one is `INVALID_OTP`;
    - the invitation stays `sent`;
  - **the race guard**: an address that gains a membership between the check and the sign-in answers `EMAIL_TAKEN`, with no session left and no link written;
  - **leaving before the código** (FR-031, analysis G3): after `POST /store/invitations/:token/code` alone, the store stays `invited` and the invitation `sent`; a second attempt with a new código accepts;
  - **a legacy shopkeeper** (analysis G1), who accepted before the release with a password and never typed the código: `POST /store/sign-in/code` with the phone, then `POST /store/sign-in`, lets them in verified, and the sweep leaves them no password (T064);
  - **the phone door**:
    - `POST /store/sign-in/code` sends to the store's email (`sentCode` on that address);
    - a stranger's phone gets the same answer, and no código is logged;
    - `POST /store/sign-in` sets the cookie;
    - a stranger's phone with any código is `INVALID_OTP`;
    - a suspended store is `STORE_SUSPENDED`, with no session row left;
  - **no account from the store app**: no store route creates a user except the acceptance (FR-034);
  - **retired doors**: `/auth/sign-in/username`, `/auth/email-otp/reset-password` and `/auth/email-otp/verify-email` answer 404;
  - **`/auth/me`**: the store branch carries `email`;
  - **limits**, with the limiter armed: the fourth `/store/sign-in/code` and the sixth `/store/sign-in` within 60 s answer 429.
- [ ] T059 [P] [US6] Rewrite `apps/api/test/cash-at-stores-access.test.ts`, adding the citation `passwordless-access US6`:
  - **keep**:
    - the `username` refusals (`USERNAME_NOT_ALLOWED` on any body);
    - `requireStore`'s gating;
    - `WRONG_ACTOR` for a member;
    - suspension;
  - **remove**: the password acceptance, `sign-in/username`, and the `forget-password` recovery. Their absence is asserted in T058.
- [ ] T060 [P] [US6] In `apps/api/test/cash-at-stores-operator.test.ts`, the acceptance on a replaced token sends `{ email, otp }` and still answers `INVALID_INVITATION`.
- [ ] T061 [P] [US6] Component tests in `apps/red/test/access.test.tsx`, citing `passwordless-access US6`, with handlers in `apps/red/test/msw.ts` for the four store routes and Better Auth's step-up endpoints. The password handlers (`signIn`, `resetPassword`, `verifyEmail`) leave. Mock `@/lib/auth-client`. Against `contracts/store-access.md` § UI:
  - **`/entrar`**:
    - no line about passwords: nothing on the screen matches `/contraseña/i` (spec Clarifications, Q4);
    - the key button where supported;
    - the phone normalised to ten digits;
    - a failed key shows "No se pudo usar tu huella o rostro. Entra con un código." (analysis A4);
    - step 2's line, the same for any phone, and "Reenviar código" confirming with "Código reenviado";
    - then the activation and `/`;
  - **`/invitacion/:token`**: the three steps, the `EMAIL_TAKEN` copy returning to step 1, and the invalid invitation's screen;
  - **`/recuperar`** lands on `/entrar`;
  - **the wrong-account and suspended screens** are unchanged;
  - **too many tries** (FR-027): a 429 on any código request or try shows "Demasiados intentos. Espera un momento e intenta de nuevo.";
  - **Caja's card**: the list, "Quitar", the step-up with `/auth/me`'s email and its "Cancelar", and "Cerrar sesión en los demás dispositivos";
  - axe on each.
- [ ] T062 [US6] Rewrite `tests/passkey/red.spec.ts` from T077's PR 1 version, citing `passwordless-access US6`:
  1. the operator, the demo address, gets in by código from `POST /dev/code` and creates a store;
  2. the invitation opens in a fresh context with a virtual authenticator;
  3. the email `tienda-<stamp>@journey.invalid` and its código from `/dev/code` lead to the activation, then the counter;
  4. sign out, then back in with the key;
  5. sign out, then the phone, with `/dev/code` for the store's email, and you are back in.

### Implementation for User Story 6

- [ ] T063 [US6] PR 2's auth configuration in `apps/api/src/auth/better.ts` (research D4):
  - **turned off**: `emailAndPassword: { enabled: false }`. With it go `requireEmailVerification`, `revokeSessionsOnPasswordReset` and `emailVerification.autoSignInAfterVerification`;
  - **`disabledPaths` gains** `/sign-in/username`, `/email-otp/request-password-reset`, `/email-otp/reset-password`, `/forget-password/email-otp`, `/email-otp/verify-email` and `/email-otp/check-verification-otp`;
  - **removed**: the `customRules` for `verify-email` and `reset-password`;
  - **`USERNAME_INPUT_PATHS`**: its comment says no request may carry a username any more, and only the acceptance writes the column;
  - **`username()` stays**.

  Comments cite D4. The middleware's unverified-session revocation (better-auth D16's belt) is untouched.
- [ ] T064 [P] [US6] Drop PR 1's store filter from `apps/api/src/auth/credentials-sweep.ts` (research D5). Every `credential` row is erased. Update T028's store case in `apps/api/test/passwordless-sweep.test.ts` to expect it erased.
- [ ] T065 [US6] The store routes in `apps/api/src/routes/store/schema.ts`, `handler.ts` and `index.ts` (research D10, D3), per `contracts/store-access.md`:
  - **Schemas**:
    - `storeInvitationCodeRequest { email }`;
    - `acceptStoreInvitationRequest { email, otp }`, where `otp` is six digits;
    - `storeSignInCodeRequest { phone }`;
    - `storeSignInRequest { phone, otp }`;
    - and their responses.
  - **`index.ts`** wires each route with `zValidator` and `rateLimitRoute`: `store-invitation-code` 3/60, `store-invitation-accept` 5/60, `store-sign-in-code` 3/60, `store-sign-in` 5/60.
  - **`acceptInvitation`** follows D10:
    - the taken check with `auth.api.checkVerificationOTP`, then the código row deleted;
    - for a new address, `signInEmailOTP({ body: { email, otp, name: store.shopkeeperName }, returnHeaders: true })`;
    - cash-at-stores T089's batch and D5's rollback;
    - the race guard;
    - forwarded cookies.
  - **The sign-in handlers**:
    - `nationalPhone`, then the user by `username`;
    - `sendVerificationOTP`, or `signInEmailOTP`;
    - `INVALID_OTP` for a phone no store names;
    - `STORE_SUSPENDED` deletes the session it opened.
  - **Comments** cite D10 and D3. The schemas stay exported as `@devolada/api/store-schema`.
- [ ] T066 [US6] `/auth/me`'s store branch gains `email` in `apps/api/src/routes/auth.ts`, and `StoreMeResponse` gains `email` in `apps/api/src/routes/store/schema.ts`, after T065 (research D8).
- [ ] T067 [P] [US6] In `apps/api/src/email/sender.ts`, remove the `email-verification` and `forget-password` templates. An unknown kind falls back to `sign-in` (D13).
- [ ] T068 [P] [US6] `canVerifyPerson()` in `apps/red/src/lib/auth-client.ts`, as T009 (research D7).
- [ ] T069 [US6] `apps/red/src/features/auth/session.ts`:
  - **new**: `sendInvitationCode(token, email)`, `acceptInvitation(token, email, otp)`, `sendSignInCode(phone)`, `signInWithCode(phone, otp)`;
  - **the step-up** through Better Auth's `send-verification-otp` and `sign-in/email-otp`, with `/auth/me`'s email;
  - **new**: `revokeOtherSessions()`;
  - **removed**: `signIn` (username), `sendCode`, `verifyEmail`, `resetPassword`.
- [ ] T070 [US6] `apps/red/src/features/auth/InvitationScreen.tsx` in three steps (research D10), per `contracts/store-access.md` § `/invitacion/:token`:
  1. **the email**;
  2. **the código**: `EMAIL_TAKEN` returns to step 1 with its line; `INVALID_INVITATION` shows the invalid screen;
  3. **`PasskeyOffer`**, where `canVerifyPerson()`: `addPasskey({ name: "Tienda" })` inside the click, with the device word from `useWide()`; then `/`.

  In step 2, "Reenviar código" confirms with "Código reenviado", as the panel's (the design canvas). A 429 on either step shows "Demasiados intentos. Espera un momento e intenta de nuevo." (FR-027).
- [ ] T071 [US6] `apps/red/src/features/auth/LoginScreen.tsx` (research D10), per `contracts/store-access.md` § `/entrar`:
  - **step 1**: the key button and its failure line "No se pudo usar tu huella o rostro. Entra con un código." (analysis A4), the separator "o con un código", the phone through `nationalPhone`, and "Enviar código";
  - **step 2**: the same-for-every-phone line, `CodeInput`, the resend (it confirms with "Código reenviado"), and "Usar otro teléfono";
  - **a 429** on either step shows "Demasiados intentos. Espera un momento e intenta de nuevo." (FR-027), in place of today's "Demasiados intentos. Espera un momento.";
  - **step 3**: the activation, then `/`.

  Remove `VerifyStep` and every password field.
- [ ] T072 [US6] In `apps/red/src/router.tsx`, `/recuperar` redirects to `/entrar`. Delete `apps/red/src/features/auth/RecoverScreen.tsx`.
- [ ] T073 [US6] `apps/red/src/features/auth/PasskeyCard.tsx` becomes a container for `KeysCard` (research D8, D11, D12; FR-036):
  - the list (`list-user-passkeys`) and "Quitar" (`delete-passkey`);
  - activation with the step-up on `SESSION_NOT_FRESH`, using `/auth/me`'s email (a 429 shows the wait line, FR-027);
  - "Cerrar sesión en los demás dispositivos";
  - the device word from `useWide()`.

  The comment replaces cash-at-stores D26's "without its list": the list is now how a lost phone is shut out.

**Checkpoint**: no account in Devolada holds a password. T056–T073 are done,
and their tests pass.

---

## Phase 10: Polish & Cross-Cutting for PR 2

- [ ] T074 [P] The browser layer for the store app, in `tests/e2e/stubs.ts`, `tests/e2e/contrast.spec.ts` and `tests/e2e/responsive.spec.ts`:
  - `tests/e2e/stubs.ts` stubs the four store routes;
  - `tests/e2e/contrast.spec.ts` and `tests/e2e/responsive.spec.ts` wait on `/entrar` for "Enviar código" instead of "Olvidé mi contraseña";
  - both suites add the código step, the invitation's three steps and Caja's card, in both themes, at 360/768/1280 and the 1024 px layout (cash-at-stores D32).
- [ ] T075 [P] `CLAUDE.md`: the store app's line says no account holds a password, and the shopkeeper's código is asked by phone.
- [ ] T076 The gate before PR 2 merges, following `specs/020-passwordless-access/quickstart.md`:
  1. amendment 2 is applied and the notice given (T056);
  2. run quickstart §1 in order;
  3. walk quickstart §3 on a local stack;
  4. fix what fails, and open PR 2.

---

## Phase 11: The adversarial review's fixes (2026-10-02/03)

**Purpose**: an adversarial review of the whole feature (five dimensions,
each finding challenged by a skeptic) confirmed 38 findings. One changed the
design (T086, spec Clarifications Q5); the rest fix what the build got
wrong. The creator chose, on 2026-10-03, one PR for the whole feature: the
split into PR 1 and PR 2 only waited on the notice to the pilot's
shopkeepers (T056), which is given.

- [ ] T078 [US6] `POST /store/sign-in` answers as fast for every phone
  (FR-033, SC-006): a phone no store names still runs the plugin's código
  check against an address nobody could predict, and every refusal waits
  for a floor before it answers. `sendSignInCode` builds the auth instance
  in both branches. Contract updated (`contracts/store-access.md`).
- [ ] T079 [US6] The store acceptance undoes the user it bore on any error
  before the store is linked, not only when the link fails (D10, D5).
- [ ] T080 The sweep's deletes carry their own predicates, so a user
  verified between its read and its delete keeps everything (D5).
- [ ] T081 [US4] `accept-new`'s rejected body answers in the envelope
  (`VALIDATION`), and its test reads the code.
- [ ] T082 [US5] [US6] Both apps' step-up: it opens only once the código
  was sent, and says a failed send, a lost signal and an unknown failure
  as such; the panel's keeps the active business; "Quitar" on the key just
  activated brings "Activar" back. `KeysCard` grows those states.
- [ ] T083 [US6] The store invitation names the fingerprint or face only
  where the device supports it (FR-015).
- [ ] T084 [US1] [US2] [US4] The panel's screens: a name over 80
  characters is named on screen; an address the plugin refuses is named;
  `/welcome` does not send a just-named person back to itself, skips the
  offer on a session older than a day or for a store or suspended account,
  and does not read a failed session read as signed out; the invitation
  page is never stuck after a failed acceptance.
- [ ] T085 The tests the review found vacuous or missing: FR-006 on the
  invitation page, the stored hash's shape, `/dev/code` on a real address
  with `.invalid` inside, the limiters of the two código-checking routes of
  ours, `OTP_EXPIRED` on the store routes, the deferred send, resends that
  must send, the ceremony inside the click, assertions that ran before the
  router rendered, the ui suite's timezone, and the passkey layer's phone
  door racing the deferred send.
- [ ] T086 [US4] The invitee without an account proves the inbox with a
  código (spec Clarifications Q5, FR-019; research D9 as amended;
  `contracts/panel-access.md`): `accept-new {name, otp}` signs in through
  `signInEmailOTP` with the typed código; the page asks for the name, sends
  the código to the invited address, and asks for it; the API, component,
  browser, design and passkey layers follow.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T001 can change T016, T048, T049, T061, T065
  and T073.
- **Foundational (Phase 2)**: after Setup. **Blocks every PR 1 story.**
- **US1 (Phase 3)**: after Phase 2.
- **US2 (Phase 4)**: after Phase 2. Its código step reuses US1's `/welcome`
  (T024–T025).
- **US3 (Phase 5)**: after US1 and US2. It proves their screens without
  passkey support.
- **US4 (Phase 6)**: after Phase 2 and `/welcome` (T024–T025). T046 removes
  `login`, so T036 must not.
- **US5 (Phase 7)**: after Phase 2 only.
- **PR 1 polish (Phase 8)**: after US1–US5. T055 is the merge gate.
- **US6 (Phase 9)**: after PR 1 is merged (the sweep, the first
  `disabledPaths` step, the atoms) and T056.
- **PR 2 polish (Phase 10)**: after US6. T076 is the merge gate.

### User Story Dependencies

- **US1** depends on nothing but Phase 2.
- **US2** reuses `/welcome` from US1. It can be built in parallel, and only
  its código-to-`/welcome` hand-off waits for T025.
- **US3** has no code of its own. It needs US1's and US2's screens to prove.
- **US4** reuses `/welcome` and the access helpers (T010).
- **US5** is independent of US1–US4.
- **US6** reuses the atoms (T011–T014), the código's terms (T005) and the
  email (T006). Its server changes are its own.

### Within Each User Story

- Tests are written first and fail before the implementation.
- API before the screens that call it, where a story has both.
- A shared file is edited in task order: `pages.tsx` (T023 → T024 → T036),
  `better.ts` (T005 → T021 → T034 → T063), `session.ts` (T010 → T036 →
  T046).
- The story passes its own tests before the next one starts.

### Parallel Opportunities

- **Phase 1**: T003 and T004 run beside T001–T002.
- **Phase 2**: T006, T008, T009, T010, T011, T012 and T013 touch different
  files. T014 waits for T011–T013. T005 and T007 can run beside them. T077
  follows T005, T007 and T008.
- **Each story's tests marked [P]** run together.
- **Different files across stories**: US5's T047–T050 can run while US4 is
  built.
- **PR 2's tests** T058–T061 run together. Its implementation splits into API
  (T063–T067) and red (T068–T073).

---

## Parallel Example: User Story 1

```text
# The tests, together:
Task: "API tests in apps/api/test/passwordless-registration.test.ts (T016)"
Task: "The email in apps/api/test/passwordless-email.test.ts (T017)"
Task: "Component tests in apps/admin/test/registration.test.tsx (T018)"
Task: "Component tests in apps/admin/test/welcome.test.tsx (T019)"

# Then the API changes, together, while the screens follow in order:
Task: "disabledPaths gains /sign-up/email in apps/api/src/auth/better.ts (T021)"
Task: "Remove POST /auth/business/signup from apps/api/src/routes/auth.ts (T022)"
# T023 → T024 → T025 → T026 share pages.tsx and the router, in that order.
```

## Parallel Example: User Story 6

```text
# The tests, together:
Task: "API tests in apps/api/test/passwordless-store.test.ts (T058)"
Task: "Rewrite apps/api/test/cash-at-stores-access.test.ts (T059)"
Task: "Update apps/api/test/cash-at-stores-operator.test.ts (T060)"
Task: "Component tests in apps/red/test/access.test.tsx (T061)"

# API and red in two lanes:
Task: "PR 2's auth configuration in apps/api/src/auth/better.ts (T063)"
Task: "canVerifyPerson() in apps/red/src/lib/auth-client.ts (T068)"
```

---

## Implementation Strategy

### The MVP is PR 1 (US1–US5)

The P1 stories (US1–US3) are the heart of it, but they cannot ship alone:
- **US2** closes the panel's password door;
- **the invitation page (US4)** signs existing accounts in with a password
  until it is rebuilt;
- **ending other sessions (US5)** was a password reset's job.

So the smallest change that leaves the panel whole is all five:
1. Phase 1, then Phase 2.
2. US1 → US2 → US3, validating each at its checkpoint.
3. US4 and US5, which can overlap.
4. Phase 8, the browser layer and the gate (T055), then PR 1.

### Then PR 2 (US6)

After the notice and amendment 2 (T056): Phase 9, then Phase 10, then PR 2.
Until PR 2 merges, the store app keeps its phone and password, and PR 1's
sweep leaves store passwords alone.

### One PR per step

Each PR leaves `dev` whole when it merges. Merge to `main` deploys dev, and
a tag deploys prod (CLAUDE.md). Nothing ships from a local machine.

*Amended 2026-10-03*: the creator chose one PR for the whole feature. The
notice was given (T056) before PR 1 was opened, so nothing is left to wait
on, and the review's fixes (Phase 11) touch both halves. PR 1's gate (T055)
stays recorded as run; T076 is the gate of the one PR.

---

## Notes

- [P] tasks touch different files and depend on no incomplete task.
- A `[US<n>]` label is the citation its test files carry
  (`passwordless-access US<n>`).
- Every non-obvious rule cites `passwordless-access D<n>`, and says when a
  reason was measured (`read 2026-10-02 in better-auth@1.6.29's dist`).
- No test is skipped, disabled or quarantined to get green. A failing suite
  after T007 or T057 is expected until its story's rewrite task lands.
- The older specs' quickstarts keep their demo password: they record the
  state their feature shipped in (research D16).
- **FR-028** holds by the `passkey` table's shape, which this feature does
  not change (data-model.md), so no task adds a column to prove it.
- **SC-005** (seven in ten new accounts activate a key) is read after the
  release, from the `passkey` and `user` rows of the first four weeks. No
  task builds a screen for it.
- Commit after each task or logical group. Stop at any checkpoint to
  validate the story.
