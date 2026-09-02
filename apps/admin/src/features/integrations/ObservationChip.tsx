import { Link } from "@tanstack/react-router";
import { Eye } from "lucide-react";

/* integrations-hub D4: the shell wears a chip while observing — a paused
   hand is context everyone reading Pagos needs, so EVERY role sees it
   (the CreditChip's own rule). A chip, not a nav section (IA): it is a
   status, and tapping it opens the place where the switch lives. */
export function ObservationChip() {
  return (
    <Link
      to="/integrations/wisphub"
      className="flex items-center gap-2 rounded-md border border-info-line bg-info-soft px-3 py-1.5 text-sm text-info hover:bg-muted"
    >
      <Eye className="size-4 shrink-0" aria-hidden />
      <span className="font-medium">Modo observación</span>
    </Link>
  );
}
