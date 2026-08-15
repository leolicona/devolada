# Devolada — SPEC

The project's sacred index. **Golden rule: if it exists in the code but is not here, it's wrong.**

A network of payment points in neighborhood corner stores for ISPs running WispHub. The customer pays their monthly internet fee at the store around the corner, their service reconnects automatically within seconds, the store earns a commission with zero investment, and the ISP collects faster without field collection runs.

## Spec-driven workflow rules (adapted)

1. Every new feature: interview → justified decisions (D1…Dn as mini-ADRs: decision + discarded alternatives + why) → reserve a US-ID here → write `docs/<domain>/<feature>.spec.md` → register it in this index **within the same PR**.
2. The `.spec.md` is updated with reality during development; it never forks.
3. **Lite path**: bugfixes, typos and copy tweaks carry no spec or plan — they carry an entry in `BUGS.md` (if production was affected) and a test. The threshold: if a business rule or contract changes, it's a spec; otherwise it's the lite path.
4. `.plan.md` files are **ephemeral**: deleted or archived on merge. Only the spec is maintained.
5. On completion: conscious debt → `TECH_DEBT.md`; production defects → `BUGS.md`.
6. Tests cite their story (`US-C02: charges the exact monthly fee…`) so spec coverage can be traced with grep.

## Glossary

Single source of vocabulary. UI copy is **es-MX** (the product ships in Mexico); code identifiers are English. One word per concept, no synonyms.

| Concept | UI copy (es-MX) | Code (English) | Never |
|---------|-----------------|----------------|-------|
| Customer payment transaction | **Cobro** | `charge` | "pago" (only on the end-customer receipt) |
| Store's continuous balance | **Caja** / **Balance** | `balance` (derived) | "corte" |
| Cash handover to the ISP | **Entrega** | `cash_drop` | "corte" |
| Fee paid by the end customer | **Cargo por servicio** | `service_fee` | — |
| Store's earnings | **Comisión** | `commission` | (never shown to the end customer) |
| Ledger entry | **Movimiento** | `ledger_entry` | — |
| MikroTik reactivation | **Reconexión** | `reconnection` (`queued/reconnected/failed`) | — |
| Receipt with unique folio | **Comprobante** / **Folio** | `receipt` / `folio` | "ticket" |
| Store's initial access | **Invitación** | `invitation` (`sent/accepted`) | — |
| Balance threshold | **Techo de saldo** | `balance_cap` | — |

## User Stories

### Auth & sessions (S)
- **US-S01** — As a store, I log in with phone + password and my session lasts for weeks on my device.
- **US-S02** — As a signed-in user, I never see "session expired" during normal operation: tokens renew on their own.
- **US-S03** — As an ISP, suspending a store revokes its access immediately, even mid-session.
- **US-S04** — As an ISP, I sign up with email + password and verify my email (Resend) before operating.
- **US-S05** — As a store, I receive an invitation via WhatsApp/SMS and set my password from the link.
- **US-S06** — As an ISP, I recover my password by email; as a store, the ISP re-sends my invitation.

### Charges (C)
- **US-C01** — As a store, I search for the customer by ID, phone or name and see only the minimum needed to confirm their identity.
- **US-C02** — As a store, I charge the exact monthly fee with a visible breakdown (monthly fee + service fee).
- **US-C03** — As an end customer, my service reconnects automatically within seconds after paying; the store sees the status live.
- **US-C04** — As a store, a charge is never rejected because of WispHub failures: it gets recorded and the reconnection is queued with retries.
- **US-C05** — As an end customer, I receive a receipt via WhatsApp/SMS with a unique folio.

### Cash box (K)
- **US-K01** — As a store, I see my balance (the ISP's cash in my hands) and my accumulated commission; every number breaks down into its ledger entries.
- **US-K02** — As a store, I record a cash drop that stays pending until the ISP confirms it.
- **US-K03** — As a store, I browse my immutable ledger (charges, commissions, cash drops).
- **US-K04** — As a store, the balance cap warns me as I approach it and blocks charges once exceeded, with a clear explanation.

### Cash drops — admin side (E)
- **US-E01** — As an ISP, I confirm receipt of a cash drop and the store's balance goes down.
- **US-E02** — As an ISP, I dispute a cash drop with a note if the amount doesn't match; both sides see the same ledger to resolve it.

### Admin (A)
- **US-A01** — As an ISP, I watch charges appear in real time with their reconnection status; failed ones demand my attention.
- **US-A02** — As an ISP, I register stores and send them invitations; I can re-send one while it hasn't been accepted.
- **US-A03** — As an ISP, I manage each store: commission, balance cap, suspend, view its ledger.
- **US-A04** — As an ISP, I configure my WispHub API Key (validated live), the service fee and the commission split.

### Polish & reliability (P)
- **US-P01** — As a user of either app, a failed request tells me so and lets me retry; it never shows me an empty state that says I have nothing.
- **US-P02** — As a user, the app follows my system's light or dark preference, and dark is a real palette, not an inversion.
- **US-P03** — As a store, the PWA works on a 360px phone; as an ISP, the admin works on my phone when I confirm a handover away from the desk.
- **US-P04** — As a user with low vision or a screen reader, every status reaches me as icon + text, contrast holds, and the feed announces what changed.
- **US-P05** — As a user of either app, every list row tells me what it is about, and every word and colour means one thing across both surfaces.

## Features by Phase

Operational detail in `.design/devolada/TASKS.md` (execution layer).

- **Phase 0 — Risk**: WispHub spike (payment → reactivation). ✅ executed 2026-08-13 (`.design/devolada/WISPHUB_SPIKE.md`); only the physical MikroTik flip pends on the pilot ISP
- **Phase 1 — Foundation**: live tokens ✅ · shared atoms ✅ · API base with sessions ✅ · ISP signup/access ⏳
- **Phase 2 — Store PWA**: shell, search, charge, live result, cash box, cash drops, ledger, special states
- **Phase 3 — Admin Dashboard**: shell ✅ · live feed ✅ · stores ✅ · cash drops ✅ · settings ✅
- **Phase 4 — Supporting backend**: reconnection queue ✅ · receipts ✅ (manual `wa.me` until TD-003)
- **Phase 5 — Polish**: list states ✅ (US-P01) · dark mode ✅ (US-P02) · responsive ✅ (US-P03) · accessibility ✅ (US-P04) · design review ✅ (US-P05)

## Spec index

| Spec | Domain | Stories | Status |
|------|--------|---------|--------|
| [auth/sessions.spec.md](auth/sessions.spec.md) | auth | US-S01, US-S02, US-S03 | current |
| [auth/isp-signup.spec.md](auth/isp-signup.spec.md) | auth | US-S04, US-S06 | in development |
| [auth/store-invitation.spec.md](auth/store-invitation.spec.md) | auth | US-S05 | in development |
| [store-pwa/shell.spec.md](store-pwa/shell.spec.md) | store-pwa | US-S01, US-S02, US-S03 (UI) | in development |
| [charges/customer-search.spec.md](charges/customer-search.spec.md) | charges | US-C01 | in development |
| [charges/charge-confirm.spec.md](charges/charge-confirm.spec.md) | charges | US-C02, US-K04 (partial) | in development |
| [charges/charge-record.spec.md](charges/charge-record.spec.md) | charges | US-C03, US-C04 | in development |
| [charges/reconnection-queue.spec.md](charges/reconnection-queue.spec.md) | charges | US-C03, US-C04 (retries) | in development |
| [charges/receipt.spec.md](charges/receipt.spec.md) | charges | US-C05 | in development |
| [cashbox/cashbox.spec.md](cashbox/cashbox.spec.md) | cashbox | US-K01, US-K04 | in development |
| [cashbox/cash-drop-and-ledger.spec.md](cashbox/cash-drop-and-ledger.spec.md) | cashbox | US-K02, US-K03 | in development |
| [cash-drops/confirm-cash-drop.spec.md](cash-drops/confirm-cash-drop.spec.md) | cash-drops | US-E01, US-E02 | in development |
| [admin/shell.spec.md](admin/shell.spec.md) | admin | US-S04, US-S06 (UI) | in development |
| [admin/charge-feed.spec.md](admin/charge-feed.spec.md) | admin | US-A01 | in development |
| [admin/stores.spec.md](admin/stores.spec.md) | admin | US-A02, US-A03 | in development |
| [admin/settings.spec.md](admin/settings.spec.md) | admin | US-A04 | in development |
| [polish/list-states.spec.md](polish/list-states.spec.md) | polish | US-P01 | in development |
| [polish/dark-and-contrast.spec.md](polish/dark-and-contrast.spec.md) | polish | US-P02, US-P04 (contrast) | in development |
| [polish/accessibility.spec.md](polish/accessibility.spec.md) | polish | US-P04 | in development |
| [polish/responsive.spec.md](polish/responsive.spec.md) | polish | US-P03, US-P02, US-P04 (rendered) | in development |
| [polish/design-review.spec.md](polish/design-review.spec.md) | polish | US-P05, US-P03, US-P04, US-P02 | in development |

## Cross-cutting layers

- [ARCHITECTURE.md](ARCHITECTURE.md) — global architectural rules
- [FRONTEND.md](FRONTEND.md) — UI laws no feature re-decides
- [CICD.md](CICD.md) — pipeline: trunk-based, per-PR previews, auto dev, gated prod
- [TESTING.md](TESTING.md) — testing rules
- [BUGS.md](BUGS.md) · [TECH_DEBT.md](TECH_DEBT.md)
- [integrations/](integrations/) — third-party contracts (consumed, never re-decided)
- `.design/devolada/` — design layer: brief, IA, tokens, tasks (the design system lives in `packages/ui`)
