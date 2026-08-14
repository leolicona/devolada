# WispHub Spike — executed results (2026-08-13)

Tenant: demo account on `sistema.wisphub.net` (wifiplus). API key in `apps/api/.dev.vars` (gitignored). Read probes ran first; mutations were run on demo data with the owner's explicit authorization.

## The golden answer

**The full charge pipeline exists in the API and payment processing is asynchronous on WispHub's side — exactly the shape Devolada's queue was designed for.** Verified end-to-end on the demo tenant:

1. `POST /api/facturas/` created invoice #1 for the demo customer (`{"messages":"Se genero correctamente la factura 1."}`).
2. The customer's `estado_facturas` flipped to "Pendiente de Pago" on its own — **billing state is derived, not written**.
3. `POST /api/facturas/1/registrar-pago/` with `{forma_pago, accion: 1, fecha_pago, total_cobrado}` → `{"messages":["Se agrego correctamente el pago"], "task_id": "…"}` — **a task id: payment side-effects (router/reactivation) run in WispHub's own async queue**.
4. The invoice became `"Pagada"`.
5. `auto_activar_servicio` (per-customer, default `false` in demo) **is writable via PATCH** — this is the opt-in switch for payment-triggered reactivation. `estado` itself is **not directly writable** (PATCH echoes but never persists): WispHub owns the service state machine.

What a demo tenant cannot prove: the physical MikroTik flip and the exact propagation timing (the customer-list `estado_facturas` lagged behind the paid invoice for at least ~40s). Verify with the pilot ISP's real router; the queue design already tolerates this (pay → poll → surface state).

## Verified contract

- **Base**: `https://api.wisphub.net/api/` · **Auth**: `Authorization: Api-Key <token>` (per-staff token from the panel). Unauthenticated and unauthorized both return the same generic 403 — indistinguishable.
- **No docs pages**; **`OPTIONS` responses carry the real documentation**, and 400 validation errors teach the exact field shapes.
- **Customers** `GET /api/clientes/` (DRF pagination `?limit&offset`): fields for US-C01/C02 all present — `id_servicio`, `usuario` (e.g. `jacruz@wifiplus`, only in the **list**, `null` in detail!), `nombre`, `telefono`, `estado`, `saldo`, `precio_plan` (string decimal `"499.00"`), `zona.nombre`, `fecha_corte`, `estado_facturas`, `auto_activar_servicio`.
- **Customer filters**: `?nombre=` (partial), `?telefono=`, `?usuario=`, `?estado=`. Generic `?search=` is ignored.
- **Customer detail** `GET/PUT/PATCH /api/clientes/{id_servicio}/`: `auto_activar_servicio` writable; `estado` read-only in practice.
- **Invoices** `GET/POST /api/facturas/`: list is date-ranged to the **current month by default** (`?desde=&hasta=&tipo_fecha=`) — empty may lie. Status codes `1-Pendiente | 2-Pagada | 3-Cancelada | 4-Revision | 5-Transferida`.
- **Invoice creation** (real contract, learned from validation): `cliente` = the **usuario string** (`"jacruz@wifiplus"`), `tipo_factura` (int, `1` works), `articulos: [{descripcion, precio, cantidad}]`, `fecha_emision/vencimiento/pago` as `YYYY-MM-DD`, plus `estado`, `sub_total`, `total`.
- **Register payment**: `POST /api/facturas/{id_factura}/registrar-pago/` with `{forma_pago: <id>, accion: 1, fecha_pago: "YYYY-MM-DD hh:mm", total_cobrado: <float>}` → 200 + `task_id`. `accion` is a numeric choice; `1` is the only value accepted of those probed.
- **Payment methods catalog**: `GET /api/formas-de-pago/` → `{id, nombre}` (demo has id 7 "efectivo").
- Latencies: 300–600ms per call.

## Implications for the build

- **US-C01 search**: proxy `?nombre|telefono|usuario`; capture `usuario` from the **list** endpoint (detail returns it null).
- **US-C02 amounts**: `precio_plan` string decimal → convert to cents at the boundary; never floats.
- **US-C03/C04 queue**: per charge — ensure `auto_activar_servicio` is on (one-time PATCH), create invoice if none pending, `registrar-pago`, then **poll invoice `estado` and customer `estado`** to confirm; surface `queued → reconnected` from those reads. WispHub's own `task_id` asynchrony is why the amber state exists.
- **US-A04 settings**: validate the API key live with a cheap `GET /api/clientes/?limit=1`.
- Demo residue: invoice #1 exists paid on the demo tenant; customer 1 has `auto_activar_servicio=true`. Both harmless, left as evidence.
