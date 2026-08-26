---
status: in-development
stories: [US-D13]
domain: direct-payment
updated: 2026-08-26
debt: []
---

# Spec: The amount the payer really sent

**US-D13** — As an end customer, the amount that is checked against Banxico is the amount I actually transferred — read from my receipt or typed by me — so a transfer for a different amount than my debt is found and settled, never lost.

This spec pays the "Open items — reserved for one follow-up PR" of `partial-payment.spec.md` (2026-08-26). Everything here was agreed with the owner during live testing, and the decisive measurement happened the same day: three manual-door lookups with the **correct** clave and date came back `not_found` for no reason but the amount — the system asked Banxico about the $5.00 it was owed while the payer had sent $4.00.

## Decisions

- **D1 — The source of truth for the amount is the receipt or the human — never the system's debt.** The owner's words, and the principle behind every other decision here. The amount is a **search criterion** at Banxico (measured 2026-08-19), so the lookup can only ask with the amount of the transfer that really happened — a fact only two sources hold: the receipt (the OCR reads it) and the payer's memory (they typed everything else already). The debt keeps its other job untouched: judging what the money bought (`confirmed`/`partial`, the reconnection threshold, the missing pesos) — it just never *finds* the money. Half of this already held before this spec: `partial-payment` D12 sends the receipt's amount on the receipt door, which is why short payments already worked there. This spec applies the principle to the remaining door and the remaining direction. **Rejected**: keeping the debt as the search amount anywhere (measured to lose real payments in silence — the exact failure `partial-payment` opened with).

- **D2 — A receipt claiming more than the debt is informed, not refused.** The page's refusal ("El monto de tu comprobante es mayor que tu adeudo, así que no podemos verificarlo") reverses. Its original justification — an inflated misread would ride six silent hours — died when `validation-status-ux` built the staged escalation and both doors; a wrong amount today is a `not_found` with a correction path, not a dead end. And the server already handles the overpayment that gets through: `settle()` reconnects on received ≥ debt, `partial-payment` scenario 6 pins `confirmed` with the surplus as negative `saldo` in WispHub (measured), and Devolada stores no credit of its own (D10 there stands untouched). What the confirmation screen does instead: says both numbers in pesos and what happens to the difference — *"Tu comprobante dice $5.00 y tu adeudo es $4.00. El sobrante quedará a favor con tu proveedor para tu siguiente factura."* — and lets the payer proceed or re-upload. **Rejected**: refusing above a margin (any cutoff strands the honest round-up payer the same way); silently accepting with no sentence (the payer who fat-fingered an extra digit deserves to see it before it travels).

- **D3 — The manual door asks for the amount: pre-filled with the expected total, editable.** Reverses `direct-payment` D18's *"asking the payer to confirm the amount"* rejection, whose premise — "it is a number we already know" — died with `partial-payment` D1: what the system knows is what the payer *should* have sent; what the lookup needs is what they *did* send, and on this door only the payer has it — the same standing the clave already has. Pre-filling with the expected total keeps the happy path untouched: the payer who transferred the exact amount confirms without touching the field, so there is no ritual to click through; editing is deliberate, the doors' own philosophy. The field travels as `transfer.amountCents` and lands in `claimed_amount_cents`, which stops being NULL on this door; the lookup already asks with it (`claimedAmountCents ?? amountCents`). The same field joins the correction form (`validation-status-ux` D2/D3), pre-filled with the row's own claimed amount — the stuck `not_found` payer gains their fourth correctable field, which closes `partial-payment` scenario 8. **Rejected**: an empty amount field (typing $514.00 by hand to pay the exact debt is friction that buys nothing and invites typos); only exposing it in the correction form (the payer who knows they transferred a different amount should not need to fail first).

- **D4 — The unchanged-confirmation guard compares four fields now.** D18's "confirming without changing anything costs nothing" keeps the row when clave, banco and fecha come back identical. The amount joins the comparison: a correction that only changes the amount is a real correction (it changes what Banxico is asked) and must supersede; the same three fields plus the same amount is still a no-op and still spends nothing.

- **D5 — `spei_beneficiary_name` becomes optional.** The verified contract (`docs/integrations/apicep.md`) requires only `clabe` + `bank`; `name` is optional in both modes, and Consta's own schema already agrees. The three gates that demanded it were all ours: the settings spei-ready check, the validation guard, and the page's beneficiary row — the first two stop requiring it, the third hides when it is absent. Kept as a *recommended* field, not deleted: the name is the payer's one chance to sanity-check who they are paying (their own bank often does not verify it — Nu prints "Dato no verificado"), and whether apiCEP uses a *wrong* name as a match criterion is unmeasured, so omitting beats guessing. **Rejected**: dropping the field entirely (it is the only payer-facing trust line this channel has); keeping it required (a gate the provider never asked for, priced in ISP onboarding friction).

## Contract

`POST /direct-payments/links/:token/pay` — `transfer` gains `amountCents` (integer cents, positive, optional). The row's `claimed_amount_cents` becomes `transfer.amountCents ?? receiptAmountCents ?? NULL` — the human-confirmed number outranks the raw reading (the pair still measures the reader, D18); the silent path, which asks no human, keeps carrying the reader's. The client-supplied amount is **never** what is charged — that stays computed from the fresh WispHub read; it is only what the lookup asks Banxico with (same posture as `receiptAmountCents`, D18). The supersede "unchanged" comparison includes it (D4).

`GET /direct-payments/:id/status` — gains `claimedAmountCents` (nullable), so the correction form can pre-fill the amount the payment actually asked with (D3).

The page-level refusal of a reading above the debt (`partial-payment` Contract) is **removed**; the informative sentence replaces it (D2). A reading below the debt keeps flowing as today (D12 there).

Settings: `speiReady` no longer requires `speiBeneficiaryName`; the validation guard drops it; the Consta request carries `beneficiary.name` only when configured.

## Schema

No migrations. `claimed_amount_cents` (from `partial-payment` D12) simply stops being NULL on the manual door.

## UI Contract

- Manual door and correction form: a **"Monto transferido"** field between the clave and the bank, pre-filled (expected total on the manual door; the row's claimed amount, falling back to the expected total, in the correction form), formatted as pesos with the tokens' money conventions, parsed to integer cents. es-MX, no jargon.
- Confirmation screen, reading above the debt: the D2 sentence in an informative (not warning) tone, both amounts as `<Amount>`, the normal confirm button, "Subir otro comprobante" still present.
- Step 1: the "Beneficiario" row renders only when the ISP configured a name (D5).
- Settings (admin): the beneficiary name field is marked optional; the spei-ready hint no longer lists it as missing.

## Scenarios

1. Manual door, untouched pre-filled amount → the lookup asks with the expected total, exactly as before this spec (D3)
2. Manual door, amount edited below the debt → the lookup asks with the typed amount; a real CEP for it → `partial` with the missing pesos (D1, D3; closes `partial-payment` scenario 8)
3. Receipt reading above the debt → no refusal; the informative sentence with both amounts; the submission travels with the receipt's amount (D2)
4. A valid CEP above the debt → `confirmed`, the real amount registered, surplus as negative `saldo` in WispHub; no credit stored here (`partial-payment` D10/scenario 6, unchanged — cited as the destiny of D2's accepted overpayment)
5. Correction that changes only the amount → supersedes and asks Banxico with the new amount; identical four fields → the row is kept and nothing is spent (D4)
6. `status` carries `claimedAmountCents`; the correction form pre-fills it (D3)
7. SPEI configured without a beneficiary name → links work, validation runs, the Consta request omits `beneficiary.name`, the page hides the "Beneficiario" row (D5)
8. `transfer.amountCents` cannot change what is charged: the charge's amounts still come from the CEP and the fresh debt read (Contract; D18's posture)

## Definition of Done

- [x] Scenarios 1–8 automated, each citing US-D13: 1 rides the rewritten US-D03 walk (`pago.test.tsx`), 2/5/6/8 in `direct-payment.test.ts` ("US-D13" block) with 2's page half and 3 in `pago.test.tsx`, 4 stays pinned by US-D10's scenario 6, 7 across `direct-payment.test.ts`, `settings.test.ts`, `settings.test.tsx` and `pago.test.tsx`
- [x] `partial-payment.spec.md` Open items section replaced with a pointer here; its Contract line about the page refusal amended (D2); `direct-payment.spec.md` D18 amended (D3 reverses its amount rejection)
- [ ] Manual check on deployed dev with a real transfer: a short amount typed in the manual door is found and lands `partial`
