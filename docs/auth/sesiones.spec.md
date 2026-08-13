---
estado: vigente
historias: [US-S01, US-S02, US-S03]
dominio: auth
actualizado: 2026-08-13
deuda: [TD-001, TD-005]
---

# Spec: Sesiones (login, refresh transparente, revocación)

Autenticación con cookies para tienda (teléfono) y admin (correo), con renovación invisible y revocación inmediata por suspensión. Implementado en `apps/api` (rutas `src/routes/auth.ts`, middleware `src/auth/middleware.ts`).

## Decisiones

- **D1 — Cookies HTTP-only, no bearer tokens.** Alternativa descartada: JWT en localStorage/Authorization (expuesto a XSS, exige manejo de tokens en cada app). Las cookies `gm_access` (15 min) + `gm_refresh` (30 días) mantienen los JWT fuera del alcance de JS.
- **D2 — Estatus en DB en cada solicitud.** Alternativa descartada: confiar solo en la vigencia del JWT (una tienda suspendida operaría hasta 15 min más). El costo es un SELECT por request; el beneficio es US-S03 literal.
- **D3 — 401 genérico e indistinguible.** Alternativa descartada: mensajes específicos ("teléfono no registrado"), que filtran qué cuentas existen.
- **D4 — Errores de configuración del IdP no se disfrazan de 401.** Un `appId` no registrado o un contrato roto devuelven 500 y se loguean; un 401 falso habría ocultado el problema real (pasó durante el desarrollo).

## Contrato

| Ruta | Entrada (Zod) | Éxito | Fallos |
|------|---------------|-------|--------|
| `POST /auth/tienda/login` | `{telefono: 10-15, password: ≥8}` | `{tipo, id, nombre}` + cookies | 401 credenciales · 403 `CUENTA_SUSPENDIDA` · 400 validación |
| `POST /auth/admin/login` | `{correo: email, password: ≥8}` | ídem | ídem |
| `POST /auth/logout` | — (cookie) | `{}` + cookies limpiadas; revoke mejor-esfuerzo | — |
| `GET /auth/me` | — (cookie) | actor `{tipo, id, nombre, estatus, …}` | 401 sin sesión · 403 suspendida |

Middleware `requireSesion`: valida `gm_access`; si expiró y `gm_refresh` vale → renueva contra el IdP, actualiza cookies y **la petición original continúa** (US-S02). Identidad del payload (`identity ?? sub`) → actor en DB (tienda por teléfono, ISP por correo) → verifica estatus (US-S03).

## Reglas de negocio

1. Una tienda en estatus `invitada` (sin contraseña) no puede iniciar sesión: 401 genérico.
2. Suspensión (tienda o ISP) → 403 `CUENTA_SUSPENDIDA` en la siguiente solicitud, con cookies limpiadas.
3. La sesión de tienda es larga por diseño (dispositivo del mostrador); no hay expiración por inactividad en MVP.

## Contrato de UI

- Sin pantalla de "sesión expirada" en operación normal; 401 tras refresh fallido → redirigir a `/login` sin mensaje de error alarmante.
- 403 `CUENTA_SUSPENDIDA` en la PWA → pantalla completa de cuenta suspendida con contacto del ISP (componente del inventario del brief); puede aparecer a media jornada.
- Formularios de login: tienda (teléfono + contraseña) y admin (correo + contraseña) comparten base visual (`packages/ui`); táctiles ≥48px; errores en es-MX llano ("Teléfono o contraseña incorrectos").

## Escenarios (verificados con curl, 2026-08-13)

1. ✅ Login tienda válido → 200 + `gm_access` + `gm_refresh`
2. ✅ Login admin válido → 200 + cookies
3. ✅ Contraseña incorrecta → 401 genérico
4. ✅ `/auth/me` con sesión → actor; sin sesión → 401
5. ✅ Solo `gm_refresh` (access expirada/ausente) → 200 + cookies renovadas en la misma petición
6. ✅ Tienda suspendida con sesión viva → 403 `CUENTA_SUSPENDIDA` inmediato
7. ✅ Logout → revoke + cookies limpiadas
8. ✅ Payload malformado → 400 (Zod)

## Definition of Done

- [x] Contrato implementado y escenarios 1–8 verificados
- [x] Discrepancias del IdP documentadas en `integrations/agnostic-auth.md`
- [ ] Escenarios automatizados (bloqueado por TD-005)
- [ ] Verificación de firma JWT en dev y prod (TD-001)
