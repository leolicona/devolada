# Design Review: Devolada MVP (store PWA + admin dashboard)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md`
Philosophy: Functionalist (Dieter Rams) with a warm accent — "less but better"
Date: 2026-08-14
Commit reviewed: `05daf5d` (main, after PR #25)

> **Resolution:** all fifteen findings are fixed, plus the harness gap. The
> decisions that change shared rules are recorded in
> [`docs/polish/design-review.spec.md`](../../docs/polish/design-review.spec.md)
> (US-P05); each fix has a test that failed first. The screenshots below were
> regenerated against the fixed build, so they show the outcome, not the defect
> — the defects are described in the findings.

## Screenshots Captured

42 captures, all in `.design/devolada/screenshots/`. Every screen at its primary
breakpoint in light **and** dark; the four core screens per app at all three widths.

| Screen | Files | Widths |
| ------ | ----- | ------ |
| Cobrar (search, with results) | `review-tienda-buscar-{375,768,1280}.png`, `-375-dark` | 375 / 768 / 1280 |
| Cobrar (empty) | `review-tienda-buscar-vacio-375.png`, `-375-dark` | 375 |
| Confirmar cobro | `review-tienda-confirmar-{375,768,1280}.png`, `-375-dark` | 375 / 768 / 1280 |
| Resultado del cobro (en cola) | `review-tienda-resultado-{375,768,1280}.png`, `-375-dark` | 375 / 768 / 1280 |
| Caja | `review-tienda-caja-{375,768,1280}.png`, `-375-dark` | 375 / 768 / 1280 |
| Registrar entrega | `review-tienda-entrega-375.png`, `-375-dark` | 375 |
| Movimientos | `review-tienda-movimientos-375.png`, `-375-dark` | 375 |
| Login tienda | `review-tienda-login-375.png`, `-375-dark` | 375 |
| Cobros (feed) | `review-admin-cobros-{1280,768,375}.png`, `-1280-dark` | 1280 / 768 / 375 |
| Entregas | `review-admin-entregas-{1280,768,375}.png`, `-1280-dark` | 1280 / 768 / 375 |
| Tiendas | `review-admin-tiendas-{1280,768,375}.png`, `-1280-dark` | 1280 / 768 / 375 |
| Configuración | `review-admin-ajustes-{1280,768,375}.png`, `-1280-dark` | 1280 / 768 / 375 |
| Login admin | `review-admin-login-1280.png`, `-1280-dark` | 1280 |

Regenerate with `pnpm exec playwright test --config playwright.review.config.ts`.

## Summary

The charge path is the best thing here and it delivers on the brief: protagonist
amount, one decisive button, a result screen that says exactly what happened to the
money, redundant colour + icon + text on every status. Dark mode is a real second
palette, not an inversion. Settings earns its keep by deriving the platform share
and previewing the time format instead of describing them.

The biggest finding is that **the responsive fix from PR #25 was applied to one list
and three more have the same defect**. At 375px the Tiendas row shows a warning
chip, a badge and an amount but not the store's name; the Entregas history row is
reduced to `A..` and `1...`; and the customer's name is cut on the confirm screen —
the one screen whose entire job is confirming who is paying. The e2e suite passes
because it asserts *no sideways scroll* and *44px targets*, and a row that renders
nothing legible does neither.

The second theme is **one colour carrying two meanings**. The brief is explicit —
green = charged/reconnected — but green is also doing "money in" on two screens, and
`StatusBadge` reuses the customer's internet vocabulary for the store account, so a
corner store is labelled "Servicio activo" with a Wi-Fi icon.

## Must Fix

1. **The Tiendas row hides the store's name at phone width.** `apps/admin/src/features/stores/StoresScreen.tsx:69-77` — `min-w-0 flex-1` + `truncate` competing with the cap chip, the badge and a `w-24` amount collapses the identity column to zero. The screen shows "Cerca del límite / Servicio activo / $891.00" and nothing that says *which store*. See `screenshots/review-admin-tiendas-375.png` (compare `-768.png`, which is fine). _Fix: the same grid treatment the feed row got in PR #25 — `grid grid-cols-[1fr_auto] sm:flex`, badge and chip on their own line below `sm`._

2. **The Entregas history row is reduced to two characters.** `apps/admin/src/features/cash-drops/CashDropsScreen.tsx:168-182` — identical pattern, worse outcome: the store reads `A..` and the date `1...`. See `screenshots/review-admin-entregas-375.png`. _Fix: same as above._

3. **The customer's name truncates on the confirm screen.** `apps/tienda/src/features/charge/ConfirmScreen.tsx:106` renders `truncate`, so "Janely Guadalupe Reyes" becomes "Janely Guadal…" at 375px. This is the screen the brief describes as "verbally confirm identity and amount", and principle 1 is *never leave doubt*. See `screenshots/review-tienda-confirmar-375.png` (the full name is visible at 1280, which is where nobody uses it). _Fix: allow two lines (`line-clamp-2`) and move the status badge under the name below `sm`. Same at `SearchScreen.tsx:23` and `LedgerScreen.tsx:116`._

4. **`StatusBadge` labels a corner store with the customer's internet status.** `packages/ui/src/components/status-badge.tsx:29-30,54-55` — one pair (`active`/`suspended`) serves both "the customer's internet service" and "the store's account", so Tiendas shows "Servicio activo" with a Wi-Fi icon, and a suspended *store* would tell the ISP that the shop's internet is down. See `screenshots/review-admin-tiendas-768.png`. This also breaks the glossary rule in `CLAUDE.md` (one word per concept). _Fix: add `storeActive`/`storeSuspended` with "Tienda activa" / "Tienda suspendida" and a `Store` icon; keep `active`/`suspended` for the subscriber. Needs a line in the store-list spec since `StatusBadge` is the single source of truth for statuses._

## Should Fix

5. **Green means two different things.** The brief assigns green to charged/reconnected, but `text-success` is also the amount colour for a ledger charge (`LedgerScreen.tsx:16`) and for the commission KPI (`CashboxScreen.tsx:95`). See `screenshots/review-tienda-movimientos-375.png` and `-caja-375.png`. The `+` / `−` sign already carries direction, so the colour is redundant on top of it. _Fix: either drop green from amounts and keep it for status only, or declare the second meaning with its own token alias (`--color-money-in`) so the palette records the decision instead of implying it._

6. **"Comisión" means opposite things on two adjacent screens.** Caja shows "Tu comisión ganada **$18.00**" in green; Movimientos shows "Comisión **−$9.00**" in grey. Both are correct (the commission is earned by the store and deducted from the ISP cash it holds) but the shopkeeper sees the same word with opposite signs one tap apart, and principle 3 says a number must be explainable by tapping it. See `screenshots/review-tienda-caja-375.png` + `review-tienda-movimientos-375.png`. _Fix: label the ledger entry "Comisión ganada" and add the one-line explanation — "se descuenta del efectivo del ISP" — under it._

7. **The search field's clear button is the browser's, not ours.** `apps/tienda/src/features/charge/SearchScreen.tsx:51` uses `type="search"`, so Chromium draws `::-webkit-search-cancel-button` in its own accent — it renders **blue** in both themes, the only non-palette colour in the product, on the store's most-used control, at roughly 13px. Our `target-size` assertion cannot see it because it lives in UA shadow DOM. See `screenshots/review-tienda-buscar-375.png` and `-375-dark.png`. _Fix: `[&::-webkit-search-cancel-button]:hidden` and render our own 48px clear button with `aria-label="Limpiar búsqueda"`._

8. **Disabled primary buttons read as low-contrast enabled ones.** Settings' "Guardar llave" and "Guardar zona y formato" are the filled accent at reduced opacity; in dark they are nearly indistinguishable from the enabled "Guardar cobro y comisiones" two cards away. See `screenshots/review-admin-ajustes-1280-dark.png`. WCAG exempts disabled controls, so nothing flagged it. _Fix: give the disabled state a different **shape**, not a wash — neutral fill with `text-ink-faint` and no accent._

9. **No maximum content width on four of the five admin screens.** Only `SettingsScreen.tsx:285` sets `max-w-3xl`; Cobros, Tiendas, Entregas and the store detail run edge to edge, so on a 27" monitor a row's name and its amount end up ~2000px apart. The brief's reference is the Stripe dashboard, which caps. _Fix: one `max-w-7xl` on the content wrapper in `Shell.tsx`, keeping Settings' narrower form._

10. **The pending-drop actions stack at every width.** `CashDropsScreen.tsx:92` — the `space-y-2` that fixed the 360px overflow in PR #25 is unconditional, so "Confirmar entrega" and "Marcar en disputa" sit in a column even at 1280. See `screenshots/review-admin-entregas-1280.png`. _Fix: `space-y-2 sm:flex sm:space-y-0 sm:gap-2`._

## Could Improve

11. **The search empty state repeats its own placeholder.** Placeholder: "ID, teléfono o nombre". Helper below: "Escribe el nombre, teléfono o ID del cliente para buscarlo." See `screenshots/review-tienda-buscar-vacio-375.png`. _Suggestion: drop the helper, or replace it with something the placeholder can't say — "Si no lo encuentras, pide su ID al cliente"._

12. **Money inputs show bare numbers.** "Monto a entregar" shows `910.00`; Settings shows `15.00` and `9.00`, while every displayed amount is `$1,234.00`. _Suggestion: a `$` prefix inside the field._

13. **"Nuevo cobro" is the weakest button on the result screen** but it is the most likely next action with a queue at the counter. It sits below the fold-ish gap in outline style while two receipt buttons take the visual weight. See `screenshots/review-tienda-resultado-375.png`. _Suggestion: move it up next to the receipt actions, or make it the primary once the receipt has been sent._

14. **`aria-live="polite"` wraps the entire `<main>`** on the feed and Entregas (`FeedScreen.tsx:158`, `CashDropsScreen.tsx:218`), so switching a filter chip re-announces the heading, the alert banner and the chips along with the rows. _Suggestion: move the live region onto the list container._

15. **The store name truncates in the Caja header** because "Cerrar sesión" keeps its label at 375px ("Abarrotes La Es…", `CashboxScreen.tsx:62`). _Suggestion: icon-only sign-out below `sm`._

## Not changed, on purpose

- **The desktop confirm screen's tall gap.** The brief says the PWA "simply
  centers content at a max width; there is no alternate layout" on desktop — the
  gap is that decision showing, and the screen is used on a phone.
- **`--color-text-tertiary` itself.** PR #25 moved the fifteen informational uses
  off it; the token stays as the placeholder/disabled ink it is documented to be.

## Harness Gap (worth more than any single fix)

The browser layer added in PR #25 asserts two things: nothing scrolls sideways, and
every control clears 44px. Findings 1–3 pass both and are still broken — a row can
render at the right width, with the right tap targets, and say nothing. **Add a
third assertion**: nothing inside `<main>` may be cut off by its own container at
360px — an element that hides its overflow and needs more width than it has is
hiding text. That single check would have caught all three, and it is the kind of
defect no unit test can see.

_Done: `expectNothingClipped` in `tests/e2e/responsive.spec.ts`. It went red on all
seven screens before the fixes._

## What Works Well

- **The charge path is the product.** `$514.00` at display size, one full-width
  accent button that repeats the amount, a breakdown that adds up, three steps. It
  looks like Clip, which is exactly what the brief asked for.
- **The queued result screen keeps its promise.** "Cobro registrado", the amount,
  the amber badge with a clock, and a sentence in plain Spanish that says the
  reconnection will happen on its own. That is principle 1 rendered.
- **Dark mode is designed, not inverted.** Warm charcoal, cards a step lighter with
  real borders, badges switching from soft fills to outlines, semantics recalibrated
  rather than flipped.
- **Settings computes instead of explaining.** "Para la plataforma quedan **$6.00**
  por cobro" and "Así se verá: 02:30 p.m." both answer the question the field
  raises, in the field's own words.
- **The confirm dialog says what cannot be undone**, with the amount, the store and
  the consequence in one sentence.
- **Colour never travels alone** anywhere in the product — every status carries its
  icon and its word.
