---
status: in-development
stories: [US-L01]
domain: platform
updated: 2026-08-17
debt: []
---

# Spec: Platform settlement statement

How Devolada gets paid, part one. Every charge carries a platform share (service fee minus the store's commission), the admin already shows it per charge ("Para la plataforma quedan $6.00") — and nothing accumulates it, nothing collects it: the share travels inside the ISP's cash and stays with the ISP. This spec gives the debt a face: a monthly statement in Configuración with exactly what accrued and the reference to transfer with. Backlog item #1, picked up 2026-08-17.

## Decisions

- **D1 — The share is derived, never stored.** Per charge: `charges.service_fee_cents` minus the charge's actual commission ledger entry, joined by `charge_id`. The stored rows already carry historical truth — a fee change or a per-store commission override never rewrites past months, because past charges keep the numbers they were made with. Same law as the balance: one SUM, no snapshot to drift. **Rejected**: a `platform_share` ledger entry per charge — the ledger records the *store's* money movements; the platform's share is the ISP's debt, not the store's, and a third entry type would put it in the wrong book.
- **D2 — A charge accrues when it happens, in the ISP's month.** The service (charge + reconnection) was delivered at the counter; the cash logistics that follow don't change the debt. Months are bounded by the ISP's timezone (settings D5 owns "today"; this spec extends the same rule to "this month"), computed with the same wall-clock math as `startOfBusinessDayMs`. A charge at 21:00 in Hermosillo on the 31st belongs to that month, whatever UTC says.
- **D3 — v1 is the statement, not the collection.** The screen shows the last 12 closed months plus the running one, each with its charge count, accrued share and payment reference `DV-<YYYYMM>-<last 4 of ispId>`. Marking a month as paid, and verifying the transfer, are deliberately out: that is the first real use case of the transfer-validation service (SPEC.md backlog, adjacent product), and building a trust-me "ya pagué" button now would create a state the service would have to migrate later. No new tables, no migration — this feature is a query and a card.
- **D4 — It lives in Configuración.** The split is configured there and the per-charge share is already explained there; the statement is that sentence grown up. A new nav section for one card would be furniture.
- **D5 — Every recorded charge accrues, including `failed` ones.** The store collected the customer's cash either way and the ledger recorded it; a failed reconnection is an operational problem, not a refund. If a correction ever happens, it happens as ledger counter-entries (the ledger law) and D1's join picks it up.

## Contract (ISP session only)

`GET /settlement` →

```
{ months: [ { period: "2026-08", chargeCount, shareCents, reference: "DV-202608-4f2a", current: true } , … ] }
```

- Newest first; the running month carries `current: true`; months with zero charges are omitted.
- Store session → 403 `AUTHENTICATION_ERROR` (the statement is the ISP's debt).
- Window: the last 13 months of charges (12 closed + current); older history is out of v1's scope.

## UI Contract

- Configuración gains a "Liquidación a la plataforma" card: one row per month — month name in es-MX ("agosto 2026"), charge count, `<Amount>`, and the reference in mono. The running month is labeled "En curso".
- The card explains itself in one line: the share accrues per charge and is transferred with the month's reference. No pay button (D3).
- Empty state: "Aquí aparecerá lo acumulado para la plataforma con tu primer cobro."

## Scenarios

1. Charges across two months group by the ISP's month with the right per-charge math, including a store whose commission override differs from the ISP default (US-L01, D1, D2)
2. A charge near a UTC month boundary lands in the ISP-timezone month, not the UTC one (D2)
3. Store session → 403 (contract)
4. UI: the card renders months, amounts, references and the "En curso" label (US-L01)
5. UI: empty state before the first charge (US-L01)

## Definition of Done

- [x] Scenarios 1–3 automated in the API layer (`test/settlement.test.ts`, 3 tests); 4–5 with Testing Library + MSW (`apps/admin/test/settlement.test.tsx`, 2 tests)
- [ ] Manual check on deployed dev: the statement matches the charges made during validation
