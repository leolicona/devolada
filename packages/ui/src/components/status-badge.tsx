import type { ComponentType } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Clock3,
  Mail,
  Store,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";

/* Single visual source of truth for domain statuses.
   Brief rule: color + icon + text — color never travels alone.
   Labels are user-facing product copy (es-MX) from the IA glossary; they are
   not customizable per screen so the same status reads identically in the
   store PWA and the admin dashboard. */

export type Status =
  /* charge reconnection */
  | "reconnected"
  | "queued"
  | "failed"
  /* cash drop */
  | "pending"
  | "confirmed"
  | "disputed"
  /* the subscriber's internet service */
  | "active"
  | "suspended"
  /* the store's account — a different concept, so different words
     (design-review D2). Sharing the pair told the ISP that a suspended
     shop's internet was down. */
  | "storeActive"
  | "storeSuspended"
  /* store invitation */
  | "invited";

type Tone = "success" | "warning" | "error" | "info";

const tones: Record<Tone, string> = {
  success: "text-success bg-success-soft border-success-line",
  warning: "text-warning bg-warning-soft border-warning-line",
  error: "text-error bg-error-soft border-error-line",
  info: "text-info bg-info-soft border-info-line",
};

const statuses: Record<
  Status,
  { tone: Tone; icon: ComponentType<{ className?: string }>; label: string }
> = {
  reconnected: { tone: "success", icon: CheckCircle2, label: "Reconectado" },
  queued: { tone: "warning", icon: Clock3, label: "Reconexión en cola" },
  failed: { tone: "error", icon: XCircle, label: "Fallido" },
  pending: { tone: "warning", icon: ArrowDownToLine, label: "Entrega pendiente" },
  confirmed: { tone: "success", icon: Check, label: "Entrega confirmada" },
  disputed: { tone: "error", icon: AlertTriangle, label: "En disputa" },
  active: { tone: "success", icon: Wifi, label: "Servicio activo" },
  suspended: { tone: "error", icon: WifiOff, label: "Servicio suspendido" },
  storeActive: { tone: "success", icon: Store, label: "Tienda activa" },
  storeSuspended: { tone: "error", icon: Store, label: "Tienda suspendida" },
  invited: { tone: "warning", icon: Mail, label: "Invitación enviada" },
};

const sizes = {
  sm: { badge: "gap-1.5 px-3 py-1 text-sm", icon: "size-4" },
  md: { badge: "gap-2 px-4 py-1.5 text-base", icon: "size-5" },
} as const;

export interface StatusBadgeProps {
  status: Status;
  /* sm for admin tables and lists; md for the store counter */
  size?: keyof typeof sizes;
  className?: string;
}

export function StatusBadge({ status, size = "sm", className = "" }: StatusBadgeProps) {
  const { tone, icon: Icon, label } = statuses[status];
  const s = sizes[size];
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${tones[tone]} ${s.badge} ${className}`}
    >
      <Icon className={`${s.icon} shrink-0`} aria-hidden />
      {label}
    </span>
  );
}
