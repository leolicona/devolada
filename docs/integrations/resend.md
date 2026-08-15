# Resend — verified contract

**Status: integrated, sandbox-limited.** Exercised end to end against the live API
on 2026-08-15 from a local `wrangler dev` with a real key. Like `agnostic-auth.md`,
this file records what the API actually did, not what the guide says it does — on
conflict, this file wins.

## Use

- ISP email verification (US-S04): sending the Agnostic Auth `/auth/initiate` link.
- Admin password recovery (US-S06): same pattern.
- Admin side only. Stores do not use email — their channel is WhatsApp/SMS (TD-003).

## Account and sender

Devolada has **its own Resend account**, separate from the one holding
`turistearya.com`. Not preference — measured: the free plan caps at one verified
domain, and `POST /domains` for `devoladapago.com` came back
`403 You have reached the domain limit of your plan` (2026-08-15). A second free
account costs nothing and gives Devolada its own domain slot; it also means
rotating or leaking one project's key never touches the other.

Sender: `Devolada <no-reply@devoladapago.com>` — the apex, because the domain is
dedicated to this product and carries no other mail (checked at setup: no MX, no
TXT). If it ever hosts a mailbox, move sending to a subdomain such as
`send.devoladapago.com` so reputations stay apart.

## Activating it (the remaining half of TD-011)

1. Create a Resend account for Devolada and add `devoladapago.com` to it.
2. Paste the DKIM and SPF records Resend shows into the `devoladapago.com` zone
   in Cloudflare, which is where its nameservers point.
3. Wait for Resend to report the domain **verified**.
4. Issue an API key on that account. Put it in `apps/api/.dev.vars` and in the
   `dev` and `production` GitHub environments as `RESEND_API_KEY`.
5. Only then set `EMAIL_FROM` to `Devolada <no-reply@devoladapago.com>` in
   `wrangler.jsonc`. Setting it before step 3 makes every send fail — the
   sandbox at least reaches us.
6. Sign up with an address that is not ours and confirm the email arrives. That
   is the test the sandbox can never pass.

## Where the key lives

`RESEND_API_KEY` in `apps/api/.dev.vars` locally, `wrangler secret put --env <env>`
for a deployed worker. Never anywhere else — that is the BUG-001 rule, and
`.dev.vars` is in `.gitignore` precisely because it once was not.

Without the key, `sendAuthLink` logs the link to the console instead of sending
(`src/email/sender.ts`). Every deployed environment currently takes that branch —
see TD-011.

## The call

`POST https://api.resend.com/emails`, `Authorization: Bearer <key>`, JSON body
`{ from, to, subject, html }`. A non-2xx throws `resend failed: <status>`.

`from` comes from `EMAIL_FROM`, falling back to `Devolada <onboarding@resend.dev>`.

## What the sandbox sender actually allows — verified

With the fallback `onboarding@resend.dev` and no verified domain:

| Recipient | Result |
| --- | --- |
| The Resend account owner's own address | **accepted, and it arrived** |
| Any other address | **422** |

Both cases were run against the live API on 2026-08-15, and the first was
confirmed in the inbox — a 2xx from Resend is not by itself evidence that an
email was delivered. This is the whole reason
TD-011 exists: the integration is proven, but in this state it can only mail one
person, and that person is us.

## What a failure looks like from outside

Nothing. `POST /auth/signup` catches the error (spec D2 — the account never depends
on the email provider), logs `verification email failed`, and still returns **201**.
That resilience is correct and deliberate; the cost is that an ISP whose address
Resend rejects signs up, receives nothing, and is told nothing.

The admin's persistent "Confirma tu correo" banner and its **Reenviar correo**
button are the only recovery path — and while the sender is the sandbox, resending
fails the same silent way.

## Rules

- Called only from `apps/api`; never from the browser.
- Signup must never block on it.
