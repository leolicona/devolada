# TASKS — pivot execution layer (phases 2–5)

Ordered build plan for the pivot's sequencing (platform/pivot.spec.md).
Every task lands through its child spec; a ✅ here means built, specced and
tested. Phase 1 (extraction) executed 2026-08-31 (PR #123).

## Phase 2 — Foundation rename & workspaces

Child spec: `docs/business/business-and-memberships.spec.md` (US-B01–B03).

- [x] Design cycle (this folder) reviewed by the owner (PR #124)
- [x] Child spec written and registered (PR #125); organizations spike
      green 2026-08-31 (spec's Spike section)
- [x] D14 migrations, half 1: `isps` → `businesses` with the D7 backfill;
      store-era tables dropped (migration 0018)
- [x] D14 migrations, half 2: `charges` + `direct_payments` → `payments`
      (spec D6, migration 0019)
- [x] Glossary swap in SPEC.md: Negocio, roles, Pago (Cobro arrives with phase 4)
- [x] Better Auth organizations: memberships, roles enforced in the
      middleware by area (API) and hidden by area in the admin
- [x] Create-business + switch (API + switcher/chooser UI, US-B02)
- [x] Onboarding wizard UI (US-B01): name → CLABE (bank from prefix) →
      first link; signup births the user only
- [x] Usuarios page + invitation link page (US-B03, D8)

## Phase 3 — Prepaid credit & operator panel

Child specs: [prepaid-credit.spec.md](../../docs/platform/prepaid-credit.spec.md) (US-B04–B06, US-L03) · [operator-panel.spec.md](../../docs/platform/operator-panel.spec.md) (US-L02) — written 2026-09-01 after the phase-3 interview.

- [ ] `credit_entries` (append-only house rule) + balance derivation
- [ ] Welcome bonus on business creation (platform default)
- [ ] Fee debit per confirmed validation, never per attempt (US-L03)
- [ ] Warnings at 20% and 0; negative cap; paused state + queued proofs
      (US-B06 — pago-page copy carries D6's voice)
- [ ] Top-up via platform-validated SPEI (US-B05): reference per business,
      proof flow reusing the pago machinery
- [ ] Saldo chip in the shell + Saldo y recargas page (US-B04)
- [ ] `platform_settings` table (append-only) + `/operador` panel (US-L02)

## Phase 4 — Cobros mirror & reconciliation

Child specs: cobros mirror (US-R01, US-R04) · classes & payments surfaces
(US-R02, US-R03). Includes Consta programmatic key issuance (pivot D20,
amends US-V05 — its own decision in the child spec).

- [ ] `payment_requests` mirrored from WispHub; refresh at link-open, before
      verdict, periodic sweep (pivot D4)
- [ ] Reconciliation policy on the business (tolerance, surplus) + class
      computation (exacto/corto/excedente) stored on the payment
- [ ] Pagos list: filters (estado/fecha/cliente), class badges, proof quick
      view, action-outcome row (US-R03)
- [ ] Cobros section (read-only mirror, freshness label)
- [ ] Link page lists open Cobros (US-R04) — the one pago-page change
- [ ] One Consta key per business, issued at business creation (D20)
- [ ] Send `customerRef`/`paymentRef` on every validation **from the moment
      the per-business key exists, not before** (US-V15's cheap half;
      trust-layer D2 chains live in `(apiKeyId, customerRef)`, so refs sent
      under the platform key would bind history to the wrong tenant and the
      key switch would lose it — history cannot be backfilled)
- [ ] Nav rename: feed "Cobros" → "Pagos" when both sections exist

## Phase 5 — Integrations hub

Child spec: integrations hub (US-I01–I03); formally amends
provisional-release D10 (pivot Open item 1).

- [ ] Integrations catalog + WispHub detail page (key reuses settings D1–D3)
- [ ] Class → action mapping UI (three rows; threshold % + floor $ in corto)
- [ ] Master switch → modo observación (shell badge; outcome `observation`)
- [ ] Provisional release as a pre-verdict switch on the integration page;
      revocation declared as an adapter action
- [ ] Internal event dispatch with acknowledgment (Open item 5 constraints)
- [ ] WispHub key setting moves from Configuración to Integraciones

## Cross-cutting, every phase

- Tests cite their story (TESTING.md rule 1); scenarios of each child spec
  are the minimum
- Light + dark, contrast-lint, axe pass on every new screen
- States: loading / error-with-retry / true-empty / role-hidden
- IMPI filing for "Devolada" (pivot Open item 3) — owner task, non-blocking
