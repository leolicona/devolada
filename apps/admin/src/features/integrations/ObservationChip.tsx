import { Link } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

/* integrations-hub D4: the shell wears a chip while observing — a paused
   hand is context everyone reading Pagos needs, so EVERY role sees it
   (the CreditChip's own rule). A chip, not a nav section (IA): it is a
   status, and tapping it opens the place where the switch lives.
   In the phone's one-line bar the chip is the eye alone; the words stay
   for screen readers. */
export function ObservationChip({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/integrations/wisphub"
      title={compact ? "Modo observación" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-md border border-info-line bg-info-soft text-sm text-info hover:bg-muted",
        compact ? "w-8 justify-center" : "px-2.5",
      )}
    >
      <Eye className="size-4 shrink-0" aria-hidden />
      <span className={cn("font-medium", compact && "sr-only")}>Modo observación</span>
    </Link>
  );
}
