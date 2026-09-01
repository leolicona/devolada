import { Alert, Amount } from "@devolada/ui";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CircleDollarSign, PauseCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BusinessActor } from "../auth/session";

/* prepaid-credit D7 (US-B04): the chip in the shell. Each step changes
   label and icon, never color alone (FRONTEND law, brief). A chip, not a
   nav section (IA): it is a status, not a place — tapping opens
   Configuración → Saldo y recargas. Every role sees it: a paused
   business is everyone's problem to know. */

export const STEP_COPY = {
  ok: { label: "Saldo", icon: CircleDollarSign, tone: "text-foreground" },
  low: { label: "Saldo bajo", icon: TriangleAlert, tone: "text-warning" },
  empty: { label: "Sin saldo", icon: AlertTriangle, tone: "text-error" },
  paused: { label: "Validación en pausa", icon: PauseCircle, tone: "text-error" },
} as const;

export function CreditChip({ credit }: { credit: BusinessActor["credit"] }) {
  const step = STEP_COPY[credit.step];
  const Icon = step.icon;
  return (
    <Link
      to="/settings"
      hash="saldo"
      aria-label={`${step.label}: ${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(credit.balanceCents / 100)}`}
      className={`flex items-center gap-2 rounded-md border border-border bg-well px-3 py-1.5 text-sm ${step.tone} hover:bg-muted`}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="font-medium">{step.label}</span>
      <Amount cents={credit.balanceCents} className="ml-auto text-sm font-semibold" />
    </Link>
  );
}

/* The two banners that change what an owner would do today (D7): "Sin
   saldo" as a warning, "Validación en pausa" as an error with the way
   out. "Saldo bajo" stays in the chip alone. */
export function CreditBanner({ credit }: { credit: BusinessActor["credit"] }) {
  if (credit.step === "ok" || credit.step === "low") return null;
  const paused = credit.step === "paused";
  return (
    <Alert
      variant={paused ? "destructive" : "warning"}
      className="m-4 flex items-center justify-between gap-4 lg:mx-8 lg:mt-6"
    >
      <span className="flex items-center gap-2">
        {paused ? <PauseCircle className="size-4 shrink-0" aria-hidden /> : <AlertTriangle className="size-4 shrink-0" aria-hidden />}
        {paused
          ? "Validación en pausa: los comprobantes nuevos de tus clientes quedan guardados sin validarse hasta que recargues."
          : "Tu saldo llegó a cero. Los pagos se siguen validando unos días más; recarga para no llegar a la pausa."}
      </span>
      <Link to="/settings" hash="saldo" className="block">
        <Button variant={paused ? "default" : "outline"}>Recargar</Button>
      </Link>
    </Alert>
  );
}
