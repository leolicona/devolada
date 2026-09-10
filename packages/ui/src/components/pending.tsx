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
  /* The placeholder this region promises while it waits, for a region whose
     content has a known shape (feedback-vocabulary-rollout D7, FR-003).

     Given, it REPLACES the children for the whole pending lifecycle, so the
     shape and the bare breath are never applied to the same region at once.
     Omitted, the region behaves exactly as it did before this prop existed:
     children render immediately and only the signal waits. That difference is
     real — the payer's submit button must stay on screen and usable while its
     region waits, and a list's placeholder bars ARE the signal and must not
     appear before the threshold.

     One component rather than two, because two would share these timing
     constants and drift apart. */
  shape?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Pending({
  active,
  label,
  announce = true,
  shape,
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

  /* The whole pending lifecycle, not just the visible part of it: withheld
     (waiting out the threshold), visible, and holding (the wait is over but
     the signal has not been up long enough to read). The shape stands in for
     all three; only past the threshold does it become visible. */
  const pending = shape !== undefined && (active || breathing);

  return (
    <div
      /* Both are required and both are conditional. `animate-breath` is the
         animation; `data-motion` is what the reduced-motion exception in
         index.css matches on. Neither may ever be paired with a transform:
         that exception is only defensible while this region moves nothing. */
      data-motion={breathing ? "breath" : undefined}
      className={cn(breathing && "animate-breath", className)}
    >
      {announce && (active || breathing) && (
        /* Announced on the same schedule as the breath, not on `active`.
           Saying "verificando" and retracting it 100ms later is worse for a
           screen-reader user than the silence the flash threshold buys.

           The region exists only while there is a wait to speak about
           (feedback-vocabulary-rollout D4). It used to render always, empty,
           which squatted a role="status" for the life of the screen — and a
           screen that already owns one, as the charge feed and the client
           roster do, ended up with two. `findByRole("status")` then reached
           this empty one instead of the note the operator needed.

           The aria-live technique still holds: `active` mounts the region and
           the text arrives a threshold later, so it is never inserted with its
           content in the same tick. */
        <span role="status" aria-live="polite" className="sr-only">
          {breathing ? label : ""}
        </span>
      )}
      {pending ? (
        <div
          /* `invisible` is visibility:hidden, and the choice is load-bearing
             (feedback-vocabulary-rollout D5, FR-015). `hidden` would satisfy
             "show nothing before the threshold" and break "hold the space
             content will occupy" — the page would jump the moment the shape
             arrived. This paints nothing while still being laid out, and
             visibility:hidden is out of the accessibility tree too, so the
             announcement above stays the region's only voice. */
          className={cn(!breathing && "invisible")}
          aria-hidden={!breathing}
        >
          {shape}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
