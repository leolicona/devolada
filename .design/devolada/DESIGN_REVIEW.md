# Design Review: Validation status UX (PR #88)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md`, `docs/direct-payment/validation-status-ux.spec.md` (US-D12), `docs/FRONTEND.md`
Philosophy: Functionalist (Dieter Rams) with a warm accent — "less but better"
Date: 2026-08-26
Scope: PR #88 (`feat/validation-status-ux`) — the three phases of "Verificando" over a `not_found`, the empty-date confirmation, and the two doors (correction, re-upload).

> The previous review (2026-08-25, PRs #81–#83, all 9 findings resolved)
> lives in git history at `.design/devolada/DESIGN_REVIEW.md` before this
> commit.

> **Resolution (same session):** both findings below were fixed on the PR
> branch before merge, and the screenshots were regenerated against the
> fixed build — they show the outcome, not the defect. A third finding
> (the raw ISO date in the read-only rows) was caught by the `/shadcn`
> code pass earlier the same day and fixed in `985c5ab`.

## Screenshots Captured

Captured by `tests/design/review-pr88.spec.ts` (the e2e stub harness — same
servers as the review of PRs #81–#83). Primary width carries light + dark.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-pago-verificando-calma-375[-dark].png` | 375×812 | D1/D2 — attempt 1, calm copy, collapsible open with the es-MX date, both doors |
| `screenshots/review-pago-verificando-calma-768.png` | 768×900 | Same, centered at content width |
| `screenshots/review-pago-verificando-corregir-375[-dark].png` | 375×812 | D2 — the correction form opened through the door, honest copy above it |
| `screenshots/review-pago-verificando-45min-375[-dark].png` | 375×812 | D3 — attempt 5, form in the foreground, "más de lo normal" |
| `screenshots/review-pago-espera-larga-375[-dark].png` | 375×812 | D5 — the hour of the late attempt, the human way out, doors |
| `screenshots/review-pago-espera-larga-768.png` | 768×900 | Same at tablet |
| `screenshots/review-pago-en-proceso-tarde-375[-dark].png` | 375×812 | D1 — "En proceso" holds the calm at attempt 5 |
| `screenshots/review-pago-confirmar-sin-fecha-375[-dark].png` | 375×812 | D6 — unread date arrives empty, submit disabled |

> All screenshots are in `.design/devolada/screenshots/`.

## Summary

The staged escalation reads exactly as designed: the calm phase genuinely
calms (badge + one sentence + everything else behind doors), the 45-minute
form carries no accusation, and the long wait makes a promise the cron can
keep. Two copy-level defects surfaced only in the rendered pixels — the
kind code review cannot see — and both are fixed.

## Must Fix — all resolved

1. **Double period after the hour** (`review-pago-espera-larga-375.png`,
   pre-fix): es-MX hours end in "a.m."/"p.m.", so the template's own
   period printed *"4:13 a.m.. Puedes cerrar"*. `PaymentPage.tsx` now
   appends its period only when the hour does not already end in one.
   _Fixed on the branch; capture regenerated shows "4:15 a.m. Puedes"._

## Should Fix — all resolved

1. **The open correction form contradicted its own headline**
   (`review-pago-verificando-corregir-375.png`, pre-fix): the calm
   paragraph — *"No necesitas hacer nada"* — stayed on screen above the
   form the payer had just deliberately opened. When `correcting` is set
   the paragraph now reads *"Seguimos verificando. Revisa que estos datos
   coincidan con tu comprobante y corrígelos si hace falta."*
   _Fixed on the branch; capture regenerated._

## Could Improve

1. **Native date input speaks the browser's locale**: the empty date
   field shows the platform placeholder (`mm/dd/yyyy` in the CI browser;
   `dd/mm/aaaa` on a real es-MX device). This is the platform's own
   control — replacing it with a custom date picker would be drift for a
   field used once. _No action; noted so nobody "fixes" it into a
   hand-rolled component._
2. **Badge + first sentence mildly overlap** ("Verificando pago" over
   "Validación en proceso…"): acceptable — the badge is the law
   (`StatusBadge` is the only status representation) and the sentence is
   the phase, not the status. _No action._

## What Works Well

- **The hierarchy is the design**: badge → one phase sentence → data
  behind a named door → the escape hatch last, in ghost weight. At 375px
  nothing competes with the phase sentence
  (`review-pago-verificando-calma-375.png`).
- **The doors cost what they should**: "Ver los datos enviados" is one
  tap and free; "Corregir estos datos" is a second, deliberate tap; the
  clave renders in mono and fits whole at 375px (BUG-009's lesson,
  respected by the new read-only row).
- **Dark is a real palette** — warm charcoal, not inversion; every value
  arrives through tokens and `contrast-lint` holds all 34 pairs at AA in
  both themes.
- **Touch targets all ≥ 48px**: collapsible trigger `h-12`, both door
  buttons at the `Button` atom's `md`, re-upload at `h-12 w-full`.
- **The empty-date screen is honest twice** (`review-pago-confirmar-sin-fecha-375.png`):
  the field is visibly empty *and* the submit stays disabled — the button
  never promises what the request cannot do.
