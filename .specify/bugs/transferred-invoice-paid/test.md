# Bug Verification: a payment can land on an invoice WispHub already moved into a newer one

- **Slug**: transferred-invoice-paid
- **Tested**: 2026-10-03
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The bug no longer reproduces. I replayed it live on the WispHub demo tenant
through Devolada's fixed adapter code. A customer's pending invoice was
moved into a new one, and the fixed code refused to pay the moved invoice:
it switched to the new one, then paid that one, leaving no false debt. The
automated equivalents of every path pass, and so do the full API suite,
the typecheck of every workspace and the CI lints. No regressions found.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction, live (post-fix) | `node live-replay.mjs` — Devolada's `attemptReconnection` and `WispHub` client, bundled with esbuild from this worktree, run against `https://api.wisphub.net/api` (demo only) | pass | Customer `jcobos@wifiplus`: its own pending invoice #10 played the stored invoice. Creating #11 ($1) moved #10 into it. The attempt on #10 answered `queued` on #11 with nothing paid; the next attempt paid #11 in full ($3.00, `accion: 0`). The customer ended "Pagadas", balance 0.00. |
| Reproduction, automated (post-fix) | `npx vitest run test/transferred-invoice-paid.test.ts test/pending-invoice-cap.test.ts test/reconnection-queue.test.ts` | pass | 28 tests. The assessment's deterministic reproduction ("Ejecutar ahora" on stored 42, moved into 43) is the first one; the other five paths and the guard's edges follow. |
| Red check (from the fix step) | the three source files at `HEAD`, the new tests | fail, as expected | In the moved cases the old code goes straight to `registrar-pago` on the moved invoice (recorded in `fix.md`). |
| Regression suite | `pnpm --filter @devolada/api test` | pass | 67 files, 1213 tests (the 1203 of the baseline, plus 10 new). |
| Type-check | `pnpm -r --if-present typecheck` | pass | api, admin, pago, red, landing. |
| Lint | `node scripts/spec-lint.mjs`, `gen-banks.mjs --check`, `contrast-lint.mjs`, `pending-lint.mjs` | pass | contrast-lint's six AAA warnings were already there. |

## Output Excerpts

Live replay (JSON lines, trimmed):

```text
0 customer      jcobos@wifiplus id 5, telefono "", email "", billing due, carried 0, open [[10, 200]]
1 stored A      #10  "Pendiente de Pago"  total 2
2 B created     #11; #10 -> "Se Transfirio" (" - Factura Transferida a la Factura #11");
                #11 "Pendiente de Pago" total 3, line "FACTURA TRANSFERIDA #10"
2b door         open [[11, 300]]          (the moved #10 is not listed)
3 attempt #10   {"status":"queued","invoiceId":11,"paymentRegistered":false,"error":null}; #10 still "Se Transfirio"
4 attempt #11   {"status":"withheld","invoiceId":11,"paymentRegistered":true,"error":null}, 300 cents
5 final         #10 "Se Transfirio" (forma_pago null, cajero unchanged); #11 "Pagada" total_cobrado 3.0, saldo_nuevo 0;
                customer "Pagadas", saldo "0.00", open []
```

Regression suite:

```text
 Test Files  67 passed (67)
      Tests  1213 passed (1213)
```

## Residual Risks

- The live replay drove the adapter function itself, not the HTTP routes
  with their D1 rows. That function is the one door all six paths pass
  (cash-at-stores D9), and the route wiring is covered by the automated
  tests.
- The demo was reset between the assessment's measurements (2026-10-01)
  and this replay. Invoice numbers restarted at #1 and the sample data has
  a new owner (6077213). The measured facts held on the fresh tenant: the
  same "Se Transfirio" label, the same move, and a balance door that
  leaves the moved invoice out.
- The replay changed the demo: #11 was created and paid ($3.00,
  `accion: 0`); the sample invoice #10 now sits moved inside #11; and the
  flow set `auto_activar_servicio` on `jcobos@wifiplus`, as every
  registration does. The customer is at zero.
- Open items carried from the fix: M7 (does the billing run move pending
  invoices?), "Reintentar" needing two clicks after a move (fix.md
  Deviation 2), and the read-only pilot check for past double counts.
- Incidental, not this bug: the demo stores `fecha_pago` at UTC−5 (a 06:50
  Mexico City wall clock landed as `06:50-05:00`), against
  `bug: wisphub-payment-utc-time`'s assumption. And on this tenant the
  adapter's name match for the cash method (`/efect|cash/i`, first hit)
  picked "CASH - RED.DEVOLADAPAGO" for this non-store payment, which
  matters to the payment-method-per-channel work.

## Recommendation

Close the bug: verified end to end. The live replay on the demo shows the
fixed code refusing the moved invoice and paying the one the debt moved
to, and the automated suite covers every path, with no regressions. The
fix is still uncommitted in this worktree; commit it and open a PR when
ready. The open items above are follow-ups, not blockers.
