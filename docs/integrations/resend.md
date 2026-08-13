# Resend — contract pending

**Status: not integrated yet.** Filled in while building `auth/isp-signup.spec.md`.

## Intended use

- ISP email verification (US-S04): sending the Agnostic Auth `/auth/initiate` `magicLink`.
- Admin password recovery (US-S06): same pattern.
- Transactional email on the admin side only. Stores don't use email (their channel is WhatsApp/SMS → TD-003).

## Requirements to activate

- Resend API key as a worker secret (`RESEND_API_KEY` in `.dev.vars` / `wrangler secret`).
- Verified domain in Resend (or the `onboarding@resend.dev` sandbox for development).
- Called only from `apps/api`; never from the browser.

## Resilience rule

Signup does not block if Resend fails: the account is created unverified and the email can be re-sent. The error is logged, not propagated as a signup failure.
