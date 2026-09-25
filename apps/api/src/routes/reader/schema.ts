import { z } from "zod";

/* The reader's contract in /operador → Lector (receipt-reader-tuning,
   contracts/reader-api.md; constitution III) — exported as
   `@devolada/api/reader-schema` and imported by the admin's Lector tab,
   its MSW handlers and the Playwright stubs. Pure zod: the admin's bundle
   loads this file, so nothing here imports the database, Hono or the
   engine (receipt-reader-tuning D18). */

/* ---- The model (Story 1) ---- */

export const readerStateResponse = z.object({
  /* The resolved list, default first */
  models: z.array(z.object({ id: z.string(), label: z.string() })),
  defaultModel: z.string(),
  /* The id that reads from the next reading on */
  activeModel: z.string(),
  /* default — no choice ever made; applies — the latest choice is in the
     list and reads; stale — it left the list, and the default reads (D8) */
  choice: z.enum(["default", "applies", "stale"]),
  staleChoice: z.string().nullable(),
  /* Latest first, up to 5 */
  history: z.array(z.object({ value: z.string(), authorUserId: z.string(), createdAt: z.number().int() })),
  /* Payer readings where the chosen model failed and the default read —
     a count, never a row (constitution V, v1.6.0) */
  fallbacksLast7Days: z.number().int(),
  questionVersion: z.string(),
  /* False when the AI binding is absent (constitution VIII) */
  readerAvailable: z.boolean(),
});

export const chooseModelRequest = z.object({ modelId: z.string().min(1) });

/* ---- The bench (Story 3) ---- */

export const BENCH_FIELDS = [
  "isReceipt",
  "legibility",
  "trackingKey",
  "referenceNumber",
  "senderBank",
  "receivingBank",
  "amount",
  "date",
  "destination",
] as const;
export const benchField = z.enum(BENCH_FIELDS);
export const benchMark = z.enum(["right", "wrong", "absent"]);
/* receipt-reader-tuning D17: these two are never "not shown" — a reading
   always says whether it is a receipt and how legible it was */
export const FIELDS_WITHOUT_ABSENT: readonly BenchField[] = ["isReceipt", "legibility"];

/* The product-facing reading: after the gate and the vocabulary, amounts
   in cents (D17, constitution II) */
export const benchProductReading = z.object({
  isReceipt: z.boolean(),
  legibility: z.enum(["full", "partial", "none"]).nullable(),
  trackingKey: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  senderBank: z.string().nullable(),
  receivingBank: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  date: z.string().nullable(),
  destination: z.object({
    kind: z.enum(["clabe", "card", "phone", "account"]).nullable(),
    digits: z.string().nullable(),
  }),
  sameBank: z.boolean(),
});

export const benchFailureCode = z.enum(["READER_UNAVAILABLE", "READER_UNREADABLE", "TIMEOUT"]);

/* A partial record: `z.record` over an enum would demand every key */
const partialByField = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(BENCH_FIELDS.map((f) => [f, value.optional()])) as Record<BenchField, z.ZodOptional<T>>).strict();

export const benchMarks = partialByField(benchMark);

export const benchReading = z.object({
  id: z.string(),
  model: z.string(),
  modelLabel: z.string(),
  questionVersion: z.string(),
  status: z.enum(["read", "failed"]),
  failureCode: benchFailureCode.nullable(),
  readerMs: z.number().int(),
  /* Null when failed */
  reading: benchProductReading.nullable(),
  rawOutput: z.string().nullable(),
  marks: benchMarks,
  /* The marks resolved: `absent` judged against the reading (D17) */
  judged: partialByField(z.enum(["right", "wrong"])),
  markedAt: z.number().int().nullable(),
});

export const benchReceiptSummary = z.object({
  id: z.string(),
  mediaType: z.string(),
  byteSize: z.number().int(),
  createdAt: z.number().int(),
  /* False once the bucket's 15-day rule removed it; the row stays */
  fileAvailable: z.boolean(),
  readings: z.array(
    z.object({
      id: z.string(),
      model: z.string(),
      modelLabel: z.string(),
      questionVersion: z.string(),
      status: z.enum(["read", "failed"]),
      readerMs: z.number().int(),
      /* Fields marked */
      marked: z.number().int(),
    }),
  ),
});

export const benchListResponse = z.object({
  items: z.array(benchReceiptSummary),
  nextCursor: z.string().nullable(),
});

export const benchReceiptDetail = benchReceiptSummary.omit({ readings: true }).extend({
  readings: z.array(benchReading),
  /* What "Leer de nuevo" would fill: listed models × the current version */
  missing: z.array(z.object({ model: z.string(), questionVersion: z.string() })),
  duplicate: z.boolean().optional(),
});

/* Replaces the reading's marks */
export const setMarksRequest = z.object({ marks: benchMarks });

export const benchTallyResponse = z.object({
  /* The date that closes the measurement debt (FR-020) */
  asOf: z.number().int(),
  rows: z.array(
    z.object({
      model: z.string(),
      modelLabel: z.string(),
      questionVersion: z.string(),
      readings: z.number().int(),
      failures: z.number().int(),
      judged: z.number().int(),
      right: z.number().int(),
      wrongByField: partialByField(z.number().int()),
      /* Nearest rank over `read` readings' model time; null with none (SC-005) */
      p90Ms: z.number().int().nullable(),
    }),
  ),
});

export type ReaderStateResponse = z.infer<typeof readerStateResponse>;
export type ChooseModelRequest = z.infer<typeof chooseModelRequest>;
export type BenchField = (typeof BENCH_FIELDS)[number];
export type BenchMark = z.infer<typeof benchMark>;
export type BenchProductReading = z.infer<typeof benchProductReading>;
export type BenchFailureCode = z.infer<typeof benchFailureCode>;
export type BenchMarks = z.infer<typeof benchMarks>;
export type BenchReading = z.infer<typeof benchReading>;
export type BenchReceiptSummary = z.infer<typeof benchReceiptSummary>;
export type BenchListResponse = z.infer<typeof benchListResponse>;
export type BenchReceiptDetail = z.infer<typeof benchReceiptDetail>;
export type SetMarksRequest = z.infer<typeof setMarksRequest>;
export type BenchTallyResponse = z.infer<typeof benchTallyResponse>;
