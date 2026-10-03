# Bug Verification: an invitee who already has a business lands in their own business and never joins — and the invitation email is the only way back

- **Slug**: invitee-lands-own-business
- **Tested**: 2026-10-01
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The production sequence — an invitee who owns a business opens the
invitation, uses "Olvidé mi contraseña", and lands in their own business —
was reproduced in Chromium against a real local API before the fix and no
longer reproduces after it: the recovery comes back to the invitation and
the person joins. The second dead end (signing in without the link) now
names the invitation in the shell, the chooser and the wizard. No
regression in the API or panel suites, the lints, the typecheck or the
build. The email's delivery was measured, not changed.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | Chromium, local API + admin build: link → "Olvidé mi contraseña" → reset | fail (as reported) | landed in the invitee's own business as Dueño; the inviting business kept its owner alone |
| Reproduction (pre-fix) | Chromium: invitee signs in at `/login` without the link | fail (as reported) | own business, nothing names the invitation |
| Reproduction (post-fix) | same two paths, rebuilt admin | pass | recovery returns and joins as Operador; the shell's notice joins as Administrador |
| Post-fix, more doors | Chromium: two businesses (chooser); no account, signs up without the link (wizard) | pass | joins as Lector both times |
| Regression proof | component case with the fix removed | fail (as expected) | `expected {} to deeply equal { next: '/invitaciones/inv-1', … }` |
| New tests (API) | `pnpm --filter @devolada/api exec vitest run test/invitee-lands-own-business.test.ts` | pass | 4/4 |
| New tests (panel) | `pnpm --filter @devolada/admin exec vitest run test/invitee-lands-own-business.test.tsx` | pass | 7/7, axe clean on the three screens with the notice |
| API suite | `pnpm --filter @devolada/api exec vitest run` | pass | 67 files, 1197 tests |
| Panel suite | `pnpm --filter @devolada/admin exec vitest run` | pass | 29 files, 368 tests |
| Browser layer | `playwright test` (repo config, local Chromium), 4 workers | 231/233 | `feedback.spec.ts:29` and `landing.spec.ts:90` pass 3/3 alone; the first fails the same 6/6 on `main` under the same load |
| Type-check | `pnpm -r --if-present typecheck` | pass | every workspace |
| Build | `pnpm -r --if-present build` | pass | five surfaces |
| Lints | `spec-lint`, `gen-banks --check`, `contrast-lint`, `pending-lint` | pass | 113 test files cited |
| Email delivery | the 2026-09-22 invitation's received headers | measured | one second from Resend to Gmail; DKIM and SPF pass; no DMARC result |

## Output Excerpts

```
 ✓ test/invitee-lands-own-business.test.ts (4 tests)
 Test Files  67 passed (67)
      Tests  1197 passed (1197)

 ✓ test/invitee-lands-own-business.test.tsx (7 tests)
 Test Files  29 passed (29)
      Tests  368 passed (368)
```

```
S6: invitee opens the link and uses Olvidé mi contraseña
  [S6] recover url: http://localhost:5174/recover?next=%2Finvitaciones%2F…&email=…
  [S6] url=http://localhost:5174/payments   → Negocio S6 …
  members of S6's business: [ '…:owner', '…:operator' ]
S5: invitee (one business) signs in without the link
  [S5 signed in] … Te invitaron a Negocio S5 … como administrador. Unirme …
  members of S5's business: [ '…:owner', '…:admin' ]
```

## Residual Risks

- **Not exercised on production.** The production evidence was read (rows,
  the reporter's inbox); the fix was exercised on the local stack and the
  layers above. The pilot invitation from 2026-09-22 has expired; the
  inviter must send a new one.
- **The email's delay is outside the code.** Nothing in the fix makes mail
  faster. It makes a slow email cost less: anyone who can sign in with the
  invited address can now join without it. A first-time invitee who waits
  for the link still waits for the email.
- **The panel asks one more question per screen load** (the session's pace,
  60 s), answered from two indexed reads.

## Recommendation

Close the bug — verified end to end on the local stack and at the API and
component layers, the ones that can answer it. Separately, consider a DMARC
record for `devoladapago.com` and a look at Resend's log for the
2026-10-01 sends.
