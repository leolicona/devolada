# WispHub — contrato pendiente de spike

**Estado: NO verificado.** Este archivo se llena con el resultado del spike (Fase 0, `WISPHUB_SPIKE.md`). Hasta entonces, nada de lo listado abajo es contrato — son hipótesis de trabajo.

## La pregunta de oro del spike

¿Registrar un pago vía API dispara la **reactivación automática** del servicio en el MikroTik? Todo el producto (US-C03) depende de esto. Si la respuesta es no, el hallazgo redefine el producto y se detiene el desarrollo de la Fase 2 hasta re-decidir.

## Acceso de prueba sin ISP real

1. **Sandbox oficial**: cuenta demo gratis en `wisphub.net` → subdominio `<demo>.wisphub.net` → Mi Empresa > Staff > Generar API Key → apuntar a `https://sandbox-api.wisphub.net`. Si la demo no permite generar API Key, ticket de soporte: "Necesito acceso a API para integración de red de pagos en tiendas".
2. **Clon open source local**: `garzasoftware/wisphub-clone` (Node + Postgres + React, Docker). Endpoints equivalentes: `GET /api/clientes/`, `POST /api/pagos/`, `PUT /api/clientes/:id/servicio/`.

## Hipótesis a verificar en el spike

- Búsqueda de clientes por ID / teléfono / nombre (para US-C01) y qué campos devuelve (mínimos de identidad + saldo).
- Registro de pago (para US-C02) y si retorna confirmación síncrona de reactivación o hay que consultar estado.
- Latencias y códigos de error reales (alimentan la cola de reconexión, US-C04).
- Autenticación: header de API Key, formato, expiración.

## Reglas ya decididas (independientes del spike)

- La API Key del ISP se guarda en `isps.wisphub_api_key` y se valida en vivo al configurarla (US-A04).
- `apps/api` es el único que habla con WispHub; las apps frontend consumen el proxy.
