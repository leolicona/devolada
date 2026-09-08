# Design Review: Identidad y acceso — the second look (PRs #150–#154)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md` (the SaaS cycle) and
`docs/legacy/FRONTEND.md`; the shadcn discipline from CLAUDE.md (domain atom in
`@devolada/ui` → shadcn primitive in `src/components/ui/` → new component).
Philosophy: functionalist with a warm accent; status never by colour alone;
roles hide, never tease; calm by default.
Date: 2026-09-02
Scope: everything the admin gained since PR #150 — `next` on the access
pages and inline signup validation (#150); the sign-out door on the wizard,
the chooser and the suspended screen, the name-only wizard and its done
screen, the invitation page that decides for the invitee, the CLABE banner
and the share gate, the team card with pending invitations and role pickers
(#151, #152); the código screen and the provider-free integration banner
(#153); the passkey list and the Sesión card (#154).

## Screenshots Captured

Captured with the repo's own Playwright harness
(`tests/design/review-identidad-2.spec.ts`, `playwright.review.config.ts`):
63 images, every slug at its primary width in light **and dark**, plus 768
and 375 where the layout changes. All in `.design/devolada/screenshots/`,
prefix `review-identidad2-`.

| Screenshot | Breakpoints | Description |
|---|---|---|
| `login-{1280,768,375}`, `-dark` | 3 + dark | Login with a `next` in the URL |
| `signup-errors-{1280,375}`, `-dark` | 2 + dark | Signup with the three field problems named in place |
| `verify-email-{1280,768,375}`, `-dark` | 3 + dark | The código screen, the address named |
| `verify-email-error-{1280,375}`, `-dark` | 2 + dark | Wrong código after a resend |
| `verify-email-typed-375`, `-dark` | 1 + dark | The código screen reached without an address |
| `recover-code-{1280,375}`, `-dark` | 2 + dark | Recovery, second step |
| `wizard-{1280,768,375}`, `-dark` | 3 + dark | The one-step wizard |
| `wizard-done-{1280,375}`, `-dark` | 2 + dark | "Tu negocio está listo" with the missing step named |
| `invitation-new-{1280,768,375}`, `-dark` | 3 + dark | Invitee without an account: one form, the address fixed |
| `invitation-existing-{1280,375}`, `-dark` | 2 + dark | Invitee with an account: the password alone |
| `invitation-expired-{1280,375}`, `-dark` | 2 + dark | Expired invitation |
| `invitation-gone-1280`, `-dark` | 1 + dark | Unknown invitation |
| `invitation-wrong-email-{1280,375}`, `-dark` | 2 + dark | Signed in with another address |
| `banners-{1280,768,375}`, `-dark` | 3 + dark | Pagos with the CLABE banner and the integration banner |
| `links-gated-{1280,375}`, `-dark` | 2 + dark | Links with the share gate |
| `settings-owner-{1280,768,375}`, `-dark` | 3 + dark | Configuración, owner: team, pending, passkeys, Sesión |
| `settings-team-{1280,375}`, `-dark` | 2 + dark | The team card with the role picker opened |
| `settings-viewer-{1280,375}`, `-dark` | 2 + dark | Configuración, viewer: passkeys and Sesión only |
| `suspended-{1280,375}`, `-dark` | 2 + dark | The suspended screen with the support channel |
| `choose-business-375`, `-dark` | 1 + dark | The chooser on a phone |

## Summary

The round delivered what it promised: one form per decision, a door out of
every screen, evidence in words (a role on every row, the clock on every
invitation), and a dark palette that holds on every new card. The biggest
finding is on the phone, where the team card the pilot-UX review built
around "a person on every row" crushes the person to one letter
(`settings-owner-375`): the row keeps its desktop shape — name, picker,
Quitar on one line — at 375px. Second, the shell's two setup banners keep
a desktop row shape on a phone and push Pagos below the fold. Everything
else is polish.

## Must Fix

1. **The member row loses the person at 375px.** `UsersCard.tsx:105` lays
   name, role picker (`w-40`) and Quitar on one line; on a phone the name
   column is left with ~30px and renders "A…" / "C…" — the row the
   pilot-UX review named "a person on every row" no longer has one. The
   pending rows do the same to the email (`sofia@wi…`, `UsersCard.tsx:173`).
   See `screenshots/review-identidad2-settings-owner-375.png` (Usuarios
   card). _Fix: below `sm`, stack — name and email on their own line, the
   picker and Quitar on the next (`flex-col sm:flex-row`); the pending row
   the same. Keep `truncate` only for the email._

## Should Fix

1. **The two setup banners keep a row shape on the phone.** `Shell.tsx:234`
   and `:251` are `flex items-center justify-between`: at 375px the
   sentence is squeezed into a 130px column next to a wide button, and
   "Ver integraciones" wraps to two lines. With the failed-payments notice
   under them, "Pagos" starts below the fold
   (`review-identidad2-banners-375.png`). _Fix: `flex-col items-start
   sm:flex-row sm:items-center` on both banners; on the phone the button
   sits under the sentence. Consider collapsing the two setup banners into
   one "Faltan 2 pasos" line on `< sm` when both are up._
2. **Links says the CLABE is missing twice.** With no CLABE, the shell
   banner and the page's own notice (`LinksScreen.tsx:186`) say the same
   thing one screen apart (`review-identidad2-links-gated-375.png`). _Fix:
   keep the page notice only where the share button would be (it explains
   the missing control, which the banner does not), and drop the shell
   banner's sentence to one line — or keep the banner and let the page
   notice go. One voice per screen._
3. **The código error copy comes from the shared mapper, not from the
   page.** `pages.tsx:41` maps every OTP/CODE error to "…Pide uno nuevo.",
   so the page's own "…Reenvíalo e intenta otra vez." (`pages.tsx:275`)
   never renders (`review-identidad2-verify-email-error-1280.png`). The
   two sentences say different things next to a "Código reenviado" link.
   _Fix: let the page's fallback win for the código screen (pass the
   sentence into `useSubmit` as the OTP copy, or map OTP codes to the
   page's copy), and use "Reenvíalo…" since the resend is right there._
4. **The expired and wrong-email invitation states have no door.** After
   "Esta invitación venció" the card ends with a sentence and no link
   (`review-identidad2-invitation-expired-1280.png`); the wrong-email
   state offers only "Entrar con el correo invitado". Every other card in
   the access layout ends with a way to login. _Fix: add "Ir a iniciar
   sesión" under both, as the código and recovery screens do._
5. **The fixed email on the invitation form looks editable.** It is a
   read-only `Input` with the same well background as the fields under it
   (`AcceptInvitationScreen.tsx:178`; `review-identidad2-invitation-new-375.png`).
   The person will try to type in it. _Fix: render it as text — "Correo:
   ana@wifiplus.mx" in `text-foreground` under the description — the way
   the members list shows an email. The label stays for the screen reader._

## Could Improve

1. **Six hand-rolled text-link buttons.** "Reenviar código" (`pages.tsx:319`,
   `:448`), "Cerrar sesión" in `SignOutLink.tsx:22`, and the "Reintentar"
   links in four screens are raw `<button className="text-link
   hover:underline">`. shadcn's Button has a `link` variant for exactly
   this; ours (`components/ui/button.tsx:13`) has default, outline, ghost
   and destructive. _Suggestion: add `link: "h-auto p-0 text-link
   hover:underline"` and use it — one place for the focus ring and the
   disabled look._
2. **"consultado hace 27474 min".** The roster's age line
   (`LinksScreen.tsx:34`) has no ceiling; the stub shows what a stale tab
   would show after a weekend. _Suggestion: minutes up to 59, then "hace
   N h", then "hace más de un día"._
3. **Two "Cerrar sesión" on desktop.** The sidebar's and the Sesión card's
   both show at ≥ lg (`review-identidad2-settings-owner-1280.png`). Tolerable
   and documented (BUG-016), but the card's sentence could acknowledge
   the desktop ("también en el menú de la izquierda") or the card could
   hide its button at `lg` and keep only the email. _Suggestion: leave it —
   one door twice is better than none once — and revisit if a user
   comments._
4. **Bottom-bar labels truncate at 375px.** "Integracion…" and
   "Configurac…" (`Shell.tsx:122`, from fase 5). Not this round's, and the
   five-section IA is the brief's; noted because every phone capture shows
   it. _Suggestion: "Integrar" / "Ajustes" as short labels under `sm`, or
   icon-only with `aria-label` for the two long ones._
5. **"Como operador."** on the invitation cards reads as a fragment. _Suggestion:
   "Te invitaron a WifiPlus como operador." in the heading's own line, and
   the description keeps the instruction only._

## What Works Well

- **One decision per screen, and the screen decides.** The código screen
  (`verify-email-*`), the invitation page (`invitation-new-*`) and the
  done screen (`wizard-done-*`) each ask one thing, name the address they
  are about, and end with the next step. The invitation page's "one form
  with the address fixed" is the round's best UX call: no "Entrar o crear
  cuenta" fork.
- **Doors everywhere.** Suspended, chooser, wizard, the código screen and
  now Configuración on a phone all have "Cerrar sesión" or a way back to
  login. The suspended screen with the support channel
  (`suspended-375`) is calm, centred and complete.
- **Evidence in words.** Roles on every member row, "Vence en 40 horas" and
  "Vencida" on invitations (the red is paired with the word), "Activada el
  20 ago 2026 · sincronizada con tu llavero" on passkeys. Status is never
  colour alone.
- **Dark is a palette, not an inversion.** Every new card — team, passkeys,
  Sesión, the two banners, the código card — keeps its hierarchy in dark
  (`settings-owner-1280-dark`, `banners-1280-dark`, `verify-email-1280-dark`).
- **shadcn discipline held.** Every new control is `Button`, `Input`,
  `Label`, `Select` from `components/ui/` or `Alert`/`Card` from
  `@devolada/ui`; the remove confirm is `AlertDialog`; the role picker is
  `Select` with `aria-label="Rol de {name}"`. No hex, no arbitrary pixel
  values beyond the fase-5 `text-[11px]` in the bottom bar. The global
  `:focus-visible` ring and `prefers-reduced-motion` in
  `packages/ui/src/styles/index.css` cover the new screens without
  per-component work.
- **Tablet holds.** At 768px Configuración, the banners and the wizard
  reorganise (two-column fields, full-width cards) instead of shrinking
  (`settings-owner-768`, `banners-768`).

## Applied — 2026-09-02, the same day

- **Must fix 1**: member and pending rows stack under `sm`
  (`UsersCard.tsx`); the picker goes full width on the phone.
- **Should fix 1**: both shell banners stack under `sm` (`Shell.tsx`).
  Collapsing the two into one line was not done — two sentences, two
  steps.
- **Should fix 2**: Links drops its page notice; the shell banner is the
  one voice (`LinksScreen.tsx`, business D5 amended).
- **Should fix 3**: `useSubmit` takes the página's código copy; the código
  screen says "Reenvíalo e intenta otra vez" (`pages.tsx`).
- **Should fix 4**: "Ir a iniciar sesión" under the expired and wrong-email
  invitation states (`AcceptInvitationScreen.tsx`).
- **Should fix 5**: the invited address is text, "Correo: ana@…"
  (`AcceptInvitationScreen.tsx`; better-auth UI contract amended).
- **Could improve 1**: `Button variant="link"` added
  (`components/ui/button.tsx`, with a compound variant that removes the
  box); used by both "Reenviar código" and by `SignOutLink`. The four
  "Reintentar" links inside alerts keep inheriting the alert's colour on
  purpose and stay as they are.
- Not done, by choice: could improve 2–5 (the roster age ceiling, the
  double desktop sign-out, the bottom-bar labels, the "Como operador."
  fragment). Backlog for the next round.

Captures retaken after the fixes: same filenames, `review-identidad2-*`.
