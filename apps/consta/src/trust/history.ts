import { and, eq, isNotNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { validations } from "../db/schema";

/* The trust block (trust-layer spec, US-V15 D3–D8).

   Consta measures and reports — never recommends, never scores, never
   decides. Everything here is a SUM over the append-only log at request
   time: no aggregate tables, no counters, and a bug in these numbers is
   fixed by fixing a query (D7).

   The unit is the CHAIN — the attempts of one payment, grouped by
   (customerRef, paymentRef) with the tracking-key fallback — because
   five not_founds followed by a valid are one successful payment, not
   five failures (D3). */

const DAY_MS = 24 * 3600 * 1000;
export const HALF_LIFE_DAYS = 90;
/* D3: Consta never learns a client gave up (expiry is client state);
   24 h of silence infers it, and the longest known schedule dies at 6 h */
const OPEN_WINDOW_MS = 24 * 3600 * 1000;

type Row = {
  customerRef: string | null;
  paymentRef: string | null;
  trackingKey: string | null;
  status: "valid" | "pending" | "invalid" | null;
  reason: "contradicted" | "not_found" | null;
  alreadyValidated: boolean;
  createdAt: Date;
};

type Chain = {
  key: string;
  firstAt: Date;
  lastAt: Date;
  validAt: Date | null;
  contradictedAt: Date | null;
};

export type TrustBlock = {
  customerRef: string;
  sample: { chains: number; effectiveN: number; halfLifeDays: number };
  /* Null with no closed chains: a rate over nothing is not 0% — it is
     no measurement (the spec's "shows zeros" covers the counts) */
  eventualValidRate: number | null;
  raw: {
    resolvedValid: number;
    abandoned: number;
    contradicted: number;
    alreadyUsedAttempts: number;
  };
  lastIncidentAt: string | null;
  medianMinutesToValid: number | null;
  tenantBaseline: { eventualValidRate: number | null; chains: number; effectiveN: number };
};

/* The chain key mirrors D1's grouping: paymentRef when the caller sent
   one, the tracking key as the imperfect fallback, and a row with
   neither stands alone. Scoped by customerRef so the fallback never
   fuses two payers who typed the same misread clave. */
function chainKey(ref: string | null, paymentRef: string | null, trackingKey: string | null, rowId: string) {
  return `${ref ?? ""}|${paymentRef ?? (trackingKey ? `tk:${trackingKey.toUpperCase()}` : `row:${rowId}`)}`;
}

function buildChains(rows: (Row & { id: string })[]): Map<string, Chain> {
  const chains = new Map<string, Chain>();
  for (const r of rows) {
    const key = chainKey(r.customerRef, r.paymentRef, r.trackingKey, r.id);
    const c = chains.get(key) ?? {
      key,
      firstAt: r.createdAt,
      lastAt: r.createdAt,
      validAt: null,
      contradictedAt: null,
    };
    if (r.createdAt < c.firstAt) c.firstAt = r.createdAt;
    if (r.createdAt > c.lastAt) c.lastAt = r.createdAt;
    if (r.status === "valid" && !c.validAt) c.validAt = r.createdAt;
    if (r.status === "invalid" && r.reason === "contradicted" && !c.contradictedAt) {
      c.contradictedAt = r.createdAt;
    }
    chains.set(key, c);
  }
  return chains;
}

type Outcome = "resolved_valid" | "contradicted" | "abandoned" | "open";

function outcomeOf(c: Chain, now: Date): Outcome {
  if (c.validAt) return "resolved_valid";
  if (c.contradictedAt) return "contradicted";
  if (now.getTime() - c.lastAt.getTime() < OPEN_WINDOW_MS) return "open";
  return "abandoned";
}

/* D4: recent chains weigh more; the n you see already discounts for age */
const weightOf = (c: Chain, now: Date) =>
  Math.pow(0.5, (now.getTime() - c.lastAt.getTime()) / (HALF_LIFE_DAYS * DAY_MS));

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

function aggregate(chains: Chain[], now: Date) {
  const closed = chains
    .map((c) => ({ c, outcome: outcomeOf(c, now) }))
    .filter((x) => x.outcome !== "open");
  let effectiveN = 0;
  let validWeight = 0;
  const counts = { resolvedValid: 0, abandoned: 0, contradicted: 0 };
  for (const { c, outcome } of closed) {
    const w = weightOf(c, now);
    effectiveN += w;
    if (outcome === "resolved_valid") {
      validWeight += w;
      counts.resolvedValid++;
    } else if (outcome === "contradicted") counts.contradicted++;
    else counts.abandoned++;
  }
  return {
    chains: closed.length,
    effectiveN: round1(effectiveN),
    eventualValidRate: effectiveN > 0 ? round3(validWeight / effectiveN) : null,
    counts,
    closed,
  };
}

/* Computed on `pending` and `not_found` verdicts when the caller named
   the payer (D5) — exactly when the client is deciding whether to wait.
   The chain being validated right now is excluded from its own evidence
   (D3): a payment must not vouch for itself. */
export async function trustBlock(
  db: DrizzleD1Database,
  apiKeyId: string,
  customerRef: string,
  current: { paymentRef: string | null; trackingKey: string | null },
  now: Date,
): Promise<TrustBlock> {
  /* One read serves both the payer and the baseline (D6: the same SQL
     with one WHERE less). Volumes are per-tenant and small today; the
     (api_key_id, customer_ref) index carries the growth, and a SQL-side
     aggregation is the known next step if a tenant ever outgrows this. */
  const rows = await db
    .select({
      id: validations.id,
      customerRef: validations.customerRef,
      paymentRef: validations.paymentRef,
      trackingKey: validations.trackingKey,
      status: validations.status,
      reason: validations.reason,
      alreadyValidated: validations.alreadyValidated,
      createdAt: validations.createdAt,
    })
    .from(validations)
    .where(and(eq(validations.apiKeyId, apiKeyId), isNotNull(validations.customerRef)));

  const currentKey = chainKey(customerRef, current.paymentRef, current.trackingKey, "");
  const everyChain = [...buildChains(rows).values()].filter((c) => c.key !== currentKey);

  const payerChains = everyChain.filter((c) => c.key.startsWith(`${customerRef}|`));
  const payer = aggregate(payerChains, now);
  const baseline = aggregate(everyChain, now);

  /* Attempt-level, not a chain outcome: a CEP consumed elsewhere is the
     strongest fraud signal this data holds (D4) */
  const payerRows = rows.filter((r) => r.customerRef === customerRef);
  const alreadyUsed = payerRows.filter((r) => r.alreadyValidated);

  const incidentTimes = [
    ...payer.closed.filter((x) => x.outcome === "contradicted").map((x) => x.c.contradictedAt!),
    ...alreadyUsed.map((r) => r.createdAt),
  ];
  const lastIncidentAt = incidentTimes.length
    ? new Date(Math.max(...incidentTimes.map((d) => d.getTime()))).toISOString()
    : null;

  /* Plain median, first attempt to valid (D4) */
  const minutes = payer.closed
    .filter((x) => x.outcome === "resolved_valid")
    .map((x) => (x.c.validAt!.getTime() - x.c.firstAt.getTime()) / 60_000)
    .sort((a, b) => a - b);
  const medianMinutesToValid = minutes.length
    ? Math.round(minutes[Math.floor((minutes.length - 1) / 2)])
    : null;

  return {
    customerRef,
    sample: { chains: payer.chains, effectiveN: payer.effectiveN, halfLifeDays: HALF_LIFE_DAYS },
    eventualValidRate: payer.eventualValidRate,
    raw: { ...payer.counts, alreadyUsedAttempts: alreadyUsed.length },
    lastIncidentAt,
    medianMinutesToValid,
    tenantBaseline: {
      eventualValidRate: baseline.eventualValidRate,
      chains: baseline.chains,
      effectiveN: baseline.effectiveN,
    },
  };
}
