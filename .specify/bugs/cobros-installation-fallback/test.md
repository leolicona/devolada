# Bug Verification: Cobros names a refused key as a setup problem and sends it to Integraciones

- **Slug**: cobros-installation-fallback
- **Tested**: 2026-09-19
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The code half is verified: the mechanism the assessment traced (a 403 from the
provider → the wire code → the screen) is exercised by tests at both layers,
and the whole workspace regression suite, typecheck and the four CI lints pass.
The deployed chain — the pilot's row on dev with `installation = NULL` — was
not re-exercised post-fix, because the fix is not deployed until merge and
the data half (the pilot choosing wisphub.io) is the creator's action in the
panel; until it is done, dev will show the new door rather than the list,
which is the correct thing for it to show.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix), mechanism | `apps/api: vitest run test/payment-requests.test.ts` | pass | 403 on `/api/facturas/` → 503 `WISPHUB_AUTH_FAILED`; log line `wisphub failure: WISPHUB_AUTH_FAILED status 403` printed; key absent from the body. Scenario 7 (500 → `WISPHUB_UNAVAILABLE`) still holds. |
| Reproduction (post-fix), screen | `apps/admin: vitest run test/cobros.test.tsx` | pass | `WISPHUB_AUTH_FAILED` → warning with "WispHub rechazó la conexión…", link to `/integrations/wisphub`, no alert, no Reintentar, no "No pudimos cargar", no empty claim. Background refusal after rows → door, not the "Sin conexión" note. `NOT_CONFIGURED` → `/integrations/wisphub`. 11/11. |
| Reproduction (post-fix), deployed dev | open `/payment-requests` as the pilot on `app.dev.devoladapago.com` | not-run | Needs the merge to deploy the fix, and the pilot's row set. The assessment's step 1 (row with `installation = NULL`) was measured pre-fix and is unchanged by this tree. |
| Regression suite | `pnpm -r --if-present test` | pass | `packages/ui` 50/50 · `apps/api` 37 files, 515/515 · `apps/admin` 22 files, 210/210 · `apps/pago` 56/56. Exit 0. |
| Type-check | `pnpm -r --if-present typecheck` | pass | all four workspaces clean |
| spec-lint | `node scripts/spec-lint.mjs` | pass | ✔ 68 test files checked — the new tests cite `bug: cobros-installation-fallback` |
| gen-banks | `node scripts/gen-banks.mjs --check` | pass | ✔ 97 banks, the constant in step |
| contrast-lint | `node scripts/contrast-lint.mjs` | pass | ✔ 34 pairs at AA in both themes; the 6 AAA warnings pre-date this change |
| pending-lint | `node scripts/pending-lint.mjs` | pass | ✔ 28 labels inside a pending region |
| Browser layer | `pnpm e2e`, `pnpm e2e:passkey` | skipped | Built previews + Playwright; CI runs them. `tests/e2e/stubs.ts` stubs `/payment-requests` with the happy path only, so no stub changed. |

## Output Excerpts

```
apps/api  test/payment-requests.test.ts
  stderr > bug cobros-installation-fallback: a refused key answers 503 with WISPHUB_AUTH_FAILED …
  wisphub failure: WISPHUB_AUTH_FAILED status 403
  ✓ test/payment-requests.test.ts (8 tests) 575ms

apps/admin  test/cobros.test.tsx
  ✓ test/cobros.test.tsx (11 tests) 440ms

pnpm -r --if-present test
  packages/ui test:  Tests  50 passed (50)
  apps/api test:     Tests  515 passed (515)
  apps/admin test:   Tests  210 passed (210)
  apps/pago test:    Tests  56 passed (56)
```

## Residual Risks

- **The symptom on dev persists until the row is set.** The fix changes what
  the screen *says*, not where the key is sent; Cobros will keep showing the
  door — now the right one — until the pilot chooses wisphub.io at
  `/integrations/wisphub`. That is the assessment's step 3 and the creator's.
- **`api.wisphub.io` is still DNS-confirmed only** (`installations.ts`). The
  pilot's save is the first real request; if it fails for a reason other
  than the key, the connection test's four outcomes will say which.
- **`/links` still collapses the two codes** (`direct-payments/handler.ts`
  `wisphubFailure`), so the roster will show "No pudimos cargar los links"
  with a Reintentar for the same refusal until its own fix lands.
- The new Cobros warning was not measured in a real browser at 360/768/1280;
  it reuses the shell banner's exact class recipe, which `tests/e2e` measures
  on every PR.

## Recommendation

Merge — the code fix is verified at both layers with the full regression
suite green. Then two things, in order: (1) the pilot picks **wisphub.io** on
`/integrations/wisphub` on dev and saves; (2) open Cobros and confirm the list
returns, which retires this entry's `partial` and the "DNS-confirmed only"
note on the `.io` catalogue entry. Open a separate lite-path entry for the
Links roster.
