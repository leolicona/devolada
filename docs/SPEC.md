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

## Features by Phase

Operational detail in `.design/devolada/TASKS.md` (execution layer).

- **Phase 0 — Risk**: WispHub spike (payment → reactivation). ✅ executed 2026-08-13 (`.design/devolada/WISPHUB_SPIKE.md`); only the physical MikroTik flip pends on the pilot ISP
- **Phase 1 — Foundation**: live tokens ✅ · shared atoms ✅ · API base with sessions ✅ · ISP signup/access ⏳
- **Phase 2 — Store PWA**: shell, search, charge, live result, cash box, cash drops, ledger, special states
- **Phase 3 — Admin Dashboard**: shell, live feed, stores, cash drops, settings
- **Phase 4 — Supporting backend**: reconnection queue, receipts
- **Phase 5 — Polish**: list states, dark mode, responsive, accessibility, design review

## Spec index

| Spec | Domain | Stories | Status |
|------|--------|---------|--------|
| [auth/sessions.spec.md](auth/sessions.spec.md) | auth | US-S01, US-S02, US-S03 | current |
| [auth/isp-signup.spec.md](auth/isp-signup.spec.md) | auth | US-S04, US-S06 | in development |
| auth/store-invitation.spec.md | auth | US-S05 | pending |
| [store-pwa/shell.spec.md](store-pwa/shell.spec.md) | store-pwa | US-S01, US-S02, US-S03 (UI) | in development |
| [charges/customer-search.spec.md](charges/customer-search.spec.md) | charges | US-C01 | in development |
| [charges/charge-confirm.spec.md](charges/charge-confirm.spec.md) | charges | US-C02, US-K04 (partial) | in development |
| [charges/charge-record.spec.md](charges/charge-record.spec.md) | charges | US-C03, US-C04 | in development |
| charges/*.spec.md | charges | US-C05 | pending |
| cashbox/*.spec.md | cashbox | US-K01…K04 | pending |
| cash-drops/*.spec.md | cash-drops | US-E01, US-E02 | pending |
| admin/*.spec.md | admin | US-A01…A04 | pending |

## Cross-cutting layers

- [ARCHITECTURE.md](ARCHITECTURE.md) — global architectural rules
- [FRONTEND.md](FRONTEND.md) — UI laws no feature re-decides
- [CICD.md](CICD.md) — pipeline: trunk-based, per-PR previews, auto dev, gated prod
- [TESTING.md](TESTING.md) — testing rules
- [BUGS.md](BUGS.md) · [TECH_DEBT.md](TECH_DEBT.md)
- [integrations/](integrations/) — third-party contracts (consumed, never re-decided)
- `.design/devolada/` — design layer: brief, IA, tokens, tasks (the design system lives in `packages/ui`)
