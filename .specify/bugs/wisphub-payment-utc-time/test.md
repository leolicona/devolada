# Bug Verification: a payment lands in WispHub hours late, and after 18:00 on the next day

- **Slug**: wisphub-payment-utc-time
- **Tested**: 2026-09-25
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

Devolada's side of the bug is gone. On the unfixed code, every door that
registers a payment sends WispHub the UTC clock: in the test harness at the
assessment's own instant (`2026-10-01 02:30` for a 20:30 Mexico City payment),
and end to end on a real Worker driven by its cron (`15:38` for an ISP whose
clock read 09:38). On the fixed code, each door sends the ISP's wall clock,
and the zone follows the business's setting. No regression in any workspace.
**Not exercised:** what WispHub shows for the new string. The assessment's
reproduction is a round trip on the real demo tenant, which needs the
creator's WispHub key and writes a real invoice and payment there. So this is
`partial`, not `verified`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction PRE-fix, the assessment's instant | throwaway `git worktree` of `028484d` (the branch before the fix) in the scratchpad, with the fix's test file and the helper copied in; `pnpm exec vitest run test/wisphub-payment-utc-time.test.ts` | pass (symptom present) | 4 path tests fail with the symptom: `registrar-pago` got `2026-10-01 02:30` for a 20:30 Mexico City payment; the "Adeudo anterior" invoice was dated `2026-10-01` for all three dates; the verdict and "Ejecutar ahora" sent the UTC `15:34` against Hermosillo's `08:34`. The 3 helper tests pass there, because the helper was copied in. |
| Reproduction PRE-fix, the door the fix's tests do not cover | a scratch-only test (never committed): accept a held payment (receipt-triage D31) for a Mexico City business, `registrar-pago` body captured | pass (symptom present) | sent `2026-09-25 15:34` while Mexico City read `09:34` |
| Reproduction PRE-fix, end to end on a real Worker | `wrangler dev --test-scheduled` on the pre-fix code (scratch config: local D1 in the scratchpad, no Workers AI binding, `WISPHUB_BASE_URL` → a stub WispHub on 8790 that records every request); `POST /dev/seed`; a queued payment planted in the local D1; `GET /__scheduled`; then the business switched to `America/Hermosillo`, a second payment planted, cron again | pass (symptom present) | both `registrar-pago` bodies carried `2026-09-25 15:38`, the UTC clock at 15:38 UTC, whatever the zone |
| Reproduction POST-fix, the assessment's instant | `pnpm exec vitest run test/wisphub-payment-utc-time.test.ts` | pass | 7/7: Mexico City `2026-09-30 20:30` and Hermosillo `2026-09-30 19:30` in one batch; "Adeudo anterior" dated `2026-09-30`; verdict and "Ejecutar ahora" on Hermosillo's clock |
| POST-fix, accepting a held payment | the same scratch-only test on `e055084` | pass | sent `2026-09-25 09:34` at 15:34 UTC |
| POST-fix, end to end on a real Worker | the same steps on `e055084` | pass | Mexico City: `2026-09-25 09:37` at 15:37 UTC. After the switch to Sonora: `2026-09-25 08:37` at 15:37 UTC. Worker log `reconnection sweep: {"claimed":1,"reconnected":1,"stillQueued":0,"failed":0}` twice; both rows `done` on invoice 55 |
| Scope audit | every call that writes a date to WispHub (`createInvoice`, `registerPayment`, `createPaymentPromise`) | pass | three writes in total. The first two now use the ISP's clock. The third, the promise's `fecha_limite`, stays UTC on purpose, as fix.md's Follow-ups record |
| WispHub-side round trip (assessment steps 1–3) | register a payment on the demo tenant, read `GET /facturas/{id}/` | skipped | needs the creator's WispHub key (none in this container) and writes a real invoice and payment to a third-party system; not run without consent |
| The pilot's tenant zone | one `GET /facturas/{id}/` on a payment Devolada registered there | not-run | needs production access after a deploy; the assessment's second open question |
| Regression suite | `pnpm -r --if-present test` | pass | exit 0. api 46 files / 692 tests; admin 23 / 244; pago 2 / 79; ui 7 / 50; landing 2 / 10 |
| Type-check | `pnpm -r --if-present typecheck` | pass | exit 0 in all five workspaces |
| CI lints | `node scripts/spec-lint.mjs`; `node scripts/gen-banks.mjs --check`; `node scripts/contrast-lint.mjs`; `node scripts/pending-lint.mjs` | pass | all exit 0: 80 test files cited; 97 banks in step; 34 pairs at AA (6 below the AAA target, unchanged); 30 labels inside pending regions |
| Browser and passkey layers | `pnpm e2e`, `pnpm e2e:passkey` | skipped | no frontend file changed and no API schema changed |

## Output Excerpts

Pre-fix, at the assessment's instant (the fix's own tests, red):

```
× one batch, two businesses: 20:30 in Mexico City, 19:30 in Hermosillo — both still Sep 30
  → expected '2026-10-01 02:30' to be '2026-09-30 20:30'
× the 'Adeudo anterior' vehicle is born on the ISP's day, not tomorrow (debt-truth D15)
-   "fecha_emision": "2026-09-30",
-   "fecha_pago": "2026-09-30",
-   "fecha_vencimiento": "2026-09-30",
+   "fecha_emision": "2026-10-01",
+   "fecha_pago": "2026-10-01",
+   "fecha_vencimiento": "2026-10-01",
× the verdict registers the payment on the business's clock
  → expected [ '2026-09-25 08:34', …(1) ] to include '2026-09-25 15:34'
VERIFY accept → fecha_pago sent: "2026-09-25 15:34" | UTC at request: "2026-09-25 15:34" | Mexico City at request: "2026-09-25 09:34"
Tests  5 failed | 3 passed (8)
```

Real Worker, cron-driven. What the stub WispHub received:

```
pre-fix  (Mexico City) 15:38:49Z POST /api/facturas/55/registrar-pago/ {"fecha_pago":"2026-09-25 15:38"}
pre-fix  (Hermosillo)  15:38:58Z POST /api/facturas/55/registrar-pago/ {"fecha_pago":"2026-09-25 15:38"}
post-fix (Mexico City) 15:37:19Z POST /api/facturas/55/registrar-pago/ {"fecha_pago":"2026-09-25 09:37"}
post-fix (Hermosillo)  15:37:28Z POST /api/facturas/55/registrar-pago/ {"fecha_pago":"2026-09-25 08:37"}
[worker log] reconnection sweep: {"claimed":1,"reconnected":1,"stillQueued":0,"failed":0}
```

Post-fix and regression:

```
VERIFY accept → fecha_pago sent: "2026-09-25 09:34" | UTC at request: "2026-09-25 15:34" | Mexico City at request: "2026-09-25 09:34"
Tests  8 passed (8)
apps/api test:    Tests  692 passed (692)
apps/admin test:  Tests  244 passed (244)
apps/pago test:   Tests  79 passed (79)
packages/ui test: Tests  50 passed (50)
apps/landing test: Tests 10 passed (10)
```

## Residual Risks

- **WispHub's reading of the new string was not re-observed.** The fix rests
  on the creator's 2026-09-23 measurement on the demo tenant (a naive
  `fecha_pago` is stored as local time, offset −05:00 there). If WispHub read
  the string any other way, the fix would move the error rather than remove
  it.
- **The tenant's zone must match Devolada's setting.** The pilot's
  installation has not been observed. An ISP whose WispHub runs in a different
  zone from the one saved in Devolada is still off, by the difference.
- **The real-Worker run shows the hour, not the day.** It ran at 15:37 UTC,
  when UTC and Mexico share the same date. The day change (evening → next
  day, month end → next month) is shown only at the fixed instant inside the
  test harness, because a real Worker reads the real clock.
- **Still the registration moment.** A retry, an "Ejecutar ahora" or an
  accepted review dates the payment on the day it happens. That is the
  assessment's open decision, not a defect of this fix.
- **Unchanged on purpose:** the payment promise's `fecha_limite` stays UTC,
  and payments registered before the fix stay shifted in WispHub.

## Recommendation

Hold the bug open until one real read-back, but the code is ready. Devolada
no longer sends UTC through any of the doors that register a payment, the
zone follows each business's setting on a real Worker, and nothing regressed.
What is missing is one look at WispHub itself: a payment registered through
the fixed code, read back with `GET /facturas/{id}/`, should show the ISP's
local time. That is the assessment's own steps 1–3 on the demo tenant with
the creator's key, or a read-only check of the first pilot payment after the
deploy, which also answers the pilot-zone question. If the read-back is right,
close the bug; if not, reopen it with `/speckit-bug-assess` and this evidence.
