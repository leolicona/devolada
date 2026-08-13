# Resend — contrato pendiente

**Estado: no integrado todavía.** Se llena al construir `auth/registro-isp.spec.md`.

## Uso previsto

- Verificación de correo del ISP (US-S04): enviar el `magicLink` de Agnostic Auth `/auth/initiate`.
- Recuperación de contraseña del admin (US-S06): mismo patrón.
- Solo correo transaccional del lado admin. Las tiendas no usan correo (su canal es WhatsApp/SMS → TD-003).

## Requisitos para activarlo

- API Key de Resend como secret del worker (`RESEND_API_KEY` en `.dev.vars` / `wrangler secret`).
- Dominio verificado en Resend (o el sandbox `onboarding@resend.dev` para desarrollo).
- Solo se llama desde `apps/api`; nunca desde el navegador.

## Regla de resiliencia

El registro no se bloquea si Resend falla: la cuenta queda creada sin verificar y el correo puede reenviarse. El error se registra, no se propaga como fallo del registro.
