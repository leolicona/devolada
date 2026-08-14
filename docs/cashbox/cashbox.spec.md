---
status: in-development
stories: [US-K01, US-K04]
domain: cashbox
updated: 2026-08-14
debt: []
---

# Spec: Cash box screen

The Caja tab. The store sees the ISP's cash it holds (the balance), its earned commission, and the balance-cap notices. Principle from the brief: **the ledger is the truth** — every number on this screen can explain itself.

## Decisions

- **D1 — "Approaching" is 80% of the cap, computed server-side.** The API returns `approaching` and `blocked` as booleans; the UI never does the math. One constant, one owner. Discarded option: a per-store threshold (a setting nobody asked for yet).
- **D2 — Numbers explain themselves by navigation.** Tapping the balance goes to `/ledger` (Movimientos): the balance is literally the SUM of what that screen lists. No hidden math anywhere.
- **D3 — Logout lives here.** Per the IA, utility navigation must not steal a tab. Caja is the store's "my account" corner: store name + "Cerrar sesión".
- **D4 — `lastCashDrop` ships in the contract now, nullable.** The drops feature is the next task, but the schema exists; shipping the field today means that task adds data, not a contract change.

## Contract

`GET /cashbox` (session cookie, store only)

```
{ storeName, balanceCents, commissionEarnedCents,
  cap: { capCents, approaching, blocked },
  lastCashDrop: null | { id, cents, status, createdAt } }
```

- `balanceCents` = SUM of the store's ledger entries; `commissionEarnedCents` = the accumulated commission (positive number). Both read only through `src/ledger/`.
- `approaching` = balance ≥ 80% of the cap · `blocked` = balance ≥ cap.
- Failures: 401 no session · 403 not a store.

## UI Contract

- Feature folder `src/features/cashbox/`, replaces the Caja placeholder.
- Balance as protagonist at `--font-size-3xl` ("Efectivo del ISP en tu poder"); tapping it goes to `/ledger` (D2).
- Earned commission below ("Tu comisión"), in success ink — it is their money.
- Cap notices: approaching → amber "Registra una entrega pronto" · blocked → amber "Tu caja llegó a su límite…".
- Last cash drop with its `StatusBadge` when it exists.
- "Registrar entrega" button → `/cashbox/drop` (honest placeholder until the next task).
- Store name + "Cerrar sesión" (POST `/auth/logout`, then `/login`).

## Scenarios

1. Balance and earned commission computed from ledger entries (US-K01)
2. `approaching` at 80% of the cap; `blocked` at the cap (US-K04)
3. Store sessions only: 401 without session, 403 for an ISP (guard)
4. UI: shows store name, balance and commission from the API (US-K01)
5. UI: the approaching notice appears when the API says so (US-K04)
6. UI: "Cerrar sesión" logs out and lands on `/login` (D3)

## Definition of Done

- [x] Scenarios 1–3 automated in the API layer (`test/cashbox.test.ts`, 4 tests)
- [x] Scenarios 4–6 automated with Testing Library + MSW (`test/cashbox.test.tsx`, 4 tests)
- [ ] Manual check on the deployed PWA
