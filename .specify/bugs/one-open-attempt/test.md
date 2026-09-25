# Bug Verification: a payer who comes back cannot correct the attempt still in review, so it keeps retrying beside the new one

- **Slug**: one-open-attempt
- **Tested**: 2026-09-25
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The assessment's reproduction was run as its automated equivalent, against
a real local D1 in workerd (API) and a rendered page (pago). Each step
was run twice: once on the code **before** the fix (`836d013~1`, with the
new tests copied in) and once on the fix (`836d013`).

- **Before the fix**, 7 of the 10 new API tests and the payer-returns page
  test fail, each for the bug's own reason. The old attempt stays
  `validating`. The link names nothing in review. An identical submission
  reads WispHub and calls the provider. A replaced attempt still reaches
  apiCEP.
- **After the fix**, all of them pass, and so does every suite in the
  repo. No regression was found.

Not exercised: the flow on the deployed dev environment (see Residual
Risks).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction, steps 1–3: a not_found attempt, then a new submission with no `supersedes` | `vitest run test/direct-payment.test.ts -t "one-open-attempt"`: "a new submission without `supersedes` corrects…" | **fail before, pass after** | before: `expected 'validating' to be 'superseded'`. After: the first row is `superseded`, `supersedesId` points at it, and the sweep 13 h later claims 0 rows with no provider interceptor |
| Reproduction, step 2: the page after a reload | `vitest run test/pago.test.tsx -t "one-open-attempt"`: "a payer who comes back resumes…" | **fail before, pass after** | before: times out, because the page never shows the attempt. After: it opens on the attempt (axe passes), and the correction sends `supersedes: "dp-1"` |
| Reproduction, step 4: the same file again | "the same file as a payment already confirmed…" and "the same file uploaded again…" | **fail before, pass after** | before: the old code goes on to read WispHub (`MockNotMatchedError … /api/clientes/`), which is the spend the bug describes. After: 409 / 200 with no row, no WispHub read, no provider call |
| The link names the attempt in review | "the link tells the page which attempt is in review…" | **fail before, pass after** | before: `expected undefined to deeply equal {…}` |
| Identical typed data; another date is a correction | the two reference tests | **fail before, pass after** | before: a WispHub read, and `validating` instead of `superseded` |
| Race: a replaced attempt is never sent | "an attempt replaced after it was read…" | **fail before, pass after** | before: the old code calls apiCEP (`MockNotMatchedError … /validate-transfer`) |
| Guards that must not move | "the same reference as a payment already paid…", "a refused correction gives…", "an API link keeps…" | **pass before and after** | expected: they pin behaviour the fix must keep (a reference never refuses paid money, `restorePrior`, automated-collections-api D16) |
| Regression suite | `pnpm -r --if-present test` | pass | ui 50, api 695, landing 10, pago 81, admin 244 |
| Type-check | `pnpm -r --if-present typecheck` | pass | 0 errors in every workspace |
| Repo lints | `spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint` | pass | contrast shows its standing AAA warnings, unchanged |
| Build | `pnpm -r --if-present build` | pass | ui, landing, pago, admin |
| Browser layer | `pnpm e2e`, `pnpm e2e:passkey` | skipped | long-running; CI runs them on the PR. No browser test names the renamed label (grep) |
| On dev, end to end | reload during a not_found attempt, correct it, read the feed | not-run | the fix is not deployed; dev gets it on merge |

How the "before" run was made: a temporary `git worktree` at `836d013~1`
with the fix's two test files copied in, and the workspace `node_modules`
linked. In that copy only, the test's import of the newly exported
`sha256Hex` was replaced by the same recipe inline. The worktree was
removed afterwards. No source file in the repo was touched.

## Output Excerpts

Before the fix (`836d013~1`):

```
FAIL  bug: one-open-attempt > the link tells the page which attempt is in review, and only while one is
AssertionError: expected undefined to deeply equal { directPaymentId: "a2ec4f9e-…", status: "validating" }
FAIL  bug: one-open-attempt > a new submission without `supersedes` corrects the attempt in review, which stops polling
AssertionError: expected 'validating' to be 'superseded'
FAIL  the same file uploaded again :: wisphub failure: … Mock dispatch not matched for path '/api/clientes/?limit=10&usuario…
FAIL  an attempt replaced after it was read :: provider failure [PROVIDER_UNAVAILABLE]: … not matched for path '/validate-t…
× bug: one-open-attempt > a payer who comes back resumes the attempt in review and corrects it 5004ms
```

After the fix (`836d013`):

```
apps/api test:       Tests  695 passed (695)
apps/pago test:      Tests  81 passed (81)
apps/admin test:     Tests  244 passed (244)
```

## Residual Risks

- **Not seen on a real environment yet.** Abraham's exact sequence (a real
  reload on a phone, a real Banxico `not_found`, then a receipt) has not
  been run on dev. The automated equivalent covers the same route, rows and
  sweep, but not the real provider or a real browser session.
- **Paying in two transfers.** Until "Es otra transferencia" ships, a
  payer's second real transfer sent while the first is in review replaces
  the first. Its clave is freed, but nothing asks them to send it again.
  The product creator accepted this, and it is tracked in fix.md.
- **A late confirmation after a correction.** A paying verdict that was
  already in flight when the payer corrected still lands on the replaced
  row (fix.md, deviation 3). This is deliberate, because the money is
  real. But it is not covered by a test: the in-flight window cannot be
  interleaved in this harness.
- **The existing row on dev** (`d2a101ed`) was born before the fix. It
  expires on its own at its T+12h slot.

## Recommendation

Close the bug — verified by the automated reproduction, before and after.
Confirm once on dev after merge: open Abraham's link (or a seeded one)
during a not_found attempt, reload, use "Corregir el comprobante en
revisión", and check that the feed shows the first attempt as replaced
(*Vencido* badge) and that it stops retrying.
