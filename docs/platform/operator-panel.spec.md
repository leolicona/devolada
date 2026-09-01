---
status: in development
stories: [US-L02]
domain: platform
updated: 2026-09-01
debt: []
---

# Spec: The operator panel — `platform_settings` and the platform's hands

Phase 3 of the pivot (platform/pivot.spec.md, sequencing 3), second
half. The rules no business decides (pivot D13) get one home with a
history, and the platform gets hands: adjust a balance, negotiate a fee,
see every business's credit. Decided with the owner in the phase-3
interview (2026-09-01). Its consumer is
[prepaid-credit.spec.md](prepaid-credit.spec.md).

## Decisions

- **D1 — `platform_settings` is append-only rows, one key at a time, and
  the current value is the latest row.** Table: `key`, `value` (text; the
  key's type is known in code), `author_user_id`, `created_at`. Reading a
  key = latest row for it; writing = inserting a row. Keys at birth, with
  their types and validation:

  | Key | Type | Birth value | Validation |
  |---|---|---|---|
  | `validation_fee_cents` | integer cents | 500 | 100 ≤ v ≤ 5000 |
  | `welcome_bonus_validations` | integer | 20 | 0 ≤ v ≤ 100 |
  | `negative_cap_cents` | integer cents | 5000 | 0 ≤ v ≤ 50000 |
  | `topup_min_cents` | integer cents | 5000 | 0 ≤ v ≤ 100000 |
  | `topup_clabe` | 18 digits | — (unset until the operator types it) | `^\d{18}$` |
  | `topup_bank` | catalog pick | — | one of `BANKS` (direct-payment D16) |
  | `topup_beneficiary` | text | — | 3–120 chars |
  | `default_timezone` | allow-list | `America/Mexico_City` | settings D5's list |
  | `default_fee_payer` | enum | `isp` (business absorbs) | `customer \| isp` (direct-payment D19) |

  A key with no row answers its birth value from code — so the platform
  works before the panel is ever opened, and a missing `topup_clabe`
  means "top-ups unavailable", said out loud in Saldo y recargas.
  **The retry schedule is not a key**: learned-retry (US-V16) governs the
  middle from Consta and D7's skeleton is a measured constant.
  **Rejected**: a generic key/value editor (a typo in a fee key charges
  $500 or $0 with nothing in the way); a mutable row per key (the history
  is the point: who set the fee, when).

- **D2 — The operator is named in a Worker secret, never in the app.**
  `PLATFORM_OPERATOR_EMAILS` (comma-separated) in wrangler secrets; the
  middleware derives `actor.platformOperator` from the session user's
  email. Nobody can grant it from any screen; changing it is a deploy with
  the prod approval gate — exactly as slow as it should be. Today: the
  owner. **Rejected**: a `user.platform_operator` column set by hand in D1
  (a remote `UPDATE` by hand is the gesture the project avoids); a
  business role (pivot D11: it is not one).

- **D3 — The panel is a route in the admin, hidden unless you are the
  operator.** `app.…/operador` (pivot D19's map, confirmed after
  reopening): it reuses the session, the shell, the tokens and the test
  infrastructure; the API guard (`requirePlatformOperator`) is the real
  defense, the hidden route the second. `operador.` stays reserved if
  isolation is ever needed. **Rejected** (reopened and declined): a
  separate `apps/operador` on its own subdomain — another build, deploy,
  domain and login for one operator and nine keys, with the same guard in
  the API anyway.

- **D4 — Every write names its author and lands as a row.** The panel
  saves one key per action; the API validates against D1's table and
  appends `(key, value, author, now)`. The screen shows, per key, the
  current value and its last five rows (value · author · date). There is
  no delete and no edit of a row — a wrong value is fixed by a new row.

- **D5 — Adjustments are entries with a reason.** `POST
  /platform/businesses/:id/adjustments` `{ cents (signed), reason (≥ 10
  chars) }` appends a `credit_entries` row of kind `adjustment` with
  `author_user_id` (prepaid-credit D3). The business sees it in its
  history as "Ajuste" with the reason. No UI deletes it: a mistaken
  adjustment gets a counter-adjustment. **Rejected**: adjustments by SQL
  (an edit instead of an insert breaks the append-only rule the first time
  someone is in a hurry).

- **D6 — The fee override is the operator's, per business.** `PATCH
  /platform/businesses/:id` `{ feeOverrideCents: integer | null }` writes
  `businesses.fee_override_cents` (prepaid-credit D4); the business sees
  its effective fee in Saldo y recargas but never edits it.

- **D7 — The businesses table is the operator's map.** `GET
  /platform/businesses?q` lists every business with its derived balance,
  step, effective fee, owner email and creation date, searchable by name
  or by **an owner's email through the memberships** (never the signup
  copy on the business row, which stops being the owner after a transfer
  — business-and-memberships D11; PR #132 review); a row opens the adjustment and override forms and the
  business's entry history. Read-only otherwise: the operator does not
  impersonate a business (no switch into it, no editing its CLABE).

## Schema

- `platform_settings`: `id`, `key`, `value` text, `author_user_id` →
  `user.id`, `created_at`. Index `(key, created_at)`.
- `env.ts`: `PLATFORM_OPERATOR_EMAILS?: string`; `Actor.platformOperator:
  boolean`.
- Consumes `credit_entries` and `businesses.fee_override_cents`
  (prepaid-credit spec).

## Contract (all under `requireSession` + `requirePlatformOperator`; 403 `NOT_PLATFORM_OPERATOR` otherwise)

| Route | Notes |
|---|---|
| `GET /platform/settings` | every key of D1 with `{ current, birth, history: last 5 }` |
| `POST /platform/settings/:key` | `{ value }` validated per D1; 400 `INVALID_SETTING` on a bad value or unknown key; appends |
| `GET /platform/businesses?q` | D7's list |
| `GET /platform/businesses/:id` | detail + entries |
| `PATCH /platform/businesses/:id` | `{ feeOverrideCents }` (D6) |
| `POST /platform/businesses/:id/adjustments` | D5 |

`/auth/me` gains `platformOperator: boolean` so the admin decides whether
to show the route at all.

## UI Contract

- Sidebar gains an "Operador" entry **only** when `platformOperator` —
  outside the five business sections (it is not one); the route redirects
  to `/` for anyone else.
- `/operador`: two tabs (shadcn Tabs, already in the admin) — **Reglas**
  (D1's keys as typed fields with their history) and **Negocios** (D7's
  table; row → detail with adjustment and override forms). Money fields
  carry the sign (design-review D8), `<Amount>` everywhere.
- Boring on purpose (IA): no dashboards, no charts.

## Scenarios

1. A user whose email is in `PLATFORM_OPERATOR_EMAILS` gets
   `platformOperator: true` in `/auth/me`; anyone else `false`, and every
   `/platform/*` route answers 403 `NOT_PLATFORM_OPERATOR` — including an
   owner of every business (D2).
2. Fresh database, no rows: `GET /platform/settings` answers the birth
   values; `topup_clabe` reads as unset and Saldo y recargas says top-ups
   are unavailable (D1).
3. `POST /platform/settings/validation_fee_cents { value: 300 }` appends a
   row with the operator as author; the next confirmed payment pays $3.00
   (prepaid-credit scenario 6); the history shows both rows (D4).
4. `{ value: 50 }` for the fee → 400 `INVALID_SETTING` (below 100);
   `POST /platform/settings/retry_schedule` → 400 (unknown key).
5. `topup_bank` with a name outside `BANKS` → 400 (D16 holds here too).
6. An adjustment of +$20.00 with reason "Cortesía piloto: doble cobro
   del 30/08" → `credit_entries` row with author; the business's history
   shows "Ajuste · Cortesía piloto…"; a reason under 10 chars → 400 (D5).
7. Fee override set to 300, then to null → the business pays $3.00, then
   $5.00 again (D6).
8. `GET /platform/businesses?q=wifi` finds by name and by owner email; the
   balance in the row equals the SUM of that business's entries (D7).
9. The admin shows "Operador" in the sidebar only for the operator;
   `/operador` opened by a non-operator redirects to `/`.

## Definition of Done

- [x] `platform_settings` migrated (0020); the seed writes nothing (birth
      values live in code — D1).
- [x] `PLATFORM_OPERATOR_EMAILS` documented in CICD.md and synced by both
      deploy workflows (warning when unset: the panel is closed to everyone).
- [ ] Set on deployed dev (owner's GitHub environment secret).
- [x] Scenarios 1–8 automated (`test/prepaid-credit.test.ts`); 9 is the
      admin's, with the panel UI.
- [ ] The operator sets the real `topup_clabe` on deployed dev and
      prepaid-credit's real top-up (its DoD) runs against it.
- [ ] pivot.spec.md D13's list matched against D1's table (D13 said
      "retry schedule"; D1 says no — noted there).
