---
status: in development
stories: [US-R01, US-R04]
domain: reconciliation
updated: 2026-09-03
debt: []
---

# Spec: Cobros, read live — who owes what, asked when someone looks

Phase 4 of the pivot (platform/pivot.spec.md, sequencing 4), first half.
A **Cobro** (pivot D2) is what the business expects to collect; in v1 its
only source is the WispHub integration, and the truth stays in WispHub
(pivot D4). This spec's first version (PRs #135/#138) kept a **mirror** of
that truth in D1; the owner replaced it with a **live read** on
2026-09-01 — the history is in D2. Its companion is
[payments-and-classes.spec.md](payments-and-classes.spec.md).

## Decisions

- **D1 — The source is the tenant's pending-invoice list, one paginated
  endpoint.** `pendingInvoices()` as it exists: `facturas?estado=1`,
  180-day window by issue date (the `desde` default gotcha,
  integrations/wisphub.md), ≤5 pages of 100, `complete` flag. The same
  read every link open already pays. **Rejected**: one read per customer
  (N calls against a provider that stalls one call in eight).

- **D2 — Live, never a copy (owner decision 2026-09-01, replacing the
  mirror).** The section asks WispHub at the moment someone looks:
  frontend → api → `pendingInvoices()`. **Rejected — the mirror in a
  `payment_requests` table** (this spec's own first model: event triggers,
  a 2-minute lease, incremental reads, a daily full close): measured
  against the link's cost it bought nothing — a link open already pages
  the whole tenant list, so live reads add no new kind of call; every
  decision that moves money already reads live (debt truth, pivot D4), so
  the copy was never the truth for anything; storing receivables created
  a data commitment (purge, isolation, "¿almacena datos del ISP?") with
  no consumer; and the close's diffing carried two mechanism errors found
  in the #138 review (no cancellation date in `tipo_fecha`; invoices
  moving to estado 4/5 would read as `gone`). The `payment_requests`
  table is deferred to the **manual Cobro** (post-pivot, pivot D2) —
  born then as a source of truth, not a mirror of one.

- **D3 — Two short caches make it feel instant; nothing else persists.**
  The api keeps its 30-second module cache on the pending list
  (polish/provider-latency D3, TD-014) — two members opening at once cost
  one provider read. The client keeps the answer in query memory
  (TanStack Query, `staleTime` **2 min**, the owner's case: navigate away
  and come back → painted at once, no request; come back later → painted
  at once from memory while a background refetch updates it —
  stale-while-revalidate where it is free). ~~"Actualizar" forces a
  refetch~~; the header shows "consultado hace X". **Amended 2026-09-03
  (polish/presence-freshness.spec.md, US-P07)**: the button retired —
  the section refreshes on return to the tab, on a 3-minute heartbeat
  while someone is present, and when Devolada's own pulse says a payment
  got registered; `readAt` is the provider read's time, not the
  request's (BUG-013); a failed background read keeps the rows and says
  so quietly. The 2-minute memory stays for navigation inside the app.
  **Rejected**: a longer
  `staleTime` (10 min was the mirror's tolerance; a read this cheap
  deserves fresher), persisting to localStorage (memory covers the
  navigate-and-return case; a reload may fetch).

- **D4 — The whole list travels; the client arranges it.** One response:
  every open Cobro of the tenant (≤500 rows, `complete`). The frontend
  groups **by customer** — one row per customer (name · usuario, total
  owed, "3 facturas") expandable to its invoice rows — orders oldest
  debt first, pages **50 customer rows** locally, searches locally
  (usuario or name), and filters **Vencidas / Por vencer** by due date.
  `complete: false` renders a warning row ("la lista puede estar
  incompleta"), never a silent truncation. **Rejected**: server-side
  cursors (there is no table to cursor over; local search needs the whole
  list anyway); one row per invoice (the business asks "cuánto me debe
  Juan", not "qué facturas existen").

- **D5 — Only `estado=1` (Pendiente) is a Cobro.** `4 Revisión` and
  `5 Transferida` are WispHub's own in-flight states; v1 does not list
  them — parity with the link, whose debt read charges `estado=1` only.
  Revisit if the pilot asks about an invoice "missing" while under
  review.

- **D6 — Devolada stores nothing.** No table, no purge clock, no
  receivables at rest: the answer to the owner's phase-4 question
  ("¿esta operación almacena datos del ISP?") is **no**. What exists is
  transient: the api's 30-second cache and the viewer's browser memory.

- **D7 — WispHub down means the section says so.** Error state with
  "Reintentar" (US-P01 posture, the link's own); the 1-in-8 stall shows
  as loading and times out into that state. There is no copy to fall
  back on — accepted: an ISP whose WispHub is down has bigger problems,
  and the page never presents stale data as fresh.

- **D8 — The payer's link lists their open Cobros (US-R04), and pays the
  whole debt.** Unchanged from the first version: the list is
  information — which invoices make the total, oldest first — not a
  picker (direct-payment D21; one-off links stay deferred, pivot D3).

- **D9 — Without an integration, the section says so.** No WispHub key →
  "Conecta WispHub para ver tus cobros" with the Integraciones link
  (phase 5); the manual door does not render (pivot D2).

## Schema

None. That is the point (D2, D6).

## Contract

| Route | Actor | Notes |
|---|---|---|
| `GET /payment-requests` | any member | live read: `{ cobros: [{ externalId, customerUsuario, customerName, amountCents, invoiceDate, dueDate }], complete, readAt }`; 409 `NOT_CONFIGURED` without a WispHub key; 503 `WISPHUB_UNAVAILABLE` on failure/stall-timeout |
| `GET /direct-payments/links/:token` | public | gains `cobros: [{ externalId, amountCents, invoiceDate }]` next to the total (US-R04) |

`dueDate` comes from the invoice row (`fecha_vencimiento` — field name to
be verified against the live row at implementation; the filter documents
the date exists).

## UI Contract

- **Cobros section** (nav, IA): customer rows (name · usuario, total,
  oldest due date, count) expandable to invoices (date · amount ·
  due); header "Consultado hace X" (no button since 2026-09-03,
  presence-freshness D1); filter Vencidas /
  Por vencer / Todas; search input. 50 customer rows per local page.
  Read-only. Empty states: no integration (D9), "Nadie te debe hoy",
  error-with-Reintentar (D7), `complete: false` warning (D4).
- **Link page**: under the total, the invoices that make it (date ·
  amount), oldest first; no interaction.
- es-MX: Cobro, Cobros, "consultado hace", "Vencidas" ("Actualizar" retired 2026-09-03).

## Scenarios

1. Open with a WispHub key → the live list, grouped by customer, oldest
   debt first (US-R01).
2. Navigate to Pagos and back within 2 minutes → no request, instant
   paint (D3).
3. Back after 2 minutes → instant paint from memory, background refetch
   lands the fresh answer (D3).
4. Two members open within 30 seconds → one provider read (D3);
   ~~"Actualizar" → a refetch~~ (the refetch now rides presence signals —
   presence-freshness scenarios 2, 3, 6).
5. Search finds by usuario and by name; "Vencidas" keeps only overdue
   customers (D4).
6. `complete: false` → the warning row renders (D4).
7. WispHub down or stalled past timeout → error state with Reintentar;
   no stale data presented as fresh (D7).
8. The payer's link lists the open Cobros that make the total, oldest
   first; the pay flow is unchanged (D8).
9. No WispHub key → the connect prompt; the API answers 409 (D9).
10. An invoice in `Revisión` is absent, matching what the link would
    charge (D5).

### Amendment — 2026-09-02, pilot-UX round

Each cobro row now carries the debtor's permanent link: `linkUrl` and a
phone-less `waLink` (WhatsApp opens its own picker with the message
ready — the invoice row carries no phone, and a wrong chat is worse
than one extra tap). **Stored links only**: the invoice list has no
numeric id to lazy-create with, so a missing link (roster never
visited) is `null` and the UI hides the buttons; the Links roster
creates every link on first view. In the section, the actions live in
the customer's expansion, once per person, gated `payments: operate`
like the Links page — "veo quién me debe → le mando su link" in one
expansion.

## Definition of Done

- [x] **Spike first**: the webhook probe run and recorded (2026-09-01:
      no push surface in the API or the panel; the CHR lab was not
      needed; the `facturas` filter vocabulary landed in
      integrations/wisphub.md).
- [x] No migration — `payment-requests.test.ts` runs against a schema
      with no `payment_requests` table.
- [x] Scenarios 1, 4–10 automated citing their stories (api +
      `cobros.test.tsx`); 2–3 are the client cache's own behavior — the
      2-minute `staleTime` is asserted by reading, in `CobrosScreen.tsx`.
- [ ] The section observed on deployed dev against the pilot's real
      tenant (a cash payment registered in WispHub disappears from
      Cobros on the next refetch).
- [ ] SPEC.md glossary: **Cobro** = pending invoice read live (v1); the
      `payment_request` table arrives with the manual source. TASKS.md
      phase 4 boxes ticked.
