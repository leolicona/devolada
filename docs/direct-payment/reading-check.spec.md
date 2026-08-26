---
status: in-development
stories: [US-D14]
domain: direct-payment
updated: 2026-08-26
debt: []
---

# Spec: The classifier at minute two

**US-D14** — As an end customer whose transfer is not found on the first attempt, a second reading of my receipt happens within minutes: if both readings agree, the page waits with evidence and never asks me by the clock; if they disagree, I am asked to confirm exactly the disputed field against my receipt — in minute three, not minute forty-five.

**The problem this closes** is D17's faceless ambiguity, measured at its worst on 2026-08-26: the reader misread 3 of 4 Nu claves (a dropped `K`, a transposed `PF` — deterministic, shape-valid, gate-passing), and each misread was indistinguishable from an unpublished CEP. The payer waited through the whole schedule for an answer the system could have had in minute two. `validation-status-ux` (US-D12) manages that ambiguity with staged patience; this spec **removes** most of it with a second, independent reading.

**Dependency — resolved 2026-08-26**: the gating measurement ran the same day the spec merged (apicep.md, "Measured 2026-08-26"): a fabricated receipt with a nonexistent clave answered the faceless `invalid` with the **full `extracted`**, the clave transcribed perfectly. **Plan A is active.** (Plan B — the cross at the 20-minute slot as a second chance at resolution, no comparison, no evidence states — stays recorded here only as the fallback it no longer needs to be.) `consta/proof-extraction` US-V11 still lands first: this spec consumes the `reading` its D11 exposes.

## Decisions

- **D1 — Attempt 2 sends the image, not the data.** For a payment with a stored proof (`proof_key` present) whose inline attempt ended `TRANSFER_NOT_FOUND`, the 2-minute slot re-sends the **image** through Consta's receipt door **with `providerOcr: true`** (proof-extraction D11 — without it Consta's own reader runs again, and the same model checking itself is no second opinion): apiCEP reads it with its own OCR and validates its own reading against Banxico **in the same paid call** — a call that slot was going to spend anyway, so the marginal cost is zero (~$0.25 MXN per call either way). If apiCEP reads correctly *and* the CEP is published, the payment confirms right there and nothing below applies. Eligibility is exact: an image exists, and the error is `not_found` (a `contradicted` is a verdict and stays dead; the manual door has no image and keeps today's behaviour end to end). **Rejected**: the cross at the 20-minute slot (resolves more often per call, but wastes eighteen minutes of classification — the arithmetic: the normal door resolves with `(1−m)·F(t)`, the cross with `r·F(t)`, and with the reader's live misread rate `m` far above `1−r ≈ 0.33`, the cross wins at every slot; what decides *minute two* is that the comparison's information is worth more earlier); the cross on every slot (apiCEP's failures are deterministic per image — 1 in 3 receipts, measured — so repetition is waste).

- **D2 — The comparison is clave + monto; nothing else can raise a dispute.** Those are the two Banxico search filters (both measured): an error in either is an invisible `not_found`, and an error anywhere else is not. The reader's clave and claimed amount are compared against apiCEP's `reading`. The sender bank is compared best-effort after vocabulary normalisation and is **informative only** — apiCEP returns its own bank vocabulary, and a formatting difference must never wake the human. The date is a hint at Banxico (measured) and is not compared at all. **Rejected**: clave alone (a misread amount is exactly as invisible, and `claimed-amount` D1 made the amount the payer's own field); all four fields (maximum false alarms for zero extra findability).

- **D3 — Agreement is evidence, and evidence retires the clock.** Two independent readers returning the same clave and amount means the data is almost certainly right and the `not_found` is almost certainly Banxico not having published yet. The page's calm phase says so: *"Revisamos tu comprobante dos veces y los datos coinciden. Solo esperamos la respuesta de Banxico — no necesitas hacer nada."* And the 45-minute form **never opens by clock** for an agreed payment: the doors (correct, re-upload) stay present as always, but the system stops inviting a payer to break data two machines confirmed. The clock escalation survives untouched for payments *without* evidence (manual door, blind cross — D5). **What agreement never does is validate**: it is a statement about pixels agreeing, not about money — the verdict is Banxico's alone, so a fabricated receipt with internally consistent data reads "agreed", rides calmly, and dies at expiry unvalidated, exactly as it should (the owner's own framing: false data never validates anyway). **Rejected**: keeping the 45-minute form for agreed payments (belt-and-suspenders against the both-wrong-identically residual, priced as inviting every honest payer to damage good data; the residual ends in expiry — never worse than today).

- **D4 — Disagreement asks the human now, and asks about the receipt.** A dispute on clave or amount means at least one machine is wrong, so the human is asked in minute ~3 instead of minute 45 — and asked the owner's way: **"Confirma tu clave de rastreo"** (or *"el monto transferido"*), with the disputed field arriving **empty** and every undisputed field pre-filled. Below the empty field, the way out of typing 28 characters on a phone: *"Cópiala desde tu app del banco, o escríbela tal como aparece en tu comprobante."* Not pre-filled, for two reasons with a measurement each: the owner personally confirmed a misread pre-filled clave **twice** in live testing — a pre-filled 28-character string gets confirmed, not proofread — and there is no neutral reading to pre-fill when the machines disagree (either choice biases the arbiter toward one machine). Never *"we read X, the bank read Y"*: a person holding the receipt should compare against the receipt, not referee two machines. The two outcomes are already machinery: the human types what the row holds → the unchanged guard keeps the row and spends nothing; they type something else → supersede, and the new data validates. **Deferred, gated on a metric**: pre-filling with the disagreement's diff region highlighted — build it only if *disputes abandoned vs answered* shows the empty field losing payers.

- **D5 — A blind cross yields no evidence and changes nothing.** When apiCEP could not read the disputed fields (`missingFields`, or a `reading` without a clave), there is no second opinion: not agreement, not dispute. The payment keeps today's exact behaviour — clock escalation, 45-minute form, US-D12 unchanged. **No reclassification retry**: apiCEP's blindness is deterministic per image (the measured 1-in-3), so a later cross against the same image spends a slot that the normal door could have used with real odds of resolving. **Rejected**: a retry at the 120-minute slot (bets on transient blindness against evidence of deterministic failure); rewording the calm copy for blind payments (they learn nothing new, so nothing new is said).

- **D6 — Expiry with agreement is a different sentence, because it is a different fact.** Today's expiry copy — *"No encontramos tu transferencia… contacta a tu proveedor con tu comprobante"* — was written when the system could not tell bad data from an unpublished CEP. An agreed payment that still expires carries a diagnosis: the data matches the receipt and Banxico never published. The copy says so: *"Tus datos coinciden con tu comprobante, pero Banxico no publicó la transferencia. Contacta a tu proveedor de internet con tu comprobante — puede registrar tu pago a mano."* The ISP receives a pre-diagnosed case instead of a mystery. Disputed-then-abandoned and blind payments keep today's copy — for them the old uncertainty is still the truth.

- **D7 — A cross-validated payment adopts the CEP's tracking key.** The cross attempt can confirm a row whose stored clave is the *misread* one (transfer mode, wrong key on the row). D8's index must end up holding the truth: on a cross-door `valid`, the row's `tracking_key` is updated to the CEP's — the same claim step the receipt door already runs for keyless rows, extended to rows whose key the CEP just corrected. The read-versus-confirmed pair records the correction like any human one would — the reader's misses are measured the same whether a person or apiCEP catches them.

## Contract

`GET /direct-payments/:id/status` gains two nullable fields:

- `readingCheck: "agreed" | "disputed" | null` — null before the cross attempt, for ineligible payments, and for blind crosses.
- `disputedFields: ("trackingKey" | "amount")[]` — present only when `readingCheck = "disputed"`.

The sweep's 2-minute slot for eligible payments calls Consta's receipt door (US-V11 response carries `reading`); the comparison result is written on the row. `lastError` stays `TRANSFER_NOT_FOUND` throughout — the check is a classification, not an error.

## Schema

### Alter `direct_payments`

- ADD `reading_check` TEXT NULL — `'agreed' | 'disputed' | 'blind'` (D1–D5); NULL = no cross ran
- ADD `disputed_fields` TEXT NULL — JSON array, set only on `'disputed'` (D4)

## UI Contract

- **Agreed**: calm phase with the D3 copy; the Collapsible and both doors as today; no clock form, ever. Expiry with the D6 copy.
- **Disputed**: the correction form opens immediately with the disputed field empty, its header naming the field (*"Confirma tu clave de rastreo"*), the copy-paste hint under it, undisputed fields pre-filled. Doors unchanged.
- **Blind / no cross**: US-D12's phases exactly as shipped.
- es-MX, no jargon, status never by colour alone (FRONTEND laws).

## Scenarios

1. Reader-sourced `not_found` → the 2-minute slot sends the image; apiCEP validates directly → `confirmed`, and the row's tracking key becomes the CEP's (D1, D7)
2. Cross returns `not_found` with a reading that matches clave + amount → `readingCheck: "agreed"`; the page shows the evidence copy; attempts 5+ never open the form (D2, D3)
3. Cross reading disagrees on the clave → `readingCheck: "disputed"`, `disputedFields: ["trackingKey"]`; the form opens at once with the clave empty and the rest pre-filled (D4)
4. The human types the same clave the row holds → unchanged guard: row kept, nothing spent; types a different one → supersede, new validation (D4, direct-payment D18/D9)
5. Cross reading disagrees only on the amount → `disputedFields: ["amount"]`; the amount field arrives empty, the clave stays pre-filled (D2, D4)
6. ApiCEP answers `missingFields` (or a reading without a clave) → `readingCheck` stays null; clock escalation as today; no second cross ever (D5)
7. A bank-name difference alone raises nothing (D2)
8. Agreed payment exhausts the schedule → `expired` with the D6 copy; a blind one expires with today's copy (D6)
9. Manual-door payment (no image) → no cross attempt; US-D12 behaviour end to end (D1)
10. A fabricated receipt with consistent data → agreed, calm ride, expiry, never validated — agreement decides no money (D3)

## Definition of Done

- [x] **Gate: US-V11's measurement** — passed 2026-08-26: `extracted` arrives complete on the faceless `invalid`; plan A active
- [x] Scenarios 1–10 automated, each citing US-D14: 1–3, 5–9 in `direct-payment.test.ts` ("US-D14" block) with 2/3/8's page halves in `pago.test.tsx`; 4 is direct-payment D18's unchanged/supersede pair, already pinned; 10 is D3's fraud note, held by the agreement never touching the verdict path
- [x] `validation-status-ux` D1 amended: clock escalation scoped to payments without evidence (agreed payments never escalate by clock)
- [ ] Manual check on deployed dev: a deliberately misread clave is disputed and corrected inside five minutes
