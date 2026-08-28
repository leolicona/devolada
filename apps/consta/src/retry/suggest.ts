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
   amendment of 2026-08-28).

   What counts as evidence (D4, second amendment — measured live on two
   of the owner's own transfers): the clock here starts at the upload,
   not at the transfer, so a receipt uploaded hours late validates "in 0
   minutes" while measuring nothing about Banxico. Two rules keep the
   cells honest:

   1. Only transfers whose FIRST attempt missed are measured — they are
      the exact population the suggestion serves, anchored where the
      suggestion anchors. A CEP that was already there never needed a
      retry and must not shape one.
   2. A miss is evidence only if it asked with the same search inputs
      (amount, date) that eventually validated. A miss caused by our own
      misread amount or date measures human correction time, not
      Banxico. */

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
  amountCents: number | null;
  transferDate: string | null;
  now: Date;
};

type Row = {
  trackingKey: string | null;
  status: "valid" | "pending" | "invalid" | null;
  senderBank: string | null;
  beneficiaryBank: string | null;
  amountCents: number | null;
  transferDate: string | null;
  createdAt: Date;
};

type Measured = { upperMinutes: number; sender: string | null; receiver: string | null };

const minutesUp = (ms: number) => Math.ceil(ms / 60000);

export async function suggestRetryAfter(
  db: DrizzleD1Database,
  args: Args,
): Promise<string | null> {
  /* D3 anchors elapsed time on the first attempt seen for this tracking
     key; without a key there is no anchor and no suggestion */
  if (!args.trackingKey) return null;

  const cutoff = new Date(args.now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows: Row[] = await db
    .select({
      trackingKey: validations.trackingKey,
      status: validations.status,
      senderBank: validations.senderBank,
      beneficiaryBank: validations.beneficiaryBank,
      amountCents: validations.amountCents,
      transferDate: validations.transferDate,
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

  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byKey.get(r.trackingKey!) ?? [];
    list.push(r);
    byKey.set(r.trackingKey!, list);
  }

  /* One transfer = the attempts sharing a tracking key. The interval's
     upper bound is first valid − first honest ask (D4). */
  const measured: Measured[] = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const valid = group.find((r) => r.status === "valid");
    if (!valid) continue;
    /* Rule 2: only attempts that asked with the inputs that validated */
    const honest = group.filter(
      (r) => r.amountCents === valid.amountCents && r.transferDate === valid.transferDate,
    );
    /* Rule 1: a first attempt that succeeded measures the upload lag or
       our correction time, never Banxico — it leaves the cells */
    if (honest.length === 0 || honest[0].status === "valid") continue;
    measured.push({
      upperMinutes: minutesUp(valid.createdAt.getTime() - honest[0].createdAt.getTime()),
      sender: honest.find((r) => r.senderBank)?.senderBank ?? null,
      receiver: honest.find((r) => r.beneficiaryBank)?.beneficiaryBank ?? null,
    });
  }

  /* The ladder (D2): pair → receiver → sender → global; the most
     specific cell with enough samples wins, and the traffic volume —
     never a config — decides which level operates */
  const cells: ((t: Measured) => boolean)[] = [
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
    const uppers = measured.filter(belongs).map((t) => t.upperMinutes);
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

  /* The live anchor follows rule 2 as well: after a correction, elapsed
     runs from the first attempt that asked with the corrected inputs */
  const mine = (byKey.get(args.trackingKey) ?? []).filter(
    (r) =>
      args.amountCents === null ||
      args.transferDate === null ||
      (r.amountCents === args.amountCents && r.transferDate === args.transferDate),
  );
  const firstSeen = mine.length
    ? Math.min(...mine.map((r) => r.createdAt.getTime()))
    : args.now.getTime();

  /* D3 — stateless stepping by elapsed time alone: before p50 suggest
     p50, between p50 and p90 suggest p90, past p90 say nothing — beyond
     the learned range the caller's static tail owns the transfer (D5) */
  const elapsed = (args.now.getTime() - firstSeen) / 60000;
  const target = elapsed < p50 ? p50 : elapsed < p90 ? p90 : null;
  return target === null ? null : new Date(firstSeen + target * 60000).toISOString();
}
