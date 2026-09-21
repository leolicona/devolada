/* The waiting state's two timing constants (design-foundations D10, D16;
   constitution VI) — one definition, read by `Pending` and by any surface
   that applies the breath without React (landing-page D16: the landing's
   form script). A literal duration in a second place is the drift
   design-foundations D15 recorded and paid.

   FR-014: a wait shorter than a glance should leave no trace. The breath
   waits out the flash threshold before it starts, and once started it stays
   long enough to be read — a signal that appears and vanishes in the same
   blink is worse than no signal at all. */
export const FLASH_THRESHOLD_MS = 200;
export const MINIMUM_VISIBLE_MS = 500;
