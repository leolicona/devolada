---
status: in-development
stories: [US-K01, US-K04]
domain: cashbox
updated: 2026-08-17
debt: []
---

# Spec: Cash box screen

The Caja tab. The store sees the ISP's cash it holds (the balance), its earned commission, and the balance-cap notices. Principle from the brief: **the ledger is the truth** — every number on this screen can explain itself.

## Decisions

- **D1 — "Approaching" is 80% of the cap, computed server-side.** The API returns `approaching` and `blocked` as booleans; the UI never does the math. One constant, one owner. Discarded option: a per-store threshold (a setting nobody asked for yet).
- **D2 — Numbers explain themselves by navigation.** Tapping the balance goes to `/ledger` (Movimientos): the balance is literally the SUM of what that screen lists. No hidden math anywhere.
- **D3 — Logout lives here.** Per the IA, utility navigation must not steal a tab. Caja is the store's "my account" corner: store name + "Cerrar sesión".
- **D4 — `lastCashDrop` ships in the contract now, nullable.** The drops feature is the next task, but the schema exists; shipping the field today means that task adds data, not a contract change.
- **D5 — The commission card counts the current drop cycle, not all time (added 2026-08-17, backlog #2, owner request).** "Tu comisión ganada" was the lifetime SUM and only grew — after a year it is a big number that answers nothing. In the shopkeeper's world the drop **is** the corte: a cycle closes with each confirmed entrega, so the card now sums commissions **after the last confirmed drop** (the `cash_drop` ledger entry, which only exists once the ISP confirms — cash-drops D1: the ledger records the agreement, not the promise; a pending drop therefore does not reset the card). The response carries `commissionSince` (ms of that boundary, `null` before the first confirmed drop) so the label can carry the period — **the label rule is the heart of the decision**: a card that says only "Tu comisión ganada" and dawns at $0.00 reads as stolen commission; with a boundary it reads "Tu comisión desde la última entrega", and without one (no drop yet) it keeps the old label and the old meaning. **Rejected**: resetting on *registered* (pending) drops — the store would see its commission vanish while the ISP has not agreed to anything; and a second "lifetime" line on the card — one number per card, and the lifetime total remains derivable in Movimientos, where every commission entry lives (D2's law: numbers explain themselves by navigation).

## Contract

`GET /cashbox` (session cookie, store only)

```
{ storeName, balanceCents, commissionEarnedCents,
  cap: { capCents, approaching, blocked },
  lastCashDrop: null | { id, cents, status, createdAt } }
```

- `balanceCents` = SUM of the store's ledger entries; `commissionEarnedCents` = the commission of the **current drop cycle** (positive number): entries after the last confirmed drop, or all of them before the first (D5). `commissionSince` (ms | null) is that boundary. Both read only through `src/ledger/`.
- `approaching` = balance ≥ 80% of the cap · `blocked` = balance ≥ cap.
- Failures: 401 no session · 403 not a store.

## UI Contract

- Feature folder `src/features/cashbox/`, replaces the Caja placeholder.
- Balance as protagonist at `--font-size-3xl` ("Efectivo del ISP en tu poder"); tapping it goes to `/ledger` (D2).
- Commission below — "Tu comisión desde la última entrega" once a confirmed drop exists (`commissionSince` set), "Tu comisión ganada" before that (D5).
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
7. Commissions before a confirmed drop are excluded; a pending drop does not reset; before any drop the sum is all-time and `commissionSince` is null (US-K01, D5)
8. UI: the commission label carries the period exactly when `commissionSince` is set (D5)

## Definition of Done

- [x] Scenarios 1–3 automated in the API layer (`test/cashbox.test.ts`, 4 tests)
- [x] Scenarios 4–6 automated with Testing Library + MSW (`test/cashbox.test.tsx`, 4 tests)
- [x] Scenarios 7–8 automated (D5; API + component)
- [ ] Manual check on the deployed PWA
