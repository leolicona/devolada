# Design Brief: Devolada

Red de puntos de cobro en tienditas para ISPs que usan WispHub. MVP con un ISP piloto y dos superficies: **PWA móvil para la tienda** (cobrar) y **dashboard web para el ISP/admin** (supervisar y conciliar).

## Problem

**Para el cliente del ISP:** se quedó sin internet por falta de pago y no tiene dónde pagar cerca. Pagar implica esperar al cobrador o viajar, y aún pagando, la reconexión depende de que alguien del ISP toque el MikroTik.

**Para el tendero:** quiere ganar dinero extra sin invertir ni aprender un sistema complicado. Cobra con clientes formados en el mostrador; cualquier pantalla confusa o paso de más le cuesta tiempo y credibilidad frente a su vecino.

**Para el ISP:** pierde clientes y horas-persona en cobranza de campo y reconexiones manuales. No sabe en tiempo real quién pagó ni cuánto efectivo suyo está en la calle.

## Solution

Una experiencia de cobro de mostrador en tres pasos —buscar cliente, confirmar identidad y monto, cobrar— donde la reconexión ocurre sola en segundos y el comprobante llega por WhatsApp/SMS. La tienda opera una **caja de saldo continuo**: ve cuánto efectivo tiene del ISP, cuánta comisión lleva ganada, y registra entregas cuando le convenga. El ISP ve cada cobro aparecer en vivo, confirma entregas de efectivo y administra sus tiendas sin tocar la base de datos ni el router.

## Experience Principles

1. **Certeza sobre velocidad** — Nunca dejar duda de qué pasó con el dinero. Cada transacción termina en un estado inequívoco (cobrado + reconectado, cobrado + reconexión en cola, fallido) con color, ícono y texto redundantes. Un cobro jamás se rechaza por fallas de WispHub: se registra y la reconexión se reintenta con estado visible.
2. **Mostrador primero** — La PWA se diseña para un Android económico, con sol, prisa y una fila de clientes. Montos en tipografía gigante, objetivos táctiles grandes, máximo 3 pasos por cobro, cero jerga técnica. Si el tendero necesita capacitación, fallamos.
3. **El ledger es la verdad** — Todo movimiento de dinero (cobro, comisión auto-cobrada, entrega) es un asiento inmutable visible para ambas partes. La interfaz nunca muestra un número que no pueda explicarse tocándolo: cada saldo se desglosa en sus movimientos.

## Aesthetic Direction

- **Philosophy**: Funcionalista (Dieter Rams) con acento cálido. "Menos pero mejor": color como información —verde = cobrado/reconectado, ámbar = pendiente/en cola, rojo = suspendido/fallido—, nada decorativo sin función. Evitar frialdad clínica con un acento cálido y lenguaje llano mexicano.
- **Tone**: Confianza serena. Sólido y sin ambigüedad, pero accesible para un usuario no técnico. Los estados se entienden de un vistazo.
- **Reference points**: Clip y Mercado Pago Point para el flujo de cobro (montos protagonistas, confirmaciones inequívocas, 2-3 pasos); Stripe Dashboard para el lado ISP (feed de transacciones, tablas limpias, jerarquía de datos impecable).
- **Anti-references**: WispHub y ERPs tradicionales (formularios densos, menús interminables, estética administrativa); apps bancarias corporativas (frialdad, lenguaje legal, fricción de seguridad que estorba en mostrador).

## Existing Patterns

Proyecto nuevo, sin código previo. No hay tokens, componentes ni convenciones que respetar. Los tokens se crean en la fase 4 de este flujo.

- Typography: por definir en tokens (sans-serif limpia, escala estricta, números tabulares para montos)
- Colors: por definir en tokens (neutros + un acento funcional + semánticos verde/ámbar/rojo)
- Spacing: por definir en tokens (escala base 4px/8px)
- Components: base shadcn/ui sobre Tailwind; todo componente de dominio es nuevo

## Component Inventory

| Component | Status | Notes |
| --------- | ------ | ----- |
| Buscador de cliente | New | Input único (ID/teléfono/nombre) con resultados mínimos para confirmar identidad |
| Tarjeta de confirmación de cliente | New | Nombre, zona, estado del servicio, desglose mensualidad + cargo de servicio |
| Pantalla de cobro | New | Monto gigante, botón de confirmación grande, desglose de comisión |
| Estado de transacción | New | Cobrado/reconectando/en cola/fallido; color + ícono + texto redundantes |
| Saldo de caja (tienda) | New | Balance actual, comisión acumulada, botón de registrar entrega |
| Lista de movimientos del ledger | New | Asientos inmutables: cobro, comisión, entrega; compartida entre PWA y dashboard |
| Registro/confirmación de cash drop | New | Bilateral: tienda registra, admin confirma; estado pendiente entre ambos |
| Feed de cobros en vivo (ISP) | New | Transacciones en tiempo real con estado de reconexión |
| Tabla de tiendas con saldos (ISP) | New | Balance por tienda, alerta de techo de saldo, acciones |
| Alta/edición de tienda (ISP) | New | Datos, teléfono, comisión acordada, techo de saldo |
| Login tienda (teléfono + contraseña) | New | Sesión larga en dispositivo; acceso inicial por invitación WhatsApp/SMS donde establece contraseña |
| Registro/login admin (correo + contraseña) | New | Registro self-service del ISP; verificación y recuperación por correo vía Resend |
| Comprobante (plantilla WhatsApp/SMS) | New | Folio único, desglose, estado de reconexión |
| Pantalla de cuenta suspendida | New | Estado de pantalla completa en la PWA con contacto del ISP; puede aparecer a media jornada |
| Canje de token mágico | New | Base compartida: invitación de tienda, verificación de correo y recuperación de contraseña |

## Key Interactions

- **Cobro (camino crítico)**: buscar → tocar resultado → confirmar verbalmente identidad y monto → botón "Cobrar $415" → pantalla de resultado con estado de reconexión en vivo (spinner → verde "Reconectado" o ámbar "En cola, se reconectará automáticamente"). El comprobante se envía solo; el tendero no decide nada extra.
- **Reconexión en cola**: si WispHub no responde, el cobro queda registrado y el estado es visible en la PWA y el dashboard; al resolverse, el estado transiciona a verde sin acción del usuario.
- **Cash drop bilateral**: tienda registra entrega (monto sugerido = balance) → asiento "pendiente" visible para ambos → admin confirma al recibir → balance baja. Disputas se resuelven viendo el mismo ledger.
- **Techo de saldo**: al acercarse al umbral, la PWA muestra aviso persistente ("Registra una entrega pronto"); al superarlo, alerta al admin y según configuración bloquea nuevos cobros con explicación clara.
- **Feed en vivo (ISP)**: los cobros aparecen sin refrescar; cada fila expande el detalle (cliente, tienda, desglose, estado de reconexión, folio).

## Responsive Behavior

- **PWA tienda**: móvil primero (360px como piso). Una columna, acciones ancladas al fondo (zona del pulgar). En tablet/desktop simplemente centra el contenido con ancho máximo; no hay layout alterno.
- **Dashboard ISP**: desktop primero (tablas y feed), pero usable en móvil: las tablas colapsan a tarjetas apiladas, la navegación lateral pasa a menú inferior/hamburguesa. Confirmar un cash drop desde el teléfono debe ser cómodo.
- Ambas superficies: claro + oscuro. El oscuro no es inversión de colores: fondos carbón cálido, semánticos recalibrados para contraste.

## Accessibility Requirements

- Contraste AA mínimo (4.5:1 texto normal, 3:1 texto grande) en ambos temas; los montos y estados apuntan a AAA.
- El color nunca es el único canal: todo estado lleva ícono + texto.
- Objetivos táctiles ≥ 48px en la PWA; los botones del camino crítico de cobro, más grandes.
- Navegación completa por teclado y focus visible en el dashboard.
- `aria-live` para el feed en vivo y las transiciones de estado de reconexión.
- Idioma es-MX, lenguaje llano; montos con formato `$1,234.00` y tipografía tabular.

## Out of Scope

- Multi-tenant (onboarding de múltiples ISPs, aislamiento de datos): el esquema deja espacio, la UI no lo expone.
- Gastos operativos en el ledger de tiendas.
- Montos parciales o pago de meses adelantados: solo mensualidad exacta + cargo de servicio.
- Integración bancaria para verificar transferencias de cash drops (la confirmación es manual bilateral).
- Reportes y analítica del ISP (tendencias, comparativas): post-MVP.
- Impresión térmica de tickets.
- Facturación automática de la comisión de plataforma al ISP (se liquida mensualmente fuera del sistema, con el ledger como fuente).
- App o portal para el cliente final: su experiencia es presencial + comprobante por WhatsApp/SMS.
- Recuperación self-service de contraseña para tiendas: el admin reenvía la invitación desde el detalle de tienda.
