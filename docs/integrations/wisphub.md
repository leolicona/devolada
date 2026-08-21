# WispHub — verified contract

**Status: verified end-to-end on the demo tenant (2026-08-13).** The executed spike — including invoice creation and payment registration — is documented in `.design/devolada/WISPHUB_SPIKE.md`, which is the authoritative contract. Key facts: auth `Authorization: Api-Key <token>` against `https://api.wisphub.net/api/`; `OPTIONS` responses are the real documentation; payment = `POST /api/facturas/{id}/registrar-pago/` (async, returns `task_id`); `estado` is WispHub-managed (not writable) while `auto_activar_servicio` is the writable opt-in for payment-triggered reactivation. Pending only: physical MikroTik verification with the pilot ISP's real router.

> **Two claims in the paragraph above were contradicted on 2026-08-20** — see *"Billing is a running account"* at the foot of this file. `estado` **is** writable when a real router backs the customer, and `auto_activar_servicio` did **not** control the reactivation in either direction; `accion` did. Read that section before relying on this one.

## The spike's golden question

Does registering a payment via the API trigger the **automatic reactivation** of the service on the MikroTik? The whole product (US-C03) depends on this. If the answer is no, the finding redefines the product and Phase 2 development stops until re-decided.

## Test access without a real ISP

1. **Official sandbox**: free demo account at `wisphub.net` → subdomain `<demo>.wisphub.net` → Mi Empresa > Staff > Generate API Key → point at `https://sandbox-api.wisphub.net`. If the demo won't issue an API Key, open a support ticket: "Necesito acceso a API para integración de red de pagos en tiendas".
2. **Open-source local clone**: `garzasoftware/wisphub-clone` (Node + Postgres + React, Docker). Equivalent endpoints: `GET /api/clientes/`, `POST /api/pagos/`, `PUT /api/clientes/:id/servicio/`.

## Hypotheses to verify in the spike

- Customer search by ID / phone / name (for US-C01) and which fields it returns (minimum identity + balance).
- Payment registration (for US-C02) and whether it returns synchronous reactivation confirmation or requires polling.
- Real latencies and error codes (they feed the reconnection queue, US-C04).
- Authentication: API Key header, format, expiry.

## Rules already decided (spike-independent)

- The ISP's API Key is stored in `isps.wisphub_api_key` and validated live when configured (US-A04).
- `apps/api` is the only party that talks to WispHub; frontend apps consume the proxy.

## Local dev limitation (2026-08-14)

`wrangler dev` (local workerd) cannot reach `api.wisphub.net` — every fetch fails with workerd's opaque `internal error`, while the same key works with curl and from deployed Workers. Manual checks therefore run against the **deployed dev API**, with `WISPHUB_API_KEY` set as a dev-environment secret. The API tests are not affected (WispHub is mocked).

## `telefono` is read-only via the API (probed 2026-08-17)

Probed for US-C07 (customer phone capture), against the demo tenant:

- `telefono` exists only in the **list** serializer (`GET /api/clientes/`).
  The detail resource (`GET /clientes/{id_servicio}/`) is network-config
  centric and does not carry the field at all.
- `OPTIONS /clientes/{id}/` documents 34 PUT-writable fields
  (`auto_activar_servicio` among them); `telefono` is not one.
- Empirical `PATCH /clientes/{id}/ {"telefono": "..."}` neither echoes nor
  persists the value — the list keeps the old value.

Consequence: customer phones captured at charge time cannot be written back to
WispHub; Devolada stores them (`customer_contacts`,
charges/customer-phone.spec.md D1/D3).

## E2E evidence (2026-08-14)

Full pipeline verified through `devolada-api-dev`: real search (allow-list mapping, cents), real quote (`due` after a pending invoice), real charge → folio `DV-RJO12L`, WispHub invoice created and **paid** (`estado: Pagada`), status `reconnected` after the verify read, ledger `+41400 / −900`. Finding: the reconnection created a new invoice instead of paying the already-pending one → TD-009.

## Latency and stalls (measured 2026-08-18)

Sampled from a laptop with the demo tenant's real key, several runs per
endpoint:

- Healthy calls answer in **0.4–0.6 s**.
- About **one call in eight stalls and never recovers** — observed hanging
  past 8 s, 30 s and 60 s cutoffs, then only ending at the client's own
  timeout. It is not endpoint-specific: `/clientes/`, `/facturas/` and
  `/formas-de-pago/` all did it, and `/clientes/` did it with and without
  a filter.

Consequence: **every call through the adapter carries a deadline** — 5 s
per call, 12 s per operation (`src/wisphub/client.ts`,
polish/provider-latency.spec.md D1). A stall is reported as the existing
`WISPHUB_UNAVAILABLE`, so it is an outage like any other: a 503 before a
charge is recorded, a `queued` reconnection after. Retrying a stalled
call is pointless — they were measured never to recover — which is why
the deadline exists instead of a retry.

This is also why the pending-invoice list and the payment-method id are
cached per tenant for display paths (D3, D5): the fewer calls a screen
makes, the smaller its chance of meeting a stall.

## Billing is a running account, not an invoice ledger (measured 2026-08-20)

Measured against the demo tenant with a real MikroTik behind it (the CHR lab,
enforcing genuine cuts), while probing partial payments
(`.design/devolada/PARTIAL_PAYMENT_SPIKE.md`). This section is the contract; the
spike is the evidence.

### The formula

> **total owed = Σ(pending invoice totals) + customer `saldo`**
> **`saldo`ₙₑw = total owed − amount paid**, and a negative result is a credit.

Every measurement fits it. `registrar-pago` applies the payment to the
**customer**, not to the invoice named in the URL.

### A short payment closes the invoice anyway

`POST /facturas/{id}/registrar-pago/` with `total_cobrado` **below** the invoice
`total` answers **200**, not 422:

```json
{"messages":["Se aplico un saldo pendiente de pago de 60.00 al cliente …,
              por registrar un monto menor al total de la factura.",
             "Se agrego correctamente el pago"], "task_id":"…"}
```

Afterwards the invoice reads `estado: "Pagada"`, `total: 100.0`,
`total_cobrado: 40.0`, `saldo_nuevo: 60.0`, and the customer reads
`saldo: "60.00"` with **`estado_facturas: "Pagadas"`**. So the pending-invoice
list empties while the debt lives on in `saldo` — the reason `debt-truth`
D7 exists.

The message's wording is unreliable: paying `25.00` against a `10.00` invoice
while `60.00` was carried also answers *"por registrar un monto menor al total de
la factura"* (`60 + 10 − 25 = 45`). The arithmetic is the contract, not the prose.

### Overpayment becomes a credit, by itself

Paying `60.00` against a `50.00` debt answers *"Se aplico un saldo a favor de
-10.00"* and the customer reads `saldo: "-10.00"`. There is nothing to build and
nothing to write: `saldo` is **not** among the 34 PUT-writable fields on
`/clientes/{id}/` (like `telefono`), because it is derived. The tenant also
carries a `Saldo a Favor` payment method, so the concept is first-class.

### `accion` is the reconnection switch — and it takes two values

`accion` accepts exactly **0** and **1**; `2`, `3` and `99` answer **400**
*"no es una elección válida."* The 2026-08-13 spike's *"the only value accepted
of those probed"* was one short.

| | `accion: 0` | `accion: 1` |
|---|---|---|
| payment recorded, remainder → `saldo` | yes | yes |
| `task_id` in the response | **`null`** | a UUID |
| router touched / service reconnected | **no** | **yes** |

The `task_id` is the tell — payment side-effects run in WispHub's async queue
keyed by it, and `accion: 0` queues nothing. Verified physically: a customer
suspended with its IP in the router's `Moroso` list, given a partial payment with
`accion: 0`, was still `Suspendido` and still in `Moroso` on three checks across
~40 s, with the money on its `saldo`.

### `auto_activar_servicio` does not control the reconnection

The mirror test: a customer with **`auto_activar_servicio: false`** given a
payment with `accion: 1` was reconnected anyway — WispHub's own API session
removed the `Moroso` entry and `estado` went to `Activo`.

This contradicts what `apps/api/src/wisphub/client.ts` and
`charges/reconnection-queue.spec.md` D9 assume. Stated only as far as it was
measured: **on the `registrar-pago` path, `accion` decides and the flag did not
matter in either direction.** What the flag governs elsewhere — WispHub's own
payment gateways, its billing cron — was not tested. **Pending a second
measurement before any spec is rewritten around it** (owner's decision,
2026-08-20).

### Invoice fields we already receive and were discarding

Every row of `GET /facturas/` carries `total`, `sub_total`, `descuento`,
`impuestos_total`, `saldo`, `saldo_nuevo`, `total_cobrado` and the full
`articulos[]` (`descripcion`, `precio`, `cantidad`). Line descriptions carry the
proration in prose (*"Total dias a pagar: 31"*). `saldo` likewise rides in the
customer list serializer. Reading either costs **no extra call**.

### Writes that do not work

- **`estado` on a customer needs a real router.** `PATCH {"estado":"Suspendido"}`
  answers 200 and echoes the value, but the customer reads back `Activo` when no
  reachable device backs it — WispHub's cut is an entry in the router's `Moroso`
  address-list, so with nothing to act on the state falls back. With a real
  router behind the customer it persists.
- **A customer cannot be moved between zones.** `PATCH {"zona":{"id":N}}` answers
  **500** with an HTML page, with or without an `ip` alongside. `zona.id` is
  writable per `OPTIONS`; `router.id` is `read_only` (zone and router are one to
  one, and the customer inherits the router from the zone). `/zonas/` answers
  403 for a tenant API key.
- **`OPTIONS /facturas/{id}/registrar-pago/` answers 500**, so that route's
  parameters can only be probed by trying values.

**General rule this reinforces:** an echoed `PATCH` is not evidence of a write on
this API. Only a fresh read is. And several routes answer 500 rather than a
status code that means anything, which is why the adapter treats every non-2xx
as `WISPHUB_UNAVAILABLE` instead of interpreting it.
