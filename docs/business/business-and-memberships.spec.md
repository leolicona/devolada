---
status: current # phase 2 complete: foundation, payments merge and frontend landed
stories: [US-B01, US-B02, US-B03]
domain: business
updated: 2026-09-02 # identity round: D5 rewritten, D8 amended, D11–D12 added
debt: []
---

# Spec: Business & memberships — the foundation rename

Phase 2 of the pivot (platform/pivot.spec.md, sequencing 2). Three things
land together because each is half-useless without the others: the **D14
rename** (`isps` → `businesses`, the charge/direct-payment pair → one
`payments` table), **workspaces** (one login, many isolated businesses,
US-B02) and **roles** (US-B03), plus the **onboarding minimum** (US-B01).
The design cycle that precedes this spec is `.design/devolada/` (merged
PR #124); its IA decisions are inherited, not re-decided.

## Decisions

- **D1 — Better Auth organizations is the mechanism.** The plugin gives us
  organizations, memberships with roles, member invitations and an
  `activeOrganizationId` on the session — exactly US-B02/B03's shape. One
  organization = one business (auth twin); switching workspace = setting the
  active organization, no re-login. Custom roles via the plugin's access
  control. **Rejected**: hand-rolled `memberships` (re-implements invites,
  role storage and session context the plugin ships, and we already retired
  one hand-rolled invitation system); keeping one-user-per-business (the
  owner's own two-instances case from the pivot interview, D10, needs it).

- **D2 — `businesses` stays the domain table; the organization is its auth
  twin.** `isps` is renamed, not replaced: CLABE, fees, policy and status
  are domain data and never live in auth tables. The link is
  `businesses.orgId` (unique, not null). The middleware resolves
  `session.activeOrganizationId → businesses.orgId` and hangs the business
  on the actor. **Rejected**: storing domain fields in organization
  metadata (auth tables become a second schema with no Zod contract);
  dropping `businesses` for the plugin's table (same reason, inverted).

- **D3 — Four roles, permissions by area, enforced server-side.** The
  matrix (pivot D11, refined by the brief's "roles hide, never tease"):

  | Area | owner | admin | operator | viewer |
  |---|---|---|---|---|
  | Pagos / Cobros / Links — read, proofs | ✓ | ✓ | ✓ | ✓ |
  | Share a link · retry a failed action | ✓ | ✓ | ✓ | — |
  | Configuración: negocio, política, SPEI fee/beneficiary | ✓ | ✓ | — | — |
  | Change the CLABE | ✓ | — | — | — |
  | Saldo y recargas (phase 3) | ✓ | — | — | — |
  | Integraciones (phase 5) | ✓ | ✓ | — | — |
  | Usuarios: read names and roles (D11) | ✓ | ✓ | ✓ | ✓ |
  | Usuarios: invite/remove/change role · see emails and pending invitations (D8, D11, D12) | ✓ | ✓ (operator/viewer only)¹ | — | — |
  | Delete business · transfer ownership | ✓ | — | — | — |

  ¹ *This spec's own refinement, not inherited from pivot D11*: an admin
  may grant only the roles below their own, so the owner stays the only
  source of admins. **Enforced by our route, not by the plugin** — the
  spike measured that the plugin lets an admin invite an admin; it only
  checks `invitation: ["create"]`. The viewer never receives the API key tail or the
  full CLABE (masked to last 4 in their responses). Enforcement is one permission map consulted
  by the middleware per area — never per button. es-MX labels: **Dueño /
  Administrador / Operador / Lector**. `platform_operator` (US-L02) is NOT
  a business role: it is a flag on the user, specced in phase 3.
  **Rejected**: granular per-action permissions (arbitration nobody
  performs solo); trusting the UI to hide (a viewer with curl is still a
  viewer).

- **D4 — The actor is `{ user, businessId, role, business }`.** `Actor`
  loses its `isp` shape: the middleware resolves the active organization,
  loads the business row, and the role from the membership. **Exactly one
  membership → it is activated on sign-in without asking** (the pilot
  user, and most users forever; the IA's plain-label switcher) — the
  plugin does not do this by itself (spike 3): a
  `databaseHooks.session.create.before` hook sets `activeOrganizationId`
  when the user has exactly one membership. Several
  memberships and none active → the API answers `NO_ACTIVE_BUSINESS` and
  the client offers the switcher; no memberships at all → the client
  offers "Crear negocio". Suspension has two levels: `business.status =
  'suspended'` → 403 `ACCOUNT_SUSPENDED` for every member (session row
  revoked, as today); a removed membership → the workspace disappears from
  the switcher and its requests answer 403 `MEMBERSHIP_REVOKED`.

- **D5 — Registration is not onboarding: the business is born with its
  name alone, and how it gets paid is configured afterwards (owner,
  2026-09-02; supersedes the 2026-08-31 wording).** Wizard: one screen —
  the business name — then "Tu negocio está listo" with the one missing
  step named: "Configurar mi CLABE" (Configuración, `#spei`) or "Ir a
  Pagos". `POST /businesses` takes the name; a CLABE may ride along, and
  when it does the bank rides with it (both or neither, refined by Zod —
  a CLABE without its bank poisons every validation, direct-payment D16,
  BUG-007). Until the CLABE lands: the actor carries
  `speiConfigured: false`, the shell shows a banner ("Falta la CLABE del
  negocio…", with the button for whoever may change the CLABE), Links
  and Cobros show the customers but not the share buttons, and the pago
  page keeps answering `SPEI_NOT_CONFIGURED` — nothing moves money
  toward an unconfigured account. The bank in Configuración is still
  **pre-selected from the provider vocabulary** by the CLABE's 3-digit
  prefix and correctable only from that catalog. Every other setting
  starts from platform defaults (operator-panel D1). **Evaluated
  alternatives** (2026-09-02): (B) a shell without a business — the whole
  shell assumes an active business, too costly for the pilot; (C) an
  "Activar cobros" step triggered by the first share — the polished form
  of this decision, possible later; the old wording, name + CLABE in one
  wizard — the owner wanted the platform account and the money setup as
  two moments. **Rejected** (unchanged): free-typed bank (BUG-007
  again); requiring the WispHub key in the wizard.

- **D6 — One `payments` table: the lifecycle absorbs its twin.** Pivot D14
  executed with its real shape. Today a direct payment is TWO rows: the
  `direct_payments` lifecycle (attempts, supersedes chain, proof evidence)
  plus a `charges` twin created on confirmation, carrying the reconnection
  queue. The twin existed because the store channel had charges with no
  direct payment; that reason left with the network. So: **`payments` =
  `direct_payments` renamed**, absorbing from `charges` what the twin
  carried:

  | From `charges` | Into `payments` | Note |
  |---|---|---|
  | `folio` | `folio` (unique, nullable) | assigned on confirmation, as today |
  | `reconnectionStatus/Attempts/reconnectedAt/nextAttemptAt` | same names | the queue rides the payment row now |
  | `wisphubInvoiceId`, `paymentRegisteredAt` | same names | TD-009's guard survives |
  | `lastError` | `reconnectionError` | **split**: `lastError` on the lifecycle is the validation error; the reconnection error is its own column — one name for two failures was only tolerable across two tables |
  | `customerName`, `customerUsuario`, `wisphubCustomerId`, `customerZone`, `customerPhone` | same names | denormalized at confirmation, same reason as receipt D4: the feed must not depend on WispHub being up |
  | `channel` | `channel` (enum `['spei']`) | kept for future channels; `'store'` rows die with the destructive migration |
  | `totalCents` | — | dropped: `receivedCents` is that number (partial-payment D9) |
  | `directPaymentId` / `chargeId` | — | the pair is gone |

  `reconciliationClass` is **born here as a nullable column with no
  semantics** — phase 4's child spec owns its meaning; reserving it now
  saves a second migration of the busiest table. The feed endpoint reads
  `payments` (status `confirmed`/`partial`); its response shape keeps
  `totalCents` as a mapped alias until phase 4 revises charge-feed.spec.md.
  **Rejected**: renaming the two tables and keeping the pair (preserves a
  join that exists for a retired reason); merging attempt rows and
  confirmed record into different tables again under new names (same
  thing, new words).

- **D7 — Destructive migrations, and the dev tenant is reseeded, not
  migrated.** Owner confirmed: no real production data. The migration
  renames `isps`, rebuilds `payments`, and **drops** `stores`,
  `cash_drops`, `ledger_entries`, `customer_contacts` and the store-era
  `invitations` table. Deployed dev gets `/dev/seed` after deploy; local
  D1s are recreated. `payment_links` is untouched — the pilot links in
  WhatsApp chats keep working. **The existing tenants get their auth twin
  by backfill, not by seed**: the pilot ISP lives in dev (prod carries no
  Consta — `wrangler.jsonc` has no `CONSTA_BASE_URL` there), it is not the
  demo row, and `/dev/seed` only links the demo ISP. So the migration runs
  in three steps: `orgId` is added **nullable** → a backfill creates one
  organization plus one **owner** membership per `businesses` row, taking
  the owner from today's 1:1 link `isps.userId` → `orgId` is hardened to
  NOT NULL and `userId` is **dropped** (ownership lives in the membership
  now; a column that says the same thing twice would drift). SQLite allows
  no other order. Idempotent, so a prod tenant table with zero rows is a
  no-op. **The invitation table**: Better Auth names its own `invitation`
  (singular) and ours was `invitations` — **no collision, measured**
  (spike 1: both tables coexisted in one D1). The old one is dropped
  anyway.

- **D8 — Member invitations ride the plugin, wearing our email flow.** The
  owner (any role) and admin (operator/viewer only) invite by email; the
  invitation email goes through the existing Resend adapter with es-MX
  copy; accepting lands in the inviter's business with the assigned role.
  An invited email that already has an account just gains a membership —
  one login, N businesses (US-B02). Measured (spike 5): `createInvitation`
  calls our `sendInvitationEmail` hook with email, role and organization;
  `acceptInvitation` by the invitee's session adds the member row. **Rejected**: join-by-email-domain
  (dangerous magic for money software). **Amended 2026-09-02 (owner)**:
  an invitation lives **48 hours**, written explicitly
  (`invitationExpiresIn` in `better.ts`; the plugin's default is the same
  number and a guarantee that lives in a default is not ours) — the owner
  rejected 7 days: the invitee is the business's own staff, invited by
  email by their boss, with a resend one tap away. Usuarios lists the
  **pending invitations** (email, role, "Vence en N horas" / "Vencida")
  with **Reenviar** (`POST /businesses/invitations/:id/resend`: a fresh
  48 h and a fresh email; an expired row births a new id and the old one
  is retired) and **Cancelar** (`DELETE /businesses/invitations/:id`),
  under the same rank rule as inviting. A second invitation to a pending
  address refreshes it instead of failing. The invitee's side — one form
  that decides for them, the account born verified — is better-auth
  D14; `next` is no longer needed there.

- **D11 — Every member reads the team; the email is the inviter's tool
  (owner, 2026-09-02).** `GET /businesses/members` carried `requireSession`
  alone and answered every member's email to a viewer. The matrix gains
  `members: read` for all four roles and the route guards on it; the
  response carries `email: null` and an empty `pending` list for roles
  that may not invite. Names and roles are the team's; addresses are what
  an inviter needs to resend and recognise. **Rejected**: hiding the team
  from viewers (people work together and should know who is on the
  account); full emails for everyone (a directory nobody asked for).
- **D12 — The role is changed, not re-invited (owner, 2026-09-02).**
  `PATCH /businesses/members/:id` `{role}` through the plugin's
  `updateMemberRole`, under the rank rule that already governs invite and
  remove: the target sits below me today, the new role is one I may
  grant, the owner is nobody's to change, and neither am I. In Usuarios
  the role of a member I could have invited is a picker; everyone else's
  is a label.
- **D9 — The glossary swap and the `ispId` sweep ride the implementation
  PR.** SPEC.md's glossary adopts the pivot table (Negocio/Cobro/Pago);
  `ispId` → `businessId` on every surviving table and identifier; the
  `Actor` type, envelope error codes and tests follow. Docs that say "ISP"
  meaning "the tenant" get the word swapped; historical decisions keep
  their original wording — history is not rewritten.

- **D10 — What this phase does NOT touch.** The pago page and its
  contracts (the payer never sees any of this), Consta, the WispHub
  adapter, the BFF law, the envelope, passkeys (per user, as they are).
  The feed's UI gains nothing yet: phase 4 owns filters, classes and proof
  view. One business per WispHub instance stays the rule (pivot D10) — an
  operator with two instances creates two businesses and switches.

## Schema (target)

- `businesses` (renamed `isps`): + `orgId` text unique not null. Columns
  otherwise unchanged this phase (SPEI config, policy dials, timezone).
- `payments` (renamed `direct_payments` + D6 absorptions): see mapping.
- Plugin tables (organization, member, its invitation table): per the
  spike's verified contract, migrated with Better Auth's own generator.
- Dropped: `stores`, `cash_drops`, `ledger_entries`, `customer_contacts`,
  store-era `invitations`, `charges`.

## Contract (sketch — the implementation PR refines with Zod)

| Route | Actor | Notes |
|---|---|---|
| `POST /businesses` | any signed-in user | creates business + org twin, caller becomes owner; body = `{name}` (+ optional CLABE with its bank, D5) |
| `GET /auth/me` | member | actor now carries `{ business, role, businesses: [{id, name}] }` for the switcher |
| `POST /auth/organization/set-active` (plugin) | member | workspace switch; envelope-exempt like the rest of Better Auth's surface (better-auth D6) |
| `GET/PATCH /settings` | per D3 matrix | 403 `FORBIDDEN_FOR_ROLE` on area violations |
| `GET /businesses/members` | any member (D11) | `{members[{…, email\|null}], grantable, pending[]}` — emails and pending only for inviters |
| `POST /businesses/members` / `PATCH …/:id` / `DELETE …/:id` | owner/admin per D3 | invite (403 `EMAIL_NOT_VERIFIED` unverified, better-auth D13) · change role (D12) · remove |
| `POST /businesses/invitations/:id/resend` / `DELETE …/:id` | owner/admin per D3, rank rule | D8's lifecycle |
| `GET /businesses/invitations/:id/preview` / `POST …/accept-new` | none | better-auth D14 |
| existing `/charges/feed` → `/payments/feed` | member (any role) | **done** — renamed with the table; old path answers 404. The response keeps its `charges` key and `totalCents` alias until charge-feed.spec.md's phase-4 revision |

## UI Contract

- **Wizard** (US-B01, D5 as of 2026-09-02): one screen, the name; the
  done screen names the missing step ("Configurar mi CLABE") and offers
  Pagos; a "Cerrar sesión" door under the card (design review
  "identidad"). The CLABE form lives in Configuración with the bank
  picker seeded by the prefix. The shell wears the CLABE banner until it
  lands; share buttons wait with it.
- **Switcher** (US-B02): header, per the IA — plain label with one
  business; menu + "Crear negocio" with many; switching swaps the query
  cache entirely (no cross-business bleed, tested).
- **Usuarios** (US-B03): members list with role labels (Dueño /
  Administrador / Operador / Lector) — a picker for members I could have
  invited (D12); emails only for inviters (D11); pending invitations with
  Reenviar / Cancelar (D8); invite form, or the verification notice while
  unverified (better-auth D13); remove with confirm dialog. Role-hidden
  rendering everywhere: a control the role cannot use does not render
  (brief law) — asserted in component tests per role.
- States per the IA: loading / error-with-retry / true-empty / role-hidden.

## Scenarios

1. Sign up → create business (name + CLABE + beneficiary) → link page for a
   seeded customer answers — the US-B01 happy path, end to end.
2. CLABE prefix pre-selects the bank; the bank field accepts only catalog
   values (a forged request with a free-text bank → 400, citing D16).
3. *(rewritten 2026-09-02, D5)* The name alone births the business with
   `speiConfigured: false`; an abandoned form creates nothing and the
   next sign-in restarts it. A CLABE without its bank → 400.
4. One user, two businesses: switch swaps feed contents entirely; no row of
   business A renders under business B (US-B02, the isolation test).
5. No active business selected → `NO_ACTIVE_BUSINESS`, client shows switcher.
6. Admin PATCHes the SPEI fee → 200; PATCHes the CLABE → 403
   `FORBIDDEN_FOR_ROLE`.
7. Operator retries a failed reconnection → 200; opens settings → the API
   answers 403 and the UI never rendered the section.
8. Viewer GETs settings → masked CLABE, no key tail; every mutation → 403.
9. Owner invites an admin by email; the invitee with an existing account
   gains the membership without a new signup (US-B02+B03).
10. Admin tries to invite an admin → 403 (D3's matrix, the granting rule).
11. Removed member: switcher loses the workspace; a stale request answers
    `MEMBERSHIP_REVOKED`.
12. Suspended business: every member's next request → 403
    `ACCOUNT_SUSPENDED`, session revoked (carried over from sessions spec).
13. Migration integrity, proven by rows: a confirmed pre-migration direct
    payment appears in the renamed feed with folio, reconnection status
    and customer intact (D6), **and** the pre-migration tenant's user
    signs in, is auto-activated into its backfilled business as owner
    (D7), and its existing payment links still resolve.
14. A `partial` payment keeps its two errors apart: a validation error and
    a later reconnection error land in different columns (D6's split).
15. A viewer lists the team: names and roles, `email: null`, no pending
    list, no grantable roles; the owner sees emails and the pending
    invitation (D11).
16. A fresh invitation expires in 48 h; aged, it lists as "Vencida";
    resend refreshes it to a fresh 48 h and one row per address; cancel
    empties the list; an admin may not resend or cancel an admin's
    invitation (D8).
17. The owner promotes an operator to admin; an admin may not; nobody
    changes the owner or themselves (D12).
18. Born without a CLABE: the shell's banner points the owner at
    Configuración, a viewer sees the sentence without the button; Links
    lists the customers with no share button; the wizard's done screen
    offers "Configurar mi CLABE" (D5).

## Spike (gate, run 2026-08-31 — all green)

`better-auth@1.6.29`'s `organization` plugin on workerd + real D1 via
`vitest-pool-workers` (our test infra), `test/spike-organizations.test.ts`,
5 tests, ~800 ms. Throwaway: it builds its own auth instance and its own
tables, and **the implementation PR deletes it** (its `ALTER TABLE
session` collides with the real migration). Findings:

1. **Tables**: `organization`, `member`, `invitation` (singular) plus
   `session.active_organization_id`. No collision with our `invitations`.
   `creatorRole: "owner"` makes the creator's member row `owner`.
2. **Custom roles work through `createAccessControl` + `hasPermission`**,
   with one rule the guides do not stress: **our statements must spread
   `defaultStatements`** (`better-auth/plugins/organization/access`) and
   the owner/admin roles must carry `organization`/`member`/`invitation`
   permissions — the plugin's own endpoints check them, and a custom `ac`
   without them refused even the owner ("You are not allowed to invite
   users to this organization"). Our area resources (`payments`,
   `settings`, `clabe`, `credit`, `integrations`, `members`, `business`)
   ride alongside.
3. **One membership does not activate itself on sign-in** —
   `activeOrganizationId` stays null. The `databaseHooks.session.create.
   before` hook sets it when the user has exactly one membership; measured
   on the same DB with and without the hook.
4. **The switch**: `setActiveOrganization` moves the session;
   `listOrganizations` lists the user's; a non-member activating a
   foreign org is refused.
5. **Invitations**: `createInvitation` → our `sendInvitationEmail` hook →
   `acceptInvitation` by the invitee (existing account) → member row.
   **The plugin lets an admin invite an admin**: D3's granting rule is
   ours to enforce, in the route, before the plugin call.

Two doors confirmed for the backfill and the seed: `addMember` is the
server-side door (no email), and `signUpEmail`/`signInEmail` keep working
untouched with the plugin loaded.

## Definition of Done

- [x] **Spike first** (the better-auth precedent): organizations plugin
      contract verified — see **Spike** above (2026-08-31).
- [x] Migration 0018 (rename + D7 backfill in three steps + store-era
      drops) runs clean on a fresh local D1 and under the whole suite.
- [x] Deployed dev (2026-09-01, owner): the pilot tenant signed in
      straight into its dashboard as owner, bank data intact, links
      resolving — the D7 backfill held on real rows.
- [x] Scenarios 1–14 automated: API half in
      `apps/api/test/business-memberships.test.ts` (2–11; 1 end to end in
      isp-signup; 12 in sessions; 14 in reconnection-queue), UI half in
      `apps/admin/test/memberships.test.tsx` (1, 4–9); 13 is the deployed
      check above.
- [x] Glossary: Negocio and the roles adopted in SPEC.md; `ispId` →
      `businessId` swept (D9). Cobro/Pago swap with the payments merge.
- [x] charge-feed.spec.md annotated; TASKS.md phase 2 boxes ticked.
- [x] The role matrix asserted at the API layer for every area of D3.
- [x] **Payments merge (D6)** — migration 0019: `payments` absorbs the
      charges twin (copy pattern, twin data joined in), `lastError` split,
      `reconciliationClass` born nullable; the queue and the feed read
      `payments`; scenario 14 automated (reconnection-queue test).
- [x] **Identity round, spec PR (2026-09-02)**: D5 rewritten (name-only
      wizard, the CLABE banner, the share gate), D8 amended (48 h,
      pending list, resend, cancel), D11 and D12 — API in
      `apps/api/test/identity-round.test.ts` (scenarios 15–17, 3 rewritten
      in business-memberships), UI in `apps/admin/test/identity-round.test.tsx`
      and `memberships.test.tsx` (scenario 18, the wizard, the invitation
      page). The journey end to end against the real API:
      `tests/passkey/identity-journey.spec.ts`.
- [x] **Frontend PR**: wizard (D5, bank pre-selected from the CLABE
      prefix — `direct-payments/clabe.ts`), switcher + chooser (US-B02),
      Usuarios + the invitation page (US-B03, D8), role-hidden rendering
      (settings by area, CLABE as text for admins, no share for viewers);
      signup births the user only.
