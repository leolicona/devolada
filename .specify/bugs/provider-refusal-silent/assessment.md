# Bug Assessment: when apiCEP refuses every call, payments wait six hours in silence and expire

- **Slug**: provider-refusal-silent
- **Created**: 2026-09-26
- **Source**: pasted text (product creator, in session, with a screenshot of
  the payment page and a photo of the receipt), plus a read-only look at the
  dev D1 the same day. No URL supplied, so the URL Trust Policy did not apply
  and nothing was fetched.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> "Subí este comprobante, pero al parecer ahora no es posible visualizar los
> datos con que se está validando, referencia o Clabe, y no da la opción de
> remplazar el recibo."

The screenshot (dev, `link.dev.devoladapago.com`, FastIsp / Marcos Antonio)
shows only the badge "Verificando pago" and "Estamos verificando tu
transferencia. Esto puede tomar unos minutos; puedes dejar esta página
abierta." — no data read, no way to change the receipt.

The receipt: Banco Azteca, $3.00, 25/Sep/2026 18:58:48 CST, Cuenta origen
"Guardadito ***8301", Cuenta destino "Leo Licona / Bbva Mexico ***417",
Concepto "Bancomer", Referencia 9784417, Clave de rastreo
260928071152850963I, Folio 0000202.

## Symptom

The payer's page stays on its first, calm "Verificando pago" screen, with
nothing to check and nothing to do, while every validation attempt fails
because the provider (apiCEP) refuses the call with HTTP 403. The payment
rides the whole six-hour schedule this way and then expires. Nobody is told
— not the payer, not the ISP, not the platform operator. Expected: a
provider that refuses us is recognised as such, the payer is told in words
that their payment is saved and will be checked, the operator is warned,
and the payment does not expire because of our provider.

## Reproduction

Observed on dev (read-only, 2026-09-26):

1. `validations`: the 19 calls from 2026-09-25 05:41 to 15:58 UTC answered
   200; the last of them carried `quota_remaining = 1` (apiCEP's
   `X-RateLimit-Remaining`). Every call since 2026-09-25 17:50:49 UTC — six
   so far — answered `provider_http_status = 403`, with no validation id and
   no provider time.
2. Payment `221a806c-…` ("Juan Fernando", the Nu capture of 2026-09-25):
   7 attempts, `last_error = PROVIDER_UNAVAILABLE`, now `expired`.
3. Payment `bdf9a948-…` ("Marcos Antonio", this report): created 01:00:46
   UTC, 4 attempts so far, all 403, `last_error = PROVIDER_UNAVAILABLE`,
   `status = validating`, next attempt 01:45:46 UTC; no key, bank or date on
   the row (`reading_check` NULL — the comparison runs only after a
   provider answer).

To reproduce in tests: make the apiCEP interceptor answer 403 to every
`/validate-transfer`, submit a receipt payment, run the sweep past the last
slot (`REVALIDATION_OFFSETS_MINUTES = [2, 8, 20, 45, 120, 360]`); the row
ends `expired` with `PROVIDER_UNAVAILABLE`, and the public status never
carries anything but the calm state.

[NEEDS CLARIFICATION: the 403's body. The engine keeps the status and the
telemetry but not the body, so "quota exhausted" is an inference from the
last `quota_remaining = 1`, not a message we read. The apiCEP dashboard for
the dev token says which it is — quota, a suspended account, or a blocked
origin.]

## Suspected Code Paths

- `apps/api/src/consta/provider/apicep.ts::classifyHttpFailure` — 401, 429,
  400/405/422 are named; every other status, **403 included**, falls to
  "500 and anything unrecognised: the only genuinely transient rows" →
  `PROVIDER_UNAVAILABLE`, retryable. A refusal that will not clear by waiting
  is filed as weather.
- `apps/api/src/direct-payments/validation.ts` (the `catch` around
  `consta(...).validate`, and `retryLater`) — every engine failure rides the
  schedule "whether or not waiting can help" (consta-api-merge D6, FR-011),
  and the last slot turns the row `expired`. The same holds for top-ups
  (`apps/api/src/credit/topups.ts`, same `catch`).
- `apps/api/src/consta/failure.ts` — its own header says `retryable` "is
  carried and NOT yet acted on … Honouring `false` … is a product decision of
  its own".
- `apps/api/src/consta/provider/apicep.ts::readTelemetry` and
  `apps/api/src/consta/validate.ts` — `quotaRemaining` is recorded on every
  `validations` row and **read by nothing**: no warning at a low quota, no
  line in `/operador`.
- `apps/pago/src/features/pago/PaymentPage.tsx` (status `validating`, the
  `!notFound` branch) — the calm `Pending` sentence is all the page shows for
  any error that is not `TRANSFER_NOT_FOUND` / `REFERENCE_*`; "Ver los datos
  enviados" and "Corregir el comprobante en revisión" live only on the
  not_found screens (validation-status-ux D2, D7). With a provider that never
  answers, the payer never reaches them.

## Root Cause Hypothesis

The dev apiCEP account stopped accepting calls on 2026-09-25 at 17:50 UTC —
most likely its quota ran out, since the last accepted call reported one
call left. The engine does not recognise a 403, so it classifies the refusal
as a transient outage, and the lifecycle retries it on the six-hour schedule
until the payment expires. Nothing reads the quota the provider reports, so
no one is warned before it runs out, and the payer page shows the refusal
exactly like a normal first wait: calm, with no data and no action.
Confidence: **high** for the mechanism (every row and branch above was read),
**medium** for "quota" as the cause of the 403 (see the open question).

## Proposed Remediation

**Preferred**:

1. *Name the refusal.* In `classifyHttpFailure`, map 403 to a code of its
   own — e.g. `PROVIDER_REFUSED` — and keep the body's `error` in the
   failure message and on the row's note, so the next refusal is read, not
   inferred. Treat it like 401's non-transient branch: waiting does not
   help.
2. *Don't let our provider expire a payer's payment.* While the provider
   refuses, the lifecycle holds the payment instead of spending its
   schedule: it keeps the row `validating` with the refusal code and
   re-tries on a slow cadence (the cron already runs every minute), and the
   six-hour clock does not count those attempts. This mirrors how
   `queued_for_credit` holds a paused business's payments until it can
   validate them.
3. *Warn the operator once.* On the first refusal (and when
   `quota_remaining` falls under a threshold), email
   `PLATFORM_OPERATOR_EMAILS` through the existing Resend path, and show the
   provider's state — last answer, quota left — in `/operador`. Absent
   Resend key → logged, as everywhere (constitution VIII).
4. *Tell the payer the truth.* When the row's error is a provider refusal
   (or any `PROVIDER_*`), the page says in words that their receipt was
   received and saved, that validation is paused on our side, and that they
   need to do nothing — not the promise of "unos minutos".

**Alternatives**:

- *Only the classification + operator warning (1 and 3).* Smallest change,
  and it gets someone to top up the account; but payments keep expiring
  during the outage, and the payer still waits with no word.
- *Show the reading and the replace action in the calm state too* — the
  creator's literal ask ("visualizar los datos … y reemplazar el recibo").
  It changes validation-status-ux D2/D7 (verifying is free, editing is
  deliberate; the way out lives on not_found screens) for every wait, not
  just this failure, and it needs the draft reading on the status (the row
  holds no key until the first provider answer). A product decision, not a
  bug fix — see Open Questions.

**Files likely to change**:

- `apps/api/src/consta/provider/apicep.ts`, `apps/api/src/consta/failure.ts`
- `apps/api/src/direct-payments/validation.ts`, `apps/api/src/direct-payments/schedule.ts`
- `apps/api/src/credit/topups.ts` (the same catch)
- a notice for the operator (beside the landing's request notice) and a line
  in `/operador`
- `apps/api/src/routes/direct-payments/schema.ts` (the public error code) and
  `apps/pago/src/features/pago/PaymentPage.tsx` (the copy)

**Tests to add or update**:

- apiCEP 403 → `PROVIDER_REFUSED`, not retryable; the body's error is kept
  (`test/consta/validate.test.ts`).
- A receipt payment whose every attempt is refused stays `validating` past
  the six-hour mark, and validates normally once the provider answers again
  (`test/direct-payment.test.ts`).
- The operator notice goes once per refusal episode, and not at all without
  a Resend key.
- The payer page's copy for a provider refusal (`apps/pago` component test).
- The same for a top-up.

## Risks & Considerations

- **Prod has the same cliff.** Prod has no payments yet, but its token has a
  quota too. The first day it runs out, every payer's payment expires after
  six hours and nobody is told. This is why the severity is high even though
  no money moves: an ISP's customers stay disconnected.
- **Holding versus expiring changes a promise.** A payment that no longer
  expires at six hours while our provider is down must still end somewhere;
  the hold needs a ceiling, and the page and the ISP's feed must say "held".
- **An unsent refusal is not a billed call.** The 403 rows carry no
  validation id; keep them out of the credit and the invoice (constitution
  II), as today.
- **Immediate, outside the code:** the dev apiCEP account needs its quota
  restored (or its token checked) before any validation on dev works again —
  including the bench measurement of receipt-reader-tuning (T037) and the two
  payments above. `bdf9a948-…` will expire at the 360-minute slot
  (~07:00 UTC on 2026-09-26) if nothing changes before then.
- **Not part of this bug:** on the same receipt, our reader (Mistral, the
  version-2 questions) returned no clave although the receipt prints "Clave
  de rastreo 260928071152850963I" in its "Consulta el estatus en" block. That
  is a reading-accuracy finding for the receipt-reader-tuning bench (T037),
  where it should be uploaded and marked.

## Open Questions

- [NEEDS CLARIFICATION: what the 403 says — quota exhausted, suspended
  account, or blocked origin? The apiCEP dashboard for the dev token
  answers it.]
- [NEEDS CLARIFICATION: product decision — during a provider refusal, should
  the payment be held (no expiry) or keep today's six-hour expiry?]
- [NEEDS CLARIFICATION: product decision — should the first "Verificando
  pago" screen always show what was read and offer "Corregir el comprobante
  en revisión", or only when something is wrong (as validation-status-ux
  D2/D7 decided)?]
