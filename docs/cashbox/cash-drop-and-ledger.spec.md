---
status: in-development
stories: [US-K02, US-K03]
domain: cashbox
updated: 2026-08-14
debt: []
---

# Spec: Record cash drop & ledger screen

The store records a cash handover (entrega) that stays pending until the ISP confirms it, and the Movimientos tab finally shows the entries that the Caja balance sums.

## Decisions

- **D1 — The ledger entry is written on confirmation, not on record.** Recording a drop creates only a `cash_drops` row in `pending`. The `cash_drop` ledger entry (−cents) is written when the ISP confirms (admin task) — the ledger is the *agreed* truth, and a disputed drop then needs no counter-entries. While pending, Caja shows the drop with its badge; the balance still counts the cash because it is physically in the store until the handover completes.
- **D2 — One pending drop at a time.** A second record while one is pending → 409 `DROP_ALREADY_PENDING`. Overlapping commitments could promise more cash than the store holds.
- **D3 — The amount can only go down.** Suggested amount = the full balance; anything above it → 400 `AMOUNT_EXCEEDS_BALANCE`. You cannot hand over money you do not hold.
- **D4 — Ledger rows carry their context.** Entries joined with their charge show "Cobro · <customer>" and the folio. A bare type + amount would force the shopkeeper to guess.
- **D5 — "Load more" instead of infinite scroll; no per-entry detail screen yet.** The row already shows type, context, folio and signed amount — a detail screen would repeat it. Revisited when entries carry more (receipts, disputes).

## Contract

`POST /cash-drops` (store session) — body `{ cents }`

- 201: `{ id, cents, status: "pending", createdAt }`
- 400 `AMOUNT_EXCEEDS_BALANCE` (also for cents < 1) · 409 `DROP_ALREADY_PENDING` · 401/403 as usual.
- Writes **no ledger entry** (D1).

`GET /ledger?cursor=<ms>` (store session)

- `{ entries: [ { id, type, cents, createdAt, reference: { folio, customerName } | null } ], nextCursor: number | null }`
- Newest first, 20 per page; `cursor` = `createdAt` of the last row of the previous page.

## UI Contract

- `/cashbox/drop`: current balance shown, amount input **prefilled with the balance** (pesos), editable downward. The form waits for the balance before it renders the field (fixed 2026-08-14): while the request was in flight, the prefill could land on top of an amount the shopkeeper had already typed. Submit → back to Caja, where the pending drop appears with its badge. Plain es-MX errors for both guards.
- `/ledger` (Movimientos): rows grouped by day (es-MX date headers). Row: label by type (Cobro · name / Comisión / Entrega al ISP), folio when present, signed amount (`+` green for charges, `−` for the rest). "Cargar más" while `nextCursor` exists; honest empty state for a new store.

## Scenarios

1. Recording a drop creates a pending row and **no ledger entry**: the balance does not move (US-K02, D1)
2. Amount above the balance → 400; a second pending drop → 409 (D2, D3)
3. The ledger lists entries newest-first with charge references, and the cursor pages (US-K03, D4)
4. UI: the drop form prefills the balance, submits, and Caja shows the pending drop (US-K02)
5. UI: an amount above the balance shows a plain error and does not submit (D3)
6. UI: Movimientos shows labeled rows with signed amounts; empty state for a new store (US-K03)

## Definition of Done

- [x] Scenarios 1–3 automated in the API layer (`test/cash-drop-ledger.test.ts`, 3 tests)
- [x] Scenarios 4–6 automated with Testing Library + MSW (`test/cash-drop-ledger.test.tsx`, 4 tests)
- [ ] Manual check on the deployed PWA
