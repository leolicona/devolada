# Bug Fix: a payment can land on an invoice WispHub already moved into a newer one

- **Slug**: transferred-invoice-paid
- **Fixed**: 2026-10-02
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Every registration now asks WispHub about the invoice it was going to pay,
right before any money moves, in the one adapter door all six paths share
(`attemptReconnection`, cash-at-stores D9). An invoice whose debt is gone —
"Se Transfirio", cancelled, deleted, or any state Devolada never sets — is
never paid. The payment follows the debt to the customer's oldest open
invoice, read fresh from the balance door. That invoice is written on the
payment row before anything is registered on it, so a payment still lands
at most once (reconnection D8).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/wisphub/client.ts` | modified | `invoiceState()` answers `pending \| paid \| gone \| unknown` over the labels measured 2026-10-01, as an allow-list: only *pending*, *paid* (D8's 422 then speaks) and *unknown* (old behaviour) keep the stored invoice. A 404 is `gone` (was `closed`). |
| `apps/api/src/wisphub/reconnection.ts` | modified | New `invoiceToPay()`; the guard at the top of every attempt whose money has not landed. A moved debt makes the attempt write nothing and answer `queued` with the new invoice (or `null` → the empty vehicle). The D1 comment is amended: the stored id wins *while the debt is still on it*. |
| `apps/api/src/direct-payments/validation.ts` | modified | `stillPendingInvoiceId` skips only a *paid* invoice; a moved one is returned for the adapter to follow (the snapshot predates the invoice the debt moved to). |
| `apps/api/test/transferred-invoice-paid.test.ts` | added | 9 tests, every path and the guard's edges (below). |
| `apps/api/test/pending-invoice-cap.test.ts` | modified | Fixtures moved to the measured labels; `mockReconnection` mocks the adapter's own look; one new test for the verdict on a snapshot. |
| `apps/api/test/reconnection-queue.test.ts` | modified | `mockInvoiceState`. The D8 422 test now reads "Pagada" first, so it pins *paid keeps D8*. The rejected-key test asks about the invoice first. |
| `apps/api/test/direct-payment.test.ts`, `cep-bundle-match.test.ts`, `payment-classes.test.ts`, `integration-dispatch.test.ts`, `payments-review.test.ts`, `queue-retry-forgets-action.test.ts`, `wisphub-payment-utc-time.test.ts`, `cash-at-stores-capabilities.test.ts` | modified | The invoice read ("Pendiente de Pago") mocked wherever an attempt starts from a stored invoice — inside each file's payment mock. |
| `apps/api/test/payer-helpers.ts` (`mockPanelSettle`), `apps/api/test/store-helpers.ts` (`mockAction`) | modified | Same, in the shared helpers. |

No migration, no contract change, no new dependency, no admin change: a
row waiting on a moved invoice carries `actionError: null`, so the feed
shows it queued with no reason line (`FeedScreen.tsx` prints one only for
an error code).

## Diff Highlights

The guard (`apps/api/src/wisphub/reconnection.ts`):

```ts
if (!paymentRegistered) {
  if (invoiceId !== null) {
    const payable = await invoiceToPay(wisphub, customer.usuario, invoiceId);
    if (payable !== invoiceId) {
      return { status: "queued", invoiceId: payable, paymentRegistered: false, error: null };
    }
  }
  // … the opt-in, the payment method, find/create, registrar-pago, as before
```

```ts
async function invoiceToPay(wisphub: WispHub, usuario: string, invoiceId: number): Promise<number | null> {
  if ((await wisphub.invoiceState(invoiceId)) !== "gone") return invoiceId;
  const record = await wisphub.getCustomer(usuario);
  if (!record) throw new WispHubError("WISPHUB_UNAVAILABLE", "customer gone while its invoice moved");
  const open = (await wisphub.openInvoicesOf(record.wisphubId, record.usuario)).filter((f) => f.invoiceId !== invoiceId);
  return open.length ? Math.min(...open.map((f) => f.invoiceId)) : null;
}
```

The allow-list (`apps/api/src/wisphub/client.ts`):

```ts
if (estado === 1 || estado === "1" || (typeof estado === "string" && /pendiente/i.test(estado))) return "pending";
if (estado === 2 || estado === "2" || (typeof estado === "string" && /pagad/i.test(estado))) return "paid";
if (estado === undefined || estado === null || estado === "") return "unknown";
return "gone";
```

## Tests Added or Updated

`apps/api/test/transferred-invoice-paid.test.ts`
(`bug: transferred-invoice-paid — every path asks before it pays, and follows a moved debt`):

- *'Ejecutar ahora' (integrations-hub D5)* — 42 moved into 43: nothing is
  paid on 42, the row is `queued` on 43 with no error, and the next pass
  pays 43 with the verdict's amount and `accion`.
- *accepting a held payment (receipt-triage D31)* — the same, through
  `POST /payments/:id/review`.
- *a queue retry* — the first attempt meets a 503 on 42, the move happens,
  the retry re-routes to 43, the next pass pays 43.
- *'Reintentar' on a failed row (payments-and-classes D5)* — 42 is never
  paid; the click's one attempt finds 43, and the next click pays it (see
  Deviations).
- *a store's cash record (cash-at-stores D25)* — the move lands between the
  debt read and the deferred attempt. The folio is still answered, and the
  payment lands on 43.
- *at most once (reconnection D8)* — 43 already on the row, its earlier
  answer lost. 43 reads "Pagada", the 422 says landed, and no vehicle is
  made.
- *nothing open after the move* — the balance door is empty, so the next
  attempt makes the empty vehicle (debt-truth D15) and pays it, never 42.
- *an invoice still pending* — paid at once, with one read more.
- *a detail route WispHub does not serve (405)* — the old behaviour: the
  stored invoice is paid.

`apps/api/test/pending-invoice-cap.test.ts`
(`bug: transferred-invoice-paid — the snapshot's invoice moved after the pass`):

- *the verdict does not skip a moved invoice* — the snapshot names 7001,
  and both reads (the verdict's own and the adapter's) see it moved. The
  verdict confirms on the debt it measured, and the row waits on 7101,
  which only the balance door knew.

`apps/api/test/reconnection-queue.test.ts` — *WispHub's 422 on an
already-paid invoice counts as landed (D8)* now reads "Pagada" first:
it pins *paid keeps D8*.

## Local Verification

- Baseline before any change: `pnpm --filter @devolada/api test` →
  66 files, 1203 tests passed.
- After the source change alone: 13 files failed — exactly those whose
  payments start from a stored invoice and did not mock the new read. Each
  file's payment mock gained the read.
- Red check: with the three source files restored to `HEAD`, the new tests
  fail. In the moved-invoice cases the old code goes straight to
  `registrar-pago` on 42. The fixed sources were then restored.
- Final: `pnpm --filter @devolada/api test` → **67 files, 1213 tests
  passed** (1203 + 10 new). `pnpm -r --if-present typecheck` → every
  workspace passes.
- CI lints: `spec-lint` ✔ (113 files), `gen-banks --check` ✔,
  `contrast-lint` ✔ (its AAA warnings were already there),
  `pending-lint` ✔.
- Manual: every WispHub shape in the fixtures — "Pendiente de Pago",
  "Pagada", "Se Transfirio", and a balance door that lists only open
  invoices — was measured live on the demo tenant on 2026-10-01
  (assessment, *Measurements*).

## Deviations from Assessment

1. **The guard runs before the opt-in and the payment-method read, not
   alongside them.** Provider-latency D2 would have them wait together.
   Sequential means an attempt that finds the invoice moved writes nothing
   to the business's system. Cost: one sequential read (~0.5 s healthy)
   per registration that starts from a stored invoice.
2. **"Reintentar" on a failed row whose invoice moved needs two clicks.**
   One click buys one attempt (payments-and-classes D5). The write-first
   shape spends that attempt finding the new invoice, so the row goes back
   to `failed` — with the new invoice and no reason line — and the second
   click pays it. The same happens when a move is found on the queue's
   sixth attempt. The assessment's recommended shape did not name this
   cost. It is rare: the row must have failed before its money landed, and
   then its invoice must have moved. The test pins today's behaviour. If it
   matters, the remedy is the assessment's other shape: a callback in the
   action contract that writes the new invoice and pays it in the same
   attempt.
3. **The "paid keeps D8" test** lives in `reconnection-queue.test.ts` (the
   existing D8 test, now reading "Pagada" first), and **the snapshot verdict
   test** lives in `pending-invoice-cap.test.ts`, which owns the snapshot
   setup. Both cite this bug.
4. **`estado` numbers**: `1` and `2` are kept as the list filter's measured
   codes for pending and paid. `3` was a guess for "closed" and now falls to
   `gone` with every other unknown state. A 404 is `gone` (it was
   `closed`), so the payment follows the debt instead of being skipped.

## Follow-ups

- **M7** (assessment): does a zone's monthly billing run move pending
  invoices the way an API-created invoice does? It decides how often the
  bug fires, not the fix.
- **"Reintentar" needing two clicks** (Deviation 2): the creator's call
  whether to move to the callback shape.
- **The pilot check**: a read-only pass over the pilot's registered
  invoice ids. A moved-then-paid invoice keeps its "Factura Transferida a
  la Factura #N" line text, so the false debts already left can be found.
- `findPendingInvoiceId` (a payment with no invoice yet) still walks the
  whole tenant's list, capped at five pages. The per-customer balance door
  the re-route now uses could replace it (`bug: pending-invoice-cap`'s gap,
  adjacent).
- Payment promises (`provisional.ts`) can still name a moved invoice from a
  snapshot. No money moves, and WispHub's behaviour there is unmeasured.
- Incidental (assessment): the demo tenant runs at UTC−5, an hour from
  America/Mexico_City, against `bug: wisphub-payment-utc-time`'s
  assumption.
- `/speckit-bug-test slug=transferred-invoice-paid` for the independent check.
