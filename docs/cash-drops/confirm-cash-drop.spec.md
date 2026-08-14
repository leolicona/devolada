---
status: in-development
stories: [US-E01, US-E02]
domain: cash-drops
updated: 2026-08-14
debt: []
---

# Spec: Confirm & dispute cash drops

The Entregas section: the ISP sees every handover a store declared, confirms the cash it received, or disputes it with a note. Confirming is the moment the `cash_drop` ledger entry is finally written — the promise `cashbox/cash-drop-and-ledger.spec.md` D1 left open.

## Decisions

- **D1 — Confirming writes the ledger entry; disputing writes nothing.** A confirmed drop appends `cash_drop` (−cents) stamped at confirmation time, and the store's balance goes down. A disputed drop leaves the ledger untouched: nothing was agreed, so there is nothing to correct. This is what lets an append-only ledger work without counter-entries on the most common disagreement in the business.
- **D2 — Dispute is terminal and its note is required.** A disputed drop cannot be confirmed later → 409 `DROP_NOT_PENDING`. The two sides count the cash in person and the store records a **new** drop (allowed: cashbox D2 only blocks a second *pending* drop). The note is mandatory — a dispute with no reason is an accusation the store cannot answer. **Rejected**: an editable amount on confirm ("I received 800 of the 1,000 declared"), because it hides a disagreement inside a number and the ledger would then record an agreement that never happened.
- **D3 — Tenant scope travels through the store.** `cash_drops` carries no `ispId`, and neither does `ledger_entries`: both hang off a store, and the store carries the tenant. Every admin query joins `stores` and filters by `ispId`. **Rejected**: adding an `ispId` column — a second source of truth for the same fact, free to drift if a store ever moves.
- **D4 — Two scopes, one endpoint.** `scope=pending` (needs action; unpaged, bounded by the number of stores since each store holds at most one) and `scope=resolved` (history, 20 per page). **Rejected**: one merged list, which would show a pending drop twice — once as an action, once as history.
- **D5 — A pending card carries the store's current balance.** One grouped SUM, same shape as the stores list. The ISP counting bills needs to know what the store holds: the declared amount alone does not say whether the handover empties the drawer or leaves half of it.
- **D6 — Confirming takes two taps, and the second one is a dialog.** Card button → `AlertDialog` naming the store and the amount. The write is irreversible and append-only, so a single mis-tap on a phone must not be able to make it. Disputing opens its note field inline (`Collapsible`) — writing a reason is the rare, slower path.
- **D7 — The store sees the dispute note in its Caja.** `lastCashDrop` gains `note` (anticipated by cashbox D4: "the drops task adds data, not a contract change"). Without it, US-E02's "both sides see the same" is only true for the side that wrote the note.
- **D8 — The sidebar count shares the pending query.** The badge and the screen use the same React Query key `["cash-drops", "pending"]`, polled every 30s — a handover is not a live event like a charge (charge-feed D1 polls 5s). Confirming invalidates the key, so the badge falls at the same moment the card leaves.

## Contract (ISP session only; tenant-scoped through the store, D3)

- `GET /cash-drops?scope=pending|resolved&cursor=<ms>` → `{ drops: [ { id, storeId, storeName, storeZone, cents, status, note, createdAt, confirmedAt, storeBalanceCents } ], nextCursor }`
  - `scope` defaults to `pending`; `storeBalanceCents` is filled for pending drops and `null` for resolved ones (D5)
  - `resolved` = confirmed + disputed, newest first, 20 per page, `cursor` = `createdAt` of the last row
- `POST /cash-drops/:id/confirm` → `{ drop, storeBalanceCents }` (the balance **after** the entry) · writes the ledger entry (D1)
- `POST /cash-drops/:id/dispute` — `{ note }` (3–280 chars) → `{ drop }` · writes no ledger entry (D1)
- Both actions: 404 on an unknown or foreign drop · 409 `DROP_NOT_PENDING` when it is already confirmed or disputed (D2)
- Store sessions → 403 on all three. `POST /cash-drops` (record) stays store-only, unchanged.

## UI Contract

- `/cash-drops`: **Por confirmar** first — one card per pending drop with store name and zone, the amount, when it was recorded, and the store's current balance. Actions: "Confirmar entrega" (→ dialog "¿Recibiste $X de <tienda>?", D6) and "Marcar en disputa" (→ inline note field; empty note blocks the send with a plain reason).
- Below it, **Historial**: rows with date, store, amount, `StatusBadge` (confirmed / disputed) and the note when there is one. "Cargar más" while `nextCursor` exists.
- Sidebar/bottom bar: "Entregas" carries a count badge while drops are pending (D8).
- Honest empty states for both lists. Two taps to confirm from a phone. Plain es-MX.
- Store PWA: a disputed last drop shows its note under the badge in Caja (D7).

## Scenarios

1. Confirming writes the `cash_drop` entry and the balance goes down by the declared amount (US-E01, D1)
2. Confirming twice → 409; a drop from another ISP → 404; a store session → 403 (D2, D3)
3. Disputing saves the note, writes **no** ledger entry, and lets the store record a new drop (US-E02, D1, D2)
4. `scope=pending` carries store name and balance; `scope=resolved` pages newest-first (D4, D5)
5. UI: a pending drop is confirmed in two taps and leaves the pending list (US-E01, D6)
6. UI: a dispute without a note does not send; with a note the drop shows as disputed with its reason (US-E02, D2)
7. UI: the store's Caja shows the dispute note on its last drop (US-E02, D7)

## Definition of Done

- [x] Scenarios 1–4 automated in the API layer (`test/cash-drops-admin.test.ts`, 4 tests)
- [x] Scenarios 5–6 automated with Testing Library + MSW (`apps/admin/test/cash-drops.test.tsx`, 3 tests)
- [x] Scenario 7 automated in the PWA (`apps/tienda/test/cash-drop-ledger.test.tsx`)
- [ ] Real loop on the deployed apps: store records → ISP confirms → the store's balance falls
