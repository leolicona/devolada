# Bug Assessment: a payer's failed attempt keeps retrying after their payment on the same link confirms

- **Slug**: one-open-attempt
- **Created**: 2026-09-25
- **Source**: pasted text (product creator, in session), plus the dev
  database read the same day. No URL supplied, so the URL Trust Policy did
  not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> "Si otro pago del mismo enlace se confirma, se cierra el reintento previo
> sin registrar referencia ni clave, una validación a la vez por enlace y
> usuario."

Clarified in session (2026-09-25) when asked what happens when a new payment
arrives while another is still validating:

> "El nuevo reemplaza. El intento anterior se cierra como 'reemplazado' y se
> valida el nuevo. El pagador nunca se bloquea. Si el anterior era una
> transferencia real, su clave o referencia queda libre y puede volver a
> enviar después. Si la información es idéntica, se mantiene el proceso
> actual."

So the rule has two parts:

1. **At most one open attempt per link.** A new submission on a link closes
   any attempt of that link still open as `superseded` and validates the new
   one. An identical resubmission keeps today's behaviour (the existing row
   answers; nothing new is created or billed).
2. **A confirmation closes what is left open.** When a payment of a link
   confirms, any other open attempt of the same link closes as `superseded`.
   It does not matter whether the two share a reference or a clave.

A panel link belongs to exactly one WispHub customer
(`payment_links_panel_usuario_idx`), so "por enlace y usuario" is "per link".

### Evidence (dev D1, read 2026-09-25)

Link `4a70c72d…` (Abraham, `joflores@wifiplus`), times in CDMX (UTC−6):

| Row | Created | Sent | State |
| --- | --- | --- | --- |
| `d2a101ed` | 24 Sep 23:50 | typed: reference 9784417, AZTECA, $5.00, date 2026-09-24 | `validating`, 7 attempts, `TRANSFER_NOT_FOUND`, next attempt 25 Sep 11:50 (the T+12h late slot) |
| — | 24 Sep 23:53 | receipt, reference only | asked for the clave (shared reference, D7); no row |
| `7beb5137` | 25 Sep 00:16 | receipt with clave `260925071144393084I` | `confirmed`, $5.00 |
| `679feaa6` | 25 Sep 06:44 | the same receipt again | `invalid`, `TRANSFER_ALREADY_USED` (correct) |

`d2a101ed` never had a chance: the transfer was made after SPEI's evening
close and Banxico filed it under 2026-09-25 (the clave starts `260925`),
while the payer typed the 24th. Also, the reference 9784417 came back from
Banxico on three different $5 transfers that night (Janely, Valentín,
Abraham). Yet the row kept polling, spending a provider query each time. It
also kept showing as *Verificando* in the ISP's feed for 12 hours after the
customer's money was confirmed. The date roll-over is a separate issue and
is **not** in this bug's scope (see Open Questions).

## Symptom

A payer whose first attempt fails and who then pays successfully through a
second attempt on the same link leaves the first attempt open. It keeps
retrying against the provider until its schedule runs out (up to 12 h). The
ISP sees it as pending the whole time. Expected: once the link has a
confirmed payment, or a newer attempt, the older open attempt stops and
reads as replaced.

## Reproduction

1. On a panel link, submit typed transfer data that Banxico cannot find
   (for example a reference with the wrong date). The row stays `validating`
   with `TRANSFER_NOT_FOUND` and a next slot.
2. On the same link, without answering the "check your data" prompt
   (so no `supersedes` in the body), upload a receipt with a valid clave.
3. The second row confirms. The first row remains `validating`, keeps its
   `next_validation_at`, and the every-minute sweep keeps calling the
   provider for it until its schedule expires it.

Reproduced from data on dev (rows above); not yet reproduced in a test.

## Suspected Code Paths

- `apps/api/src/routes/direct-payments/handler.ts:356-408` (`submitPayment`,
  D18 block): a prior row is closed **only** when the body names it in
  `supersedes`. That happens when the payer answers the `not_found` prompt.
  A fresh submission on the same link, which is what Abraham did, leaves
  every other open row alone.
- `apps/api/src/routes/direct-payments/handler.ts:561-566` and `:621-631`:
  where the D18 prior is released before the insert and restored on a
  refusal. This is the machinery the new rule should reuse for "all open
  rows of the link", not only the named one.
- `apps/api/src/routes/direct-payments/handler.ts:640-700`: the D9 collision
  path (the same clave already `validating` on the same link). With identical
  data it returns the existing row. That is the "identical info keeps the
  current process" behaviour the product creator wants kept.
- `apps/api/src/direct-payments/validation.ts:852-882`: the one place today
  where a confirmation closes other rows. It closes only `expired` rides
  **with the same tracking key** (provisional-release D7). A reference-only
  row has no key, and a `validating` row is never touched.
- `apps/api/src/direct-payments/validation.ts:237-264` (`announcingWriter`):
  every verdict of a validation, confirmation included, is written here by
  row id with no status guard. A row superseded while its own inline attempt
  is in flight would be overwritten by that attempt's verdict.
- `apps/api/src/routes/payments/handler.ts:385-455` (`reviewDecision`): a
  held confirmation (`actionOutcome: "review"`, receipt-triage D31) is only
  confirmed for real when the ISP accepts it.

## Root Cause Hypothesis

The lifecycle has no rule linking attempts of the same link to each other.
An attempt is closed by another only when it is explicitly named (D18
`supersedes`) or when it shares a tracking key with a later confirmation
(provisional-release D7). A typed attempt that failed by reference has no
tracking key, and the payer's next submission did not name it. So nothing
ever closes it: it runs its full retry schedule on its own. Confidence:
**high**. The rows on dev match each branch above.

## Proposed Remediation

**Preferred**: one helper, used in two places.

`closeOpenAttempts(db, link, { except, now, defer })` in
`apps/api/src/direct-payments/validation.ts`. It sets every row of the link
with status `validating` or `queued_for_credit`, other than `except`, to
`superseded` with `nextValidationAt: null`. An API link's rows are announced
one by one, as provisional-release D7 already does for expired rides
(automated-collections-api D17: a caller that heard `validating` hears
`superseded`). The helper returns the rows it closed.

1. **On submission** (`submitPayment`), before the insert:
   - Find the link's open rows (`validating` / `queued_for_credit`).
   - If one of them matches the submission **identically**, answer with that
     row and create nothing. That is the current D18 `unchanged` comparison
     for typed data and the D9 same-submission rule for a clave, applied to
     any open row rather than only the one named in `supersedes`.
   - Otherwise close them all with the helper. That release has to happen
     *before* the insert, for the same reason D18's does: the unique index
     must not see the old claim. If the insert is then refused, they are
     restored, just as `restorePrior` does today (widened from one row to
     the list).
   - The D18 `supersedes` field keeps working. The named prior is simply one
     of the open rows, and `supersedesId` still points at it. When no
     prior was named, `supersedesId` points at the most recent row closed.
2. **On confirmation**, in `runValidation`: once the row's verdict is
   `confirmed`, `partial` or `unapplied` and it is **not** held for review,
   call the helper with `except: payment.id`. A held row (`actionOutcome:
   "review"`) closes its siblings from `reviewDecision` on `accept`. On
   `reject` nothing is closed: the money was not the business's, so the
   other attempt may still be the real one.
3. **Race guard**: `announcingWriter` writes only while the row is not
   `superseded` (`where id = ? and status != 'superseded'`). If nothing was
   written, it returns the current row unchanged. This way an inline attempt
   that finishes after its row was replaced cannot bring it back or confirm
   it. The same race exists today for D18. This closes it for both.

Freeing works through what is already there: the tracking-key unique index
and `sharedReference` both exclude `superseded`. A closed attempt's clave or
reference can be sent again later, and it validates normally.

**Alternatives**:
- *Close only on confirmation* (part 2 without part 1). This is smaller,
  but two attempts would still poll side by side until one confirms. That
  goes against the "una validación a la vez" rule the product creator set.
- *Refuse the new submission while one is open.* The product creator chose
  against this (the payer is never blocked). It would have kept Abraham
  from sending his clave at 00:16.

**Files likely to change**:
- `apps/api/src/direct-payments/validation.ts`: the helper, the call after
  a confirmed verdict, and the `announcingWriter` guard
- `apps/api/src/routes/direct-payments/handler.ts`: `submitPayment`
  (identical check across open rows, close before the insert, restore on a
  refusal)
- `apps/api/src/routes/payments/handler.ts`: `reviewDecision` accept
  closes siblings
- `apps/api/src/db/schema.ts`: the comment on `superseded` gains this
  third reason (no schema change, no migration)
- `apps/api/test/direct-payment.test.ts` (or a new
  `apps/api/test/one-open-attempt.test.ts`) and the v1 webhook test for
  the API-link announcement

**Tests to add or update** (each citing `bug: one-open-attempt`):
- Typed attempt with `not_found`, then a new receipt on the same link
  (no `supersedes`): the first row becomes `superseded` with no next slot
  **at submission**, and the sweep never calls the provider for it again.
- An open attempt on link A while a payment on link A confirms: the open
  one is `superseded`. An open attempt on link B is untouched.
- Identical resubmission (same typed data; same clave) while the first is
  open: the same row answers, no new row, no provider call, not billed.
- A closed attempt's clave, sent again later, validates and confirms (the
  index and `sharedReference` let it through).
- A refused submission (another link owns the clave): the rows it closed
  come back to `validating` with their old slots.
- A confirmation held for review closes nothing. `accept` closes the
  siblings, `reject` does not.
- API link: each closed row is announced as `superseded` once.
- Race: a row superseded while its inline attempt is in flight keeps
  `superseded` when the attempt's verdict arrives.

## Risks & Considerations

- **Two real transfers at once.** A payer who really made two transfers
  (for example two halves of one debt) and submits the second while the
  first is still pending would see the first closed. The money is not lost:
  its clave is free and it validates when sent again. But nothing tells the
  payer to send it again. This is the trade-off the product creator
  accepted. The feed shows the closed row as *Vencido* today
  (`FeedScreen.tsx:77` maps `superseded` to `paymentExpired`), so the ISP
  can see it.
- **Billing.** A closed row made no verdict, so it is never charged
  (`debitValidationFee` keys on a terminal verdict). Closing early only
  saves provider queries.
- **API contract.** `superseded` is already a documented webhook event and
  status. It will now be sent in a new situation, but no new value is
  added.
- **`HOURLY_ATTEMPT_BUDGET`** counts rows created, not rows open. It is
  unchanged: a payer replacing attempts still hits the same hourly limit.
- **Observability.** Log one line per sweep or submission that closed
  anything, counting the rows closed. That way we can measure how often
  the rule fires.

## Open Questions

- The date roll-over that made Abraham's first attempt unfindable (a
  transfer after SPEI's evening close is filed by Banxico under the next
  operating day) is out of scope here. It needs its own decision: retry a
  `not_found` reference search with the next day. Should it be logged as a
  separate bug?
- For a receipt (not typed), is "identical" the same file (the same
  `proof_sha256` in `extractions`)? Or the same clave once it is read? The
  proposal uses the existing rules (D18 `unchanged` for typed data, D9 for a
  clave). A byte-identical re-upload of a receipt whose clave was never
  read would still create a new attempt.
