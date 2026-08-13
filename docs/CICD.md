# CI/CD

Toda la infraestructura vive en Cloudflare (Workers + D1). **Ningún despliegue se hace desde la máquina local**; todo pasa por GitHub Actions con configuración inyectada en build. Los agentes de IA pueden romper un build, nunca producción.

**Estado: implementado con pendientes** (TD-006): repo, workflows, environments y enforcement existen; falta `CLOUDFLARE_API_TOKEN` (secret), las D1 remotas (tope de cuenta) y las variables `DEV_API_URL`/`PROD_API_URL`/`PREVIEW_ENABLED`.

## Modelo de ramas: trunk-based

Una sola rama `main`. Sin `develop` — para un ingeniero solo, la rama intermedia duplica merges sin aportar aislamiento (decisión D1 de este doc; se revisa si el equipo crece).

- **PR → `main`**: barrera de calidad + preview para el cliente.
- **Merge a `main`**: deploy automático a **dev**.
- **Tag `v*`** (o `workflow_dispatch`): deploy a **prod** con approval gate.

## Trabajo local con worktrees (features paralelas con IA)

El desarrollo paralelo se hace con `git worktree`: una rama + un directorio + una sesión de IA por feature, cada una terminando en su propio PR (y su propia URL de preview para el cliente).

```sh
git worktree add ../devolada-wt-<feature> -b feat/<feature-slug>
# sesión de IA trabajando ahí; al mergear su PR:
git worktree remove ../devolada-wt-<feature>
```

Reglas para que dos worktrees convivan:

1. **Puertos propios por worktree**: los defaults (5173 muestra, 8787 api) chocan; la segunda sesión usa `--port` distinto (ej. 5174/8788).
2. **D1 local es por-worktree**: el estado vive en `apps/api/.wrangler/` de cada worktree — aislamiento gratis, pero cada worktree corre `pnpm db:migrate:local` la primera vez.
3. **Un spec por worktree**: cada feature paralela lleva su `.spec.md` propio; si dos features tocan el mismo spec, no son paralelas — se serializan.
4. **`pnpm install` por worktree** (node_modules no se comparte).

## Entornos

| Entorno | API | PWA tienda | Admin | D1 |
|---------|-----|-----------|-------|-----|
| dev | `api-dev.devolada.app` | `tienda-dev.devolada.app` | `admin-dev.devolada.app` | `devolada-db-dev` |
| prod | `api.devolada.app` | `tienda.devolada.app` | `admin.devolada.app` | `devolada-db-prod` |
| preview (por PR) | versión preview del worker | URL preview por PR | URL preview por PR | apunta a `devolada-db-dev` |

Los frontends inyectan `VITE_API_URL` en build. Secrets (AUTH_JWT_SECRET, RESEND_API_KEY, Cloudflare token) viven en GitHub Environments, jamás en el repo.

Mientras no exista la zona `devolada.app` en Cloudflare, los deploys salen a `*.workers.dev`; las URLs reales se configuran como variables de repo (`DEV_API_URL`, `PROD_API_URL`) que alimentan los smoke tests. Los dominios de la tabla son el destino final, no el estado actual.

## Los tres caminos

### 1. `ci.yml` — Pull Request hacia `main`

Barrera de calidad; no despliega a entornos estables.

1. Lint + typecheck (por workspace afectado: filtrado por paths, no se rebuildean las 3 apps si cambió una).
2. Tests de las capas rápidas (`TESTING.md`): API en workerd, componentes, red con MSW.
3. Build de lo afectado.
4. **Enforcement spec-driven** (paga TD-004): todo `*.spec.md` está en el índice de `SPEC.md`; los tests citan `US-`.
5. **Preview deploy**: URL única por PR (Workers versions / preview) apuntando a `api-dev` — **el cliente opina en el PR, antes del merge**. Es el mecanismo de feedback directo, no una cortesía.

### 2. `deploy-dev.yml` — push a `main`

1. Tests (mismos que CI; el merge pudo combinar PRs).
2. Migraciones a `devolada-db-dev` (`wrangler d1 migrations apply`).
3. Deploy de API + tienda + admin a dominios dev.
4. **Smoke test**: `curl /health` y carga de ambas apps; si falla, el job falla — "desplegado" sin smoke no es "funcionando".
5. E2E Playwright + axe contra dev (la capa lenta corre aquí, no en cada PR).

### 3. `deploy-prod.yml` — tag `v*`

1. **Approval gate nativo**: GitHub Environment `production` con required reviewer. El job queda en pausa hasta aprobación humana; nada artesanal.
2. **Respaldo**: `wrangler d1 export` de `devolada-db-prod` como artefacto del run, antes de migrar.
3. Migraciones a `devolada-db-prod`.
4. Deploy de API + apps a dominios prod.
5. Smoke test post-deploy.

## Reglas de migraciones

- Solo archivos generados por drizzle-kit, append-only (nunca editar una migración aplicada).
- **Expand-contract obligatorio en prod**: migración y deploy no son atómicos, así que nada destructivo (drop/rename) viaja en el mismo release que el código que aún dependía de lo viejo — se expande en un release, se contrae en el siguiente.
- Toda migración corre primero en dev por el flujo normal; prod nunca estrena una migración.

## Rollback

- **Código**: `wrangler rollback` (Workers conserva versiones) o re-deploy del tag anterior.
- **Datos**: restaurar desde el export del paso 2; asumir pérdida de lo escrito entre export y falla (por eso el smoke inmediato).
- Un rollback en prod siempre genera entrada en `BUGS.md`.

## Decisiones

- **D1 — Trunk-based sobre git-flow.** Alternativa descartada: `develop` + `main` (doble merge sin beneficio con un solo ingeniero; la latencia extra pelea contra el ciclo de feedback del cliente).
- **D2 — Preview por PR como canal de feedback del cliente.** Alternativa descartada: que el cliente revise solo dev (opina un paso tarde, sobre trabajo ya mergeado).
- **D3 — E2E en deploy-dev, no en cada PR.** Alternativa descartada: E2E en PR (minutos de espera en cada iteración; las capas rápidas ya cubren la barrera).
- **D4 — Preview comparte `devolada-db-dev`.** D1 no tiene branching de datos; una DB por PR es sobre-ingeniería para esta escala. Riesgo aceptado: un PR puede ensuciar datos de dev.
