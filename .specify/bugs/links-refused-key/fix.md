# Bug Fix: the Links roster names a refused key and sends it to Integraciones; the payer keeps hearing one word

- **Slug**: links-refused-key
- **Fixed**: 2026-09-19
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`wisphubFailure` gained an audience: the two panel routes (`listLinks`,
`linksRoster`) pass `"panel"` and answer the adapter's own code; the two
payer routes keep the default and keep answering `WISPHUB_UNAVAILABLE`. The
Links screen renders `WISPHUB_AUTH_FAILED` as the same door Cobros does —
early return, warning recipe, installation named before the key, button to
`/integrations/wisphub`, no Reintentar, no search box.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/routes/direct-payments/handler.ts` | modified | `wisphubFailure(c, e, audience = "payer")`; comment states the split and why the default is the payer. `listLinks` and `linksRoster` pass `"panel"`. Payer sites untouched. |
| `apps/admin/src/features/links/LinksScreen.tsx` | modified | Early return on `WISPHUB_AUTH_FAILED` with the Cobros door; the "only 503 left is a stall" comment rewritten. Imports `Link` and `TriangleAlert`. |
| `apps/api/test/direct-payments-links.test.ts` | added test | roster + 403 → 503 `WISPHUB_AUTH_FAILED`; key absent from the body |
| `apps/api/test/direct-payment.test.ts` | added test | payer link + 403 → 503 `WISPHUB_UNAVAILABLE`; no "AUTH" and no key in the body |
| `apps/admin/test/links.test.tsx` | added tests, updated one | new `describe` (2 tests); the stall test also asserts no door |

## Diff Highlights

```ts
function wisphubFailure(c: Ctx, e: unknown, audience: "payer" | "panel" = "payer") {
  if (e instanceof WispHubError) {
    console.error("wisphub failure:", e.code, e.message);
    const code = audience === "panel" ? e.code : "WISPHUB_UNAVAILABLE";
    return c.json({ success: false, error: { code } }, 503);
  }
  throw e;
}
```

```tsx
if (roster.error?.code === "WISPHUB_AUTH_FAILED") {
  return ( /* h1 + Alert warning: "WispHub rechazó la conexión…" + Ir a Integraciones */ );
}
```

## Tests Added or Updated

- `direct-payments-links.test.ts` — *"bug links-refused-key: a refused key answers 503 with WISPHUB_AUTH_FAILED, not the outage code"*.
- `direct-payment.test.ts` — *"bug links-refused-key: a refused key reads as WISPHUB_UNAVAILABLE on the payer's page, never as the ISP's setup gap"*: the guard on the audience default.
- `links.test.tsx` — *"WISPHUB_AUTH_FAILED → the Integraciones door, the installation named first, no Reintentar, no search box"* (with axe); *"a background read that starts being refused replaces the rows with the door, not the 'sin conexión' note"*; the existing stall test now also asserts no door.

## Local Verification

- `apps/api: vitest run direct-payment direct-payments-links collections-api-links payment-requests` → 4 files, **163 passed**.
- `apps/admin: vitest run links cobros presence-freshness a11y` → 4 files, **39 passed**.
- `pnpm -r --if-present typecheck` → clean. `pnpm -r --if-present test` → ui 50 · api 517 · admin 212 · pago 56, all passing.
- `spec-lint` ✔ 68 · `gen-banks --check` ✔ · `contrast-lint` ✔ (6 pre-existing AAA notes) · `pending-lint` ✔.

## Deviations from Assessment

- **Early return instead of an inline branch.** The assessment said "in
  place of `ListError`, and above the rows if any". The first draft did
  that with four `!refused` guards across the render tree; it was replaced
  by one early return after the hooks — the Cobros shape — which also drops
  the search box (nothing to search until the read is allowed again) and
  the "Consultado hace" label (a stale read's time is noise next to a
  refusal).
- **The payer-guard test puts the 403 on the invoice door, not the customer
  lookup.** First draft refused both; the page answers on the first
  rejection (provider-latency D2, `Promise.all`), leaving the invoice read
  mid-flight in the display cache when the test ended, and the workers
  pool's isolated storage refused the dangling sqlite handle. Not a
  production defect — the runtime lets the promise settle — but a wrong
  test boundary. The refused customer lookup has no storage on its chain,
  so ordering the refusal the other way pins the same behaviour cleanly.
  Recorded in the test's comment.
- `expectNoViolations` takes the container; the first call omitted it.

## Follow-ups

- Same data step as `cobros-installation-fallback`: the pilot picks
  **wisphub.io** on `/integrations/wisphub`. One save fixes both screens.
- The refused-key sentence and recipe now live twice (Cobros, Links). Two
  copies is the threshold the UI law names for an atom
  (`packages/ui`, "a duplicate recipe in an app is drift"). Worth a
  `SetupNotice` atom if a third screen needs it; not done here to keep the
  fix to its two files.
