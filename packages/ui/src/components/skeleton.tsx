import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

/* shadcn Skeleton in token utilities. The pending shape of a screen,
   never the word "Cargando…" (shell spec D7).

   `aria-hidden` on purpose: the region that owns the skeleton carries
   the announcement, so a screen reader hears "Cargando…" once instead
   of once per bar. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-well", className)}
      {...props}
    />
  );
}
