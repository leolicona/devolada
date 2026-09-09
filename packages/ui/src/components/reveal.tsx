import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/* The `resolving` feedback state (design-foundations D12; constitution VI).

   An outcome becomes visible gradually rather than instantly, and it does so
   the SAME way whether the news is good or bad (FR-012). Tone is carried by
   colour and words; a refusal that slides in differently from a confirmation
   would be the motion editorialising.

   Opacity only — no scale, no translate, no overshoot. Trust doesn't bounce
   (tokens.css). That is also what lets the fade survive reduced motion: see
   the [data-motion="reveal"] carve-out in index.css. */
export interface RevealProps {
  children: ReactNode;
  className?: string;
}

export function Reveal({ children, className }: RevealProps) {
  return (
    <div data-motion="reveal" className={cn("animate-reveal", className)}>
      {children}
    </div>
  );
}
