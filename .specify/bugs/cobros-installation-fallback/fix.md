# Bug Fix: Cobros names a refused key as a setup problem and sends it to Integraciones

- **Slug**: cobros-installation-fallback
- **Fixed**: 2026-09-19
- **Assessment**: ./assessment.md
- **Status**: applied (code); the data half — the pilot picking wisphub.io on their row — is the product creator's, in the deployed panel

## Summary

The API now lets the adapter's own code travel (`WISPHUB_AUTH_FAILED` vs
`WISPHUB_UNAVAILABLE`, both still 503) and logs the detail before answering;
the Cobros screen renders a refused key as a setup state with the door to
`/integrations/wisphub` and no Reintentar, and its "not connected" door now
points at Integraciones too instead of the pre-hub Configuración page.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/routes/payment-requests/handler.ts` | modified | `catch`: `console.error("wisphub failure:", e.code, e.message)` then `{ code: e.code }` 503 instead of the fixed `WISPHUB_UNAVAILABLE`. Comment cites the bug and 007 D5/FR-013. |
| `apps/admin/src/features/cobros/CobrosScreen.tsx` | modified | The `NOT_CONFIGURED` early return became a two-state setup branch (`not-connected` / `refused`). `refused` renders the shell's warning recipe (`Alert variant="warning"`, icon + sentence + `<Link><Button>`), sentence names the installation before the key. Both link to `/integrations/wisphub`; button reads "Ir a Integraciones". The stale "Integraciones is phase 5" comment is gone. |
| `apps/api/test/payment-requests.test.ts` | added test | 403 from `/api/facturas/` → 503 `WISPHUB_AUTH_FAILED`; the key is not in the body. |
| `apps/admin/test/cobros.test.tsx` | added tests, updated one | New `describe` for the bug (3 tests); scenario 9 now also asserts the door's `href`. |

## Diff Highlights

`handler.ts`:

```ts
console.error("wisphub failure:", e.code, e.message);
return c.json({ success: false, error: { code: e.code } }, 503);
```

`CobrosScreen.tsx`:

```tsx
const setup =
  query.error?.code === "NOT_CONFIGURED" ? "not-connected"
  : query.error?.code === "WISPHUB_AUTH_FAILED" ? "refused"
  : null;
if (setup) { /* h1 + Card (not-connected) | Alert warning (refused), both → /integrations/wisphub */ }
```

Because the branch sits above the rows, a background refetch that starts
being refused replaces the list with the door rather than showing the "Sin
conexión a WispHub. Mostrando la última lectura." note — that note promises
a refresh that a refused key cannot deliver.

## Tests Added or Updated

- `apps/api/test/payment-requests.test.ts` — *"bug cobros-installation-fallback: a refused key answers 503 with WISPHUB_AUTH_FAILED, not the outage code"*: pins the wire code and that the key never rides the body.
- `apps/admin/test/cobros.test.tsx` — *"scenario 9 … the door is Integraciones"*: `NOT_CONFIGURED` links to `/integrations/wisphub`.
- `apps/admin/test/cobros.test.tsx` — *"WISPHUB_AUTH_FAILED → the Integraciones door, the installation named first, and no Reintentar"*: the warning (polite `role="status"`), the sentence order, the link, and the absence of the alert / Reintentar / "no pudimos cargar" / empty claim.
- `apps/admin/test/cobros.test.tsx` — *"a background read that starts being refused replaces the rows with the door, not the 'sin conexión' note"*: rows load, a return to the tab past `FOCUS_FLOOR_MS` re-reads and is refused → door shown, rows and note gone, two reads counted.
- `apps/admin/test/cobros.test.tsx` — *"WISPHUB_UNAVAILABLE keeps the outage recipe: Reintentar, no door"*: the existing behaviour for weather is unchanged.

## Local Verification

- `pnpm install --frozen-lockfile` (the worktree had no `node_modules`) → done.
- `pnpm --filter @devolada/admin test` (ran the whole admin suite) → 210 tests, 1 failed on the first draft of the new test (`findByRole("status")` found another live region first); re-anchored on the sentence → `vitest run test/cobros.test.tsx` → **11 passed**.
- `apps/api: vitest run test/payment-requests.test.ts` → **8 passed**; the new log line appears in the run: `wisphub failure: WISPHUB_AUTH_FAILED status 403`.
- `pnpm --filter @devolada/api typecheck`, `pnpm --filter @devolada/admin typecheck` → clean.
- `node scripts/spec-lint.mjs` → ✔ 68 files; `node scripts/pending-lint.mjs` → ✔.
- `tests/e2e/stubs.ts` stubs `/payment-requests` with the happy path only — untouched.
- Not run: the full API suite, `pnpm e2e`, `pnpm e2e:passkey` (CI runs them; nothing else on those paths changed).

## Deviations from Assessment

- The refused-key state uses the shell's `Alert variant="warning"` recipe
  (icon + sentence + button, as the CLABE and integration banners do) rather
  than a copy of the `NOT_CONFIGURED` `Card`. The assessment said "a card in
  the shape of the NOT_CONFIGURED one"; the warning variant is the house
  form for "something is wrong and here is the door", and it announces
  politely (`role="status"`) rather than as the assertive alert an outage
  gets — which is the distinction the bug is about.
- The sentence is one, not two: *"WispHub rechazó la conexión. Una llave
  solo sirve en la instalación donde la generaste: revisa primero la
  instalación y luego la llave en Integraciones."* — 007's own wording on
  the WispHub screen, shortened.
- The door shows for every role, as the `NOT_CONFIGURED` card and the shell's
  banners already do; the integration page itself refuses a save from a role
  without `integrations:manage`. No new rule invented here.

## Follow-ups

- **The pilot's row** (the actual event): on dev, open `/integrations/wisphub`
  as the pilot business, choose **wisphub.io**, save. The save re-tests the
  pairing and reports it. Until then Cobros will show the new door, which is
  the correct thing for it to say.
- **`/links` shares the collapse**: `routes/direct-payments/handler.ts`
  `wisphubFailure` still folds `WISPHUB_AUTH_FAILED` into
  `WISPHUB_UNAVAILABLE`, and `LinksScreen.tsx` comments that the only 503
  left is a stalled provider. Same wrong wording for the same cause. That
  handler also serves the payer-facing routes, so it deserves its own
  assessment rather than a widening here.
- **Retire the "DNS-confirmed only" note** on `wisphub_io` in
  `apps/api/src/wisphub/installations.ts` once the pilot's save answers.
- **007 payment record** (`.specify/debt/wisphub-host-is-platform-wide/payment.md`)
  argued nothing regressed because prod had no integrations; dev did. Worth a
  line there when the pilot's row is set, so the `partial` verdict closes on
  the right fact.
