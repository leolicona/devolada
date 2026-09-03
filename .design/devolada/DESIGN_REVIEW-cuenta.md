# Design Review: Cuenta — the avatar is the fifth section (PR A)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md` and
`docs/admin/account-hub.spec.md`
Philosophy: Functionalist, warm accent — calm by default, roles hide never
tease
Date: 2026-09-02
Scope: US-A05 PR A — the avatar labelled Cuenta replaces the Configuración
gear at both widths; the hub with sub-pages under `/settings`; Cerrar
sesión unified at the hub's foot. Captured from the built bundle with the
API stubbed at the network edge (same discipline as the fase-5 review).
PR B (the phone's header strip) is not reviewed here.

## Screenshots Captured

9 files in `.design/devolada/screenshots/`:

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `review-account-hub-mobile-360.png` | Mobile 360 | The hub: identity card, Negocio, Tu cuenta, the door |
| `review-account-hub-mobile-375-dark.png` | Mobile 375 dark | ídem |
| `review-account-hub-desktop-1280.png` | Desktop | Rail + the read-only profile on the right |
| `review-account-credit-desktop-1280{,-dark}.png` | Desktop light/dark | Saldo y recargas as a sub-page, the rail's row current |
| `review-account-business-tablet-768.png` | Tablet | Configuración sub-page, two-column cards |
| `review-account-business-mobile-360.png` | Mobile 360 (full page) | Configuración with "Volver a Cuenta" and the in-page index |
| `review-account-pagos-low-mobile-360.png` | Mobile 360 | Pagos with `step: low`: the avatar wears the glyph, the chip says Saldo bajo |
| `review-account-pagos-low-desktop-1280.png` | Desktop | ídem, sidebar |

## Summary

The hub lands the way the interview decided: one door, the person first,
the business's areas as rows the role can use, the way out last. Nothing
is broken at 360/768/1280 in either theme; axe (real contrast and target
size) passes on the hub in light and dark; the keyboard walk still reads
the spine in order. Two small things were fixed during the review.

## Must Fix

None.

## Should Fix

None.

## Fixes applied (same day)

1. **The business and the role floated under the identity card** as two
   bare lines. They now sit inside the card, under a soft rule — one
   object says who, where, as what.
2. **The passkeys row's description truncated at every width** ("Tus
   passkeys, en este dispositivo o sinc…"). It reads "Tus passkeys" now;
   the card itself explains the synced case.

## Could Improve

1. **The initials in the sidebar item are small** (10px in a 24px disc).
   Legible, and the label carries the name; if the pilot squints, size the
   sidebar avatar one step up. Left as is.
2. **"Integracio…" in the bottom bar** is the pre-existing 360px truncation
   (fase-5 review), unchanged by this round.

## What Works Well

- **The step rides the avatar without spending a pixel**: at `low` the
  triangle sits on the disc in both bars and the item's name says "Cuenta,
  saldo bajo" (`review-account-pagos-low-mobile-360.png`). PR B can lean
  on it.
- **Roles hide, never tease**: a viewer's hub has no Negocio group at all;
  an operator opening `/settings/business` by URL lands back on the hub.
- **The old anchors survive**: `/settings#saldo` and `#spei` still land on
  their card, so nothing the wizard, the banners or a bookmark pointed at
  is a dead end.
- **Dark mode holds**: the accent-soft disc, the current row and the well
  inputs keep their hierarchy (`review-account-credit-desktop-1280-dark.png`).
