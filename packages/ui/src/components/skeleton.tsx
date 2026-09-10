import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

/* shadcn Skeleton in token utilities. The pending shape of a screen,
   never the word "Cargando…" (shell spec D7).

   `aria-hidden` on purpose: the region that owns the skeleton carries
   the announcement, so a screen reader hears "Cargando…" once instead
   of once per bar.

   NO ANIMATION (feedback-vocabulary-rollout D2, D6). A shape's job is to
   promise a layout; the movement belongs to the region that owns the wait,
   which breathes once around all of its bars. Two reasons it is not
   `animate-pulse` any more:

   - It was the product's second waiting rhythm — a 2s dip to 50% on a curve
     of Tailwind's choosing, none of it from tokens.css, next to a breath of
     2.4s to 70% that is. An operator could meet both on one screen.
   - It froze under reduced motion. The exception in index.css re-enables
     `[data-motion="breath"]` and `[data-motion="reveal"]` by name; nothing
     matched `animate-pulse`, so the blanket rule flattened it to 0.01ms and
     every skeleton in the back office became a dead grey block for anyone who
     asked for less motion. Under the region's breath it is covered.

   Six bars breathing separately would also drift out of phase the moment one
   mounted a frame late. One animation on the region cannot. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("rounded-md bg-well", className)} {...props} />;
}
