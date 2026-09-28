import type { ReactNode } from "react";
import { WifiOff } from "lucide-react";

/* links-on-demand-search FR-014 / D9: the provider being away is a quiet
   note over the rows already on screen — never the error block, which is
   for a failure with nothing to show.

   One component for both views of Links (cobros-in-links D18, T037). The
   sentence names the provider, and that literal is registered debt
   (`.specify/debt/core-reads-provider-directly`); Por cobrar reuses it
   rather than writing a second copy, so paying the debt is one edit. */
export function OfflineNote({ children }: { children?: ReactNode }) {
  return (
    <p
      role="status"
      className="mt-6 flex max-w-lg items-start gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
    >
      <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Sin conexión a WispHub. Mostrando la última lectura.
        {children}
      </span>
    </p>
  );
}
