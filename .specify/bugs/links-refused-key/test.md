# Bug Verification: the Links roster names a refused key and sends it to Integraciones

- **Slug**: links-refused-key
- **Tested**: 2026-09-19
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The code is verified at both layers — the roster answers `WISPHUB_AUTH_FAILED`,
the payer's page still answers `WISPHUB_UNAVAILABLE`, and the screen renders
the door with no retry — with the whole workspace suite, typecheck and the
four CI lints green. As with the Cobros entry, the deployed chain on dev was
not re-exercised post-fix: the fix deploys on merge and the row is still the
pilot's to set, so `/links` on dev shows the door until then.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix), API panel | `apps/api: vitest run test/direct-payments-links.test.ts` | pass | 403 on `/api/clientes/` → 503 `WISPHUB_AUTH_FAILED`; log line printed; key absent |
| Reproduction (post-fix), API payer | `apps/api: vitest run test/direct-payment.test.ts` | pass | 403 on the invoice door → 503 `WISPHUB_UNAVAILABLE`; no "AUTH", no key. First draft tripped the pool's isolated-storage check (dangling cache read); reordered, see fix.md |
| Reproduction (post-fix), screen | `apps/admin: vitest run test/links.test.tsx` | pass | door, sentence order, `/integrations/wisphub`, no alert/Reintentar/"No pudimos cargar"/search box; axe clean; background refusal → door, rows gone. 12/12 |
| Reproduction (post-fix), deployed dev | open `/links` as the pilot on `app.dev.devoladapago.com` | not-run | needs the merge and the pilot's row |
| Regression suite | `pnpm -r --if-present test` | pass | ui 50/50 · api 37 files, 517/517 · admin 22 files, 212/212 · pago 56/56 |
| Type-check | `pnpm -r --if-present typecheck` | pass | all four workspaces |
| spec-lint / gen-banks / contrast-lint / pending-lint | `node scripts/*.mjs` | pass | ✔ 68 files · ✔ 97 banks · ✔ 34 pairs at AA (6 pre-existing AAA notes) · ✔ 28 labels |
| Browser layer | `pnpm e2e`, `pnpm e2e:passkey` | skipped | CI runs them; no e2e stub names a roster failure code |

## Output Excerpts

```
apps/api   Test Files  4 passed (4)   Tests  163 passed (163)
apps/admin ✓ test/links.test.tsx (12 tests) 523ms
pnpm -r test  ui 50 · api 517 · admin 212 · pago 56  (exit 0)
```

## Residual Risks

- The symptom on dev persists — now with the right wording — until the
  pilot's row names wisphub.io.
- The door's recipe is duplicated across Cobros and Links (fix.md,
  follow-ups); a third copy should become an atom.
- `listLinks` (`GET /direct-payments/links`) was switched to the panel
  audience without a test of its own; the admin does not call it today.

## Recommendation

Merge with the Cobros commit on this branch. Then the same one operational
step — the pilot chooses **wisphub.io** in Integraciones — closes both
entries' `partial` verdicts; confirm by opening Cobros and Links de pago.
