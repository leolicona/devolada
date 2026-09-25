# Bug Assessment: a payer who comes back cannot correct the attempt still in review, so it keeps retrying beside the new one

- **Slug**: one-open-attempt
- **Created**: 2026-09-25 (scope revised the same day)
- **Source**: pasted text (product creator, in session), plus the dev
  database read the same day. No URL supplied, so the URL Trust Policy did
  not apply and nothing was fetched.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

First report:

> "Si otro pago del mismo enlace se confirma, se cierra el reintento previo
> sin registrar referencia ni clave, una validación a la vez por enlace y
> usuario."

Revised in session (2026-09-25), after the product creator confirmed that a
debt can be paid with two transfers:

> "Se debe mostrar claramente en la UI, diferenciar entre subir otro
> comprobante que reemplaza a una validación actual o subir otro
> comprobante para validación. ¿Sería posible validar por archivo? Misma
> clave, si entra por referencia y fecha idéntica."

> "Sí, quítalo [closing other attempts on confirmation]. Scope del bug:
> 'Corregir el comprobante en revisión': el anterior se cierra como
> reemplazado y se valida el nuevo. El segundo punto ['Es otra
> transferencia': los dos se validan por separado] lo vamos a tratar como
> una feature."

### In scope

1. **The page always knows about the attempt in review.** The link's page
   learns from the server whether the link has an open attempt. This holds
   after a reload, hours later, or on another phone.
2. **"Corregir el comprobante en revisión."** With an attempt in review,
   the payer's way to send something new is a correction. The old attempt
   closes as `superseded`, and the new one is validated.
3. **An identical submission creates nothing.** Identical means the same
   file, the same clave, or, for a transfer found by reference, the same
   reference and date (with the same bank and amount). The attempt that
   already exists answers. No new row, no provider query, no fee.

### Out of scope

- **"Es otra transferencia"** (two transfers validated side by side, each
  counting its own money). This will be a separate feature through
  `/speckit-specify`. Until it ships, one link has at most one attempt in
  review.
- **Closing other attempts when a payment confirms.** The product creator
  dropped this on 2026-09-25. With payments made in two parts it could close
  a real transfer.
- **The SPEI date roll-over.** A transfer made after the evening close is
  filed by Banxico under the next operating day. This is what made Abraham's
  first attempt unfindable, and it is a separate issue.

### Evidence (dev D1, read 2026-09-25)

Link `4a70c72d…` (Abraham, `joflores@wifiplus`). Times are CDMX (UTC−6).

| Row | Created | Sent | State |
| --- | --- | --- | --- |
| `d2a101ed` | 24 Sep 23:50 | typed: reference 9784417, AZTECA, $5.00, date 2026-09-24 | `validating`, 7 attempts, `TRANSFER_NOT_FOUND`, next attempt 25 Sep 11:50 (the T+12h late slot) |
| — | 24 Sep 23:53 | receipt, reference only | asked for the clave (shared reference, receipt-triage D7); no row |
| `7beb5137` | 25 Sep 00:16 | receipt with clave `260925071144393084I`, **no `supersedes`** | `confirmed`, $5.00 |
| `679feaa6` | 25 Sep 06:44 | **byte-identical** receipt (extraction `proof_sha256` `e0458062…`, same as `7beb5137`'s) | `invalid`, `TRANSFER_ALREADY_USED`, after a paid provider call |

The 00:16 submission carried no `supersedes`, so the page no longer held
`d2a101ed` in memory. That row polled the provider for 12 hours after the
customer's money was confirmed, and the ISP's feed showed it as
*Verificando* the whole time. The 06:44 re-upload was the same file as a
payment already confirmed on this link. Its answer was right, but it spent a
provider query to reach it.

## Symptom

A payer whose attempt is still in review and who comes back to the link
(reload, new visit, another phone) sees a fresh payment form. Nothing tells
them an attempt is in review, and nothing lets them correct it. What they
send becomes a second, unrelated attempt. The first one keeps retrying
against the provider until its schedule runs out (up to 12 h). Expected: the
page shows the attempt in review and offers "Corregir el comprobante en
revisión", which replaces it. A submission identical to one already on the
link is answered by that one, at no cost.

## Reproduction

1. On a panel link, submit typed transfer data Banxico cannot find. The row
   stays `validating` with `TRANSFER_NOT_FOUND` and a next slot.
2. Reload the page (or open the link on another device). The page shows the
   payment form, not the attempt in review.
3. Upload a receipt with a valid clave. It is sent with no `supersedes`,
   confirms, and the first row keeps retrying until its schedule expires it.
4. Upload the same file again. A provider query is spent to answer
   `TRANSFER_ALREADY_USED`.

Steps 1–3 and 4 are reproduced from dev data (rows above). They are not yet
reproduced in a test.

## Suspected Code Paths

- `apps/pago/src/features/pago/PaymentPage.tsx:515-518`: `resubmitOf`, the
  attempt a new proof supersedes, lives only in React state. So does
  `payment` (the attempt being watched). A reload loses both. The step is
  remembered on the device (`readStep`/`rememberStep`, D19), but the attempt
  is not.
- `apps/pago/src/features/pago/PaymentPage.tsx:843-854`
  (`startOverWithReceipt`) and `:1197-1206`: "Subir otro comprobante" is the
  existing correction door (validation-status-ux D7). It only exists while
  the page still holds the attempt.
- `apps/api/src/routes/direct-payments/handler.ts:193-305` (link GET) and
  `apps/api/src/routes/direct-payments/schema.ts:38` (`linkStatusResponse`):
  the page's first read says nothing about an attempt in review.
- `apps/api/src/routes/direct-payments/handler.ts:356-408` (`submitPayment`,
  D18 block): a prior row is closed only when the body names it in
  `supersedes`. A submission without it leaves every open row alone. The
  `unchanged` comparison there, and the D9 same-submission rule at
  `:640-700`, are today's "identical" rules. Both are limited to the named
  row or to a clave collision, and neither knows about files.
- `apps/api/src/consta/extract.ts:117,199` and `extractions.proof_sha256`
  (`apps/api/src/db/schema.ts:934`): every reading already records the
  file's sha256 against its `proof_key`. That is what file identity needs.
- `apps/api/src/direct-payments/validation.ts:237-264`
  (`announcingWriter`): it writes every verdict by row id with no status
  guard. A row superseded while its own inline attempt is in flight is
  overwritten by that attempt's verdict. This race already exists for D18,
  and the fix makes it more reachable.

## Root Cause Hypothesis

The correction door (validation-status-ux D7) was built on the page's
memory, not on the server's. It works while the payer stays on the page and
disappears the moment they leave. The server never tells the page about an
open attempt, and it accepts a submission without `supersedes` as a new
attempt. So a returning payer can only start a parallel one. The old attempt
has no key in common with the new one, so nothing else ever closes it.
Confidence: **high**. The 00:16 row has `supersedes_id = null`.

## Proposed Remediation

**Preferred**:

1. **Server tells the page (link GET).** `linkStatusResponse` gains an
   optional `inReview`, present when the link has an open attempt (status
   `validating` or `queued_for_credit`; the most recent if there is more
   than one, a state that exists today only from the bug itself). It carries
   `directPaymentId` and nothing else: the page already reads the attempt's
   data and status from `/direct-payments/:id/status`. The link token is
   already the payer's key, and the status route is already public by id,
   so this exposes nothing new.
2. **Page resumes the attempt.** When the GET says `inReview`, the page
   puts that attempt back into `payment`. The existing status polling and
   screens then take over: *Verificando*, the not_found screens, "Corregir
   estos datos". The way out becomes **"Corregir el comprobante en
   revisión"**, which is today's "Subir otro comprobante" renamed (the
   product creator's wording). It sets `resubmitOf` exactly as
   `startOverWithReceipt` does. The page no longer offers a fresh form
   beside an attempt in review. The copy is es-MX and goes through the
   same review as the rest of the page.
3. **Server keeps one attempt in review per link (`submitPayment`).** It
   applies whether or not the body names the attempt in `supersedes`:
   - **Identical → answer with the existing attempt.** The check runs
     against every attempt of the link that is open or confirmed
     (`validating`, `queued_for_credit`, `confirmed`, `partial`,
     `unapplied`). An `invalid` or `expired` one is left out, because its
     transfer may validate now. The payer sees that attempt's real state,
     and nothing is created or billed. Identical is either of:
     - **the same file**: the new proof's sha256 (from its extraction by
       `proof_key`, or hashed from the bucket when there is no reading)
       equals the file behind the other attempt;
     - **the same transfer data**: the same clave; or, with no clave, the
       same reference, date, sending bank and amount. This is the D18
       `unchanged` rule applied to every attempt, not only the named one.
   - **Otherwise, while an attempt is open, the new submission corrects
     it.** That attempt closes as `superseded`, and the new row points at
     it (`supersedesId`). This is D18's own path. Without `supersedes` in
     the body, the server picks the open attempt itself. Until the "Es otra
     transferencia" feature adds an explicit way to say otherwise, one link
     has one attempt in review. The existing release-before-insert and
     `restorePrior` on a refusal still apply, widened from one named row to
     the open rows of the link.
4. **Race guard.** `announcingWriter` writes only while the row is not
   `superseded` (`where id = ? and status != 'superseded'`). When nothing
   was written it returns the current row, so a late inline verdict cannot
   bring a replaced attempt back.

What a closed attempt frees comes from what is already there: the
tracking-key unique index and `sharedReference` both exclude `superseded`,
so its clave or reference can be sent again and validates normally.

**Alternatives**:
- *Remember the attempt on the device only* (like the step). It is smaller,
  but it fails on another phone or with cleared storage, and the server
  would still accept a parallel attempt. It is rejected as the whole fix;
  the page may still use it to avoid a flash before the GET answers.
- *Refuse a submission while an attempt is open.* The product creator
  chose earlier that the payer is never blocked.

**Files likely to change**:
- `apps/api/src/routes/direct-payments/schema.ts`: `inReview` on
  `linkStatusResponse`
- `apps/api/src/routes/direct-payments/handler.ts`: the link GET
  (`inReview`) and `submitPayment` (the identical check across attempts, a
  correction without `supersedes`, restore on a refusal)
- `apps/api/src/direct-payments/validation.ts`: the `announcingWriter`
  guard
- `apps/api/src/direct-payments/proofs.ts` (or beside it): the file
  identity helper (the sha256 of a proof, by extraction or by hashing)
- `apps/pago/src/features/pago/PaymentPage.tsx`: resume the attempt from
  `inReview`; the renamed correction door
- `apps/api/src/db/schema.ts`: the comment on `superseded` gains this path
  (no schema change, no migration)
- Tests: `apps/api/test/direct-payment.test.ts` (or a new
  `apps/api/test/one-open-attempt.test.ts`), the pago component test for
  the payment page, and the MSW/Playwright fixtures that validate
  `linkStatusResponse`

**Tests to add or update** (each citing `bug: one-open-attempt`):
- API: the link GET with an open attempt returns `inReview` with its id. A
  link with only confirmed/invalid/expired attempts returns none.
- API: a typed `not_found` attempt, then a receipt on the same link
  **without `supersedes`**: the first row becomes `superseded` with no next
  slot, the new row's `supersedesId` points at it, and the sweep never calls
  the provider for the first row again.
- API: the same file uploaded again while the first attempt is open, and
  again after it confirmed: the existing attempt answers, no row is
  created, no provider call is made, and no fee is charged.
- API: the same clave, and the same reference + date + bank + amount,
  typed again: the existing attempt answers.
- API: a submission that differs only in the amount is a correction, not
  identical (claimed-amount D4).
- API: a closed attempt's clave, sent again later, validates and confirms.
- API: a refused submission (another link owns the clave): the attempt it
  closed returns to `validating` with its old slot.
- API: race. A row superseded while its inline attempt is in flight keeps
  `superseded` when the verdict arrives.
- API: attempts on another link are never touched.
- Component (pago): with `inReview` in the GET, the page opens on the
  attempt's state (not the form) and shows "Corregir el comprobante en
  revisión". Pressing it and submitting sends `supersedes` with that id.
  axe passes on the resumed screen.

## Risks & Considerations

- **A real second transfer, before the feature ships.** A payer who really
  paid in two parts and sends the second while the first is in review will
  now *replace* the first. The money is not lost: its clave is freed and it
  validates when sent again. But the page does not yet offer "Es otra
  transferencia". Today the same payer gets two parallel attempts, so this
  is a behaviour change, and the feature closes it.
- **Identical by reference is weaker than by clave.** One bank printed the
  same reference (9784417) on three different $5 transfers the same night.
  Two real transfers with the same reference, date, bank and amount would
  be treated as identical. Until the feature ships this answers with the
  existing attempt. The feature will need to ask for the clave in that
  case, as receipt-triage D7 already does across links.
- **Billing.** A closed attempt reached no verdict and is never charged. An
  identical submission now spends nothing where it used to spend a query.
- **API links.** API links use the same page and route, so they get the
  same behaviour. A replaced attempt on an API link is announced as
  `superseded`. That is already a documented status and webhook event,
  nothing new.
- **`HOURLY_ATTEMPT_BUDGET`** counts rows created. An identical submission
  creates none, so it no longer counts against the payer.
- **Observability.** Log one line when a submission is answered by an
  identical attempt, and one when it replaces an attempt, so both can be
  counted.

## Open Questions

- None blocking. The separate items are the "Es otra transferencia" feature
  (`/speckit-specify`) and the SPEI date roll-over (its own bug).
