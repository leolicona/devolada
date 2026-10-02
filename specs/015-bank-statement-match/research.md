# Research: bank-statement-match

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-02

Phase 0 read the code on `main` at `eb76893` (specs 012, 013, 017 and 018
built; 019 specified, not built). Every finding below cites where it was
read. Decisions are written **Decision / Rationale / Alternatives
considered**; the plan's decision table points here.

The delivery order is the creator's (Session 2026-10-02): **Phase A**, the
same-bank payment without a file; **Phase B**, the statement's core around
a generic credit; **Phase C**, each bank's reader, built only once its real
file is measured.

---

## Phase A — the same-bank payment, without a file

### R1. What happens to a same-bank payment today

Read on `main`:

- The pay route (`routes/direct-payments/handler.ts:592`, `submitPayment`)
  never compares banks. It snapshots the collection account into
  `payments.beneficiary` (`:843`, `collectStored(business)`; a receipt whose
  draft reading tied another registered account uses that one, `:844-847`),
  stores the payer's bank in `payments.sender_bank` (`:1030`), inserts the
  row `validating` with `nextValidationAt` two minutes ahead (`:1097`), and
  runs `runValidation` under `waitUntil` (`:1260-1270`).
- The engine refuses the pair before any credit
  (`consta/request.ts:53-61`, validation spec D17, measured 2026-08-19: the
  provider bills its own same-institution 400) and throws
  `ConstaError("REQUEST_REJECTED", retryable: false)`
  (`consta/validate.ts:110-117`). `consta/failure.ts:8-14` says `retryable`
  is "carried and NOT yet acted on".
- The lifecycle falls to `retryLater(code)` (`direct-payments/validation.ts:1125`).
  The row retries on the D7 offsets (2, 8, 20, 45, 120, 360 min,
  `schedule.ts:17`), each a free refusal, and ends `expired` with
  `lastError = "REQUEST_REJECTED"` about six hours after it was created.
- `REQUEST_REJECTED` is not a public code, so the payer reads an ordinary
  wait the whole time, then "No pudimos confirmar tu transferencia a
  tiempo…" (`apps/pago/.../PaymentPage.tsx:1991-1992`).
- A provisional release never happens: `maybeProvisionalRelease` is called
  only on a `not_found` or `pending` verdict (`validation.ts:1410`, `:1447`),
  and the refusal is neither.

So the payment that paid is never marked paid, nobody is told, and the
customer who was cut stays cut.

### R2. Where the same-bank payment is recognized

**Decision**: in `runValidation`, as a pre-check beside today's
`SPEI_BANK_UNKNOWN` (`validation.ts:583-590`), placed **before** the
provider checks (`PROVIDER_NOT_CONFIGURED` `:562`, `SPEI_NOT_CONFIGURED`
`:581`). A row is same-bank when it would take the transfer door
(`trackingKey` or `referenceNumber` present, the same condition
`requestFor` uses, `:978-1027`) and `payment.senderBank` equals the bank of
the account it is checked against (`parseAccount(payment.beneficiary).bank`,
falling back to `collectAccount(business)` for legacy rows, `:573-577`).
The comparison is exact string equality on the generated `BANKS`
vocabulary, the one both sides are validated against
(`routes/settings/schema.ts:111,124,126`; `payRequest`'s
`z.enum(BANKS)`, `routes/direct-payments/schema.ts:169`) — the same test the
engine runs. Every kind of collection account counts: CLABE, card or phone
(creator, Session 2026-10-02).

**Rationale**: `runValidation` is the one place every attempt passes
through — the inline submit, the sweep, a correction that supersedes, a
row released from `queued_for_credit` (`credit/topups.ts:226-267`). One
check there covers them all. Before the provider checks, because a
same-bank payment needs no provider: a business without the provider
credential still gets it recognized (constitution VIII). The engine's own
guard stays as the backstop; it is never reached from here.

**Alternatives considered**:
- *In `submitPayment`.* Misses the sweep, a row released from the credit
  queue and any row born before this feature.
- *Act on `retryable: false` generally* (`failure.ts:8-14`). It changes
  how every refused request dies, which 004 deliberately left as a product
  decision of its own (`specs/004-consta-api-merge/research.md:150-160`).
  Recognizing the one case we understand is narrower and reads as what it
  is.
- *Derive the bank from the CLABE's prefix* (`direct-payments/clabe.ts`,
  `bankForClabe`). The API never does; the owner picks `spei_bank` and may
  correct the pre-fill. The snapshot's bank is what the engine compares,
  so it is what we compare.

### R3. How the payment waits

**Decision**: the 013 pattern — status stays `validating`,
`nextValidationAt: null`, and the reason in `lastError = "SAME_BANK"`. No
new status word. The guard that puts a re-armed undecided row back to
waiting (`validation.ts:531-543`) needs nothing: a re-armed same-bank row
re-enters the pre-check (R2) and returns to the wait, writing nothing new.

**Rationale**: the sweep selects only rows with a non-null
`next_validation_at` (`validation.ts:2392-2394`), so a null is a wait
without a clock — exactly what `CEP_UNDECIDED` already does
(`validation.ts:1229-1240`, `db/schema.ts:489-501`). Keeping `validating`
means every reader of open payments keeps working unchanged:
`OPEN_STATUSES` and `LIVE_STATUSES` (`handler.ts:190`, `:208`), the page's
poll (`PaymentPage.tsx:1099-1109`), `inReview`, the one-open-attempt rule.
A new status word would have to be taught to each of them (and to the
eight copies of the enum listed in data-model.md), which 018 also declined
(cash-at-stores D23).

**Alternatives considered**:
- *A status `awaiting_business`.* Every open-payment query, the page's
  poll, the `/v1` webhook vocabulary and the panel's lifecycle badge would
  each need it; a missed one is a payment the payer stops polling.
- *Keep the schedule but skip the provider.* The row would still expire at
  six hours, which the creator ruled out ("never by the clock").

### R4. The provisional release

**Decision**: the pre-check calls `maybeProvisionalRelease` once, at
recognition, through the same `releasable()` wrapper the verdicts use
(`validation.ts:1291`), with the evidence `human`. That is what
`releaseEvidenceFor` already gives a confirmation (transfer door, no proof
key, `provisional.ts:69-81`) and what 012 D18 counts it as; here it holds
for every same-bank row, a read receipt included, because the payer named
the bank themselves (R9) and no machine will ever add evidence (spec
FR-020: "the payer's own evidence"). The promise's date is unchanged:
`promiseDeadline(createdAt)` = created + six hours + one day, day
granularity (`provisional.ts:150-152`) — "the same time as a payment
searched at Banxico" (creator, Session 2026-10-02). All of today's guards
apply: panel link, the switch, actions enabled, a key, `isRevoked`, an
invoice to promise on, and the business's reconnection policy against the
claim (`provisional.ts:170-215`).

When the promise lapses with the payment still waiting, WispHub cuts by
itself, as it does today; the row keeps waiting. `notifyProvisionalExpiry`
is not sent: it runs only on the expiry write (`validation.ts:525-527`),
which this row never takes, and the business already sees the payment in
"Por confirmar en tu banco" with the release shown as lapsed (R8).

**Rationale**: the release is evidence-driven and evaluated once
(`provisional.ts:154-157`, provisional-release D1/D2); the confirmation
is the only evidence a same-bank payment will ever have before the
business looks, so it is evaluated then. Nothing in the release pays the
invoice: the promise is WispHub's "keep the service while the payment
arrives" primitive and is deleted by WispHub when the payment is
registered (`wisphub/client.ts:692-705`, measured 2026-08-27).

**Alternatives considered**:
- *A longer promise for same-bank payments.* Proposed (three days) and
  declined by the creator in favour of the same time as Banxico.
- *Email the business when the promise lapses.* The panel already shows
  the payment and its lapsed release; an email per lapse would repeat it.

### R5. "No llegó": which word ends the payment

**Decision**: `status = "expired"` with `lastError = "NOT_RECEIVED"`. Who
ended it is recorded: the operator in `reviewedBy` / `reviewedAt` (R6), or
the statement import (Phase B, R12). The schema's status comment gains one
line naming this use and the wrong reading it avoids.

**Rationale**, each point read on `main`:
- **The payer** reads it as any payment that could not be confirmed (spec
  FR-019, 017 FR-022): the expired reference view already says "No pudimos
  confirmar tu transferencia a tiempo" and sends the payer to the business
  by its name (`PaymentPage.tsx:1980-2028`).
- **The fee** never charges: `FEE_STATUSES` is confirmed, partial,
  unapplied and invalid; "`expired` never charges" (`credit/index.ts:17-19`,
  prepaid-credit D2) — the creator's rule for "no llegó" (Session
  2026-10-02).
- **The history** counts it with no change: `isRevoked`'s burned ride is
  `expired` with a release, for 90 days (`provisional.ts:110-117`), which
  is FR-023 word for word — and an `expired` row that was never released
  does not count, as the spec says.
- **The rest of the product** already treats `expired` as released: the
  tracking-key unique index predicate (`db/schema.ts:683-690`) and
  `RELEASED` (`cep-match.ts:27`).

**Alternatives considered**:
- *`invalid`.* That word means "your transfer does not exist" by
  Banxico's record (`db/schema.ts:416-420`); it charges the fee and is
  refunded when a later valid CEP contradicts it
  (`credit/index.ts:113-116`); and the payer's invalid view is not 017's
  "could not confirm". The business saying "it is not in my account" is a
  different fact.
- *`invalid` + `REJECTED_BY_BUSINESS`*, as the review's reject writes
  (`routes/payments/handler.ts:537-589`). A rejection is a choice about a
  confirmed transfer; this is a statement about money that never came.
- *A new status `not_received`.* The same cost as R3's alternative, for a
  meaning `expired` plus a reason already carries.

### R6. Confirming by hand

**Decision**: one route beside the review,
`POST /payments/:id/bank-check` with `{ received: boolean }`, under
`requireSession` + `requireArea("payments", "operate")` (owner, admin,
operator; `auth/role-matrix.ts:31-49`). The handler:

1. Claims the row with one conditional update — `status = 'validating'
   AND last_error = 'SAME_BANK'` → `last_error = 'BANK_CHECKING'` — scoped
   by `business_id`. No row changed answers 409 `NOT_AWAITING_BANK`, so two
   operators, or an operator and a statement, never both settle it.
2. `received: false` writes R5's end with `reviewedBy` / `reviewedAt`.
3. `received: true` settles with **no CEP** through the settlement the
   verdict uses, exported from `validation.ts` behind one function,
   `settleWithoutCep`: a panel link goes through `settlePanelPayment` with
   `cep: null` (D14's debt re-check — `unapplied` when the debt was settled
   elsewhere meanwhile — then `settleConfirmed`: folio, class, the action
   in the business's mode — observation, queued or inline); an API link
   goes through `settleApiPayment` with `cep: null` (classification against
   the asked amount, the one-time link closed, the verdict webhook through
   `announcingWriter`). Both already fall back to `payment.amountCents`
   when `cep` is null (`validation.ts:1846`, `:1892`, `:2178`); the amount
   received is the payer's claim, `claimedAmountCents ?? amountCents`,
   which is the amount the operator checked. `reviewedBy` / `reviewedAt`
   record who.
4. If the settlement cannot read the business's system (its `retryLater`
   closure, `validation.ts:1788-1873`), the closure passed here puts the
   row back to `SAME_BANK` and the route answers 503
   `INTEGRATION_UNAVAILABLE`: nothing is lost and the operator tries again.

**Rationale**: the review (`reviewDecision`, receipt-triage D31) is the
closest precedent — a business decision on one row, the actor recorded on
the row (`reviewedBy`, `db/schema.ts:398-400`), the same area — but it only
works on rows that already have a verdict, a folio and a class. Settling
with no CEP is already done twice: the kept-verdict branch
(`validation.ts:550-556`) and the store's cash rows (`settleStoreRow`,
`store-collections/index.ts:64-106`, through `settleConfirmed`). Reusing
`settlePanelPayment` rather than `settleConfirmed` directly keeps D14's
re-check, which cash rows skip but a SPEI-channel row must not.

The fee: a confirmed, partial or unapplied row is debited by
`announcingWriter` like any other (`validation.ts:305-343`) — the creator's
rule (Session 2026-10-02).

**Alternatives considered**:
- *Two routes* (`/confirm-received`, `/not-received`). One decision with
  two answers is the review's shape; the panel's one mutation serves both
  buttons.
- *Call `settleConfirmed` directly*, as cash does. It skips D14 and has no
  API-link counterpart.
- *A new `confirmed_by` column.* `reviewedBy` already means "who decided
  this row by hand"; its comment widens by one clause (data-model.md).

### R7. What the payer reads

**Decision**: nothing new. A same-bank row is a `validating` reference row
with `ask: null` (`askOf` gives an ask only for `CEP_UNDECIDED` or
`TRANSFER_NOT_FOUND`, `handler.ts:1516-1549`) and a public `error` of null
(`SAME_BANK` is not in `publicPaymentError`, `schema.ts:305-335`). The page
already renders that as 017's wait: "Seguimos buscando tu transferencia."
(`SourcedReview`, `PaymentPage.tsx:834-838`), "Solo falta confirmarla"
when the service came back (`:851`), the confirmed view when the business
confirms, and the expired view when it ends "no llegó" (R5). Rows without
a reference (a typed clave) read "Estamos verificando tu transferencia…"
(`:1504-1529`). One test asserts it: the page fed a same-bank row's status
renders only those sentences, and no text names a bank, a statement or a
hand.

**Rationale**: the creator's rule (spec FR-019): the payer learns the
state, never how. The cheapest way to keep that promise is to add no
payer-facing state at all; the status contract carries nothing that says
"same bank" (data-model.md).

**Alternatives considered**: *a dedicated waiting sentence.* Declined by
the rule itself.

### R8. The panel

**Decision**: the Pagos feed (`apps/admin/src/features/feed/FeedScreen.tsx`)
gains:

- a chip **"Por confirmar en tu banco"** in `statusFilters`, mapped by
  `feedPath` to a new `feedQuery` value `awaiting=bank`
  (`routes/payments/schema.ts:28-47`), which the handler turns into
  `status = 'validating' AND last_error IN ('SAME_BANK','BANK_CHECKING')`;
- an attention strip built exactly like the failed strip (`:836-872`):
  its own query of the feed with `awaiting=bank`, N = the rows of its first
  page — "N pagos esperan que los confirmes en tu banco" with **Verlos**,
  which selects the chip; shown only when N > 0;
- on such a row, in `ChargeRow`: a new `StatusBadge` kind `awaitingBank`
  ("Por confirmar", warning tone, icon + text); the customer, amount,
  reference, the day and bank the payer gave; whether the service was
  restored for it and, once `promiseDeadline` has passed, that the
  restoration lapsed; and, for `payments: operate`, two buttons — **Sí,
  llegó** and **No llegó** — each behind an `AlertDialog`, the
  confirmation precedent of *Puntos de pago* (`CashPointsScreen.tsx:51`),
  because both are final;
- an ended row shows `notReceived` ("No llegó", error tone) and, on a row
  confirmed by hand, "Confirmado a mano por {nombre}".

The business-facing copy may name the bank ("Desde {banco}, el mismo
banco de tu cuenta de cobro: revisa en tu banca si llegó"); FR-019 binds
only the payer.

**Rationale**: the chip is the "Sin pago" precedent of 013 US4 — a filter
of the one feed, not a new screen; the strip makes FR-022's list visible
from the default view without an email. `StatusBadge` is status's only
representation (constitution VI), so the two words are new kinds in
`packages/ui`, with existing icons and tones and no new token.

**Alternatives considered**: *A screen of its own.* The rows are
payments; the feed already filters, searches and dates them. *A count on
every chip.* No other chip has one.

### R9. A receipt that shows the same bank on both sides (FR-017)

Read on `main`: the page reads a receipt at the edge first
(`POST /direct-payments/links/:token/read`, `PaymentPage.tsx:1218`), and a
read receipt is submitted with `proofId` **and** `transfer` — "`transfer`
wins the routing; the proof is kept, not consulted"
(`routes/direct-payments/schema.ts:239-246`, two-eyes D18). The reading's
answer, `proofReadingResponse` (`schema.ts:348-420`), already carries
`ask`, "the engine's ask, reported", with two reasons — `no_key` and
`wrong_destination` (receipt-triage D15) — which the page asks before
anything is paid (`PaymentPage.tsx:1250-1252`). The gate computes the
same-bank pair (`consta/extraction/gate.ts:42-72`, `receiving.sameBank`),
which "nothing reads … to change the flow"; the payer's answer does not
carry it.

**Decision**: the rule lives in `askBeforeCredit`
(`consta/extraction/ask.ts:43-66`), the one function `/read` reports and the
receipt door enforces (receipt-triage D15), so a client that skips the page
buys nothing. On a clear reading whose gate says `receiving.sameBank`:

- **with a key** (clave or a non-generic reference): a third reason,
  `{ reason: "same_bank" }`, after `wrong_destination` — the page renders
  the bank question, "¿Desde qué banco pagaste?" with 017's bank chips, the
  payer's learned banks first, and submits with the bank chosen as
  `transfer.senderBank`;
- **without a key**: today's `no_key` ask, with `senderBank` added to its
  fields, so the one typing form asks the bank with the key.

Either way the payer's bank reaches the transfer door, and the server's
recognition (R2) decides on it. A reading that is not clear, or not a
same-bank pair, goes on as today; a reading alone never makes a payment
same-bank.

**Rationale**: the reading may be a misread — the destination's bank taken
for the sender's (receipt-reader-tuning D5) — so the payer decides, and
asking before the submit spends no search. The ask belongs to the server,
like the two it already reports, so the page renders a reason rather than
re-deriving a rule. The question is about the payer's own transfer, so it
does not break FR-019.

**Alternatives considered**: *The page reads a `sameBank` flag and decides
itself.* It would put a rule on the client that the server already
computes. *Ask after the submit, as a status `ask`.* It needs a superseding
row and a poll; the page already holds the reading before the submit.

### R10. The method in the business's system (spec 019)

**Decision**: nothing to build here. The row keeps `channel = 'spei'`, so
019's FR-001 records it with `SPEI - LINK.DEVOLADAPAGO` and its reference
is the folio alone (019 FR-007: no clave). Spec 019's two sentences that
said such a payment would get a method of its own carry the creator's
amendment of 2026-10-02 (`specs/019-payment-method-per-channel/spec.md`).

**Rationale**: the creator: "Dentro de SPEI - LINK.DEVOLADAPAGO, ya que es
un pago que también se registra a través de LINK."

### R11. `/v1` businesses

A same-bank payment on an API link waits the same way; there is no
release (`provisional.ts:172-174`: an API link has nothing to release);
**Sí, llegó** settles through `settleApiPayment` and the verdict webhook
fires as for any confirmed payment; **No llegó** ends it `expired`, which
the webhook already announces. The webhook payload carries no clave
(`routes/v1/webhook/schema.ts`), so a payment without one changes no
contract.

---

## Phase B — the statement's core

Built after Phase A, around a generic credit, before any bank's reader.
The decisions below are fixed now so the core's tests can use synthetic
credits; Phase C plugs readers into them.

### R12. The generic credit and the import

**Decision**: a reader (Phase C) turns a file into
`{ bank, format, account?, periodFrom, periodTo, movements[] }`; each
movement is `{ kind: "spei_credit" | "same_bank_credit" | "other",
operationDate, settlementDate?, amountCents, senderName?, senderAccount?,
reference?, concept?, clave?, folio? }`. The core keeps only the credits
(FR-002: other movements are counted and dropped). An import records bank,
format, who, when, the period and the counts (FR-003, FR-013).

**Rationale**: the creator's samples (2026-10-02, spec Assumptions) already
show the shape every bank will have to fill: two dates per line, the
reference sometimes glued to the concept, a clave on SPEI lines, a folio
on same-bank lines. The operation date is the one the payer gives and the
match uses (the settlement date differs on weekends — the
`reference-search-printed-day` lesson). Amounts are parsed by the core's
money parsers (constitution II), never by the reader's arithmetic.

### R13. A credit is imported once

**Decision**: a credit's identity, unique per business, is the first of:
`clave:<clave>`; `folio:<bank>:<folio>`; else
`line:<date>|<cents>|<reference>|<sender>|<n>`, where `n` is the line's
occurrence among identical lines of the same day in that file.

**Rationale**: FR-004 asks the clave first and, without one, date + amount
+ reference + sender. Two identical credits on one day (a payer who paid
twice, spec Edge Cases) would collapse into one without `n`; with it, an
overlapping file that holds the same day again maps each line to the same
identity, and a later file with one more identical line adds exactly one.

### R14. The match

**Decision**, in this order for each credit, the business's waiting rows
loaded once per import:

1. **Clave** — a non-ended row holding that `trackingKey` (FR-005); a
   confirmed row holding it → "ya conciliado" (FR-009).
2. **Same-bank** — a same-bank credit against `SAME_BANK` rows by
   reference + amount + operation date (FR-021).
3. **Registered payer** — a `validating` reference row, or an `expired`
   one that ended `TRANSFER_NOT_FOUND`, by reference + amount + date
   (FR-005, FR-007).
4. **New payment** — a registered payer's reference with exactly the
   amount their link asks today and no row waiting, dated on or after the
   day that amount was first asked (FR-006); the day comes from the
   integration's open invoices by capability, or the `/v1` link's creation;
   when neither tells, no payment.
5. **Otherwise** "sin cliente", the customer named when the reference is a
   registered payer's (FR-011). A credit whose clave is among the
   candidates of an undecided 013 row is listed as belonging to that row
   and never decides it (FR-005).

A match settles through Phase A's `settleWithoutCep`, with the credit's
clave written to the row (so the unique index makes it used everywhere,
FR-009) and `receivedCents` = the credit's amount.

After the credits, every `SAME_BANK` row whose `transferDate` falls inside
the import's period, with no credit of its reference and amount on any
day of the file, ends "no llegó" (R5) by this import (FR-023); one with
such a credit on another day keeps waiting and the credit is listed
beside it (spec Edge Cases).

### R15. Where it lives

**Decision**: a core module `apps/api/src/statements/` (`import.ts`,
`match.ts`, `identity.ts`) and one reader per measured format under
`apps/api/src/statements/readers/`; a route area `routes/statements/`
exported as `@devolada/api/statements-schema`; a panel screen
**Estado de cuenta** (upload, the report, "Abonos sin cliente" with
**Asignar**). Uploading and assigning are `payments: operate`; reading is
`payments: read`. The file itself is never stored (FR-002); only credits
are.

**Rationale**: a bank's export format is a measured fact about that bank,
so it lives in one reader file (the spirit of constitution IX), while
identity, matching and settlement are the core's. No new trigger: the
import runs in the upload request; a month of a 1,000-customer business is
a few thousand lines, inside one request's budget (SC-001).

---

## Phase C — each bank's reader

### R16. The readers wait for real files

**Decision**: no reader is written until its real file is in hand,
measured and anonymized into a fixture (the spec's rule, Session
2026-10-02). The first expected is the pilot's BBVA Net Cash export.

**Open, for the creator** (asked 2026-10-02, not yet answered): whether
the BBVA **monthly PDF statement** becomes a second format, for businesses
whose accounts cannot export daily. If it does, it reads through the
reader binding's `toMarkdown` door (the one a PDF receipt already uses),
and the creator's sample fixes its shape: an operation and a settlement
date per line, the SPEI reference glued to the concept
(`0010926Transferencia`), the counterpart's CLABE, the clave and a name on
the lines below, and a ten-digit "Referencia" on same-bank lines.

**Also open until the file arrives**: whether BBVA's same-bank line on the
**receiving** side prints the payer's folio and concept. The creator's
receipt of 2025-10-07 ($350, folio 0056320005) and the business's export of
that day would answer it from both sides.
