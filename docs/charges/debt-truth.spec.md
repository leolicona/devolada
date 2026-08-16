---
status: in-development
stories: [US-C06]
domain: charges
updated: 2026-08-16
debt: []
---

# Spec: Pending invoices are the truth about debt

A customer who already paid could be charged again — and the system would fabricate an invoice to justify it. This spec makes the pending-invoice list the single source of truth for "does this customer owe", everywhere the answer matters: the search results, the confirm screen, and the charge guard.

**How the defect was found (2026-08-16, deployed dev + live WispHub demo tenant).** WispHub keeps two answers to "does the customer owe": the invoices (the truth) and a per-customer summary field, `estado_facturas`, which WispHub recalculates on its own schedule. Measured minutes after a real payment: the customer had **zero** pending invoices while `estado_facturas` still read *"Pendiente de Pago"* — and it lagged in the opposite direction too, reading *"Pagadas"* for customers whose pending invoices had just been created. `mapBillingStatus` read the label, and so did the only server-side guard (`billingStatus === "paid"` → `NOTHING_DUE`). When a stale-due customer was charged, `findPendingInvoiceId` found nothing, so the flow **created a new invoice and paid it** — the owner reproduced this three times from the UI: three fabricated invoices, each instantly "Pagada", for a customer who owed nothing. Everything reconciled; only the customer paid four times.

## Decisions

- **D1 — The pending-invoice list is the truth; `estado_facturas` is a hint.** Every answer to "does this customer owe" comes from `GET /facturas/?estado=1` filtered to the customer. The label keeps only one job: the fallback when the invoice list is truncated (D4). Measured against the live API: the invoice list answered correctly at the instant of payment, in both stale directions.
- **D2 — One list call, filtered here.** The invoice list endpoint has no usable customer filter — re-verified 2026-08-16 against the live API (`?cliente=` filters everything out; `?usuario=`, `?search=`, `?servicio=` are ignored). So the adapter fetches the pending set for an explicit window and the match happens in our code, exactly as TD-009 already established. One extra WispHub call per search/quote/charge; the search marks all its results from a single fetch.
- **D3 — The window is 180 days (revises TD-009's 45).** The product's core case is the suspended customer who finally comes to pay: their unpaid invoice can be months old. A 45-day window would answer "nothing due" for exactly the person the product exists for. 180 days, `limit=100` per page, following `next` up to 5 pages (500 invoices). The reconnection path shares the window: paying an older real debt first is correct ("oldest first" was already the rule).
- **D4 — Fail open on truncation.** If the pending list is cut off by the page bound *and* the customer is not in the fetched part, the guard falls back to the label (the old behavior) and logs it. Refusing a real debtor at the counter is worse than the residual double-charge risk, which now needs truncation *and* a stale label at once. Same rule for display: customers found in a truncated list are `due`; customers not found keep their label.
- **D5 — The guard resolves the invoice the charge will pay.** `recordCharge` looks up the customer's oldest pending invoice; none (with a complete list) → 409 `NOTHING_DUE`, replacing the label guard. Found → its id is passed into the reconnection attempt, so `createInvoice` never runs on the charge path — **a charge can no longer fabricate debt**. `createInvoice` survives only for the truncation fallback and the queue's legacy path (older charges whose invoice was never resolved), which also shrinks TD-008's blast radius to those edges.
- **D6 — Display tells the truth in both directions.** Search results and the quote override `billingStatus` from the invoice list: pending invoice → `due` even when the label says *Pagadas* (before this, a freshly-invoiced customer was invisible — the shopkeeper saw "al corriente" and never tapped); none, list complete → `paid` even when the label says *Pendiente de Pago*. No UI change: the confirm screen already renders the nothing-due state from `billingStatus` and already handles 409 `NOTHING_DUE`.

## Contract

No wire-shape changes. `CustomerResult.billingStatus` now carries invoice truth (D6); `POST /charges` answers 409 `NOTHING_DUE` from invoice truth (D5). A WispHub failure during the invoice lookup is a pre-charge failure: 503, nothing recorded — same posture as the existing customer lookup, and no conflict with US-C04, which protects the charge *after* it is recorded.

## Scenarios

1. Label says due, zero pending invoices → POST `/charges` 409 `NOTHING_DUE`; no charge, no ledger rows, **no invoice created** (D1, D5)
2. Label says *Pagadas*, one pending invoice → charge proceeds and pays **that** invoice; no invoice created (D5, D6)
3. Search: pending-invoice customer with a *Pagadas* label shows `due`; zero-invoice customer with a due label shows `paid` (D6)
4. Quote: same override as search (D6)
5. Truncated pending list (a `next` link past the page bound), customer not in it, label due → charge proceeds under the fallback (D4)
6. The queue's retry path still never creates an invoice when one is pending (TD-009's test keeps passing)

## Definition of Done

- [x] Scenarios 1–5 automated in the API layer (`charge-record.test.ts` +3, `charge-search.test.ts` +1, `charge-quote.test.ts` +2); scenario 6 is `reconnection-queue.test.ts` unchanged
- [x] Deployed check (2026-08-16, dev + live WispHub): `valeperez` charged → invoice 8 flipped to Pagada, none fabricated → immediate re-search answered "al corriente" and the immediate second charge got 409 `NOTHING_DUE` — while WispHub's label still read *"Pendiente de Pago"*. The stale label was measurably present and measurably powerless. `jcobos` (the owner's original repro) now reads "al corriente" and refuses the charge.
