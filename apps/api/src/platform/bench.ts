import type { GatedReading, Reading } from "../consta/extraction";
import {
  BENCH_FIELDS,
  type BenchField,
  type BenchMarks,
  type BenchProductReading,
  type BenchTallyResponse,
} from "../routes/reader/schema";

/* receipt-reader-tuning D16, D17 — the bench's arithmetic. Pure: no
   database, no fetch, no clock (like `compare.ts`), so every rule the
   tally rests on is a unit a test can hold. */

/* D16: one model call on the bench may take this long. Longer than the
   payer's 8 s (D11) on purpose — the bench measures a model, it does not
   keep a payer waiting, and a slow answer is still an answer to mark. */
export const BENCH_TIMEOUT_MS = 30_000;
/* The limit the handler reads. A test lowers it to reach `TIMEOUT` in
   milliseconds and puts it back; nothing else writes it. */
export const benchLimits = { timeoutMs: BENCH_TIMEOUT_MS };

/* D17: what is marked is the value the product would act on — after the
   gate and the vocabulary, the amount in cents — because that is what a
   payer's reading would carry, not the model's raw words */
export function productReading(gated: GatedReading, reading: Reading): BenchProductReading {
  return {
    isReceipt: reading.isReceipt,
    legibility: reading.legibility,
    trackingKey: gated.trackingKey,
    referenceNumber: gated.referenceNumber,
    senderBank: gated.senderBank,
    receivingBank: gated.receiving.bank,
    amountCents: gated.amountCents,
    date: reading.date,
    /* cep-bundle-match D15: as read — the gate judges neither */
    time: reading.time,
    senderTail: reading.senderTail,
    destination: reading.destination,
    sameBank: gated.receiving.sameBank,
  };
}

/* "Not shown" per field, for judging `absent` (D17). `isReceipt` and
   `legibility` always have an answer, so `absent` is never offered there.
   cep-bundle-match D15: `time` and `senderTail` are "not shown" when null,
   like every other field — including on a reading stored before version 3
   asked them. */
function notShown(reading: BenchProductReading, field: BenchField): boolean {
  switch (field) {
    case "isReceipt":
    case "legibility":
      return false;
    case "amount":
      return reading.amountCents == null;
    case "destination":
      return !reading.destination.digits;
    default:
      return reading[field] == null;
  }
}

/* D17: `right` and `wrong` are taken as marked; `absent` — the receipt
   does not show the field — is right when the reading said "not shown"
   too, and wrong otherwise (the folio read as a clave is `absent` → wrong) */
export function judge(
  reading: BenchProductReading | null,
  marks: BenchMarks,
): Partial<Record<BenchField, "right" | "wrong">> {
  const out: Partial<Record<BenchField, "right" | "wrong">> = {};
  if (!reading) return out;
  for (const field of BENCH_FIELDS) {
    const mark = marks[field];
    if (!mark) continue;
    out[field] = mark === "absent" ? (notShown(reading, field) ? "right" : "wrong") : mark;
  }
  return out;
}

export type TallyInput = {
  model: string;
  modelLabel: string;
  questionVersion: string;
  status: "read" | "failed";
  readerMs: number;
  reading: BenchProductReading | null;
  marks: BenchMarks;
  createdAt: number;
};

/* SC-005: the time within which 9 of 10 readings finished, nearest rank */
export function p90(ms: number[]): number | null {
  if (!ms.length) return null;
  const sorted = [...ms].sort((a, b) => a - b);
  return sorted[Math.ceil(0.9 * sorted.length) - 1];
}

/* D17: per (model, question version), computed on request — never
   stored, so a changed mark changes the tally the next time it is read */
export function tally(rows: TallyInput[], now: number): BenchTallyResponse {
  const groups = new Map<string, TallyInput[]>();
  for (const r of rows) {
    const key = `${r.model}\u0000${r.questionVersion}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: BenchTallyResponse["rows"] = [];
  for (const group of groups.values()) {
    /* The label of the latest reading — the list can relabel a model */
    const latest = group.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const wrongByField = Object.fromEntries(BENCH_FIELDS.map((f) => [f, 0])) as Record<BenchField, number>;
    let judged = 0;
    let right = 0;
    for (const r of group) {
      if (r.status !== "read") continue;
      for (const [field, verdict] of Object.entries(judge(r.reading, r.marks)) as [BenchField, "right" | "wrong"][]) {
        judged += 1;
        if (verdict === "right") right += 1;
        else wrongByField[field] += 1;
      }
    }
    out.push({
      model: latest.model,
      modelLabel: latest.modelLabel,
      questionVersion: latest.questionVersion,
      readings: group.length,
      failures: group.filter((r) => r.status === "failed").length,
      judged,
      right,
      wrongByField,
      p90Ms: p90(group.filter((r) => r.status === "read").map((r) => r.readerMs)),
    });
  }
  out.sort((a, b) => a.model.localeCompare(b.model) || b.questionVersion.localeCompare(a.questionVersion));
  return { asOf: now, rows: out };
}
