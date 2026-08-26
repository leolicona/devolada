# Design Review: The classifier at minute two (PR #94)

Reviewed against: `.design/devolada/DESIGN_BRIEF.md`, `docs/direct-payment/reading-check.spec.md` (US-D14), `docs/FRONTEND.md`
Philosophy: Functionalist (Dieter Rams) with a warm accent — "less but better"
Date: 2026-08-26
Scope: PR #94 (`feat/reading-check`, merged) — the three states the classifier added: calm backed by evidence, the dispute that asks about the receipt, and the pre-diagnosed expiry.

> The previous review (PR #90, both findings resolved) lives in git
> history at `.design/devolada/DESIGN_REVIEW.md` before this commit.

## Screenshots Captured

Captured by `tests/design/review-pr94.spec.ts` (the e2e stub harness).
Primary width carries light + dark.

| Screenshot | Breakpoint | Description |
| --- | --- | --- |
| `screenshots/review-pago-evidencia-calma-375[-dark].png` | 375×812 | D3 — attempt 5 with `agreed`: evidence copy, **no form**, collapsible open |
| `screenshots/review-pago-evidencia-calma-768.png` | 768×900 | Same at content width |
| `screenshots/review-pago-disputa-clave-375[-dark].png` | 375×812 | D4 — clave empty ("Está en tu comprobante"), rest pre-filled, submit disabled |
| `screenshots/review-pago-disputa-clave-768.png` | 768×900 | Same at tablet |
| `screenshots/review-pago-disputa-monto-375[-dark].png` | 375×812 | D4 — the amount disputed instead: peso field empty, clave keeps its mono reading |
| `screenshots/review-pago-expira-diagnosticado-375[-dark].png` | 375×812 | D6 — expiry carrying its diagnosis |

> All screenshots are in `.design/devolada/screenshots/`.

## Summary

Zero defects — the first review this week where the pixels match the
spec on the first pass, which is itself evidence the copy decisions
were settled *before* the code this time (the grill-me happened first).
The three states read as one family: same badge, same one-sentence
phase, same doors.

## Must Fix

None.

## Should Fix

None.

## Could Improve

1. **The diagnosed expiry ends in text with no action**
   (`review-pago-expira-diagnosticado-375.png`): the payer's next step —
   contact the ISP with the receipt — lives only in prose. A tap-to-
   WhatsApp line to the ISP would close the loop, but no ISP contact
   channel exists in the link payload today. _Noted for whenever the
   admin side grows one; not a defect of this PR._
2. **Native date input still speaks the browser's locale** — standing
   note from the last two reviews, still deliberate. _No action._

## What Works Well

- **The retired clock is visible in the capture itself**
  (`review-pago-evidencia-calma-375.png`): attempt 5 — the exact moment
  the old design opened the form — shows a calm sentence and closed
  doors instead. The evidence copy earns the calm it claims.
- **The dispute asks exactly one thing**
  (`review-pago-disputa-clave-375.png`): the empty field's placeholder
  ("Está en tu comprobante") points at the receipt, the three verified
  fields stay filled, and the disabled button never promises what the
  empty clave cannot do. The amount variant mirrors it perfectly —
  peso field empty, clave untouched.
- **The diagnosis reads like one** (`review-pago-expira-diagnosticado`):
  *"Tus datos coinciden… pero Banxico no publicó"* — blame placed where
  the evidence points, and the ISP receives a case, not a mystery.
- **Dark is still its own palette** across all four states; mono claves
  fit whole at 375px; every touch target ≥ 48px.
