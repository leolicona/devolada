# TECH_DEBT

Deuda técnica consciente: cosas pospuestas a propósito durante un spec. Cada entrada dice qué se pospuso, por qué era razonable y qué la vuelve pagadera.

## TD-001 — JWT sin verificación de firma en dev
- Estado: abierta · Origen: auth/sesiones.spec.md
- `apps/api` decodifica los JWT sin verificar firma cuando falta `AUTH_JWT_SECRET` (con warning en consola). Razonable en dev local; **bloqueante para producción**.
- Se paga: configurando el secreto HS256 de agnostic-auth como secret del worker y en `.dev.vars`.

## TD-002 — Tokens de diseño duplicados
- Estado: abierta · Origen: fase de tokens
- `.design/devolada/DESIGN_TOKENS.css` (documento) y `packages/ui/src/styles/tokens.css` (vivo) se sincronizan a mano. El vivo manda.
- Se paga: script de sincronización o declarar el `.design` como snapshot histórico y dejar de mantenerlo.

## TD-003 — Proveedor de mensajería sin decidir
- Estado: abierta · Origen: brief (comprobantes WhatsApp/SMS, invitaciones)
- La plantilla y el trigger se construyen agnósticos del proveedor (Meta WhatsApp Business API vs Twilio). Mientras no se decida, las invitaciones usan enlace copiable como fallback.
- Se paga: decidir proveedor, crear `integrations/<proveedor>.md` e implementar el envío real.

## TD-004 — Regla de oro sin enforcement
- Estado: **pagada** (2026-08-13) · Origen: adopción de la metodología
- `scripts/spec-lint.mjs` corre en los tres workflows: falla si un `*.spec.md` no está en el índice de `SPEC.md`; advierte tests sin US-ID (se vuelve error al pagar TD-005).

## TD-006 — Pipeline CI/CD con pendientes de activación
- Estado: en pago (repo, workflows, environments y spec-lint listos el 2026-08-13)
- Progreso 2026-08-13: D1 remotas creadas con IDs reales en `wrangler.jsonc` ✅ · repo público y required reviewer activo en `production` ✅
- Restan dos pendientes:
  1. **`CLOUDFLARE_API_TOKEN`** creado en el dash de Cloudflare y cargado como secret de los environments `dev` y `production`.
  2. Variables de repo tras el primer deploy: `DEV_API_URL`, `PROD_API_URL` (smoke tests) y `PREVIEW_ENABLED=true` (previews por PR).

## TD-005 — Sesiones verificadas solo con curl
- Estado: en pago · Origen: auth/sesiones.spec.md (anterior a la estrategia de testing)
- La estrategia de `TESTING.md` ya rige desde la próxima feature (la infraestructura se monta con `registro-isp`); la deuda restante es retroactiva: convertir los 8 escenarios curl de sesiones en tests de la capa API.
- Se paga: al montar la infraestructura con registro-isp, en la misma PR o la inmediata siguiente.
