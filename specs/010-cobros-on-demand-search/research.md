# Research: Cobros On-Demand Search

**Feature**: `010-cobros-on-demand-search` | **Date**: 2026-09-22

Decisions are numbered `D<n>` and cited from code as
`cobros-on-demand-search D<n>` (constitution I).

## The measurement everything follows from

`OPTIONS /facturas/` (measured 2026-09-01, recorded in the archive at
`integrations/wisphub.md`) documents the invoice list's query parameters:

| Parameter | Values |
| --- | --- |
| `estado` | 1 Pendiente · 2 Pagada · 3 Cancelada · 4 Revisión · 5 Transferida |
| `tipo_fecha` | `fecha_emision` \| `fecha_vencimiento` \| `fecha_pago` |
| `desde` / `hasta` | `YYYY-MM-DD`, **both default to the current month** |
| `forma_pago`, `zona`, `cajero` | by id |

There is **no customer filter**. The adapter re-verified it live on
2026-08-16 (`apps/api/src/wisphub/client.ts`, `pendingInvoices`). Two
independent measurements, eleven weeks apart, agree.

So the question "what does *this* customer owe" cannot be asked of the
invoice list, and a debtor search cannot be either. Every decision below is
downstream of that.

---

## D1 — One door: `GET /payment-requests` answers browse and search

The resource stays what it is — the ISP's debtors — and gains `q`, `cursor`
and `filter`. Browsing and searching are the same question answered two
ways, exactly as `009 D1` argued for `/direct-payments/customers`: a page
with one search box should not hold two caches and swap between them
mid-keystroke.

The route keeps its path. Renaming it to `/cobros` would be a second name
for one resource, and `payment-requests` is already the name the admin
router, the MSW handlers and the Playwright stubs know.

**Alternatives considered**: a second door `GET /payment-requests/search`.
Rejected — it doubles the auth wiring, the failure mapping and the client
cache for rows of the same shape.

## D2 — The block cursor is the provider's own `next`, never an offset we compute

`/clientes/` is measured to page by `limit` and `offset` (`009`, and
`customersBlock` uses it). `/facturas/` is **not** measured for `offset`:
what is measured is that it honours `limit` and answers a `next` URL, which
`pendingInvoicesPage` already reads and `snapshot.ts` already stores and
resumes from.

So the block walk reuses `next` rather than assuming the invoice list shares
the customer list's paginator. It needs no new measurement, it cannot be
wrong, and it is the same unit the sweep has walked in production since
`bug: pending-invoice-cap`.

The cursor the page sends is opaque, as `009 D2` made the Links one: it
carries the provider path to fetch next, or the snapshot offset when a
snapshot is serving (D3). The client never builds one.

**Alternatives considered**: `limit` + `offset`, mirroring the customer
list. Rejected as an unmeasured assumption on a money-adjacent list — and it
buys nothing, because `next` already exists in every answer.

## D3 — A block is cut from the snapshot when one serves, walked from the provider otherwise

`readPendingInvoices` already makes this choice for the whole product: a
tenant whose list fits the live budget is read live; a larger one is served
the sweep's last finished pass. Blocks inherit it rather than inventing a
second rule.

Two consequences worth stating, because one of them is a gain:

- A large tenant's blocks cost **no provider call at all** — they are a
  slice of rows already in D1 — and a finished pass does not shift under the
  walk, so its blocks are *more* stable than the provider's own paging. The
  duplicate-and-skip problem of `009 D6` is a small-tenant problem here.
- A large tenant's blocks are therefore minutes old, and the sweep still
  pays its sixty-odd calls. This feature does not change that; the sweep's
  `pending` pass is out of scope and every money path still reads it.

One cost is accepted with its eyes open: on the snapshot path the server
still assembles the pass's rows before cutting a block from them, because
that assembly is where the merge of the served and in-flight passes and the
subtraction of what Devolada already registered both live. So a snapshot
tenant's *server* cost per request is what it is today — what changes is
that the whole list no longer travels to the browser (FR-001a). Serving a
block straight out of `wisphubPages` by stored page and offset would remove
that too, but it would have to re-implement the merge and the subtraction
per block, and getting either wrong shows a debtor a debt they have already
paid. It is registered as debt rather than smuggled into this feature.

## D4 — A search asks the customer list with four filters at once

`wisphub.searchCustomers(q, limit)` already does exactly what this feature
needs — `nombre`, `apellido`, `usuario`, `telefono` with `__contains`, all
four asked together, merged and deduped by usuario, each filter's own
`count` returned. It was built for `009 D4` and it is not Links-specific.

Cobros reuses it unchanged. No new adapter method, and in particular no
parameter chosen from the shape of the text — that guess is
`bug: customer-lookup-misses`, where a usuario of digits went to the phone
filter and an existing customer came back "not found".

"How many matched" is the largest of the four counts, reported as a floor
and said in words, exactly as `009 D5` decided: the true size of the union
cannot be known without fetching all four whole.

## D5 — A search result's debt is `debtFor` over the existing pending read

The matched customer rows carry `saldo` for free (`carriedBalanceCents`,
already in the list serializer). The pending invoices come from
`readPendingInvoices` — the same bounded, cached door every other reader
uses. `debtFor` then computes what `debt-truth` already defines, and
`nothingOwedIsProven` decides which of the two honest answers a zero gets:

| Situation | Row says |
| --- | --- |
| Debt > 0 | the amount |
| Zero, and proven (credit, "Pagadas", complete live list, finished pass) | *Sin adeudo* |
| Zero, not proven | *No pudimos confirmar* — no amount |

This is why FR-008 exists and why it is not cosmetic: a zero the product
cannot prove is what files a confirmed payment as "owes nothing".

**This feature adds no new truth about money.** `debtFor`,
`nothingOwedIsProven` and `debt-truth`'s rule are used as they are. What
changes is *which customers the screen can ask about*.

The spec's FR-007a exists for this decision: resolving a search goes through
the door the product already reads by, so a search costs the ISP no more
than opening the page costs it today — for a large tenant a D1 read, for a
small one at most the five-page walk that is already cached for 30 seconds.

## D6 — Browse and search answer different units, so the page swaps rather than mixes

- **Browse** is pending receipts, grouped by customer *within the blocks
  that have loaded*.
- **Search** is customers, each with their *whole* debt as `debt-truth`
  defines it — including the `saldo` that no invoice row can show.

They are different questions, so the search replaces the list while it is
active, exactly as it does on Links. Nothing mixes a per-block subtotal with
a whole-customer debt in one list, which would be a column the operator
cannot read.

One row shape carries both, with the source named in the response rather
than guessed per row. The row's amount is nullable, because only the search
can answer "cannot confirm" (D5) and only it ever needs to.

## D7 — The due-date tabs are a provider filter, and a receipt with no due date belongs to none

`tipo_fecha` with `desde` / `hasta` is what makes a tab true across every
block instead of describing the rows that happened to load.

Two hazards, both handled by rule rather than by the screen:

1. **`desde` and `hasta` default to the current month.** A walk that omits
   its window silently drops older arrears — which is exactly what
   `debt-truth D3` put the 180-day window there to prevent. So **every**
   block request carries an explicit window, on every tab. There is no
   default path.
2. **A receipt with no `fecha_vencimiento` belongs to no due-date window.**
   It cannot be filed in a due-date bucket, because there is no date to file
   it by. It stays in *Todas* and is always reachable by search.

So *Todas* keeps today's walk — `tipo_fecha=fecha_emision`, 180 days back,
one day forward — and a tab is its own walk by `fecha_vencimiento`. The
three do not add up, and the page must not imply they do (FR-014).

**Alternatives considered**: keeping the tabs client-side over loaded
blocks. Rejected outright — a "Vencidas" tab that means "the overdue rows
among the 40 you happen to have scrolled past" is worse than no tab, because
the operator reads it as the answer to "who is overdue".

## D8 — `complete` and the incompleteness warning go, replaced by the provider's count

Nothing is read whole, so nothing can be cut short: `complete: false` has no
meaning left and the warning it drove ("La lista puede estar incompleta")
goes with it (FR-016). In its place the page says how many pending receipts
the ISP has, from the provider's own `count`.

`count` is not yet read on the invoice path — `pendingInvoicesPage` takes
`next` and `results` only, while `listPage` on the customer side already
reads `count`. Both are the same DRF list envelope, so the field is expected
to be there; the walk reads it **defensively**, and when it is absent the
page says nothing rather than printing a guess. This is the one shape in
this plan not backed by a measurement, and it is contained to one optional
label.

## D9 — The provider being away is an answer, not a failure — but Cobros has no fallback rows

`009 D10` could keep answering with Devolada's own links, because Devolada
stores links. **Devolada stores no debt.** There is no row to fall back on,
and an empty result would read as "nobody owes" — the one lie this screen
must never tell.

So:

| State | Behaviour |
| --- | --- |
| Blocks on screen, background read fails | rows stay under *Sin conexión a WispHub*, no error block (today's rule) |
| Search while the provider is away | the page says the search needs WispHub; **no rows, no empty state, no error block** |
| Next block while away | quiet note, keep what is there |
| Key refused (`WISPHUB_AUTH_FAILED`) | Integraciones, no Reintentar — unchanged, `bug: cobros-installation-fallback` |
| No integration | connect WispHub — unchanged |

## D10 — The browser's memory: the URL carries `?q=`, session storage carries the first block

The same split `009 D11` made, for the same reasons: a TanStack cache dies
on reload, so the two-minute reuse (FR-013) and the survival of a reload
(FR-012) need storage the page owns.

`apps/admin/src/features/links/seen.ts` already holds `readResults` /
`writeResults`. A second copy in `features/cobros/` is drift. They move to a
shared module keyed by page, and Links keeps its behaviour byte for byte;
the recently-seen cache and the copied/sent marks stay where they are, since
they are about links and Cobros already reaches them through
`useLinkAction`.

## D11 — The contract changes shape, and every consumer moves with it

`paymentRequestsResponse` is the contract (constitution III), so the admin,
the MSW handlers and the Playwright stubs all derive from it. The change is
not additive — `cobros`, `complete` and the flat invoice row go — so this is
one edit across all of them, not a migration.

Nothing outside the panel reads this route: it is session-only, there is no
`/v1` equivalent, and the payer's page never touches it.

## D12 — The freshness label survives, but only where there is an age to report

`009 FR-027` retired the read-age label on Links because a block is read
when it renders. Half of that now holds here: a **live** block has no age.

But a large tenant's blocks come from the sweep's last finished pass (D3),
which genuinely is minutes old. Dropping the label there would hide a
staleness the operator currently sees.

So the label follows the source: shown, with the pass's own `readAt`, when a
snapshot answered; absent when the blocks are live. This is the honest
version of both rules, and it is why the response says which source it came
from rather than leaving the page to infer it.

## D13 — What this feature does not touch

Stated because the blast radius is the main risk of editing this screen:

- **`debt-truth`** — `debtOf`, `debtFor`, `nothingOwedIsProven` and the
  rule that a credit is netted and never surfaced. Read, never edited.
- **The sweep's `pending` pass** — its schedule, its page size, its lease
  and swap. Read, never edited.
- **Every money path** — the charge guard, the SPEI amount, the
  re-validation, the reconnection queue. They call `readPendingInvoices`
  directly and this feature adds no caller between them and it.
- **The link actions** — `009 US4`'s rules (created on the act, identified
  by usuario, the number read fresh) apply to a search row unchanged,
  through the `useLinkAction` hook both pages already share.
- **Roles, the CLABE gate, the business timezone.**
