import type { Context } from "hono";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { benchReadings, benchReceipts } from "../../db/schema";
import {
  gateReading,
  loadProof,
  pdfToText,
  ProofFetchError,
  QUESTIONS_VERSION,
  ReaderError,
  readerChoice,
  readerModels,
  type LoadedProof,
  type ReaderModel,
} from "../../consta/extraction";
import { readProof } from "../../consta/extraction/reader";
import { isAcceptedProofType, PROOF_MAX_BYTES } from "../../direct-payments/proofs";
import { chooseReaderModel, fallbacksSince, readerHistory } from "../../platform/reader-model";
import { benchLimits, judge, productReading, tally } from "../../platform/bench";
import {
  BENCH_FIELDS,
  FIELDS_WITHOUT_ABSENT,
  type BenchField,
  type BenchMarks,
  type BenchReading,
  type BenchReceiptDetail,
  type BenchReceiptSummary,
  type ReaderStateResponse,
} from "./schema";

/* receipt-reader-tuning — the reader in /operador → Lector: the model
   choice (Story 1) and the test bench (Story 3). Mounted at
   /platform/reader, behind the platform area's session + operator guard
   (D18). The bench writes only `bench_receipts`, `bench_readings` and
   `PROOFS/bench/…` — never `extractions`, `payments`, `validations` or a
   credit table, and it calls no provider (spec FR-019). */

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
type DB = DrizzleD1Database;

const fail = (c: Ctx, code: string, status: 400 | 404 | 413 | 415 | 503) =>
  c.json({ success: false, error: { code } }, status);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/* ---- The model (Story 1) ---- */

async function readerState(env: Bindings, db: DB): Promise<ReaderStateResponse> {
  const { list, defaultModel } = readerModels(env);
  const [choice, history, fallbacks] = await Promise.all([
    readerChoice(db, list, defaultModel),
    readerHistory(db),
    fallbacksSince(db, Date.now() - WEEK_MS),
  ]);
  return {
    models: list.map(({ id, label }) => ({ id, label })),
    defaultModel: defaultModel.id,
    activeModel: choice.active.id,
    choice: choice.choice,
    staleChoice: choice.stale,
    history,
    fallbacksLast7Days: fallbacks,
    questionVersion: QUESTIONS_VERSION,
    /* constitution VIII: the choice can still be saved without a binding */
    readerAvailable: Boolean(env.AI),
  };
}

export async function getReaderState(c: Ctx) {
  return c.json({ success: true, data: await readerState(c.env, drizzle(c.env.DB)) });
}

/* D8, FR-003: an id outside the environment's list is refused and
   nothing is written. Choosing the default writes a row too, so the
   history shows the switch back. */
export async function postReaderModel(c: Ctx, modelId: string) {
  const db = drizzle(c.env.DB);
  const { list } = readerModels(c.env);
  const chosen = await chooseReaderModel(db, list, modelId, c.get("actor").userId);
  if (!chosen.ok) return fail(c, "INVALID_MODEL", 400);
  return c.json({ success: true, data: await readerState(c.env, db) }, 201);
}

/* ---- The bench (Story 3) ---- */

type ReadingRow = typeof benchReadings.$inferSelect;
type ReceiptRow = typeof benchReceipts.$inferSelect;

const parseJson = <T>(text: string | null, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

function toReading(row: ReadingRow): BenchReading {
  const reading = parseJson<BenchReading["reading"]>(row.reading, null);
  const marks = parseJson<BenchMarks>(row.marks, {});
  return {
    id: row.id,
    model: row.model,
    modelLabel: row.modelLabel,
    questionVersion: row.questionVersion,
    status: row.status,
    failureCode: row.failureCode ?? null,
    readerMs: row.readerMs,
    reading,
    rawOutput: row.rawOutput,
    marks,
    judged: judge(reading, marks),
    markedAt: row.markedAt?.getTime() ?? null,
  };
}

const markedCount = (row: ReadingRow) => Object.keys(parseJson<BenchMarks>(row.marks, {})).length;

/* D16: every listed model × the current version the receipt lacks */
function missingFor(env: Bindings, readings: ReadingRow[]): ReaderModel[] {
  const have = new Set(readings.filter((r) => r.questionVersion === QUESTIONS_VERSION).map((r) => r.model));
  return readerModels(env).list.filter((m) => !have.has(m.id));
}

async function detail(env: Bindings, db: DB, receipt: ReceiptRow, duplicate?: boolean): Promise<BenchReceiptDetail> {
  const [rows, head] = await Promise.all([
    db
      .select()
      .from(benchReadings)
      .where(eq(benchReadings.benchReceiptId, receipt.id))
      .orderBy(benchReadings.createdAt),
    env.PROOFS.head(receipt.proofKey),
  ]);
  return {
    id: receipt.id,
    mediaType: receipt.mediaType,
    byteSize: receipt.byteSize,
    createdAt: receipt.createdAt.getTime(),
    fileAvailable: Boolean(head),
    readings: rows.map(toReading),
    missing: missingFor(env, rows).map((m) => ({ model: m.id, questionVersion: QUESTIONS_VERSION })),
    ...(duplicate ? { duplicate: true } : {}),
  };
}

/* D16: the listed models read in parallel, each with the bench's limit
   and **no fallback** — a failed model is its own failed column, never
   replaced by another's reading (spec D6). A PDF is converted once. */
async function readWith(env: Bindings, db: DB, receipt: ReceiptRow, proof: LoadedProof, models: ReaderModel[]) {
  if (!models.length) return;
  let text: string | undefined;
  let noText = false;
  if (proof.kind === "pdf") {
    text = (await pdfToText(env, proof)) || undefined;
    noText = !text;
  }
  const settled = await Promise.allSettled(
    models.map(async (model): Promise<typeof benchReadings.$inferInsert> => {
      const base = {
        benchReceiptId: receipt.id,
        model: model.id,
        modelLabel: model.label,
        questionVersion: QUESTIONS_VERSION,
      };
      if (noText) {
        return {
          ...base,
          status: "failed",
          failureCode: "READER_UNREADABLE",
          readerMs: 0,
          rawOutput: "the PDF's conversion yielded no text; no model was asked",
        };
      }
      const started = Date.now();
      try {
        const reading = await readProof(env.AI, proof, model, { text, timeoutMs: benchLimits.timeoutMs });
        const gated = gateReading(reading);
        return {
          ...base,
          status: "read",
          readerMs: reading.ms,
          reading: JSON.stringify(productReading(gated, reading)),
          rawOutput: reading.raw,
        };
      } catch (err) {
        const reader = err instanceof ReaderError ? err : new ReaderError("READER_UNAVAILABLE", String(err));
        return {
          ...base,
          status: "failed",
          failureCode: reader.message === "timeout" ? "TIMEOUT" : reader.code,
          readerMs: Date.now() - started,
          rawOutput: reader.raw ?? reader.message,
        };
      }
    }),
  );
  const rows = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  /* The unique (receipt, model, version) index makes a concurrent
     "Leer de nuevo" harmless: the second insert of a pair is dropped */
  for (const row of rows) await db.insert(benchReadings).values(row).onConflictDoNothing();
}

/* POST /platform/reader/bench — the payer upload's own rules (1 MB, an
   image or a PDF by declared type, then by magic bytes), then every
   listed model reads it */
export async function postBench(c: Ctx) {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) return fail(c, "VALIDATION_ERROR", 400);
  if (file.size > PROOF_MAX_BYTES) return fail(c, "PROOF_TOO_LARGE", 413);
  if (!isAcceptedProofType(file.type)) return fail(c, "PROOF_UNSUPPORTED_TYPE", 415);

  const bytes = new Uint8Array(await file.arrayBuffer());
  let proof: LoadedProof;
  try {
    proof = await loadProof(bytes);
  } catch (err) {
    if (err instanceof ProofFetchError) {
      return err.code === "PROOF_TOO_LARGE" ? fail(c, "PROOF_TOO_LARGE", 413) : fail(c, "PROOF_UNSUPPORTED_TYPE", 415);
    }
    throw err;
  }
  /* constitution VIII: no binding, nothing to measure — and nothing stored */
  if (!c.env.AI) return fail(c, "READER_UNAVAILABLE", 503);

  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(benchReceipts).where(eq(benchReceipts.sha256, proof.sha256)).limit(1);
  if (existing) return c.json({ success: true, data: await detail(c.env, db, existing, true) }, 200);

  const id = crypto.randomUUID();
  const proofKey = `bench/${id}`;
  await c.env.PROOFS.put(proofKey, bytes, { httpMetadata: { contentType: proof.mediaType } });
  const [receipt] = await db
    .insert(benchReceipts)
    .values({
      id,
      proofKey,
      sha256: proof.sha256,
      mediaType: proof.mediaType,
      byteSize: bytes.byteLength,
      uploadedBy: c.get("actor").userId,
    })
    .returning();
  await readWith(c.env, db, receipt, proof, readerModels(c.env).list);
  return c.json({ success: true, data: await detail(c.env, db, receipt) }, 201);
}

const PAGE = 25;

/* Newest first, 25 a page, the cursor on (created_at, id) as the
   landing's request list does */
export async function listBench(c: Ctx, cursor: string | undefined) {
  const db = drizzle(c.env.DB);
  let after: { at: Date; id: string } | null = null;
  if (cursor) {
    const [at, id] = cursor.split("_");
    if (at && id && Number.isFinite(Number(at))) after = { at: new Date(Number(at)), id };
  }
  const receipts = await db
    .select()
    .from(benchReceipts)
    .where(
      after
        ? or(lt(benchReceipts.createdAt, after.at), and(eq(benchReceipts.createdAt, after.at), lt(benchReceipts.id, after.id)))
        : undefined,
    )
    .orderBy(desc(benchReceipts.createdAt), desc(benchReceipts.id))
    .limit(PAGE + 1);
  const page = receipts.slice(0, PAGE);
  const readings = page.length
    ? await db
        .select()
        .from(benchReadings)
        .where(inArray(benchReadings.benchReceiptId, page.map((r) => r.id)))
        .orderBy(benchReadings.createdAt)
    : [];
  const heads = await Promise.all(page.map((r) => c.env.PROOFS.head(r.proofKey)));
  const items: BenchReceiptSummary[] = page.map((r, i) => ({
    id: r.id,
    mediaType: r.mediaType,
    byteSize: r.byteSize,
    createdAt: r.createdAt.getTime(),
    fileAvailable: Boolean(heads[i]),
    readings: readings
      .filter((x) => x.benchReceiptId === r.id)
      .map((x) => ({
        id: x.id,
        model: x.model,
        modelLabel: x.modelLabel,
        questionVersion: x.questionVersion,
        status: x.status,
        readerMs: x.readerMs,
        marked: markedCount(x),
      })),
  }));
  const last = page[page.length - 1];
  const nextCursor = receipts.length > PAGE && last ? `${last.createdAt.getTime()}_${last.id}` : null;
  return c.json({ success: true, data: { items, nextCursor } });
}

async function receiptById(db: DB, id: string) {
  const [receipt] = await db.select().from(benchReceipts).where(eq(benchReceipts.id, id)).limit(1);
  return receipt ?? null;
}

export async function getBench(c: Ctx, id: string) {
  const db = drizzle(c.env.DB);
  const receipt = await receiptById(db, id);
  if (!receipt) return fail(c, "NOT_FOUND", 404);
  return c.json({ success: true, data: await detail(c.env, db, receipt) });
}

/* The bytes with their sniffed type, never cached. There is no public or
   signed URL for a bench file: the panel fetches it with the session. */
export async function getBenchFile(c: Ctx, id: string) {
  const db = drizzle(c.env.DB);
  const receipt = await receiptById(db, id);
  if (!receipt) return fail(c, "NOT_FOUND", 404);
  const object = await c.env.PROOFS.get(receipt.proofKey);
  if (!object) return fail(c, "FILE_EXPIRED", 404);
  return new Response(object.body, {
    headers: { "Content-Type": receipt.mediaType, "Cache-Control": "no-store" },
  });
}

/* "Leer de nuevo": only the missing combinations; with none, nothing reads */
export async function postBenchRead(c: Ctx, id: string) {
  const db = drizzle(c.env.DB);
  const receipt = await receiptById(db, id);
  if (!receipt) return fail(c, "NOT_FOUND", 404);
  const existing = await db.select().from(benchReadings).where(eq(benchReadings.benchReceiptId, receipt.id));
  const missing = missingFor(c.env, existing);
  if (missing.length) {
    if (!c.env.AI) return fail(c, "READER_UNAVAILABLE", 503);
    const object = await c.env.PROOFS.get(receipt.proofKey);
    if (!object) return fail(c, "FILE_EXPIRED", 404);
    const proof = await loadProof(new Uint8Array(await new Response(object.body).arrayBuffer()));
    await readWith(c.env, db, receipt, proof, missing);
  }
  return c.json({ success: true, data: await detail(c.env, db, receipt) });
}

/* D17: marks replace the reading's marks. `absent` is never offered on
   `isReceipt` or `legibility`, and a failed reading has nothing to mark. */
export async function putBenchMarks(c: Ctx, readingId: string, marks: BenchMarks) {
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(benchReadings).where(eq(benchReadings.id, readingId)).limit(1);
  if (!row) return fail(c, "NOT_FOUND", 404);
  if (row.status !== "read") return fail(c, "VALIDATION_ERROR", 400);
  const entries = Object.entries(marks).filter(([, m]) => m) as [BenchField, string][];
  if (entries.some(([f, m]) => m === "absent" && FIELDS_WITHOUT_ABSENT.includes(f))) {
    return fail(c, "VALIDATION_ERROR", 400);
  }
  const clean = Object.fromEntries(BENCH_FIELDS.filter((f) => marks[f]).map((f) => [f, marks[f]]));
  const [updated] = await db
    .update(benchReadings)
    .set({ marks: JSON.stringify(clean), markedBy: c.get("actor").userId, markedAt: new Date() })
    .where(eq(benchReadings.id, readingId))
    .returning();
  return c.json({ success: true, data: toReading(updated) });
}

export async function getBenchTally(c: Ctx) {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(benchReadings);
  return c.json({
    success: true,
    data: tally(
      rows.map((r) => ({
        model: r.model,
        modelLabel: r.modelLabel,
        questionVersion: r.questionVersion,
        status: r.status,
        readerMs: r.readerMs,
        reading: parseJson<BenchReading["reading"]>(r.reading, null),
        marks: parseJson<BenchMarks>(r.marks, {}),
        createdAt: r.createdAt.getTime(),
      })),
      Date.now(),
    ),
  });
}
