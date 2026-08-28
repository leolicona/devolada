/* Re-validation schedule for pending CEPs (direct-payment spec D7).
   Front-loaded on evidence: the probability mass lives in the first
   minutes — so the cadence is dense there and sparse in the anomaly
   tail. Offsets count from the submission (`createdAt`), not from the
   last attempt.

   TD-013 paid (learned-retry D6): Consta suggests `retryAfter` on
   `not_found`/`pending`, learned from measured traffic per bank cell,
   and the suggestion governs the middle of this schedule — before or
   after the next static slot, whichever the evidence says. What never
   moves: the early skeleton (the inline attempt and the +2 slot serve
   the seconds-fast majority and bring the suggestion for free), and
   the horizon (expiry is product law, so a suggestion is clamped to
   the final slot — the last pre-expiry check always runs, and the
   pending budget never stretches). */

export const REVALIDATION_OFFSETS_MINUTES = [2, 8, 20, 45, 120, 360];

/* validation-status-ux D4: a payment whose only failure is `not_found`
   earns one late retry at T+12h before it is called expired — one
   credit, buying the rare bank that releases a held transfer the next
   morning. Only that failure: `contradicted` is a verdict, and a
   channel outage is our problem, not something Banxico may still
   publish. */
export const LATE_SLOT_MINUTES = 720;

const minutes = (n: number) => n * 60 * 1000;

/* The next slot strictly after `now`, or null when the schedule is
   exhausted — the caller turns null into `expired`, which can only
   happen past the horizon, right after a fresh check. */
export function nextValidationSlot(
  createdAt: Date,
  now: Date,
  opts: { lateSlot?: boolean; suggestedAt?: Date | null } = {},
): Date | null {
  const offsets = opts.lateSlot
    ? [...REVALIDATION_OFFSETS_MINUTES, LATE_SLOT_MINUTES]
    : REVALIDATION_OFFSETS_MINUTES;

  /* learned-retry D6: the suggestion rules the middle — but only once
     the +2 slot has had its chance (the fast majority is never made to
     wait on a slow bank's percentile), never past the horizon, and
     never into the past (a stale suggestion falls back to the ladder). */
  const suggested = opts.suggestedAt?.getTime();
  if (suggested !== undefined && now.getTime() >= createdAt.getTime() + minutes(offsets[0])) {
    const clamped = Math.min(suggested, createdAt.getTime() + minutes(offsets[offsets.length - 1]));
    if (clamped > now.getTime()) return new Date(clamped);
  }

  for (const offset of offsets) {
    const at = createdAt.getTime() + minutes(offset);
    if (at > now.getTime()) return new Date(at);
  }
  return null;
}

/* The suggestion is advice from another service: absent or malformed,
   it must never break scheduling — it just does not exist. */
export function suggestedSlot(raw: string | undefined): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t);
}
