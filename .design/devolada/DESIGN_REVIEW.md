# Design Review: The amount the payer really sent (PR #90)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md`, `docs/direct-payment/claimed-amount.spec.md` (US-D13), `docs/FRONTEND.md`
Philosophy: Functionalist (Dieter Rams) with a warm accent — "less but better"
Date: 2026-08-26
Scope: PR #90 (`feat/claimed-amount`) — the "Monto transferido" field on the manual door and the correction form, the overpay sentence that replaced the refusal screen, the hidden beneficiary row, and the optional beneficiary in the admin's SPEI card.

> The previous review (PR #88, both findings resolved) lives in git
> history at `.design/devolada/DESIGN_REVIEW.md` before this commit.

> **Resolution (same session):** both findings below were fixed on the
> PR branch and the screenshots regenerated against the fixed build —
> they show the outcome, not the defect.

## Screenshots Captured

Captured by `tests/design/review-pr90.spec.ts` (the e2e stub harness —
same servers as every review before it). Primary width carries light +
dark.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-pago-monto-manual-375[-dark].png` | 375×812 | D3 — the manual door's four fields, amount pre-filled `$ 514.00` |
| `screenshots/review-pago-monto-manual-768.png` | 768×900 | Same at content width |
| `screenshots/review-pago-sobrante-confirmar-375[-dark].png` | 375×812 | D2 — the overpay sentence with both amounts, form pre-filled `$ 600.00` |
| `screenshots/review-pago-corregir-monto-375[-dark].png` | 375×812 | D3 — the correction form pre-fills the row's own claim (`$ 400.00`), not the debt |
| `screenshots/review-pago-sin-beneficiario-375[-dark].png` | 375×812 | D5 — "Ver los demás datos" holds banco + concepto with no gap |
| `screenshots/review-admin-ajustes-beneficiario-1280[-dark].png` | 1280×800 | D5 — "(opcional)" with the "Recomendado" helper; card configured without the name |
| `screenshots/review-admin-ajustes-beneficiario-375.png` | 375×812 | Same, stacked |

> All screenshots are in `.design/devolada/screenshots/`.

## Summary

The new field reads as native: same `Field`/`Input` atoms, same order
logic (the amount sits right under the clave — the two things a payer
proofreads), and the pre-fill honors the design's no-ritual rule. The
review caught one real layout break — the overpay sentence shattered
into columns and spilled out of its Alert — and one consistency gap
(the peso sign), both fixed.

## Must Fix — resolved

1. **The overpay Alert broke into columns and overflowed the card**
   (`review-pago-sobrante-confirmar-375.png`, pre-fix): `<Amount>`
   elements as direct Alert children became separate layout items — the
   sentence rendered as *"Tu comprobante dice | $600.00 | y tu adeudo
   es | $514.00"* with the tail spilling **outside** the alert box.
   _Fixed: the sentence is one `<span>`; the capture now shows a single
   flowing paragraph. A code-only review would have shipped this — the
   JSX read fine._

## Should Fix — resolved

1. **"Monto transferido" rendered bare numbers** (`514.00`) while every
   other money on the page is `$514.00` and the admin's money inputs
   carry a `$` prefix. The shared `Input` atom already supports
   `prefix` — one prop. _Fixed: the field shows `$ 514.00` in both
   forms._

## Could Improve

1. **Native date input still speaks the browser's locale**
   (`08/26/2026` in the CI browser) — noted in the PR #88 review, still
   deliberate: it is the platform's control. _No action._

## What Works Well

- **The field order tells the story**: clave → monto → banco → fecha —
  the two proofread values first, mono for the clave, peso-prefixed for
  the amount (`review-pago-monto-manual-375.png`).
- **The correction form remembers the payer's own claim**: `$ 400.00`
  where the debt says `$514.00` (`review-pago-corregir-monto-375.png`) —
  the row's memory, not the system's opinion.
- **The overpay screen is information, not judgment**: same neutral
  tone as the "Leímos estos datos" alert above it, both numbers named,
  the confirm button un-gated (`review-pago-sobrante-confirmar-375.png`).
- **Absence leaves no scar**: without a beneficiary the collapsible
  closes ranks — banco and concepto, no empty row
  (`review-pago-sin-beneficiario-375.png`).
- **The admin says "(opcional)" and means it**: the card reports
  configured with the name empty, and the helper sells the field
  instead of demanding it ("Recomendado: es lo que tu cliente compara
  antes de transferir").
- **Dark is still its own palette** across all five states; the alert
  wells hold AA in both themes.
