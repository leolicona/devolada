---
status: in-development
stories: [US-A05]
domain: admin
updated: 2026-09-03
debt: []
---

# Spec: Account hub — the avatar is the fifth section

The dashboard's fifth section stops being a gear called Configuración and
becomes the person: their avatar, labelled **Cuenta**, in the sidebar and
in the phone's bottom bar. It opens a hub that holds the business's
settings by area, the person's own things (passkeys) and the one way out,
organised as sub-pages. The IA had planned this door since phase 2 ("User
menu: account, passkey, sign out. Role badge shown here") and it was never
built; sign-out lived in two places (the sidebar's foot, and a card at the
end of a 3,000px settings page — BUG-016) and the settings page mixed the
business's cards with the person's.

Decided in the 2026-09-02 interview. **PR A** (#159): the avatar, the hub,
the sub-pages, the unified sign-out (D1–D7). **PR B**: the phone's header
retires and "Saldo bajo" becomes a strip (D8–D10); it amends
`prepaid-credit` D7's UI Contract, shell D2 and the IA's Shell section.

## Decisions

- **D1 — Cuenta replaces Configuración as the fifth section, at both
  widths.** One IA, one label, one test set; the sidebar's foot block
  (email + Cerrar sesión) retires into the hub. The label is **Cuenta**:
  one word (the ≤5-section law is measured at 360px, FRONTEND.md), and
  honest — the door is the person, and the business's settings are one
  group inside. "Configuración" survives as the name of that group, so no
  synonym is born. **Rejected**: keeping the gear on desktop and the
  avatar on phones (two IAs for one screen); "Perfil" (hides that Saldo,
  Usuarios and the CLABE live there); a sixth section (breaks the law).
- **D2 — The avatar is initials, and the actor carries the name.** No
  image source exists (the `user.image` column is never written: no OAuth,
  no upload), so the avatar renders the initials of the user's name on the
  accent-soft ground. `/auth/me` gains `userName` so the shell needs one
  request, not a second call to `get-session`. **Rejected**: an upload
  flow (a feature of its own, with no story behind it).
- **D3 — The avatar wears the credit step.** From `low` on, a small glyph
  (the step's own icon: triangle, or pause) sits on the avatar in both
  bars, and the item's accessible name says it ("Cuenta, saldo bajo").
  Never color alone (brief law). In the normal step nothing is added. This
  is the ambient signal PR B will lean on when the phone's chip leaves;
  it costs no space today.
- **D4 — A hub of sub-pages under `/settings`.** `/settings` is the hub;
  the areas are routes: `/settings/direct-payment` (Pago directo por SPEI ·
  Política de conciliación) and `/settings/preferences` (Zona horaria y
  hora) — one page, `/settings/business`, until it split 2026-09-03
  (settings D11); the Cargo por servicio card retired the same day
  (settings D9) — plus `/settings/credit` (Saldo y recargas),
  `/settings/users` (Usuarios), `/settings/security` (Entrar con huella o
  rostro). Routes stay English identifiers (IA rule). The old anchors keep
  working: a visit to `/settings#saldo`, `#usuarios`, `#cargo`, `#spei`,
  `#politica` or `#zona` is redirected by the hub on mount to the sub-page
  that holds the card (the hash survives where the card kept its id;
  `#cargo` lands on `#spei`, where the one fee lives, and `#zona` on
  Preferencias). `/settings/business` itself redirects the same way, so
  the links pointing at it from banners and from the wizard keep landing
  on the card they meant. **Rejected**: one long page with an in-page index behind the
  avatar (not sub-menus: 3,000px of scroll on a phone, and the person's
  cards mixed with the business's).
- **D5 — Business first; the person's things below; the door last.** The
  hub's order: the identity card (avatar, name, email, the business and
  the person's role in it — the switcher when there are several
  businesses), then **Negocio** (Saldo y recargas · Pago directo y
  conciliación · Integraciones · Usuarios · Preferencias — the first was
  one row called Configuración until settings D11 split it, and
  Preferencias sits last because a clock format is the least of the five),
  then **Tu cuenta** (passkeys), then
  **Cerrar sesión** as a button for every role. The owner enters for
  Saldo and Usuarios daily; the person's own things almost never change.
  Every row is gated by the role matrix the cards already obey (hide,
  never disable — brief law): Saldo needs `credit: manage`, both business
  rows `settings: update`, Integraciones `integrations: manage`, Usuarios
  `members: invite_below_admin`; passkeys and the door are everyone's.
  The Integraciones row carries the "Modo observación" chip while the
  business observes — the hub is one of the two homes the state keeps
  once PR B removes the phone's chip (the other is the integration's own
  page).
- **D6 — Desktop composes; the phone stacks.** At `lg` and above the hub
  is two columns: the rail (identity + groups + door) on the left, the
  sub-page on the right, `aria-current` on the active row; `/settings`
  alone shows the rail and, on the right, the person's read-only profile.
  Below `lg` the hub is the rail alone, each row opens its sub-page full
  width with "Volver a Cuenta" at the top. Same route tree, one
  composition per width. **Rejected**: the phone's list-then-page shape
  on a monitor (a six-row menu floating in 1280px, two clicks for
  everything).
- **D7 — The profile is read-only in this round.** Name, email, business
  and role are shown; nothing edits. Better Auth ships `update-user` and
  `change-password`, but no story covers them and the código flow (better-
  auth D4/D16) would have to extend to a password change. Open item 1.

### PR B — the phone's header retires (2026-09-02, same interview)

- **D8 — The phone has no header.** The 48px row (business name + credit
  chip) leaves; the page title is the first thing on a phone. The
  business, the switcher and the balance live one tap away in Cuenta; the
  avatar in the bottom bar wears the credit step (D3). Decided knowing the
  row had already shrunk from three rows to one the same day: the owner
  reaffirmed the goal — the phone is for what matters. From `lg` the
  sidebar keeps the chip and the observation chip; a monitor has the room.
  **Rejected**: keeping the one-line bar (48px on every screen for a
  number the avatar already signals); a business-name subtitle on every
  screen (five screens repeating one fact).
- **D9 — "Saldo bajo" is a strip the owner closes, not a toast.** One line
  above the content (`role="status"`, icon + "Saldo bajo: $X" + Recargar +
  a close button), phone only. Closing it is remembered per business and
  step (`localStorage`) until the step changes: a balance that recovers
  and drops again is announced again. No timer. **Rejected**: a notice that
  fades in seconds (the owner reading Pagos never saw it — D7 rejected
  "chip only" for less; WCAG 2.2.1); nothing at all (the IA's rejected
  "no ambient signal"). Sin saldo and Validación en pausa keep their
  persistent banners (prepaid-credit D7): money at risk stays loud.
- **D10 — Recargar only for a role that can; the observation state only
  where it can be acted on.** The strip and the two banners render
  Recargar only with `credit: manage` — a viewer reads the state, never a
  dead button (hide, never tease; this also corrects the banners, which
  offered it to every role). On a phone the observation state reads in
  Cuenta's Integraciones row and on the integration's page; the shell
  chip stays in the sidebar only. **Rejected**: a persistent observation
  strip on the phone (a configuration the owner chose, shouted on every
  screen); a badge in Pagos' header (the mode also applies in Cobros and
  Links).

## Contract (consumes, adds one field)

`/auth/me` (business actor) gains `userName: string` — the Better Auth
user's name, for D2. No new endpoint: the sub-pages read what their cards
already read (`/settings`, `/credit*`, `/businesses/members`, the passkey
list).

## UI Contract

- **Fifth section**: the avatar (initials, `size-5` in the bottom bar,
  `size-6` in the sidebar) with the label **Cuenta**; from `low` on, the
  step glyph and "Cuenta, saldo bajo" / "…, sin saldo" / "…, validación
  en pausa" as the accessible name (D3). The chip (`CreditChip`) and the
  banners are unchanged in this PR; their target becomes
  `/settings/credit`.
- **Hub** (`/settings`): identity card — avatar (large), `userName`,
  email, then the business switcher (the plain label with the role under
  it when there is one business); group **Negocio** with the rows the
  role may use, each with a one-line description (Saldo y recargas shows
  the balance and its step label; Integraciones shows the observation
  chip while observing); group **Tu cuenta** with "Entrar con huella o
  rostro"; **Cerrar sesión** (outline, `LogOut` icon) at the foot.
- **Sub-pages**: `/settings/direct-payment` keeps `#spei` and `#politica`,
  `/settings/preferences` keeps `#zona` (settings D11; `#cargo` retired
  with its card, D9, and the in-page index with the page it was drawn for,
  D10); `/settings/credit` = `CreditCard`;
  `/settings/users` = `UsersCard`; `/settings/security` = `PasskeyCard`.
  A sub-page is titled **only when it holds more than one card** (D11):
  Pago directo y conciliación names two cards called something else, so it
  carries an `h2` at `text-lg`; Saldo, Usuarios, Passkeys and Preferencias
  are one card each whose own heading already says the row's words, and a
  title there would say them twice — the argument that killed the settings
  index (settings D10). "Volver a Cuenta" shows below `lg`. A sub-page the role may not use renders nothing of it and
  redirects to the hub.
- **Retired**: the sidebar's foot (email + Cerrar sesión) and the
  **Sesión** card (settings spec, 2026-09-02): the hub's door is the one
  for every width — BUG-016 stays closed.
- **Deep links** elsewhere in the admin move to the sub-page: the CLABE
  banner and the wizard's "Configurar mi CLABE" → `/settings/direct-payment#spei`;
  the credit chip and banners → `/settings/credit`; Cobros' "Configurar"
  → `/settings/direct-payment` (settings D11).
- Copy in es-MX. Light + dark from the tokens; icon + text everywhere.

- **D11 — A sub-page is titled only when it holds more than one card
  (2026-09-05, espaciado review T1/T2).** Two of the five passed a title
  and three passed none, so the right column started 49px lower on the
  two and level with the rail on the three, and the same tap opened a page
  whose name was an `h2` or a page whose name lived inside a card. The
  rule is the content's, not the route's: more than one card and the page
  needs a name of its own; one card and the card's heading *is* the name.
  The size is `text-lg` — the ramp's "section titles" — because at
  `text-xl` it matched the hub's own `h1`, 24px against 24px in two
  columns, the longer string reading as the page's real title.
  **Rejected**: a title on all five (three pages would print the row's
  words twice, one inside a card and one above it); none at all (Pago
  directo y conciliación is the one page where the title does real work,
  naming two cards that are called something else).

## Scenarios

1. UI: the fifth section is the avatar with the initials of `userName`,
   labelled Cuenta, in both navs; tapping it from Pagos opens the hub
   (D1, D2; TESTING rule 9).
2. UI: the owner's hub lists Saldo y recargas (with the balance),
   Configuración, Integraciones and Usuarios under Negocio, passkeys under
   Tu cuenta, and Cerrar sesión; a viewer's hub lists only the passkeys
   row and the door (D5).
3. UI: Cerrar sesión from the hub signs a viewer out and lands on login
   (BUG-016, moved here).
4. UI: with `credit.step = 'low'` the Cuenta item's accessible name
   carries "saldo bajo" and shows the glyph; with `'ok'` it is "Cuenta"
   alone (D3).
5. UI: `/settings#saldo` lands on `/settings/credit`; `/settings#spei`
   lands on `/settings/direct-payment` with the hash kept; `/settings#zona`
   on `/settings/preferences` (D4, settings D11).
6. UI: each sub-page renders its cards and none of another's; an operator
   opening a business page is sent back to the hub (D5, roles hide).
7. API: `/auth/me` carries `userName` (D2).
8. a11y: the hub and the four sub-pages pass axe (US-P04).
9. UI: below `lg` the shell renders no header — no business name, no chip
   — and the bottom bar's avatar carries the step (D8; the sidebar keeps
   both chips).
10. UI: `step: 'low'` shows the strip with the amount; closing it hides
    it and a reload keeps it hidden; the same business at `'empty'` shows
    the banner, and back at `'low'` the strip returns (D9).
11. UI: a viewer at `'low'`/`'paused'` reads the strip/banner without
    Recargar; the owner gets the link/button (D10).

## Definition of Done

- [ ] Scenarios 1–6 and 8 automated (`apps/admin/test/account-hub.test.tsx`,
      plus the repointed settings/credit/memberships/identity suites)
- [ ] Scenario 7 asserted in `apps/api/test/business-memberships.test.ts`
- [x] Keyboard walk (`tests/e2e/keyboard.spec.ts`) updated: Cuenta replaces
      Configuración; the sidebar's Cerrar sesión stop is gone
- [x] The real-API journeys (`tests/passkey/*`, run by the dev deploy, not
      by PR CI) travel through the avatar to Usuarios and to the passkey
      card — repointed after #159's deploy-dev run found them at `/settings`
- [ ] Settings spec, shell spec, IA and TASKS.md annotated
- [x] Design review of the hub at 360/768/1280, light + dark
      (`.design/devolada/DESIGN_REVIEW-cuenta.md`, PR #159)
- [ ] PR B: scenarios 9–11 automated (`credit.test.tsx`, `shell.test.tsx`);
      prepaid-credit UI Contract, shell D2 and the IA amended; captures of
      the phone without its header

## Open items

1. **Editing the person**: name, email (through a código), password
   change. Needs its own story under auth; the hub's identity card is
   where it would live (D7).
2. ~~PR B — the phone's header strip retires~~ — decided as D8–D10
   above, built in the PR after #159.
