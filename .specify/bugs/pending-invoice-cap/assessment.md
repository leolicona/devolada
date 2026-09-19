# Bug Assessment: a customer beyond the first 500 pending invoices is told they owe nothing — or asked the plan's price

- **Slug**: pending-invoice-cap
- **Created**: 2026-09-19
- **Source**: pasted text (product creator, in session). No URL supplied, so
  the URL Trust Policy did not apply and nothing was fetched. The report grew
  out of the same day's `/links` investigation, which measured the real ISP
  at 6,509 customers on `api.wisphub.io` and found the roster's 1,000-row cap
  hit exactly (`{complete: false, panel: 1000}`).
- **Verdict**: valid
- **Severity**: critical

## Report (verbatim or summarized)

> "When a customer's invoice falls outside the first 500 read, the pay page
> asks the plan's list price instead of the real debt"

The report names the symptom the submission shows. The code shows an earlier
and worse one on the page itself: the payer is told they are paid up.

## Symptom

`WispHub.pendingInvoices()` reads the tenant's pending invoices (180-day window
by issue date) five pages of 100 at a time and stops there, answering
`complete: false` when a sixth page exists. A customer whose invoice sits beyond
row 500, and who carries no `saldo`, computes to a debt of **zero**
(`debtOf` filters the truncated list and has no `complete` input). From there:

1. **The payer's page** (`GET /direct-payments/links/:token`) answers
   `no_debt` — the page paints the green *"Tu servicio está al corriente. No
   tienes pagos pendientes."* with no CLABE. A customer who owes money — very
   likely a suspended one, the product's core case (debt-truth D3) — cannot pay
   through their link at all.
2. **The submission** (`POST …/pay`), if reached, answers `NOTHING_DUE` unless
   WispHub's label says the customer owes; when it does, the ask becomes
   `precio_plan` — the plan's list price, not the invoice (prorations, discounts
   and reconnection charges live only on the invoice, debt-truth D8).
3. **The verdict** (validation sweep) re-reads the same capped list. With the
   invoice out of view the yardstick becomes the plan price: `settle()` decides
   `confirmed`/`partial`, the reconnection threshold and the missing amount
   against a guess; `classifyPayment()` picks the class (`exact`/`under`/`over`)
   and therefore the mapped action against the same guess. Registration then
   finds no invoice id, **creates a zero-total "Adeudo anterior" invoice in
   WispHub and registers the payment on it**, while the customer's real invoice
   stays pending on WispHub's side.
4. **Provisional release** is silently skipped (no invoice id to promise on),
   and the expiry notice to the ISP is suppressed (debt reads as zero).

Expected: the debt the page shows, the submission asks and the verdict settles
is the customer's real pending invoices plus the carried balance (debt-truth
D7), whatever the tenant's size — and a truncated read is never treated as
"owes nothing" (debt-truth D4, the rule the adapter's comment states).

**Scale.** A 6,509-customer ISP issues on the order of 6,500 invoices a month;
the pending set inside a 180-day window exceeds 500 for most of any month,
and suspended customers keep several months open. Which 500 are visible is
WispHub's list order, not Devolada's choice, so from the ISP's side the affected
customers look random. The roster cap was measured hit on 2026-09-18; the
pending-invoice count on this ISP is not yet measured (see Open Questions) —
the creator asked to proceed on the main bug without waiting for it.

## Reproduction

Deterministic with the test suite's mocked provider (`fetchMock` at
`WISPHUB_ORIGIN`), the same shape `payment-requests.test.ts` scenario 6 already
uses to prove `complete: false`:

1. Seed a business with a WispHub key. Customer `usuario` X answers from
   `/clientes/` with `saldo: "0.00"`, `estado_facturas: "Pendiente de Pago"`,
   `precio_plan: "499.00"`.
2. Mock `/facturas/?estado=1&tipo_fecha=fecha_emision&desde=…&hasta=…&limit=100`
   to answer five pages of 100 rows with a `next` on the fifth, none of the
   rows for X (X's invoice — say 350.00 — would be on page six).
3. `GET /direct-payments/links/<X's token>` → `status: "no_debt"`.
   Expected: X's 350.00 debt, or at the very least not a green "al corriente".
4. `POST /direct-payments/links/<X's token>/pay` with a transfer →
   `201` and an ask of `499.00 + fee`. Expected: `350.00 + fee`.
5. Run the direct-payment sweep with a CEP for 350.00 → `settle()` sees a
   149.00 shortfall against 499.00 (`partial`, reconnection decided against
   the wrong total); WispHub receives `POST /facturas/` (a 0.00 "Adeudo
   anterior") and `registrar-pago` on that new id. Expected: `confirmed`,
   registered on X's real `id_factura`, no invoice created.

Live: any customer of the 6,509-customer ISP whose invoice is not among the
first 500 — open their link.
[NEEDS CLARIFICATION: the real pending count, one read with the ISP's key —
listed under Open Questions.]

## Suspected Code Paths

- `apps/api/src/wisphub/client.ts:297-340` — `pendingInvoices()`: five pages
  of 100, `complete: path === null`. Sized for the pilot on 2026-08-16
  (commit 4c13668, "Pending invoices are the truth about debt").
- `apps/api/src/wisphub/client.ts:290-291` — the reason every caller reads the
  whole tenant: the list endpoint has no customer filter (re-verified live
  2026-08-16).
- `apps/api/src/wisphub/client.ts:345-349` — `findPendingInvoiceId()` walks the
  same capped list; the reconnection's "reuse before creating" (D1, pays
  TD-009) therefore cannot find an invoice beyond row 500.
- `apps/api/src/wisphub/debt.ts:29-57` — `debtOf()` filters
  `pending.invoices` by usuario; `pending.complete` never enters the sum.
- `apps/api/src/wisphub/debt.ts:64-72` — `billingStatusOf()` is the D4/D14
  fallback in code form ("the label is only consulted when the list was cut
  off…"). **Nothing calls it.** The rule exists and is not applied.
- `apps/api/src/routes/direct-payments/handler.ts:281` — the page GET:
  `if (debt.totalCents === 0 || !customer)` → `no_debt`, without consulting
  `pending.complete`. This is the false green.
- `apps/api/src/routes/direct-payments/handler.ts:471-491` — the POST reads
  fresh (provider-latency D3), gates `NOTHING_DUE` on `complete`, then
  `debtUnknown ? customer.planPriceCents : debt.totalCents` — the plan-price
  guess.
- `apps/api/src/direct-payments/validation.ts:805-845` — the verdict re-read;
  `provenSettled` at 818; `ispDebtCents = debt.totalCents ||
  customer.planPriceCents` at 845.
- `apps/api/src/direct-payments/validation.ts:852-884` — `settle()` and
  `classifyPayment()` run against that ask; `:928-934` hands
  `invoiceId: debt.invoiceId` (null) to the reconnection.
- `apps/api/src/wisphub/reconnection.ts:68-88` — null id →
  `findPendingInvoiceId` (same cap) → `createInvoice(usuario, 0, date,
  "Adeudo anterior")` → `registerPayment` on the vehicle.
- `apps/api/src/direct-payments/provisional.ts:189,196` — release skipped on a
  missing invoice id; the same plan-price fallback at 196.
- `apps/api/src/direct-payments/provisional.ts:242` — expiry notice suppressed
  on a zero debt.
- `apps/api/src/wisphub/cache.ts:138-152` — the 30 s display cache stores the
  truncated answer as-is (the page GET and Cobros read through it).
- `apps/api/src/routes/payment-requests/handler.ts:38,87` and
  `apps/admin/src/features/cobros/CobrosScreen.tsx:289-295` — display only;
  the banner is truthful. Not part of the money bug, inherits any fix.

Existing tests never exercise the gap: `direct-payment.test.ts` mocks
`mockPendingInvoices([])` (one page, `complete: true`) for both the `no_debt`
page (line 316) and `NOTHING_DUE` (line 532). Only
`payment-requests.test.ts:110` builds a five-page answer, and only to assert the
flag on the Cobros read.

## Root Cause Hypothesis

Confidence: **high** — the behaviour is read straight from the code and the
trigger (a tenant with more than 500 pending invoices) is established by the
measured 6,509-customer ISP.

The cap was a pilot-scale budget: reading the whole tenant's pending list inside
one request, five pages deep, and handing the truncation to callers as a flag.
That contract failed at scale in two places. First, the page GET never honours
the flag — a zero from a cut-off list becomes `no_debt`; the fallback D4/D14
designed for exactly this case was written (`billingStatusOf`) and never wired.
Second, where callers do honour it (the submission, the verdict, the
provisional release), the fallback is the plan's list price — a stand-in that
was acceptable while the cap was rarely reached and is simply the wrong number
as a steady state, with every downstream decision (status, class, action,
reconnection, registration) inheriting it. Underneath both sits the real
constraint: WispHub's invoice list cannot be filtered by customer, so a
per-customer question costs a whole-tenant read, and at 6,500 customers that read
is 30–40 s (66 pages, measured 2026-09-18 on the customer list; the invoice
list pays the same per-page cost) — out of reach of any request budget, so no
cap raise fixes it.

## Proposed Remediation

**Preferred**: stop answering the debt question from an in-request read. Keep a
per-tenant **pending-invoice snapshot** in D1, walked by the every-minute cron —
it joins the existing trigger ("sweeps ride one trigger", `apps/api/src/index.ts`),
reads a few pages per sweep, resumes from `next`, and swaps in a new snapshot
only when a full pass completes, so a provider failure mid-pass never replaces a
good list with a partial one. The debt paths (`debtOf` and its four callers) read
the snapshot plus the **fresh** customer record (`saldo`, `estado_facturas`,
`precio_plan` — one call, never truncated). Before the verdict registers money,
it re-reads the chosen invoice fresh (`GET /facturas/<id>/`, to verify — see
Open Questions) so a stale id cannot turn a real SPEI payment into the
"already paid, 422 is the goal state" branch of reconnection D8 and go
unregistered. `complete` keeps its meaning: until the first full pass, the
snapshot reports incomplete, and the page must not paint green — it shows a
neutral "no pudimos confirmar tu saldo, intenta en unos minutos" state (product
decision, see Open Questions). The roster feature for `/links` needs the same
sweep; this fix should build it and the roster should ride it.

This amends two decisions and the fix must say so in their comments:
provider-latency **D3** ("money paths read the adapter fresh") becomes
"snapshot + fresh customer record + fresh invoice detail before registering",
and debt-truth **D4** loses the plan-price fallback on the money path.

**Interim, independently shippable** (stops the false green today, does not fix
the amount): make the page GET honour `complete` the way the POST does — when the
list is truncated, the customer is not in it and nothing is carried, answer
either the D4 fallback (label says due → plan price, truncation stated on the
page) or the neutral state above; wire `billingStatusOf` in or delete it.

**Alternatives**:
- *Verify a customer filter first.* The 2026-08-16 note records that the list
  has no customer filter but not which parameter names were tried. One read per
  name with the ISP's key (`cliente=`, `usuario=`, `id_servicio=`, `search=`)
  settles it. If any works, the whole bug collapses into a per-customer read on
  every debt path and no snapshot is needed. Cheapest thing to try; do it before
  planning the sweep.
- *Raise the cap for the verdict only.* The verdict runs in the cron, where a
  full walk is affordable; the page GET and the POST are not, so the page would
  keep disagreeing with the verdict, and every verdict would cost tens of calls.
  Rejected.
- *Narrow the 180-day window.* Loses debt-truth D3's core case, the suspended
  customer with months-old invoices. Rejected.

**Files likely to change**:
- `apps/api/src/wisphub/client.ts` — walk resumable from a cursor; invoice detail read
- `apps/api/src/wisphub/pending-sweep.ts` (new) — the per-tenant sweep
- `apps/api/src/db/schema.ts` + a migration — the snapshot table (business, base URL, cursor, rows, `readAt`, `complete`)
- `apps/api/src/index.ts` — join the trigger
- `apps/api/src/wisphub/debt.ts` — `debtOf` over the snapshot; `billingStatusOf` wired or removed
- `apps/api/src/routes/direct-payments/handler.ts` — GET and POST
- `apps/api/src/direct-payments/validation.ts` — verdict read; fresh invoice check before registering
- `apps/api/src/direct-payments/provisional.ts` — release and expiry read
- `apps/api/src/wisphub/reconnection.ts` — `findPendingInvoiceId` from the snapshot
- `apps/api/src/wisphub/cache.ts` — display reads the snapshot; the 30 s cache becomes redundant for invoices
- `apps/api/src/routes/payment-requests/handler.ts` — Cobros from the snapshot
- `apps/api/src/routes/direct-payments/schema.ts`, `apps/pago/src/features/pago/PaymentPage.tsx` — only if the neutral page state is chosen
- `apps/api/test/direct-payment.test.ts`, `apps/api/test/payment-requests.test.ts`, `apps/api/test/reconnection-queue.test.ts`, `apps/api/test/pending-sweep.test.ts` (new)

**Tests to add or update** (every one cites `bug: pending-invoice-cap`):
- Page GET: five full pages with a `next`, the customer absent, `saldo` 0,
  label due → never `no_debt`; with the snapshot complete → the real invoice.
- POST: same setup → the ask is the customer's invoice total, not `precio_plan`.
- Verdict: same setup with a CEP for the real amount → `confirmed`, class
  `exact`, `registrar-pago` on the real `id_factura`, **no** `POST /facturas/`.
- Reconnection: `findPendingInvoiceId` finds an invoice that sits beyond row 500.
- Sweep: resumes from `next` across sweeps; `complete` flips only after a full
  pass; a 500 mid-pass keeps the previous complete snapshot; rows dedupe by
  `id_factura`.
- Registration guard: a snapshot id whose fresh detail read says paid is not
  registered against, and the 422 branch is not reached blind.
- Cobros: 600 pending invoices answer `complete: true` and 600 rows.

## Risks & Considerations

- **Money**: the yardstick moves from a fresh in-request read to a snapshot
  minutes old plus fresh customer data. The fresh invoice check before
  registering is what keeps a real payment from being swallowed by the 422
  branch (reconnection D8); without it the change is unsafe.
- **Decisions amended**: provider-latency D3, debt-truth D4 (and D1/D5 wording
  in `cache.ts`). The constitution tolerates no silent gap — record them.
- **Provider load**: a full pass per tenant every ~7–10 min at 6,500 customers
  (≈10 calls/min per tenant); WispHub's rate limits are unknown; the sweep must
  page per tenant and stay inside the Worker's budget as tenants grow.
- **Ordering**: the cursor is an offset; if WispHub's list order shifts within
  a pass, rows can be missed or seen twice — dedupe by `id_factura`; a stable
  `ordering` parameter, if WispHub honours one, removes the risk (verify).
- **Storage**: ~6,500 small rows per tenant rewritten every pass; keep to id,
  usuario, total, dates; write in chunks under D1's parameter cap
  (direct-payments-links US-D07 already does this for links).
- **Installations** (feature 007): key the snapshot by business + base URL,
  as the cache is.
- **Copy**: any new page state is es-MX product copy and must pass
  `pending-lint`; status stays icon + text.
- **Observability**: the sweep speaks only when it did something; expose
  `readAt`/`complete` to the pages as the cache does today.

## Open Questions

- [NEEDS CLARIFICATION: the ISP's real pending count and list order — one read
  with the key, HTTPS to WispHub only:
  `…/facturas/?estado=1&tipo_fecha=fecha_emision&desde=<180 days ago>&hasta=<tomorrow>&limit=1`
  → `count`, plus `fecha_emision`/`id_factura` of the first row and of the row
  at `offset=count-1`.]
- [NEEDS CLARIFICATION: does any per-customer filter on `/facturas/` work
  (`cliente=`, `usuario=`, `id_servicio=`, `search=`)? A yes collapses the fix.]
- [NEEDS CLARIFICATION: does `GET /facturas/<id>/` exist? Needed for the fresh
  check before registering.]
- Product: what the payer's page says while the snapshot is incomplete — the
  plan price with a note, or the neutral "no pudimos confirmar tu saldo" state
  with no CLABE. Recommendation: the neutral state; a wrong amount on the page
  is what this bug is about.
- Product: the acceptable age of the debt on the money path (≈7–10 min at
  6,500 customers, growing with the ISP).
- Sequencing with the `/links` roster (1,000-customer cap, same mechanism):
  recommendation — this fix builds the sweep, the roster feature rides it.
