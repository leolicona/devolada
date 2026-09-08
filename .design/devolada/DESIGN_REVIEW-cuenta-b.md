# Design Review: the phone without its header (US-A05, PR B)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md` and
`docs/legacy/admin/account-hub.spec.md` D8–D10
Philosophy: Functionalist, warm accent — calm by default, loud only for
money at risk, roles hide never tease
Date: 2026-09-03
Scope: PR B of the shell round — the phone's 48px header (business name +
credit chip) retires; "Saldo bajo" becomes a strip the owner closes;
Recargar only for a role that can top up; the observation chip leaves the
phone. Captured from the built bundle with the API stubbed at the network
edge. PR A's review: `DESIGN_REVIEW-cuenta.md`.

## Screenshots Captured

7 files in `.design/devolada/screenshots/`:

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `review-account-strip-pagos-ok-mobile-360.png` | Mobile 360 | Normal balance: the page title is the first thing; nothing above it |
| `review-account-strip-pagos-low-mobile-360.png` | Mobile 360 | `step: low`: the strip (icon · Saldo bajo: $20.00 · Recargar · ×), the avatar with the glyph |
| `review-account-strip-pagos-low-dismissed-mobile-360.png` | Mobile 360 | After ×: the strip is gone, the avatar still says it |
| `review-account-strip-pagos-low-mobile-375-dark.png` | Mobile 375 dark | The strip on the dark palette |
| `review-account-strip-pagos-paused-viewer-mobile-360.png` | Mobile 360 | A viewer in pause: the banner without Recargar, four sections, the pause glyph |
| `review-account-strip-pagos-low-tablet-768.png` | Tablet | Bottom bar + strip at 768 |
| `review-account-strip-pagos-low-desktop-1280.png` | Desktop | Unchanged: the sidebar's chip says Saldo bajo, no strip |

## Summary

The phone gives back its first 48px on every screen and loses nothing it
needs: the balance moved to the avatar's glyph and to Cuenta, "Saldo bajo"
arrives as a one-line strip that stays until the owner closes it, and the
two money-at-risk states keep their persistent banners. Real-contrast axe
passes on the strip; the keyboard walk and the responsive pass are green.
One copy fix applied in-round.

## Must Fix

None.

## Should Fix

None.

## Fixes applied (same day)

1. **The pause banner told a viewer to "recargar"** — a verb for a hand
   they do not have. With `credit: manage` absent the sentence now says
   what the business must do ("hasta que el negocio recargue"; "el
   negocio debe recargar"), next to the Recargar button that was already
   hidden for them (D10).

## Could Improve

1. **The strip and the "pagos fallidos" strip are both warning-toned** and
   can stack on a bad morning (low balance + failed payments). Two warm
   rows before the list is still calm; if the pilot finds it heavy, the
   credit strip could drop to the neutral surface with the warning icon
   alone. Left as is.

## What Works Well

- **The title is the first thing on a phone** (`…-ok-mobile-360.png`):
  Pagos, the day's total, then the list — the reason the round exists.
- **The strip is honest about closing**: an × the person chooses, no
  timer; and the avatar keeps the glyph after the close
  (`…-low-dismissed-mobile-360.png`), so the signal never fully leaves.
- **Roles hide, never tease**: the viewer's pause banner carries no
  Recargar and reads as information, not a task
  (`…-paused-viewer-mobile-360.png`).
- **Desktop is untouched**: the sidebar's chip and observation chip stay
  where the room is (`…-low-desktop-1280.png`).
