# Bug Assessment: Banxico's `valid` is lost when a later step fails, and the transfer is then refused as already used

- **Slug**: valid-lost-on-later-failure
- **Created**: 2026-09-26
- **Source**: pasted text (product creator, in session), plus a read-only
  look at the dev D1 the same day. No URL supplied, so the URL Trust Policy
  did not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> "Después subí el recibo con clave de rastreo, pero aún no se valida." —
> and, on the explanation: "El sí válido pero no reportó tendría que ver con
> que expiró la api key demo de wisphub, ¿está esperada cuando reportó?"

The receipt: Banco Azteca, $3.00, Friday 25/Sep/2026 22:46:47 CST, clave de
rastreo `260928071155271843I`, referencia 9784417.

## Symptom

Banxico confirmed the transfer (`valid`, never used), but the payment did
not confirm: a step after the verdict failed — the WispHub read, with the
demo key expired — and the payment went back on the schedule. The next
attempt asked Banxico again from scratch, got `not_found`, and the payment
never confirmed. Worse, the provider now remembers that validation, so the
same receipt uploaded again is refused as "already used". Expected: once
Banxico has said `valid`, that answer is kept; only the step that failed is
retried; the transfer is never counted as used by somebody else.

## Reproduction

Observed on dev (read-only, 2026-09-26):

1. Payment `0c2a53a0-…` (Juan Fernando), receipt door, created 04:50 UTC.
   `validations`: `pending` at 04:50, 04:53, 04:59, 05:11, 05:36; **`valid`
   at 06:51:35** — clave `260928071155271843I`, CEP date 2026-09-28,
   `already_validated = 0`.
2. The row did not confirm. It adopted the clave, bank and date (the claim
   in the `valid` branch) and stayed `validating`. The creator confirms the
   FastIsp WispHub demo key had expired; the only paths that return a row to
   the schedule after a `valid` are the WispHub guards
   (`WISPHUB_NOT_CONFIGURED`, `WISPHUB_UNAVAILABLE`/`WISPHUB_AUTH_FAILED`,
   `WISPHUB_READ_INCOMPLETE`). The row's `last_error` was overwritten by the
   next attempt, so the WispHub code itself is no longer visible.
   [NEEDS CLARIFICATION: confirmed by the creator, not by a row.]
3. 10:51 UTC: the next attempt went to the transfer door with the clave and
   2026-09-28 → **`not_found`**. The payer then corrected it by hand
   (12:49, payment `0e2aa815-…`, date 2026-09-26 and referencia typed as
   9784411) → `not_found` on every attempt since.
4. 12:59 UTC: payment `e931f943-…` (another link of the same business),
   the same receipt → provider `valid` with **`already_validated = 1`** →
   `TRANSFER_ALREADY_USED`. The only validation of that CEP was our own, at
   06:51, on a different link.

5. Follow-up, 2026-09-26 14:30 UTC: payment `0e2aa815-…` is still
   `validating` after five transfer-door calls with the clave, all
   `not_found` (dates 2026-09-26 and, on `0c2a53a0-…`, 2026-09-28). The same
   hour the transfer door found Abraham's never-validated clave
   `260928071156210101I` **`valid`** with the same bank, amount, account
   and a wrong date (see `reference-search-business-day`). And the receipt
   door found this very CEP at 12:59 with `already_validated = 1`.
   **Inference (one clave, six calls)**: apiCEP's direct mode answers
   `not_found` for a CEP already validated through the account, where the
   OCR mode answers `valid` + the flag. If it holds, a row that lost its
   `valid` can **never** get it back through the transfer door, and every
   retry is a paid call that cannot succeed.

## Suspected Code Paths

- `apps/api/src/direct-payments/validation.ts` — the `valid` branch claims
  the clave and then, for a panel link, reads WispHub (`getCustomer`,
  `readPendingInvoices`); any failure there is `retryLater(code, base)`,
  which keeps the row `validating` and, on the next slot, **re-runs the
  whole validation** through the engine. Nothing on the row says "Banxico
  already said valid".
- `apps/api/src/direct-payments/validation.ts::tracesToOwnAttempt` — an
  `already_validated` flag is forgiven only when it traces to an earlier
  attempt **on the same link** (the `supersedes` chain or a sibling with
  the same clave on `payment_link_id`). Our own validation on another link
  of the same business reads as "validated outside Devolada" (D8).
- The CLAUDE.md invariant: "A WispHub failure never rejects a payment; it
  queues the action with visible status." Here a WispHub read failure
  blocks the confirmation itself and, through the re-validation, can end it
  `expired` or `invalid`.

## Root Cause Hypothesis

The lifecycle treats a `valid` verdict as a single moment instead of a fact
it keeps. When the WispHub debt re-check (direct-payment D14) fails after
the verdict, the row goes back to the retry schedule, and every retry pays
for a new provider call that can answer differently (`not_found` here) —
while the provider itself has already recorded the CEP as validated, which
later poisons any honest resubmission through a different link.
Confidence: **high** for the mechanism (the code paths and rows above);
**medium** for the WispHub failure being the trigger (the creator's
account, the overwritten `last_error`).

## Proposed Remediation

**Preferred** (the product decision is still open — see Open Questions):

1. **Keep the verdict.** On `valid`, persist it on the row before any
   WispHub step: the provider validation id, the CEP (clave, amount, date,
   bank, account) and a `cep_valid_at` time. A later attempt of a row that
   has one **does not call the provider again**; it resumes at the step
   that failed.
2. **Say what failed.** The row records the WispHub code, and the ISP sees
   it ("confirmado por Banxico; no pudimos leer WispHub: tu llave no
   funciona"). No provider credit is spent on those retries.
3. **Our own validations are ours, whatever the link.** `tracesToOwnAttempt`
   also forgives an `already_validated` whose CEP clave appears in a
   `validations` row of **this business** with status `valid`, so a
   transfer we validated and never applied can still be applied.

Decision between two options for step 1, asked of the creator on
2026-09-26:
- **A (recommended):** keep the verdict and retry only the WispHub read; the
  payment shows "confirmado, falta registrarlo en WispHub" until it can.
- **B:** confirm at once and queue the WispHub registration as an action
  (`action_outcome = queued`), skipping the "already paid elsewhere" check
  until WispHub answers.

**Files likely to change**:
- `apps/api/src/db/schema.ts` + a migration (the kept verdict on `payments`)
- `apps/api/src/direct-payments/validation.ts` (resume after `valid`;
  `tracesToOwnAttempt`)
- `apps/api/src/credit/topups.ts` if top-ups share the pattern
- tests: `apps/api/test/direct-payment.test.ts`

**Tests to add or update**:
- `valid`, then the WispHub read fails → the next slot makes **no** provider
  call and confirms once WispHub answers.
- `valid` kept on the row survives a provider that later answers
  `not_found`.
- A payment on another link of the same business with the same clave and
  `already_validated = 1` from our own earlier `valid` → not refused as used.
- WispHub never answering → the row ends in a state that says Banxico
  confirmed it (never `expired` for a transfer Banxico confirmed).

## Risks & Considerations

- **Money received, never applied.** The customer paid; Banxico confirmed;
  the ISP's customer stays disconnected and the payment ends `superseded`,
  `expired` or `invalid` — the worst outcome the product can have.
- **Credits wasted.** Every retry after a `valid` is a paid provider call.
- A migration on `payments`; the kept verdict must stay consistent with the
  unique clave index (direct-payment D8).
- The transfer `260928071155271843I` on dev is now refused everywhere; once
  step 3 lands it can be re-submitted.

## Open Questions

- [NEEDS CLARIFICATION: does apiCEP's direct mode hide an already-validated
  CEP (step 5)? One direct call with a clave validated earlier and still
  unapplied would confirm it; apiCEP's support can answer it for free.]

- [NEEDS CLARIFICATION: product decision — option A or option B above.]
- [NEEDS CLARIFICATION: how long may a Banxico-confirmed payment wait for
  WispHub before the ISP is warned, and what state does it end in if WispHub
  never answers?]
