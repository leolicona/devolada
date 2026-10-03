# Implementation Plan: Passwordless Access

**Branch**: `claude/spec-020-passwordless-access` (spec directory `020-passwordless-access`) | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/020-passwordless-access/spec.md`

## Summary

The password leaves both apps. A código sent by email proves the address
once. From then on, the device's fingerprint, face or screen lock is the
everyday key. A device that cannot do that still gets in with the código
alone.

The plan builds it from what is already installed (Better Auth 1.6.29 with
its email-OTP, passkey, organization and username plugins), in eight pieces,
each traced to its decisions in [research.md](./research.md):

1. **One door for registration and sign-in** (D1). The email-OTP plugin's
   sign-in: `send-verification-otp` and `sign-in/email-otp`.
   - It sends a código for any address.
   - It creates the account, verified and named, only when the código is
     typed.
   - It opens an existing account without saying it existed.
   Our `POST /auth/business/signup` retires.
2. **The código's terms, written down** (D2, D3). Ten minutes, three tries,
   stored as a SHA-256 hash, and a new request ends the old código (the
   plugin keeps it alive, so a `hooks.before` deletes it). Today it lives the
   library's five minutes and is stored in plain text, against
   constitution V. The plugin's rate rules stay, plus one custom rule and
   the store routes' own limits.
3. **The password doors close in two steps** (D4, D16):
   - **PR 1**: the panel's (`/sign-in/email`, `/sign-up/email`);
   - **PR 2**: the store app's, with `emailAndPassword` off.
   **The passwords that exist are erased by a sweep, not a migration** (D5):
   it rides the every-minute cron, erases the `credential` rows and the
   legacy unverified accounts, speaks only when it deleted something, and
   keeps "zero passwords" true afterwards.
4. **The panel's screens** (D6, D7):
   - `/login` and `/signup` become two-step screens;
   - a new `/welcome` asks a missing name, then offers the key where the
     device can verify the person;
   - `/verify-email` and `/recover` redirect.
   The activation's big button opens the device's window inside its own click
   (Safari's rule).
5. **A key needs a session younger than a day** (D8). Better Auth registers a
   key only on a fresh session. Every offer right after a door is fresh.
   Seguridad's and Caja's "Activar" ask for a código first when the session is
   older. That also fixes a bug live today: the card fails a day after
   signing in.
6. **The invitation pages** (D9, D10):
   - **The member invitation**: a key or a código for an existing account;
     the name alone for a new one. The server mints and consumes a código
     with the plugin's own server-only door, so the account is born verified
     with a session.
   - **The store invitation**: an email and its código.
     A taken address is named only after its código.
   - **The store's sign-in**: by phone. The código goes to the store's email,
     and every phone gets the same answer.
7. **Keys and sessions** (D11, D12):
   - "Cerrar sesión en los demás dispositivos" is Better Auth's
     `revoke-other-sessions`.
   - The keys card, the activation step and the código field become three
     shared atoms in `@devolada/ui`.
   - Caja gains the list the panel has.
8. **Tests and tools** (D14, D15). Hashed códigos end today's way of reading
   them from the database:
   - the API suite takes the código the sender logged, or mints one;
   - the passkey layer's `/dev/last-code` becomes `/dev/code`, which mints
     only for `.invalid` addresses and the seed's demo addresses.
   The hole on the deployed dev API, where any account's código could be
   read (D15), closed ahead of this feature with the same rule
   (`bug: dev-code-readable`, PR #273); `/dev/code` reuses it.

**No schema changes.** The data model changes which rows may exist, not their
shape ([data-model.md](./data-model.md)).

**Two amendments** to the stack table's Auth row, one per PR (Complexity
Tracking). The first is applied (v1.10.0).

**Design**: the canvas «Acceso sin contraseña»
(https://claude.ai/artifact/LtVqw6bLzcD1VuMkFjkv7c, private to the creator)
draws every screen of both UI contracts, interactive, in both themes, from
360 px and at 1280 px, with the design system's own tokens and atoms.

## Technical Context

**Language/Version**: TypeScript 5.7 strict, ESM; Node 22; pnpm 10 workspace

**Primary Dependencies**:
- **API**: Hono 4 + `@hono/zod-validator`, Drizzle (sqlite).
- **Better Auth 1.6.29**:
  - `emailOTP` with `expiresIn: 600`, `allowedAttempts: 3` and
    `storeOTP: "hashed"`;
  - `@better-auth/passkey` 1.6.29, unchanged config (`rpID` per
    environment);
  - `organization`, unchanged;
  - `username`, which stays for the store's phone column.
- **`apps/admin`, `apps/red`**: React 19, TanStack Router + Query, the
  Better Auth client with `passkeyClient` (ceremonies only), and
  `baPost`/`baGet` for Better Auth's plain endpoints.
- **`@devolada/ui`**: three new atoms, `CodeInput`, `PasskeyOffer` and
  `KeysCard`, on lucide (already a dependency).

**Storage**: D1, **no migration**:
- the `account` rows with `provider_id = 'credential'` and the legacy
  unverified panel users are erased by a sweep (D5);
- `verification.value` is written hashed (D2).

R2 and Workers AI are untouched.

**Testing**:
- **API**: Vitest 3 with `vitest-pool-workers`, real D1. Códigos come from
  the sender's log (`sentCode`) or the plugin's `createVerificationOTP`
  (`mintCode`); users are seeded without passwords (D14).
- **Component**: happy-dom + Testing Library + MSW + axe for `apps/admin`,
  `apps/red` and `packages/ui`.
- **Browser**: Playwright + axe in `tests/e2e` for the new screens.
- **Passkey layer**: the three journeys rewritten against a real wrangler
  API, with Chromium's virtual authenticator.

**Target Platform**:
- **Workers**: the API, and the admin's and red's assets Workers.
- **Browsers**: Safari (iOS 16+, macOS), Chrome (Android, desktop), Edge
  with Windows Hello, and Firefox. A desktop with no built-in authenticator
  takes the código path; the sign-in button can still reach a phone.

**Project Type**: web: `apps/api`, `apps/admin`, `apps/red`, `packages/ui`.

**Performance Goals**:
- **SC-001**, registration in under two minutes with the email in 30 s: two
  requests, one ceremony.
- **SC-002**, a key sign-in in under 10 s: two requests, one ceremony.
- **SC-011**, a shopkeeper back by código in under two minutes: two
  requests.
- No hot path is added. The sweep costs two small DELETEs a minute that
  find nothing after the first run.

**Constraints**:
- **No existence leak**: the same answer for every address and phone
  (FR-005, FR-013, FR-033).
- **The click**: a WebAuthn call happens inside a click (D7).
- **Freshness**: key registration needs a session under a day old (D8).
- **Rate limits** (D3).
- **One relying party per environment** (better-auth D7).
- **Cookies**: the session cookie cache stays off (better-auth D5), which
  makes revocation immediate.

**Scale/Scope**:
- Six stories.
- **API**:
  - the email-OTP configuration;
  - `disabledPaths` in two steps;
  - one route removed and one changed;
  - four store routes (PR 2);
  - one dev route replaced;
  - one sweep.
- **Admin**: three access screens reworked, plus `/welcome` and Seguridad.
- **Red**: three access screens and Caja (PR 2).
- **`@devolada/ui`**: three atoms.
- **Tests**: about 20 test files rewritten across the layers (research D16).
- Two PRs and two constitution amendments.

## Constitution Check

*GATE: must pass before Phase 0 research. Re-checked after Phase 1 design.
Checked against v1.9.2 (2026-10-01); re-checked against v1.10.0
(2026-10-02), which applies amendment 1.*

**Result: every gate passes for PR 1.** The stack table's Auth row stopped
describing the product, first for the panel (PR 1) and then for the store app
(PR 2). Governance asks the plan to propose the amendment rather than route
around it: Complexity Tracking proposes it, one text per PR, for
`/speckit-constitution`. Amendment 1 is applied (v1.10.0); amendment 2 waits
for PR 2 (T056).

| Principle | Gate | Status |
| --- | --- | --- |
| I. Spec-driven, decisions cited | Spec → plan → tasks. Every non-obvious rule cites `passwordless-access D<n>`. The decisions this replaces are specified again in the spec's "What this replaces", never edited in the archive: better-auth D2, D7, D14, D16, D17; cash-at-stores FR-009–FR-011, D3, D5, D26 | ✅ |
| II. Money law | No amount is touched | ✅ n/a |
| III. One contract, pure routers | **Changed**: `routes/businesses` (`accept-new {name}`). **New** (PR 2): four `routes/store` routes, each wired in a pure `index.ts` with `zValidator`, logic in `handler.ts`, schemas in `schema.ts` exported as `businesses-schema` and `store-schema`. `routes/auth.ts` loses `business/signup` (PR 1), and its `/auth/me` store branch gains `email` (PR 2, D8); it stays better-auth D6's thin layer before the fall-through. Better Auth's endpoints stay the one envelope exemption (`baPost`). Browser-facing: no `message`, no `retryable` | ✅ |
| IV. Tests on the real runtime | API in workerd with a real D1. A código comes from the sender's log or from the plugin's own server-only door, never from a mocked database (D14). Resend at its origin. Component with MSW and axe. Contrast, targets and scroll in Playwright. The passkey ceremony against a real API | ✅ |
| V. Tenant isolation, authorization by area | No query loses its `business_id` filter. The store actor is still resolved per request (`requireStore`). The phone door never says whether a phone is a store's (cash-at-stores D3). **"A credential the product only ever compares is stored as a SHA-256 hash"**: the código is now (D2); today it is stored in plain text, a gap this plan closes rather than tolerates. Dev-only routes answer 404 outside dev, and `/dev/code` and `/dev/last-invitation` refuse every real address (D14, D15, `bug: dev-code-readable`). CORS unchanged | ✅ |
| VI. Visual foundations | Tokens only. 48 px controls on access pages, 64 px for the activation. Three new atoms in `@devolada/ui`, one definition each (D12). Waiting labels inside `<Pending>`. es-MX, *código* and never "enlace". **"Auth emails carry codes, never links"**: kept. The creator's story asked for a magic link, the conflict was put to them, and they chose the código (spec Clarifications, Q1; FR-024) | ✅ |
| VII. Every test cites its story | `passwordless-access US1`–`US6` | ✅ |
| VIII. Absent configuration degrades | No new binding. No `RESEND_API_KEY` → the código is logged (unchanged). No `PASSKEY_RP_ID` → `localhost` (unchanged). A sweep that finds nothing says nothing | ✅ |
| IX. Core generic, adapters translate | Access is core. No provider and no adapter is touched | ✅ n/a |
| **Stack table, Auth row** | v1.9.2 said "Better Auth 1.6: email + password with OTP verification, passkeys …, `username` plugin for the shopkeeper's phone sign-in". v1.10.0 (amendment 1) says the panel holds no password, and the store keeps its phone and password until User Story 6. After PR 2 nobody has a password, and the phone signs nothing in | ✅ **PR 1** (amendment 1, v1.10.0) · ⚠️ **PR 2**: amendment 2 (T056) |
| Migrations additive | None. The erasure is a sweep because a deleting migration would break the dev Worker during a PR's preview (D5) | ✅ |
| One Worker trigger | `eraseLegacyCredentials` is one more `waitUntil` lane of the every-minute cron, and logs only when it deleted something (D5) | ✅ |
| Quality gates | Unchanged order. `pending-lint` and `contrast-lint` read the same folders. `packages/ui` runs its own tests | ✅ |

**Re-check after Phase 1 design**: unchanged. The data model needs no
migration. The contracts add routes only inside existing areas, with their
schemas exported. The quickstart's measurements (M1–M6) each have a stated
fallback that changes no gate. The Auth row was the one gate blocked:
amendment 1 cleared it for PR 1 (v1.10.0), and amendment 2 covers PR 2.

## Project Structure

### Documentation (this feature)

```text
specs/020-passwordless-access/
├── spec.md
├── plan.md              # this file
├── research.md          # D1–D16, M1–M6
├── data-model.md        # no migration; which rows may exist
├── quickstart.md        # §0 measurements, §1 CI, §2 the panel walk, §3 the store walk
├── contracts/
│   ├── panel-access.md  # Better Auth endpoints used and disabled; accept-new; /dev/code; the panel's UI contract
│   ├── store-access.md  # the four store routes; /auth/me's email; the store app's UI contract (PR 2)
│   └── codigo-email.md  # the one código template; no link
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks — not created here
```

### Source Code (repository root)

```text
apps/api/
├── src/auth/better.ts                    # emailOTP: expiresIn 600, allowedAttempts 3, storeOTP "hashed";
│                                         #   hooks.before deletes an address's old códigos on a new request (D2);
│                                         #   customRules["/sign-in/email-otp"] 5/60 (D3); disabledPaths PR 1 → PR 2 (D4);
│                                         #   emailAndPassword off (PR 2); verify-email and reset-password rules leave (PR 2)
├── src/auth/credentials-sweep.ts         # new: eraseLegacyCredentials (D5); skips store users until PR 2
├── src/index.ts                          # the sweep's own waitUntil lane (D5)
├── src/email/sender.ts                   # "sign-in": "Vence en 10 minutos", no link (D13); the other two templates leave in PR 2
├── src/routes/auth.ts                    # POST /auth/business/signup removed (D1); /auth/me's store branch gains email (PR 2, D8)
├── src/routes/businesses/handler.ts      # acceptInvitationAsNewUser: name only; mint + consume a código (D9)
├── src/routes/businesses/schema.ts       # acceptInvitationNewRequest loses password
├── src/routes/store/{index,handler,schema}.ts   # PR 2: invitations/:token/code, accept {email, otp},
│                                                #   sign-in/code, sign-in (D10); rateLimitRoute on each (D3)
├── src/routes/dev.ts                     # POST /dev/code (.invalid + DEMO only, PR #273's testAddress); /dev/last-code removed;
│                                         #   the seed without a password (D14, D16)
└── test/
    ├── helpers.ts, store-helpers.ts      # sentCode, mintCode; seedAuthUser/seedPlainUser without a password; PASSWORD and lastCodeFor leave (D14)
    ├── passwordless-registration.test.ts # US1 (replaces isp-signup.test.ts)
    ├── passwordless-sign-in.test.ts      # US2, US3
    ├── passwordless-invitation.test.ts   # US4
    ├── passwordless-keys-sessions.test.ts# US5
    ├── setup.ts                          # the console.log spy sentCode reads, reset beforeEach (D14)
    ├── passwordless-email.test.ts        # US1: the código email (D13)
    ├── passwordless-sweep.test.ts        # FR-029 (D5)
    ├── passwordless-store.test.ts        # US6 (PR 2)
    └── rewritten: sessions, rate-limit, identity-round, invitee-lands-own-business, dev-seed,
                   dev-code-readable (PR #273's), cash-at-stores-access (T077 in PR 1, then PR 2),
                   cash-at-stores-operator (PR 2)

apps/admin/
├── src/lib/auth-client.ts                # canVerifyPerson(): isUserVerifyingPlatformAuthenticatorAvailable, once per load (D7)
├── src/features/auth/pages.tsx           # LoginPage and SignupPage in two steps; WelcomePage (new); RecoverPage leaves (D6)
├── src/features/auth/session.ts          # sendCode(sign-in), signInWithCode, updateName, revokeOtherSessions; password helpers leave
├── src/features/auth/PasskeyCard.tsx     # a container for KeysCard: list, remove, activate with the step-up, close others (D8, D11, D12)
├── src/features/invitations/AcceptInvitationScreen.tsx  # key and código doors; accept-new {name} → /welcome (D9)
├── src/features/account/AccountHub.tsx   # the identity card's copy (FR-030)
├── src/features/shell/Shell.tsx          # a nameless session → /welcome?next= (D6)
├── src/router.tsx                        # /welcome; /verify-email and /recover redirect to /login (D6)
└── test/                                 # msw.ts; shell, access, memberships, invitee-lands-own-business, session-round
                                          #   and account-hub rewritten; registration, sign-in, welcome and no-passkey
                                          #   (.test.tsx) new — each citing passwordless-access US<n>

apps/red/                                 # PR 2
├── src/lib/auth-client.ts                # canVerifyPerson() (D7)
├── src/features/auth/LoginScreen.tsx     # key, or phone → código → activation (D10)
├── src/features/auth/InvitationScreen.tsx# email → código → activation (D10)
├── src/features/auth/RecoverScreen.tsx   # removed
├── src/features/auth/session.ts          # the four store routes; password calls leave
├── src/features/auth/PasskeyCard.tsx     # a container for KeysCard, list included (FR-036)
├── src/router.tsx                        # /recuperar → /entrar
└── test/                                 # msw.ts; access.test.tsx rewritten

packages/ui/
├── src/components/code-input.tsx         # D12
├── src/components/passkey-offer.tsx      # D12
├── src/components/keys-card.tsx          # D12
├── src/index.ts                          # exports
├── src/playground/Showcase.tsx           # the three atoms, both themes
└── test/                                 # one test per atom, with axe

tests/passkey/{identity-journey,passkey,red}.spec.ts      # rewritten (D14); /dev/code instead of /dev/last-code; red twice (T077, T062)
tests/e2e/{stubs.ts,contrast.spec.ts,responsive.spec.ts}  # the new screens; red's new copy
tests/design/{review-identity,review-identidad-2}.spec.ts # the design captures follow the screens
.specify/memory/constitution.md           # amendments 1 and 2, via /speckit-constitution
CLAUDE.md                                 # the seed line: a código, not devolada123 (D16)
```

**Structure Decision**: the existing web layout, with no new app, area or
table:
- the API's changes sit in the auth configuration, two existing route areas
  (`businesses`, `store`) and one new module (`auth/credentials-sweep.ts`);
- each frontend keeps its access feature folder;
- what both apps render moves to `@devolada/ui`.

## Complexity Tracking

Two amendments to the stack table's Auth row, proposed for
`/speckit-constitution`. Each one materially changes what the row
prescribes, so each is a MINOR bump. No principle is removed, redefined or
renumbered.

| Departure | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| **1. Auth row, with PR 1** (applied: v1.10.0, 2026-10-02) | The panel holds no password: a código or a key opens it (spec US1–US5) | **Proposed text**: *"Better Auth 1.6: email códigos (OTP, stored as a hash) and passkeys (`@better-auth/passkey`); the panel holds no password. Organization plugin as the tenant twin; `username` plugin for the shopkeeper's phone sign-in, with a password until passwordless-access User Story 6; sessions in our D1."* **Rejected**: amending once, for the end state, before PR 1. For the length of PR 1 the constitution would describe a store app that does not exist, which is the silent gap Governance forbids |
| **2. Auth row, with PR 2** | No one holds a password, and the phone signs nothing in (spec US6) | **Proposed text**: *"Better Auth 1.6: email códigos (OTP, stored as a hash) and passkeys (`@better-auth/passkey`); no account holds a password. Organization plugin as the tenant twin; `username` plugin keeps the store's phone, which names the account a store's código is sent to; sessions in our D1."* **Rejected**: removing the `username` plugin (research D4: the generated schema and the store's phone column depend on it) |
