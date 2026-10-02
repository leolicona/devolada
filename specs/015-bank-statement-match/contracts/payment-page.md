# Contract: the payer's page (Phase A)

Spec FR-019: the payer reads a same-bank payment's state in spec 017's
words, never how it is validated. This contract adds **no field and no
state** to the payer's API (D7).

## `GET /direct-payments/:id/status` — unchanged

A same-bank row answers exactly like any reference row still being
searched:

| Field | Value on a waiting same-bank row |
| --- | --- |
| `status` | `validating` |
| `error` | `null` (`SAME_BANK` and `BANK_CHECKING` are not public codes) |
| `ask` | `null` |
| `nextValidationAt` | `null` |
| `provisionalRelease` | as today, when the release applied (D4) |

When it ends: `confirmed` / `partial` / `unapplied` as any settled
payment; `expired` with `error: null` after "no llegó" (D5).

## What the page renders (no code change expected)

| Moment | Words (017 FR-022) | Where (`PaymentPage.tsx` on `main`) |
| --- | --- | --- |
| Waiting, reference row | "Seguimos buscando tu transferencia." (never "Todavía no la vemos", which needs `TRANSFER_NOT_FOUND`) | `SourcedReview`, :834-838 |
| Waiting, service restored | "Solo falta confirmarla" | :851 |
| Waiting, no reference (typed clave) | "Estamos verificando tu transferencia…" | :1504-1529 |
| Confirmed | the confirmed view | :1830-1867 |
| Ended "no llegó" | "No pudimos confirmar tu transferencia a tiempo…", sent to the business by its name | :1980-2028 |

**Test** (`apps/pago/test/bank-statement-match.test.tsx`, cites
`bank-statement-match US4`): fed each status above, the page shows only
these sentences; no rendered text names a bank, a statement, "mismo
banco", or a confirmation by hand.

## The receipt's bank question (D9)

When `/read` answers `sameBank: true`, the page asks before it submits:

- Title: "¿Desde qué banco pagaste?"
- The bank chips of 017 (D18): the payer's learned banks first, then
  "Otro banco".
- **Continuar** (64px, decisive) submits with `transfer.senderBank` set to
  the bank chosen.

The question names only the payer's own bank, so FR-019 holds.
