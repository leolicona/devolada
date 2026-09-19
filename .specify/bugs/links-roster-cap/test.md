# Bug Verification: the Links roster stops at the first 1,000 customers, so the rest have no payment link

- **Slug**: links-roster-cap
- **Tested**: 2026-09-19
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The symptom reproduces on `origin/main` (`a14aada`: eleven pages → 1,000 of
1,100 customers, `complete: false`, 1,000 links) and is gone on the fixed
code — under the assessment's mocked steps and end to end against the real
Worker with migration 0033 applied on top of 0032 and the cron fired through
wrangler's scheduled door. The full API suite (537), typecheck and every CI
lint pass; no pre-existing test changed. Not exercised: the live ISP (its key
was not used).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction, PRE-fix (assessment steps 1–3) | throwaway `git worktree` of `origin/main` in the scratchpad + a symptom-asserting test there (not in the repo); `pnpm vitest run test/prefix-repro.test.ts` | pass (symptom present) | 1/1: roster → `complete: false`, `results` 1,000, 1,000 `payment_links` rows for 1,100 mocked customers. Checkout removed afterwards. |
| Reproduction, POST-fix (automated equivalent) | `pnpm vitest run test/links-roster-cap.test.ts` | pass | 7/7, exit 0 — same mocks: cut-off read wakes the `roster` sweep alone; two ticks read eleven pages; roster `complete: true` with 1,100 rows each with a token; the paged door lists the whole tenant; both kinds coexist; a moved installation resets; a small tenant rests and a cut-off read wakes it. |
| Reproduction, POST-fix, end to end on the real Worker | scratch `wrangler dev` (port 8797, `--test-scheduled`, scratchpad state, no AI binding) + a stub WispHub on 8790 serving 11 customer pages and an empty invoice list; `POST /dev/seed`; sign-in; `GET /direct-payments/links/roster` → `GET /__scheduled` ×2 → roster again → `GET /direct-payments/links` | pass | Migrations: **0032 ✅ then 0033 ✅** on one database. Before the sweep: **`complete: false`, 1,000 panel rows**, the stub saw exactly ten page reads, 1,000 links, a `roster` sweep row with `rest_until` null. Tick 1: Worker log `wisphub list sweep: {"lists":1,"pages":10,"finished":0,"failed":0}`, `live_pages` 10. Tick 2: `{"lists":1,"pages":1,"finished":1,"failed":0}`, `served_pages` 11, **1,100 links created by the sweep before any second roster read**. After: **`complete: true`, 1,100 rows, every one with a `/p/<token>` URL, `readAt` 6 s old, and zero customer-page reads during that roster read**. The paged door: 50 rows + `nextCursor`. Two more ticks: the tenant keeps refreshing (10 + 1 pages), page rows stay at 22 across two passes. |
| New / updated tests | `pnpm --filter @devolada/api vitest run test/links-roster-cap.test.ts` | pass | 7 passed, exit 0 |
| Regression suite | `pnpm --filter @devolada/api test` | pass | 39 files, **537 tests**, exit 0, 53.5 s (530 on `main` + 7); `test/pending-invoice-cap.test.ts` 12/12 under the renames; `test/direct-payments-links.test.ts` 15/15 untouched |
| Type-check | `pnpm --filter @devolada/api typecheck` | pass | exit 0 |
| CI lints (CI order) | `node scripts/spec-lint.mjs`; `node scripts/gen-banks.mjs --check`; `node scripts/contrast-lint.mjs`; `node scripts/pending-lint.mjs` | pass | all exit 0: 70 test files cited; 97 banks in step; 34 pairs AA both themes; 28 labels inside pending regions |
| Factory audit (installation-isolation) | `grep -rn "new WispHub(" apps/api/src \| grep -v wisphub/factory.ts` | pass | empty |
| Frontends | typecheck / component / browser layers | skipped | no file under `apps/admin`, `apps/pago` or `packages/ui` changed; the roster's contract (`complete`, `readAt`, rows) is unchanged — the banner and the freshness line read the same fields |
| Live ISP | open `/links` on the 6,509-customer ISP after a deploy | not-run | needs a deploy; nothing deploys from a machine |

## Output Excerpts

Pre-fix, `origin/main` (the symptom, asserted as such):

```
 ✓ test/prefix-repro.test.ts (1 test) 217ms
   ✓ step 3: the roster stops at 1,000 of 1,100 and says so; 1,000 links exist
```

Post-fix, real Worker, before and after two cron ticks:

```
$ GET /direct-payments/links/roster            (session, before any sweep)
{"complete":false,"panel":1000,"allHaveUrl":true}     stub: 10 page reads; wisphub_sweeps: roster, live_pages 0
$ GET /__scheduled?cron=*+*+*+*+*
[wrangler log] wisphub list sweep: {"lists":1,"pages":10,"finished":0,"failed":0}
$ GET /__scheduled?cron=*+*+*+*+*
[wrangler log] wisphub list sweep: {"lists":1,"pages":1,"finished":1,"failed":0}
payment_links: 1100                              (created by the sweep)
$ GET /direct-payments/links/roster
{"complete":true,"panel":1100,"allHaveUrl":true,"readAtAgeSeconds":6}     stub: 0 page reads
$ GET /direct-payments/links
{"links":50,"nextCursor":"cliente1045@wifiplus"}
```

Regression suite and lints:

```
 Test Files  39 passed (39)
      Tests  537 passed (537)
✔ spec-lint: 70 test files checked
✔ gen-banks: 97 banks, the constant in step
✔ contrast-lint: 34 pairs in both themes at AA, no hardcoded colors
✔ pending-lint: 28 in-progress labels, every one inside a pending region
```

## Residual Risks

- **First pass after the deploy.** Migration 0033 drops the invoice
  snapshot too; for the minutes both passes take, the payer's page answers
  *"no pudimos consultar tu cuenta"* for customers beyond page five of the
  invoices, and Links and Cobros show their banners. Bounded and honest; not
  on the ISP's billing morning.
- **Freshness.** A customer added in WispHub reaches Links after the next
  finished pass (~7–14 minutes at 66 pages); `readAt` says so on the screen.
- **Payload.** The roster still travels whole to the browser — ~1.3 MB at
  6,509 rows — which the screen copes with (paging of 50, local search) and
  which the creator's Links spec moves server-side over the stored
  directory. Unchanged by this fix, and now the thing to measure on the ISP.
- **WispHub call volume.** Two continuous passes on a large tenant, ~20
  calls a minute; rate limits unknown. New information from the creator's
  other session (the public OpenAPI spec): `limit` on the customer list goes
  up to **300**, which would cut the roster pass from 66 pages to 22 — a
  one-line change to `customersPath()` once one read confirms WispHub
  honours it (the 2026-09-18 curl measured 100 only). Left as is: unverified
  numbers do not go into a fix.
- **The stub is my reading of the contract.** Page shape and `next` links
  follow the adapter's comments and the 2026-09-18 curl.

## Recommendation

Close the bug — verified end-to-end: the symptom is demonstrated on
`origin/main` and absent on the fixed code, under the assessment's own steps
and on the real Worker with the migration order and the cron wired, with no
regression across 537 tests and every CI lint. Two follow-ups for the
creator, neither blocking: confirm `limit=300` on `/clientes/` and take the
3× shorter pass; and — from the same OpenAPI finding — WispHub's
`GET /clientes/{id_servicio}/saldo/` answers "what does this customer owe" in
one call, which means the **money path** of `pending-invoice-cap` could drop
its snapshot for a live per-customer read and keep the sweep for Cobros
alone. That is a separate decision on the merged fix, worth its own entry.
