import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "./button";

/* The failed-request state for any list (list-states spec D3).

   It exists as an atom because seven screens need the same recipe, and
   because the state it replaces was a lie: before this, a failed request
   fell through to the empty state and told the shopkeeper they had no
   movements when in fact we could not load them. */

export interface ListErrorProps {
  /* Names the list, in plain es-MX: "tus movimientos", "los cobros" */
  what: string;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}

export function ListError({ what, onRetry, retrying = false, className = "" }: ListErrorProps) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center gap-x-3 gap-y-3 rounded-md border border-error-line bg-error-soft px-4 py-3 text-sm font-medium text-error ${className}`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {/* Colour never travels alone (FRONTEND law) */}
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        No pudimos cargar {what}.
      </span>
      <Button variant="secondary" onClick={onRetry} disabled={retrying} className="h-10 shrink-0 px-4 text-sm">
        <RotateCw className={`size-4 ${retrying ? "animate-spin" : ""}`} aria-hidden />
        {retrying ? "Cargando…" : "Reintentar"}
      </Button>
    </div>
  );
}
