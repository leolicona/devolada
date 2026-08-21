---
status: in-development
stories: [US-C06, US-C08]
domain: charges
updated: 2026-08-20
debt: []
---

# Spec: What the customer owes

A customer who already paid could be charged again — and the system would fabricate an invoice to justify it. This spec started by making the pending-invoice list the source of truth for "does this customer owe", everywhere the answer matters: the search results, the confirm screen, and the charge guard.

**Revised 2026-08-20, and the title changed with it.** The invoice list answers *whether* a customer owes only while every payment is a whole one. Measured against a live tenant with a real router (`.design/devolada/PARTIAL_PAYMENT_SPIKE.md`), WispHub turns out to keep a **running account**: a payment is applied to the customer, not to the invoice, and anything left over is carried in the customer's `saldo`. So a partly paid invoice closes as `Pagada`, the pending list empties, and the debt survives somewhere this spec was not looking. D7–D12 finish the argument D1 began: the invoices are half the truth, the carried balance is the other half, and the *amount* was never being read at all.

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

---

## Decisions — 2026-08-20 revision

Every decision here rests on measurements in `.design/devolada/PARTIAL_PAYMENT_SPIKE.md`
(F14, F16, F17, F18), taken against the demo tenant with the CHR lab enforcing
real cuts. The findings are recorded in `docs/integrations/wisphub.md`.

- **D7 — The debt is the pending invoices *plus* the carried balance.** WispHub keeps a per-customer running balance in `saldo`: positive is owed, negative is a credit. Measured: `registrar-pago` applies a payment against `Σ(pending invoice totals) + saldo` and writes the remainder back into `saldo` — `60 + 10 − 25 = 45`, and again `13 + 40 − 10 = 43`. A short payment therefore closes the invoice as `Pagada` and moves the rest to `saldo`, where nothing in this spec was looking. So "does this customer owe" is **pending invoices OR `saldo > 0`**, and "how much" is their sum. **Rejected**: keeping the invoice list as the only truth (measured false, and false in the direction that loses money); reading WispHub's `estado_facturas` label instead (D1 already killed it, and it reads *"Pagadas"* for a customer carrying `saldo`, so it fails here too).
- **D8 — The amount comes from the invoice, never from the plan's price.** Today every amount in both channels is `precio_plan` — the list price of the plan on the customer record — while the invoice carries the real number: prorations (`"Total dias a pagar: 31"` rides in the line description), discounts, extra charges, and whatever an ISP bills for a reconnection. On the demo tenant the two happen to be equal, which is exactly why this was invisible. **Rejected**: keeping `precio_plan` and treating the difference as an edge case — the difference *is* the reconnection charge that started this whole line of work.
- **D9 — Both fields are already in our hands; this costs zero extra WispHub calls.** `saldo` rides in the customer list serializer that `searchCustomers` already maps, and `total`, `sub_total`, `descuento` and the full `articulos[]` ride in every row of the pending-invoice list that `pendingInvoices` already fetches. Both are dropped: `saldo` is not even declared in `WispHubListItem` (`apps/api/src/wisphub/client.ts:72`), and `pendingInvoices` keeps only `id_factura` and `cliente.usuario` (`client.ts:231`). The change is in two mappings, not in the call pattern. This is not a detail: `provider-latency` D1 measured that about **one WispHub call in eight stalls and never recovers**, so a fix that adds a call to the charge path buys the truth with a new outage.
- **D10 — Devolada registers what it actually collected for the ISP.** `attemptReconnection` registers `monthlyFeeCents` — that is, `precio_plan` — against whatever invoice it resolved (`apps/api/src/wisphub/reconnection.ts:69`). When the invoice totals more, WispHub takes the short amount, closes the invoice, and **carries the difference into `saldo`**. In other words the product currently manufactures the very state D7 exists to see: it under-registers, the customer keeps owing, and then reads as "al corriente" everywhere. The amount registered must be the invoice total the charge is settling. **Rejected**: registering the customer-facing total (it includes Devolada's service fee, which is not the ISP's money and would land in WispHub as a credit — `wisphub/reconnection.ts` is right to keep the fee out, and stays right).
- **D11 — The carried balance is its own line, never folded into the monthly fee.** Wherever an amount is broken down — the confirm screen, the payment page, the receipt — a carried balance appears as **"Adeudo anterior"**, beside the period's charge and the service fee. A shopkeeper who is shown an unfamiliar total with no explanation does not charge; a customer who is shown one does not pay. **Rejected**: one merged number (it hides the reason and makes the shopkeeper the one who has to explain it), a tooltip (the store PWA is a phone at a counter).
- **D12 — A credit reduces what is owed and never leaves as money.** A negative `saldo` enters the sum of D7 like any other term, so it lowers the amount charged; if it covers the period's invoice entirely, the customer owes nothing and the existing `NOTHING_DUE` answer is already correct. Devolada never pays a credit out, never transfers it, and never shows it as a balance the customer can spend. **Rejected**: surfacing "tienes $X a favor" as a headline (it invites a refund request Devolada cannot honour — the money is in the ISP's account, and `direct-payment` D4 exists precisely so Devolada never custodies funds).
- **D13 — The wire says `invoice`, not `monthlyFee`.** After D8 the field holds the pending invoice's total, which is the monthly fee *plus whatever else the ISP billed*. The glossary allows one word per concept and forbids a word that means something else, so `monthlyFeeCents` becomes **`invoiceCents`** across the wire (`customerResult`, the quote, `feedCharge`, `receiptResponse`) and in the two tables that store it (`charges`, `direct_payments`), with **`carriedBalanceCents`** added beside it. **Rejected**: keeping the name (it would read "Mensualidad $649" on a receipt whose $150 is a reconnection charge — the exact confusion D11 exists to prevent); adding the new field and leaving the old name (two words for one concept, which `SPEC.md`'s glossary rule forbids).
- **D14 — Truncation gets stronger, not weaker.** D4 falls back to WispHub's label when the pending list is cut off and the customer is not in the fetched part. `saldo` is read from the customer record, which is never truncated, so a carried balance now proves a debt on its own: the fallback is only reached when the list is truncated **and** `saldo` is zero **and** the customer is missing from the fetched part. The residual double-charge risk D4 accepted shrinks accordingly.
- **D15 — The payment is registered against a vehicle, and the vehicle is never sized to the debt.** `registrar-pago` needs an invoice id, and the amount registered is the **whole** debt of D7 — measured: a customer carrying `72.00` with a new `100.00` invoice, paid `172.00`, ends at `saldo 0.00` in one call. Two rules fall out of the same measurement. **Never create an invoice for a carried balance**: WispHub adds it to the running account, so an invoice of `72.00` for a customer already carrying `72.00` makes the debt `144.00`, and the customer's `72.00` payment leaves them owing exactly what they owed before. **When nothing is pending, the vehicle is a zero-total invoice**: `total: 0.00` is accepted, adds nothing to the account, and gives `registrar-pago` the id it requires — verified, `saldo 30.00` settled to `0.00` that way. This is not an edge case, it is the *normal* aftermath of a short payment: the invoice closed as `Pagada`, so the payer returning with the remainder has nothing pending to pay against. **Rejected**: creating an invoice sized to the carried balance (measured to charge the customer for nothing); refusing to collect until WispHub's next billing run creates an invoice (it leaves a paying customer unable to pay for weeks, which is the defect this spec exists to remove).

## Contract — 2026-08-20 revision

No new endpoints and no new WispHub calls (D9). What changes is what the existing shapes carry.

- `customerResult`: `monthlyFeeCents` → **`invoiceCents`**; add **`carriedBalanceCents`** (integer, ≥ 0 — a credit reports `0` here and is already netted into `invoiceCents` by D12).
- Quote: `{ invoiceCents, carriedBalanceCents, serviceFeeCents, totalCents }`, where `totalCents = invoiceCents + carriedBalanceCents + serviceFeeCents`.
- `billingStatus` follows D7: `due` when a pending invoice exists **or** `saldo > 0`; `paid` when neither and the list is complete; the label only under D14's narrowed fallback.
- `GET /direct-payments/links/:token` mirrors the same three fields and the same `debt` / `no_debt` rule.
- `feedCharge` and `receiptResponse` carry `invoiceCents` and `carriedBalanceCents` so the admin feed and the customer's receipt can show D11's breakdown.
- Migration: rename `charges.monthly_fee_cents` → `invoice_cents` and `direct_payments.monthly_fee_cents` → `invoice_cents`; add `carried_balance_cents` (NOT NULL DEFAULT 0) to both. Historical rows keep their numbers — they were charged with the meaning the column had, and a rename does not rewrite them.

## Scenarios — 2026-08-20 revision

1. Customer with zero pending invoices, label `Pagadas`, `saldo 199.00` → search and quote read **`due`**, and `POST /charges` is accepted rather than answering `NOTHING_DUE` (US-C08, D7)
2. Same customer on the payment link → `status: "debt"`, not `no_debt` (US-C08, D7)
3. Pending invoice whose `total` exceeds `precio_plan` → the quote's `invoiceCents` is the invoice total, and the charge registers that amount in WispHub, leaving no residue in `saldo` (US-C08, D8, D10)
4. Customer with both a pending invoice and a carried balance → `totalCents = invoiceCents + carriedBalanceCents + serviceFeeCents`, and the three arrive as separate fields (US-C08, D11)
5. Customer with `saldo −10.00` and a `50.00` invoice → charged `40.00` for the ISP; with `saldo −60.00` → `NOTHING_DUE` (US-C08, D12)
6. Truncated pending list, customer absent from it, `saldo > 0` → `due` without reaching the label fallback (D14)
7. Truncated pending list, customer absent, `saldo` zero, label due → the D4 fallback still applies, unchanged (D4, D14)
8. Neither channel makes an extra WispHub call: the request counts of search, quote and charge are unchanged from before this revision (D9)
9. UI: the confirm screen and the receipt show "Adeudo anterior" as its own line when there is one, and omit the line entirely when there is not (US-C08, D11)
10. Customer with a carried balance and **no** pending invoice → a zero-total vehicle invoice is created and the whole debt is registered against it; no invoice is ever created for the carried amount itself (US-C08, D15)

## Definition of Done — 2026-08-20 revision

- [ ] Scenarios 1–8 automated in the API layer; scenario 9 with Testing Library
- [ ] `wisphub.md` carries the measured contract (running account, `saldo` semantics, invoice fields)
- [ ] Deployed check against a live tenant: a customer left with a carried balance by a short payment made in the ISP's own panel is found by search, quoted for the right total, and charged — the exact state that is uncollectable today

