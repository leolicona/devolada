# Design Review: Liberación provisional (US-D15)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md`, `docs/direct-payment/provisional-release.spec.md` (US-D15, D9/D7/D10), `docs/FRONTEND.md`
Philosophy: Functionalist (Dieter Rams) with a warm accent — "less but better"
Date: 2026-08-27
Scope: PRs #104–#105 — the payment page's release states (`apps/pago/src/features/pago/PaymentPage.tsx`), the expired page's manual retry, and the settings switch (`apps/admin/src/features/settings/SettingsScreen.tsx` + the new `Switch` primitive).

> The previous review (US-D07 links, PR #99) lives in git history at
> `.design/devolada/DESIGN_REVIEW.md` before this commit.

## Screenshots Captured

Captured by `tests/design/review-pr104-105.spec.ts` (the e2e stub harness).
Primary width carries light + dark.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-pago-liberado-pendiente-375[-dark].png` | 375×812 | Minute zero: `pending` verdict, service back, one fused sentence |
| `screenshots/review-pago-liberado-pendiente-768.png` | 768×900 | Same at tablet, card centered |
| `screenshots/review-pago-liberado-evidencia-375[-dark].png` | 375×812 | Attempt 5 with agreed cross: evidence + consequence in one sentence, no form, doors intact |
| `screenshots/review-pago-protegido-375[-dark].png` | 375×812 | The protect face: "Tu servicio sigue activo" — never "ya volvió" |
| `screenshots/review-pago-expira-reintento-375[-dark].png` | 375×812 | Expiry after release: honest pause + "Reintentar ahora" |
| `screenshots/review-pago-expira-reintento-768.png` | 768×900 | Same at tablet |
| `screenshots/review-pago-expira-reintento-gastado-375[-dark].png` | 375×812 | The retry spent: diagnosed contact copy, no button |
| `screenshots/review-admin-ajustes-proteccion-1280[-dark].png` | 1280×900 | The one switch, ON, inside the reconnection card it obeys |
| `screenshots/review-admin-ajustes-proteccion-375.png` | 375×812 | Same at the mobile floor |

> All screenshots are in `.design/devolada/screenshots/`. In the 375 admin
> capture the bottom navigation appears mid-page — the known full-page
> screenshot artifact of `position: fixed`, not a layout defect.

## Summary

The feature's surface keeps the page's one law — every state states facts,
never conditionals — and the hardest honesty requirement (a `protect`
customer must never read "tu internet ya volvió") renders correctly in
both faces and both themes. The one real finding is hierarchical, not
factual: the best news this product can give ("tu internet ya volvió")
arrives as plain body text under a neutral "Verificando pago" badge, so
the moment of delight has no visual carrier.

## Must Fix

Nothing. All states render the spec's exact copy, both themes are
intentional palettes (not inversions), and no state communicates by color
alone.

## Should Fix

1. **The release sentence deserves a visual carrier** — **FIXED
   2026-08-27, same review cycle**: the release sentence now rides an
   `Alert variant="success" layout="icon"` — `Wifi` for the reconnect
   face, `ShieldCheck` for protect — while the badge stays "Verificando
   pago": the status is still Banxico's; the good news is the service,
   and icon + text keeps the color law. The screenshots in this folder
   are the post-fix captures; the pre-fix state (soft body copy under
   the hourglass badge, visually identical to "Estamos verificando…")
   lives in git history one commit back.

## Could Improve

1. **Doors absent on the `pending` release**: the `not_found` states keep
   "Ver los datos enviados" / "Subir otro comprobante", but the `pending`
   verdict state (released or not) shows only the sentence — pre-existing
   behavior, not a US-D15 regression. _Suggestion: none for now; if a
   payer ever needs to inspect data during a `pending` wait, revisit._
2. **The switch description is four lines at 375**
   (`review-admin-ajustes-proteccion-375.png`): honest and complete, but
   the densest paragraph on the screen. _Suggestion: only if the ISP
   pilot stumbles — the 90-day sentence is the part that must not be
   shortened._

## What Works Well

- **The protect face never lies** — the exact failure mode the
  `releaseKind` column exists to prevent renders correctly: an active
  customer reads "Tu servicio sigue activo", nothing more.
- **One sentence per state, evidence fused with consequence** — no
  stacked alerts anywhere; the D9 table maps 1:1 to what renders.
- **The retry pair is self-explanatory**: available → the sentence offers
  it and the button answers; spent → the button is gone and the copy
  already says the next step. Button target comfortably over 44px.
- **The switch sits inside the card it obeys** — threshold, floor and
  protection read as one policy, and the ON state uses the primary token
  with the thumb, never color alone (the label carries the meaning).
- **Dark mode is its own palette** in every capture — cards, badge ambers
  and the switch keep contrast without inverting.
