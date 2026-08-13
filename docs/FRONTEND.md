# Leyes de frontend

Reglas transversales de UI. Cada `.spec.md` incluye además su sección **Contrato de UI** (estados, responsive, accesibilidad, componentes que reutiliza vs crea, microcopy). Estas leyes no se re-deciden por feature.

## Fuente visual única

- **Los tokens son ley**: todo color, espacio, radio, sombra y tamaño sale de `packages/ui/src/styles/tokens.css`. Cero valores hardcodeados. (El espejo de diseño en `.design/devolada/DESIGN_TOKENS.css` se sincroniza desde el vivo.)
- **`EstadoBadge` es la única representación de estados** del dominio (reconexión, entregas, servicio). Prohibido re-crear pills de estado por pantalla; si falta un estado, se agrega al átomo.
- **`Monto` / `DesgloseMonto` / `formatearMonto`** para todo dinero visible. El total de un desglose siempre se calcula, nunca se pasa a mano.
- Filosofía: funcionalista (Rams) con acento cálido. Color = información (verde cobrado / ámbar en cola / rojo fallido); nada decorativo sin función; sin bounce.

## PWA tienda

- Móvil-primero con piso real de **360px**; contenido centrado a `--max-width-content` en pantallas grandes.
- Táctiles ≥ 48px (`--size-touch`); acciones críticas de cobro a 64px (`--size-touch-lg`) ancladas a la zona del pulgar.
- Máximo 3 pasos por cobro; cero jerga técnica; es-MX llano.
- Estados obligatorios: cuenta suspendida (pantalla completa, puede aparecer a media jornada), sin conexión, WispHub en cola.

## Admin

- Desktop-primero pero usable en móvil: tablas colapsan a tarjetas, sidebar a menú inferior; confirmar una entrega desde el teléfono toma dos toques.
- Navegación de un solo nivel: 4 secciones, el detalle vive dentro de cada una.

## Ambas superficies

- Claro + oscuro vía tokens (`[data-theme]` + `prefers-color-scheme`); el oscuro es carbón cálido recalibrado, nunca inversión.
- Contraste AA mínimo; AAA objetivo en montos y estados. El color nunca viaja solo: siempre ícono + texto.
- `aria-live` en feeds y transiciones de estado; teclado + focus visible en admin; `prefers-reduced-motion` respetado (ya en la hoja base).
- Sin pantalla de "sesión expirada" en operación normal (US-S02); solo si el refresh caduca se vuelve a login.
