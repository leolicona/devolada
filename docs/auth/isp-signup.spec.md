---
status: in-development
stories: [US-S04, US-S06]
domain: auth
updated: 2026-08-15
debt: [TD-001, TD-003, TD-011]
---

# Spec: ISP signup, email verification and password recovery

Self-service ISP signup with email + password, email verification through a magic link, and password recovery with the same pattern. API-side in `apps/api` (`src/routes/auth.ts`, `src/email/sender.ts`); admin UI pages land with the admin shell (see UI Contract).

## Decisions

- **D1 — Magic links come from Agnostic Auth, but the URL is ours.** `/auth/initiate` returns `{token, magicLink}`; the IdP's `magicLink` points at the registered `redirectUrl` (the store domain), so we ignore it and build `${ADMIN_BASE_URL}/verify?token=…` ourselves. Discarded alternative: re-registering the app per surface (two appIds to maintain for zero gain).
- **D2 — Signup never blocks on email failure.** The account is created unverified, the session starts, and the verification email is best-effort with a re-send endpoint (`integrations/resend.md` resilience rule). Discarded alternative: transactional signup that rolls back if Resend fails (couples account creation to a third party's uptime).
- **D3 — Verification gates operation, not login.** An unverified ISP can sign in and look around, but cannot register stores (enforced where stores are created, US-A02). Discarded alternative: blocking login entirely (locks out users whose email is delayed, generates support).
- **D4 — Signup returns 409 on a taken email.** Unlike login's generic 401, signup necessarily reveals existence (the alternative — a fake success — breaks the UX for legitimate re-registrations and helps no one: the recovery flow reveals nothing).
- **D5 — Reset also verifies.** Completing a password reset proves email ownership, so `emailVerified` flips to true. Discarded alternative: keeping the flags independent (forces a redundant second email round-trip).
- **D6 — Provider-agnostic sender.** `sendAuthLink` posts to Resend when `RESEND_API_KEY` exists and logs the link to the console otherwise (dev). Keeps TD-003's spirit: templates and triggers don't marry a provider.

## Contract

| Route | Input (Zod) | Success | Failures |
|-------|-------------|---------|----------|
| `POST /auth/signup` | `{name: ≥2, email, password: ≥8}` | 201 `{type, id, name, emailVerified: false}` + cookies; verification email best-effort | 409 `EMAIL_TAKEN` · 400 validation |
| `POST /auth/verify-email` | `{token}` | `{…actor, emailVerified: true}` + cookies (signs the user in) | 400 `INVALID_TOKEN` |
| `POST /auth/resend-verification` | — (session, ISP only) | `{}` (email best-effort) | 401/403 session · 409 `ALREADY_VERIFIED` |
| `POST /auth/recover` | `{email}` | always 200 `{}` (no account-existence leak) | 400 validation |
| `POST /auth/reset-password` | `{token, password: ≥8}` | `{…actor}` + cookies; `emailVerified` set true (D5) | 400 `INVALID_TOKEN` |

Flow mapping: signup → `/auth/hash` + `/auth/initiate`; verify/reset → `/auth/verify` (token) → identity = ISP email → DB update; sessions ride the existing cookie machinery from `sessions.spec.md`.

## Business rules

1. One account per email (`isps.email` unique); 409 on collision (D4).
2. An unverified ISP holds a valid session but store registration is blocked until `emailVerified` (D3; enforced by the stores feature).
3. Recovery responds 200 whether the email exists or not; the email only goes out when it does.
4. A used or expired token fails with `INVALID_TOKEN`; token lifetime is the IdP's (`tokenTtlSeconds: 900`).

## UI Contract

Pages live in `apps/admin` (land with the admin shell; this spec ships the API and the contract they consume):

- `/signup`: name, email, password; on success → banner "Confirma tu correo" with a re-send action; the user is already signed in.
- `/verify?token=…`: magic-token redemption (shared component with the store invitation) → success state → straight to Settings (the API-Key gate from the IA).
- `/recover`: email → always the same confirmation ("Si existe una cuenta, enviamos un enlace") — no existence leak.
- `/reset?token=…`: new password twice → signs in on success.
- Copy in plain es-MX; access forms share the visual base defined in the brief; errors never mention the IdP.

## Scenarios

1. Valid signup → 201, cookies set, `emailVerified: false`, verification link generated
2. Signup with a taken email → 409 `EMAIL_TAKEN`
3. Malformed signup payload → 400
4. `verify-email` with a valid token → 200, `emailVerified` true in DB, cookies set
5. `verify-email` with an invalid token → 400 `INVALID_TOKEN`
6. `resend-verification` with an ISP session → 200; without a session → 401
7. `recover` for an existing and an unknown email → identical 200
8. `reset-password` with a valid token → 200, password hash replaced, `emailVerified` true

## Definition of Done

- [x] Contract implemented with scenarios 1–8 automated (`test/isp-signup.test.ts`)
- [x] Retroactive session scenarios automated (`test/sessions.test.ts`; TD-005 paid)
- [x] Admin UI pages built and wired (`apps/admin`, admin/shell.spec.md)
- [x] Real email sending verified with a Resend API key — 2026-08-15, local
      `wrangler dev` against the live API: signup took the Resend branch (no
      console fallback, no error), and the sandbox sender's limit was measured in
      the same session (`integrations/resend.md`)
- [x] Delivery confirmed in an inbox by a human — 2026-08-15. Worth keeping as
      its own box: Resend answering 2xx is not the same fact as an email
      arriving, and only the second one closes US-S04.
- [x] A **third-party** ISP can receive it — 2026-08-15, once
      `devoladapago.com` was verified and `EMAIL_FROM` pointed at it. The same
      call answered **422** an hour earlier under the sandbox sender, which is
      what made this its own box: signup swallows that failure and returns 201
      either way, so nothing in the response ever showed it.
- [ ] `RESEND_API_KEY` set as a worker secret in dev **and prod** (TD-011) —
      dev has it as of 2026-08-15 (uploaded by the deploy step, confirmed with
      `wrangler secret list --env dev`), so the dev API really sends. The box
      stays open for `production`, which still falls back to logging the link.
