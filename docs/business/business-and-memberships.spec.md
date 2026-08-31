---
status: in development
stories: [US-B01, US-B02, US-B03]
domain: business
updated: 2026-08-31
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
  | Usuarios: invite/remove | ✓ | ✓ (operator/viewer only) | — | — |
  | Delete business · transfer ownership | ✓ | — | — | — |

  The viewer never receives the API key tail or the full CLABE (masked to
  last 4 in their responses). Enforcement is one permission map consulted
  by the middleware per area — never per button. es-MX labels: **Dueño /
  Administrador / Operador / Lector**. `platform_operator` (US-L02) is NOT
  a business role: it is a flag on the user, specced in phase 3.
  **Rejected**: granular per-action permissions (arbitration nobody
  performs solo); trusting the UI to hide (a viewer with curl is still a
  viewer).

- **D4 — The actor is `{ user, businessId, role, business }`.** `Actor`
  loses its `isp` shape: the middleware resolves the active organization,
  loads the business row, and the role from the membership. No active
  organization + memberships exist → the API answers `NO_ACTIVE_BUSINESS`
  and the client offers the switcher; no memberships at all → the client
  offers "Crear negocio". Suspension has two levels: `business.status =
  'suspended'` → 403 `ACCOUNT_SUSPENDED` for every member (session row
  revoked, as today); a removed membership → the workspace disappears from
  the switcher and its requests answer 403 `MEMBERSHIP_REVOKED`.

- **D5 — Onboarding collects exactly the pivot's minimum, and the bank is
  picked, never typed.** Wizard: (1) business name → (2) CLABE (18 digits)
  + bank + beneficiary name → (3) done, with "Comparte un link de pago" as
  the first action. The bank is **pre-selected from the provider
  vocabulary** (`BANKS`, settings schema) by the CLABE's 3-digit bank
  prefix and correctable only by picking from that catalog — a typed name
  outside it poisons every future validation with the faceless `invalid`
  (direct-payment D16, BUG-007). Every other setting starts from platform
  defaults; **until `platform_settings` lands (phase 3) those defaults are
  the code constants that exist today** — recorded here so phase 3 knows
  where to look. The welcome-bonus announcement in step 3 appears when
  phase 3 ships it; until then step 3 goes straight to the link.
  **Rejected**: free-typed bank (BUG-007 again); requiring the WispHub key
  in the wizard (a business must reach its dashboard before its
  integration — the pivot's whole point).

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
  WhatsApp chats keep working. **Watch one collision**: the organizations
  plugin ships its own invitation table; the spike (DoD 1) verifies its
  actual name against our dropped `invitations` before the migration is
  written.

- **D8 — Member invitations ride the plugin, wearing our email flow.** The
  owner (any role) and admin (operator/viewer only) invite by email; the
  invitation email goes through the existing Resend adapter with es-MX
  copy; accepting lands in the inviter's business with the assigned role.
  An invited email that already has an account just gains a membership —
  one login, N businesses (US-B02). **Rejected**: join-by-email-domain
  (dangerous magic for money software).

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
| `POST /businesses` | any signed-in user | creates business + org twin, caller becomes owner; body = onboarding step 1–2 fields |
| `GET /auth/me` | member | actor now carries `{ business, role, businesses: [{id, name}] }` for the switcher |
| `POST /auth/organization/set-active` (plugin) | member | workspace switch; envelope-exempt like the rest of Better Auth's surface (better-auth D6) |
| `GET/PATCH /settings` | per D3 matrix | 403 `FORBIDDEN_FOR_ROLE` on area violations |
| `POST /businesses/members` / `DELETE …/:id` | owner/admin per D3 | invitations via plugin + Resend |
| existing `/charges/feed` → `/payments/feed` | member (any role) | route renamed with the table; old path answers 404 (no clients but ours) |

## UI Contract

- **Wizard** (US-B01): three steps, one decision per screen; the bank field
  is a picker seeded by the CLABE prefix (D5); errors in plain es-MX; the
  final screen's single primary action is sharing the first link.
- **Switcher** (US-B02): header, per the IA — plain label with one
  business; menu + "Crear negocio" with many; switching swaps the query
  cache entirely (no cross-business bleed, tested).
- **Usuarios** (US-B03): members list with role labels (Dueño /
  Administrador / Operador / Lector), invite form, remove with confirm
  dialog. Role-hidden rendering everywhere: a control the role cannot use
  does not render (brief law) — asserted in component tests per role.
- States per the IA: loading / error-with-retry / true-empty / role-hidden.

## Scenarios

1. Sign up → create business (name + CLABE + beneficiary) → link page for a
   seeded customer answers — the US-B01 happy path, end to end.
2. CLABE prefix pre-selects the bank; the bank field accepts only catalog
   values (a forged request with a free-text bank → 400, citing D16).
3. Onboarding without CLABE → business exists, links answer "channel
   unavailable" as today; the dashboard nags with the setup banner.
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
13. Migration integrity: a confirmed pre-migration direct payment (dev
    seed) appears in the renamed feed with folio, reconnection status and
    customer intact — the D6 mapping proven by rows, not by reading.
14. A `partial` payment keeps its two errors apart: a validation error and
    a later reconnection error land in different columns (D6's split).

## Definition of Done

- [ ] **Spike first** (the better-auth precedent): organizations plugin
      contract verified in dev — table names (the invitation collision,
      D7), custom roles via access control, `activeOrganizationId`
      behavior on sign-in with N memberships. Findings recorded here.
- [ ] Migrations run clean on a fresh local D1 and on deployed dev
      (reseeded); `payment_links` rows survive by test.
- [ ] Scenarios 1–14 automated, citing their stories.
- [ ] Glossary swap in SPEC.md + `ispId` sweep (D9) in the same PR as the
      rename, spec-lint green.
- [ ] charge-feed.spec.md annotated with the route/table rename; pivot
      spec's phase 2 boxes ticked in TASKS.md.
- [ ] The role matrix asserted at the API layer for every area of D3 —
      the UI's hiding is the second defense, never the only one.
