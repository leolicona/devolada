# Bug Assessment: a payment can land on an invoice WispHub already moved into a newer one — the customer is charged twice

- **Slug**: transferred-invoice-paid
- **Created**: 2026-10-01
- **Source**: pasted text (the product creator, in session), reporting a
  measurement made the same day on the WispHub demo tenant. The state WispHub
  reports for a moved invoice, and what Devolada's reads see after a move,
  were then measured in session on the same tenant with a key the creator
  supplied (see *Measurements*). The text names one URL,
  `https://api.wisphub.net/api` (host `api.wisphub.net`): the provider's API
  base, where the measurements ran, not a page about the bug. Nothing was
  fetched from it as a report — it answers only with a business's key, and
  there is no report page behind it. Policy branch: not fetched as a report
  (an authenticated API base, not a bug-report source).
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> Measured 2026-10-01 on the WispHub demo tenant (https://api.wisphub.net/api):
> for customer `greyes@wifiplus`, invoice #40 ($1, pending) was created, then
> invoice #41 ($1) was created for the same customer. WispHub automatically
> transferred #40 into #41: #40's article reads "- Factura Transferida a la
> Factura #41" and #41 gained a line "FACTURA TRANSFERIDA #40", total $2. Then
> `POST /facturas/40/registrar-pago/` ($1, accion 0) was ACCEPTED ("Se agrego
> correctamente el pago") and #40 became "Pagada". A $1 payment on #41 then
> left a pending balance of $1.00 on the customer — the $1 of #40 was counted
> twice, so the customer ends with a false debt.

The creator's suspicion: `invoiceState()` (`apps/api/src/wisphub/client.ts`)
re-reads an invoice right before a payment is registered, answers "pending"
for estado 1/"pendiente", "closed" for 2/3/"pagad|cancel" and "unknown" for
anything else — and "unknown" pays. A transferred invoice (estado 5 in the
provider's `/facturas/` filter docs) would read "unknown" and be paid.
Scenario: the business's billing creates a new invoice, moving the pending
one, between the moment Devolada chose the invoice and the moment it
registers the payment.

Asked to establish: the exact `estado` the detail route returns for a
transferred invoice (demo tenant only, $1 invoices, `accion: 0`, never a
pilot's live billing); every path that calls `registrar-pago`; and the right
behaviour.

The payment on a moved invoice — the double count itself — is the creator's
measurement and was not repeated, so as not to leave a second false debt in
the demo.

## Symptom

Devolada can register a payment on an invoice that WispHub has already moved
("transferred") into a newer invoice of the same customer. WispHub accepts the
payment and marks the old invoice paid, but the newer invoice still carries
the moved amount, so the customer is billed for it twice and ends with a false
balance equal to the moved invoice. Expected: the payment lands where the debt
is now — the invoice that is open for that customer at that moment — exactly
once, and never on a moved invoice.

## Reproduction

Live, on the demo tenant: create a $1 invoice A for a customer, then a $1
invoice B for the same customer. WispHub moves A into B: A's `estado` becomes
"Se Transfirio" and B totals $2 (measured in session, #46 → #47). Paying A
with `POST /facturas/A/registrar-pago/` ($1, `accion: 0`) is accepted and A
becomes "Pagada"; after $1 on B the customer owes $1.00 they do not owe (the
creator's measurement, #40 → #41).

Deterministic, with the suite's mocked WispHub (`fetchMock` at
`WISPHUB_ORIGIN`). The shortest path is "Ejecutar ahora", which asks WispHub
nothing about the invoice before paying it:

1. Seed a business whose WispHub integration is observing (`actions_enabled`
   false — every new integration is born so, `apps/api/src/db/schema.ts:753`).
   Confirm a SPEI payment for customer X whose only open invoice is 40. The row
   lands `observation` with `wisphub_invoice_id = 40`
   (`apps/api/src/direct-payments/validation.ts:2043-2053`).
2. Between the verdict and the click, WispHub moves 40 into 41: the balance
   door lists only 41, and `GET /facturas/40/` answers
   `{"id_factura": 40, "estado": "Se Transfirio", …}` (the measured shape).
3. `POST /payments/:id/execute` → today `POST /facturas/40/registrar-pago/` is
   sent (an intercept on it proves it; nothing reads 40 first). Expected: the
   payment lands on 41, and 40 is never paid.

The same setup reproduces on the other paths in the table below: a held
payment's accept, a queue retry, "Reintentar", a store record whose deferred
attempt meets the move, and the SPEI verdict on a snapshot listing 40 —
there `mockInvoiceDetail(40, "Se Transfirio")` reads "unknown" and pays 40.

## Suspected Code Paths

The one door every path goes through (cash-at-stores D9: "the core's three
action call sites … and the store's record reach WispHub through here and
nowhere else"):

- `apps/api/src/wisphub/reconnection.ts:72-101` — `attemptReconnection`. With
  a stored invoice id it calls `registerPayment` straight away; only a null id
  is looked up (`findPendingInvoiceId`, the live list capped at five pages) or
  created (the empty vehicle, debt-truth D15). Its comment "The id we already
  stored wins" (reconnection-queue D1, pays TD-009) is the rule this bug
  amends.
- `apps/api/src/wisphub/client.ts:719-745` — `registerPayment`, the
  `registrar-pago` call. WispHub refuses a *paid* invoice with 422 (measured
  2026-08-16), which reconnection-queue D8 reads as "the money already
  landed". It *accepts* a moved one (measured 2026-10-01), so D8's safety net
  does not cover this state.
- `apps/api/src/wisphub/client.ts:619-648` — `invoiceState()`, the only fresh
  check, written by `bug: pending-invoice-cap` as a deny-list over a shape
  nobody had measured. Measured now (M1): the route answers `estado` as text —
  "Pendiente de Pago", "Pagada", "Se Transfirio" — never a number. The regexes
  read the first two right; "Se Transfirio" matches neither, so it reads
  "unknown" — and "unknown" pays. The numeric branches (`1`, `2`, `3`) match
  nothing this route returns: numbers are the *list filter's* words (M2). The
  follow-up "Verify `GET /facturas/<id>/` once" (pending-invoice-cap `fix.md`,
  *Follow-ups*) is done by this assessment. The suite's fixture for the route
  (`apps/api/test/pending-invoice-cap.test.ts:195`, fed `1`, "Pendiente",
  "Pagada") is the old guess.
- `apps/api/src/wisphub/actions.ts:28-47` — `paymentActions.attempt`, the
  adapter's boundary; passes `input.invoiceId` through unchanged.

Every path that reaches `registrar-pago`, and where its invoice comes from.
Only rows whose money has not landed get there (`paymentRegistered` false);
once it lands, later attempts only verify (reconnection-queue D8).

| # | Path | Invoice id comes from | Read before paying? | How old the id can be |
|---|------|------------------------|---------------------|-----------------------|
| 1 | SPEI verdict, inline first attempt — `validation.ts:1859-1876` → `settleConfirmed` `:2069-2080` | `debt.invoiceId`, the oldest of the list (`wisphub/debt.ts:50`) | Snapshot list: `stillPendingInvoiceId` (`validation.ts:2352-2365`) → `invoiceState` → "unknown" pays. Live list: no | Snapshot: up to one pass (about 7 min for the pilot at `SWEEP_PAGES` 10, by pending-invoice-cap's estimate of ~66 pages). Live: seconds |
| 2 | Store cash record — `routes/store/handler.ts:306` → `settleStoreRow` (`store-collections/index.ts:96,101`), deferred first attempt (cash-at-stores D25) | the oldest invoice of the live balance-door read (cash-at-stores D14) | no | seconds; minutes when `sweepUnsettledCollections` finishes a stranded row |
| 3 | "Ejecutar ahora" — `routes/payments/handler.ts:415` → `dispatchObserved` `:490` | the id the observation gate stored at the verdict (integrations-hub D5) | no | no limit — and every new integration starts in observation |
| 4 | Accepting a held payment — `reviewDecision` `:589` → `dispatchObserved` | the id the hold stored (receipt-triage D31) | no | no limit |
| 5 | Queue retries — `reconnection/queue.ts:147` | the row's stored id | no | about 5 h 21 min of waits (`:22`); 30-minute waits without limit while the key is refused or missing (`:26`, `:123`) |
| 6 | "Reintentar" on a failed row — `retryAction` (`routes/payments/handler.ts:611`) → the queue (5) | the row's stored id | no | any time after `failed` |

Not affected (measured, M2–M4): every *fresh* read sees the move correctly.
The pending list Devolada asks (`PENDING_INVOICES_PATH`, `estado=1`,
`client.ts:170`) lists only the new invoice, at the summed amount; the
balance door (`client.ts:592`, behind the store's debt and the panel's
per-customer debt, `routes/direct-payments/handler.ts:2309`) lists only the
new invoice too; and the customer record's `saldo` stays 0.00. So the debt
the payer is asked, and the invoice a fresh read picks, are right. The bug
lives only in an invoice id chosen *before* the move. A business on `/v1` is
not affected either: its mapped action is the verdict's webhook
(automated-collections-api D8), and Devolada registers nothing in a provider.

Adjacent, same stale-id family, no money moved:

- `apps/api/src/direct-payments/provisional.ts:197-211` — the payment promise
  is created on `debt.invoiceId`, which a snapshot can name after it moved.
  What WispHub does with a promise on a moved invoice is unmeasured.

## Root Cause Hypothesis

Confidence: **high** on every path. Paths 2–6 pay the stored id with no read
at all (read from the code); path 1's read answers "unknown" for the measured
"Se Transfirio", and "unknown" pays.

Devolada picks the invoice a payment will pay once — at the verdict or at the
counter — and stores it, so a retry never creates a second vehicle
(reconnection-queue D1, pays TD-009). Registration then trusts that id. The
only thing that ever made a stale id safe was WispHub itself: a paid invoice
answers 422, and D8 reads that as "already landed". That covers one way an
invoice stops being payable. It does not cover the way measured on
2026-10-01: when a customer with a pending invoice gets a new one, WispHub
moves the pending invoice into it and still accepts payments on the moved
one. `bug: pending-invoice-cap` added one fresh read, on one path, as a
deny-list over an unmeasured shape — on purpose, so a wrong guess would
degrade to the old behaviour and never break — and so it lets through every
state it does not know, the moved state among them. The window is not a few
seconds: an observation row waits for a human click, a refused key waits
without limit, and the business's billing — the moment new invoices appear —
falls on the days payments peak.

Severity **high**: money lands wrong in the business's books, silently, and
the customer is billed the moved amount again — a false debt WispHub folds
into the next invoice, and can suspend the service for. It needs a new
invoice to appear while a payment's invoice choice is stored. Not
**critical**: it is bounded to one invoice's amount per payment and the
business can correct it in WispHub. It becomes critical if M7 shows that the
monthly billing run moves pending invoices and a pilot executes observed
payments after its billing day.

## Proposed Remediation

**Preferred**: one guard in the WispHub adapter, before every registration,
that pays only an invoice WispHub says is still open — and sends the payment
to where the debt moved, exactly once.

1. **The rule, in product words.** A payment is registered only on an invoice
   the business's system says is open at that moment. If the debt moved to
   another invoice, the payment goes to the customer's oldest open invoice,
   read fresh. If nothing is open, it still lands, as a credit, on the empty
   vehicle (debt-truth D15), exactly as for a customer with nothing pending.
   The amount does not change: what arrived is what is registered
   (partial-payment D9), so on the newer invoice the new period stays owed —
   which is the truth. Measured: paying the invoice the debt moved to settles
   the account, with no false balance (*Measurements*, the cleanup row).
2. **Where.** In `attemptReconnection` (`wisphub/reconnection.ts`), right
   before `registerPayment`, for every attempt whose money has not landed. It
   is the one door all six paths pass (cash-at-stores D9), and a move is a
   WispHub fact, so it lives in the WispHub adapter (constitution IX). The
   core keeps passing "the invoice it pays" and learns no new word for it.
3. **How the invoice is read.** `invoiceState()` reads the measured labels
   (M1) as an allow-list:
   - *pending* — "Pendiente de Pago", today's `/pendiente/i` → pay it, as
     today;
   - *paid* — "Pagada", today's `/pagad/i`, kept loose on purpose → keep D8:
     send the registration and let its 422 mean "already landed". It may be
     Devolada's own earlier attempt whose answer was lost, and a paid invoice
     misread as someone else's would be re-routed and paid twice;
   - *moved* — "Se Transfirio" — and every other state it can read
     (cancelled, a 404, a label never seen) → "not payable, and not by
     Devolada's hand" (Devolada never moves, cancels or deletes an invoice),
     so the payment is re-routed;
   - a route that cannot answer at all (405, a body without `estado`) keeps
     today's behaviour and logs it — degrade, never break (constitution VIII,
     and pending-invoice-cap's "never worse than today"). See Open Questions.
4. **Re-routing.** The customer's oldest open invoice from the balance door
   (`openInvoicesOf`, cobros-in-links D10: one call for that one customer, no
   date window — the read the store's debt already uses), the stored id left
   out. Measured (M3): the door lists only open invoices, the moved one
   excluded, so its oldest is where the debt is. None open → the empty
   vehicle.
5. **At most once.** The new invoice is written on the payment row *before*
   any money is registered on it. Recommended shape: the attempt that finds
   the invoice moved registers nothing and answers `queued` with the new id.
   Every caller already writes `attempt.invoiceId` (`firstOutcome` in
   `validation.ts`, `dispatchObserved`, the queue's writes), and the next
   attempt — one minute later, the queue's first wait — finds it pending and
   pays it. A retry after a lost answer then meets that same invoice, now
   paid, and D8's 422 keeps its meaning. This rests on M5, measured: WispHub
   never moves a paid invoice, so a moved invoice is never one Devolada
   already paid. It costs one attempt and one minute, only when an invoice
   moved.
6. **Ready to build.** M1, M3 and M5 are measured. M7 changes how often the
   bug fires, not the fix.

`stillPendingInvoiceId` (`validation.ts:2352`) keeps what the adapter's rule
leaves to D8 — an invoice someone else paid meanwhile, on the verdict's first
attempt — and stops skipping a *moved* invoice, leaving it to the adapter.
Otherwise the snapshot, which predates the newer invoice, would send the
verdict to the vehicle instead of to the invoice the debt moved to. It is core
code reading the provider (registered debt `core-reads-provider-directly`);
this fix adds no new core read.

**Alternatives**:

- *Follow the move to the invoice WispHub names.* No field names it (M1); only
  the moved invoice's line text does ("Factura Transferida a la Factura #47"),
  so this would parse es-MX free text, and when the named invoice was paid
  meanwhile the 422 swallows the SPEI money (D8 reads it as landed). Not
  needed: the balance door already says where the debt is (M3).
- *Hold the payment for the business* (a `review`-style hold) when its invoice
  moved. Safe for the money, but a move is routine on billing day — the busiest
  day for payments — so the business would be flooded with holds about the
  provider's own bookkeeping. Rejected.
- *Teach only the verdict the moved label* (one line in `invoiceState`).
  Protects path 1 only; "Ejecutar ahora" — the path every new business takes
  while it observes — the store, the queue and "Reintentar" keep paying blind.
  A stop-gap at most.
- *Re-decide the amount against the newer invoice.* Rejected:
  partial-payment D9 fixes the registered amount at the verdict ("not a debt
  that moved meanwhile").

**Files likely to change**:

- `apps/api/src/wisphub/client.ts` — `invoiceState()`: the measured labels as
  an allow-list, with a moved state; the comment says "measured 2026-10-01".
  The numeric branches match nothing the route returns (M1): keep or drop.
- `apps/api/src/wisphub/reconnection.ts` — the guard and the re-routing
  before `registerPayment`; the D1 and D8 comments amended.
- `apps/api/src/direct-payments/validation.ts` — `stillPendingInvoiceId`
  leaves a moved invoice to the adapter.
- `apps/api/src/integrations/capabilities.ts`, `apps/api/src/wisphub/actions.ts`
  — only if the row needs a core word for "waiting because the invoice moved"
  (`ActionAttempt.error`); otherwise unchanged.
- `apps/api/test/transferred-invoice-paid.test.ts` (new).
- `apps/api/test/pending-invoice-cap.test.ts` — `mockInvoiceDetail` moves to
  the measured labels ("Pendiente de Pago", "Pagada").

**Tests to add or update** (each cites `bug: transferred-invoice-paid`;
fixtures use the measured labels):

- "Ejecutar ahora" on an observation row stored with 40, after 40 moved into
  41 (`estado` "Se Transfirio"; the balance door lists 41): no
  `registrar-pago` on 40, ever (no intercept for it,
  `assertNoPendingInterceptors`); the row is `queued` with
  `wisphub_invoice_id` 41; the next sweep registers on 41 with the same
  `total_cobrado` and `accion`.
- The same for a held payment's accept, a queue retry after a first attempt
  that failed before registering (503), "Reintentar" on a failed row, a store
  record whose deferred first attempt meets the move, and the SPEI verdict on
  a snapshot listing 40.
- At most once: once 41 is written, a retry whose `registrar-pago` on 41
  answers 422 ends as landed (D8) and creates no vehicle.
- Nothing open after the move (41 paid at the counter meanwhile, the door
  empty): the empty vehicle carries the payment, never 40.
- Unchanged behaviour: a stored invoice that reads "Pendiente de Pago" is paid
  directly, with one extra GET; one that reads "Pagada" keeps D8's 422
  reading, so a lost answer never pays twice.
- The detail route not served (405): whatever the creator decides below,
  pinned by a test.

## Measurements (2026-10-01, demo tenant)

Run in session on `https://api.wisphub.net/api` with the demo key (cajero id
6073027, as in the creator's probe); never `api.wisphub.io` or a pilot's key.
$1 invoices built with the adapter's own `createInvoice` body; every payment
with `accion: 0` and `forma_pago` 12752 "Cash" (the adapter's own pick).
Invoices #46/#47 on `joflores@wifiplus` (id_servicio 8), #48/#49 on
`mcolunga@wifiplus` (id_servicio 7): both had no phone or email and no open
invoice before, and both ended "Pagadas" with `saldo` 0.00. `greyes@wifiplus`
was only read; the false $1.00 from the creator's probe is still on it.

| # | Question | Answer |
|---|----------|--------|
| M1 | What `GET /facturas/{id}/` says for each state | `estado` is text, never a number: "Pendiente de Pago" (#46 before the move), "Pagada" (#40, #41), "Se Transfirio" (#46 after #47 was created). No field names the invoice it moved to: the moved invoice's line text gains "\n - Factura Transferida a la Factura #47", and the new invoice gains a line "FACTURA TRANSFERIDA #46 …" priced at the moved amount (#47: `total` 2.0). Today's `invoiceState()` reads "Se Transfirio" as "unknown" and pays it. |
| M2 | The lists | `estado=1` lists #47 ($2) and not #46; `estado=5` lists #46 as "Se Transfirio"; `estado=2` is "Pagada". The filter takes numbers; the rows carry the same text as the detail route. |
| M3 | The balance door | `/clientes/8/saldo/` lists only #47 ($2), `saldo` 2.0; #46 is not listed. |
| M4 | The customer record | "Pendiente de Pago", `saldo` 0.00. Devolada's debt after the move: $2, on #47 — right. |
| — | Paying the new invoice | #47 paid $2: #47 "Pagada", #46 stays "Se Transfirio", the customer "Pagadas" with `saldo` 0.00 and an empty balance door. Paying the invoice the debt moved to settles the account. |
| M5 | Is a paid invoice ever moved? | No. #48 paid, then #49 created: #48 stays "Pagada" with no moved line; #49 is a plain $1 invoice. |
| M6 | `registrar-pago` on a cancelled invoice | Not measured (optional). |
| M7 | Does a zone's billing run move a pending invoice? | Not measured: it needs a billing run. |

Incidental, not this bug: a `fecha_pago` sent as "2026-10-01 23:02" — Mexico
City's wall clock, as the adapter writes it — was stored as
"2026-10-01T23:02:00-05:00". The demo tenant runs at UTC−5, an hour from
America/Mexico_City (UTC−6). `bug: wisphub-payment-utc-time` assumes the
tenant runs in the business's saved timezone, so this tenant's payments land
an hour early unless its business is saved at UTC−5.

## Risks & Considerations

- **At most once** (reconnection-queue D8) is the hard constraint. A re-route
  that is not written before it is paid can pay twice after a lost answer — a
  5 s timeout whose request did land, or a Worker that dies between the
  registration and the write (the risk cash-at-stores T072 names for the
  store).
- **The labels are provider text, not codes.** A WispHub release could reword
  them. A reworded *pending* label would send every payment through the
  re-route — a minute late, never wrong money. A reworded *paid* label must
  never fall into "re-route", which is why *paid* keeps today's loose match.
- **Cost.** One extra GET per registration (about 0.5 s when healthy, inside
  provider-latency D1's 12 s budget). A move adds a balance-door read and one
  minute.
- **Paid meanwhile stays as it is.** The guard keeps D8's reading of a paid
  invoice, so on paths 2–6 an invoice the customer paid at the counter
  meanwhile still swallows the SPEI payment as "already landed"
  (`bug: pending-invoice-cap` closed that for path 1 only). Closing it needs a
  first-attempt signal the adapter does not have today — a separate decision.
- **The newer invoice also bills the new period.** Registering the old amount
  there leaves the new period owed, which is correct. The reconnection was
  decided at the verdict against the old debt and stays the business's
  threshold decision (partial-payment D9, integrations-hub D3); unchanged
  here.
- **The empty vehicle is not always empty.** Creating an invoice for a
  customer who still has a pending one moves that one into it — the
  mechanism measured above. It happens only when a capped read missed the
  open invoice. It does not count anything twice, but debt-truth D15's
  comment ("the vehicle is empty on purpose") should say so.
- **Payment promises** (`provisional.ts:197-211`) can land on a moved invoice
  named by a snapshot. No money moves; WispHub's behaviour there is
  unmeasured.
- **Repair.** Payments already registered on moved invoices left false debts
  in businesses' WispHub. Devolada's tables cannot tell which (a move is never
  recorded); a read-only pass over the registered invoice ids, with each
  business's key, could: a moved-then-paid invoice keeps its "Factura
  Transferida a la Factura #N" line text (#40).
- `/v1` businesses and any business without WispHub are unaffected.

## Open Questions

- [NEEDS CLARIFICATION: M7] Does a zone's monthly billing run move a pending
  invoice the way an invoice created through the API does? The 2026-09-23
  billing-run measurement (debt-truth D7) saw a carried balance folded into
  the new invoice; a pending invoice was not part of that case. This decides
  how often the bug fires — every billing day, or only when someone creates
  an invoice by hand.
- **Decision**: when WispHub cannot say (the detail route not served on some
  installation), pay the stored invoice as today and log it, or wait and end
  `failed` with a visible reason? Recommended: as today. Waiting would stop
  every registration on such an installation, and this guard exists to remove
  a rare wrong registration, not to add a common missing one.
- **Decision**: check the pilot for payments already registered on moved
  invoices? A read-only pass over its registered invoice ids, with its key,
  answers it.
- M6 (optional): does `registrar-pago` accept a cancelled invoice? The fix
  does not depend on it — a cancelled invoice is re-routed either way.
