---
status: proposed
stories: [US-D10]
domain: direct-payment
updated: 2026-08-20
debt: []
---

# Spec: A transfer that falls short

The customer owes the monthly fee plus a reconnection charge and transfers only the monthly fee. It is the most common way a real payment goes wrong on this channel, and today it is the way Devolada handles worst.

**What happens now.** On the receipt door the pre-flight compares what the receipt claims against the expected total and answers 409 `AMOUNT_MISMATCH` — with the comment *"No row, no credit"* (`apps/api/src/routes/direct-payments/handler.ts:241`). No `direct_payments` row is written, and `apps/admin` has no direct-payment view at all (direct-payment D18). The money is already in the ISP's CLABE and **nothing, anywhere, records that it arrived.** On the manual door it is worse: the amount travels to Banxico as a search criterion (direct-payment D11), so a short transfer comes back with no CEP, reads as `not_found`, rides D17's six-hour schedule and ends `expired` with *"no encontramos tu transferencia"* — said to somebody who really paid. That is the same six-hour silence D18 exists to remove, arriving through the other door.

**What the measurements changed.** WispHub does not have an invoice ledger; it keeps a **running account** (`charges/debt-truth.spec.md` D7, measured in `.design/devolada/PARTIAL_PAYMENT_SPIKE.md`). A short payment is registered, the invoice closes, and the remainder is carried in the customer's `saldo`. And `accion` — not `auto_activar_servicio` — decides whether the router is touched, so the money can be recorded **without** giving the service back. Both halves of what this spec needs already exist in the provider.

## Decisions

- **D1 — A short payment is recorded, never refused. This reverses `direct-payment` D11.** That decision read *"Rejected: accepting partial amounts (a debt is paid whole or not at all in v1)"*, and it was right for a v1 that had no way to record a partial payment without also handing back the service. It is wrong now, for two measured reasons. First, WispHub carries the remainder natively, so recording a short payment leaves the ISP's books **more** correct, not less. Second, and decisive: by the time Devolada knows the transfer fell short, **the money has already left the customer's account and landed in the ISP's**. Refusing does not undo it — it only removes the last record that it happened. D11 is superseded here, not edited there; the older decision keeps its own text and its own date.
- **D2 — One control, not two: `reconnectionThresholdPercent` per ISP, default 100.** The owner asked for a minimum percentage *and* a switch to configure the action. They are the same decision, and holding both invites a state where they disagree (threshold 80 with "never reconnect" — which wins?). One number expresses everything: **100** means only a full payment reconnects, which is the owner's policy and the default; **0** means any payment reconnects; anything between is a tolerance the ISP chooses. **Rejected**: a separate action switch (contradictory states, and no behaviour it can express that the extremes cannot).
- **D3 — The threshold measures the ISP's debt, and Devolada's fee is never part of it.** The ratio is `amount received ÷ (Σ pending invoice totals + saldo)` — the debt as `debt-truth` D7 defines it, with the service fee excluded from both sides. Leaving a customer disconnected over Devolada's own fee would make our revenue a hostage of their service, and the support call costs more than the fee. **This is also the arithmetic the owner has to look at before choosing a number**: the case that started this work — $499 transferred against a $649 debt — is **77%**, so any threshold above 77 refuses precisely the scenario the feature was built for. The default of 100 refuses it deliberately (owner decision 2: the service returns only on full payment); an ISP that wants those payers reconnected has to say so with a number.
- **D4 — A percentage alone is not enough: a floor in pesos rides with it.** `reconnectionFloorCents`, and both conditions must hold. A percentage treats a $499 debt and a $5,000 debt alike, so 10% of a large arrears balance would buy a reconnection for a token payment. **Rejected**: a fixed amount alone (it does not scale across ISPs with different plan prices).
- **D5 — `accion` carries the verdict to WispHub, and the real amount always gets registered.** At or above the threshold → `registrar-pago` with `accion: 1`, and WispHub reconnects as it does today. Below it → `accion: 0`: the payment is recorded, the remainder lands in `saldo`, the router is untouched and the customer stays cut. Measured on a real router: with `accion: 0` the customer was still `Suspendido` and its IP still in the `Moroso` list on three checks across ~40 s, with the money on its `saldo`. In **both** branches the amount registered is what actually arrived (minus Devolada's fee, which is never the ISP's money — `charges/debt-truth` D10). **Rejected**: not registering the payment at all when it falls short (it is the option that leaves the ISP's books wrong *and* loses the record).
- **D6 — A short payment ends as `partial`, a status of its own.** Not `confirmed` — the service did not come back, and a payer who sees the confirmed state and no internet has been lied to. Not `invalid` — the transfer is real and the money moved; that word already means "your transfer does not exist" in the copy and in the ISP's feed. Not `unapplied` — D14 reserves that for a validated transfer with **nothing left to pay**, which is the opposite situation. `partial` is terminal for the row: the payer's next transfer is a new row against a freshly read debt (D8). **Rejected**: reusing `confirmed` with a flag (every consumer would have to remember to check it, and the one that forgets shows a green tick to a disconnected customer).
- **D7 — The payer is told in pesos, and told the whole truth.** Never a percentage, never a ratio: *"Recibimos $499 de $649. Tu servicio se reactivará cuando llegue el resto: faltan $150."* The number that is missing is the number to transfer. When the threshold **is** met, the page behaves exactly as a full payment does today — the payer never learns there was a threshold. **Rejected**: showing the threshold ("necesitas cubrir el 80%"), which asks a person at a phone to do arithmetic about a policy they did not agree to.
- **D8 — The next transfer is measured against a freshly read debt, never a remembered one.** When the payer comes back with the rest, the page re-reads WispHub. The first payment is already inside that answer — it moved the invoice and the `saldo` — so nothing is carried in Devolada's head and no sum is kept here. This is what makes the two-transfer case correct without any state of our own, and it is also why `partial` can be terminal. **Rejected**: accumulating the payments on our side (a second book to reconcile, and it would double-count the moment the ISP touches the customer in their own panel).
- **D9 — A charge is created for what actually arrived.** `channel = 'spei'`, `totalCents` equal to the amount received, `direct_payment_id` pointing at the `partial` row. The money moved, so the admin feed must show it and `settlement` D1's derivation must see it. The charge does **not** imply a reconnection: `reconnectionStatus` reflects what `accion` did, and for a short payment under the threshold there was no attempt to make. **Rejected**: creating no charge until the debt is fully paid (the platform statement would under-count real revenue, and the ISP's feed would show a customer whose money arrived as if nothing had happened).
- **D10 — Overpayment is not a case this spec handles.** It is `accion: 1` with the real amount, and WispHub turns the surplus into a negative `saldo` — a credit against the next cycle, measured (`saldo: "-10.00"` after paying 60 against a 50 debt). No new status, no new field, nothing for Devolada to hold. Recording a credit of our own would be a promise about money sitting in the ISP's account, which `direct-payment` D4 exists to prevent.
- **D11 — Stores keep the whole-payment rule.** Owner decision, 2026-08-20. At the counter the shopkeeper never types an amount, and giving them a free amount field would touch the balance cap, the commission and the confirm screen at once, while handing a mistypeable number to somebody holding real cash. The store channel gets `charges/debt-truth`'s fixes — the true total and the "Adeudo anterior" line — and nothing from this spec. **Rejected**: one partial-payment feature across both channels (the two failure modes are not the same: on SPEI the money has already moved when we find out, at the counter it has not).

## Schema

### Alter `isps`

- ADD `reconnection_threshold_percent` INTEGER NOT NULL DEFAULT 100 — D2
- ADD `reconnection_floor_cents` INTEGER NOT NULL DEFAULT 0 — D4

### Alter `direct_payments`

- `status` gains **`partial`** — D6

## Contract

`GET /direct-payments/links/:token` — unchanged in shape. The debt it reports already follows `charges/debt-truth` D7 (invoices + carried balance), so a payer who owes a remainder after a short transfer sees it here like any other debt.

`POST /direct-payments/links/:token/pay` — the pre-flight `AMOUNT_MISMATCH` refusal (`handler.ts:241`) is **removed for amounts below the expected total**. A receipt claiming *less* is now a valid submission; a receipt claiming *more* stays a mismatch, because that is a misread, not a payment (the `$1-receipt` hole D11 guards runs the other way).

`GET /direct-payments/:id/status` — `status` may now be `partial`, and the response carries `receivedCents`, `debtCents` and `missingCents` so the page can render D7's copy without doing arithmetic of its own.

Admin feed: a `partial` payment appears with its own label — *"pago parcial"* — never inside the `confirmed` count.

## UI Contract

- The result state for `partial`: `StatusBadge` with its own status, icon and text (FRONTEND law — never colour alone), the three amounts as `<Amount>`, and one sentence saying what is missing and what happens when it arrives.
- The page keeps the SPEI instructions visible in the `partial` state: the payer's next action is another transfer, and making them navigate back to find the CLABE is a way to lose them.
- Copy is es-MX and says "pago", never "cobro" (D10 of the parent spec).

## Scenarios

1. Transfer below the debt, threshold 100 → row ends `partial`, `registrar-pago` called with `accion: 0`, WispHub keeps the customer suspended, a charge is created for the amount received (US-D10, D1, D5, D6, D9)
2. Same transfer with the ISP's threshold at 70 → `accion: 1`, the customer is reconnected, the row still ends `partial` because the debt is not zero (US-D10, D2, D3)
3. Threshold met by percentage but below `reconnection_floor_cents` → `accion: 0` (D4)
4. The threshold ignores Devolada's service fee on both sides of the ratio (D3)
5. Two transfers: a short one, then the remainder → the second reads a fresh debt from WispHub, crosses the threshold, and reconnects; Devolada sums nothing (US-D10, D8)
6. Transfer above the debt → `accion: 1`, `confirmed`, and WispHub reports a negative `saldo`; no new status and no credit stored here (D10)
7. A receipt claiming **more** than the debt is still refused as a mismatch (contract)
8. The manual door with a short amount no longer expires after six hours: it is recognised as short and answered immediately (US-D10, D1)
9. UI: the `partial` state renders the three amounts, the missing figure in pesos, no percentage anywhere, and the SPEI instructions still visible (US-D10, D7)
10. The store channel is untouched: `POST /charges` still charges the full debt and has no amount field (D11)

## Definition of Done

- [ ] Scenarios 1–8 automated in the API layer; 9–10 with Testing Library + MSW
- [ ] The ISP can set both controls from Configuración, with the default (100 / $0) explained in one line
- [ ] Deployed check against a live tenant with a real router: a short transfer leaves the customer cut and its money on `saldo`; the remainder reconnects them
