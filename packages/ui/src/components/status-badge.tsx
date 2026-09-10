import type { ComponentType } from "react";
import {
  AlertTriangle,
  ClipboardCheck,
  Eye,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  CircleMinus,
  CirclePlus,
  Clock3,
  Equal,
  Hourglass,
  Mail,
  PauseCircle,
  Store,
  TimerOff,
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
  /* partial-payment D5/D9: the money was recorded and the service was
     deliberately not restored, because the payment did not reach the
     ISP's threshold. Not "failed" — nothing broke, and a red badge would
     send the ISP looking for a problem that does not exist. */
  | "withheld"
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
  | "invited"
  /* direct SPEI payment (direct-payment spec D10). "confirmed" above
     belongs to cash drops — same rule as storeActive: a different
     concept gets different words. */
  | "validating"
  | "paymentConfirmed"
  | "paymentInvalid"
  | "paymentPartial"
  | "paymentExpired"
  | "unapplied"
  /* reconciliation class (payments-and-classes D1/D3): the verdict
     against the ask, distinct from the lifecycle status — a lenient
     threshold can reconnect a `short` payment, and the class is what
     keeps saying money is missing. */
  | "classExact"
  | "classShort"
  | "classOver"
  /* integrations-hub D4/D7: the gate held the action back; the business
     executes by hand while the ramp measures the oracle. */
  | "observation"
  /* integrations-hub D7: `done` under register_only — the router was
     deliberately never asked, so "Reconectado" would be a lie. */
  | "registered";

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
  withheld: { tone: "warning", icon: PauseCircle, label: "Sin reactivar" },
  pending: { tone: "warning", icon: ArrowDownToLine, label: "Entrega pendiente" },
  confirmed: { tone: "success", icon: Check, label: "Entrega confirmada" },
  disputed: { tone: "error", icon: AlertTriangle, label: "En disputa" },
  active: { tone: "success", icon: Wifi, label: "Servicio activo" },
  suspended: { tone: "error", icon: WifiOff, label: "Servicio suspendido" },
  storeActive: { tone: "success", icon: Store, label: "Tienda activa" },
  storeSuspended: { tone: "error", icon: Store, label: "Tienda suspendida" },
  invited: { tone: "warning", icon: Mail, label: "Invitación enviada" },
  validating: { tone: "info", icon: Hourglass, label: "Verificando pago" },
  paymentConfirmed: { tone: "success", icon: CheckCircle2, label: "Pago confirmado" },
  paymentInvalid: { tone: "error", icon: XCircle, label: "Pago no válido" },
  paymentPartial: { tone: "warning", icon: PauseCircle, label: "Pago incompleto" },
  paymentExpired: { tone: "warning", icon: TimerOff, label: "Verificación expirada" },
  unapplied: { tone: "warning", icon: AlertTriangle, label: "Pago sin adeudo" },
  classExact: { tone: "success", icon: Equal, label: "Exacto" },
  classShort: { tone: "warning", icon: CircleMinus, label: "Pago parcial" },
  classOver: { tone: "info", icon: CirclePlus, label: "Sobrante" },
  observation: { tone: "info", icon: Eye, label: "Observación" },
  registered: { tone: "success", icon: ClipboardCheck, label: "Registrado" },
};

/* The shared control-size vocabulary (feedback-vocabulary-rollout D11,
   design-foundations data model: Control size). A screen names the context it
   serves and never states a height.

   The NAMES, not the heights. `compact` on a button is 40px because a pointer
   has to land on it; a badge is read and never aimed at, so it carries no
   touch-target obligation and keeps the dimensions it has always had. Renaming
   these changed no pixel — the review captures are the proof.

   No `decisive`. A badge has no committing-action context, and a member of the
   vocabulary with nowhere to go is left out rather than filled in for
   symmetry (FR-013). */
const sizes = {
  compact: { badge: "gap-1.5 px-3 py-1 text-sm", icon: "size-4" },
  standard: { badge: "gap-2 px-4 py-1.5 text-base", icon: "size-5" },
} as const;

export interface StatusBadgeProps {
  status: Status;
  /* `compact` for the dense back office — tables, lists, rows.
     `standard` for touch: the payer's surface and the store counter. */
  size?: keyof typeof sizes;
  className?: string;
}

export function StatusBadge({ status, size = "compact", className = "" }: StatusBadgeProps) {
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
