# Quickstart: Landing Page

**Feature**: 008-landing-page · **Date**: 2026-09-19

How to run the page, prove each story, and what must be true before it
publishes. Contracts and the data model are referenced, not repeated.

## Prerequisites

```sh
pnpm install                                   # Astro 7 needs Node ≥ 22.12 (D13); `node --version` first
pnpm --filter @devolada/api db:migrate:local   # applies the landing migration to the local D1
pnpm --filter @devolada/api dev                # API on 8787 — the request door and the beacon
pnpm --filter @devolada/admin dev              # panel on 5174 — the operator's Landing tab (US2)
pnpm --filter @devolada/landing dev            # the page on 5176; PUBLIC_API_URL falls back to localhost:8787
```

With the API up, `curl -X POST localhost:8787/dev/seed` and sign in as
`demo@devolada.app` / `devolada123`; that address is in the dev
`PLATFORM_OPERATOR_EMAILS`, so the panel shows *Operador*.

`.dev.vars` for the API needs nothing new. Leave `RESEND_API_KEY` unset and
the operator notice is logged (D10); set `LANDING_BASE_URL=http://localhost:5176`
to see the no-script redirect (D6) — unset, a plain form post answers JSON.

The Worker in front of the page does not run under `astro dev`. To see the
`www` redirect, the tag injection and the headers locally:

```sh
pnpm --filter @devolada/landing build && pnpm --filter @devolada/api exec wrangler dev --config ../landing/wrangler.jsonc --port 8790
```

## US1 — An ISP owner understands Devolada and asks for it

1. Open `http://localhost:5176/?ch=prueba` at 360 px wide (DevTools device
   toolbar). The page is dark. The first screen shows the eyebrow naming
   SPEI, *Cobrar por transferencia, sin la talacha.*, the subhead, and the
   one-field WhatsApp form with its button inside the viewport; nothing
   scrolls sideways; the header's only link is *Entrar*.
2. Read down: the three proof tiles, the payment in three moments (the
   customer's screen paying, then the "Verificando" breath and the green
   "Tu pago fue registrado", then the system's "Reconectado"), the four
   benefits, both sides of a payment in the payer page's words,
   the system panel naming no vendor, the three doubts, the pricing model
   with **no figure**, the closing form, the human contact, the privacy
   link. No link to sign-up anywhere.
3. Type a WhatsApp into the hero form and send. Expect: the sending region
   breathes (throttle the network to see it), then the received outcome
   with "un día hábil". In the API's log: the notice, logged because no
   Resend key is set. Then send the closing form with a name and a system.
4. `pnpm --filter @devolada/api exec wrangler d1 execute devolada-db --local --command "select whatsapp, name, billing_system, form, channel, notify_error from access_requests"`
   → two rows, `form = hero` and `form = full`, `channel = prueba`,
   `notify_error = NO_RESEND_KEY`.
5. Send with the WhatsApp empty or malformed → the message appears next to
   the field, everything else typed stays.
6. Stop the API; send again → "No pudimos enviar tu solicitud" with the
   contact address; the page itself still reads in full.
7. Disable JavaScript in DevTools; send once more → the browser posts the
   form; with `LANDING_BASE_URL` set you land on `/gracias`.

## US2 — The creator reads the answer

1. In the panel, *Operador* → tab **Landing**. Period 30 days.
2. The counts table shows the `prueba` channel with `visit`, `began`,
   `sent` and their shares of visits; `direct` if you opened the page
   without a tag.
3. The requests table lists the two rows from US1 newest first, with the
   WhatsApp, the name, the system, which form, the channel, the arrival
   time and the notice state, under a one-line count by billing system;
   send the hero form again with the same number and the "repetida" mark
   appears on both.
5. *Exportar CSV* downloads the list; open it and find the same row.

## US3 — The page travels well

1. With the built page under `wrangler dev` (above, port 8790):
   `curl -I -H 'Host: www.devoladapago.com' 'http://localhost:8790/?ch=x'`
   — `301` to the same path and query without `www.`.
2. `curl -s 'http://localhost:8790/?ch=Grupo-ISP' | grep -c 'name="channel" value="Grupo-ISP"'`
   → `2`: both forms' hidden inputs carry the tag.
3. `curl -I http://localhost:8790/` → `Content-Security-Policy` with the
   local `API_ORIGIN`, `X-Content-Type-Options`, `Referrer-Policy`,
   `Permissions-Policy`.
4. `curl -s http://localhost:8790/ | grep -E 'og:image|og:description|canonical'`
   → all three present.
5. On a phone, paste a **dev** address into WhatsApp (after the first
   deploy): title, one line, image (SC-007).

## Full gate, before the PR

```sh
node scripts/spec-lint.mjs && node scripts/gen-banks.mjs --check && node scripts/contrast-lint.mjs && node scripts/pending-lint.mjs
pnpm -r --if-present typecheck                 # includes `astro check` and the Worker's tsc
pnpm -r --if-present test                      # API (landing.test.ts), admin (operator-landing), landing (worker, content)
pnpm -r --if-present build
pnpm e2e -- landing                            # tests/e2e/landing.spec.ts on astro preview (4176)
```

What `landing.spec.ts` proves that nothing else can: the dark palette with axe
at 360/768/1280, zero sideways scroll, every target ≥ 48 px and the main
action 64 px, keyboard order with a visible focus, every claim's text on the
page, the three payer-page strings, the four form outcomes against a stubbed
API, and a first visit under 500 KB (SC-002, SC-006, SC-008, SC-009).

## Pre-flight, before the page publishes

Things a build cannot decide, checked once and recorded in the PR:

- [ ] **The claims list reviewed against the product** (FR-013, SC-008):
      every entry in `apps/landing/src/content/claims.ts` read against its
      `basis`, by a person, on the day. Record the date in the PR.
- [ ] **The privacy notice names a legal person** (D20): `{{RESPONSABLE}}`
      and `{{DOMICILIO}}` in `apps/landing/src/content/legal.ts` replaced —
      `content.test.ts` fails until they are.
- [ ] **The contact address answers**: the `mailto:` on the page reaches the
      creator; send one — and it equals the platform's `support_email`
      (`curl $DEV_API_URL/support`).
- [ ] **The two message templates and the 60-second recording** of the
      customer's side exist — the templates are on the canvas's *Flujo*
      board; the recording is what message 1 sends (spec §The workflow the
      page starts).
- [ ] **The reading test** (SC-001): five people who run or work at an ISP and have
      never seen Devolada, all of them at ISPs, each read the page once on a
      phone and say back what it does, for whom and how it is charged.
      Record what they said in the PR, unprompted answers only.
- [ ] **The timing** (SC-002): in Chrome DevTools with the "Slow 4G" preset
      and 4× CPU throttling, the first screen is readable within 2 s and the
      page within 5 s. Record the numbers in the PR; the weight is measured
      by the browser layer.
- [ ] **Repository variables**: `DEV_LANDING_URL=https://dev.devoladapago.com`,
      `PROD_LANDING_URL=https://devoladapago.com`; the smoke probes read them.
- [ ] **`ALLOWED_ORIGINS`** in `apps/api/wrangler.jsonc` carries the landing
      origins for `dev` and `prod` and the preview suffix (D14) — without
      them the page's script cannot read the API's answer.
- [ ] **`LANDING_BASE_URL`** set per environment in the same file (D6).
- [ ] **The constitution amendment** (D19) drafted with
      `/speckit-constitution` — the stack row and the one-word change to VI.
- [ ] **CLAUDE.md** names the fourth Worker, its port and its command.

## First deploy

Merge to `main`. `deploy-dev` builds the page with `PUBLIC_API_URL` from
`DEV_API_URL`, deploys `devolada-landing-dev`, and `custom_domain: true`
creates `dev.devoladapago.com` (measured 2026-09-19: no record exists). The
smoke step probes `DEV_LANDING_URL/` and waits out the certificate race like
the other three. The first PR's preview upload warns instead of failing —
the Worker does not exist until this merge.

A production release is the usual tag. *What landed* lists `devolada-landing`
beside the other three; *Rollback Prod* offers `landing` as a choice.

## Reading the result

Thirty days after the production deploy, open *Operador → Landing*, period
30 days: requests, requests by billing system and by form, and each step's
share of visits — the numbers SC-003 promises, read in one place. The rest
of the workflow — answered within a day, fit, accounts from conversations,
first verified payment within 7 days, first top-up — is read from the
conversations and the panel's businesses and credit screens.
The spec's working number is ten requests from businesses the product
serves end to end; fewer says change the message before changing the
product.
