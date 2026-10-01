---
slug: core-reads-provider-directly
status: open
kind: inadvertent
severity: medium
effort: weeks
opened: 2026-09-27
---

# Technical Debt: the core reads WispHub directly, and names it

## What was traded

The core (payments, the link act, validation, the customers door, the
panel) was built with WispHub as the only provider, so it calls the
WispHub adapter by name and speaks its words. No rule forbade it until
constitution v1.7.0 added Principle IX on 2026-09-27: "Devoladapago is a
product for validating SPEI transfers for many kinds of businesses, not
ISPs. It supports adapters for specific providers" (the creator,
translated from Spanish). Nothing recorded this as a trade when it was
made. The action side already has a boundary (`integrations-hub` D7). The
read side has none.

## Where it lives

The core calls the adapter by name:
- `apps/api/src/routes/payments/handler.ts:17` — imports `wisphubFor`
  and `attemptReconnection` from `wisphub/`.
- `apps/api/src/routes/direct-payments/handler.ts::listCustomers` and
  `::createLink` — build a `wisphubFor` instance and read `getCustomer` /
  customer pages directly.
- `apps/api/src/routes/payment-requests/handler.ts` — today's whole-list
  read. `specs/014-cobros-in-links` rewrites it through a capability
  (D18, T010), which pays this anchor.
- `apps/api/src/direct-payments/validation.ts:21` and
  `apps/api/src/direct-payments/provisional.ts:8` — `wisphubFor`,
  `getCustomer`, `readPendingInvoices` and `attemptReconnection` inside
  the money paths.
- `apps/api/src/reconnection/queue.ts:9` — `wisphubFor` in the action
  queue's sweep.
- `apps/api/src/index.ts:21` — `import { sweepWispHubLists } from "./wisphub/snapshot";`
  on the cron.
- `apps/api/src/direct-payments/classes.ts::effectiveOverTreatment` —
  reads `WISPHUB_CAPABILITIES` by name instead of the integration's
  capabilities.

A generic rule lives in the adapter's folder:
- `apps/api/src/wisphub/money.ts` — the money parsers (Principle II),
  imported by Consta at `consta/provider/apicep.ts:9`,
  `consta/extraction/gate.ts:2` and `consta/extract.ts:30`. 014's T003
  moves it to `apps/api/src/money.ts`, which pays this anchor.

Browser-facing contracts carry the provider's name:
- `apps/api/src/routes/direct-payments/schema.ts:498` — the customers
  answer's `wisphub: z.enum(["ok", "unavailable", "not_configured"])`.
- `apps/api/src/routes/direct-payments/schema.ts:465` — `wisphubId` on a
  customer row.
- `apps/api/src/routes/direct-payments/handler.ts:264` — the
  `WISPHUB_AUTH_FAILED` / `WISPHUB_UNAVAILABLE` codes sent to the panel.

The core's customer reference is named after WispHub's field:
- `apps/api/src/db/schema.ts:181` — `customerUsuario: text("customer_usuario")`,
  the payment link's identity (`admin-links-view` D5), and `usuario` in
  every link and customers contract.

Core screens name the provider:
- `apps/admin/src/features/links/LinksScreen.tsx:278` —
  "Sin conexión a WispHub. Mostrando la última lectura."
- `apps/admin/src/features/links/LinksScreen.tsx:212` —
  `<Link to="/integrations/wisphub" className="block">`, a core screen
  linking to one provider's setup page.

## Interest

- The first business on a system other than WispHub gets no customers,
  no payer lookup and no reconnection until each file above learns about
  a second provider. The work is spread across at least ten core files
  that nothing links together.
- The browser contracts would need a second vocabulary, or a breaking
  rename, the day a second provider exists. The admin already reads both
  `WISPHUB_AUTH_FAILED` and, once 014 lands, `INTEGRATION_AUTH_FAILED` for
  the same message.
- Consta, the SPEI engine every business depends on, imports from an
  ISP adapter's folder until 014's T003 lands.

## Paying it

Route every core read through the capability module that
`specs/014-cobros-in-links` introduces (`apps/api/src/integrations/capabilities.ts`,
D18): the customers door, the link act, validation, the provisional
promise, the reconnection queue and the cron sweep ask
`capabilitiesOf(...)`. `classes.ts` reads the absorb-overpayment fact as a
capability. Rename the contract fields and codes to the core's words
(`integration`, `INTEGRATION_*`, a customer reference), in one change
across the API, the admin, MSW and the Playwright stubs. The copy on core
screens takes the provider's name from the integration, not from a
literal. This is a feature of its own and starts at `/speckit-specify`.

Confirm on the tree:
- `grep -rln "wisphub/" apps/api/src --include=*.ts | grep -v "^apps/api/src/wisphub/" | grep -v "^apps/api/src/integrations/capabilities.ts" | grep -v "^apps/api/src/routes/integrations/"`
  prints nothing: only the entry point and the integration's own setup
  routes reach the adapter;
- `grep -rn "wisphub" apps/api/src/routes/direct-payments/schema.ts apps/api/src/routes/payments/schema.ts`
  finds no field or code;
- `grep -rn "WispHub" apps/admin/src/features/links` finds nothing.

**Trigger**: the first business, or the first spec, that needs a provider
other than WispHub; or any new core read that would otherwise have to
call `wisphubFor` again.

## Notes

- Opened with constitution v1.7.0 (Principle IX), whose Governance says a
  gap between code and constitution is registered, never tolerated
  silently.
- `specs/014-cobros-in-links` (D18) adds no new leak. It pays two anchors
  (`payment-requests/handler.ts`, `wisphub/money.ts`), and keeps `usuario`
  on purpose so the vocabulary is renamed once, here, not split.
- Related: `wisphub-host-is-platform-wide`, another WispHub-only
  assumption, about the provider's address.
- *2026-10-01, `specs/018-cash-at-stores` D9 (T017):* the **action**
  anchors are paid. The three action call sites — the first attempt in
  `direct-payments/validation.ts` (`settleConfirmed`), *Ejecutar ahora* and
  *Reintentar* in `routes/payments/handler.ts`, and the sweep in
  `reconnection/queue.ts` — call the integration's `paymentActions`
  capability; `attemptReconnection` is imported only by the adapter's own
  `wisphub/actions.ts`, and its failures reach the core as
  `INTEGRATION_AUTH_FAILED` / `INTEGRATION_UNAVAILABLE` (the panel reads
  both, and still reads the `WISPHUB_*` codes of older rows). The **read**
  anchors stay open: `validation.ts` still builds `wisphubFor` and reads
  `readPendingInvoices` / `debtFor` for the debt, and
  `routes/payments/handler.ts` imports `pendingVersion` from
  `wisphub/cache`. Cash at stores adds no new leak: its routes and the cash
  book import nothing from the adapter (T061's grep).
