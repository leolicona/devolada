# Reglas de prueba

## Estrategia (vigente desde la primera feature)

La infraestructura se monta con la **próxima feature en desarrollo** (`auth/registro-isp.spec.md`) y desde ahí toda feature entrega sus escenarios automatizados como parte del DoD — los tests no son fase posterior, son parte del desarrollo.

| Capa | Herramienta | Dónde | Qué cubre |
|------|------------|-------|-----------|
| API | Vitest + `@cloudflare/vitest-pool-workers` | `apps/api` | El app de Hono corriendo en workerd (runtime real de Workers) con D1 real local — sin mocks de base de datos. Rutas, middleware, invariantes del ledger. |
| Componentes | Vitest + React Testing Library + happy-dom | `packages/ui`, apps | Átomos y pantallas por lo que ve el usuario (`getByRole`, texto visible), no detalles de implementación. |
| Red | MSW (Mock Service Worker) | apps frontend | Flujos completos con TanStack Query sin backend corriendo: estados de error, WispHub en cola, cargas. Los handlers se validan contra los esquemas Zod del API para que los mocks no mientan. |
| E2E + accesibilidad | Playwright + `@axe-core/playwright` | raíz | Camino crítico de cobro contra `wrangler dev`, modo offline de la PWA (`context.setOffline`), verificación AA automatizada. |

Fuera de alcance por ahora (decisión, no olvido): Storybook/Chromatic y regresión visual — la página de muestra (`pnpm muestra`) es el catálogo vivo; la regresión visual entra post-MVP cuando la UI se estabilice.

## Reglas al escribir tests

1. **Todo test nombra su historia**: `describe("US-C02: cobra mensualidad exacta", …)`. La cobertura de spec se rastrea con grep, no con fe.
2. **El dinero se prueba en centavos**: nunca aserciones sobre strings formateados salvo en tests del propio formateador.
3. **El ledger se prueba por invariantes**: balance = suma de asientos; ningún test puede editar/borrar movimientos para armar su escenario — se construye con asientos, como en producción.
4. **Los escenarios del spec son el mínimo**: cada `.spec.md` lista sus escenarios y el DoD no se marca sin sus tests automatizados en verde.
5. **Integraciones externas** (Agnostic Auth, WispHub, Resend): se simulan respetando el contrato de `integrations/*.md`, incluyendo sus formas de error reales (no las de la guía oficial cuando difieren).
6. **DOM simulado no verifica estilos**: aserciones sobre color/contraste real pertenecen a la capa Playwright+axe (o a Vitest Browser Mode si algún día se adopta), no a happy-dom.

## Deuda retroactiva

`auth/sesiones.spec.md` se verificó con curl antes de esta estrategia; sus 8 escenarios deben convertirse en tests de la capa API al montar la infraestructura (TD-005).
