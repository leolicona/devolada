# Reglas arquitectónicas

Reglas globales que ningún spec re-decide. Cambiarlas exige actualizar este archivo en la misma PR.

## Monorepo

```
apps/tienda   → PWA móvil (React + Vite + TanStack Router/Query, móvil-primero)
apps/admin    → Dashboard ISP (mismo stack, desktop-primero)
apps/api      → Hono + Drizzle + Zod en Cloudflare Workers + D1
packages/ui   → Tokens y componentes compartidos (fuente única visual)
```

- pnpm workspaces. Las apps frontend viven en subdominios (`tienda.` / `admin.` / `api.devolada.app`).
- El código se escribe en español (dominios, variables, rutas), consistente con el glosario del SPEC.

## Dinero

- **Siempre centavos enteros** (`totalCentavos: 41500`). Los floats no tocan montos jamás.
- Formato visible único vía `formatearMonto` / `<Monto>` de `packages/ui` (es-MX, `$1,234.00`, tabular-nums).

## Ledger (caja de saldo continuo)

- La tabla `movimientos` es **append-only**: nunca UPDATE ni DELETE. Correcciones = contra-asientos.
- Balance de una tienda = `SUM(centavos)`. Ningún balance se almacena; siempre se deriva.
- Tipos de asiento: `cobro` (+total), `comision` (−parte de la tienda), `entrega` (−monto). Sin gastos operativos (decisión de producto).
- Las entregas son bilaterales: asiento en estado `pendiente` hasta confirmación del ISP.

## Sesiones y auth

- Cookies HTTP-only `gm_access` (15 min) + `gm_refresh` (30 días); el navegador nunca ve JWTs.
- `apps/api` es el único que habla con Agnostic Auth (ver `integrations/agnostic-auth.md`).
- El middleware verifica **estatus en DB en cada solicitud**: suspensión = revocación inmediata (US-S03).
- Refresh transparente: si `gm_access` expiró y `gm_refresh` vale, se renueva y la petición original continúa.
- 401 idéntico exista o no la cuenta: no se filtra qué teléfonos/correos existen.
- Errores de configuración del IdP nunca se disfrazan de 401.

## API

- Envelope uniforme: `{ success: true, data }` | `{ success: false, error: { code } }`.
- Validación de entrada con Zod en el borde (`@hono/zod-validator`); los esquemas Zod son el contrato.
- Multi-tenant latente: `ispId` en toda tabla de negocio; la UI del MVP no lo expone.
- Rutas `/dev/*` solo existen con `ENTORNO=dev`.

## Resiliencia

- Un cobro **nunca se rechaza** por fallas de WispHub (US-C04): se registra y la reconexión entra a cola con reintentos idempotentes por cobro.
- Estados de reconexión: `en_cola → reconectado | fallido`. Los fallidos exigen intervención visible en el admin.
