import type { DrizzleD1Database } from "drizzle-orm/d1";
import { extractions } from "../db/schema";
import type { Bindings } from "../env";
import {
  checkShape,
  extractProof,
  loadShapeRules,
  ProofFetchError,
  readProofFromBucket,
  ReaderError,
  suggestBank,
  type ExtractionResult,
  type ShapeVerdict,
} from "./extraction";
import type { Bank } from "../direct-payments/banks";
import { ConstaError, type ConstaErrorCode } from "./failure";
import { ownerId, type ConstaReading, type Owner } from "./index";
import { amountToCents } from "../wisphub/money";

/* The reading door (proof-extraction D6): read without spending a
   credit, so a caller can show a customer what was read before money
   moves. Was `POST /extract` while the engine was a service; a function
   since consta-api-merge D2, called by the payment page's `/read` route
   for the business that owns the link. */

type Outcome = "passed" | "gated" | "not_a_receipt" | "unreadable" | "refused" | "routed";

export type ShapeSignals = { shape: ShapeVerdict; suggestedBank: Bank | null };

/* D15/D16 — the shape rules act on a reading, and only on a clave that
   passed the gate: a malformed clave already has a louder answer. The
   suggestion exists only when the reading named no usable bank. */
export async function shapeSignals(db: DrizzleD1Database, result: ExtractionResult): Promise<ShapeSignals> {
  if (result.route !== "reader" || result.gated.gate.trackingKey !== "ok") {
    return { shape: "unknown", suggestedBank: null };
  }
  const { gated } = result;
  const rules = await loadShapeRules(db);
  return {
    shape: checkShape(rules, gated.senderBank, gated.trackingKey),
    suggestedBank: gated.gate.senderBank === "ok" ? null : suggestBank(rules, gated.trackingKey),
  };
}

/* D9 — a rejection at the edge is logged but never billed. Every path out
   of here writes exactly one `extractions` row, including the ones that
   spend nothing: the refusal rate is the number this feature exists to
   drive down, and a rate nobody records is a rate nobody improves.
   consta-api-merge D3: the row is attributed to its owner — the business,
   or NULL for the platform's own top-up. */
export async function recordExtraction(
  db: DrizzleD1Database,
  owner: Owner,
  outcome: Outcome,
  result: ExtractionResult | null,
  extra: { validationId?: string | null; note?: string; signals?: ShapeSignals } = {},
): Promise<string> {
  const proof = result?.proof ?? null;
  const reading = result?.route === "reader" ? result.reading : null;
  const gated = result?.route === "reader" ? result.gated : null;

  const [row] = await db
    .insert(extractions)
    .values({
      businessId: ownerId(owner),
      source: result?.route === "provider-ocr" ? "provider-ocr" : "reader",
      outcome,
      model: reading?.model ?? null,
      proofSha256: proof?.sha256 ?? null,
      mediaType: proof?.mediaType ?? null,
      byteSize: proof?.bytes.byteLength ?? null,
      trackingKey: gated?.trackingKey ?? null,
      senderBank: gated?.senderBank ?? null,
      /* Pesos at the model's edge, cents at ours (validation spec D7) —
         by string parsing, never `× 100` (constitution II,
         consta-api-merge D18) */
      amountCents: reading?.amount != null ? amountToCents(reading.amount) : null,
      transferDate: reading?.date ?? null,
      receiptStatus: reading?.status ?? null,
      gateTrackingKey: gated?.gate.trackingKey ?? null,
      gateSenderBank: gated?.gate.senderBank ?? null,
      shape: extra.signals?.shape ?? null,
      suggestedBank: extra.signals?.suggestedBank ?? null,
      rawOutput: reading?.raw ?? extra.note ?? null,
      validationId: extra.validationId ?? null,
    })
    .returning({ id: extractions.id });
  return row.id;
}

/* Proof and reader failures, mapped once so both doors answer alike.
   The split is "must the request change?" — a file we cannot find or
   recognise will never work, while a stumbling model may. D19: every
   error says whether waiting can help — the 422/502 HTTP pair the
   service answered with is now the `retryable` flag on the in-process
   failure (consta-api-merge D6), and the law is the same. */
export function extractionFailure(err: unknown): { code: ConstaErrorCode; retryable: boolean } | null {
  if (err instanceof ProofFetchError) return { code: err.code, retryable: false };
  if (err instanceof ReaderError) return { code: err.code, retryable: true };
  return null;
}

export function readingPayload(
  result: ExtractionResult,
  signals: ShapeSignals = { shape: "unknown", suggestedBank: null },
): Omit<ConstaReading, "extractionId"> {
  if (result.route === "provider-ocr") {
    /* A PDF was loaded and recognised, and deliberately not read here
       (D2). Saying so is more useful than inventing empty fields. */
    return {
      source: "provider-ocr" as const,
      isReceipt: null,
      trackingKey: null,
      senderBank: null,
      amountCents: null,
      date: null,
      receiptStatus: null,
      gate: {
        trackingKey: "missing" as const,
        senderBank: "missing" as const,
        amount: "missing" as const,
        shape: "unknown" as const,
      },
    };
  }
  const { reading, gated } = result;
  return {
    source: "reader" as const,
    isReceipt: reading.isReceipt,
    trackingKey: gated.trackingKey,
    senderBank: gated.senderBank,
    /* D3: reported, never authoritative. `cepDetails` remains the only
       source of the amount and date that decide money. */
    amountCents: gated.amountCents,
    date: reading.date,
    receiptStatus: reading.status,
    /* D15: a field, never a refusal — the caller decides what a
       mismatch is worth before spending */
    gate: { ...gated.gate, shape: signals.shape },
    /* D16: to confirm, never to send */
    ...(signals.suggestedBank ? { suggestedBank: signals.suggestedBank } : {}),
  };
}

export async function extract(
  env: Bindings,
  db: DrizzleD1Database,
  owner: Owner,
  { proofKey }: { proofKey: string },
): Promise<ConstaReading> {
  let result: ExtractionResult;
  try {
    /* consta-api-merge D7: the bytes come from the product's own bucket */
    result = await extractProof(env, await readProofFromBucket(env.PROOFS, proofKey));
  } catch (err) {
    const failure = extractionFailure(err);
    if (!failure) throw err;
    await recordExtraction(db, owner, failure.code === "READER_UNREADABLE" ? "unreadable" : "refused", null, {
      note: `${failure.code}: ${String((err as Error).message)}`,
    });
    throw new ConstaError(failure.code, failure.retryable, String((err as Error).message));
  }

  const signals = await shapeSignals(db, result);
  const payload = readingPayload(result, signals);
  const outcome: Outcome =
    result.route === "provider-ocr"
      ? "routed"
      : !result.reading.isReceipt
        ? "not_a_receipt"
        : result.gated.passes
          ? "passed"
          : "gated";

  const extractionId = await recordExtraction(db, owner, outcome, result, { signals });
  /* No apiCEP call happened on this path at all — that is the contract
     of this door, not an implementation detail (D6). */
  return { extractionId, ...payload };
}
