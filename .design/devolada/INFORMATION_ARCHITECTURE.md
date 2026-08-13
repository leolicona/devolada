# Information Architecture: Devolada

Dos apps separadas en el monorepo pnpm, con paquetes compartidos:

```
apps/tienda   → PWA móvil del punto de cobro (TanStack Router, móvil-primero)
apps/admin    → Dashboard del ISP (TanStack Router, desktop-primero)
apps/api      → API Hono + Drizzle + Zod (Cloudflare Workers); integra WispHub,
                Resend y Agnostic Auth (service binding)
packages/ui   → Componentes y tokens compartidos (shadcn/ui + Tailwind)
```

## Site Map

### apps/tienda (PWA)

- Cobrar (home) `/` — buscador de cliente; la pantalla inicial ES la acción principal
  - Confirmar y cobrar `/cobrar/$clienteId` — ficha mínima de identidad + desglose + botón cobrar
  - Resultado de cobro `/cobros/$cobroId` — estado vivo: reconectado / en cola / fallido
- Caja `/caja` — balance actual, comisión acumulada, aviso de techo de saldo
  - Registrar entrega `/caja/entregar` — monto sugerido = balance completo
- Movimientos `/movimientos` — ledger de la tienda (cobros, comisiones, entregas)
  - Detalle de movimiento `/movimientos/$movimientoId`
- Iniciar sesión `/login` — teléfono + contraseña (fuera del layout con tabs)
- Aceptar invitación `/invitacion/$token` — el tendero establece su contraseña al llegar desde el enlace de WhatsApp/SMS

### apps/admin (Dashboard ISP)

- Cobros (home) `/` — feed en vivo de cobros con estado de reconexión
  - Detalle de cobro `/cobros/$cobroId` — cliente, tienda, desglose, folio, línea de tiempo de reconexión
- Tiendas `/tiendas` — tabla con saldos, alertas de techo, estado
  - Nueva tienda `/tiendas/nueva`
  - Detalle de tienda `/tiendas/$tiendaId` — ledger completo, saldo, comisión, techo, suspender
- Entregas `/entregas` — pendientes de confirmar (arriba) + historial
  - Detalle de entrega `/entregas/$entregaId` — confirmar o disputar
- Configuración `/configuracion` — API Key de WispHub, cargo por servicio, reparto de comisión
- Iniciar sesión `/login` — correo + contraseña
- Registro del ISP `/registro` — correo + contraseña; verificación de correo vía Resend
- Recuperar contraseña `/recuperar` — enlace de restablecimiento vía Resend

## Navigation Model

- **Primary navigation (tienda)**: 3 tabs inferiores fijos — **Cobrar · Caja · Movimientos**. Nunca más de 3; la acción principal siempre a un toque en la zona del pulgar.
- **Primary navigation (admin)**: sidebar con 4 secciones — **Cobros · Tiendas · Entregas · Configuración**. Un solo nivel de profundidad; el detalle se abre dentro de la sección.
- **Secondary navigation**: ninguna en tienda. En admin, tabs contextuales dentro del detalle de tienda (Ledger / Datos) si el contenido lo exige; no hay tercer nivel.
- **Utility navigation**: tienda — nombre de la tienda y cerrar sesión dentro de Caja (no roba un tab). Admin — cuenta y cerrar sesión al pie del sidebar.
- **Mobile navigation (admin)**: el sidebar colapsa a menú inferior de 4 íconos; las tablas colapsan a tarjetas. Confirmar una entrega desde el teléfono debe tomar dos toques.
- **Badges**: el tab Caja muestra aviso cuando el saldo se acerca al techo; la sección Entregas muestra contador de pendientes.

## Content Hierarchy

### Cobrar (tienda, home)
1. Campo de búsqueda (ID / teléfono / nombre) con teclado abierto — el cliente está formado enfrente; cero toques antes de poder buscar
2. Resultados con datos mínimos de identidad (nombre, zona, estado del servicio) — confirmar verbalmente antes de cobrar
3. Aviso de techo de saldo si aplica — única interrupción permitida, porque puede bloquear cobros
4. Estado de conexión (sutil) — si WispHub está caído, avisar que los cobros entrarán a cola

### Confirmar y cobrar (tienda)
1. Monto total gigante ($415) — es lo que el tendero dicta en voz alta
2. Desglose: mensualidad + cargo por servicio — transparencia frente al cliente
3. Identidad del cliente (nombre, zona, estado) — última verificación antes del dinero
4. Botón "Cobrar $415" ancho, anclado abajo — imposible de errar; deshabilitado si techo bloqueante

### Caja (tienda)
1. Balance actual (efectivo del ISP en la tienda) — el número que define su responsabilidad
2. Comisión acumulada — su ganancia, refuerzo del modelo
3. Botón "Registrar entrega" + estado de la última entrega (pendiente/confirmada)
4. Avisos de techo de saldo

### Cobros (admin, home)
1. Feed en vivo — la promesa central al ISP: ver el dinero entrar en tiempo real
2. Estados de reconexión destacados (en cola/fallidos arriba o filtrables) — lo que exige acción o atención
3. Totales del día (cobrado, # transacciones) — contexto rápido
4. Filtros por tienda/fecha/estado

### Tiendas (admin)
1. Saldo por tienda con alerta visual de techo — la exposición de efectivo es el dato de riesgo
2. Estado y actividad reciente de cada tienda
3. Acciones: ver detalle, editar, suspender
4. Alta de nueva tienda

## User Flows

### Cobro con reconexión (camino crítico)
1. Tendero abre la PWA → home Cobrar con buscador enfocado
2. Escribe ID, teléfono o nombre → resultados con identidad mínima
3. Toca al cliente → pantalla de confirmación con monto y desglose
   - Si el servicio ya está activo y sin saldo pendiente → aviso "Sin adeudo", no hay botón de cobro
   - Si el techo de saldo bloquea → botón deshabilitado + "Registra una entrega para seguir cobrando"
4. Confirma verbalmente con el cliente → toca "Cobrar $415"
5. Pantalla de resultado con estado vivo:
   - WispHub responde → verde "Pagado y reconectado" + folio; comprobante WhatsApp/SMS se envía solo
   - WispHub no responde → ámbar "Pagado — reconexión en cola"; el asiento del ledger se crea igual
6. Toca "Nuevo cobro" → vuelve al buscador limpio

### Reconexión en cola (recuperación automática)
1. Backend reintenta contra WispHub con backoff
2. Al lograrlo → estado del cobro pasa a "Reconectado" en PWA y admin sin acción humana; se envía/actualiza comprobante
3. Si agota reintentos → "Fallido" en rojo; en admin aparece arriba del feed para intervención manual del ISP

### Entrega bilateral (cash drop)
1. Tendero en Caja → "Registrar entrega" → monto sugerido = balance completo (editable hacia abajo)
2. Confirma → asiento "Entrega pendiente" visible en ambas superficies; el balance muestra el monto comprometido
3. Entrega física del efectivo (fuera del sistema)
4. Admin en Entregas → revisa monto → "Confirmar recepción"
   - Si no coincide → "Disputar" con nota; el asiento queda en disputa y ambos ven el mismo ledger para resolver
5. Confirmada → el balance de la tienda baja; el movimiento queda inmutable en ambos historiales

### Registro del ISP (admin)
1. ISP llega a `/registro` → correo + contraseña
2. Recibe correo de verificación (Resend) → confirma
3. Primer inicio de sesión → Configuración le pide la API Key de WispHub antes de operar
4. Con la API Key validada → puede dar de alta tiendas

### Alta de tienda por invitación (admin)
1. Admin → Tiendas → "Nueva tienda"
2. Captura: nombre, responsable, teléfono, zona, comisión por cobro, techo de saldo
3. Guarda → se envía invitación por WhatsApp/SMS al teléfono de la tienda
4. Tendero abre el enlace → establece su contraseña → listo para cobrar
5. Reenviar invitación disponible en el detalle de tienda mientras no haya sido aceptada

### Inicio de sesión (tienda)
1. Abre PWA → si hay sesión válida (larga) → directo a Cobrar
2. Sin sesión → `/login` teléfono + contraseña
3. Olvido → el admin reenvía la invitación desde el detalle de tienda para establecer nueva contraseña (sin self-service en MVP)

## Auth & Session Model

La autenticación se gestiona íntegramente con cookies seguras HTTP-only emitidas por `apps/api`; el navegador nunca ve un JWT. El API es el único que habla con **Agnostic Auth** (IdP stateless en Cloudflare Workers, vía service binding).

- **Cookies**: `gm_access` (JWT HS256 de corta duración, validaciones rápidas) + `gm_refresh` (larga duración, mantiene la sesión). `Secure`, `HttpOnly`, `SameSite` — protegidas contra robo de sesión por XSS.
- **Middleware en cada solicitud**: verifica el token **y** el estatus del usuario en la base de datos — una tienda o admin suspendido pierde acceso de inmediato aunque su token siga vigente.
- **Refresh transparente**: si `gm_access` expiró pero `gm_refresh` es válido, el API intercepta la petición, genera nuevos tokens con `/auth/refresh`, actualiza las cookies y deja continuar la solicitud original. El usuario nunca ve una interrupción.

Mapeo de flujos a Agnostic Auth:

| Flujo | Endpoints |
|-------|-----------|
| Login (tienda y admin) | credenciales → API lee hash+salt de la DB → `/auth/verify-password` → cookies |
| Registro ISP | `/auth/hash` guarda hash+salt; verificación de correo con `/auth/initiate` → magicLink enviado por Resend → `/auth/verify` |
| Invitación de tienda | `/auth/initiate` (identity = teléfono) → magicLink por WhatsApp/SMS → `/auth/verify` al abrirlo → establece contraseña con `/auth/hash` |
| Recuperar contraseña admin | `/auth/initiate` → enlace por Resend → `/auth/verify` → nueva contraseña |
| Cerrar sesión / revocar | `/auth/token/revoke` + limpieza de cookies |

Implicaciones de UX que el diseño debe honrar:

- No existe pantalla de "sesión expirada" en operación normal; solo si `gm_refresh` caduca o fue revocado se vuelve a `/login`.
- La PWA necesita un estado de **cuenta suspendida** (pantalla completa, con contacto del ISP) — puede aparecer en medio de la jornada si el admin suspende la tienda.
- La invitación y la verificación de correo comparten el mismo patrón magicLink: la pantalla `/invitacion/$token` y la verificación del ISP son variantes del mismo componente de canje de token.

## Naming Conventions

| Concepto | Label en UI | Notas |
|----------|-------------|-------|
| Transacción de pago del cliente | **Cobro** | La tienda cobra; "pago" solo en el comprobante del cliente final ("Tu pago fue recibido") |
| Saldo continuo de la tienda | **Caja** / **Balance** | "Caja" nombra la sección; "balance" el número. Nunca "corte" |
| Cash drop al ISP | **Entrega** | Familiar y sin anglicismo. Estados: pendiente / confirmada / en disputa |
| Comisión que paga el cliente final | **Cargo por servicio** | Visible en desglose y comprobante |
| Ganancia de la tienda | **Comisión** | Solo en contexto de tienda/admin, nunca de cara al cliente final |
| Asiento del ledger | **Movimiento** | Tipos: cobro, comisión, entrega |
| Cliente del ISP | **Cliente** | El tendero es **la tienda**; el ISP es **admin** internamente |
| Reactivación en MikroTik | **Reconexión** | Estados: reconectado / en cola / fallido |
| Comprobante | **Comprobante** | Con **folio** único; nunca "ticket" ni "recibo" |
| Acceso inicial de la tienda | **Invitación** | Enlace por WhatsApp/SMS al teléfono; estados: enviada / aceptada |

## Component Reuse Map

| Component | Used on | Behavior differences |
|-----------|---------|---------------------|
| Layout con tabs inferiores | tienda: Cobrar, Caja, Movimientos | Login queda fuera del layout |
| Layout con sidebar | admin: las 4 secciones | Colapsa a menú inferior en móvil |
| Badge de estado de cobro | Resultado (tienda), Movimientos, feed y detalle (admin) | Mismo componente en `packages/ui`: color + ícono + texto |
| Lista de movimientos del ledger | Movimientos (tienda), detalle de tienda (admin) | Admin agrega filtros y export; misma fila base |
| Tarjeta de identidad de cliente | Resultados de búsqueda y confirmación (tienda), detalle de cobro (admin) | Admin puede mostrar más campos que el tendero |
| Desglose de monto | Confirmar cobro, resultado, comprobante, detalle (admin) | Fuente única del formato de montos |
| Tarjeta/fila de entrega | Caja (última entrega), Entregas (admin) | Admin agrega acciones confirmar/disputar |
| Formulario de acceso | Login de ambas apps, registro admin, invitación tienda | Tienda: teléfono + contraseña; admin: correo + contraseña; misma base visual |

## Content Growth Plan

- **Feed de cobros (admin)**: crece sin límite → paginación por cursor, filtros por tienda/estado/rango de fechas. Post-MVP: búsqueda por cliente/folio.
- **Movimientos (tienda)**: crece por tienda → scroll infinito agrupado por día; el balance vive en Caja, no depende de cargar todo el historial.
- **Tiendas (admin)**: decenas en el piloto → tabla simple sin paginación; el diseño no debe romperse con 200 filas (multi-tenant futuro).
- **Entregas**: pendientes siempre arriba y acotadas; historial paginado.
- **Configuración**: fija en MVP; crecerá con multi-tenant (se convertiría en configuración por ISP) — por eso es sección propia y no un modal.

## URL Strategy

- Patrón: `/seccion/$id` — plano, máximo dos segmentos; los detalles usan ID, no slug (datos operativos, no contenido)
- Dynamic segments: `$clienteId` (ID de WispHub), `$cobroId`, `$tiendaId`, `$entregaId`, `$movimientoId` (IDs propios)
- Query parameters: solo en listas del admin — `?tienda=`, `?estado=`, `?desde=&hasta=`, `?cursor=` (filtros compartibles por URL)
- Las dos apps viven en dominios/subdominios separados (ej. `tienda.devolada.app` y `admin.devolada.app`); las rutas no llevan prefijo de rol
