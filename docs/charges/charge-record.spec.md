---
status: in-development
stories: [US-C03, US-C04]
domain: charges
updated: 2026-08-14
debt: [TD-008]
---

# Spec: Record charge & live reconnection status

The shopkeeper presses "Cobrar". The API records the charge, writes the ledger entries, tries the reconnection against WispHub, and the result screen shows the live status. The core rule becomes code here: **a charge is never rejected because of WispHub failures**.

## Decisions

- **D1 — The server re-computes the amount. Always.** The request body carries only `{ usuario }`. The API fetches the customer again and computes the quote itself. A client can never send its own amount.
- **D2 — Record first, reconnect second.** The charge row and the two ledger entries are written before any WispHub call. If WispHub is down, the charge stays `queued` and the response is still 201. The money is safe in the ledger either way (US-C04).
- **D3 — One immediate reconnection attempt; the retry queue is the next task.** The attempt: create the invoice, register the payment (`registrar-pago`, async on WispHub's side), then verify with one customer read. Only a verified `active` service marks the charge `reconnected`. Anything else stays `queued` — no optimistic green.
- **D4 — Two server-side guards even though the UI hides the button.** No pending invoice → 409 `NOTHING_DUE`. Balance at the cap → 409 `BALANCE_CAP_EXCEEDED`. The UI is not a security layer. **Revised 2026-08-16**: the first guard asked WispHub's `estado_facturas` label, which lags real payments — a paid customer could be charged again, with the invoice fabricated to match (debt-truth.spec.md, US-C06). The guard now asks the pending-invoice list and resolves the invoice the charge will pay, so the reconnection never creates one on this path.
- **D5 — The invoice id comes from a message string.** WispHub's create-invoice response is `{"messages":"Se genero correctamente la factura N."}` — no id field (spike finding). We parse N from the message. Fragile by nature → TD-008 tracks asking WispHub support for a better way.
- **D6 — The payment method is found by name.** `GET /formas-de-pago/` and pick the first name matching cash ("efectivo"/"cash"), else the first entry. A per-ISP setting can replace this later (admin Settings task).

## Contract

`POST /charges` (store session) — body `{ usuario }`

- 201: `{ id, folio, reconnectionStatus, totalCents, customerName }`
- 409 `NOTHING_DUE` · 409 `BALANCE_CAP_EXCEEDED` · 404 `CUSTOMER_NOT_FOUND` · 503 setup/outage codes as before. **A WispHub outage after the guards is not an error: the charge records and stays `queued`.**

`GET /charges/:chargeId` (store session, own charges only) — same shape as the 201. Unknown or foreign id → 404.

Ledger writes (through `src/ledger/` only): `charge` (+`totalCents`) and `commission` (−store share; `stores.commission_cents` or the ISP default).

Folio format: `DV-` + 6 uppercase base36 chars, unique index enforced.

## UI Contract

- Confirm screen's button now posts and navigates to `/charges/$chargeId`.
- Result screen: `StatusBadge` (md) with the live status, folio in mono, total, customer name, and "Nuevo cobro" back to search. While `queued`, the screen polls every ~3s and shows the amber explanation ("se aplicará solo"). `reconnected` is the green moment.
- 409s on the confirm screen show their plain notices (nothing due / register a cash drop).

## Scenarios

1. POST records the charge and exactly two ledger entries; the balance grows by total − commission (US-C04, US-K01)
2. WispHub down → still 201, status `queued` (US-C04)
3. Invoice + payment + verified active service → `reconnected` (US-C03)
4. Payment ok but service not verified active → stays `queued` (D3, no optimistic green)
5. `paid` customer → 409 `NOTHING_DUE`, no rows written (D4)
6. Cap reached → 409 `BALANCE_CAP_EXCEEDED`, no rows written (D4)
7. GET returns own charge; a foreign charge id → 404
8. UI: pressing "Cobrar" posts and lands on the result screen with folio and status (US-C03)
9. UI: `queued` shows the amber explanation; `reconnected` shows green (US-C03)

## Definition of Done

- [x] Scenarios 1–7 automated in the API layer (`test/charge-record.test.ts`, 7 tests)
- [x] Scenarios 8–9 automated with Testing Library + MSW (`test/charge-result.test.tsx`, 4 tests)
- [x] Manual check: Done 2026-08-14 against the deployed dev API and the real WispHub demo tenant
