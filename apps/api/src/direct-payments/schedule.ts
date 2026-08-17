/* Re-validation schedule for pending CEPs (direct-payment spec D7).
   Front-loaded on evidence: Banxico publishes the CEP at most ~30 min
   after the transfer, and the probability mass lives in the first
   minutes — so the cadence is dense there and sparse in the anomaly
   tail. Offsets count from the submission (`createdAt`), not from the
   last attempt. TD-013: the real distribution is being logged so this
   can be tuned per receiving bank later. */

export const REVALIDATION_OFFSETS_MINUTES = [2, 8, 20, 45, 120, 360];

/* After the last slot there is nothing left to try: 6 h from
   submission the payment is `expired` and the customer is told to
   contact their ISP. */
export const EXPIRY_MINUTES = 360;

const minutes = (n: number) => n * 60 * 1000;

/* The next slot strictly after `now`, or null when the schedule is
   exhausted — the caller turns null into `expired`. */
export function nextValidationSlot(createdAt: Date, now: Date): Date | null {
  for (const offset of REVALIDATION_OFFSETS_MINUTES) {
    const at = createdAt.getTime() + minutes(offset);
    if (at > now.getTime()) return new Date(at);
  }
  return null;
}
