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

- [x] `credit_entries` (append-only house rule) + balance derivation
- [x] Welcome bonus on business creation — per user, first business (D5)
- [x] Fee debit on the terminal verdict, once per payment (US-L03, D2)
- [x] Steps, negative cap, the pause: queued proofs without a provider
      call, release in arrival order, the pago page's calm state in D9's
      voice (US-B06)
- [x] Top-up via platform-validated SPEI (US-B05): both doors, the
      platform's key against the platform's account, the CEP's amount
      credited, its own sweep
- [x] Saldo chip in the shell (label + icon per step), the two banners,
      Saldo y recargas with both doors (US-B04/B05)
- [x] `platform_settings` + `/platform/*` API + the operator secret +
      the `/operador` panel (Reglas / Negocios) (US-L02)

## Phase 4 — Cobros mirror & reconciliation

Child specs: [cobros-live.spec.md](../../docs/reconciliation/cobros-live.spec.md)
(US-R01, US-R04) · [payments-and-classes.spec.md](../../docs/reconciliation/payments-and-classes.spec.md)
(US-R02, US-R03; carries pivot D20 and the trust-layer refs) — written
2026-09-01 after the phase-4 interview. The Cobros section reads WispHub
**live** (owner decision after the spike: the mirror bought nothing a link
open does not already pay), cached 30 s at the api and 2 min in the
client's query memory; the webhook spike ran — no push surface exists.

- [x] Cobros section, live (US-R01, cobros-live D2–D7): `GET
      /payment-requests` through the 30 s display cache; grouped by
      customer, search, Vencidas filter, 50 rows per local page, 2-min
      query memory, freshness + Actualizar; connect/empty/error states.
      Link page lists its own Cobros (US-R04). Feed renamed to **Pagos**
      (`/payments`, response key `payments`, `receivedCents`) —
      payments-and-classes D6, done here so the two words never coexist.
- [x] Reconciliation policy on the business (tolerance, surplus) + class
      computation (exacto/corto/excedente) stored on the payment
- [x] Pagos list: filters (estado/fecha/cliente), class badges, proof quick
      view, action-outcome row (US-R03)
- [x] Cobros section — folded into the live box above (no mirror exists)
- [x] Link page lists open Cobros (US-R04) — the one pago-page change
- [ ] One Consta key per business, issued at business creation (D20)
- [ ] Send `customerRef`/`paymentRef` on every validation **from the moment
      the per-business key exists, not before** (US-V15's cheap half;
      trust-layer D2 chains live in `(apiKeyId, customerRef)`, so refs sent
      under the platform key would bind history to the wrong tenant and the
      key switch would lose it — history cannot be backfilled)
- [x] Nav rename: feed "Cobros" → "Pagos" when both sections exist — done with the Cobros section, above

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
