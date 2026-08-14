---
status: in-development
stories: [US-A01]
domain: admin
updated: 2026-08-14
debt: []
---

# Spec: Live charge feed

The Cobros section: the ISP watches money come in, in near real time, with the reconnection status of every charge. Reference: Stripe Dashboard.

## Decisions

- **D1 — "Live" is polling, not sockets.** The feed refetches every 5 seconds. A WebSocket adds infrastructure for a latency nobody asked for at pilot scale. Revisited if an ISP runs hundreds of stores.
- **D2 — ~~The browser owns "today"~~. Superseded 2026-08-14 by `admin/settings.spec.md` D5**: the server computes the start of the business day from the ISP's `timezone` setting and the `todayStartMs` parameter is gone. The browser was only ever the best available source while no setting existed; it made the same charge count on different days depending on where the laptop was.
- **D3 — Failed charges get their own strip on top.** A failed reconnection demands action; buried in page three it is invisible. The strip queries `status=failed` separately, so it finds failures beyond the first page.
- **D4 — Detail is an expandable row, not a route.** Tapping a row opens the breakdown, folio and reconnection timeline in place (Stripe-style). One screen, no navigation. Revisited if the detail grows (receipts, disputes).
- **D5 — The API ships all filters; the UI ships status only.** `storeId`, `from`, `to` work server-side today, but the store selector needs the Stores task's endpoint and date pickers add little at pilot volume. The UI grows into the API, not the reverse.
- **D6 — Tenant isolation is tested, not assumed.** The feed filters by the actor's `ispId`; a test proves another ISP's charges never appear.
- **D7 — Built on the shadcn catalog** (refactor 2026-08-14): status filters are `Tabs`, row expansion is `Collapsible`, loading is `Skeleton` — all token-themed per admin/shell D1. Deliberately **no `Table`**: rows are interactive (they expand) and must collapse to cards on mobile (FRONTEND law); a list of collapsible rows serves both, a table serves neither.

## Contract

`GET /charges/feed` (session cookie, **ISP only**)

Query: `cursor` (ms) · `status` (`queued|reconnected|failed`) · `storeId` · `from`/`to` (ms)

```
{ charges: [ { id, folio, reconnectionStatus, totalCents, monthlyFeeCents,
               serviceFeeCents, customerName, storeName, createdAt,
               reconnectedAt, attempts } ],
  nextCursor: number | null,
  today: { count, totalCents } }   // the day starts in the ISP's timezone (settings D5)
```

Newest first, 20 per page. 401/403 as usual; a store session gets 403.

## UI Contract

- Cobros section (`src/features/feed/`): today strip ("Hoy: $X · N cobros"), the failed-attention strip (D3), status filter chips (Todos · En cola · Fallidos · Reconectados), the list with time, customer, store, `StatusBadge` and amount, refreshing every 5s (`aria-live`).
- Row tap expands: `AmountBreakdown`, folio in mono, and the timeline (registrado → intentos → reconectado/fallido con horas).
- Mobile: rows stay readable as stacked cards. "Cargar más" pagination.

## Scenarios

1. The ISP sees its charges newest-first with store names; the cursor pages (US-A01)
2. `status` filter and `today` totals compute correctly (US-A01, D2)
3. A store session gets 403; another ISP's charges never appear (D6)
4. UI: rows render with customer, store, badge and amount; expanding shows folio and breakdown (US-A01, D4)
5. UI: the failed strip appears when failed charges exist (D3)
6. UI: the status chips re-query the feed (D5)

## Definition of Done

- [x] Scenarios 1–3 automated in the API layer (`test/charge-feed.test.ts`, 3 tests)
- [x] Scenarios 4–6 automated with Testing Library + MSW (`apps/admin/test/feed.test.tsx`, 3 tests)
- [ ] Manual check on the deployed admin with the real test charges
