# Bug Verification: a customer beyond the first 500 pending invoices is told they owe nothing — or asked the plan's price

- **Slug**: pending-invoice-cap
- **Tested**: 2026-09-19
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The symptom reproduces on the unfixed code (HEAD `99ad884`: the page answers
`no_debt` with no CLABE, the submission freezes 499.00 + fee on the row) and
is gone on the fixed code, both under the assessment's mocked-provider steps
and end to end against the real Worker with the cron fired through wrangler's
scheduled door. The full API suite, typecheck and every CI lint pass. Not
exercised: the live ISP (its key was not used), and the shape of WispHub's
invoice detail route.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction, PRE-fix (assessment steps 3–4) | throwaway `git worktree` of `HEAD` in the scratchpad + a symptom-asserting test file there (not in the repo); `pnpm vitest run test/prefix-repro.test.ts` | pass (symptom present) | 2/2: GET → `no_debt`, no `speiClabe`; POST → 201 with `invoiceCents` 49900 and `amountCents` 51400 on the row. Checkout removed afterwards. |
| Reproduction, POST-fix (assessment steps 1–5, automated equivalent) | `pnpm vitest run test/pending-invoice-cap.test.ts` | pass | 12/12, exit 0 — same mocks (five pages with a sixth behind, customer absent): GET → 503 `WISPHUB_READ_INCOMPLETE`; POST → 503, no row; after the sweep: 350.00 shown, `confirmed`/`exact`, `registrar-pago` on `id_factura` 7001, no `POST /facturas/`. |
| Reproduction, POST-fix, end to end on the real Worker | scratch `wrangler dev` (port 8797, `--test-scheduled`, state in the scratchpad, no AI binding) + a stub WispHub on 8790 serving 7 pages with the customer's 350.00 on the last; `POST /dev/seed`; link row planted in the local D1; then `GET /direct-payments/links/tok…` → `GET /__scheduled` → `GET …/links/tok…` | pass | Before the sweep: **503 `WISPHUB_READ_INCOMPLETE`**, the stub saw exactly five page reads, the sweep row was born (`rest_until` null). Cron: Worker log `pending-invoice sweep: {"tenants":1,"pages":7,"finished":1,"failed":0}`, stub saw offsets 0–600, `served_pages` 7, 7 page rows. After: **200 `status: "debt"`, `invoiceCents` 35000, `totalCents` 36500, `cobros: [{7001, 35000, 2026-09-01}]`**, and the only provider call during that GET was the customer record. Two more ticks: the tenant keeps refreshing, page rows stay at 14 (two passes) — old ones collected a tick late as designed. |
| Cobros on the real Worker | sign-in `POST /auth/sign-in/email` as `demo@devolada.app`, then `GET /payment-requests` | pass | `complete: true`, **700 rows** (700 distinct usuarios through the `- 2` chunking — `main`'s #218 owns that fix since the merge; the local D1 enforces the 100-parameter cap, which is how the fixture found it), the customer's row with its link, `readAt` 18 s old. |
| New / updated tests | `pnpm --filter @devolada/api vitest run test/pending-invoice-cap.test.ts` | pass | 12 passed, exit 0 |
| Regression suite | `pnpm --filter @devolada/api test` | pass | 38 files, 526 tests, exit 0, 50.7 s; no pre-existing test changed. After merging `main` (#217, #218 — the D1-cap guard in `test/setup.ts` now active): 530 tests, exit 0; typecheck clean. |
| Type-check | `pnpm --filter @devolada/api typecheck` | pass | exit 0 |
| CI lints (CI order) | `node scripts/spec-lint.mjs`; `node scripts/gen-banks.mjs --check`; `node scripts/contrast-lint.mjs`; `node scripts/pending-lint.mjs` | pass | all exit 0: 69 test files cited; 97 banks in step; 34 pairs AA both themes; 28 labels inside pending regions |
| Factory audit (installation-isolation) | `grep -rn "new WispHub(" apps/api/src \| grep -v wisphub/factory.ts` | pass | empty — the sweep builds its clients through `wisphubFor` |
| Frontends | typecheck / component / browser layers | skipped | no file under `apps/admin`, `apps/pago` or `packages/ui` changed; the API contract (schemas) is unchanged — the 503 rides an existing envelope and an existing page state |
| Live ISP | open a real customer's link on the 6,509-customer ISP | not-run | needs the ISP's WispHub key and a deploy; nothing deploys from a machine |
| `GET /facturas/<id>/` shape | one read with the ISP's key | not-run | see Residual Risks |

## Output Excerpts

Pre-fix, unfixed code (the symptom, asserted as such):

```
 ✓ test/prefix-repro.test.ts (2 tests) 175ms
   ✓ step 3: the payer's page answers no_debt to a customer beyond the read
   ✓ step 4: the submission asks the plan's price (499.00 + fee), not the debt
```

Post-fix, real Worker, before and after one cron tick:

```
$ curl …/direct-payments/links/tok2345abcdefgh2
{"success":false,"error":{"code":"WISPHUB_READ_INCOMPLETE"}}   HTTP 503
$ curl "…/__scheduled?cron=*+*+*+*+*"
Ran scheduled event
[wrangler log] pending-invoice sweep: {"tenants":1,"pages":7,"finished":1,"failed":0}
$ curl …/direct-payments/links/tok2345abcdefgh2
{"success":true,"data":{"ispName":"ISP Demo","customerName":"Janely","status":"debt",
 "invoiceCents":35000,"carriedBalanceCents":0,"serviceFeeCents":1500,"totalCents":36500,
 …,"cobros":[{"externalId":7001,"amountCents":35000,"invoiceDate":"2026-09-01"}]}}   HTTP 200
[stub wisphub, during that GET] GET /api/clientes/?usuario=greyes%40wifiplus&limit=10
```

Regression suite and lints:

```
 Test Files  38 passed (38)
      Tests  526 passed (526)
✔ spec-lint: 69 test files checked
✔ gen-banks: 97 banks, the constant in step
✔ contrast-lint: 34 pairs in both themes at AA, no hardcoded colors
✔ pending-lint: 28 in-progress labels, every one inside a pending region
```

## Residual Risks

- **The invoice detail route is a guess.** `invoiceState()` reads `estado`
  as `1`/"Pendiente" (pending) or `2`/`3`/"Pagada"/"Cancelada" (closed) and
  treats anything else — including a route WispHub does not serve — as
  "cannot tell, proceed as before". If the guess is wrong the safeguard
  degrades to today's behaviour (the 422-as-goal-state reading), never worse;
  but it only protects if the guess is right. One read with the ISP's key
  settles it.
- **A first pass takes minutes.** After the deploy, and after any change of
  installation, the 6,509-customer ISP's customers beyond page five see *"No
  pudimos consultar tu cuenta"* until the first pass finishes (~7 minutes at
  10 pages a minute for ~66 pages), and Cobros shows its banner. Honest, and
  bounded; it replaces a green "al corriente" that was false.
- **The list is minutes old for a large tenant.** An invoice paid at the
  counter shows on the page until WispHub's own label flips to "Pagadas" (the
  live record outranks the snapshot) or the next pass — the fix's overlay
  covers Devolada's own registrations only.
- **The verification's stub WispHub is my reading of the contract.** Page
  shape, `next` links and the customer serializer follow the adapter's
  comments and the 2026-09-18 curl; the real API may differ in details the
  adapter already tolerates (dates, nulls).
- Not covered by a test: a change of installation resetting the snapshot
  (`tick`'s `baseUrl` branch); read in review only.

## Recommendation

Close the bug — verified end-to-end: the symptom is demonstrated on the
unfixed code and absent on the fixed one, under the assessment's own steps and
on the real Worker with the cron wired, with no regression across 526 tests
and every CI lint. Before the release that carries it, spend the one curl on
`GET /facturas/<id>/` with the ISP's key so the fresh-invoice safeguard is
known to work rather than assumed, and expect the first-pass window on deploy.
The `/links` roster (1,000-customer cap) is the same mechanism and belongs in
its own feature spec, riding this sweep.
