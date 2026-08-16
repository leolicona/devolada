---
status: in-development
stories: [US-P04]
domain: polish
updated: 2026-08-16
pays: [TD-010]
---

# Spec: Accessibility, checked on every screen

`FRONTEND.md` has always said AA contrast, icon + text, keyboard and visible focus, `aria-live` on the feed. The palette half is measured (`polish/dark-and-contrast.spec.md`); this is the markup half. axe runs against the DOM the component tests already render, so a missing label or a broken ARIA reference fails in CI instead of waiting for someone with a screen reader to find it.

## Decisions

- **D1 — axe runs inside the component layer, not in a browser.** The screens are already mounted with Testing Library and MSW; adding axe to that DOM costs one dependency and no new harness. A Playwright layer would also give real focus order and layout, and `TESTING.md` still plans one — this covers what markup alone can answer, today, on every PR.
- **D2 — Contrast and target-size rules are switched off here, on purpose.** happy-dom applies no stylesheet and reports no layout, so any verdict on colour or hit area would be invented. Contrast is measured from the tokens instead; touch targets belong to the responsive pass, where geometry is real.
- **D3 — The suite guards itself.** Each app's first case renders an unnamed button and an unlabelled input and asserts that the checker *fails*. A green a11y suite that cannot go red is worse than none: it certifies nothing while looking like proof.
- **D4 — Tabs must own the panel they claim to control.** The feed's filters advertised `aria-controls` at a `TabsContent` that did not exist, because charge-feed D7 used `Tabs` for filtering and rendered the list outside them. To a screen reader that is a tab pointing at nothing — axe rates it critical. The list now lives inside `TabsContent`; the visual design is unchanged. **This amends charge-feed D7**: the primitive was right, the wiring was not.
- **D5 — Two navigations cannot share one name.** The admin shell keeps both the sidebar and the bottom bar in the DOM and lets CSS choose; both were labelled "Secciones", so a screen reader announced two identical landmarks. The bottom bar is now "Secciones, barra inferior". Hiding one from the accessibility tree was rejected: which one is visible depends on a media query neither axe nor the test DOM can see, so the honest fix is to name them apart.
- **D6 — The keyboard slice lives in the browser layer, with the order written down (added 2026-08-16, pays TD-010).** `tests/e2e/keyboard.spec.ts` tabs through the charge path (input focused on open, and proven *reachable* — Tab out, Shift+Tab back — then clear → result → the three tabs; Enter opens the confirm and one Tab reaches the money) and the admin's Entregas (sidebar → session → the pending card's confirm-then-dispute pair, and nothing else: the BODY sentinel makes the stop count part of the claim). "Visible focus" is measured as a **change** against the element's resting styles — outline, ring or border — so a static shadow can never pass as a focus style, and the suite guards itself like D3: killing the focus styles turns it red on the first stop. One browser fact shapes the walks: blurring does not reset Chromium's sequential-navigation start point, so each walk starts from a stop the flow really visits.

## Contract

`apps/tienda/test/a11y.test.tsx` and `apps/admin/test/a11y.test.tsx` mount every screen and assert zero axe violations. Shared helper: `test/a11y.ts` in each app.

Screens covered — PWA: Caja, Movimientos, Cobrar (confirm), Resultado (with the receipt actions), Registrar entrega. Admin: Cobros (with an expanded failed charge), Tiendas, Entregas (pending card), Configuración (with the missing-key banner).

## Scenarios

1. Every screen in both apps passes axe (US-P04, D1)
2. The checker fails on an unnamed control, in both apps (D3)
3. A filter tab points at a panel that exists (D4)
4. The two admin navigations have distinct accessible names (D5)
5. The charge path tabs in its written order with a visible indicator on every stop; Enter opens the confirm and one Tab reaches the money (US-P04, D6)
6. The admin's Entregas tabs sidebar → session → confirm → dispute, exactly, every stop indicated (US-P04, D6)

## Definition of Done

- [x] Scenarios 1–4 automated (`a11y.test.tsx` in both apps, 11 tests)
- [x] The two violations the first run found are fixed
- [x] Touch-target geometry (≥44px asserted, 48px on the charge path) —
      `polish/responsive.spec.md`, measured in a browser
- [x] Real focus order: scenarios 5–6 automated (`tests/e2e/keyboard.spec.ts`,
      3 tests, D6 — pays TD-010; the twin box in
      `polish/dark-and-contrast.spec.md` closes with it). Verified it can go
      red: killing the focus styles fails the first stop.
