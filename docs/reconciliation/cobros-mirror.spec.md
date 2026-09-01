---
status: in development
stories: [US-R01, US-R04]
domain: reconciliation
updated: 2026-09-01
debt: []
---

# Spec: The Cobros mirror — who owes what, copied from WispHub

Phase 4 of the pivot (platform/pivot.spec.md, sequencing 4), first half.
A **Cobro** (`payment_request`) is what the business expects to collect —
the pivot's central entity (pivot D2). In v1 its only source is the
WispHub integration, and a WispHub Cobro is a **mirror, never the truth**
(pivot D4): the truth stays in WispHub, and this spec decides *when* we
copy it. Decided with the owner in the phase-4 interview (2026-09-01).
Its companion is [payments-and-classes.spec.md](payments-and-classes.spec.md).

## Decisions

- **D1 — The source is the tenant's pending-invoice list, one paginated
  endpoint.** WispHub exposes every pending invoice of the tenant at
  `facturas?estado=1` (the call `pendingInvoices()` already makes to read
  one customer's debt, ≤5 pages). A Cobro row per pending invoice: the
  external invoice id, the customer's usuario and name, the invoice total
  in cents, its date. The **carried balance** (`saldo`, debt-truth D7) is
  not in that list — it is a per-customer read, and it is refreshed only
  at the two live moments below. **Rejected**: one customer read per
  Cobro (N calls per refresh against a provider that stalls one call in
  eight — provider-latency).

- **D2 — Refresh by events and on demand, never by a fixed tick.** Owner
  decision after the cost analysis (pilot scale: a 15-minute cron is ~190
  calls a day per business whether anyone looks or not, growing with
  tenants; this model is ~15–20, growing with use). Four triggers:
  1. **Link open** and 2. **verdict applied / reconnection registered** —
     the two moments that already read that customer live: what was read
     is written to that customer's Cobros (open, amount, carried
     balance), at **zero extra calls**.
  3. **Opening the Cobros section**: stale-while-revalidate. The section
     renders the copy at once with its freshness ("actualizado hace 4
     min"); if the business's last full refresh is older than **10
     minutes** the API starts one in the background and the list updates
     itself; an "Actualizar" button forces it. A per-business **lease of
     2 minutes** (the sweeps' own discipline) dedupes concurrent opens.
  4. **A daily full close**, at 03:00 in the business's timezone
     (settings D5), that pages the whole list and reconciles: creates the
     cycle's new invoices, closes what was paid in cash and nobody opened.
  **Rejected**: a 15-minute cron (the numbers above); 5 minutes (3× the
  contact with a provider that stalls); no mirror at all, live reads only
  (the section dies with WispHub and blocks the manual Cobro pivot D2
  chose).

- **D3 — On-demand refreshes read incrementally; the daily close reads
  everything.** WispHub lists invoices newest first; an on-demand refresh
  pages **until it meets ids it already holds** — in practice one page.
  The daily close never does that: a re-opened invoice could hide behind
  a known id, so the safety net reads all pages and closes every Cobro
  whose id no longer appears. Incremental where a person is waiting,
  complete where nobody is.

  **Amended 2026-09-01 (from the D4 sweep): closures can be asked for,
  not diffed.** `OPTIONS /facturas/` documents filters the contract did
  not record: `estado` **1 Pendiente · 2 Pagada · 3 Cancelada · 4
  Revisión · 5 Transferida**, and `tipo_fecha` = `fecha_emision |
  fecha_vencimiento | fecha_pago` with `desde`/`hasta`. The daily close
  therefore asks two bounded questions — *paid since the last close*
  (`estado=2&tipo_fecha=fecha_pago&desde=…`) and *cancelled since the
  last close* (`estado=3`) — and closes those Cobros as `paid`/`gone`
  instead of paging every pending invoice and diffing; the full pending
  read stays as the net for what those two miss (a deleted invoice has no
  state to ask for). The on-demand refresh may ask the same two questions
  after its incremental page, so it stops being blind to closures.
  **Gotcha**: `desde`/`hasta` **default to the current month** — every
  read must pass `desde` or it silently drops older arrears (the client's
  180-day window in `wisphub/client.ts` already does). **Open for the
  owner**: how `4 Revisión` and `5 Transferida` map onto `open | paid |
  gone` — the safe reading until decided is Revisión = still `open`,
  Transferida = not yet `paid` (a transfer WispHub has not confirmed).

- **D4 — The webhook spike is the gate, and it decides the fifth
  trigger.** WispHub's verified contract (integrations/wisphub.md) shows
  no webhooks, and `OPTIONS` is its real documentation. Before the sweep
  is written: probe `OPTIONS` across the API's resources and the panel's
  settings for any notification/webhook surface; if one exists, exercise
  it with real invoice events — creating and paying an invoice through the
  API, and a suspension/reactivation, **which likely needs the CHR lab**
  (a real RouterOS linked to the day's demo tenant; the lab's home and
  relaunch are in the owner's notes — its VPN link has to be re-run for
  the day's tenant first). A push source becomes trigger 5 and the daily
  close stays as the net. Findings land here whatever they are.

  **Executed 2026-09-01 — there is no push surface; trigger 5 does not
  exist.** Thirteen calls against the day's demo tenant, no writes:

  | Probe | Answer |
  |---|---|
  | `GET /api/` (a DRF resource map) | 403 HTML from nginx — the root is not routed |
  | `OPTIONS` on `clientes`, `facturas`, `zonas`, `staff`, `formas-de-pago` | 200 JSON; no docstring names a callback, a notification or a URL |
  | `OPTIONS` on `pagos`, `routers`, `eventos`, `integraciones`, `notificaciones`, `webhook`, `webhooks` | 404 — the panel's HTML page (its Google Tag Manager `event` is the only "event" on the wire) |
  | The panel (Mi Empresa → Configuración / Integraciones / API / Notificaciones), checked by the owner | nothing |

  So the CHR lab and a public receiver were never needed: there is no
  event to observe. The four triggers of D2 are the whole model and the
  daily close is the net. The same sweep yielded the `facturas` filter
  vocabulary that amends D3.

- **D5 — A mirror admits being one.** Every Cobro carries `refreshedAt`;
  the section shows freshness per list and per row. A Cobro whose invoice
  disappeared from WispHub is **closed** (`closed_at`, `closed_reason =
  'gone'`) — never deleted on the spot — and a Cobro whose invoice reads
  paid closes as `'paid'`. The truth stays in WispHub: no screen here
  edits a WispHub Cobro (the manual source is deferred, pivot D2).

- **D6 — The data commitment, said out loud.** For the first time we
  hold a copy of a business's receivables. We store the **minimum**:
  usuario, customer name, external invoice id, amount, invoice date,
  timestamps — no address, no plan, no phone. Exposure: the Cobros section
  (tenant-isolated, read for all four roles: "who owes me" is the daily
  question), and the payer's own link (its own Cobros only; the token is
  the credential, direct-payment D1). No route lists invoices across
  tenants; the platform operator's map shows credit, never receivables.
  **Closed Cobros are purged after 90 days** — the payment history lives
  in `payments`, a settled Cobro has no second job. Owner's question that
  prompted this decision: "¿esta operación almacena datos del ISP?" — yes,
  and this is exactly how much and where it shows.

- **D7 — The payer's link lists their open Cobros (US-R04), and pays the
  whole debt.** Direct-payment D21 stands: the page asks for the whole
  debt (WispHub applies payments to the customer, not to an invoice). The
  list is information — which invoices make the total, oldest first —
  not a picker. A one-off link per Cobro is deferred (pivot D3).

- **D8 — Without an integration, the section says so.** A business with
  no WispHub key sees "Conecta WispHub para ver tus cobros" with the
  Integraciones link (phase 5); the manual door does not render (pivot D2).

## Schema

- `payment_requests`: `id`, `business_id`, `source` (`'wisphub'`),
  `external_id` (WispHub invoice id), `customer_usuario`,
  `wisphub_customer_id`, `customer_name`, `amount_cents` (invoice total),
  `carried_balance_cents` (nullable — known only from a live customer
  read), `invoice_date`, `status` (`open | paid | gone`), `closed_at`,
  `refreshed_at`, `created_at`. Unique `(business_id, source,
  external_id)`; index `(business_id, status, invoice_date)`.
- `businesses.cobros_refreshed_at` (the last full refresh) and
  `cobros_refresh_lease_until` (D2's lease).

## Contract

| Route | Actor | Notes |
|---|---|---|
| `GET /payment-requests?status=open\|closed&q=&cursor=` | any member | the section's list + `refreshedAt` of the business; `q` matches usuario or name |
| `POST /payment-requests/refresh` | any member | starts a background incremental refresh unless the lease holds; 202 with `refreshedAt`; 409 `NOT_CONFIGURED` without a WispHub key |
| `GET /direct-payments/links/:token` | public | gains `cobros: [{ externalId, amountCents, invoiceDate }]` next to the total (US-R04) |

The daily close rides the api's scheduled handler (one job per business
whose local hour is 03:00, leased like the sweeps). Triggers 1–2 are
writes inside the existing link-open and verdict paths, never new reads.

## UI Contract

- **Cobros section** (nav, IA): list rows — customer (name · usuario),
  amount, invoice date, freshness; header with "Actualizado hace X" and
  "Actualizar"; filter open/closed; search. Read-only; no create. Empty
  states: no integration (D8), no open Cobros ("Nadie te debe hoy"),
  error-with-retry (US-P01).
- **Link page**: under the total, the invoices that make it (date ·
  amount), oldest first; no interaction.
- es-MX: Cobro, Cobros, "actualizado hace", "Actualizar".

## Scenarios

1. First open of the section with a WispHub key and no rows → 202, the
   incremental refresh pages the list and materializes one Cobro per
   pending invoice; a second open within 10 minutes starts nothing.
2. Two opens within the lease → one provider read (the lease dedupes).
3. A link open writes that customer's Cobros with the carried balance;
   no tenant-wide read happens.
4. A verdict applied closes the customer's paid Cobro as `paid`.
5. The daily close: an invoice paid in cash in WispHub disappears from
   the list → its Cobro closes as `gone`; a new cycle invoice appears →
   a new open Cobro; both proven by rows.
6. Incremental stop: an on-demand refresh reads one page when the second
   page's first id is already known.
7. Ninety days after closing, a Cobro is purged; open ones never are.
8. The payer's link lists the open Cobros that make the total, oldest
   first, and the pay flow is unchanged (D7).
9. No WispHub key → the section shows the connect prompt and `refresh`
   answers 409.
10. Isolation: business B never sees business A's Cobros, by row and by
    search.

## Definition of Done

- [x] **Spike first (D4)**: the webhook probe run and recorded here
      (2026-09-01: no push surface in the API or the panel; the CHR lab
      was not needed).
- [ ] Migration for `payment_requests` and the two business columns
      (additive).
- [ ] Scenarios 1–10 automated, citing their stories.
- [ ] The daily close observed once on deployed dev against the pilot's
      real tenant (a cash payment registered in WispHub closes its Cobro).
- [ ] SPEC.md glossary: **Cobro** = `payment_request` adopted; TASKS.md
      phase 4 boxes ticked.
