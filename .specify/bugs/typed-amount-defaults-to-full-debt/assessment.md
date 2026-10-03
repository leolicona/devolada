# Bug Assessment: a typed-data payment searches Banxico for the full debt, not what the payer sent

- **Slug**: typed-amount-defaults-to-full-debt
- **Created**: 2026-10-02
- **Source**: pasted text (payer receipt screenshot + dev D1 rows, read 2026-10-01)
- **Verdict**: likely valid, needs reproduction
- **Severity**: medium

## Report (summarized)

Dev payment `5e47a750-21e2-4a08-87b2-3f85058361b3` (business `eae33e15`,
customer `arellano@wifiplus`, link `8520cb65`). The payer's bank receipt
(Guardadito/Azteca → BBVA ***4417, 01/Oct/2026 11:25:53 CST, clave
`261001011213666996I`, reference `2219182`) shows **$2.00**. The link's
invoice is **$3.00**. The payment row has `claimed_amount_cents = 300`;
the validation row `729b51c4` asked Banxico with `amount_cents = 300` and
got `not_found` six times. The payment stays `validating`
(`consta_status: invalid`, `last_error: TRANSFER_NOT_FOUND`) with a retry
scheduled. It is the last row of a chain: `a8fca88c` (own reference, no
clave, ladder round 4) → `65e24c24` → `5e47a750`.

Evidence is the dev D1 only. Banxico was **not** re-queried with 200.

## Symptom

The payer transferred $2.00 on a $3.00 debt. Devolada kept asking Banxico
for a $3.00 transfer, which does not exist, so the payment never resolves.
Expected: either the search uses what was really sent ($2.00 → a short
payment, `partial-payment D5`), or the payer is told the amount may be the
reason nothing is found.

## Reproduction

1. Open a payment link with a $3.00 debt on the payer page.
2. Take the "confirm my payment" door and leave the amount alone
   (it is not edited unless the payer taps "otro monto").
3. Pay the clave/reference step with a transfer of a different amount.
4. Observe: the row carries `claimed_amount_cents = 300`, Banxico answers
   `not_found`, the payment stays `validating`.

[NEEDS CLARIFICATION: which door the payer took. The first row of the
chain has `claimed_amount_cents = NULL`; the last has 300, so the amount
was set (typed or defaulted) at the "Buscar mi pago" step.]

## Suspected Code Paths

- `apps/pago/src/features/pago/ConfirmPayment.tsx:106` — `readChoice`: unless `otherAmount` is chosen, the amount is `data.totalCents` (the full debt), a default that looks like a confirmed fact.
- `apps/pago/src/features/pago/PaymentPage.tsx:2641` — the "Buscar mi pago" form gets `fixed.amountCents = chosen.amountCents`; the payer cannot see or edit it at this step (`PaymentPage.tsx:443` sends it as `amountCents`).
- `apps/api/src/routes/direct-payments/handler.ts:962` — `claimedCents = body.transfer?.amountCents ?? body.receiptAmountCents`: the amount sent is taken as the payer's word and is what is searched.
- `apps/api/src/direct-payments/validation.ts:964` — Banxico is asked with `claimedAmountCents ?? amountCents` (`sender.amount` is a search criterion, `partial-payment D5`).

## Root Cause Hypothesis

With typed data there is no receipt to read, so the amount is the only
fact not given by the payer — and the page fills it with the full debt.
A payer who paid less, and who does not tap "otro monto", sends $3.00.
Banxico has no $3.00 transfer, answers `not_found`, and nothing in the
payer's screen points to the amount as the cause. Confidence: medium. The
code path is read; the real session that produced the row is not
reproduced, and a query with 200 would confirm it.

## Proposed Remediation

**Preferred**: on the typed-data path, show the amount in plain words at
the last step ("Pagaste $3.00") with a visible way to change it, so the
default is never silent. When the search ends `not_found` and the amount
sent equals the full debt, the not-found screen asks "¿Pagaste otro
monto?" before anything else.

**Alternatives**:
- Ask the amount explicitly (no default) on the typed door. Cost: one more field for the many payers who paid in full.
- On `not_found` with a default amount, retry once with no amount filter. Cost: a wider search can match another transfer (`reference-finds-other-transfer`); needs a product decision.

**Files likely to change**:
- `apps/pago/src/features/pago/ConfirmPayment.tsx`
- `apps/pago/src/features/pago/PaymentPage.tsx`
- their component tests under `apps/pago/`

**Tests to add or update**:
- Component: the last step shows the amount in words and lets the payer change it (`bug: typed-amount-defaults-to-full-debt`).
- Component: a not-found result on the full debt offers "otro monto".

## Risks & Considerations

- Product decision needed: default or ask. Changes the payer's copy (es-MX).
- A smaller amount makes the payment short, not confirmed (`partial-payment`); the business sees a short payment.
- The retry schedule keeps spending searches on a row that cannot match. Quota 700 left on the dev token at the time.

## Open Questions

- [NEEDS CLARIFICATION: ask Banxico with 200 for clave `261001011213666996I` to confirm the amount is the only cause.]
- [NEEDS CLARIFICATION: is a silent full-debt default intended (`payment-without-receipt D…`)? Check the decision before changing it.]
