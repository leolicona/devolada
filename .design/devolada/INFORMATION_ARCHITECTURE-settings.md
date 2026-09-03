# Information architecture — the settings area (Cuenta)

Scope: the whole `/settings` tree — the hub, its sub-pages, and every door
that leads into it from elsewhere in the admin. It refines the Shell and
"Configuración" sections of [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md),
which stays the parent document; where the two disagree, this one is newer.
Structure decided in the 2026-09-03 interview (S1–S4 below); the settled
shape lands in `docs/admin/account-hub.spec.md` (D4/D5) and
`docs/admin/settings.spec.md`, which remain the contract — an IA is where
the shape is argued, a spec is where it is owed.

**(exists)** marks what is built today. Everything else is a move this
document proposes; nothing here is code yet.

## Site map

```
/settings                       Cuenta — the hub (exists)
  ├ (index)                     the person, read-only (exists)
  ├ /settings/credit            Saldo y recargas (exists)
  ├ /settings/direct-payment    Pago directo y conciliación   ← splits out of /settings/business
  ├ /settings/preferences       Preferencias                  ← splits out of /settings/business
  ├ /settings/users             Usuarios (exists)
  ├ /settings/security          Entrar con huella o rostro (exists)
  └ /settings/business          → redirect, permanent (exists as the page being split)
→ /integrations                 Integraciones — a link out of the hub, not a child (exists)
```

Two things this map asserts and the router does not yet:

- `/settings/business` stops being a page and becomes a redirect (S2).
- `/integrations` is reachable from the hub but is **not** under it: it is a
  section of the main nav with its own home (S3).

## Navigation model

- **Primary navigation** — the shell's five sections, unchanged and capped
  at five (FRONTEND law, measured at 360px): Pagos · Cobros · Links ·
  Integraciones · **Cuenta** (the avatar, account-hub D1). Settings has
  exactly one door in the primary nav, and it is a person, not a gear.
- **Secondary navigation** — the hub's rail: the identity card, then the
  group **Negocio** (Saldo y recargas · Pago directo y conciliación ·
  Preferencias · Integraciones · Usuarios), then **Tu cuenta** (passkeys),
  then **Cerrar sesión**. Rows are gated by the role matrix and are hidden,
  never disabled. From `lg` the rail and the sub-page are two columns;
  below `lg` the rail is the page and each row opens full width with
  "Volver a Cuenta" (account-hub D6).
- **Tertiary navigation** — none. The in-page anchor index retired
  2026-09-03 (settings D10): a page of three cards does not need a table of
  contents, and under the nav, the rail and the page title it read as a
  fourth layer. The card **ids** survive it — they are the deep-link
  contract, not navigation. Nothing replaces it after the split: S4's
  ceiling is what keeps a page short enough to not want one.
- **Utility navigation** — the credit chip (sidebar) and the "Saldo bajo"
  strip (phone) deep-link to `/settings/credit`; the missing-CLABE banner
  and the wizard's "Configurar mi CLABE" deep-link to
  `/settings/direct-payment#spei`; Cobros' "Configurar" to
  `/settings/direct-payment`. These are the ambient doors — a setting the
  product needs is linked from where its absence is felt, never only from
  the hub.
- **Mobile navigation** — bottom bar, five items, the avatar carrying the
  credit step glyph (account-hub D3/D8). No header row.

## Content hierarchy

### `/settings` — the hub
1. **Identity card** — who you are, which business, as what role. It answers
   "am I in the right workspace" before any setting can be trusted.
2. **Negocio** — the rows the owner enters for daily (Saldo) and for money
   decisions (Pago directo, Integraciones, Usuarios).
3. **Tu cuenta** — passkeys. Set once, revisited almost never.
4. **Cerrar sesión** — last, and present for every role at every width
   (BUG-016 stays closed).

### `/settings/direct-payment` — Pago directo y conciliación
1. **Pago directo por SPEI** — CLABE, banco, beneficiario, **Cargo por
   servicio SPEI**. The CLABE is the switch that makes the product work at
   all, and the fee is the number a payer sees; since settings D9 the fee has
   exactly one control and it is here.
2. **Política de conciliación** — tolerance and what a surplus means. It is
   the rule the card above is judged by, so it reads second, on the same
   page, never on another.
3. (Nothing below the fold. Two cards is the page.)

### `/settings/preferences` — Preferencias
1. **Zona horaria y hora** — where the day starts and how a time reads
   (settings D5/D6). Display-only: it changes what the reader sees, never
   what the business charges. That is precisely why it left the money page.

### `/settings/credit`, `/settings/users`, `/settings/security`
One card each, unchanged. Their hierarchy is the card's own.

## User flows

### Change the service fee (the flow BUG-017 broke)
1. Owner opens **Cuenta** → **Pago directo y conciliación**.
2. The SPEI card shows the fee **in force**, never a blank with a placeholder.
3. Owner edits the amount → "Guardar pago directo".
   - Amount unreadable or empty → the button is disabled and the field says why.
   - Saved → "Guardado." on the card; the payer's next link shows the new fee.
4. There is no second field anywhere in the admin that writes a service fee.
   (Settings D9. Before it, two cards wrote two different columns and the
   owner could change one and watch the other stand still.)

### Configure the CLABE for the first time
1. The shell shows the missing-CLABE banner, or the wizard offers
   "Configurar mi CLABE".
2. Both land on `/settings/direct-payment#spei` — the card, scrolled to,
   not the hub.
3. Owner types the 18 digits; the bank is **pre-selected from the CLABE's
   prefix** and correctable only from the catalog (direct-payment D16).
   - Role is admin, not owner → the CLABE reads as text and is not offered;
     everything around it still saves (business-and-memberships D3).
4. Saved → the banner goes; transfers are live.

### Top up the balance
1. The credit chip (sidebar) or the "Saldo bajo" strip (phone) → `/settings/credit`.
   - Role without `credit: manage` → no chip action, no row in the rail, and
     a direct visit is sent back to the hub.
2. Owner reads the balance and the entry history, then "Recargar":
   transfer to the platform's CLABE and upload the proof.

### Invite a user
1. **Cuenta** → **Usuarios** → "Invitar".
2. The roles offered are only those the caller may grant.
3. Invitation appears under "Invitaciones pendientes" until accepted.

### Leave
1. **Cuenta** → **Cerrar sesión**, at the foot of the rail, at every width,
   for every role. One door, one place.

## Naming conventions

| Concept | Label in UI | Notes |
|---|---|---|
| The settings area as a whole | **Cuenta** | The nav section and the hub. The door is the person; the business's settings are a group inside (account-hub D1). |
| The channel + its rules | **Pago directo y conciliación** | Two glossary terms joined. **Not "Cobro y conciliación"**: "Cobros" is already the payment-requests section, and one word may name one concept (SPEI glossary law). |
| Display settings | **Preferencias** | The only label here that is a category rather than a thing — deliberate: it is the drawer future display settings land in (S4). |
| The service fee | **Cargo por servicio SPEI** | One control, one label, on the SPEI card (settings D9). No card, row or link named "Cargo por servicio" exists any more. |
| The balance | **Saldo y recargas** | Same words in the chip, the strip, the rail row and the page title. |
| Members | **Usuarios** | Not "Equipo", not "Miembros". |
| Passkeys | **Entrar con huella o rostro** | The action, not the technology. |
| The charging system | **Integraciones** | Plural even with one provider: the catalog is the shape, WispHub is a row in it. |
| ~~Configuración~~ | *(retired as a row label)* | It named a page holding three unrelated things. It survives only as prose, never as a destination — a settings hub whose row is called "settings" tells the reader nothing. |

## Component reuse map

| Component | Used on | Behavior differences |
|---|---|---|
| `AccountLayout` | every `/settings*` route | Two columns from `lg`; below it, index-or-sub-page, never both. |
| `AccountRail` / `RailGroup` / `RailRow` | the hub | Rows filtered by the role matrix; the Integraciones row is the one that leaves the tree (S3). |
| `SubPage` | every sub-page | "Volver a Cuenta" below `lg`; the title is optional — cards that carry their own heading pass none. |
| `SectionCard` | direct-payment, preferences | Card + `h3` + `id` for the anchor; the id is the deep-link contract, so ids outlive the pages they sit on. |
| `CreditCard` · `UsersCard` · `PasskeyCard` | their sub-pages | One card is the whole page; the page adds nothing but the frame. |
| `CreditChip` / `CreditStrip` | shell | Not part of the hub, but their only target is inside it. |

## Content growth plan

The rail grows by rows; a page does not grow by cards (S4).

- **Ceiling**: a sub-page holds at most three cards, four in a pinch. The
  fifth card is the signal to open a row, not to add an anchor. This is the
  rule that would have caught the 3,000px page account-hub D4 had to undo.
- **Where the known arrivals land**: per-integration policy → the
  integration's own page, not here (the business-level policy stays in
  Pago directo y conciliación, pivot D8). Notifications and locale → new
  cards in **Preferencias**, which is why it exists as a drawer rather than
  a page called "Zona horaria". Billing/invoicing → its own row under
  **Negocio**. Editing the person (account-hub open item 1) → the hub's
  identity card, in place.
- **When a second payment channel exists**, the policy card promotes out of
  the direct-payment page into its own row: it will no longer be "the rules
  of this channel" but "the rules of all of them".
- **The rail's own ceiling**: two groups of ≤5 rows. A third group
  ("Avanzado") is what to reach for after that, and only once the screens
  exist to sort into it.

## URL strategy

- **Pattern**: `/settings/<area>` — one level under the hub, never two. An
  area deep enough to need children is a section, not a setting.
- **Routes are identifiers, and therefore English** (the parent IA's rule):
  `/settings/direct-payment`, `/settings/preferences`. The es-MX words are
  labels only. `direct-payment` is the glossary's own key for "pago directo",
  so the path and the spec share a word.
- **No dynamic segments, no query parameters.** Settings are singular per
  business; the business comes from the session, never from the URL.
- **Anchors are a contract.** `#spei`, `#politica`, `#zona` (and the retired
  `#cargo`, `#saldo`, `#usuarios`, `#sesion`) are linked from banners, from
  the wizard and from months of habit. A card that moves takes its id with
  it and the hub's `HASH_HOMES` map re-points the old hash at the new page.
- **No path is deleted, only redirected.** `/settings/business` becomes a
  permanent redirect to `/settings/direct-payment`, and to
  `/settings/preferences` when it carries `#zona`. Five source call sites
  (`AccountHub`, `Shell`, `NewBusinessScreen`, `CobrosScreen`,
  `SettingsScreen`) and six test files reference the old path today; they
  move with the split, and the redirect covers everything outside the repo.

## Decisions (2026-09-03 interview)

- **S1 — The unit is the whole `/settings` tree.** The hub, its sub-pages
  and the doors that lead in are one structure; documenting a single page
  would have argued a card's placement without the rail that reaches it.
- **S2 — Configuración splits into two rows: Pago directo y conciliación,
  and Preferencias.** One page was holding a payment channel, a money rule
  and a clock format — three answers to three unrelated questions, sharing
  a title that named none of them. Split, each row says what it is and the
  in-page index stops being needed to find anything — it was removed the
  same day (settings D10). **Cost, accepted**: a
  second route, a hash migration for `#zona`, and a permanent redirect from
  `/settings/business`. **Rejected**: keeping one page with three cards (the
  cheapest option and the one that made "Configuración" mean nothing);
  moving the policy card next to WispHub's class→action mapping (the policy
  is the business's, not the integration's — pivot D8 — and it would break
  the day a second integration exists).
- **S3 — Integraciones stays in both places, marked as an exit.** It is a
  section of the main nav *and* a row in the hub, because configuring the
  system you charge with is configuration, and because the "Modo
  observación" chip needs a home on the phone (account-hub D10). The row is
  documented as a link that leaves the hub, not a sub-page: same
  destination, one owner. **Rejected**: nav only (loses D10's phone home);
  hub only (buries the reconnection engine's screen one level down).
- **S4 — Growth goes to rows, not to cards.** Ceiling of three-to-four cards
  per sub-page; the fifth opens a row. **Rejected**: accumulating cards in
  one business page behind its anchor index — the exact road to the 3,000px
  page that account-hub D4 has just finished undoing; a third "Avanzado"
  group, which asks us to sort screens that do not exist yet.

## What this costs, if it is built

1. `docs/admin/settings.spec.md` — a decision for the split (D10), the UI
   Contract rewritten for two pages, the anchor map stated.
2. `docs/admin/account-hub.spec.md` — D4's route list and the UI Contract's
   sub-page bullet updated; `HASH_HOMES` gains `zona → /settings/preferences`.
3. `apps/admin/src/router.tsx` — two routes, one redirect.
4. `SettingsScreen.tsx` — split into two screens; the cards move unchanged.
5. Five call sites re-pointed; `settings.test.tsx`, `account-hub.test.tsx`,
   `memberships.test.tsx`, `identity-round.test.tsx`, `a11y.test.tsx`
   updated; the parent IA's Configuración list amended.
