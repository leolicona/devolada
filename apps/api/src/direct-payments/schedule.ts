/* Re-validation schedule for pending CEPs (direct-payment spec D7).
   Front-loaded on evidence: Banxico publishes the CEP at most ~30 min
   after the transfer, and the probability mass lives in the first
   minutes — so the cadence is dense there and sparse in the anomaly
   tail. Offsets count from the submission (`createdAt`), not from the
   last attempt. TD-013: the real distribution is being logged so this
   can be tuned per receiving bank later. */

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
   exhausted — the caller turns null into `expired`. */
export function nextValidationSlot(
  createdAt: Date,
  now: Date,
  opts: { lateSlot?: boolean } = {},
): Date | null {
  const offsets = opts.lateSlot
    ? [...REVALIDATION_OFFSETS_MINUTES, LATE_SLOT_MINUTES]
    : REVALIDATION_OFFSETS_MINUTES;
  for (const offset of offsets) {
    const at = createdAt.getTime() + minutes(offset);
    if (at > now.getTime()) return new Date(at);
  }
  return null;
}
