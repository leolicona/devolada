# Bug Fix: a payer who comes back cannot correct the attempt still in review, so it keeps retrying beside the new one

- **Slug**: one-open-attempt
- **Fixed**: 2026-09-25
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The link's page now learns from the server which attempt is still in
review, so a payer who reloads or comes back resumes it. Its way out is
"Corregir el comprobante en revisión". On a panel link, the server closes
the attempt in review as `superseded` when a new submission arrives, even
when the page did not name it. A submission identical to an attempt the
link holds (same file, same clave, or same reference, date, bank and
amount) is answered without creating a row or calling anyone.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/routes/direct-payments/schema.ts` | modified | `linkStatusResponse.inReview` (id + status); comment on `supersedes` |
| `apps/api/src/routes/direct-payments/handler.ts` | modified | `openAttempts`, `inReviewOf`, `identicalAttempt`, `proofSha256`; the link GET adds `inReview` (panel links); `submitPayment` answers an identical submission first, corrects the open attempt(s) when no `supersedes` is named, restores all closed rows on a refusal, announces each closed row on an API link, and carries a prior's receipt status only for the same capture |
| `apps/api/src/direct-payments/validation.ts` | modified | the claim before a paid call skips a `superseded` row; `announcingWriter` drops non-paying writes on a `superseded` row |
| `apps/api/src/consta/extraction/proof.ts`, `index.ts` | modified | `sha256Hex` exported, so the file fingerprint is the engine's own recipe |
| `apps/api/src/db/schema.ts` | modified | comment on `superseded` (no schema change, no migration) |
| `apps/pago/src/features/pago/PaymentPage.tsx` | modified | `payment` is the visit's own payment or the one the link names in review; walking out marks it left behind; the not_found door renamed "Corregir el comprobante en revisión" |
| `apps/api/test/direct-payment.test.ts` | added tests / updated 2 | new `bug: one-open-attempt` block (9 tests); scenarios 18 and 18c no longer mock WispHub reads |
| `apps/pago/test/pago.test.tsx` | added tests / updated 2 | new `bug: one-open-attempt` block (2 tests); the two tests naming the old label |

## Diff Highlights

```ts
// submitPayment — identical first, then one attempt in review per panel link
const same = await identicalAttempt(c.env, db, business, link, body);
if (same && OPEN_STATUSES.includes(same.status)) return 200 /* that attempt */;
if (same) return 409 TRANSFER_ALREADY_USED /* paid already, no provider call */;
…
const open = isPanelLink(link) ? await openAttempts(db, link.id) : [];
superseded ??= open[0] ?? null;
```

```ts
// runValidation — the claim is the last look before a paid call
const [claimed] = await db.update(payments).set({ validationAttempts: attempts })
  .where(and(eq(payments.id, payment.id), ne(payments.status, "superseded"))).returning();
if (!claimed) return current;
```

## Tests Added or Updated

- `apps/api/test/direct-payment.test.ts` › `bug: one-open-attempt`:
  - the link names the attempt in review, and only while one is open
  - a submission without `supersedes` corrects the attempt in review; the
    sweep 13 h later makes no provider call for it (the Abraham case)
  - the same file re-uploaded under a new, never-read key answers with the
    open attempt: no row, no WispHub read, no provider call
  - the same file as a payment already confirmed on the link → 409
    `TRANSFER_ALREADY_USED`, no row, no call, the rejection recorded
  - the same reference, date, bank and amount typed again → the open
    attempt answers
  - the same reference as a payment already paid is **not** refused: it
    goes to Banxico
  - the same reference with another date is a correction (supersedes)
  - a refused correction (another customer owns the clave) restores the
    attempt in review with its slot
  - an attempt replaced after it was read is never sent to the provider
  - an API link's page names no attempt in review
- `direct-payment.test.ts` scenario 18 / 18c: same behaviour, and it now
  happens before any WispHub read (the mocks were removed with a comment)
- `apps/pago/test/pago.test.tsx` › `bug: one-open-attempt`: a fresh visit
  with `inReview` opens on the attempt (axe passes), and the correction
  sends `supersedes: "dp-1"` without being pulled back into it. With
  nothing in review, the page starts from the transfer.
- `pago.test.tsx` US-D12 scenarios 4 and 8: the renamed door

## Local Verification

- `pnpm -r --if-present test` → ui 50, api 695, landing 10, pago 81,
  admin 244. All pass.
- `pnpm -r --if-present typecheck` → clean in every workspace
- `pnpm -r --if-present build` → all four apps and `packages/ui` build
- `node scripts/spec-lint.mjs`, `gen-banks.mjs --check`,
  `contrast-lint.mjs`, `pending-lint.mjs` → all pass (contrast shows its
  standing AAA warnings, unchanged)
- Not run: `pnpm e2e` and `pnpm e2e:passkey`. No browser test names the
  renamed label (checked by grep); CI runs them.
- The MSW "unhandled request" line in the pago run comes from an existing
  test ("with no reading available…") and shows on `main` too.

## Deviations from Assessment

1. **A submission identical to an already *paid* attempt is refused, not
   answered with it.** The assessment had the paid attempt answer, so
   the payer would see its real state. The suite's scenario 18c pins
   direct-payment D9: a terminal owner on the payer's own link refuses
   with `TRANSFER_ALREADY_USED`. Its reason turned out stronger than the
   assessment allowed for: a panel link is reused every month, so last
   month's receipt shown back as "confirmado" would read as this month
   paid. The refusal now comes before any WispHub read or provider call,
   and it is still recorded as a proof rejection (provisional-release D6).
   The saving the assessment wanted, no paid call to say "already used",
   is kept.
2. **One attempt in review, and the resume on the page, are for panel
   links only.** The assessment said API links would get the same
   behaviour. The first full run failed 21 tests across the
   automated-collections suites. Those pin that one API link keeps
   several transfers side by side, and a later one reads `unapplied`,
   never lost (automated-collections-api D16). On an API link, correcting
   stays the explicit `supersedes` it always was, and `inReview` is not
   sent. The identical check applies to both kinds. It only returns an
   existing attempt or a refusal that already existed.
3. **The race guard lets a paying verdict land.** The assessment proposed
   that `announcingWriter` write nothing on a `superseded` row. But by
   the time a confirmation is written, WispHub may already have been told
   about the payment, so dropping it would hide real money. So the guard
   drops only writes that do not pay (a retry slot, `invalid`,
   `expired`). A confirmation found in flight still lands. The claim
   before the provider call also skips a `superseded` row, which covers
   the common case of a sweep batch read before the correction.
4. **Scope expansion, logged:** `apps/api/src/consta/extraction/proof.ts`
   and its `index.ts` export `sha256Hex`. They were not in the file list.
   Reusing the engine's hash avoids a second recipe for the same
   fingerprint.
5. **Receipt status on a correction**: D18 carried the prior's receipt
   status onto every correction. Now it carries it only when the capture
   is the same (no new `proofId`, or the same one). A correction may now
   come from a payer who sent a *different* receipt, and that receipt's
   status is its own.

6. **A reference never refuses money as already paid.** The assessment
   treated "same reference, date, bank and amount" like a clave. On dev,
   one bank printed the same reference on three different $5 transfers the
   same night. If the rule matched paid attempts by reference, a real
   second transfer would be refused. So a reference match names only an
   attempt still in review. Only the clave or the file can say "already
   paid".

## Follow-ups

- **Feature "Es otra transferencia"** (`/speckit-specify`). Until it
  exists, a payer who really pays in two transfers and sends the second
  while the first is in review replaces the first. Its clave is freed, but
  nothing asks them to send it again.
- **Bug: SPEI date roll-over.** A transfer made after the evening close is
  filed by Banxico under the next operating day. A reference search with
  the payer's calendar date misses it (Abraham's first attempt).
- **Dev data**: row `d2a101ed` on dev expires on its own at the T+12h
  slot. No cleanup is needed.
- Run `/speckit-bug-test slug=one-open-attempt`. Then check the flow on
  dev once merged: reload the page during a not_found attempt, correct
  it, and confirm the first row reads `superseded` in the feed.
