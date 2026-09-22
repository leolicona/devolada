# Bug Verification: the Cobros link lookup under D1's parameter cap

- **Slug**: cobros-links-lookup-params
- **Tested**: 2026-09-19
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The production failure is reproduced in the suite to the number (`101 bound`) and the fix makes it
pass, with the whole API suite green under the newly enforced cap. Verified on the pilot's own data
only up to the point the log allowed: the failing read was captured live on dev at 08:39; the
fixed code has not been deployed, and the dev business was meanwhile switched to the demo tenant,
so the post-fix read on the pilot's 205 invoices is still to be seen.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction, live (pre-fix) | `wrangler tail --env dev` during the creator's reload | fail (as expected) | `GET /payment-requests` → `provider cache miss` → `D1_ERROR: too many SQL variables at offset 467` at 08:39:14 and 08:39:19, with `installation = wisphub_io` confirmed on the row |
| Reproduction, suite (pre-fix) | `vitest run test/payment-requests.test.ts` on the old chunk size | fail (as expected) | `D1_ERROR: too many SQL variables (101 bound, D1 allows 100)` |
| New test (post-fix) | same | pass | 9/9 |
| Regression suite under the cap | `apps/api: vitest run` | pass | 37 files, 518/518 — no other over-limit statement reached by a test |
| Type-check | `pnpm --filter @devolada/api typecheck` | pass | |
| spec-lint / pending-lint | `node scripts/*.mjs` | pass | ✔ 68 · ✔ 28 |
| Post-fix on the pilot's data, deployed dev | reload Cobros with the row on wisphub.io + the pilot's key | not-run | needs the merge, and the row switched back from the demo tenant |

## Output Excerpts

```
(unfixed)  × bug cobros-links-lookup-params: 120 debtors … → D1_ERROR: too many SQL variables (101 bound, D1 allows 100)
(fixed)    ✓ test/payment-requests.test.ts (9 tests)
(suite)    Test Files  37 passed (37)   Tests  518 passed (518)
```

## Residual Risks

- The guard measures what tests reach. A statement whose size grows only in production (a sweep
  over a large tenant's rows, say) is still only as safe as its chunking; the assessment lists the
  sites.
- The dev business carries both installations' links now; the roster and Cobros there are not the
  pilot's until the row is switched back.

## Recommendation

Merge and tag. Then switch the dev business back to **wisphub.io with the pilot's key**, open
Cobros, and confirm the list — that closes this entry and, with it, the original report.

---

**Superseded on the Cobros path by `009-links-on-demand-search` (D16).** The
batch lookup this bug was about — the business id, `source = 'panel'` and a
chunk of usuarios in one bind — is gone: `cobroRow.linkUrl` and `waLink` went
with it, because both buttons now press `POST /direct-payments/links`, which
reads one customer and carries their number. The statement that overran D1's
parameter cap therefore cannot run on this path any more.

What stays: the cap made real for every statement in the suite
(`apps/api/test/setup.ts`), the chunking helper and its other call sites, and
the case in `apps/api/test/payment-requests.test.ts`, narrowed to the part that
is still true — 120 debtors read in one page. The history above is not edited.
