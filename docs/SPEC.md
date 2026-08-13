# Devolada — SPEC

Índice sagrado del proyecto. **Regla de oro: si existe en el código pero no está aquí, está mal.**

Red de puntos de cobro en tienditas para ISPs que usan WispHub. El cliente paga su mensualidad en la tienda de su colonia, su internet se reconecta automáticamente en segundos, la tienda gana comisión sin invertir y el ISP cobra más rápido sin cobranza de campo.

## Reglas del flujo spec-driven (adaptado)

1. Toda funcionalidad nueva: entrevista → decisiones justificadas (D1…Dn en formato mini-ADR: decisión + alternativas descartadas + porqué) → reservar US-ID aquí → escribir `docs/<dominio>/<feature>.spec.md` → registrarlo en este índice **en la misma PR**.
2. El `.spec.md` se actualiza con la realidad durante el desarrollo; nunca se bifurca.
3. **Vía lite**: bugfixes, typos y ajustes de copy no llevan spec ni plan — llevan entrada en `BUGS.md` (si tocó producción) y test. El umbral: si cambia una regla de negocio o un contrato, es spec; si no, es vía lite.
4. Los `.plan.md` son **efímeros**: se borran o archivan al mergear. Solo el spec se mantiene.
5. Al terminar: deuda consciente → `TECH_DEBT.md`; defectos en producción → `BUGS.md`.
6. Los tests nombran su historia (`US-C02: cobra mensualidad exacta…`) para poder rastrear cobertura con grep.

## Glosario

Fuente única de vocabulario (UI, URLs, código). Detalle en `.design/devolada/INFORMATION_ARCHITECTURE.md`.

| Concepto | Término | Nunca |
|----------|---------|-------|
| Transacción de pago del cliente | **Cobro** | "pago" (solo en comprobante al cliente final) |
| Saldo continuo de la tienda | **Caja** / **Balance** | "corte" |
| Cash drop al ISP | **Entrega** | "corte", "cash drop" |
| Comisión que paga el cliente final | **Cargo por servicio** | — |
| Ganancia de la tienda | **Comisión** | (nunca de cara al cliente final) |
| Asiento del ledger | **Movimiento** | — |
| Reactivación en MikroTik | **Reconexión** | — |
| Comprobante con folio único | **Comprobante** / **Folio** | "ticket", "recibo" |
| Acceso inicial de tienda | **Invitación** | — |

## Historias de Usuario

### Auth y sesiones (S)
- **US-S01** — Como tienda, inicio sesión con teléfono + contraseña y mi sesión dura semanas en mi dispositivo.
- **US-S02** — Como usuario con sesión, nunca veo "sesión expirada" en operación normal: los tokens se renuevan solos.
- **US-S03** — Como ISP, al suspender una tienda su acceso se revoca de inmediato, aunque tenga sesión viva.
- **US-S04** — Como ISP, me registro con correo + contraseña y verifico mi correo (Resend) antes de operar.
- **US-S05** — Como tienda, recibo una invitación por WhatsApp/SMS y establezco mi contraseña desde el enlace.
- **US-S06** — Como ISP, recupero mi contraseña por correo; como tienda, el ISP me reenvía la invitación.

### Cobros (C)
- **US-C01** — Como tienda, busco al cliente por ID, teléfono o nombre y veo solo lo mínimo para confirmar su identidad.
- **US-C02** — Como tienda, cobro la mensualidad exacta con desglose visible (mensualidad + cargo por servicio).
- **US-C03** — Como cliente final, mi servicio se reconecta automáticamente en segundos tras pagar; la tienda ve el estado en vivo.
- **US-C04** — Como tienda, nunca se me rechaza un cobro por fallas de WispHub: queda registrado y la reconexión entra en cola con reintentos.
- **US-C05** — Como cliente final, recibo comprobante por WhatsApp/SMS con folio único.

### Caja (K)
- **US-K01** — Como tienda, veo mi balance (efectivo del ISP en mi poder) y mi comisión acumulada; todo número se desglosa en sus movimientos.
- **US-K02** — Como tienda, registro una entrega de efectivo que queda pendiente hasta que el ISP la confirma.
- **US-K03** — Como tienda, consulto mi ledger de movimientos (cobros, comisiones, entregas) inmutable.
- **US-K04** — Como tienda, el techo de saldo me avisa al acercarme y bloquea cobros al superarse, con explicación clara.

### Entregas — lado admin (E)
- **US-E01** — Como ISP, confirmo la recepción de una entrega y el balance de la tienda baja.
- **US-E02** — Como ISP, disputo una entrega con nota si el monto no coincide; ambos vemos el mismo ledger para resolver.

### Admin (A)
- **US-A01** — Como ISP, veo los cobros aparecer en tiempo real con su estado de reconexión; los fallidos exigen mi atención.
- **US-A02** — Como ISP, doy de alta tiendas y les envío invitación; puedo reenviarla mientras no sea aceptada.
- **US-A03** — Como ISP, gestiono cada tienda: comisión, techo de saldo, suspender, ver su ledger.
- **US-A04** — Como ISP, configuro mi API Key de WispHub (validada en vivo), el cargo por servicio y el reparto de comisión.

## Funcionalidades por Fase

Detalle operativo en `.design/devolada/TASKS.md` (capa de ejecución).

- **Fase 0 — Riesgo**: spike WispHub (pago → reactivación). ⏳ pendiente de API Key
- **Fase 1 — Fundación**: tokens vivos ✅ · átomos compartidos ✅ · API base con sesiones ✅ · registro/acceso ISP ⏳
- **Fase 2 — PWA Tienda**: shell, buscador, cobrar, resultado vivo, caja, entregas, movimientos, estados especiales
- **Fase 3 — Dashboard Admin**: shell, feed en vivo, tiendas, entregas, configuración
- **Fase 4 — Backend de soporte**: cola de reconexión, comprobantes
- **Fase 5 — Polish**: estados de listas, modo oscuro, responsive, accesibilidad, design review

## Índice de specs

| Spec | Dominio | Historias | Estado |
|------|---------|-----------|--------|
| [auth/sesiones.spec.md](auth/sesiones.spec.md) | auth | US-S01, US-S02, US-S03 | vigente |
| auth/registro-isp.spec.md | auth | US-S04, US-S06 | pendiente |
| auth/invitacion-tienda.spec.md | auth | US-S05 | pendiente |
| cobros/*.spec.md | cobros | US-C01…C05 | pendiente |
| caja/*.spec.md | caja | US-K01…K04 | pendiente |
| entregas/*.spec.md | entregas | US-E01, US-E02 | pendiente |
| admin/*.spec.md | admin | US-A01…A04 | pendiente |

## Capas transversales

- [ARCHITECTURE.md](ARCHITECTURE.md) — reglas arquitectónicas globales
- [FRONTEND.md](FRONTEND.md) — leyes de UI que ninguna feature re-decide
- [CICD.md](CICD.md) — pipeline: trunk-based, preview por PR, dev automático, prod con approval gate
- [TESTING.md](TESTING.md) — reglas de prueba
- [BUGS.md](BUGS.md) · [TECH_DEBT.md](TECH_DEBT.md)
- [integrations/](integrations/) — contratos de terceros (se consumen, no se re-deciden)
- `.design/devolada/` — capa de diseño: brief, IA, tokens, tasks (el design system vive en `packages/ui`)
