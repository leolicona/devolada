# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Devolada: red de puntos de cobro en tienditas para ISPs que usan WispHub. El código, los docs y los commits se escriben en **español**, usando el glosario de `docs/SPEC.md` (Cobro, Caja, Entrega, Movimiento, Cargo por servicio, Reconexión — una palabra por concepto, sin sinónimos).

## Metodología (no opcional)

El proyecto es **spec-driven**; las reglas viven en `docs/SPEC.md` y el CI las hace cumplir (`scripts/spec-lint.mjs`):

- **Regla de oro**: si existe en el código pero no está en `SPEC.md`, está mal. Toda feature nueva empieza escribiendo `docs/<dominio>/<feature>.spec.md` (con US-ID reservado en `SPEC.md`) **antes** de tocar código, y se registra en el índice en la misma PR. El spec se actualiza con la realidad durante el desarrollo; nunca se bifurca.
- **Vía lite**: bugfixes/typos/copy no llevan spec — llevan entrada en `docs/BUGS.md` (si tocó producción) y test.
- Deuda consciente → `docs/TECH_DEBT.md` (formato TD-NNN con condición de pago). Molde de spec: `docs/auth/sesiones.spec.md`.
- Capas transversales que ninguna feature re-decide: `docs/ARCHITECTURE.md`, `docs/FRONTEND.md`, `docs/TESTING.md`, `docs/CICD.md`, `docs/integrations/*.md`.
- `docs/integrations/agnostic-auth.md` documenta el **contrato real verificado**, que difiere de la guía oficial del servicio — ante conflicto manda el archivo local.

## Comandos

```sh
pnpm install                                  # raíz del monorepo (pnpm workspaces)
pnpm muestra                                  # playground de tokens/componentes (packages/ui, puerto 5173)
pnpm --filter @devolada/api dev               # API local (wrangler, puerto 8787; D1 local)
pnpm --filter @devolada/api db:generate       # generar migración drizzle desde src/db/schema.ts
pnpm --filter @devolada/api db:migrate:local  # aplicar migraciones a la D1 local
pnpm -r --if-present typecheck                # typecheck de todos los workspaces
pnpm -r --if-present test                     # tests (infraestructura definida en docs/TESTING.md)
node scripts/spec-lint.mjs                    # enforcement local de la regla de oro
```

Seed local de desarrollo: con el API corriendo, `curl -X POST localhost:8787/dev/seed` crea ISP demo (`demo@devolada.app`) y tienda demo (`5512345678`), contraseña `devolada123`. Las rutas `/dev/*` solo existen con `ENTORNO=dev`.

**Nunca desplegar desde local**: todo deploy pasa por GitHub Actions (`docs/CICD.md`). Trunk-based sobre `main`; PR → CI + preview; merge → dev; tag `v*` → prod con approval gate. Features paralelas se trabajan con `git worktree` (reglas de convivencia en CICD.md: puertos distintos, D1 local por-worktree, un spec por worktree).

## Arquitectura

```
apps/api      Hono + Drizzle + Zod en Cloudflare Workers + D1
packages/ui   Tokens de diseño (Tailwind v4) + átomos compartidos
apps/tienda   PWA de la tienda (pendiente de crear; móvil-primero)
apps/admin    Dashboard del ISP (pendiente de crear; desktop-primero)
```

Invariantes que atraviesan todo (detalle en `docs/ARCHITECTURE.md`):

- **Dinero siempre en centavos enteros**; el formato visible sale únicamente de `formatearMonto`/`<Monto>` en `packages/ui`.
- **La tabla `movimientos` es un ledger append-only**: nunca UPDATE/DELETE; correcciones = contra-asientos; el balance de una tienda se deriva con SUM, jamás se almacena.
- **Sesiones**: cookies HTTP-only `gm_access`/`gm_refresh`; `apps/api` es el único que habla con el IdP externo (Agnostic Auth) y con WispHub — los frontends consumen el proxy. El middleware (`apps/api/src/auth/middleware.ts`) verifica estatus en DB en cada solicitud (suspensión = revocación inmediata) y hace refresh transparente.
- **Un cobro nunca se rechaza por fallas de WispHub**: se registra y la reconexión entra en cola con estado visible (`en_cola → reconectado | fallido`).
- `ispId` en toda tabla de negocio (multi-tenant latente); la UI del MVP no lo expone.
- Envelope del API: `{ success: true, data }` | `{ success: false, error: { code } }`; validación Zod en el borde.

## Frontend

Leyes en `docs/FRONTEND.md`; artefactos de diseño (brief, IA, tokens, tasks) en `.design/devolada/`. Lo esencial: los tokens de `packages/ui/src/styles/tokens.css` son ley (cero valores hardcodeados; se mapean a Tailwind vía `@theme inline` en `src/styles/index.css`); `EstadoBadge` es la única representación de estados del dominio; claro+oscuro vía `[data-theme]` (el oscuro es paleta propia, no inversión); el estado nunca se comunica solo con color (siempre ícono + texto).

El plan de construcción ordenado vive en `.design/devolada/TASKS.md`; los tests citan su historia de usuario (`US-C02: …`) según `docs/TESTING.md`.
