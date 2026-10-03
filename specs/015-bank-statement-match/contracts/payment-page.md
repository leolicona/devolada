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
payment; `expired` with `error: null` and `retryAvailable: false` after
"no llegó" (D5, D17).

## `POST /direct-payments/links/:token/pay` — after "no llegó"

The payer's confirmation of the same data is a new payment that waits for
the business, never `TRANSFER_ALREADY_USED`: `identicalAttempt` skips a
row ended `NOT_RECEIVED` (D17, spec FR-024).

## What the page renders (no code change expected)

| Moment | Words (017 FR-022) | Where (`PaymentPage.tsx` on `main`) |
| --- | --- | --- |
| Waiting, reference row | "Seguimos buscando tu transferencia." (never "Todavía no la vemos", which needs `TRANSFER_NOT_FOUND`) | `SourcedReview`, :834-838 |
| Waiting, service restored | "Solo falta confirmarla" | :851 |
| Waiting, no reference (typed clave) | "Estamos verificando tu transferencia…" | :1504-1529 |
| Confirmed | the confirmed view | :1830-1867 |
| Ended "no llegó" | "No pudimos confirmar tu transferencia a tiempo…", sent to the business by its name; **no retry offered** (`retryAvailable: false`, D17) | :1980-2028 |

**Test** (`apps/pago/test/bank-statement-match.test.tsx`, cites
`bank-statement-match US4`): fed each status above, the page's status views
show only these sentences, and none says "mismo banco", mentions a
statement, or a confirmation by hand. The transfer instructions (step 1)
are outside the scan: they name the account's bank, as they must (spec
FR-019).

## The receipt's bank question (D9)

`POST /direct-payments/links/:token/read` — `proofReadingResponse.ask`
gains one reason:

```ts
/* bank-statement-match D9: the reading shows the business's bank on both
   sides — a misread or a real same-bank transfer (receipt-reader-tuning
   D5). The payer says which bank they paid from before anything is
   searched. */
z.object({ reason: z.literal("same_bank") }),
```

Decided by `askBeforeCredit` (`consta/extraction/ask.ts`), which the
receipt door also enforces, on a clear reading (receipt-triage D16 — spec
FR-017, creator 2026-10-03) whose gate says `receiving.sameBank`:

- with a key (clave or a non-generic reference): `{ reason: "same_bank" }`,
  after `wrong_destination`;
- without a key: today's `{ reason: "no_key" }`, with `"senderBank"` added
  to `fields`, so the typing form asks the bank with the key.

The page renders `same_bank` before it submits:

- Title: "¿Desde qué banco pagaste?"
- The bank chips of 017 (D18): the payer's learned banks first, then
  "Otro banco".
- **Continuar** (64px, decisive) submits with `transfer.senderBank` set to
  the bank chosen.

The question names only the payer's own bank, so FR-019 holds.
