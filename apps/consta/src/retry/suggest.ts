import { and, gt, isNotNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { validations } from "../db/schema";

/* learned-retry (docs/consta/learned-retry.spec.md, US-V16): a suggested
   retry moment on `not_found`/`pending`, learned from the attempts the
   log already records. Consta suggests, never schedules (D1): the
   caller's static schedule is the floor, and a missing field — silence —
   is the cold-start answer, never a guess.

   Computed at request time over the rolling window: no aggregate table
   and no cron, following the trust layer's own law ("every trust number
   is a SUM at request time"). At the provider's 800-calls-per-month
   ceiling the whole window fits in one query; the day that query is the
   slow thing, a precomputed table earns its way back in (spec D4,
   amendment of 2026-08-28). */

/* D4 hypotheses, kept by phase 0 (which found the global cell at 27 of
   these 30 on its first run — the gate opens with volume, not redesign) */
export const MIN_CELL_SAMPLES = 30;
export const WINDOW_DAYS = 28;
/* Rounding IS the hysteresis: suggestions move in coarse steps, so the
   measurement grid they create holds still instead of chasing itself */
export const STEP_MINUTES = 5;

type Args = {
  trackingKey: string | null;
  senderBank: string | null;
  beneficiaryBank: string | null;
  now: Date;
};

type Transfer = {
  firstSeen: number;
  firstValid: number | null;
  sender: string | null;
  receiver: string | null;
};

export async function suggestRetryAfter(
  db: DrizzleD1Database,
  args: Args,
): Promise<string | null> {
  /* D3 anchors elapsed time on the first attempt seen for this tracking
     key; without a key there is no anchor and no suggestion */
  if (!args.trackingKey) return null;

  const cutoff = new Date(args.now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      trackingKey: validations.trackingKey,
      status: validations.status,
      senderBank: validations.senderBank,
      beneficiaryBank: validations.beneficiaryBank,
      createdAt: validations.createdAt,
    })
    .from(validations)
    .where(
      and(
        isNotNull(validations.trackingKey),
        isNotNull(validations.status),
        gt(validations.createdAt, cutoff),
      ),
    );

  /* One transfer = the attempts sharing a tracking key. Only transfers
     Banxico eventually confirmed measure anything: the interval's upper
     bound is first valid − first seen, and a transfer that confirmed on
     its first attempt counts as 0 — the fast mass must count, or the
     distribution loses its whole left side (D4). */
  const transfers = new Map<string, Transfer>();
  for (const r of rows) {
    const t = transfers.get(r.trackingKey!) ?? {
      firstSeen: Infinity,
      firstValid: null,
      sender: null,
      receiver: null,
    };
    const at = r.createdAt.getTime();
    t.firstSeen = Math.min(t.firstSeen, at);
    if (r.status === "valid") t.firstValid = t.firstValid === null ? at : Math.min(t.firstValid, at);
    t.sender ??= r.senderBank;
    t.receiver ??= r.beneficiaryBank;
    transfers.set(r.trackingKey!, t);
  }

  const minutesUp = (ms: number) => Math.ceil(ms / 60000);
  const measured = [...transfers.values()].filter((t) => t.firstValid !== null);

  /* The ladder (D2): pair → receiver → sender → global; the most
     specific cell with enough samples wins, and the traffic volume —
     never a config — decides which level operates */
  const cells: ((t: Transfer) => boolean)[] = [
    (t) =>
      !!args.senderBank &&
      !!args.beneficiaryBank &&
      t.sender === args.senderBank &&
      t.receiver === args.beneficiaryBank,
    (t) => !!args.beneficiaryBank && t.receiver === args.beneficiaryBank,
    (t) => !!args.senderBank && t.sender === args.senderBank,
    () => true,
  ];
  let samples: number[] | null = null;
  for (const belongs of cells) {
    const uppers = measured.filter(belongs).map((t) => minutesUp(t.firstValid! - t.firstSeen));
    if (uppers.length >= MIN_CELL_SAMPLES) {
      samples = uppers.sort((a, b) => a - b);
      break;
    }
  }
  /* Cold start is silence (D5) */
  if (!samples) return null;

  /* Upper-bound percentiles, rounded up to the step grid: never earlier
     than observed evidence, by construction (D4) */
  const pct = (p: number) => samples[Math.min(samples.length - 1, Math.ceil(p * samples.length) - 1)];
  const step = (m: number) => Math.ceil(m / STEP_MINUTES) * STEP_MINUTES;
  const p50 = step(pct(0.5));
  const p90 = step(pct(0.9));

  /* D3 — stateless stepping by elapsed time alone: before p50 suggest
     p50, between p50 and p90 suggest p90, past p90 say nothing — beyond
     the learned range the caller's static tail owns the transfer (D5) */
  const firstSeen = transfers.get(args.trackingKey)?.firstSeen ?? args.now.getTime();
  const elapsed = (args.now.getTime() - firstSeen) / 60000;
  const target = elapsed < p50 ? p50 : elapsed < p90 ? p90 : null;
  return target === null ? null : new Date(firstSeen + target * 60000).toISOString();
}
