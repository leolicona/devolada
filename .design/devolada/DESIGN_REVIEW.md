# Design Review: SaaS pivot, phases 2–4

Reviewed against: `.design/devolada/DESIGN_BRIEF.md`
Philosophy: Functionalist (Rams) with a warm accent — evidence-first, calm by default
Date: 2026-09-01
Scope: phase 2 (access, wizard, switcher, Usuarios), phase 3 (Saldo chip/banners,
Saldo y recargas, /operador), phase 4 (Cobros, Pagos with classes/proof/retry,
payer page with its Cobros). All screens captured from the built bundles with the
API stubbed at the network edge (same discipline as the e2e layer).

## Screenshots Captured

31 files in `.design/devolada/screenshots/` (`review-*.png`), light + dark:

| Area | Files |
| --- | --- |
| Pagos | `review-pagos-{desktop-1280,tablet-768,mobile-375,dark-desktop-1280}.png`, `review-pagos-row-expanded-desktop-1280.png`, `review-pagos-proof-dialog-desktop-1280.png` |
| Cobros | `review-cobros-{desktop-1280,tablet-768,mobile-375,dark-desktop-1280}.png`, `review-cobros-expanded-desktop-1280.png` |
| Configuración | `review-settings-{desktop-1280,tablet-768,mobile-375,dark-desktop-1280}.png` |
| Operador | `review-operador-reglas-{desktop-1280,mobile-375}.png`, `review-operador-negocios-desktop-1280.png` |
| Saldo en pausa | `review-credit-paused-{desktop-1280,mobile-375}.png` |
| Links | `review-links-{desktop-1280,tablet-768,mobile-375}.png` |
| Acceso + wizard | `review-login-{desktop-1280,mobile-375,dark-desktop-1280}.png`, `review-wizard-step1-{desktop-1280,mobile-375}.png`, `review-wizard-step2-mobile-375.png` |
| Página de pago | `review-pago-transfer-{mobile-360,dark-mobile-360}.png` |

Regenerate with the throwaway spec kept in the session scratchpad
(`design-review.screenshots.spec.ts`) — deliberately not committed so `pnpm e2e`
stays an assertion suite.

## Summary

The three phases hold the brief unusually well: tokens are law everywhere (dark
mode is a real palette, not an inversion — compare `review-pagos-dark-desktop-1280.png`
with light), every status travels as icon + text, and phase 4's evidence-first
promise is genuinely delivered — the class badge sits beside the action outcome,
the expansion shows the two numbers that produced it, and the CEP is one tap away.
The findings are small: the loudest is **store-era copy surviving on the access
screens**, which greets every new user of the pivoted product with the old
product's pitch.

## Must Fix

1. **Access screens still speak the store era.** `AccessLayout.tsx:17` renders
   the wordmark as **"Devolada Admin"** ("Admin" is an identifier, not es-MX
   copy — the shell's own sidebar says just "Devolada") and `auth/pages.tsx:61`
   subtitles the login with **"Administra tu red de puntos de cobro."** — the
   product that left to `devolada-red`. Every screenshot of login and the wizard
   shows both (`review-login-desktop-1280.png`, `review-wizard-step1-desktop-1280.png`).
   _Fix: wordmark "Devolada"; subtitle in the pivot's voice, e.g. "Cobra por
   transferencia con validación automática." Lite path: copy fix + test._

## Should Fix

> **Applied 2026-09-01** (same PR as the must-fix): 1 — the dialog formats
> es-MX ("14 de agosto de 2026"); 2 — the native control stays (the browser
> owns its language; the dd/mm check on a Mexican device rides the spec's
> pilot DoD); 3 — chips are one scrollable line below `sm` and Desde/Hasta
> fold behind a "Fechas" toggle that stays open while a date is set; 4 —
> the override shows the effective fee with the word "negociada".

1. **The proof dialog shows a raw ISO date.** `FeedScreen.tsx` (ProofDialog)
   prints `2026-08-14` while every other date on the screen is es-MX formatted
   ("Vence 25 sep", "02:30 p.m."). See `review-pagos-proof-dialog-desktop-1280.png`.
   _Fix: format with the business's timezone/locale helpers like the row does._
2. **Native date inputs render in the browser's locale.** The Desde/Hasta
   fields show `mm/dd/yyyy` in the capture (`review-pagos-desktop-1280.png`)
   because the test browser runs en-US; `lang="es-MX"` is set, so a Mexican
   browser should show `dd/mm/aaaa`. _Verify once on a real es-MX device (the
   cobros-live DoD already schedules a dev observation pass); if Chromium
   ignores the page lang, consider a small helper or accept the platform
   control as-is._
3. **Filter-bar hierarchy on mobile.** At 375px the Pagos header stacks: alert,
   search, two date fields, then six chips wrapping to three lines — the first
   payment row starts ~550px down (`review-pagos-mobile-375.png`). The list is
   the screen's reason to exist. _Fix idea: make the chips a horizontal scroll
   row (one line) and collapse Desde/Hasta behind a "Fechas" disclosure on
   small screens._
4. **`/operador` Negocios: the fee override is a bare asterisk.** The row prints
   `$5.00 *` with nothing naming the asterisk (`review-operador-negocios-desktop-1280.png`).
   The operator wrote the override, but three months later the mark is a riddle.
   _Fix: title/aria "Tarifa negociada" or print "negociada" in text — icon+text
   is the house rule for every other status._

## Could Improve

1. **Configuración is nine stacked cards** (`review-settings-desktop-1280.png`
   is ~3,300px tall). Fine at pilot scale; phase 5 already plans to move the
   WispHub key to Integraciones, which shortens it. If it grows further, an
   in-page section index (the `#saldo` anchor already exists) beats tabs.
2. **`unapplied` rows show the usuario** (`jperez@wifiplus`) where every other
   row shows a name (`review-pagos-desktop-1280.png`, last row) — honest (the
   name is never denormalized on that path) but slightly raw; the customer name
   from the link's last read could ride along when cheap.
3. **Chips vs. badges vocabulary drift**: the filter chip says "Pago parcial"
   (class `short`) and the status badge for lifecycle `partial` says
   "Pago incompleto". Both are spec'd words, but they sit 40px apart on the same
   screen. Worth one glossary line deciding whether an ISP ever needs to tell
   them apart.

## What Works Well

- **Evidence-first, delivered.** The expanded row (`review-pagos-row-expanded-desktop-1280.png`)
  is the brief's principle #2 made literal: ask breakdown, Recibido, the surplus
  sentence in the effective treatment's voice ("queda a favor del cliente"), the
  action outcome with its reason in a sentence, and the retry as the one primary
  button — blame lands on the right desk (WispHub's), the payment stays confirmed.
- **The class/outcome pair reads at a glance.** Two badges per row, different
  axes, never color alone; "Pago sin adeudo" + "Sobrante" on an unapplied row is
  exactly the D2 carve-out drawn on screen.
- **Dark mode is a designed palette.** Teal recalibrated, translucent status
  washes, borders that survive — `review-cobros-dark-desktop-1280.png` and the
  payer page's dark variant look intentional, not inverted.
- **Calm by default holds under stress.** The paused state
  (`review-credit-paused-desktop-1280.png`) escalates exactly as the brief asks:
  chip → red banner with the one way out (Recargar), and the feed keeps working
  beneath it.
- **The wizard is one decision per screen** with the bank pre-picked from the
  CLABE prefix (`review-wizard-step2-mobile-375.png`) — BUG-007's lesson made
  into UI.
- **The payer page's Cobros list** (`review-pago-transfer-mobile-360.png`) adds
  US-R04 without disturbing the two-step flow: the facturas explain the total,
  the CLABE and exact amount stay the stars.
