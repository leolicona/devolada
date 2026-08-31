---
status: in-development
stories: [US-P06]
domain: polish
updated: 2026-08-18
debt: [TD-014]
---

# Spec: A slow WispHub never becomes a slow app

> **2026-08-31, retirement PR**: scenarios 3–5, 8–9 and 11 drove the store charge path and retired with it (`devolada-red`); the adapter deadlines, the display cache and the per-tenant payment-method cache stay in force, tested at the adapter/cache level, and the spei channel asserts its own provider-failure behavior in direct-payment tests.

The three apps got slow, and none of the slowness was ours. WispHub stalls on a fraction of its calls and never recovers from those stalls; our adapter had no deadline, so a stall in the provider became a hang in the product. Every screen that reads a customer waits on WispHub, so every screen inherited it.

This spec puts a deadline on every provider call, stops making those calls one after another when they do not depend on each other, and lets the reads that only *display* debt share one fetch — while the reads that *decide* money keep asking WispHub fresh, exactly as `charges/debt-truth.spec.md` requires.

**How it was found (2026-08-18, measured, not guessed).** The owner reported that admin, tienda and pago were all slow since the last deploy. Measurement separated the layers:

- **Cloudflare is not it.** Repeated timings of the deployed dev surfaces: the three asset Workers 150–350 ms TTFB, `api/health` 160–200 ms, a public D1-reading endpoint 160–320 ms, `auth/get-session` (Better Auth + D1) 150–260 ms. The edge, the bundles and D1 are all healthy. The three apps are assets-only Workers (`apps/*/wrangler.jsonc`); the only moving part they share is the API.
- **WispHub is it.** Against the live demo tenant with the real key: **about one call in eight stalls past 8 s** and does not recover — observed hangs at 8 s, 30 s and 60 s cutoffs. Healthy calls take 0.4–0.6 s. It is not one endpoint: `/clientes/`, `/facturas/` and `/formas-de-pago/` all did it.
- **Our code turned a stall into a hang.** `WispHub.request` called `fetch` with no `AbortSignal` — grep found no timeout anywhere in `apps/api`. A stalled provider call held the request open for as long as the platform allowed.
- **Recent work multiplied the exposure.** `debt-truth.spec.md` (2026-08-16, US-C06) added a `pendingInvoices()` fetch to search, quote *and* record — correctly, it is the fix for a real double-charge defect — but it doubled the provider calls on the two most frequent screens. Counting sequential calls per action before this spec: search 2, quote 2, **record charge 6–7**, pago page load 2. At one-in-eight stall odds, recording a charge had better than even odds of hitting one.

The provider is not ours to fix. What is ours is the arithmetic: how many calls we make, whether we make them at the same time, and how long we are willing to wait.

## Decisions

- **D1 — Every provider call has a deadline, and every operation has a budget.** Two ceilings, because one is not enough. Each call gets **5 s**: measured healthy calls finish in 0.4–0.6 s, so 5 s is roughly ten times the observed worst healthy case and cuts off nothing real — and stalls were measured never to recover, so waiting longer buys nothing. Each `WispHub` instance also carries a **12 s total budget**, because one operation makes several calls and five separate 5 s ceilings is a 25 s wait. When the budget is spent the remaining calls fail immediately instead of starting. *Discarded: a per-call timeout alone* — it bounds the call and not the screen, which is what the user actually waits on. *Discarded: retrying a timed-out call* — a stall that never recovers is not a transient to retry through, and the charge path already has a real retry mechanism in the reconnection queue.
  **Consta gets one too, at 30 s** (added 2026-08-18, direct-payment spec D7): it was the last provider call in the API without a deadline, and the receipt-door spike found it holding a request open for over five minutes. The number cannot follow the "ten times healthy" rule used here, because a healthy validation is genuinely slow — OCR plus a Banxico lookup measured 13.5–14.6 s — so 30 s is roughly twice the measured worst case. Cutting off early is cheap on that path: a deadline is a retryable failure, so the payment stays `validating` and rides its own D7 schedule.

  The budget is per instance, and every instance is already constructed per operation — including inside both sweep loops, which build one per charge and per payment. So "per instance" and "per operation" are the same thing, and the sweeps do not starve their later rows.

- **D2 — Provider calls that do not depend on each other are made together.** The customer lookup and the pending-invoice list are independent reads; so are the auto-activate opt-in and the payment-method lookup. They now run together in the quote, the charge, the pago page load, the payment submission, the re-validation, and the reconnection attempt. This halves the wall clock of every one of those paths and does not change a single outcome — the results are combined by the same code as before. *Discarded: parallelising the search handler too* — its pending fetch is deliberately conditional on there being results, and D3 removes the cost of that call in the common case anyway.

  **The race is concurrent; the precedence is not.** The quote and the charge used to return 404 `CUSTOMER_NOT_FOUND` before the pending fetch ever happened, so a plain `Promise.all` would have reported a provider outage instead whenever both went wrong at once — a customer who does not exist would read as "WispHub is down". Both read their two answers through one helper (`customerAndPending`) that settles both and then reads them in the old order: the lookup's failure first, then "no such customer", then the list's failure. Found while writing the tests, which is where a lost 404 shows up.

- **D3 — The tenant's pending-invoice list is cached for 30 s, and only display may read it.** This is the decision that has to be exactly right, because a stale answer to "does this customer owe" is the defect `debt-truth.spec.md` exists to prevent. So the split is by *what the answer is used for*, not by convenience:

  | Call site | Reads | Why |
  |---|---|---|
  | `searchCustomers` (handler) | **cache** | marks result rows; the guard runs later |
  | `getCustomerQuote` | **cache** | renders the confirm screen; the guard runs later |
  | `getLinkStatus` (pago page) | **cache** | renders the page; submission re-reads |
  | `recordCharge` | **fresh** | decides 409 `NOTHING_DUE` — debt-truth D5 |
  | `submitPayment` | **fresh** | decides the amount the CEP must match — direct-payment D11/D15 |
  | `runValidation` (sweep) | **fresh** | decides whether to register money in WispHub — direct-payment D14 |

  Every path that can take money reads WispHub fresh. Nothing that decides money reads a cache. Display can be 30 s stale; it was always a snapshot, and the screen the customer looks at while they walk to the counter has never been live. *Discarded: caching in the adapter* — it would make the freshness rule invisible at the call site, and the call site is exactly where the rule has to be readable. *Discarded: no cache at all* — search is the most frequent screen in the product and it was paying for a tenant-wide invoice fetch on every debounced keystroke.

  The cache lives in the isolate, keyed by ISP id, and holds only successful responses. *Discarded: the Cache API* — it would be shared across an entire colo instead of one isolate, which is better, but it is a second failure surface for a 30 s window; if measurement later shows the isolate hit rate is poor, TD-014 is where that gets revisited.

- **D4 — A charge invalidates its tenant's cached list, immediately.** Without this, D3 would break a behaviour `debt-truth.spec.md` already verified against the live tenant: charge a customer, search again at once, and the app says *"al corriente"*. A 30 s cache would keep answering *"debe"* for half a minute after the money was taken — the exact confusion the owner reproduced before US-C06. So `recordCharge` and a confirmed `runValidation` both drop the tenant's entry the moment a charge exists. A cache that outlives the fact it caches is not a cache, it is a bug with a TTL.

- **D5 — The cash payment-method id is cached for 10 minutes.** `getCashPaymentMethodId` is a catalog lookup — WispHub's list of payment methods, unchanged for the life of a tenant — and it sat in the middle of the charge path costing a full provider round trip on every single charge. It carries no debt information, so D3's rule does not apply to it. Ten minutes, not forever: an ISP that adds a cash method should not have to wait for an isolate to recycle.

- **D6 — A deadline is an outage, not a rejection.** A timed-out or budget-exhausted call raises the existing `WISPHUB_UNAVAILABLE`, so every caller already knows what to do and no wire shape changes: before a charge is recorded it is a 503 with nothing written (debt-truth's contract), and after a charge is recorded it leaves the reconnection `queued` for the sweep to retry (US-C04). No new error code reaches any frontend. *Discarded: a distinct `WISPHUB_TIMEOUT` code* — it would be a new state for three frontends to handle and it answers a question only our logs ask. The logs get the distinction; the wire does not.

- **D7 — The charge path honours `WISPHUB_BASE_URL` like every other path.** `storeContext` and the settings validator constructed `new WispHub(key)` without the configured base, so the two most-used surfaces silently ignored the variable that the queue, the direct-payment routes and the test pin all respect. It never broke production, where the default is the real API, but it made the charge path the one surface that could not be pointed at a sandbox — and a variable that is honoured in four places and ignored in two is a trap for whoever reads it next. Fixed here because this spec is what made the inconsistency visible.

## Contract

No wire-shape changes anywhere. No new error codes, no new fields, no schema change, no new binding. Every behaviour in this spec is invisible to the three frontends except as latency — which is the point.

The one behavioural change a reader must not miss: `billingStatus` on **search results and the quote** may be up to 30 s old (D3). It could always be stale by the length of the round trip; the window is now bounded and named instead of accidental. The guard that refuses a charge (`POST /charges` → 409 `NOTHING_DUE`) and the guard that decides a SPEI amount are unchanged and still read WispHub fresh, so `debt-truth.spec.md` D1 and D5 hold exactly as written.

## Scenarios

1. A provider call that never answers raises `WISPHUB_UNAVAILABLE` at the deadline instead of hanging (D1)
2. An operation whose budget is already spent fails its next call immediately, without opening a connection (D1)
3. A pre-charge provider timeout answers 503 and records nothing — no charge, no ledger rows (D6, debt-truth contract)
4. A provider timeout *during* the reconnection leaves the charge recorded and `queued`, never lost (D6, US-C04)
5. A customer WispHub does not have is still a 404, even when the pending fetch fails in the same breath (D2's precedence rule)
6. Two display reads for the same ISP inside the window make **one** pending-invoice fetch; a third, past the window, fetches again (D3)
7. Two different ISPs never share a cached pending list (D3)
8. A search after a recorded charge sees the new truth immediately — no 30 s of stale "debe" (D4)
9. The second charge in a row still reads WispHub fresh and still answers 409 `NOTHING_DUE` (D3 guard rule, debt-truth D5 unchanged)
10. A failed pending-invoice fetch is not cached: the next call retries the provider (D3)
11. Two charges in a row make **one** payment-method lookup, and a second tenant still asks for its own (D5)
12. The adapter calls the base URL it was given, not the hardcoded default (D7)

## Definition of Done

- [x] Scenarios 1–12 automated in the API layer (`provider-latency.test.ts`, 13 tests)
- [x] `pnpm -r --if-present test` green — 270 tests across the workspace
- [ ] Deployed check on dev with the live tenant: the charge path's provider call count drops as specified, and a stalled provider surfaces as a 503 within the budget instead of a hang

**What the tests could not assert, and why.** Two honest gaps, recorded rather than papered over:

- **Scenario 12 is adapter-level only.** The route half — `storeContext` passing `c.env.WISPHUB_BASE_URL` — cannot be asserted in this suite, because TESTING.md rule 8 pins `WISPHUB_BASE_URL` to the mocked origin, which is also the adapter's default. Configured and default are the same string here by design, so no test can tell them apart. The pin is worth more than the assertion.
- **Concurrency itself is structural, not asserted.** Scenario 5 proves the property that D2 could have broken (the 404 precedence), not that the two calls overlap in time. A timing assertion would measure the machine rather than the code — and `Date.now()` inside workerd only advances on I/O, so it would measure it badly.

**What existing tests had to change, and what did not.** No existing assertion changed: every status code, row count and payload the suite checked before, it checks now. What changed is the mocks in two files — `charge-search.test.ts` and `customer-phone.test.ts` register one WispHub interceptor per expected provider call, and D3 and D5 mean some of those calls no longer happen. Three tests that made two searches or several charges dropped the mocks for the calls the caches now serve, each with a comment naming the decision. `assertNoPendingInterceptors` is what makes this visible, and it is worth keeping exactly for that: the suite notices when the provider call count changes.
