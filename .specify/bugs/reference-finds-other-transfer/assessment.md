# Bug Assessment: a receipt with no clave can be confirmed with a different transfer that shares its reference

- **Slug**: reference-finds-other-transfer
- **Created**: 2026-09-26
- **Source**: pasted text (product creator, in session, with photos of two
  Banco Azteca receipts), plus a read-only look at the dev D1 the same day.
  No URL supplied, so the URL Trust Policy did not apply and nothing was
  fetched.
- **Verdict**: valid
- **Severity**: critical

## Report (verbatim or summarized)

> "Ayer hice estas dos transferencias. Los dos tienen el mismo número de
> referencia. […] hice una segunda transferencia para probar con otro recibo,
> subí y me dijo que ya existía. Supongo que por la referencia […] ¿estamos
> también validando con la hora y los segundos en el paso donde se verifica
> que no exista un pago con la misma referencia? ¿Qué devuelve Banxico
> cuando tiene más de un registro con números de referencia idénticos?"

The creator made several $3.00 transfers from the same Azteca account to
the same BBVA account (***417), all with referencia 9784417: at least one
on Friday 25 before 18:00 (clave `260925011145184062I`), one at 18:58
(`260928071152850963I`), one at 22:46 (`260928071155271843I`), and two on
Saturday 26 at 07:08 and 07:10.

## Symptom

A receipt that shows only the reference was **confirmed with a different
real transfer** — the one of the same reference, amount and accounts that
Banxico filed on another operation day. From then on, every other receipt
of that reference was refused as "already used". Expected: a CEP found by
reference is accepted only when it can be the transfer on the receipt;
when the reference alone cannot tell the transfers apart, the payer is
asked for the clave.

## Reproduction

Observed on dev (read-only, 2026-09-26):

1. Payment `7cd88a3a-…` (Janely), 04:41 UTC: our reading of the receipt is
   the **18:58** one (printed 25/Sep 18:58, referencia 9784417, no clave —
   `extractions` 04:41:43, `transfer_time = 18:58`). The receipt door
   answered `valid` with clave **`260925011145184062I`**, CEP date
   **2026-09-25** — the transfer made *before* 18:00. The payment
   confirmed. By the 18:00 rule the 18:58 receipt's operation day is Monday
   28 (bug `reference-search-business-day`), not the 25th.
2. Payments `be66f64c-…`, `0527804e-…`, `3696493c-…` and `bdf9a948-…`
   (the 18:58 and 22:46 receipts, uploaded again with no clave read): the
   provider answered `valid` with that same clave `260925011145184062I`
   and `already_validated = 1` each time → `TRANSFER_ALREADY_USED`.
3. Payment `6b36dc50-…` (Valentin), 04:44 UTC: the same 18:58 receipt,
   this time with the clave read (`260928071152850963I`) → `valid`, CEP
   date 2026-09-28, confirmed. **So one receipt confirmed two payments**:
   Janely's with somebody's (here: the creator's own) earlier transfer, and
   Valentin's with its own.

The provider never answered `422` ("referencia duplicada, requiere clave de
rastreo") in any of these calls.

## Suspected Code Paths

- `apps/api/src/direct-payments/validation.ts` — after a `valid` verdict the
  CEP is checked for the account (`tieCepAccount`, receipt-triage D22), the
  age (`STALE_TRANSFER_DAYS`) and prior use (`alreadyValidated`,
  `sharedReference` when there is no clave), but **never against the
  receipt's own date and time**. A CEP whose operation day cannot be the
  receipt's is confirmed.
- `apps/api/src/consta/validate.ts` — `compareReadings` runs only on a
  `not_found` (`providerFirst && status === "invalid" && reason ===
  "not_found"`); a `valid` answer is never compared with our reading.
- `apps/api/src/consta/provider/apicep.ts` — `cepDetails` is parsed for
  `operationDate` only. apiCEP does return the time
  (`cepDetails.processingTime`, `HH:MM:SS`; measured 2026-09-26, see
  `measurement.md`).
- `apps/api/src/direct-payments/validation.ts::sharedReference`
  (receipt-triage D7) — compares reference, date, bank, amount and account
  among **our** payments only; it cannot see a transfer nobody submitted
  yet, and it has no time.

## Root Cause Hypothesis

A reference is not unique: the payer types it, and the same payer (or two
payers) can reuse it with the same amount and accounts. On the receipt
door the provider searches by what it reads and returns the one transfer
it finds for the day it searched — here the calendar day printed, the 25th,
where exactly one transfer had that reference, so there was nothing
"duplicated" to report. Devolada accepts a `valid` CEP without checking
that it can be the receipt's transfer, although the receipt's printed date
and time (and so its operation day) are in hand. Confidence: **high** for
the mechanism (the rows above); **medium** for how the provider picks among
several same-day candidates (not documented; it answered with the one
still unused on the 26th at 13:09 — an inference).

## Proposed Remediation

**Preferred**: accept a CEP found **without a clave** only when it can be
the receipt's transfer:

1. **Operation day must match.** Compute the receipt's operation day from
   its printed date and time with the business-day rule (bug
   `reference-search-business-day`) and require the CEP's `operationDate`
   to equal it — or the alternate day that rule allows. A mismatch is not
   a confirmation: the row records the CEP it rejected and asks the payer
   for the clave (the existing `REFERENCE_AMBIGUOUS` ask, receipt-triage
   D17), without spending more calls by reference.
2. **Time, when the provider gives it.** If apiCEP's CEP carries the
   operation's time, require it within a small window of the time printed
   (a minute or two — receipts print the bank's time, the CEP Banxico's).
3. **A receipt that shows a clave is searched by it.** Where our reader read
   a clave, the paid call carries it (already the transfer door's rule);
   the image door's own choice by reference must not win over a clave we
   hold.

**Alternatives**:
- *Always ask for the clave when a receipt shows only a reference.* Safe
  and simple, but a real share of receipts print no clave ("En proceso",
  summary screens — receipt-triage's receipt 2); it would undo the
  reference door.
- *Match only the time.* Needs the CEP's time, which may not come.

**Files likely to change**:
- `apps/api/src/direct-payments/validation.ts` (the `valid` branch)
- `apps/api/src/consta/provider/apicep.ts` and `provider/types.ts` (the CEP
  time, if present)
- `apps/api/src/direct-payments/search-date.ts` (shared operation-day rule)
- tests: `apps/api/test/direct-payment.test.ts`, `test/consta/validate.test.ts`

**Tests to add or update**:
- A receipt printed Friday 18:58 with no clave; the provider answers
  `valid` with a CEP dated that Friday → not confirmed, the clave is asked.
- The same with a CEP dated Monday → confirmed.
- A CEP with a time 3 h away from the printed time → not confirmed (if the
  time is available).
- A receipt whose clave was read: the confirmation holds only for that
  clave.

## Risks & Considerations

- **Money reaches the wrong customer's account in WispHub.** In production
  payer A's receipt can consume payer B's transfer; B is then told their
  transfer "was already used". The ISP received the money, but it is
  applied to the wrong customer, and B has done nothing wrong.
- A strict day check can refuse a real transfer whose bank prints a day
  that Banxico files differently; the alternate day and the ask for the
  clave are the way out, never a silent refusal.
- The dev payment `7cd88a3a-…` (Janely) stays confirmed with the wrong
  transfer; it is the creator's own test money. [NEEDS CLARIFICATION: leave
  it as is?]

## Measured 2026-09-26

`measurement.md` beside this file holds the 15 direct apiCEP calls made
with `scripts/apicep-probe.sh`. What they settle for this bug:

- The provider **never** answers `422` for a duplicate reference. Several
  matches come back as `invalid` + `banxicoConfirmed: true` + a ZIP with
  one Banxico CEP per match (credit time included). One match comes back
  `valid`; none as `invalid` + `banxicoConfirmed: false`.
- The amount and the sending bank filter before the search; the time does
  not — the ambiguity left is same reference, amount, bank and day.
- The CEP carries the credit time, so remediation step 2 is possible.
- A CEP validated before is returned again, flagged
  `cepPreviouslyValidated: true`.

## Open Questions

- ~~Does apiCEP's `cepDetails` include the operation time?~~ Yes — measured
  2026-09-26.
- [NEEDS CLARIFICATION: product decision — when the day does not match,
  ask the payer for the clave at once (recommended), or first retry by
  reference on the right day?]
- [NEEDS CLARIFICATION: product decision — on an ambiguous answer, open the
  provider's ZIP and pick by credit time / unused clave, or ask the payer
  for the clave?]

## Fixed by spec 013 (2026-09-27)

`specs/013-cep-bundle-match` answers the two open product decisions above
and removes the cause. FR-014 (`cep-bundle-match D9`): a single `valid`
found without a clave — by reference on the transfer door, or on the
receipt door with no clave either reading passed — no longer confirms
unchecked. Its CEP becomes a record and passes the same matcher as a
several-matches bundle (integrity, used, the sender's four digits, the
receipt's time within −60/+180 s); a CEP the receipt contradicts leaves the
payment `validating` with `CEP_UNDECIDED`, and the payer is asked for the
clave, with no further call and no expiry (D10). The ZIP of several matches
is opened and decided by tail and credit time (D6–D8), which answers the
second question; the first is moot, since the matcher's window replaces a
separate day check.

The trace for a flag our own search set is `cep-bundle-match D13`
(FR-016): the true owner of a clave the matcher refused confirms when they
find it by clave, instead of `TRANSFER_ALREADY_USED`.

Proved by, in `apps/api/test/cep-bundle-match.test.ts`:

- T020 (e) — "the Janely case as it happened: a receipt printed 18:58 with
  no clave, answered by a single valid credited 07:19:52, does not confirm
  — the clave is asked (bug: reference-finds-other-transfer)", on the
  receipt door's first attempt;
- T021 (c) — "the true owner of a clave the filter refused confirms when
  they find it by clave — not TRANSFER_ALREADY_USED", and its bundle twin.

Both read their receipts through provisional reader stubs until the bench
measures version 3 of the questions (debt
`cep-bundle-match-reader-unmeasured`). After merge, run
`/speckit-bug-test` on this bug. The dev payment `7cd88a3a-…` is untouched:
it is the creator's own money, and the question above still stands.
