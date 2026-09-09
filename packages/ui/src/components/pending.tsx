import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";

/* The `waiting` feedback state (design-foundations D10, D16; constitution VI).

   FR-014: a wait shorter than a glance should leave no trace. The breath
   waits out the flash threshold before it starts, and once started it stays
   long enough to be read — a signal that appears and vanishes in the same
   blink is worse than no signal at all.

   Note what is delayed: the *signal*, never the children. The copy the payer
   reads is the page's content and renders immediately; only the breathing
   waits. */
const FLASH_THRESHOLD_MS = 200;
const MINIMUM_VISIBLE_MS = 500;

export interface PendingProps {
  /* Whether the region is pending. Nothing else — no elapsed time, no
     attempt count. Motion never carries state on its own and never
     escalates with the wait (FR-010, FR-017). */
  active: boolean;
  /* The state in words, for anyone who cannot perceive the motion (FR-011). */
  label: string;
  /* Whether this component owns the announcement. Pass `false` when the
     caller already has a live region, so a state is never read out twice —
     the same reason Skeleton is aria-hidden. */
  announce?: boolean;
  children: ReactNode;
  className?: string;
}

export function Pending({
  active,
  label,
  announce = true,
  children,
  className,
}: PendingProps) {
  const [breathing, setBreathing] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      /* Already breathing: hold. A wait that flickers off and on again
         inside the minimum window must not restart the animation. */
      if (breathing) return;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setBreathing(true);
      }, FLASH_THRESHOLD_MS);
      return () => clearTimeout(timer);
    }

    if (!breathing) return;
    const elapsed = Date.now() - (shownAt.current ?? 0);
    const timer = setTimeout(
      () => {
        shownAt.current = null;
        setBreathing(false);
      },
      Math.max(0, MINIMUM_VISIBLE_MS - elapsed),
    );
    return () => clearTimeout(timer);
  }, [active, breathing]);

  return (
    <div
      /* Both are required and both are conditional. `animate-breath` is the
         animation; `data-motion` is what the reduced-motion exception in
         index.css matches on. Neither may ever be paired with a transform:
         that exception is only defensible while this region moves nothing. */
      data-motion={breathing ? "breath" : undefined}
      className={cn(breathing && "animate-breath", className)}
    >
      {announce && (
        /* Announced on the same schedule as the breath, not on `active`.
           Saying "verificando" and retracting it 100ms later is worse for a
           screen-reader user than the silence the flash threshold buys. */
        <span role="status" aria-live="polite" className="sr-only">
          {breathing ? label : ""}
        </span>
      )}
      {children}
    </div>
  );
}
