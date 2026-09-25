# Quickstart: Cobros in Links

How to prove the feature works. It has three parts: the measurements the
design waits on, the automated suites, and a walk through the real app.
Shapes are in [data-model.md](./data-model.md) and
[contracts/](./contracts/). This page does not repeat them.

## 0. Measure first (before any adapter code)

Three reads decide details research left open (D2, D5, D10). Run them in
Postman against the demo tenant, **and** against the pilot with a
read-only request, and record each result in research.md under its
decision. Nothing here writes.

| # | Request | What to record | Decides |
| --- | --- | --- | --- |
| M1 | `GET /facturas/?estado=1&tipo_fecha=fecha_emision&desde=<180 d ago>&hasta=<tomorrow>&limit=2` | the shape of `next` (`offset=` or `page=`); whether `count` is present | D2's cursor numbers; FR-007's count |
| M2 | `GET /clientes/<id_servicio>/saldo/` for three customers: (a) one open invoice, (b) two open invoices, (c) paid short, no open invoice | `facturas[]` against the same customer's rows in `/facturas/?estado=1`; whether an invoice older than 180 days appears | D10: the door is used only if (a) and (b) match the list and (c) answers none |
| M3 | the first row of M1 | the JSON type of `saldo` and `sub_total` (string or number); the `articulos[].descripcion` text | D5's parsing |

If M2 disagrees with the invoice list, **stop**, and take the difference
to the creator. D9 and D10 are reopened; they are not coded around.

## 1. Automated checks (the CI order)

```sh
node scripts/spec-lint.mjs
node scripts/contrast-lint.mjs            # the two new StatusBadge statuses, both themes
node scripts/pending-lint.mjs             # "Consultando adeudo" sits inside <Pending>
pnpm -r --if-present typecheck
pnpm --filter @devolada/api test -- test/cobros-in-links.test.ts
pnpm --filter @devolada/admin test -- test/cobros-in-links.test.tsx
pnpm --filter @devolada/api test          # payment-requests, presence-freshness and pending-invoice-cap still pass
pnpm --filter @devolada/admin test        # links, cobros (redirect only), shell
pnpm e2e                                  # links.spec.ts: the chip at 360/768/1280, no horizontal scroll
```

What each suite must show is listed in research D17. The two
measurement-shaped cases are required, not optional:
- **the billing cycle**: 299.00 carried, then 798.00 open, and 1,097.00
  never;
- **SC-006**: the door returns the live rows while a seeded snapshot says
  otherwise.

## 2. In the app (local)

```sh
pnpm --filter @devolada/api dev
curl -X POST localhost:8787/dev/seed        # demo ISP: demo@devolada.app / devolada123
pnpm --filter @devolada/admin dev           # http://localhost:5174
```

To see live invoices, put the demo WispHub key in
`apps/api/.dev.vars` as `WISPHUB_API_KEY`. Without it, the seed connects
no provider, and step 6 is what you should see.

1. **Links is unchanged.** Open **Links**. The customer view opens, the
   same as `main`, with *Todos* chosen.
2. **The chip (US1).** Press **Por cobrar**. The address gains
   `view=receivables` and the first block of open invoices appears,
   grouped by customer, with *Venció* / *Vence* and the count
   "N facturas abiertas". Scroll: the next block arrives. Stop: nothing
   more is read (network panel).
3. **A row (US1).** Open a row: each invoice shows its period, its total
   and, when present, its *saldo anterior*. Press **WhatsApp**: the
   customer's chat opens with the link.
4. **Search (US3).** Type three letters of a customer who paid short.
   They appear with the remainder as what they owe. A customer who owes
   nothing reads *Sin adeudo*. Each row shows "Consultando adeudo" until
   its answer arrives, never a zero.
5. **The address (US2).** Go to Pagos and back, press back, reload: still
   on Por cobrar with the same text. Open `/payment-requests`: it lands on
   `/links?view=receivables`. The menu has no Cobros.
6. **No WispHub (US4).** Log in as a business with no integration. There
   is no Por cobrar chip. An address with `view=receivables` falls back to
   the customer view.
7. **WispHub away (US4).** Cut the API's network to WispHub (for example,
   take the machine offline after the page has loaded once) and reload on
   Por cobrar. The page says it could not read the open invoices
   and offers Reintentar. It never says nobody owes.
