# Spike: partial payments and the reconnection charge

**Status: written 2026-08-19, not executed — blocked on WispHub access (see "Blocker").**

The question behind this spike: a suspended customer owes the monthly fee **plus a
reconnection charge**, and very often transfers only the monthly fee. Today the
direct-payment channel answers `AMOUNT_MISMATCH` and the store counter does not
notice at all. Before any spec is written, four things must be measured against a
real WispHub tenant, because each answer changes what gets built.

This spike produces **findings, not code**. Its results land in
`docs/integrations/wisphub.md` (the verified contract), and only then does the
spec get written.

## What the owner already decided (2026-08-19)

These are settled and the spike serves them; it does not re-open them.

1. **Research first.** No spec until the probes answer.
2. **A partial payment leaves the customer without service.** Reconnection
   happens only when the invoice is paid in full.
3. **The page is brutally honest**: *"Recibimos $499 de $649; tu servicio se
   reactivará cuando llegue el resto."*
4. **The service fee stays as it works today** — every transfer payment carries
   the automatic validation charge. *(Open, not for this spike: whether that
   charge is billed to the customer or to the ISP, for legal reasons.)*
5. **Surplus money**: if WispHub can hold a credit, use it. If it cannot, the
   extra money simply stays with the ISP and is recorded as a number. Devolada
   makes no promise about it and keeps no credit book of its own.
6. **No partial payments at the store counter.** The store channel gets the
   invoice-total fix (P1) and nothing else.

## Why decision 2 makes P2 and P3 the centre of this spike

Devolada does not reconnect anybody. WispHub does, on its own, when a payment is
registered and `auto_activar_servicio` is on (spike 2026-08-13, verified on a
real router 2026-08-17).

So "a partial payment leaves the customer without service" is **not something
Devolada can decide by itself**. If WispHub reactivates on any registered
payment, then honouring decision 2 means Devolada must **not register the
partial payment in WispHub at all** — and then the money sits in the ISP's
account while WispHub still shows the whole debt. That is a bookkeeping hole,
and P3 exists to find out whether WispHub has a way to close it.

## Probes

Every probe runs with `curl` from the laptop against the demo tenant. `wrangler
dev` cannot reach `api.wisphub.net` (workerd limitation, wisphub.md), but curl
can, and that is enough — these are reads and one controlled write.

Test customer: `0011@wifiplus` (Leo Licona, IP 192.168.1.1, zone "Router Test
Demo"), suspendable, wired to the CHR lab router.

### P1 — Where does the reconnection charge live?

**Question.** When WispHub suspends a customer and later charges for the
reactivation, is that charge a **line inside the pending invoice**, or its
**own invoice**?

**How.** Suspend `0011@wifiplus` from the panel, wait for WispHub to produce the
charge, then read the pending invoices and open one in detail:

```sh
curl -s -H "Authorization: Api-Key $KEY" \
  "https://api.wisphub.net/api/facturas/?estado=1&tipo_fecha=fecha_emision&desde=<-180d>&hasta=<today>&limit=100"
curl -s -H "Authorization: Api-Key $KEY" \
  "https://api.wisphub.net/api/facturas/<id>/"
```

Read `articulos[]`, `sub_total`, `total`, and compare against `precio_plan` on
the customer record.

**What each answer means.**

- **A line inside the invoice** → the `AMOUNT_MISMATCH` case described by the
  owner does not exist today. Devolada would be quoting `precio_plan` while the
  invoice says more, so the customer who transfers "only the monthly fee"
  *matches* our expected total and passes — and `registerPayment` sends
  `total_cobrado` short of the invoice. The bug is that we undercharge, in
  **both** channels, and it is bigger than the feature that was asked for.
- **Its own invoice** → the owner's case is real. D15 ("one invoice at a time,
  oldest first") then shows the payer one of the two invoices alone, and the
  page's total is honest but incomplete.

**Either way**: Devolada must read the invoice `total` instead of `precio_plan`.
`pendingInvoices()` currently keeps only `id_factura` and `cliente.usuario`
(`apps/api/src/wisphub/client.ts:231`). `debt-truth.spec.md` D1 already ruled
that the invoice list is the truth about *whether* a customer owes; the amount
is the same argument, left unfinished.

### P2 — Does a partial payment reactivate the service?

**Question.** With `auto_activar_servicio` on, does `registrar-pago` with
`total_cobrado` **below** the invoice total still trigger the reactivation?

**How.** This is a physical observation, not an API read. Relaunch the CHR lab
(see the `chr-lab` note), confirm `0011@wifiplus` is suspended — its IP is in
the router's `Moroso` address-list — then register a deliberately short
payment and watch the router:

```sh
curl -s -X POST -H "Authorization: Api-Key $KEY" -H "Content-Type: application/json" \
  -d '{"forma_pago":<id>,"accion":1,"fecha_pago":"<YYYY-MM-DD hh:mm>","total_cobrado":<total minus the reconnection charge>}' \
  "https://api.wisphub.net/api/facturas/<id>/registrar-pago/"
```

Then, on the router: `/ip firewall address-list print where list=Moroso`.
Also re-read the invoice `estado` (1 pending / 2 paid) and the customer's
`estado`.

**What each answer means.**

- **It reactivates** → decision 2 cannot be honoured by registering the payment.
  Go to P3.
- **It does not reactivate, and the invoice stays pending** → the happy answer.
  WispHub already models what the owner decided: the abono is recorded, the debt
  stays open, the service stays off, and the second transfer closes it.
- **It refuses the short amount outright** → Devolada must hold the partial
  payment on its own side, and P3 becomes the only way to keep WispHub honest.

### P3 — Can a payment be recorded without reactivating?

**Question.** Does `registrar-pago` have a mode that records money against an
invoice without closing it and without triggering the router flip?

**How.** `OPTIONS` is the real documentation on this API (spike finding):

```sh
curl -s -X OPTIONS -H "Authorization: Api-Key $KEY" \
  "https://api.wisphub.net/api/facturas/<id>/registrar-pago/"
```

Look for the choices of `accion` — the 2026-08-13 spike found `1` works and
called it *"the only value accepted of those probed"*, which is not the same as
"the only value". Also check whether the invoice resource exposes an amount
already paid (`abonado`, `saldo_factura` or similar), because without one
Devolada cannot know what remains and D15's page cannot show it.

**Why it matters.** If nothing here exists, then a partial payment is invisible
to WispHub, and the ISP's own system will keep showing the full debt for a
customer who already paid part of it. That is a cost the owner has to accept
knowingly, and the spec has to name it.

### P4 — Can WispHub hold a credit, and what happens on overpayment?

**Question A.** Is `saldo` writable? It exists on the customer record (spike
2026-08-13, list serializer).

```sh
curl -s -X OPTIONS -H "Authorization: Api-Key $KEY" \
  "https://api.wisphub.net/api/clientes/<id_servicio>/"
```

The same probe that killed the `telefono` write-back on 2026-08-17: read the
PUT-writable field list and see whether `saldo` is one of them.

**Question B.** What does `registrar-pago` do with `total_cobrado` **above** the
invoice total? Register one peso over on a test invoice and read back the
invoice and the customer's `saldo`.

**What each answer means.** If `saldo` is writable and the surplus lands there,
the credit-to-next-cycle idea is free. If it is read-only — the likely outcome,
given `telefono` — decision 5 applies: the extra money stays with the ISP,
Devolada records the CEP amount next to the applied amount on the
`direct_payments` row, shows the difference in the admin feed, and promises
nothing.

**Note on scale.** Most overpayments will be a customer rounding up ($500
against $508), not a real credit. A tolerance band handles those and needs no
WispHub feature at all. Question B decides whether the tail is worth more than
that.

## Blocker (2026-08-19)

**The demo tenant's API key is rejected.** `WISPHUB_API_KEY` in
`apps/api/.dev.vars` (41 chars, clean) answers **403** on `/clientes/`,
`/facturas/` and `/formas-de-pago/` alike:

```json
{"detail": "Usted no tiene permiso para realizar esta acción."}
```

WispHub sends the same generic 403 for "no permission" and for a bad key
(wisphub.md), so this cannot be told apart from the outside. Most likely the
demo account lapsed or the key was rotated in the panel.

To unblock: sign in to the demo panel (`wifiplus`), Mi Empresa > Staff >
regenerate the API Key, and update `apps/api/.dev.vars` plus the dev-environment
secret. If the demo account itself expired, `wisphub.md` keeps the fallbacks —
a new demo account, or the `garzasoftware/wisphub-clone` local clone (which
would answer P1, P3 and P4 but **not** P2, since it has no router).

## Where the findings land

- The measured contract → a new section in `docs/integrations/wisphub.md`, like
  the `telefono` and latency sections.
- The invoice-total fix (P1) → a new decision in `charges/debt-truth.spec.md`;
  it is D1's argument finished, and it touches both channels.
- Partial payments → a new spec under `docs/direct-payment/` with its own
  US-ID. It **reverses** direct-payment D11 (*"a debt is paid whole or not at
  all in v1"*), so it must be a new decision that names D11, never an edit of
  it.

---

## Findings — read-only round (2026-08-19)

Key rotated by the owner; the demo tenant `wifiplus` answers again (10 customers,
ids 1–10, all `Activo`, one pending invoice). Everything below is measured, not
inferred.

### F1 — `saldo` on the customer is read-only, and it is not a credit anyway (P4A: answered)

`OPTIONS /clientes/10/` lists **34 PUT-writable fields** and `saldo` is not one
of them — the same answer `telefono` gave on 2026-08-17.

It goes further than "read-only". Across the tenant, `saldo` tracks **what the
customer owes**, not a credit purse: `arellano@wifiplus` reads `saldo 3.00` with
a pending invoice, and every customer whose invoices are paid reads `saldo
0.00`. So there is no field here to park a surplus in, writable or not.

**Consequence: decision 5's fallback is the only path.** The extra money stays
with the ISP; Devolada records the CEP amount next to the applied amount and
promises nothing. The credit-to-next-cycle idea is dead unless P4B shows
`registrar-pago` itself doing something with an excess.

### F2 — The invoice total is already in our hands, and we throw it away (P1: half answered)

Each row of `GET /facturas/?estado=1` already carries `total`, `sub_total`,
`descuento`, `impuestos_total`, `saldo`, `saldo_nuevo`, `total_cobrado` **and
the full `articulos[]`** with per-line `descripcion`, `precio`, `cantidad`.

`pendingInvoices()` (`apps/api/src/wisphub/client.ts:231`) fetches all of it and
keeps two fields: `id_factura` and `cliente.usuario`.

**So reading the invoice total costs zero extra WispHub calls** — it is a
mapping change inside a call both channels already make, not a new request on
the charge path. Much cheaper than assumed, and it removes the reason the bug
was invisible: on this demo tenant `total` happens to equal `precio_plan`
(3.00 = 3.00), because there are no discounts, no proration and no suspended
customers. The invoice's own line already says *"Total dias a pagar: 31"*, so
proration exists as a concept and will break that coincidence in production.

Still open: whether a reconnection charge shows up as an extra `articulo` or as
its own invoice. Every customer in the tenant is `Activo`, so nothing has been
suspended for WispHub to charge for. That needs the write round.

### F3 — There is no charges endpoint, and `OPTIONS` on the payment action is broken (P3: route closed)

- `/cargos/`, `/pagos/`, `/reconexiones/`, `/planes/`, `/conceptos/` → **404**.
  `/tickets/` → 200. So no separate resource models a reconnection charge; it is
  either a line inside the invoice or a panel-only concept.
- `OPTIONS /facturas/<id>/registrar-pago/` → **HTTP 500, an HTML error page**.
  The vocabulary of `accion` cannot be discovered; it can only be probed by
  trying values.

### F4 — WispHub does model a per-invoice balance, and it is writable

`OPTIONS /facturas/2/` — 30 PUT-writable fields:

| field | writable | meaning to confirm |
|---|---|---|
| `saldo` | **yes** (`float`) | balance left on the invoice? |
| `saldo_nuevo` | **yes** (`float`) | balance after this payment? |
| `total_cobrado` | **yes** (`float`) | amount actually collected |
| `total`, `sub_total`, `descuento` | yes | |
| `estado` | **no** (`read_only: true`) | WispHub-managed, as the 2026-08-13 spike found |
| `articulos` | **no** | lines cannot be added through this resource |

The fields a partial payment would need **exist**. What they mean when
`registrar-pago` runs short is the question the write round has to answer.
Today the pending invoice reads `total 3.0`, `total_cobrado 3.0`, `saldo 0.0`,
`saldo_nuevo 0.0` — so `total_cobrado` on a *pending* invoice is clearly not
"collected so far". Its semantics are unknown.

### F5 — Contract correction: `estado` on the customer IS writable

`docs/integrations/wisphub.md` says *"`estado` is WispHub-managed (not
writable)"*. `OPTIONS /clientes/10/` disagrees: `estado` is
`{"type": "string", "required": true, "read_only": false}`. Read-only is true of
the **invoice** `estado`, not the customer's. This matters here because it means
a customer can be suspended through the API to trigger P1, instead of by hand in
the panel.

### F6 — The CHR test customer is gone (P2: blocked again, differently)

`0011@wifiplus` — the customer wired to the CHR lab router on 2026-08-17 — no
longer exists in the tenant. The 10 customers are ids 1–10 and none is it. P2's
physical observation needs that customer re-created and re-linked to the router
zone, with the CHR lab running.

## What is left, and what it costs

| Probe | State | Needs |
|---|---|---|
| P1 (where the charge lives) | half | a **write**: suspend a customer, wait for the charge |
| P2 (does a partial payment reconnect) | blocked | CHR lab up + a linked customer |
| P3 (record without reactivating) | route closed | a **write**: probe `accion` values empirically |
| P4A (`saldo` writable) | **answered: no** | — |
| P4B (overpayment behaviour) | open | a **write**: `total_cobrado` above `total` |

## Findings — lab round (2026-08-20)

### F7 — The CHR lab is up and still linked to the tenant

Verified over SSH (`ros-cmd.expect`, `CHRDIR` = the original session's scratchpad,
which survived):

- **RouterOS 7.24, uptime 2d 16h.** The disk `chr-run.img` is being written, and
  QEMU is running with one port forward the `chr-lab` note does not record:
  `18728 → 8728`, the RouterOS API port. Worth adding to that note.
- **The WispHub tunnel is `RUNNING`**: `sstp-client "WispHub VPN"` →
  `vpn6.wisphub.net:443`, VPN address `172.27.20.176/32` — the same address as
  2026-08-17. The router is still the tenant's "Router Test Demo".
- **The panel user survived.** `/user print` shows `admin`, the VPN user
  `wisphubvaddyt0je45w9ql`, and `wisphub` (group `full`, last login
  2026-08-18) — so the VPN script did not eat it this time. `/log print` shows
  no `login failure for user wisphub`.

So P2 does **not** need the lab rebuilt. It needs a customer.

### F8 — The router carries suspensions for customers that no longer exist

```
/ip firewall address-list print
  ;;; 0012   Moroso  192.168.1.15   2026-08-18 00:52:45
  ;;; 0013   Moroso  192.168.1.5    2026-08-18 00:55:13
```

Two customers were created and suspended on 2026-08-18 — after the 2026-08-17
rehearsal — and neither `0012` nor `0013` is in the tenant today (the API lists
10 customers, ids 1–10). **WispHub cut them on the router and never lifted the
cut when they were deleted.**

This matters twice. For the spike: a leftover `Moroso` row can be misread as
"still suspended", so P2 must key on the **new** customer's own IP and clear
these two first. For the product: it is evidence that WispHub's router state and
its customer list can disagree, which is the same class of lag `debt-truth`
already found in `estado_facturas`.

### F9 — The API key dies after a burst

The rotated key answered `200` on `/clientes/`, `/facturas/` and
`/formas-de-pago/`, served roughly ten calls including two `OPTIONS`, and then
went back to **403 `"Usted no tiene permiso para realizar esta acción."`** on
every endpoint, permanently — three retries three minutes apart, all 403.

The same happened to the previous key. So this is not "the old key expired": a
demo-tenant key appears to be revoked or throttled after a short burst, and
WispHub reports it with the same generic 403 it uses for a bad key. Whatever the
cause, **the spike's write round cannot be planned around long API sessions**;
it needs the writes batched into the smallest possible number of calls, right
after a fresh key.

If this turns out to be a rate limit rather than a demo quirk, it belongs in
`wisphub.md` next to the stall measurement — an ISP's key going 403 mid-day
would look exactly like `WISPHUB_AUTH_FAILED`, which the adapter treats as a
setup problem and not an outage.

## Next step

The lab is ready; the tenant is not reachable. To run P1–P2 the owner needs a
working key, and the new customer is better created **by hand in the panel** than
through the API: `POST /clientes/` needs `plan_internet`, `router`, `zona` and
`ip` as nested objects, and every one of those lookups is a call the key may not
survive.

What the customer needs to be, to serve P2:

- in the **"Router Test Demo"** zone, so the CHR is the router that enforces it;
- with a **free IP on 192.168.1.0/24** that is not `192.168.1.5` or
  `192.168.1.15` (F8);
- `auto_activar_servicio` **on**;
- a plan whose price is known, so a partial payment can be aimed precisely.

Then, in one short API session: suspend → read the invoice (P1) → register a
short payment → read the router (P2).

### F10 — The daily demo account explains F9, and it orphans the lab (2026-08-20)

The owner creates a **new WispHub demo account every day**. That is the cause of
F9: the key is not being throttled, the tenant behind it simply stops existing,
and WispHub reports that with the same generic 403 it uses for a bad key.

The tenant is reseeded whole. Today it holds ids 1–10, the same `@wifiplus`
usernames as before (jacruz, valeperez, jcobos…), zones **"Zona dia 1"** and
**"Zona dia 15"**, routers **"Router dia 1"** and **"Router dia 15"**, and IPs on
`192.168.7.0/24`.

**So the CHR is not a router of today's tenant.** Its tunnel reads `RUNNING`
with the same VPN address as on 2026-08-17, which is exactly what makes this
easy to miss: the link is alive to `vpn6.wisphub.net`, but the VPN user
`wisphubvaddyt0je45w9ql` belongs to a tenant that is gone, and no zone in today's
account points at it. The stale `Moroso` rows in F8 are the residue of the same
thing — cut by a tenant that no longer exists to lift the cut. They were removed
on 2026-08-20 and the list is now empty.

**Consequence for P2.** The lab does not need rebuilding, but it needs
**re-linking every day**: re-run WispHub's VPN script from the day's panel, then
re-create the panel's `wisphub` user, which that script deletes (chr-lab note).
Only then is a suspended customer's cut observable on the CHR.

**Consequence for P1.** P1 needs no router at all — it is pure WispHub billing.
It can run against any day's tenant, in one short burst, before the key dies.
That makes P1 the probe to run first, and P2 the one to schedule around a
re-linked lab.

## Findings — P1 attempt (2026-08-20)

### F11 — A customer with no debt cannot be suspended, and `OPTIONS` lies about it

`PATCH /clientes/5/ {"estado": "Suspendido"}` on `jcobos@wifiplus` answered
**200** and echoed `"estado":"Suspendido"` in the response body. Reading the
customer back moments later: **`"estado": "Activo"`**.

So the change does not stick. `OPTIONS /clientes/5/` reports `estado` as
`{"type":"string","required":true,"read_only":false}` — **this corrects F5
above, which took that at face value.** Whether WispHub refuses the write or
accepts it and a background rule immediately reverts it cannot be told from
outside, but the effect is the same, and the likely rule is visible in the same
record: `facturas_pagadas: true`, `saldo 0.00`, no pending invoice. **WispHub
suspends for non-payment; a customer who owes nothing does not stay cut.**

This is the second field to behave this way — `telefono` (2026-08-17) echoed and
did not persist either. On this API, **an echoed PATCH is not evidence of a
write**; only a fresh read is.

### F12 — P1 cannot be answered on a one-day demo tenant

Today's tenant was seeded at 01:30 and holds **zero invoices** — `GET /facturas/`
answers `count 0` with no filter, with `estado=1` and with `estado=2` alike. The
customers' `fecha_corte` is **2026-09-07**, weeks after the tenant will be gone.

So the billing run that would produce both the debt and any reconnection charge
never happens inside the life of a demo account. And there is no way around it
through configuration: `/cargos/`, `/configuracion/`, `/facturacion/`,
`/cortes/`, `/reconexion/`, `/empresa/` all answer **404**. No API resource
models a charge or a billing setting.

Creating an invoice by hand does not help either: `POST /facturas/` takes the
`articulos` we send, so it would only measure our own input.

**Verdict: P1 is not answerable here.** Where its answer has to come from
instead, in order of cost:

1. **The pilot ISP's real tenant** — it has genuinely suspended customers with
   whatever reconnection charge the ISP actually applies. This is the only place
   the truth exists, and the pilot needs to happen anyway.
2. **The WispHub panel's billing configuration** — whether "cobrar reconexión"
   is a setting at all, read by eye, not by API.
3. **WispHub support**, as a last resort.

### What P1's silence does *not* block

F2 stands on its own: **Devolada must read the invoice `total` and `articulos`
instead of `precio_plan`, and it costs zero extra calls.** That is correct
whether the reconnection charge is a line inside the invoice or its own invoice,
so the fix is not waiting on this probe.

Only one thing genuinely depends on P1's answer: **D15's "one invoice at a time,
oldest first"**. If the reconnection charge is its own invoice, the payment page
shows a suspended customer one of two invoices and asks for an amount that will
not reconnect them — and that is a spec question, not a code question.

## Lab rebuild — what is blocked and why (2026-08-20)

`wisphub-vpn.rsc` in the lab directory is self-contained and re-runnable, but its
credentials are **per router, issued by the panel**:

```
/interface sstp-client add ... user="wisphubvaddyt0je45w9ql" password="0hs2p7..."
/user add name="wisphubvaddyt0je45w9ql" password="0hs2p7...67135" group=wisphub
```

Those belong to a tenant that no longer exists, which is why the tunnel reads
`RUNNING` while today's account has never heard of the CHR (F10). **A new script
has to be issued from the day's panel** — Mi Empresa → Routers → add router →
copy the script — and nothing in the API can generate it (`/routers/`,
`/routers-mikrotik/`, `/mikrotik/`, `/equipos/` → 404).

The script's own line `/user remove [find where name ~"wisphub"]` is what
deletes the panel user, so re-creating it afterwards is part of the procedure,
not an accident (chr-lab note).

Once the day's script exists, pasting it and re-checking takes minutes — the
lab itself never needed rebuilding.

### F11 corrected — suspension needs a real router (owner, 2026-08-20)

F11 above guessed that the suspension reverted because the customer owed
nothing. The owner supplied the real reason: **WispHub cannot suspend a customer
without a real router behind them.** The cut is an action on the router — an
entry in the `Moroso` address-list (chr-lab) — so with no reachable device there
is nothing to apply, and the state falls back to `Activo`.

Today's customers sit on **"Router dia 1"** and **"Router dia 15"**, which are
part of the daily seed and answer to nothing. That is why the PATCH echoed and
did not stick, and it means the `facturas_pagadas: true` theory should not be
carried into the spec.

This tightens the dependency chain to a single line:

> P1 needs a suspended customer → suspension needs a real router → the only real
> router is the CHR → the CHR needs re-linking to the day's tenant → re-linking
> needs the VPN credentials the panel issues per router.

Every link is measured except the last, and the last is where the spike is stuck.

### F13 — A customer cannot be moved between zones through the API (2026-08-20)

Zone and router are **one to one** in WispHub (`Zona dia 1` ↔ `Router dia 1`,
`Zona dia 15` ↔ `Router dia 15`), and the customer inherits the router from the
zone. The schema agrees: on `OPTIONS /clientes/{id}/`, `zona.id` is writable
while **`router.id` is `read_only`** (only `router.nombre` is writable, which
would rename the router, not reassign it).

But the write does not work. `PATCH /clientes/5/ {"zona":{"id":71419}}` answers
**HTTP 500** with an HTML error page, with or without an `ip` sent alongside it,
and the customer stays in its original zone.

`/zonas/` answers **403**, not 404 — the endpoint exists but the demo key cannot
read it, so the zone id could only be taken from the panel URL
(`/router/editar/router-test-demo-wifiplus-71419/`).

This is the third write-or-metadata route on this API to answer 500 rather than
a status code that means anything (`OPTIONS /facturas/{id}/registrar-pago/` is
another). **Consequence for the spike**: anything that moves a customer between
zones has to be done in the panel by hand. **Consequence for the product**: none
directly — Devolada never assigns routers or zones — but it is one more reason
the adapter treats any non-2xx from WispHub as an outage rather than trying to
interpret it.

---

# Findings — the measured round (2026-08-20)

The lab was re-linked (new VPN user, VPN address `172.27.20.177`) and the owner
created `0013@wifiplus` ("Ismael") in the CHR's own zone, IP `192.168.1.7`,
suspended by hand from the panel. That gave the spike what it had been missing:
**a real router enforcing a real cut**, observable in `Moroso`.

Everything below was measured in one burst against that customer.

### F14 — WispHub models partial payments natively, as a running customer balance

`POST /facturas/1/registrar-pago/` with `total_cobrado: 40.00` against an invoice
whose `total` is `100.00` answered **200**:

```json
{"messages":[
  "Se aplico un saldo pendiente de pago de 60.00 al cliente 0013@wifiplus, por registrar un monto menor al total de la factura.",
  "Se agrego correctamente el pago"],
 "task_id":"05ef8b46-…"}
```

Afterwards:

| | value |
|---|---|
| invoice `estado` | **`Pagada`** |
| invoice `total` / `total_cobrado` | `100.0` / **`40.0`** |
| invoice `saldo_nuevo` | `60.0` |
| customer `saldo` | **`60.00`** |
| customer `estado_facturas` | **`Pagadas`** |

So a short payment is accepted, **the invoice is closed as paid anyway**, and the
remainder moves to a customer-level `saldo`. P3's question — "can a payment be
recorded without closing the invoice?" — is answered sideways: it cannot, and it
does not need to be, because WispHub carries the debt on the customer instead.

**The payment applies to the customer's whole debt, not to the invoice.** Proved
by the second test: with `saldo 60.00` already carried, a new invoice of `10.00`
and a payment of `25.00` answered *"se aplico un saldo pendiente de pago de
**45.00**"* — that is `60 + 10 − 25`. The message's wording (*"por registrar un
monto menor al total de la factura"*) is wrong in that case, since 25 > 10; the
arithmetic is what tells the truth. **It is a running account, not an invoice
ledger.**

### F15 — A partial payment reconnects the service. Decision 2 is not implementable as stated

This is the one the product decision hung on, and it is a physical observation,
not an inference. The CHR's own log:

```
07:46:47  address list entry added   by api:wisphub…@10.134.35.132
          (/ip firewall address-list add address=192.168.1.7 comment=0013 list=Moroso)
07:49:16  address list entry removed by api:wisphub…@10.134.252.130
          (/ip firewall address-list remove *8)
```

**WispHub itself lifted the cut, over the API, after a payment of 40 against
100.** `Moroso` went to zero entries and the customer's `estado` went from
`Suspendido` to `Activo` — while still owing `60.00`.

Nothing in `registrar-pago` was found that changes this, and `accion` could not
be enumerated (F3: `OPTIONS` on that route answers 500).

**Consequence for owner decision 2** (*"a partial payment leaves the customer
without service; reconnection happens only on full payment"*): Devolada cannot
deliver it by registering the payment. The only way to keep a short payer
disconnected is to **not register the payment at all** — and that now costs more
than it did when the decision was made, because registering it is exactly what
makes the ISP's own books right (F14).

Which puts a third option on the table that did not exist before the measurement:
**accept the short payment, register it, let WispHub carry the remainder as
`saldo`, and let the customer be reconnected.** The ISP is made whole in their
own system, the debt is not forgotten, and the customer who transferred the
monthly fee without the reconnection charge simply carries that charge forward.
That is what WispHub was built to do, and it is probably what ISPs already do at
the counter.

### F16 — WispHub holds a credit natively, as a negative `saldo`. Decision 5's good branch

Forcing a genuine overpayment — debt `50.00`, payment `60.00`:

```json
{"messages":[
  "Se aplico un saldo a favor de -10.00 al cliente 0013@wifiplus, por registrar un monto mayor al total de la factura.",
  "Se agrego correctamente el pago"]}
```

Customer afterwards: **`saldo: "-10.00"`**.

So **the credit-to-next-cycle idea works, and costs nothing to build.** Devolada
registers the amount actually received; WispHub does the rest. There is no field
to write (F1 stands: `saldo` is read-only), no credit book on our side, and no
promise for Devolada to keep. There is even a `Saldo a Favor` payment method in
the tenant (`forma_pago` id 1550), so the concept is first-class in the product.

This **supersedes F1's conclusion**: `saldo` being read-only turned out not to
matter, because it is a derived running balance that `registrar-pago` maintains.

### F17 — The debt model has a hole, and it is live today

This one is not about partial payments. It is about what Devolada believes right
now.

`debt-truth.spec.md` D1 makes the **pending-invoice list** the single source of
truth for "does this customer owe". F14 breaks that: after a partial payment the
invoice is `Pagada`, the pending list is **empty**, `estado_facturas` reads
**`Pagadas`** — and the customer owes `60.00`, carried in `saldo`.

Measured on `0013@wifiplus` at that moment: zero pending invoices, label
`Pagadas`, `saldo 60.00`.

What Devolada would do with that customer today:

- search and the payment page → **`paid`**, "al corriente" / "Sin adeudo";
- `POST /charges` → **409 `NOTHING_DUE`** (D5 guard), so the shopkeeper *cannot*
  charge them;
- the SPEI link → shows no debt, so they cannot pay either.

**A customer who owes money is invisible and uncollectable through both
channels.** And this needs no partial payment from Devolada to happen — any ISP
that takes a short payment by hand in their own panel produces it.

**The fix is the same shape as F2 and just as cheap:** `saldo` is already in the
customer list serializer we fetch on every search, quote and charge. Reading it
costs **zero extra calls**. Debt is then `pending invoices` **or** `saldo > 0`,
and the amount owed is the invoice `total` plus any carried `saldo`.

## Where the spike stands

| Probe | Answer |
|---|---|
| P1 — where the reconnection charge lives | **still open** — needs a real billing run; a hand-made suspension produces no charge (F12) |
| P2 — does a partial payment reconnect | **yes** (F15), observed on the router |
| P3 — record a payment without reactivating | **no, and unnecessary** (F14) |
| P4A — is `saldo` writable | no (F1), and it does not matter (F16) |
| P4B — overpayment | **credit, automatically** (F16) |

## What the owner has to decide now

1. **Decision 2 is contradicted by F15.** Either Devolada refuses short payments
   outright (register nothing, and the money sits unrecorded in the ISP's
   account), or it accepts them and the customer gets reconnected while carrying
   the balance. There is no third mechanism inside WispHub.
2. **Decision 5 is resolved by F16** — the credit works natively, so the
   "record a number and promise nothing" fallback is not needed.
3. **F17 is not part of this feature and should not wait for it.** It is a live
   defect in `debt-truth`, reachable today, with a zero-cost fix.

### F18 — The model, stated exactly (2026-08-20)

Repeated with clean arithmetic on `0013@wifiplus`, reading the message rather
than the clock (the tenant was being edited in the panel at the same time, so
`saldo` moved between reads and invoice ids were not sequential):

```
saldo 0.00 → invoice 10.00, paid 25.00 → "saldo pendiente de 13.00"
saldo 13.00 → invoice 40.00, paid 10.00 → "saldo pendiente de 43.00"   (13 + 40 − 10)
```

The first line only balances with ~28.00 of other unpaid invoices present, which
is the point: **`saldo` the field is the *carried* balance and does not include
pending invoices, but `registrar-pago` computes against carried `saldo` plus the
pending invoices.** So:

> **total owed = Σ(pending invoice totals) + `saldo`**
> **`saldo`ₙₑw = total owed − amount paid**, and a negative result is a credit.

Every measurement of the day fits this one formula, including the credit case
(`45 + 5 − 60 = −10`) and the reconnection case (`100 − 40 = 60`, service back on).

**On decision 5 / "abonar al próximo corte":** a negative `saldo` enters that
same sum, so it reduces what the customer must pay next. That is the substance of
crediting the next cycle, and it needs no work from Devolada. **What was not
observed** is WispHub's own invoice-generation run at `fecha_corte` consuming the
credit, because no billing run happens inside a one-day demo tenant (F12). The
formula makes it near-certain; the pilot is where it gets confirmed.

## Conclusion

**The spike is done.** Four of five probes answered by measurement, and the
fifth (P1) stopped mattering: with F18, Devolada never needs to know *what* the
debt is composed of — a reconnection charge, a proration, a discount — only that
the amount owed is the pending invoice totals plus `saldo`. Whether the charge is
a line or its own invoice, it is inside that number either way.

What P1 would still change is **D15** ("one invoice at a time, oldest first"),
and F18 undermines D15 on its own: WispHub does not apply payments to invoices,
it applies them to the customer. Showing the payer one invoice describes a model
WispHub does not have. That is now a spec question with enough evidence to
decide, not a probe waiting on data.

Nothing else needs measuring before the specs are written.

### F19 — `accion` is the reconnection switch, and it makes decision 2 implementable

**This corrects F15's conclusion.** F15 said Devolada could not honour decision 2
(*"a partial payment leaves the customer without service"*) without refusing to
register the payment. That was measured with `accion: 1` only. It is wrong.

`accion` accepts exactly **two** values — probed by elimination against a live
invoice: `2`, `3` and `99` all answer **400** *"no es una elección válida"*,
while `0` and `1` answer **200**. The 2026-08-13 spike's *"the only value
accepted of those probed"* was one value short.

| | `accion: 0` | `accion: 1` |
|---|---|---|
| payment recorded | yes | yes |
| remainder → customer `saldo` | yes | yes |
| `task_id` in the response | **`null`** | a UUID |
| router touched / service reconnected | **no** | **yes** |

The `task_id` is the tell: the 2026-08-13 spike established that payment
side-effects (router, reactivation) run in WispHub's own async queue, keyed by
that id. `accion: 0` queues nothing.

**Measured physically, on the worst case.** `0012@wifiplus` — `Suspendido`, its
IP `192.168.1.4` in the CHR's `Moroso` list, and **`auto_activar_servicio:
true`** — was given a partial payment of `30.00` against an invoice of `100.00`
with `accion: 0`. Afterwards, checked three times across ~40 s:

- the router still carries `192.168.1.4` in `Moroso`;
- the customer is still **`Suspendido`**;
- `saldo` is **`72.00`** (`2 + 100 − 30`) — the money is on the books.

### F20 — `auto_activar_servicio` does not control reconnection

The mirror test says the same thing from the other side. `0013@wifiplus` with
**`auto_activar_servicio: false`** was given a partial payment with `accion: 1`
— and WispHub reconnected it anyway: the `Moroso` entry was removed by WispHub's
own API session, and `estado` went to `Activo`.

So `accion` dominates and the flag did not matter in either direction.

**This contradicts what `apps/api/src/wisphub/client.ts` believes.**
`ensureAutoActivate` carries the comment *"the opt-in switch for
payment-triggered reactivation … Defaults to false on every customer, so a
suspended customer's payment would reactivate nothing without this"*, and
`reconnection-queue.spec.md` D9 rests on it. On this tenant that is false:
`accion: 1` reconnects with the flag off.

Stated carefully, because only two combinations were measured: **`accion` decides
the reconnection on the `registrar-pago` path.** What `auto_activar_servicio`
governs elsewhere — WispHub's own payment gateways, its billing cron — was not
tested and may well be its real purpose. What is certain is that Devolada's
reconnection does not depend on it, and a spec that says it does is describing
something that was not re-verified after the 2026-08-13 spike.

## Conclusion, revised

Decision 2 **is** implementable, and cleanly:

- **full payment → `accion: 1`** — WispHub reconnects, as today;
- **short payment → `accion: 0`** — the money is recorded, the remainder lands in
  `saldo`, the ISP's books are right, and the customer stays cut until the rest
  arrives;
- **overpayment → `accion: 1`** with the real amount — the surplus becomes a
  negative `saldo`, a credit against the next cycle (F16).

Devolada therefore never has to choose between honouring the ISP's policy and
keeping the ISP's books correct. It records what actually arrived, every time,
and uses `accion` to say whether that amount earns the service back.

---

# Decisions taken (owner, 2026-08-20)

The spike is closed and these are the answers it fed. They are the input to the
specs, not the specs themselves.

1. **Short payments are accepted**, on the SPEI channel only (stores keep the
   whole-payment rule). This reverses `direct-payment` D11, so the spec must be
   a **new decision that names D11**, never an edit of it.
2. **One control, not two**: `reconnectionThresholdPercent` per ISP, default
   **100** — only a full payment reconnects. `accion: 1` at or above the
   threshold, `accion: 0` below it. No separate action switch: a threshold and an
   action switch can contradict each other, and this way the extremes (100 / 0)
   already express "never" and "always".
3. **The threshold measures the ISP's debt** — pending invoice totals plus
   `saldo` — and **excludes Devolada's service fee**. Note for the spec: the
   owner's motivating case (mensualidad 499 against a 649 debt) is **77%**, so a
   default of 100 refuses it and any threshold above 77 refuses it too. The
   number is not cosmetic.
4. **Percentage with a floor in pesos.** A percentage alone lets a token payment
   reconnect a large debt; a fixed amount alone does not scale across ISPs.
5. **The payer never sees the threshold as a percentage.** The page says what is
   missing in money ("faltan $150").
6. **Who pays the service fee is switchable — SPEI only.** In stores the
   customer always pays it, because the shopkeeper's commission is funded from
   that fee out of the cash in hand (`ledger/index.ts:74`); moving it to the ISP
   would leave the commission unfunded at the counter and break the product's
   core promise.
7. **Default: the ISP pays** (owner's decision, overriding the spike's
   recommendation of "the customer pays"). Consequence to carry into the spec,
   knowingly: Devolada's SPEI revenue becomes credit against the ISP, accrued in
   the settlement statement, and **settlement D3 still has no collection
   mechanism** — it waits on Consta. The bigger the number, the more this matters.
8. **The legal question is resolved and it supports 7.** Per PROFECO, charging
   the fee is a private agreement: if the customer absorbs it, it must be broken
   out clearly **and a free payment option must exist**; if the ISP pays it, it is
   an operating cost and the simplest legal footing. *Constraint the specs must
   carry: wherever the customer pays the fee (i.e. every store charge, and SPEI
   when the switch is off), the free alternative — paying the ISP directly — has
   to actually exist and be findable.*
9. **A short payment records a `charge` with the amount actually received**, and
   `direct_payments` gains a **`partial`** status. The money moved, so the
   platform statement must see it; none of the existing statuses
   (`validating/confirmed/invalid/expired/unapplied`) means "valid, applied,
   insufficient".
10. **F17 is fixed now, in its own spec, ahead of partial payments.** It is the
    only live defect in the list and it depends on none of the other decisions.
11. **The confirm screen gains an explicit "adeudo anterior" line.** Carried
    `saldo` is never folded silently into the mensualidad — a shopkeeper who sees
    an unfamiliar number with no explanation does not charge.
12. **D15 dies**: the page shows the total debt (pending invoices + `saldo`), not
    one invoice. WispHub applies payments to the customer, not to the invoice
    (F18).
13. **F20 gets a second measurement before any spec repeats it.**
    `reconnection-queue` D9's belief about `auto_activar_servicio` was
    contradicted once; it is corrected only after a double check, and the check
    is recorded.

## Knock-on effects the specs must handle

- **`direct-payment` D3 changes shape.** Today `speiServiceFeeCents` is added to
  what the payer is asked for. With decision 7's default, the payer is asked for
  the WispHub debt alone and the fee accrues behind the scenes. The charge row
  still carries `service_fee_cents`, so `settlement` D1's derivation keeps
  working unchanged — only the payer-facing total moves.
- **This is also what dissolves the original problem.** With the ISP paying, the
  amount on the page equals the amount WispHub says is owed, so the whole
  `AMOUNT_MISMATCH`-by-fee-mismatch class disappears and the threshold is
  measured against the same number the payer sees in their bank.
