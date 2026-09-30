# Contract: internal — exclusive accounts, the answer, the limit

**Feature**: confirmation-hierarchy · **Decisions**: D4–D8, D10, D11 ·
Internal to `apps/api`; nothing here crosses a wire.

A delta on [012's engine contract](../../012-payment-without-receipt/contracts/engine.md).

## Persons an account has paid (D4) — `direct-payments/payer-reference.ts`

```ts
/* confirmation-hierarchy D4: for each of these sending accounts, whether
   it has paid a customer who does not hold `referenceId`. One query over
   cep_records (business_id, sender_account) → payments (adopted clave,
   confirmed or partial) → links → payer_reference_customers. */
export async function accountsOfOthers(
  db, businessId: string, referenceId: string | null,
  customer: { source: "panel" | "api"; key: string },
  accounts: string[],
): Promise<Set<string>>;
```

- A paid customer with no reference row is another person unless it is
  `customer`.
- Business-filtered at every join (constitution V).
- `knownAccounts` = 012's `learnedAccounts(link)` minus this set;
  `othersAccounts` = this set.

## Matcher (D6, D10) — `consta/bundle/match.ts`, still pure

```ts
export type ReceiptSide = {
  /* …012's fields… */
  /* D4: knownAccounts now holds exclusive accounts only; this is the rest */
  othersAccounts?: string[];
};

export type TieBreakAnswer = { senderTail?: string; claveTail?: string };
export type TieBreakFit =
  | { fit: "one"; chosen: CepRecord; by: "sender_tail" | "clave_tail" }
  | { fit: "needs"; ways: ("sender_tail" | "clave_tail")[] }   // more to ask
  | { fit: "clave" }                                            // the whole clave
  | { fit: "none" };

export function fitTieBreak(
  answer: TieBreakAnswer,
  candidates: CepRecord[],          // the kept candidates, used ones already dropped
  othersAccounts: string[],
): TieBreakFit;
```

Read in this order:

1. Each given way picks its fits: the digits by `tailFits`, the characters
   by `fitClaveTail`'s reading (O as 0, I as 1) on each clave's last four.
2. One way given: its fits are the answer's fits. Both given: only the
   candidates both picked — a way that picked none, or two ways that picked
   different candidates, leave none.
3. None → `{ fit: "none" }`.
4. One → `{ fit: "one" }`, unless only the digits were given and the
   chosen account is in `othersAccounts` → `{ fit: "needs", ways:
   ["clave_tail"] }`.
5. Several → the way not given, as `needs`; both given → `{ fit: "clave" }`.

`by` is `clave_tail` whenever the characters were given and fit.

Modes, amended (D10):

- `own`: 012's order; `knownAccounts` holds exclusive accounts only, so a
  shared account no longer puts its transfer first — the earliest does.
  During a transition, a chosen candidate from an account not in
  `knownAccounts` is held and asks `tie_break` with both ways (was
  `sender_tail`).
- `typed`: integrity → used → `knownAccounts` → undecided. The typed tail
  and the window leave this mode: the answer comes later, through
  `fitTieBreak`.
- `receipt`: unchanged.

## Lifecycle (D5, D6, D8, D11) — `direct-payments/validation.ts`, `routes/direct-payments/handler.ts`

- **The typed door** (D5) searches at once; no refusal before the search.
- **After the search**: one or several candidates found and none taken by
  `knownAccounts` → the row goes undecided (spec 013's path: `validating`,
  `CEP_UNDECIDED`, no slot, candidates in `match_trail`). This holds for a
  single match too (FR-009).
- **An answer** (a row with `senderTail` and/or `claveTail`, superseding a
  row waiting on a tie-break):
  1. `submitPayment` refuses `TIE_BREAK_EXHAUSTED` when the link has three
     rows with `tie_break = 'none'` in the last 24 hours, and
     `TIE_BREAK_NOT_ASKED` when the superseded row is not waiting on a
     tie-break; neither writes a row. The hourly budget does not count
     the row (012 D25 amended).
  2. The row takes the waiting row's reference, bank, day, amount,
     `ladder_round` and `correction_count`; it never calls the provider and
     never counts as a correction (012 D16 counts searches). A way the
     waiting row's own answer gave, and that fitted (`tie_break` `one` or
     `several`), rides forward onto this row, so the payer's two data are
     read together and must agree: the second answer narrows the first,
     never replaces it.
  3. `fitTieBreak` against the waiting row's kept candidates (the `used`
     check re-read now), with `othersAccounts` for their accounts.
  4. `one` → the ordinary `valid` path (spec 013 D8's `promote`), `by`
     from the fit, `tie_break = 'one'`, `confirmation.tieBreakMisses` =
     the chain's rows with `tie_break = 'none'`.
  5. `needs` or `clave` → `tie_break = 'several'` (or `'one'` when the digits
     picked another person's account), the waiting row's trail copied, the
     row undecided; the ask follows (data-model, "The ask").
  6. `none` → `tie_break = 'none'`, the waiting row's trail copied, the row
     undecided.
- **A whole clave** at any point: spec 013 D11 and 012 FR-030, unchanged.
