# Bug Assessment: Cobros binds 101 parameters once 99 debtors have links — D1 refuses, the screen says "No pudimos cargar"

- **Slug**: cobros-links-lookup-params
- **Created**: 2026-09-19
- **Source**: pasted text + live log. The product creator pasted the API's answer, `{"success":false,"error":{"code":"INTERNAL_SERVER_ERROR"}}`, and a `wrangler tail` on `devolada-api-dev` during their reload of Cobros captured the cause: `(error) Error: D1_ERROR: too many SQL variables at offset 467: SQLITE_ERROR` right after `provider cache miss: pending …`. No URL, so the URL trust policy did not apply.
- **Verdict**: valid
- **Severity**: high

## Report (verbatim)

> Integration: Conexión correcta con wisphub.io.
> Cobros message: No pudimos cargar tus cobros en WispHub.
> {"success":false,"error":{"code":"INTERNAL_SERVER_ERROR"}}

## Symptom

With the pilot's row finally pointing at wisphub.io (saved 2026-09-19 08:39, confirmed on the dev
database: `installation = 'wisphub_io'`), Cobros still shows the failed-read block. The WispHub read
now succeeds — the next request even hits the 30-second display cache — and the handler then fails
in **our own database step**, answering the generic 500 that the screen renders as
*No pudimos cargar tus cobros en WispHub* with Reintentar.

Expected: the list. 205 pending invoices in the window (measured by curl against wisphub.io with the
pilot's key, 200 in 1.1 s, three pages) is an ordinary size.

## Reproduction

1. A business whose pending-invoice list names **≥ 99 distinct debtors** that already have panel
   links (the roster creates them for every customer — the pilot has 6,509).
2. `GET /payment-requests` → `listPaymentRequests`
   (`apps/api/src/routes/payment-requests/handler.ts:47-66`) collects the usuarios and looks up
   their links in chunks of `D1_MAX_PARAMS - 1` = **99**.
3. Each chunk's query binds the business id, **`source = 'panel'`** and the 99 usuarios:
   `and(eq(businessId), eq(source, "panel"), inArray(customerUsuario, part))` → **101** bound
   parameters. D1 allows 100 (`apps/api/src/db/params.ts:1-7`).
4. D1 throws `D1_ERROR: too many SQL variables`; it is not a `WispHubError`, so the handler rethrows,
   `app.onError` answers `INTERNAL_SERVER_ERROR`, and the admin's catch-all branch shows the outage
   block.

The demo ISP never has 99 debtors, so it never tripped. The local test D1 (workerd's SQLite) does
not enforce the cap — `db/params.ts` says so in its first comment — so no test could see it.

Measured: the tail line above, on the reload at 08:39:14 after the save at 08:39:06.

## Suspected Code Paths

- `apps/api/src/routes/payment-requests/handler.ts:48-50` — the comment says *"One parameter is the
  business id; the rest are usuarios (BUG-021)"* and chunks by `D1_MAX_PARAMS - 1`. The
  `eq(paymentLinks.source, "panel")` condition three lines below was added by
  automated-collections-api D3 **after** BUG-021 sized the chunk, and the count was not revisited.
- `apps/api/src/routes/direct-payments/handler.ts:74` — the roster's identical lookup uses
  `D1_MAX_PARAMS - 2`. That one is right, which is why `/links` loaded at 08:39:20 for the same
  business.
- `apps/api/src/db/params.ts` — names the cap and the reason tests are blind to it.
- `apps/api/test/setup.ts` — where the suite's `env.DB` is prepared; the natural place to make the
  cap real locally.

## Root Cause Hypothesis

**Confidence: high** (measured). An off-by-one in a hand-maintained count: the chunk size reserves
slots for the query's fixed parameters, a fixed parameter was added later, and nothing — no test, no
type, no helper — ties the two together. The wider defect is that this class of error is invisible
to the suite by construction.

## Proposed Remediation

**Preferred**, two parts:

1. *The line*: chunk by `D1_MAX_PARAMS - 2` in `listPaymentRequests`, with the comment corrected to
   name both fixed parameters.
2. *The blindness*: in `test/setup.ts`, wrap the suite's `env.DB` so that `prepare(sql).bind(...)`
   throws D1's own error (`D1_ERROR: too many SQL variables`) when more than `D1_MAX_PARAMS` values
   are bound. drizzle's D1 driver goes through exactly that call, so every statement the suite
   executes is measured against the real limit, on every test, forever. Then a test in
   `payment-requests.test.ts` with 120 debtors who all have links — which fails on the current
   code and passes on the fix. The same guard would have failed BUG-021's own test before its fix.

**Alternatives**:
- *Derive the chunk from the query* (a helper that takes the fixed-parameter count). Still a
  hand-maintained number; it moves the slip, it does not remove it. The guard in tests is what
  removes it.
- *Drop the `IN` list and read every panel link of the business, filter in memory.* Correct, but the
  pilot's business has 6,509 links; reading them all to pick 150 on every Cobros load is the wrong
  trade at this scale.

**Files likely to change**:
- `apps/api/src/routes/payment-requests/handler.ts`
- `apps/api/test/setup.ts`
- `apps/api/test/payment-requests.test.ts`

**Tests to add or update**:
- `payment-requests.test.ts`: 120 debtors with stored links → 200, every row carries its link.
- The guard itself, exercised by that test (a deliberately over-limit statement is not needed as a
  separate test: the current handler *is* the over-limit statement until fixed).

## Risks & Considerations

- The guard makes the suite stricter for **every** file: any other statement that binds > 100
  parameters and is exercised by a test will start failing. That is the point, and each such
  failure is a real bug on production D1. The remaining `inArray(...)` sites
  (`credit/index.ts:135`, `credit/topups.ts:204`, `reconnection/queue.ts:80`,
  `direct-payments/validation.ts:1156-1171`, `direct-payments/provisional.ts:138`,
  `integrations/store.ts:30`, `webhooks/queue.ts:298`, `routes/payments/handler.ts:134`) are
  bounded by page sizes or sweep batches on paper; the guard verifies the ones the suite reaches.
  An audit of the rest is a follow-up, not this fix.
- The guard wraps a Workers binding with a `Proxy`; `applyD1Migrations` runs before it and
  drizzle's `batch()` receives proxied statements. Verified by the full API suite passing.
- No schema, no migration, no wire change.

## Open Questions

- none
