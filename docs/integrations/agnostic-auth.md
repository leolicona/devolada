# Agnostic Auth — contrato real

IdP stateless en Cloudflare Workers. **Este archivo documenta el contrato verificado contra la API real (2026-08-13), que difiere de la guía de integración oficial.** Ante conflicto, manda este archivo.

- Base (dev, HTTP): `https://agnostic-auth.leolicona-dev.workers.dev`
- Producción: service binding `AGNOSTIC_AUTH_API` → worker `agnostic-auth`
- Cliente único: `apps/api/src/auth/agnostic.ts`. Ninguna app frontend habla con el IdP.

## Registro de apps

Sin endpoint; se escribe directo en KV desde `~/software-projects/agnostic-auth/auth-service/`:

```sh
npx wrangler kv key put --binding=APP_REGISTRY --preview false --remote "devolada" \
  '{"appId":"devolada","redirectUrl":"https://tienda.devolada.app","callbackUrl":"https://api.devolada.app/auth/callback","tokenTtlSeconds":900}'
```

La app `devolada` quedó registrada el 2026-08-13.

## Discrepancias vs la guía oficial (verificadas)

1. `POST /auth/verify-password` exige:
   ```json
   { "appId": "...", "identity": "...", "attemptedPassword": "...", "storedHash": "...", "storedSalt": "..." }
   ```
   La guía dice `{ password, hash, salt }` — está mal.
2. Envelope de error real: `{ "success": false, "error": "<código string>", "message": "...", "details": {...} }`. La guía muestra `error` como objeto — está mal.
3. Errores de validación llegan con `error: "Validation failed"` + `details` por campo.

## Endpoints que usamos

| Endpoint | Uso en Devolada |
|----------|-----------------|
| `POST /auth/hash` `{password}` → `{hash, salt}` | Alta de credenciales (registro ISP, invitación tienda) |
| `POST /auth/verify-password` (ver arriba) → `{jwt, refreshToken}` | Login tienda (identity=teléfono) y admin (identity=correo) |
| `POST /auth/refresh` `{appId, refreshToken}` → `{jwt, refreshToken}` | Refresh transparente del middleware |
| `POST /auth/token/revoke` `{appId, refreshToken}` | Logout |
| `POST /auth/initiate` `{appId, identity}` → `{token, magicLink}` | Invitación de tienda, verificación de correo, recuperación |
| `POST /auth/verify` `{appId, token}` → `{jwt, refreshToken}` | Canje del token mágico |

## JWT

- HS256, firmado con secreto del worker desplegado (no legible desde fuera).
- Verificación en `apps/api` con `AUTH_JWT_SECRET`; sin él (solo dev) se decodifica sin verificar firma → TD-001.
- Payload: usar `identity ?? sub` como identidad del actor.

## Reparto de responsabilidades

Agnostic Auth emite y renueva tokens; **Devolada decide todo lo demás**: cookies (`gm_access`/`gm_refresh` HTTP-only), estatus del actor en DB por solicitud, y qué identidad corresponde a tienda o ISP.
