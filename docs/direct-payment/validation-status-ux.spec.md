---
status: proposed
stories: [US-D12]
domain: direct-payment
updated: 2026-08-25
debt: []
---

# Spec: What the payer sees while Banxico stays silent

A `not_found` from the provider is the absence of an answer, not a verdict
(direct-payment D17). But the page treats every `not_found` the same way from
minute two: it opens the pre-filled correction form and asks the payer to
review their data. Two minutes after a real transfer, that reads as "something
is wrong with your payment" — when the measured reality (apicep.md, 2026-08-19)
is that a real CEP can stay unpublished past T+62 minutes. The alarm arrives
before the doubt is earned.

This spec stages the page's honesty over time: calm while the wait is normal,
a review request when the wait stops being normal, and a long-wait state with
one late retry before anything is called expired. At every stage the payer can
see what was submitted, correct it, or start over with another receipt — the
doors never close; only what stands in the foreground changes.

Everything here is presentation and scheduling over data that already exists.
One field is added to one response (D5); one slot is added to one schedule
(D4). No new table, no new endpoint.

**Where this lands**: decided here, built in the consumer PR that follows the
`feat/partial-payment` merge — `PaymentPage.tsx` and `direct-payment.spec.md`
are being edited in that worktree, and the coexistence rule (CICD.md) says
this spec does not touch what another worktree holds. The amendments to
direct-payment D18 noted below are applied to that file in the same consumer
PR, not now.

## Decisions

- **D1 — Escalation is staged by `validationAttempts`, and only for `TRANSFER_NOT_FOUND`.** The D7 schedule ([2, 8, 20, 45, 120, 360] minutes) makes the attempt counter a clock the frontend already receives. Attempts 1–3 (up to the 20-minute slot): the calm phase (D2). Attempt 4 onward (45 minutes in): the open pre-filled form (D3). The measured unpublished-CEP window (T+62 min) means even the 45-minute ask still overlaps honest waiting — which is why the form's copy never accuses (D3), and why escalating *earlier* was rejected: on attempt 1 the overwhelming prior is "Banxico has not published yet", and an open form at minute two converts that prior into worry. **Amends** direct-payment D18's "asked on the first not_found": the ask moves from attempt 1 to attempt 4, but the payer who already doubts their data does not wait — the correction door is present from attempt 1 inside the calm phase. **Preserved from D18**: a receipt whose own `Estatus` says "En proceso" keeps the calm message at *any* attempt — the bank has not released the transfer, and there is nothing to correct.
- **D2 — The calm phase shows the process, and keeps the data one tap away.** Badge `validating`, message: *"Validación en proceso: esperamos la respuesta de Banxico. No necesitas hacer nada."* Below it, a Collapsible (the same primitive the page already uses for "Ver los demás datos"): **"Ver los datos enviados"** opens a read-only clave/banco/fecha summary, and inside it a **"Corregir estos datos"** button opens the pre-filled `TransferForm`. Verifying is free; editing is deliberate. **Rejected**: data always visible (competes with the calm it is supposed to transmit); message only with no data until minute 45 (the payer who already suspects their clave loses exactly the early correction US-D09 bought).
- **D3 — The escalated phase is the form, with copy that suspects the wait, not the payer.** From attempt 4: the pre-filled form in the foreground, headed by *"Está tardando más de lo normal. Revisa que estos datos coincidan con tu comprobante y corrígelos si hace falta."* The schedule keeps running underneath; whichever resolves first wins (unchanged from D18). Submitting a correction supersedes the live payment, as today.
- **D4 — Expiry earns one late retry first.** A payment that exhausts the 360-minute schedule with `lastError = TRANSFER_NOT_FOUND` does not become `expired`: it takes one final slot at **720 minutes** (T+12h), and only if that attempt also fails does it expire. Cost: one provider credit per stuck payment, buying the rare bank that releases a held transfer the next morning. Scope is exact: `contradicted` still dies immediately (it is a verdict); channel failures (`CONSTA_UNAVAILABLE` etc.) still expire at 360 as today — the late slot is for the transfer Banxico may still publish, not for our own outages. **Rejected**: a second full schedule round (up to seven more credits against measured evidence that almost none would heal); keeping plain expiry with softer copy (closes the door on the next-morning release for the price of one credit).
- **D5 — The copy promises only what the system will do, and says when.** The status response gains `nextValidationAt` (nullable, ms epoch — the row already holds it), so the long-wait screen can say: *"Está tardando más de lo esperado. Volveremos a intentarlo automáticamente alrededor de las {hora}. Puedes cerrar esta página y volver después, o contactar a tu proveedor de internet con tu comprobante."* **Rejected**: "te daremos noticias en breve" — it promises a channel (push, SMS, a human review) that does not exist; the page only knows anything while it is open and polling. "Volveremos a intentarlo a las {hora}" is a promise the cron keeps.
- **D6 — An unread date is an empty field, not today's date.** The `TransferForm` defaults the date to today; in the D18 confirmation screen that silently invents a value the reader never produced — against D18's own law that no unconfirmed field is pre-filled with something that merely looks confirmable. When the reading carries no date, the confirmation form's date arrives empty and the gate treats it as missing ("Complétalos y revísalos"), like clave and banco. The default-to-today survives only in the manual door, where the payer types everything and same-day is the honest prior. apiCEP treats the date as a hint, so the *lookup* cost of a wrong guess is low — the cost is to the D18 contract, not to Banxico.
- **D7 — Every `not_found` screen carries the way out: another receipt.** A ghost button **"Subir otro comprobante"** on all three phases (calm, escalated, long wait) returns the payer to step 2; the new submission supersedes the live payment — releasing its tracking-key claim — exactly as a data correction does today. The payer who uploaded the wrong receipt (another transfer, an old capture) knows it before any schedule does; without this door they wait hours for a validation they already know is lost. The per-link attempt budget (direct-payment D13, `TOO_MANY_ATTEMPTS`) is the existing guard against abuse. **Rejected**: offering it only from minute 45+ (punishes the most honest, most fixable mistake) or only pre-expiry (same, worse).

## Contract

One change, additive:

```
GET /direct-payments/:id/status
  + nextValidationAt: number | null   (ms epoch; null once terminal)
```

Everything else the staging needs already travels: `validationAttempts`,
`error`, `trackingKey`/`senderBank`/`transferDate`, `receiptStatus`.

Schedule (direct-payment D7, amended by D4): `[2, 8, 20, 45, 120, 360]`
minutes, plus a final slot at `720` reached only when the exhausted payment's
`lastError` is `TRANSFER_NOT_FOUND`. Expiry for that payment moves to after
the 720 slot; for every other cause it stays at 360.

## Schema

None. `next_validation_at` already exists on `direct_payments`.

## UI Contract

`apps/pago`, es-MX, tokens only, statuses through `StatusBadge` (no new
status name: all three phases render under `validating`).

1. **Calm** (attempts 1–3, or "En proceso" at any attempt): message + Collapsible read-only data + "Corregir estos datos" + "Subir otro comprobante" (D2, D7).
2. **Escalated** (attempt ≥ 4): open pre-filled form, non-accusing copy, "Subir otro comprobante" below (D3, D7).
3. **Long wait** (schedule exhausted, late slot pending): the D5 copy with the next attempt's hour, the provider-contact line, and both doors (D5, D7).
4. **Expired** (late slot also failed): as today — `TRANSFER_NOT_FOUND` copy pointing at the provider with the receipt.

## Scenarios

All cite US-D12.

1. First `not_found` (attempt 1) → calm phase: no open form, data behind the Collapsible, both doors present (D1, D2, D7)
2. Attempt 4 with `TRANSFER_NOT_FOUND` → the open pre-filled form with the non-accusing copy (D1, D3)
3. `receiptStatus` matching "proceso" → calm message at attempt 5, no form in the foreground (D1)
4. Schedule exhausted at 360 with `TRANSFER_NOT_FOUND` → status stays `validating`, `nextValidationAt` points at the 720 slot, the page shows the hour (D4, D5)
5. The 720 attempt returns `not_found` → `expired`; returns `valid` → the normal confirmation path, WispHub charge included (D4)
6. Schedule exhausted at 360 with `CONSTA_UNAVAILABLE` → `expired` as today; no late slot (D4)
7. Reading with no date → confirmation form's date field is empty and gated as missing; the manual door still defaults to today (D6)
8. "Subir otro comprobante" from the calm phase → back to step 2; the new pay supersedes the old payment and its tracking-key claim is released (D7)
9. `status` response during `validating` carries `nextValidationAt`; after any terminal status it is null (D5, Contract)
10. `contradicted` at any attempt → `invalid` immediately, no staging, no late slot (D1, D4)

## Definition of Done

Blocked on the `feat/partial-payment` merge (see "Where this lands").

- [ ] Scenarios 1–10 automated (`apps/pago/test/` for 1–3, 7–8; `apps/api` tests for 4–6, 9–10), each citing US-D12
- [ ] `nextValidationAt` in the status response schema and handler
- [ ] `nextValidationSlot` grows the conditional 720 slot; expiry rule split by `lastError`
- [ ] `PaymentPage.tsx` renders the three phases from `validationAttempts` + `nextValidationAt`
- [ ] direct-payment.spec.md D18 amended (ask moves to attempt 4; unread date arrives empty) and D7 amended (late slot) — in the same PR, once that file is free
- [ ] Manual check on deployed dev: a not_found payment walks calm → escalated with the clock, and "Subir otro comprobante" restarts cleanly
