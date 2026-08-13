# Build Tasks: Devolada

Generated from: .design/devolada/DESIGN_BRIEF.md (+ INFORMATION_ARCHITECTURE.md, DESIGN_TOKENS.css)
Date: 2026-08-13

Orden: riesgo primero (spike WispHub), luego fundación visual para validar la dirección estética, luego rebanadas verticales por superficie. Cada tarea incluye estructura + estilo + interacción y es verificable por sí sola.

## Riesgo primero

- [ ] **Spike WispHub**: con la API Key real, probar buscar cliente (por ID/teléfono/nombre), registrar un pago y verificar que el servicio se reactiva en el MikroTik; documentar endpoints, latencias y limitaciones en `.design/devolada/WISPHUB_SPIKE.md`. Si la reactivación no es automática vía API, el hallazgo redefine el producto — por eso va antes que todo. _Sin UI; bloquea todo el backend._

## Fundación

- [x] **Tokens vivos en packages/ui**: montar el monorepo mínimo necesario para servir una página de muestra que renderice `DESIGN_TOKENS.css` (escala tipográfica, montos con tabular-nums, botones, badges, claro/oscuro) con Tailwind v4 + Archivo/JetBrains Mono self-hosted. Aquí se establece la filosofía funcionalista Rams cálida: esta página es el veredicto de la dirección visual antes de construir pantallas. _Reuses: DESIGN_TOKENS.css._
- [ ] **Átomos compartidos: Badge de estado + Desglose de monto**: los dos componentes fuente-de-verdad de `packages/ui`. Badge: tinta + fondo + borde + ícono + texto para reconectado/en cola/fallido/pendiente/confirmada/en disputa. Desglose: mensualidad + cargo por servicio + total, formato `$1,234.00` tabular. Verificables en la página de muestra. _New components; los consumen ambas apps._
- [x] **API base con sesiones**: `apps/api` (Hono + Drizzle + Zod en Workers) con esquema inicial (isp, tienda, cobro, movimiento, entrega, invitación) y middleware de cookies `gm_access`/`gm_refresh` contra Agnostic Auth (service binding): verificación de estatus en DB por solicitud, refresh transparente, revoke en logout. Verificable con curl: login de tienda (teléfono+contraseña vía `/auth/verify-password`) y sesión que sobrevive expiración del access token. _Depends on: Spike WispHub (solo para el diseño del esquema de cobros)._
- [ ] **Registro y acceso del ISP**: `/registro` con correo + contraseña (`/auth/hash`), verificación de correo vía `/auth/initiate` + Resend + `/auth/verify`, y `/recuperar` con el mismo patrón. Incluye el componente de canje de token mágico que reutilizará la invitación de tienda. Empieza con `docs/auth/registro-isp.spec.md` y **monta la infraestructura de testing** (matriz de `docs/TESTING.md`: vitest-pool-workers, Testing Library, MSW, Playwright+axe) — sus escenarios nacen automatizados y se retro-cubren los 8 de sesiones (TD-005). _New; base visual del formulario de acceso compartido._

## PWA Tienda (camino crítico)

- [ ] **Shell de la PWA**: layout con 3 tabs inferiores (Cobrar · Caja · Movimientos, 64px), login teléfono + contraseña, manifest instalable, sesión larga. Móvil-primero con piso 360px, contenido centrado a `--max-width-content` en pantallas grandes. _Reuses: formulario de acceso, tokens._
- [ ] **Cobrar — buscador**: home con input enfocado al abrir, búsqueda por ID/teléfono/nombre (proxy del API a WispHub), resultados con identidad mínima (nombre, zona, estado del servicio). Estados: vacío, buscando, sin resultados, WispHub caído (aviso de cola). _Depends on: API base._
- [ ] **Cobrar — confirmar y cobrar**: `/cobrar/$clienteId` con monto en `--font-size-amount`, desglose, tarjeta de identidad y botón "Cobrar $X" de 64px anclado abajo. Estados: sin adeudo (sin botón), techo de saldo bloqueante (botón deshabilitado + explicación). _Reuses: Desglose de monto._
- [ ] **Resultado de cobro con estado vivo**: `/cobros/$cobroId` — registra el cobro + asientos del ledger (cobro y comisión), muestra transición reconectando → reconectado (verde) / en cola (ámbar) con polling, folio en mono, botón "Nuevo cobro". El cobro nunca se rechaza por fallas de WispHub. _Reuses: Badge de estado. Depends on: cola de reconexión (puede stubearse)._
- [ ] **Caja**: balance actual protagonista (`--font-size-3xl`), comisión acumulada, estado de la última entrega, avisos de techo de saldo (cercano/superado), nombre de tienda y cerrar sesión. Cada número se desglosa tocándolo (principio: el ledger es la verdad). _Reuses: Badge, Desglose._
- [ ] **Registrar entrega + Movimientos**: `/caja/entregar` con monto sugerido = balance (editable hacia abajo) creando asiento pendiente; `/movimientos` con ledger agrupado por día (scroll infinito) y detalle por movimiento. _Reuses: lista de movimientos compartida con admin._
- [ ] **Estados especiales de la PWA**: pantalla completa de cuenta suspendida (con contacto del ISP; puede aparecer a media jornada), `/invitacion/$token` para establecer contraseña (canje de token mágico), y aviso de sin conexión. _Reuses: canje de token mágico._

## Dashboard Admin

- [ ] **Shell del admin**: sidebar de 4 secciones (Cobros · Tiendas · Entregas · Configuración) con cuenta al pie, colapso a menú inferior en móvil, login correo + contraseña. Desktop-primero. _Reuses: formulario de acceso, tokens._
- [ ] **Feed de cobros en vivo**: home con transacciones en tiempo real (estado de reconexión visible, fallidos destacados arriba), totales del día, filtros por tienda/estado/fechas vía query params, detalle expandible `/cobros/$cobroId` con línea de tiempo de reconexión. _Reuses: Badge, Desglose. Referencia: Stripe Dashboard._
- [ ] **Tiendas**: tabla con saldo por tienda y alerta de techo, alta con invitación por WhatsApp/SMS (enlace copiable como fallback si no hay proveedor de mensajería), detalle `/tiendas/$tiendaId` con ledger completo, edición de comisión/techo, suspender y reenviar invitación. _Reuses: lista de movimientos._
- [ ] **Entregas**: pendientes de confirmar arriba con acciones confirmar/disputar (con nota), historial paginado, badge contador en el sidebar. Confirmar desde el teléfono en dos toques. _Reuses: Badge._
- [ ] **Configuración**: API Key de WispHub con validación en vivo (probar conexión), cargo por servicio, reparto de comisión tienda/plataforma. Primer login exige API Key antes de operar. _Sección propia pensando en multi-tenant futuro._

## Backend de soporte

- [ ] **Cola de reconexión**: reintentos con backoff contra WispHub (Cloudflare Queues), transiciones de estado del cobro (en cola → reconectado / fallido) que la PWA y el feed observan, idempotencia por cobro. _Depends on: Spike WispHub._
- [ ] **Comprobante por WhatsApp/SMS**: plantilla con folio, desglose y estado de reconexión; envío al registrar el cobro y actualización al reconectar. Decisión pendiente de proveedor (Meta WhatsApp Business API vs Twilio) — la plantilla y el trigger se construyen agnósticos del proveedor. _Reuses: Desglose de monto._

## Interacciones, Responsive y Polish

- [ ] **Estados de listas en ambas apps**: vacío (primera vez sin cobros/tiendas), carga (skeletons), error con reintento, para feed, movimientos, tiendas y entregas. Covers: empty, loading, error.
- [ ] **Pase de modo oscuro**: revisar ambas apps contra los tokens dark (carbón cálido); ningún color hardcodeado fuera de tokens. Covers: claro, oscuro, preferencia de sistema + toggle manual.
- [ ] **Pase responsive**: PWA a 360px real y centrada en desktop; admin con tablas → tarjetas y sidebar → menú inferior en móvil. Breakpoints: 375/768/1024/1280.
- [ ] **Pase de accesibilidad**: contraste AA (AAA en montos y estados), color nunca solo (ícono + texto), táctiles ≥48px, teclado + focus visible en admin, `aria-live` en feed y transiciones de reconexión, es-MX llano.

## Review

- [ ] **Design review**: correr /design-review contra el brief con las apps corriendo (screenshots claro/oscuro, 360/768/1280).
