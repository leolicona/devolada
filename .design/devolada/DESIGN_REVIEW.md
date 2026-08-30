# Design Review: Liberación provisional — cierre del ciclo (US-D15)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md`, `docs/direct-payment/provisional-release.spec.md` (US-D15, D9/D10), `docs/FRONTEND.md`
Philosophy: Functionalist (Dieter Rams) with a warm accent — "less but better"
Date: 2026-08-30
Scope: verification pass. The branch under review (`feat/trust-shadow`, the D12
shadow) ships **no pixels** — it is backend data collection — so this review
closes the previous cycle instead: it verifies, in the browser, the three
fixes that landed after the 2026-08-27 captures (the success-Alert carrier
from b527a4e, and the two switch nits from 5d1f219: thumb travel
`translate-x-[22px] → translate-x-5` and the removed redundant `aria-label`),
and photographs the states that cycle never captured — the neutral baseline,
the switch OFF, and the switch's keyboard focus.

> The previous review (US-D15 first pass) lives in git history at
> `.design/devolada/DESIGN_REVIEW.md` before this commit.

## Screenshots Captured

Captured by `tests/design/review-pr104-105.spec.ts` (refreshed, 15 shots) and
the new `tests/design/review-us-d15-close.spec.ts` (3 shots). Primary width
carries light + dark.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-pago-verificando-base-375.png` | 375×812 | **New.** The neutral baseline: no release — plain soft paragraph under the badge |
| `screenshots/review-pago-liberado-pendiente-375[-dark].png` | 375×812 | The fix, verified: the release sentence rides a success Alert (Wifi icon), badge stays "Verificando pago" |
| `screenshots/review-pago-liberado-pendiente-768.png` | 768×900 | Same at tablet, card centered, Alert intact |
| `screenshots/review-pago-liberado-evidencia-375[-dark].png` | 375×812 | Agreed-cross release on the Alert, doors ("Ver los datos enviados" / "Subir otro comprobante") intact below it |
| `screenshots/review-pago-protegido-375[-dark].png` | 375×812 | The protect face on the Alert (ShieldCheck): "Tu servicio sigue activo" — never "ya volvió" |
| `screenshots/review-pago-expira-reintento-375[-dark].png`, `-768.png` | 375/768 | Expiry after release: amber badge + icon, honest copy, "Reintentar ahora" |
| `screenshots/review-pago-expira-reintento-gastado-375[-dark].png` | 375×812 | The retry spent: contact copy, no button |
| `screenshots/review-admin-ajustes-proteccion-1280[-dark].png` | 1280×900 | The switch ON after the geometry fix: thumb travel `translate-x-5`, symmetric 2px insets |
| `screenshots/review-admin-ajustes-proteccion-375.png` | 375×812 | Same at the mobile floor (the mid-page bottom nav is the known full-page `position: fixed` artifact) |
| `screenshots/review-admin-ajustes-proteccion-off-1280.png` | 1280×900 | **New.** The switch OFF — the resting state most ISPs meet first |
| `screenshots/review-admin-ajustes-proteccion-focus-1280.png` | 1280 (clip) | **New.** Keyboard focus: the `focus-visible` ring, proven painted (box-shadow asserted in the spec, not just eyeballed) |

> All screenshots are in `.design/devolada/screenshots/`.

## Summary

All three post-capture fixes verify in pixels. The strongest evidence is the
new baseline capture: side by side with `pago-liberado-pendiente-375`, the
hierarchy problem the previous review named is demonstrably gone — the
neutral wait is soft body text, the release is a green Alert with an icon,
and the badge honestly stays "Verificando pago" in both. The switch fixes
are invisible by design (2px of thumb travel, an accessible name that reads
the same) and both were verified by assertion rather than by eye: the
`getByRole("switch", { name: "Proteger el servicio mientras Banxico
confirma" })` locator resolves — the name now comes from the `htmlFor`
label — and the focus ring paints a real box-shadow on keyboard Tab.

## Must Fix

Nothing. No regression found in any of the 18 captures; both themes remain
intentional palettes; no state communicates by color alone.

## Should Fix

Nothing new. The one Should from the previous cycle (the Alert carrier) is
verified fixed in `review-pago-liberado-pendiente-375[-dark].png`,
`-768.png`, `review-pago-liberado-evidencia-375[-dark].png` and
`review-pago-protegido-375[-dark].png`.

## Could Improve

1. **Doors absent on the `pending` release** (carried over, pre-existing):
   `review-pago-liberado-pendiente-375.png` shows only the Alert — no "Ver
   los datos enviados". _Suggestion: unchanged — revisit only if a payer
   ever needs to inspect data during a `pending` wait._
2. **The switch description is four lines at 375** (carried over):
   `review-admin-ajustes-proteccion-375.png`. _Suggestion: unchanged — only
   if the ISP pilot stumbles; the 90-day sentence must survive any trim._
3. **The expired state's copy stays plain text while the release states
   gained an Alert** (`review-pago-expira-reintento-375.png`): the amber
   badge already carries the state (icon + text), so this is consistent
   with "one carrier per state", but if the Alert pattern spreads further,
   decide explicitly which states ride it and which the badge alone.
   _Suggestion: a one-line rule in FRONTEND.md the next time an Alert is
   added._

## What Works Well

- **The comparison pair is the proof**: `verificando-base` vs
  `liberado-pendiente` at the same width shows exactly one difference — the
  good news got a carrier, the wait did not get louder. That is the Rams
  reading of the fix: hierarchy added, nothing decorated.
- **The color law holds on the new Alert**: icon + text + tint in both
  themes; dark mode is its own palette (deep surface, bright green text),
  not an inversion.
- **The protect face still never lies**, now inside the Alert: ShieldCheck
  + "Tu servicio sigue activo", no "volvió" anywhere.
- **The switch earns its geometry note**: 42px inner track, 20px thumb, 2px
  inset each side — the checked state is now exactly symmetric, and the one
  arbitrary value (`translate-x-[22px]`) is gone from the primitive.
- **Accessibility verified by locator, not by intention**: the accessible
  name and the focus-visible ring are asserted in
  `tests/design/review-us-d15-close.spec.ts`, so a regression in either
  breaks a test instead of waiting for the next review.
