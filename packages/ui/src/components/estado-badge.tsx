import type { ComponentType } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Clock3,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";

/* Fuente de verdad visual de los estados del dominio.
   Regla del brief: color + ícono + texto, el color nunca viaja solo.
   Las etiquetas vienen del glosario de la IA; no se personalizan por
   pantalla para que el mismo estado se lea igual en PWA y admin. */

export type Estado =
  /* reconexión de un cobro */
  | "reconectado"
  | "en_cola"
  | "fallido"
  /* entrega (cash drop) */
  | "pendiente"
  | "confirmada"
  | "en_disputa"
  /* servicio del cliente */
  | "activo"
  | "suspendido";

type Tono = "success" | "warning" | "error" | "info";

const tonos: Record<Tono, string> = {
  success: "text-success bg-success-soft border-success-line",
  warning: "text-warning bg-warning-soft border-warning-line",
  error: "text-error bg-error-soft border-error-line",
  info: "text-info bg-info-soft border-info-line",
};

const estados: Record<
  Estado,
  { tono: Tono; icono: ComponentType<{ className?: string }>; etiqueta: string }
> = {
  reconectado: { tono: "success", icono: CheckCircle2, etiqueta: "Reconectado" },
  en_cola: { tono: "warning", icono: Clock3, etiqueta: "Reconexión en cola" },
  fallido: { tono: "error", icono: XCircle, etiqueta: "Fallido" },
  pendiente: { tono: "warning", icono: ArrowDownToLine, etiqueta: "Entrega pendiente" },
  confirmada: { tono: "success", icono: Check, etiqueta: "Entrega confirmada" },
  en_disputa: { tono: "error", icono: AlertTriangle, etiqueta: "En disputa" },
  activo: { tono: "success", icono: Wifi, etiqueta: "Servicio activo" },
  suspendido: { tono: "error", icono: WifiOff, etiqueta: "Servicio suspendido" },
};

const tamanos = {
  sm: { badge: "gap-1.5 px-3 py-1 text-sm", icono: "size-4" },
  md: { badge: "gap-2 px-4 py-1.5 text-base", icono: "size-5" },
} as const;

export interface EstadoBadgeProps {
  estado: Estado;
  /* sm para tablas y listas del admin; md para la PWA de mostrador */
  tamano?: keyof typeof tamanos;
  className?: string;
}

export function EstadoBadge({ estado, tamano = "sm", className = "" }: EstadoBadgeProps) {
  const { tono, icono: Icono, etiqueta } = estados[estado];
  const t = tamanos[tamano];
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${tonos[tono]} ${t.badge} ${className}`}
    >
      <Icono className={`${t.icono} shrink-0`} aria-hidden />
      {etiqueta}
    </span>
  );
}
