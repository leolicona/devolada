# WispHub — verified contract

**Status: verified end-to-end on the demo tenant (2026-08-13).** The executed spike — including invoice creation and payment registration — is documented in `.design/devolada/WISPHUB_SPIKE.md`, which is the authoritative contract. Key facts: auth `Authorization: Api-Key <token>` against `https://api.wisphub.net/api/`; `OPTIONS` responses are the real documentation; payment = `POST /api/facturas/{id}/registrar-pago/` (async, returns `task_id`); `estado` is WispHub-managed (not writable) while `auto_activar_servicio` is the writable opt-in for payment-triggered reactivation. Pending only: physical MikroTik verification with the pilot ISP's real router.

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

## E2E evidence (2026-08-14)

Full pipeline verified through `devolada-api-dev`: real search (allow-list mapping, cents), real quote (`due` after a pending invoice), real charge → folio `DV-RJO12L`, WispHub invoice created and **paid** (`estado: Pagada`), status `reconnected` after the verify read, ledger `+41400 / −900`. Finding: the reconnection created a new invoice instead of paying the already-pending one → TD-009.
