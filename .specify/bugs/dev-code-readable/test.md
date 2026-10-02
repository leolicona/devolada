# Bug Verification: the deployed dev API hands out any account's sign-in código, and any pending invitation's id

- **Slug**: dev-code-readable
- **Tested**: 2026-10-02
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The route-level reproduction ran in workerd against a real D1. Before the
fix, `/dev/last-code` handed out a real address's código, and anyone's
latest código with no address, and `/dev/last-invitation` handed out a real
invitee's invitation id. After the fix, both refuse, and test addresses still
read theirs. No regression in the API suite (1,212 tests), the typecheck or
the lints. The result is **partial** only because two checks did not run:
the full chain the assessment lists (ask for a código, read it, redeem it,
on a running Worker) was deliberately not run, and the passkey journeys
could not run in this container (see Residual Risks).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Regression proof (pre-fix) | the fix set aside (`git stash push apps/api/src/routes/dev.ts`), then `pnpm --filter @devolada/api exec vitest run test/dev-code-readable.test.ts`, then restored | fail (as expected) | 5/5 failed. A real address and the empty query answered 200 with the código; a real invitee's address answered 200 with the id; `ana.invalid` reached `ana.invalid@gmail.com`'s código. The fifth case failed only on the demo address typed in mixed case, which the fix also makes work. |
| Reproduction (post-fix), route level | `pnpm --filter @devolada/api exec vitest run test/dev-code-readable.test.ts test/dev-seed.test.ts` | pass | 11/11: the 5 new cases and the 6 existing for the dev routes |
| Reproduction, full chain on a running Worker | ask for a sign-in código for a real address, read it, redeem it | not-run | not run on purpose: the fix changes only the read step, which the route-level cases cover; the request and redemption are Better Auth's, unchanged |
| Regression suite (API) | `pnpm --filter @devolada/api test` | pass | 68 files, 1,212 tests |
| Passkey journeys | `pnpm e2e:passkey` (reads `.invalid` códigos and an invitation id through the fixed routes) | not-run | `@playwright/test` 1.62.1 expects Chromium build 1234; this container has build 1194, and running it would need a config change this step may not make |
| Code-writing paths | read `apps/api/src/routes/auth.ts:86`, `apps/api/src/routes/store/handler.ts:580` and Better Auth 1.6.29's `plugins/email-otp/utils.mjs` | pass | both write through the plugin's `sendVerificationOTP`, whose identifier is `` `${type}-otp-${email}` ``, lowercased, so the whole-address match finds every código the journeys read |
| Type-check | `pnpm --filter @devolada/api typecheck` | pass | only the API changed |
| Lints | `node scripts/spec-lint.mjs`, `node scripts/pending-lint.mjs` | pass | the new file cites `bug: dev-code-readable` |

## Output Excerpts

```text
# pre-fix
× … refuses a real address, and no digit of its código leaves → expected 200 to be 403
× … refuses a missing or blank address … → /dev/last-code: expected 200 to be 403
× … matches the address whole … → ana.invalid: expected { success: true, …(1) } to deeply equal { success: true, data: { code: null } }
× … refuses a real invitee's address … → expected 200 to be 403
Tests  5 failed (5)

# post-fix
Test Files  2 passed (2)
     Tests  11 passed (11)

# API suite
Test Files  68 passed (68)
     Tests  1212 passed (1212)
```

## Residual Risks

- **The passkey journeys did not run here.** They are the only callers of
  these routes, and they use `@journey.invalid` addresses and the demo
  account, which the rule keeps. Every código they read is written through
  the plugin, whose identifier the match was built from. Main's deploy runs
  them before dev deploys, so a miss would block the deploy, never break dev.
- **The deployed environment was not exercised.** Nothing here proves what
  `api.dev.devoladapago.com` serves until this merges and deploys. The fix is
  closed until then.
- **Earlier exposure is unknown.** Whether anyone read these routes from
  outside is in the dev Worker's request logs (the assessment's open
  question), not in this verification.

## Recommendation

Merge. The symptom is gone wherever it could be measured from here, and
nothing else moved. After the deploy to dev, one manual call to
`/dev/last-code` with no address should answer 403 `TEST_ADDRESS_ONLY`; the
passkey journeys in main's deploy cover the test addresses.
