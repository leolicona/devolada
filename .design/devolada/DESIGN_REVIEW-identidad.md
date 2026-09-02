# Design Review: Identity and access (login · signup · recovery · wizard · invitation · session screens · team)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md`
Philosophy: Functionalist, warm accent — evidence-first, calm by default,
roles hide never tease
Date: 2026-09-02
Scope: the whole identity journey after PR #150 (the identity round's
lite PR): `/login`, `/signup`, `/recover` (both steps), `/nuevo-negocio`
(three steps), `/invitaciones/:id` (signed out, wrong email, invalid),
the three session screens the shell answers with (suspended, choose,
revoked), the verify banner in the shell, and the team card in
Configuración. Captured from the built bundle with the API stubbed at the
network edge (`tests/design/review-identity.spec.ts`; same discipline as
the fase-5 and pilot-UX rounds). Earlier reviews: `DESIGN_REVIEW.md`
(fases 2–4), `DESIGN_REVIEW-fase5.md`, `DESIGN_REVIEW-pilot-ux.md`.

## Screenshots Captured

48 files in `.design/devolada/screenshots/`, `review-identity-*`:

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `login-{1280,375}`, `login-1280-dark`, `login-error-1280` | 2 + dark | Login at rest, and with the generic credentials error |
| `signup-{1280,375}`, `signup-errors-{1280,375}`, `-dark` | 2 + dark | Signup at rest, and with the three field problems named in place |
| `recover-email-{1280,375}`, `recover-code-{1280,375}`, `-dark` | 2 + dark | Recovery, both steps |
| `wizard-{1,2,3}-{1280,375}`, `-dark` | 2 + dark | The wizard's three steps with the verify banner (unverified user) |
| `invitation-signed-out-{1280,375}`, `invitation-wrong-email-{1280,375}`, `invitation-invalid-1280` | 2 + dark | The invitation page in its three states |
| `suspended-{1280,375}`, `choose-business-{1280,375}`, `revoked-1280` | 2 + dark | The session screens outside the shell |
| `verify-banner-{1280,375}` | 2 + dark | The verify banner in the shell, on Pagos |
| `team-{1280,375}`, `team-1280-dark` | 2 + dark | Configuración with three members and the invite form |

> Stub artifacts, not product: the wizard's step 3 stub returns the demo
> actor, so the screen says "WifiPlus" only in step 1–2 shots.

## Summary

The pages hold together: one card, one decision per screen, the warm
accent only on the primary, tokens intact in dark. The findings are
about **doors**: three screens hold a session and offer no way out; the
recovery page has no way back; and the verify banner, built for the
shell's gutters, sits inside the wizard's card as an indented box that
contradicts the "listo" headline two lines above it. Nothing here is
colour or hierarchy — it is what a person does when the screen is not
the one they meant to reach.

## Must Fix

1. **Three screens hold a session and have no door out.** The wizard
   (`review-identity-wizard-1-1280.png`), the chooser
   (`review-identity-choose-business-1280.png`) and the suspended screen
   (`review-identity-suspended-375.png`) render outside the shell, so the
   sidebar's "Cerrar sesión" is not there. The person who signed up with
   the wrong email is stuck in "Crea tu negocio"; the owner whose only
   business is suspended is stuck on a screen that says "escríbenos" and
   nothing else; both clear cookies or give up. The invitation page
   already had its own door after PR #150 ("Entrar con el correo
   invitado"); these three did not. _Fix: one `SignOutLink` ("Entraste
   como {email} · Cerrar sesión") under the card on all three._
2. **The verify banner wears the shell's gutters inside the wizard's
   card.** `m-4 lg:mx-8 lg:mt-6` is right between the sidebar and the
   feed; inside a 384px card it becomes a box indented 32px on each side
   with a gap above it that reads as a layout accident
   (`review-identity-wizard-1-1280.png`, `-375.png`). On step 3 it sits
   under "Tu negocio está listo · Ya puedes cobrar por transferencia"
   while saying "Confirma tu correo **para operar**" — two sentences that
   cannot both be true (`review-identity-wizard-3-1280.png`). _Fix now:
   margins belong to the caller (`className`), the wizard gives it
   `mb-4`. Fix in the spec PR: open item 1 of better-auth.spec.md takes
   the banner out of the wizard altogether and rewrites its promise
   ("para invitar a tu equipo")._

## Should Fix

1. **Recovery is a dead end for the person who remembers.** `/recover`
   has no link back to login on either step
   (`review-identity-recover-email-375.png`); login links out to recover
   and signup, recover links nowhere. The email step also carries no
   description, the only access card without one. _Fix: "Volver a
   iniciar sesión" under both forms; a one-line description on the email
   step._
2. **The confirmation does not say where the code went.** "Si existe una
   cuenta con ese correo, le enviamos un código" — the banner names the
   address ("enviamos a leo@wifiplus.mx"), the recovery step does not
   (`review-identity-recover-code-1280.png`). A typo in the email is
   invisible here. _Fix: name the address in the sentence._
3. **The member row squeezes the email at 375px.** Name/email, role and
   "Quitar" share one line, so the email truncates to "ana@wifiplus…"
   (`review-identity-team-375.png`). _Fix: below `sm` the role rides the
   email's line ("ana@wifiplus.mx · Administrador"); the third column
   returns at `sm`._
4. **The wizard's step 2 ends below the fold on a phone** — banner +
   CLABE + bank + beneficiary + two buttons make 890px against 812
   (`review-identity-wizard-2-375.png`). Mostly the banner's doing;
   resolved by must-fix 2 and by open item 1. _No separate fix._

## Could Improve

1. **"Te invitaron a un negocio" could name the business.** The invited
   person sees the generic headline because reading the invitation needs
   a session (`review-identity-invitation-signed-out-1280.png`). A public
   read of `{businessName, role}` by invitation id would let the card say
   "Te invitaron a WifiPlus como operador" — worth it when open item 2
   (invitation lifecycle) touches the same endpoint.
2. **The suspended screen names no channel.** Open item 5 of
   better-auth.spec.md (WhatsApp + email from `platform_settings`);
   not re-decided here.
3. **"Reenviar código" is a text link on `/recover` and an outline
   button in the banner.** Same act, two shapes. Tolerable — the banner
   lives in a form row, the page in a footer line — but one shape would
   be cleaner if either is touched again.

## Fixes applied (2026-09-02, same day — `feat/identity-review`)

1. **A door out**: `SignOutLink` under the wizard (with "Entraste como
   {email}"), the chooser and the suspended screen. Asserted in
   `shell.test.tsx` ("the suspended screen has a door out").
2. **Banner margins are the caller's**: `VerifyEmailBanner` takes
   `className`; the shell passes its gutters, the wizard `mb-4`. The
   step-3 contradiction waits for open item 1 (the banner leaves the
   wizard).
3. **Recovery has a way back and names the address**: "Volver a iniciar
   sesión" on both steps, description on the email step, "Si existe una
   cuenta con {email}…". Asserted in the recovery test.
4. **Member row on a phone**: the role rides the email's line below `sm`.

## What Works Well

- **Field problems are named where they happen** — three sentences in
  the error token under their inputs, `aria-invalid` on, the primary
  button untouched (`review-identity-signup-errors-1280.png`); dark keeps
  the red readable on the well (`-dark.png`).
- **The invitation page tells the truth in the one case the person can
  fix**: "Esta invitación fue enviada a otro correo. Entraste como
  leo@wifiplus.mx" with a single button that does the switching
  (`review-identity-invitation-wrong-email-375.png`).
- **The chooser and the revoked state are one screen with one extra
  sentence** — the warning names the reason and the list is the same
  list (`review-identity-revoked-1280.png`).
- **The wizard's step 2 explains the bank pick in one line** ("Lo tomamos
  de tu CLABE; si no coincide, elígelo de la lista") — the CLABE rule
  (BUG-007) in plain words (`review-identity-wizard-2-1280.png`).
- **Dark holds on every card**: the teal primary, the well inputs and the
  warning banner keep their hierarchy (`review-identity-login-1280-dark.png`,
  `review-identity-wizard-1-1280-dark.png`, `review-identity-team-1280-dark.png`).
